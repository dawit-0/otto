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
INSIGHT_MAX_TOKENS = 1024
INSIGHT_MAX_ROWS = 40

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


class AiInsightRequest(BaseModel):
    db_id: str
    sql: str
    columns: list[str]
    rows: list[dict]


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

    response = _call_anthropic(SYSTEM_PROMPT, user_prompt, MAX_TOKENS)
    sql = _strip_code_fences(_extract_text(response))

    if not sql:
        logger.error("AI returned empty SQL for db_id=%s", req.db_id)
        raise HTTPException(status_code=502, detail="AI returned an empty response")

    logger.info("AI generated query for db_id=%s: %.100s", req.db_id, sql)
    return {"sql": sql}


INSIGHT_SYSTEM_PROMPT = (
    "You are a data analyst assistant embedded in a SQLite database explorer. "
    "Given a SQL query and a sample of its results, provide a concise, insightful analysis. "
    "Structure your response with these sections using **bold** headers:\n"
    "**Summary** — 1-2 sentences describing what the data shows overall.\n"
    "**Key Findings** — 2-4 bullet points highlighting notable values, patterns, or trends.\n"
    "**Data Quality** — one line on nulls, outliers, or anything unusual (skip if nothing noteworthy).\n"
    "**Follow-up Ideas** — 1-2 suggested queries or angles worth exploring.\n"
    "Be specific about actual values from the data. Use plain language. Keep it tight — no padding."
)


def _format_rows_as_text(columns: list[str], rows: list[dict], max_rows: int) -> str:
    sample = rows[:max_rows]
    header = " | ".join(columns)
    separator = "-+-".join("-" * len(c) for c in columns)
    lines = [header, separator]
    for row in sample:
        lines.append(" | ".join(str(row.get(c, "")) for c in columns))
    if len(rows) > max_rows:
        lines.append(f"... ({len(rows) - max_rows} more rows not shown)")
    return "\n".join(lines)


def _call_anthropic(system: str, user_content: str, max_tokens: int):
    """Shared Anthropic call with unified error handling."""
    try:
        return get_client().messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
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


@router.post("/analyze-results")
def analyze_results(req: AiInsightRequest, db: Session = Depends(get_db)):
    logger.info(
        "AI result analysis requested for db_id=%s, %d rows, %d cols",
        req.db_id,
        len(req.rows),
        len(req.columns),
    )
    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    finally:
        conn.close()

    table_text = _format_rows_as_text(req.columns, req.rows, INSIGHT_MAX_ROWS)
    user_content = (
        f"Database schema:\n{schema_summary}\n\n"
        f"SQL query:\n{req.sql}\n\n"
        f"Result ({len(req.rows)} row{'s' if len(req.rows) != 1 else ''}, "
        f"{len(req.columns)} column{'s' if len(req.columns) != 1 else ''}):\n{table_text}"
    )

    response = _call_anthropic(INSIGHT_SYSTEM_PROMPT, user_content, INSIGHT_MAX_TOKENS)
    insight = _extract_text(response).strip()

    if not insight:
        logger.error("AI returned empty insight for db_id=%s", req.db_id)
        raise HTTPException(status_code=502, detail="AI returned an empty response")

    logger.info("AI insight generated for db_id=%s", req.db_id)
    return {"insight": insight}
