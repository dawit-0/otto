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
