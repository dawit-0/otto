"""Tests for SQL query execution and automatic history recording."""


def _setup(client, sample_db):
    """Connect sample DB and return its id."""
    return client.post("/api/databases/connect", json={"path": sample_db}).json()["id"]


def test_select_query(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM authors"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 2
    assert "name" in data["columns"]
    assert len(data["rows"]) == 2


def test_select_with_where(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id,
        "sql": "SELECT title FROM books WHERE author_id = 1",
    })
    data = resp.json()
    assert data["row_count"] == 2
    titles = [r["title"] for r in data["rows"]]
    assert "Alpha" in titles
    assert "Beta" in titles


def test_insert_query(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id,
        "sql": "INSERT INTO authors VALUES (3, 'Carol', 'carol@example.com')",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 1
    assert "affected" in data["message"]


def test_invalid_sql(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={"db_id": db_id, "sql": "SELEKT * FROM nope"})
    assert resp.status_code == 400


def test_query_unknown_db(client):
    resp = client.post("/api/query", json={"db_id": "nonexistent_12345678", "sql": "SELECT 1"})
    assert resp.status_code == 404


def test_query_records_history(client, sample_db):
    db_id = _setup(client, sample_db)
    client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM authors"})

    history = client.get(f"/api/history?db_id={db_id}").json()
    assert len(history) >= 1
    assert history[0]["sql"] == "SELECT * FROM authors"
    assert history[0]["status"] == "success"


def test_failed_query_records_history(client, sample_db):
    db_id = _setup(client, sample_db)
    client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM nope"})

    history = client.get(f"/api/history?db_id={db_id}").json()
    assert len(history) >= 1
    assert history[0]["status"] == "error"
    assert history[0]["error_message"] is not None


# ── EXPLAIN ANALYZE (query plan) ──

def test_explain_query_sqlite(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query/explain", json={
        "db_id": db_id,
        "sql": "SELECT * FROM books WHERE author_id = 1",
    })
    assert resp.status_code == 200
    data = resp.json()
    # SQLite's equivalent is EXPLAIN QUERY PLAN
    assert data["command"] == "EXPLAIN QUERY PLAN"
    assert data["format"] == "tree"
    assert isinstance(data["rows"], list) and len(data["rows"]) >= 1
    # The plan text should mention the scanned table
    assert "books" in data["text"].lower()


def test_explain_invalid_sql(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query/explain", json={
        "db_id": db_id,
        "sql": "SELEKT * FROM nope",
    })
    assert resp.status_code == 400


def test_explain_unknown_db(client):
    resp = client.post("/api/query/explain", json={
        "db_id": "nonexistent_12345678",
        "sql": "SELECT 1",
    })
    assert resp.status_code == 404


# ── Destructive statement confirmation ──

def test_delete_without_confirmation_is_previewed_not_executed(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id, "sql": "DELETE FROM books WHERE author_id = 1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["requires_confirmation"] is True
    assert data["statement_type"] == "DELETE"
    assert data["affected_rows"] == 2
    assert data["has_where"] is True

    remaining = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM books",
    }).json()["rows"][0]["c"]
    assert remaining == 3  # nothing was actually deleted


def test_delete_without_where_flags_has_where_false(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={"db_id": db_id, "sql": "DELETE FROM books"})
    data = resp.json()
    assert data["requires_confirmation"] is True
    assert data["affected_rows"] == 3
    assert data["has_where"] is False


def test_delete_confirmed_actually_executes(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id, "sql": "DELETE FROM books WHERE author_id = 1", "confirmed": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "requires_confirmation" not in data
    assert data["row_count"] == 2

    remaining = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM books",
    }).json()["rows"][0]["c"]
    assert remaining == 1


def test_update_without_confirmation_is_previewed_not_executed(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id, "sql": "UPDATE books SET pages = 0",
    })
    data = resp.json()
    assert data["requires_confirmation"] is True
    assert data["statement_type"] == "UPDATE"
    assert data["affected_rows"] == 3

    total_pages = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT SUM(pages) AS s FROM books",
    }).json()["rows"][0]["s"]
    assert total_pages == 650  # unchanged


def test_drop_table_requires_confirmation_and_does_not_run(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={"db_id": db_id, "sql": "DROP TABLE books"})
    data = resp.json()
    assert data["requires_confirmation"] is True
    assert data["statement_type"] == "DROP"
    assert data["affected_rows"] is None

    # The table must still exist.
    resp2 = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM books",
    })
    assert resp2.status_code == 200


def test_drop_table_confirmed_executes(client, sample_db):
    db_id = _setup(client, sample_db)
    resp = client.post("/api/query", json={
        "db_id": db_id, "sql": "DROP TABLE books", "confirmed": True,
    })
    assert resp.status_code == 200

    resp2 = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM books",
    })
    assert resp2.status_code == 400  # table is gone


def test_select_and_insert_never_require_confirmation(client, sample_db):
    db_id = _setup(client, sample_db)
    select_resp = client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM authors"})
    assert "requires_confirmation" not in select_resp.json()

    insert_resp = client.post("/api/query", json={
        "db_id": db_id,
        "sql": "INSERT INTO authors VALUES (3, 'Carol', 'carol@example.com')",
    })
    assert "requires_confirmation" not in insert_resp.json()


def test_unconfirmed_destructive_query_not_recorded_in_history(client, sample_db):
    db_id = _setup(client, sample_db)
    client.post("/api/query", json={"db_id": db_id, "sql": "DELETE FROM books"})

    history = client.get(f"/api/history?db_id={db_id}").json()
    assert all(entry["sql"] != "DELETE FROM books" for entry in history)


def test_explain_does_not_run_dml(client, sample_db):
    """EXPLAIN QUERY PLAN must not actually execute the statement."""
    db_id = _setup(client, sample_db)
    before = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM authors",
    }).json()["rows"][0]["c"]

    client.post("/api/query/explain", json={
        "db_id": db_id,
        "sql": "INSERT INTO authors VALUES (99, 'Mallory', 'm@example.com')",
    })

    after = client.post("/api/query", json={
        "db_id": db_id, "sql": "SELECT COUNT(*) AS c FROM authors",
    }).json()["rows"][0]["c"]
    assert before == after
