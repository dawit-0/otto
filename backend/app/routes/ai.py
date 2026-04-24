import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.databases import get_connection, get_table_info

logger = get_logger("ai")

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AiQueryRequest(BaseModel):
    db_id: str
    prompt: str


def _build_schema_summary(conn) -> str:
    """Build a concise schema description for the LLM prompt."""
    tables = get_table_info(conn)
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
    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    finally:
        conn.close()

    system_prompt = (
        "You are a SQL query generator for SQLite databases. "
        "Given a database schema and a user request in plain English, "
        "return ONLY a valid SQLite SQL query. "
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

        # Strip markdown code fences if the model included them despite instructions
        if sql.startswith("```"):
            lines = sql.split("\n")
            # Remove first line (```sql or ```) and last line (```)
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


class AskRequest(BaseModel):
    db_id: str
    question: str


def _parse_ask_response(text: str) -> tuple[str, str]:
    """Parse SQL and EXPLANATION sections from Claude's response."""
    lines = text.strip().split("\n")
    section = None
    sql_lines: list[str] = []
    explanation_lines: list[str] = []

    for line in lines:
        upper = line.strip().upper()
        if upper.startswith("SQL:"):
            section = "sql"
            rest = line.strip()[4:].strip()
            if rest:
                sql_lines.append(rest)
        elif upper.startswith("EXPLANATION:"):
            section = "explanation"
            rest = line.strip()[12:].strip()
            if rest:
                explanation_lines.append(rest)
        elif section == "sql":
            sql_lines.append(line)
        elif section == "explanation":
            explanation_lines.append(line)

    sql = "\n".join(sql_lines).strip()
    explanation = "\n".join(explanation_lines).strip()

    # Strip markdown code fences if the model included them
    if sql.startswith("```"):
        sql = "\n".join(
            l for l in sql.split("\n") if not l.strip().startswith("```")
        ).strip()

    return sql, explanation


@router.post("/ask")
def ask_otto(req: AskRequest, db: Session = Depends(get_db)):
    logger.info("Ask Otto requested for db_id=%s: %.100s", req.db_id, req.question)
    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    except Exception:
        conn.close()
        raise

    system_prompt = (
        "You are Otto, a friendly SQLite database assistant. "
        "Given a database schema and a user question, respond in EXACTLY this format:\n\n"
        "SQL:\n"
        "<the complete SQL query>\n\n"
        "EXPLANATION:\n"
        "<1-2 sentences in plain English explaining what was found>\n\n"
        "Do not include any other text, markdown, or formatting. "
        "Only generate SELECT queries — never INSERT, UPDATE, DELETE, or DDL."
    )

    user_prompt = (
        f"Database schema:\n{schema_summary}\n\n"
        f"Question: {req.question}"
    )

    try:
        result = subprocess.run(
            ["claude", "--print", "--system-prompt", system_prompt, user_prompt],
            capture_output=True,
            text=True,
            timeout=45,
        )

        if result.returncode != 0:
            logger.error("Claude CLI returned non-zero exit code: %s", result.stderr.strip())
            raise HTTPException(
                status_code=500,
                detail=f"Claude CLI error: {result.stderr.strip() or 'Unknown error'}",
            )

        sql, explanation = _parse_ask_response(result.stdout)

        if not sql:
            raise HTTPException(status_code=500, detail="Could not parse SQL from AI response")

        logger.info("Ask Otto generated SQL for db_id=%s: %.100s", req.db_id, sql)

    except subprocess.TimeoutExpired:
        conn.close()
        raise HTTPException(status_code=504, detail="Ask Otto timed out — try a simpler question")
    except FileNotFoundError:
        conn.close()
        raise HTTPException(
            status_code=500,
            detail="Claude CLI not found. Please install and configure the Claude CLI.",
        )

    # Execute the generated SQL
    start = time.perf_counter()
    try:
        cursor = conn.execute(sql)
        duration_ms = (time.perf_counter() - start) * 1000
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        row_count = len(rows)
        logger.info("Ask Otto query executed in %.1fms, %d rows", duration_ms, row_count)
        return {
            "sql": sql,
            "explanation": explanation,
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
        }
    except Exception as e:
        logger.error("Ask Otto query failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Query error: {e}")
    finally:
        conn.close()
