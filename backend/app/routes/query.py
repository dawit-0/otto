import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.history import QueryHistory
from app.routes.databases import get_driver_for_db, get_db_name
from app.utils.sql_safety import (
    DESTRUCTIVE_DDL,
    DESTRUCTIVE_DML,
    classify_statement,
    has_where_clause,
)

logger = get_logger("query")

router = APIRouter(prefix="/api", tags=["query"])


class QueryRequest(BaseModel):
    db_id: str
    sql: str
    # Set once the user has clicked through the destructive-statement
    # confirmation modal; first pass through always defaults to False.
    confirmed: bool = False


class ExplainRequest(BaseModel):
    db_id: str
    sql: str


@router.post("/query")
def execute_query(req: QueryRequest, db: Session = Depends(get_db)):
    driver = get_driver_for_db(req.db_id, db)
    db_name = get_db_name(req.db_id, db)
    statement_type = classify_statement(req.sql)

    # Schema-destroying statements (DROP/TRUNCATE/ALTER) are gated purely on
    # the keyword — there is no safe way to "preview" them, so we just ask
    # before running anything at all.
    if not req.confirmed and statement_type in DESTRUCTIVE_DDL:
        return {
            "requires_confirmation": True,
            "statement_type": statement_type,
            "affected_rows": None,
            "has_where": False,
        }

    logger.info("Executing query on '%s': %.100s", db_name, req.sql)

    conn = driver.connect()
    start = time.perf_counter()
    try:
        cursor = conn.cursor()
        cursor.execute(req.sql)

        # UPDATE/DELETE can be previewed safely: run it for real inside the
        # open transaction to get an accurate affected-row count, then roll
        # back instead of committing if the user hasn't confirmed yet.
        if not req.confirmed and statement_type in DESTRUCTIVE_DML:
            affected_rows = cursor.rowcount
            conn.rollback()
            return {
                "requires_confirmation": True,
                "statement_type": statement_type,
                "affected_rows": affected_rows,
                "has_where": has_where_clause(req.sql),
            }

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
        driver.close(conn)


@router.post("/query/explain")
def explain_query(req: ExplainRequest, db: Session = Depends(get_db)):
    """Return the query plan for `sql` using the database's EXPLAIN ANALYZE
    equivalent. The driver picks the dialect-appropriate command, so this route
    stays database-agnostic."""
    driver = get_driver_for_db(req.db_id, db)
    db_name = get_db_name(req.db_id, db)
    logger.info("Explaining query on '%s': %.100s", db_name, req.sql)

    conn = driver.connect()
    try:
        return driver.explain_analyze(conn, req.sql)
    except Exception as e:
        logger.error("Explain failed on '%s': %s", db_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
