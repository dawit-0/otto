from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.history import QueryHistory

router = APIRouter(prefix="/api/history", tags=["history"])


class QueryHistoryResponse(BaseModel):
    id: int
    db_id: str
    db_name: str
    sql: str
    status: str
    row_count: int | None
    error_message: str | None
    duration_ms: float | None
    executed_at: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[QueryHistoryResponse])
def get_query_history(
    db_id: str | None = None,
    limit: int = Query(default=50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = db.query(QueryHistory)
    if db_id:
        query = query.filter(QueryHistory.db_id == db_id)
    entries = (
        query.order_by(desc(QueryHistory.executed_at))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        QueryHistoryResponse(
            id=e.id,
            db_id=e.db_id,
            db_name=e.db_name,
            sql=e.sql,
            status=e.status,
            row_count=e.row_count,
            error_message=e.error_message,
            duration_ms=e.duration_ms,
            executed_at=e.executed_at.isoformat(),
        )
        for e in entries
    ]


@router.delete("")
def clear_history(db_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(QueryHistory)
    if db_id:
        query = query.filter(QueryHistory.db_id == db_id)
    count = query.delete()
    db.commit()
    return {"deleted": count}


@router.delete("/{entry_id}")
def delete_history_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(QueryHistory).filter(QueryHistory.id == entry_id).first()
    if not entry:
        return {"deleted": 0}
    db.delete(entry)
    db.commit()
    return {"deleted": 1}
