"""Tests for database connection, listing, schema extraction, and table data."""


def _connect(client, sample_db):
    """Helper: connect a sample database and return the response JSON."""
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


# ── Connect / List / Disconnect ──


def test_connect_database(client, sample_db):
    data = _connect(client, sample_db)
    assert "id" in data
    assert data["name"] == "sample"
    assert data["path"] == sample_db


def test_connect_missing_file(client):
    resp = client.post("/api/databases/connect", json={"path": "/no/such/file.db"})
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_connect_invalid_db(client, tmp_path):
    # SQLite's SELECT 1 passes on any file, so connect itself succeeds.
    # The error surfaces later when actually reading tables.
    bad = tmp_path / "bad.db"
    bad.write_text("not a database")
    resp = client.post("/api/databases/connect", json={"path": str(bad)})
    assert resp.status_code == 200  # SQLite is lenient on connect


def test_list_databases(client, sample_db):
    _connect(client, sample_db)
    resp = client.get("/api/databases")
    assert resp.status_code == 200
    dbs = resp.json()
    assert any(d["name"] == "sample" for d in dbs)


def test_disconnect_database(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.delete(f"/api/databases/{info['id']}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Should no longer appear in listings
    dbs = client.get("/api/databases").json()
    assert not any(d["id"] == info["id"] for d in dbs)


def test_disconnect_unknown(client):
    resp = client.delete("/api/databases/nonexistent_12345678")
    assert resp.status_code == 404


# ── Schema ──


def test_get_schema(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/schema")
    assert resp.status_code == 200

    tables = {t["name"]: t for t in resp.json()["tables"]}
    assert "authors" in tables
    assert "books" in tables

    # Check columns
    author_cols = [c["name"] for c in tables["authors"]["columns"]]
    assert "id" in author_cols
    assert "name" in author_cols
    assert "email" in author_cols

    # Check row counts
    assert tables["authors"]["row_count"] == 2
    assert tables["books"]["row_count"] == 3

    # Check foreign keys on books
    fks = tables["books"]["foreign_keys"]
    assert len(fks) == 1
    assert fks[0]["from_column"] == "author_id"
    assert fks[0]["to_table"] == "authors"


def test_get_schema_unknown_db(client):
    resp = client.get("/api/databases/nonexistent_12345678/schema")
    assert resp.status_code == 404


# ── Table Data ──


def test_get_table_data(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/data")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert set(data["columns"]) == {"id", "title", "author_id", "pages"}
    assert len(data["rows"]) == 3


def test_get_table_data_pagination(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/data?limit=2&offset=0")
    data = resp.json()
    assert len(data["rows"]) == 2
    assert data["total"] == 3

    resp2 = client.get(f"/api/databases/{info['id']}/tables/books/data?limit=2&offset=2")
    data2 = resp2.json()
    assert len(data2["rows"]) == 1


def test_get_table_data_nonexistent_table(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/nope/data")
    assert resp.status_code == 404
    assert "unknown table" in resp.json()["detail"].lower()


# ── Upload ──


def test_upload_database(client, sample_db):
    with open(sample_db, "rb") as f:
        resp = client.post("/api/databases/upload", files={"file": ("test.db", f)})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test"
    assert "id" in data
