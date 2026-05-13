import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.databases import get_driver_for_db, get_db_type

logger = get_logger("ai")

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AiQueryRequest(BaseModel):
    db_id: str
    prompt: str


def _build_schema_summary(tables: list[dict]) -> str:
    lines = []
    for t in tables:
        cols = ", ".join(
            f"{c['name']} {c['type']}{'  PK' if c['pk'] else ''}"
            for c in t["columns"]
        )
        lines.append(f"  {t['name']} ({cols})  -- {t['row_count']} rows")

        if t["foreign_keys"]:
            for fk in t["foreign_keys"]:
                lines.append(
                    f"    FK: {t['name']}.{fk['from_column']} -> {fk['to_table']}.{fk['to_column']}"
                )
    return "\n".join(lines)


@router.post("/generate-query")
def generate_query(req: AiQueryRequest, db: Session = Depends(get_db)):
    logger.info("AI query generation requested for db_id=%s: %.100s", req.db_id, req.prompt)
    driver = get_driver_for_db(req.db_id, db)
    conn = driver.connect()
    try:
        tables = driver.get_table_info(conn)
        schema_summary = _build_schema_summary(tables)
    finally:
        driver.close(conn)

    db_type = get_db_type(req.db_id, db)
    dialect = "PostgreSQL" if db_type == "postgres" else "SQLite"

    system_prompt = (
        f"You are a SQL query generator for {dialect} databases. "
        f"Given a database schema and a user request in plain English, "
        f"return ONLY a valid {dialect} SQL query. "
        "Do NOT include any explanation, markdown, code fences, or extra text. "
        "Return ONLY the raw SQL query text, nothing else."
    )

    user_prompt = (
        f"Database schema:\n{schema_summary}\n\n"
        f"User request: {req.prompt}\n\n"
        "Return ONLY the SQL query."
    )

    try:
        result = subprocess.run(
            [
                "claude",
                "--print",
                "--system-prompt", system_prompt,
                user_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            logger.error("Claude CLI returned non-zero exit code: %s", result.stderr.strip())
            raise HTTPException(
                status_code=500,
                detail=f"Claude CLI error: {result.stderr.strip() or 'Unknown error'}",
            )

        sql = result.stdout.strip()

        if sql.startswith("```"):
            lines = sql.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            sql = "\n".join(lines).strip()

        logger.info("AI generated query for db_id=%s: %.100s", req.db_id, sql)
        return {"sql": sql}

    except subprocess.TimeoutExpired:
        logger.error("AI query generation timed out after 30s for db_id=%s", req.db_id)
        raise HTTPException(status_code=504, detail="AI query generation timed out")
    except FileNotFoundError:
        logger.error("Claude CLI not found on system PATH")
        raise HTTPException(
            status_code=500,
            detail="Claude CLI not found. Please install and configure the Claude CLI.",
        )
