"""Tests for inline row editing: update, insert, delete via the data API."""


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


# ── Update ──


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "changes": {"pages": 999}},
    )
    assert resp.status_code == 200
    assert resp.json()["affected_rows"] == 1

    data = client.get(f"/api/databases/{info['id']}/tables/books/data?filters=" +
                       '[{"col":"id","op":"equals","val":"1"}]').json()
    assert data["rows"][0]["pages"] == 999


def test_update_row_no_primary_key(client, sample_db):
    # The "books" table has a PK, but let's hit a view-like nonexistent table to confirm 404 path
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/nope/rows",
        json={"pk": {"id": 1}, "changes": {"pages": 1}},
    )
    assert resp.status_code == 404


def test_update_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "changes": {"nope": 1}},
    )
    assert resp.status_code == 400


def test_update_row_cannot_modify_primary_key(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "changes": {"id": 2}},
    )
    assert resp.status_code == 400


def test_update_row_logs_history(client, sample_db):
    info = _connect(client, sample_db)
    client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 2}, "changes": {"pages": 111}},
    )
    history = client.get(f"/api/history?db_id={info['id']}").json()
    assert any("UPDATE books" in h["sql"] for h in history)


# ── Insert ──


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 3, "name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200
    row = resp.json()["row"]
    assert row["name"] == "Carol"

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3


def test_insert_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": 1}},
    )
    assert resp.status_code == 400


def test_insert_row_violates_constraint(client, sample_db):
    info = _connect(client, sample_db)
    # name is NOT NULL
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 5, "email": "noname@example.com"}},
    )
    assert resp.status_code == 400


# ── Delete ──


def test_delete_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 3}},
    )
    assert resp.status_code == 200
    assert resp.json()["affected_rows"] == 1

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    assert data["total"] == 2


def test_delete_row_missing_pk(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {}},
    )
    assert resp.status_code == 400


def test_delete_row_unknown_db(client):
    resp = client.request(
        "DELETE",
        "/api/databases/nonexistent_12345678/tables/books/rows",
        json={"pk": {"id": 1}},
    )
    assert resp.status_code == 404
