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


class AiQueryRequest(BaseModel):
    db_id: str
    prompt: str


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
