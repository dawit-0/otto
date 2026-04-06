"""Tests for query history CRUD operations."""


def _setup_with_history(client, sample_db):
    """Connect a DB and run a couple of queries to populate history."""
    db_id = client.post("/api/databases/connect", json={"path": sample_db}).json()["id"]
    client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM authors"})
    client.post("/api/query", json={"db_id": db_id, "sql": "SELECT * FROM books"})
    return db_id


def test_get_history(client, sample_db):
    db_id = _setup_with_history(client, sample_db)
    resp = client.get(f"/api/history?db_id={db_id}")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 2


def test_history_ordering(client, sample_db):
    db_id = _setup_with_history(client, sample_db)
    entries = client.get(f"/api/history?db_id={db_id}").json()
    # Most recent first
    assert entries[0]["sql"] == "SELECT * FROM books"
    assert entries[1]["sql"] == "SELECT * FROM authors"


def test_history_pagination(client, sample_db):
    db_id = _setup_with_history(client, sample_db)
    page1 = client.get(f"/api/history?db_id={db_id}&limit=1&offset=0").json()
    page2 = client.get(f"/api/history?db_id={db_id}&limit=1&offset=1").json()
    assert len(page1) == 1
    assert len(page2) == 1
    assert page1[0]["id"] != page2[0]["id"]


def test_delete_single_entry(client, sample_db):
    db_id = _setup_with_history(client, sample_db)
    entries = client.get(f"/api/history?db_id={db_id}").json()
    entry_id = entries[0]["id"]

    resp = client.delete(f"/api/history/{entry_id}")
    assert resp.json()["deleted"] == 1

    remaining = client.get(f"/api/history?db_id={db_id}").json()
    assert len(remaining) == 1


def test_delete_nonexistent_entry(client):
    resp = client.delete("/api/history/99999")
    assert resp.json()["deleted"] == 0


def test_clear_history(client, sample_db):
    db_id = _setup_with_history(client, sample_db)
    resp = client.delete(f"/api/history?db_id={db_id}")
    assert resp.json()["deleted"] == 2

    remaining = client.get(f"/api/history?db_id={db_id}").json()
    assert len(remaining) == 0
