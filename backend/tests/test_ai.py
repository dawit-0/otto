"""Tests for the AI query generation route, with the Anthropic client mocked."""

from unittest.mock import MagicMock

import anthropic
import httpx
import pytest

from app.routes import ai as ai_module


def _setup(client, sample_db):
    return client.post("/api/databases/connect", json={"path": sample_db}).json()["id"]


def _make_response(text):
    """Build a fake Anthropic Message-like response with one text block."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    response = MagicMock()
    response.content = [block]
    return response


def _api_error(cls, status):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status_code=status, request=request)
    return cls(message="boom", response=response, body=None)


@pytest.fixture()
def mock_anthropic(monkeypatch):
    """Replace the module-level Anthropic client with a MagicMock."""
    mock_client = MagicMock()
    monkeypatch.setattr(ai_module, "_client", mock_client)
    monkeypatch.setattr(ai_module, "get_client", lambda: mock_client)
    return mock_client


def test_generate_query_success(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("SELECT * FROM authors")

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "list every author"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"sql": "SELECT * FROM authors"}
    mock_anthropic.messages.create.assert_called_once()


def test_generate_query_strips_code_fences(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response(
        "```sql\nSELECT * FROM books\n```"
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "all books"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"sql": "SELECT * FROM books"}


def test_generate_query_strips_plain_fences(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response(
        "```\nSELECT 1\n```"
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.json()["sql"] == "SELECT 1"


def test_generate_query_passes_schema_and_prompt(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("SELECT 1")

    client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "books per author"},
    )

    call_kwargs = mock_anthropic.messages.create.call_args.kwargs
    user_content = call_kwargs["messages"][0]["content"]
    assert "authors" in user_content
    assert "books" in user_content
    assert "FK: books.author_id -> authors.id" in user_content
    assert "books per author" in user_content


def test_generate_query_uses_opus_model(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("SELECT 1")

    client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "anything"},
    )

    kwargs = mock_anthropic.messages.create.call_args.kwargs
    assert kwargs["model"] == "claude-opus-4-7"
    assert kwargs["system"] == ai_module.SYSTEM_PROMPT
    assert kwargs["max_tokens"] == ai_module.MAX_TOKENS
    assert kwargs["messages"][0]["role"] == "user"


def test_generate_query_concatenates_multiple_text_blocks(
    client, sample_db, mock_anthropic
):
    db_id = _setup(client, sample_db)
    block1 = MagicMock(type="text", text="SELECT * ")
    block2 = MagicMock(type="text", text="FROM authors")
    response = MagicMock(content=[block1, block2])
    mock_anthropic.messages.create.return_value = response

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "all authors"},
    )
    assert resp.json()["sql"] == "SELECT * FROM authors"


def test_generate_query_ignores_non_text_blocks(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    thinking = MagicMock(type="thinking")
    thinking.text = "should not be used"
    text_block = MagicMock(type="text", text="SELECT 42")
    response = MagicMock(content=[thinking, text_block])
    mock_anthropic.messages.create.return_value = response

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "give me 42"},
    )
    assert resp.json()["sql"] == "SELECT 42"


def test_generate_query_unknown_db_does_not_call_api(client, mock_anthropic):
    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": "nonexistent_xyz", "prompt": "anything"},
    )
    assert resp.status_code == 404
    mock_anthropic.messages.create.assert_not_called()


def test_generate_query_authentication_error_returns_500(
    client, sample_db, mock_anthropic
):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.side_effect = _api_error(
        anthropic.AuthenticationError, 401
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.status_code == 500
    assert "ANTHROPIC_API_KEY" in resp.json()["detail"]


def test_generate_query_rate_limit_returns_429(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.side_effect = _api_error(
        anthropic.RateLimitError, 429
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.status_code == 429


def test_generate_query_connection_error_returns_502(
    client, sample_db, mock_anthropic
):
    db_id = _setup(client, sample_db)
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    mock_anthropic.messages.create.side_effect = anthropic.APIConnectionError(
        request=request
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.status_code == 502


def test_generate_query_api_status_error_returns_502(
    client, sample_db, mock_anthropic
):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.side_effect = _api_error(
        anthropic.APIStatusError, 500
    )

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.status_code == 502


def test_generate_query_empty_response_returns_502(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("   \n  ")

    resp = client.post(
        "/api/ai/generate-query",
        json={"db_id": db_id, "prompt": "test"},
    )
    assert resp.status_code == 502


def test_get_client_lazy_init(monkeypatch):
    """get_client() should construct the client only once, on first call."""
    monkeypatch.setattr(ai_module, "_client", None)
    sentinel = object()
    monkeypatch.setattr(anthropic, "Anthropic", lambda: sentinel)

    first = ai_module.get_client()
    second = ai_module.get_client()
    assert first is sentinel
    assert second is sentinel


# ── analyze-results tests ──────────────────────────────────────────────────


_SAMPLE_COLUMNS = ["id", "name", "revenue"]
_SAMPLE_ROWS = [
    {"id": 1, "name": "Alice", "revenue": 1000},
    {"id": 2, "name": "Bob", "revenue": 2500},
]
_SAMPLE_SQL = "SELECT id, name, revenue FROM sales"


def _insight_payload(db_id):
    return {
        "db_id": db_id,
        "sql": _SAMPLE_SQL,
        "columns": _SAMPLE_COLUMNS,
        "rows": _SAMPLE_ROWS,
    }


def test_analyze_results_success(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response(
        "**Summary**\nTwo rows of sales data.\n**Key Findings**\n- Bob leads with 2500."
    )

    resp = client.post("/api/ai/analyze-results", json=_insight_payload(db_id))
    assert resp.status_code == 200
    data = resp.json()
    assert "insight" in data
    assert "Bob" in data["insight"]


def test_analyze_results_passes_sql_and_data_to_llm(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("Some insight")

    client.post("/api/ai/analyze-results", json=_insight_payload(db_id))

    call_kwargs = mock_anthropic.messages.create.call_args.kwargs
    user_content = call_kwargs["messages"][0]["content"]
    assert _SAMPLE_SQL in user_content
    assert "Alice" in user_content
    assert "revenue" in user_content
    assert "authors" in user_content  # schema is included


def test_analyze_results_uses_insight_system_prompt(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("insight")

    client.post("/api/ai/analyze-results", json=_insight_payload(db_id))

    call_kwargs = mock_anthropic.messages.create.call_args.kwargs
    assert call_kwargs["system"] == ai_module.INSIGHT_SYSTEM_PROMPT
    assert call_kwargs["model"] == ai_module.MODEL


def test_analyze_results_caps_rows_in_prompt(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("insight")

    many_rows = [{"id": i, "val": i * 10} for i in range(100)]
    resp = client.post(
        "/api/ai/analyze-results",
        json={"db_id": db_id, "sql": "SELECT * FROM t", "columns": ["id", "val"], "rows": many_rows},
    )
    assert resp.status_code == 200

    user_content = mock_anthropic.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "more rows not shown" in user_content


def test_analyze_results_unknown_db_returns_404(client, mock_anthropic):
    resp = client.post(
        "/api/ai/analyze-results",
        json={"db_id": "nonexistent_xyz", "sql": "SELECT 1", "columns": [], "rows": []},
    )
    assert resp.status_code == 404
    mock_anthropic.messages.create.assert_not_called()


def test_analyze_results_empty_response_returns_502(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.return_value = _make_response("   ")

    resp = client.post("/api/ai/analyze-results", json=_insight_payload(db_id))
    assert resp.status_code == 502


def test_analyze_results_auth_error_returns_500(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.side_effect = _api_error(anthropic.AuthenticationError, 401)

    resp = client.post("/api/ai/analyze-results", json=_insight_payload(db_id))
    assert resp.status_code == 500
    assert "ANTHROPIC_API_KEY" in resp.json()["detail"]


def test_analyze_results_rate_limit_returns_429(client, sample_db, mock_anthropic):
    db_id = _setup(client, sample_db)
    mock_anthropic.messages.create.side_effect = _api_error(anthropic.RateLimitError, 429)

    resp = client.post("/api/ai/analyze-results", json=_insight_payload(db_id))
    assert resp.status_code == 429


def test_format_rows_as_text_includes_truncation_note():
    rows = [{"a": i} for i in range(50)]
    result = ai_module._format_rows_as_text(["a"], rows, max_rows=5)
    assert "more rows not shown" in result
    lines = result.split("\n")
    data_lines = [l for l in lines if l and not l.startswith("-") and l != "a"]
    assert len(data_lines) == 6  # 5 data rows + truncation note


def test_format_rows_as_text_no_truncation_when_within_limit():
    rows = [{"x": 1}, {"x": 2}]
    result = ai_module._format_rows_as_text(["x"], rows, max_rows=10)
    assert "not shown" not in result
