import json

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.ai import get_client, _build_schema_summary
from app.routes.databases import get_connection

logger = get_logger("ai_chat")

router = APIRouter(prefix="/api/ai", tags=["ai"])

CHAT_MODEL = "claude-opus-4-7"
CHAT_MAX_TOKENS = 2048

CHAT_SYSTEM_PROMPT = """\
You are Otto, a friendly and expert database analyst. Help users explore their SQLite database through conversation.

When answering questions about the data:
- Write a SQL query to retrieve the answer when needed
- Provide a concise, plain-English explanation of what you found or what the data shows
- Point out interesting patterns or insights you notice
- Use LIMIT 100 or fewer rows to keep results manageable

Always respond with valid JSON in exactly this format:
{{
  "sql": "SELECT ... FROM ...",
  "answer": "Here's what I found..."
}}

If no SQL is needed (e.g. schema questions, clarifications, or follow-ups that need no new data), set "sql" to null.

Database schema:
{schema}
"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    db_id: str
    messages: list[ChatMessage]
    message: str


class ChatResponse(BaseModel):
    answer: str
    sql: str | None = None
    columns: list[str] | None = None
    rows: list[dict] | None = None
    row_count: int | None = None
    query_error: str | None = None


@router.post("/chat", response_model=ChatResponse)
def ai_chat(req: ChatRequest, db: Session = Depends(get_db)):
    logger.info("AI chat for db_id=%s: %.100s", req.db_id, req.message)

    conn = get_connection(req.db_id, db)
    try:
        schema_summary = _build_schema_summary(conn)
    finally:
        conn.close()

    system = CHAT_SYSTEM_PROMPT.format(schema=schema_summary)

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    messages.append({"role": "user", "content": req.message})

    try:
        response = get_client().messages.create(
            model=CHAT_MODEL,
            max_tokens=CHAT_MAX_TOKENS,
            system=system,
            messages=messages,
        )
    except anthropic.AuthenticationError as e:
        logger.error("Anthropic auth error: %s", e)
        raise HTTPException(status_code=500, detail="AI service authentication failed. Check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError as e:
        logger.error("Anthropic rate limit: %s", e)
        raise HTTPException(status_code=429, detail="AI rate limit exceeded. Try again shortly.")
    except anthropic.APIConnectionError as e:
        logger.error("Anthropic connection error: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach AI service.")
    except anthropic.APIStatusError as e:
        logger.error("Anthropic API error %s: %s", e.status_code, e)
        raise HTTPException(status_code=502, detail=f"AI service error: {getattr(e, 'message', None) or str(e)}")

    raw = "".join(b.text for b in response.content if b.type == "text").strip()

    # Strip markdown fences if the model wraps its JSON response
    if raw.startswith("```"):
        lines = [ln for ln in raw.split("\n") if not ln.strip().startswith("```")]
        raw = "\n".join(lines).strip()

    try:
        parsed = json.loads(raw)
        answer = parsed.get("answer", "")
        sql = parsed.get("sql") or None
    except (json.JSONDecodeError, AttributeError):
        logger.warning("AI returned non-JSON: %.200s", raw)
        answer = raw
        sql = None

    columns: list[str] | None = None
    rows: list[dict] | None = None
    row_count: int | None = None
    query_error: str | None = None

    if sql:
        conn = get_connection(req.db_id, db)
        try:
            cursor = conn.execute(sql)
            if cursor.description:
                col_names = [d[0] for d in cursor.description]
                fetched = cursor.fetchall()
                rows = [dict(zip(col_names, row)) for row in fetched]
                columns = col_names
                row_count = len(rows)
        except Exception as e:
            logger.warning("AI SQL failed: %s — %.200s", e, sql)
            query_error = str(e)
        finally:
            conn.close()

    return ChatResponse(
        answer=answer,
        sql=sql,
        columns=columns,
        rows=rows,
        row_count=row_count,
        query_error=query_error,
    )
