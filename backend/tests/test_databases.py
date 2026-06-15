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


# ── Column Profile ──


def test_get_table_profile_basic(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/profile")
    assert resp.status_code == 200
    data = resp.json()
    assert data["table"] == "books"
    assert data["row_count"] == 3
    col_map = {c["name"]: c for c in data["columns"]}
    assert set(col_map) == {"id", "title", "author_id", "pages"}


def test_get_table_profile_numeric_stats(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/profile")
    data = resp.json()
    col_map = {c["name"]: c for c in data["columns"]}

    # "pages" is an INTEGER column — should have numeric stats
    pages = col_map["pages"]
    assert pages["is_numeric"] is True
    assert pages["min"] is not None
    assert pages["max"] is not None
    assert pages["avg"] is not None

    # "title" is TEXT — should not have numeric stats
    title = col_map["title"]
    assert title["is_numeric"] is False
    assert title["avg"] is None


def test_get_table_profile_null_and_distinct(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/profile")
    data = resp.json()
    col_map = {c["name"]: c for c in data["columns"]}

    # id should have 0 nulls and distinct_count == row_count
    id_col = col_map["id"]
    assert id_col["null_count"] == 0
    assert id_col["null_pct"] == 0.0
    assert id_col["distinct_count"] == 3


def test_get_table_profile_top_values(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/profile")
    data = resp.json()
    col_map = {c["name"]: c for c in data["columns"]}

    # author_id has low cardinality (2 authors) — top_values should be populated
    author_id = col_map["author_id"]
    assert len(author_id["top_values"]) > 0
    first = author_id["top_values"][0]
    assert "value" in first
    assert "count" in first
    assert first["count"] >= 1


def test_get_table_profile_nonexistent_table(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/nope/profile")
    assert resp.status_code in (400, 404)


def test_get_table_profile_unknown_db(client):
    resp = client.get("/api/databases/nonexistent_12345678/tables/books/profile")
    assert resp.status_code == 404


# ── Upload ──


def test_upload_database(client, sample_db):
    with open(sample_db, "rb") as f:
        resp = client.post("/api/databases/upload", files={"file": ("test.db", f)})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test"
    assert "id" in data


# ── Row CRUD ──


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"name": "Alicia"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    updated = next(r for r in data["rows"] if r["id"] == 1)
    assert updated["name"] == "Alicia"


def test_update_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 999}, "values": {"name": "Nobody"}},
    )
    assert resp.status_code == 404


def test_update_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_missing_pk(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {}, "values": {"name": "x"}},
    )
    assert resp.status_code == 400


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 3, "name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3
    assert any(r["name"] == "Carol" for r in data["rows"])


def test_insert_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_insert_row_constraint_violation(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 1, "name": "Dup", "email": "dup@example.com"}},
    )
    assert resp.status_code == 400


def test_delete_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 3}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    assert data["total"] == 2
    assert not any(r["id"] == 3 for r in data["rows"])


def test_delete_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 999}},
    )
    assert resp.status_code == 404


def test_row_crud_unknown_table(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/nope/rows",
        json={"values": {"id": 1}},
    )
    assert resp.status_code == 404
