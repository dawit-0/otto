"""Tests for inline row insert / update / delete endpoints."""


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()["id"]


def _rows(client, db_id, table):
    resp = client.get(f"/api/databases/{db_id}/tables/{table}/data")
    assert resp.status_code == 200
    return resp.json()["rows"]


# ── INSERT ───────────────────────────────────────────────────────────────────


def test_insert_row(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"values": {"id": 99, "name": "Charlie", "email": "charlie@example.com"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    rows = _rows(client, db_id, "authors")
    assert any(r["name"] == "Charlie" for r in rows)


def test_insert_row_invalid_column(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"values": {"nonexistent_col": "value"}},
    )
    assert resp.status_code == 400


def test_insert_row_empty_values(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"values": {}},
    )
    assert resp.status_code == 400


def test_insert_row_unknown_table(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{db_id}/tables/no_such_table/rows",
        json={"values": {"name": "X"}},
    )
    assert resp.status_code == 400


# ── UPDATE ───────────────────────────────────────────────────────────────────


def test_update_row(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"pk_values": {"id": 1}, "updates": {"name": "Alice Updated"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    rows = _rows(client, db_id, "authors")
    alice = next(r for r in rows if r["id"] == 1)
    assert alice["name"] == "Alice Updated"


def test_update_row_null_value(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"pk_values": {"id": 2}, "updates": {"email": None}},
    )
    assert resp.status_code == 200

    rows = _rows(client, db_id, "authors")
    bob = next(r for r in rows if r["id"] == 2)
    assert bob["email"] is None


def test_update_row_invalid_column(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"pk_values": {"id": 1}, "updates": {"fake_col": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_missing_pk(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"pk_values": {}, "updates": {"name": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_no_updates(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{db_id}/tables/authors/rows",
        json={"pk_values": {"id": 1}, "updates": {}},
    )
    assert resp.status_code == 400


# ── DELETE ───────────────────────────────────────────────────────────────────


def test_delete_row(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{db_id}/tables/books/rows",
        json={"pk_values": {"id": 3}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    rows = _rows(client, db_id, "books")
    assert not any(r["id"] == 3 for r in rows)
    assert len(rows) == 2


def test_delete_row_invalid_column(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{db_id}/tables/books/rows",
        json={"pk_values": {"no_col": 1}},
    )
    assert resp.status_code == 400


def test_delete_row_missing_pk_values(client, sample_db):
    db_id = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{db_id}/tables/books/rows",
        json={"pk_values": {}},
    )
    assert resp.status_code == 400
