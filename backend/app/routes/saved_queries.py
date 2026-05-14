import json
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.history import QueryHistory
from app.models.saved_query import SavedQuery
from app.routes.databases import get_db_name, get_driver_for_db

logger = get_logger("saved_queries")

router = APIRouter(prefix="/api/saved-queries", tags=["saved-queries"])


class QueryParam(BaseModel):
    name: str
    label: str
    type: str = "text"          # "text" | "number" | "date"
    default_value: str = ""


class SavedQueryResponse(BaseModel):
    id: int
    db_id: str
    db_name: str
    name: str
    sql: str
    description: str | None
    parameters: list[QueryParam]
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class SaveQueryRequest(BaseModel):
    db_id: str
    db_name: str
    name: str
    sql: str
    description: str | None = None
    parameters: list[QueryParam] = []


class UpdateSavedQueryRequest(BaseModel):
    name: str | None = None
    sql: str | None = None
    description: str | None = None
    parameters: list[QueryParam] | None = None


class RunSavedQueryRequest(BaseModel):
    db_id: str
    parameters: dict[str, str] = {}


def _parse_params(raw: str | None) -> list[QueryParam]:
    if not raw:
        return []
    try:
        return [QueryParam(**p) for p in json.loads(raw)]
    except Exception:
        return []


def _to_response(e: SavedQuery) -> SavedQueryResponse:
    return SavedQueryResponse(
        id=e.id,
        db_id=e.db_id,
        db_name=e.db_name,
        name=e.name,
        sql=e.sql,
        description=e.description,
        parameters=_parse_params(e.parameters),
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
        parameters=json.dumps([p.model_dump() for p in req.parameters]) if req.parameters else None,
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
    if req.parameters is not None:
        entry.parameters = json.dumps([p.model_dump() for p in req.parameters]) if req.parameters else None
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


@router.post("/{query_id}/run")
def run_saved_query(
    query_id: int,
    req: RunSavedQueryRequest,
    db: Session = Depends(get_db),
):
    entry = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Saved query not found")

    driver = get_driver_for_db(req.db_id, db)
    db_name = get_db_name(req.db_id, db)

    # Extract placeholder names in order of appearance (duplicates included)
    param_names = re.findall(r'\{\{(\w+)\}\}', entry.sql)

    # Replace every {{name}} with the driver's positional placeholder
    param_sql = re.sub(r'\{\{\w+\}\}', driver.placeholder, entry.sql)

    # Build ordered values; fall back to empty string for missing keys
    param_values = [req.parameters.get(name, "") for name in param_names]

    conn = driver.connect()
    start = time.perf_counter()
    try:
        cursor = conn.cursor()
        cursor.execute(param_sql, param_values)
        duration_ms = (time.perf_counter() - start) * 1000

        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            result = {"columns": columns, "rows": rows, "row_count": len(rows)}
        else:
            conn.commit()
            result = {
                "columns": [],
                "rows": [],
                "row_count": cursor.rowcount,
                "message": f"{cursor.rowcount} rows affected",
            }

        logger.info(
            "Ran saved query id=%d on '%s': %d rows in %.1fms",
            query_id, db_name, result["row_count"], duration_ms,
        )

        db.add(QueryHistory(
            db_id=req.db_id,
            db_name=db_name,
            sql=entry.sql,
            status="success",
            row_count=result["row_count"],
            duration_ms=duration_ms,
        ))
        db.commit()

        return result
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.error("Run saved query id=%d failed after %.1fms: %s", query_id, duration_ms, e)
        db.add(QueryHistory(
            db_id=req.db_id,
            db_name=db_name,
            sql=entry.sql,
            status="error",
            error_message=str(e),
            duration_ms=duration_ms,
        ))
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
