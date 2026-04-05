import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.history import QueryHistory
from app.routes.databases import databases, get_connection

router = APIRouter(prefix="/api", tags=["query"])


class QueryRequest(BaseModel):
    db_id: str
    sql: str


@router.post("/query")
def execute_query(req: QueryRequest, db: Session = Depends(get_db)):
    conn = get_connection(req.db_id)
    db_name = databases.get(req.db_id, req.db_id)

    start = time.perf_counter()
    try:
        cursor = conn.execute(req.sql)
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

        # Record successful query
        db.add(QueryHistory(
            db_id=req.db_id,
            db_name=db_name,
            sql=req.sql,
            status="success",
            row_count=result["row_count"],
            duration_ms=duration_ms,
        ))
        db.commit()

        return result
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000
        # Record failed query
        db.add(QueryHistory(
            db_id=req.db_id,
            db_name=db_name,
            sql=req.sql,
            status="error",
            error_message=str(e),
            duration_ms=duration_ms,
        ))
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
