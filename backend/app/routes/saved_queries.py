from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.saved_query import SavedQuery

logger = get_logger("saved_queries")

router = APIRouter(prefix="/api/saved-queries", tags=["saved-queries"])


class SavedQueryResponse(BaseModel):
    id: int
    db_id: str
    db_name: str
    name: str
    sql: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class SaveQueryRequest(BaseModel):
    db_id: str
    db_name: str
    name: str
    sql: str
    description: str | None = None


class UpdateSavedQueryRequest(BaseModel):
    name: str | None = None
    sql: str | None = None
    description: str | None = None


def _to_response(e: SavedQuery) -> SavedQueryResponse:
    return SavedQueryResponse(
        id=e.id,
        db_id=e.db_id,
        db_name=e.db_name,
        name=e.name,
        sql=e.sql,
        description=e.description,
        created_at=e.created_at.isoformat(),
        updated_at=e.updated_at.isoformat(),
    )


@router.get("", response_model=list[SavedQueryResponse])
def list_saved_queries(
    db_id: str | None = None,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(SavedQuery)
    if db_id:
        query = query.filter(SavedQuery.db_id == db_id)
    entries = query.order_by(desc(SavedQuery.updated_at)).limit(limit).all()
    return [_to_response(e) for e in entries]


@router.post("", response_model=SavedQueryResponse)
def save_query(req: SaveQueryRequest, db: Session = Depends(get_db)):
    logger.info("Saving query '%s' for db_id=%s", req.name, req.db_id)
    entry = SavedQuery(
        db_id=req.db_id,
        db_name=req.db_name,
        name=req.name,
        sql=req.sql,
        description=req.description,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _to_response(entry)


@router.put("/{query_id}", response_model=SavedQueryResponse)
def update_saved_query(query_id: int, req: UpdateSavedQueryRequest, db: Session = Depends(get_db)):
    entry = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Saved query not found")
    if req.name is not None:
        entry.name = req.name
    if req.sql is not None:
        entry.sql = req.sql
    if req.description is not None:
        entry.description = req.description
    entry.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(entry)
    logger.info("Updated saved query id=%d", query_id)
    return _to_response(entry)


@router.delete("/{query_id}")
def delete_saved_query(query_id: int, db: Session = Depends(get_db)):
    entry = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Saved query not found")
    db.delete(entry)
    db.commit()
    logger.info("Deleted saved query id=%d", query_id)
    return {"deleted": 1}
