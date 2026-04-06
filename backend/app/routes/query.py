import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.history import QueryHistory
from app.routes.databases import get_connection, get_db_name

logger = get_logger("query")

router = APIRouter(prefix="/api", tags=["query"])


class QueryRequest(BaseModel):
    db_id: str
    sql: str


@router.post("/query")
def execute_query(req: QueryRequest, db: Session = Depends(get_db)):
    conn = get_connection(req.db_id, db)
    db_name = get_db_name(req.db_id, db)
    logger.info("Executing query on '%s': %.100s", db_name, req.sql)

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

        logger.info(
            "Query succeeded on '%s': %d rows in %.1fms",
            db_name, result["row_count"], duration_ms,
        )

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
        logger.error(
            "Query failed on '%s' after %.1fms: %s", db_name, duration_ms, e,
        )
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
