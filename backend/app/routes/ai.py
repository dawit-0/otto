import re

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.databases import get_connection, get_table_info

logger = get_logger("ai")

router = APIRouter(prefix="/api/ai", tags=["ai"])

MODEL = "claude-opus-4-7"
MAX_TOKENS = 1024

SYSTEM_PROMPT = (
    "You are a SQL query generator for SQLite databases. "
    "Given a database schema and a user request in plain English, "
    "return ONLY a valid SQLite SQL query. "
    "Do NOT include any explanation, markdown, code fences, or extra text. "
    "Return ONLY the raw SQL query text, nothing else."
)

CHAT_SYSTEM_PROMPT = """\
You are Otto, a friendly and insightful AI data analyst for SQLite databases.
Help users explore and understand their data through natural conversation.

When a question requires querying data:
- Write exactly ONE SQL query in a ```sql code block
- Keep the SQL valid for SQLite
- After the SQL block, briefly explain what the results mean and highlight interesting patterns

When a question doesn't need data (e.g. "what tables exist?", "describe the schema"), answer directly without SQL.
Be concise, clear, and point out interesting trends or anomalies when you see them.
"""


class AiQueryRequest(BaseModel):
    db_id: str
    prompt: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    db_id: str
    messages: list[ChatMessage]


_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


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


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = [l for l in text.split("\n") if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return text


def _extract_text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text")


@router.post("/generate-query")
def generate_query(req: AiQueryRequest, db: Session = Depends(get_db)):
    logger.info("AI query generation requested for db_id=%s: %.100s", req.db_id, req.prompt)
    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    finally:
        conn.close()

    user_prompt = (
        f"Database schema:\n{schema_summary}\n\n"
        f"User request: {req.prompt}\n\n"
        "Return ONLY the SQL query."
    )

    try:
        response = get_client().messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except anthropic.AuthenticationError as e:
        logger.error("Anthropic authentication failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail="AI service authentication failed. Check ANTHROPIC_API_KEY.",
        )
    except anthropic.RateLimitError as e:
        logger.error("Anthropic rate limit hit: %s", e)
        raise HTTPException(
            status_code=429,
            detail="AI service rate limit exceeded. Try again shortly.",
        )
    except anthropic.APIConnectionError as e:
        logger.error("Anthropic connection error: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach AI service.")
    except anthropic.APIStatusError as e:
        logger.error("Anthropic API error %s: %s", e.status_code, e)
        raise HTTPException(
            status_code=502,
            detail=f"AI service error: {getattr(e, 'message', None) or str(e)}",
        )

    sql = _strip_code_fences(_extract_text(response))

    if not sql:
        logger.error("AI returned empty SQL for db_id=%s", req.db_id)
        raise HTTPException(status_code=502, detail="AI returned an empty response")

    logger.info("AI generated query for db_id=%s: %.100s", req.db_id, sql)
    return {"sql": sql}


def _extract_sql_block(text: str) -> str | None:
    """Return the first ```sql ... ``` block from the AI's response, or None."""
    match = re.search(r"```sql\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    return match.group(1).strip() if match else None


def _run_sql(db_id: str, sql: str, db: Session) -> tuple[list[str], list[dict], int, str | None]:
    """Execute sql and return (columns, rows, row_count, error)."""
    try:
        conn = get_connection(db_id, db)
        try:
            cursor = conn.execute(sql)
            if cursor.description:
                columns = [d[0] for d in cursor.description]
                rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
                return columns, rows, len(rows), None
            return [], [], cursor.rowcount, None
        finally:
            conn.close()
    except Exception as exc:
        return [], [], 0, str(exc)


@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    logger.info("Chat request for db_id=%s, %d messages", req.db_id, len(req.messages))

    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    finally:
        conn.close()

    system = f"{CHAT_SYSTEM_PROMPT}\nDatabase schema:\n{schema_summary}"

    try:
        response = get_client().messages.create(
            model=MODEL,
            max_tokens=2048,
            system=system,
            messages=[{"role": m.role, "content": m.content} for m in req.messages],
        )
    except anthropic.AuthenticationError as e:
        logger.error("Anthropic authentication failed: %s", e)
        raise HTTPException(status_code=500, detail="AI authentication failed. Check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError as e:
        logger.error("Anthropic rate limit hit: %s", e)
        raise HTTPException(status_code=429, detail="AI rate limit exceeded. Try again shortly.")
    except anthropic.APIConnectionError as e:
        logger.error("Anthropic connection error: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach AI service.")
    except anthropic.APIStatusError as e:
        logger.error("Anthropic API error %s: %s", e.status_code, e)
        raise HTTPException(status_code=502, detail=f"AI error: {getattr(e, 'message', None) or str(e)}")

    message_text = _extract_text(response)
    sql = _extract_sql_block(message_text)

    columns: list[str] = []
    rows: list[dict] = []
    row_count = 0
    sql_error: str | None = None

    if sql:
        columns, rows, row_count, sql_error = _run_sql(req.db_id, sql, db)
        if sql_error:
            logger.warning("Chat SQL failed for db_id=%s: %s", req.db_id, sql_error)
        else:
            logger.info("Chat SQL returned %d rows for db_id=%s", row_count, req.db_id)

    return {
        "message": message_text,
        "sql": sql,
        "columns": columns,
        "rows": rows,
        "row_count": row_count,
        "sql_error": sql_error,
    }
