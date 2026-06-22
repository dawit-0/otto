"""Tests for inline row insert/update/delete on the data browser."""


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 3, "name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200
    row = resp.json()
    assert row["id"] == 3
    assert row["name"] == "Carol"

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3


def test_insert_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"name": "Alicia"}},
    )
    assert resp.status_code == 200
    row = resp.json()
    assert row["name"] == "Alicia"
    assert row["email"] == "alice@example.com"


def test_update_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 999}, "values": {"name": "Nobody"}},
    )
    assert resp.status_code == 400


def test_update_row_requires_pk(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {}, "values": {"name": "Nobody"}},
    )
    assert resp.status_code == 400


def test_delete_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 2}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 1


def test_delete_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 999}},
    )
    assert resp.status_code == 400


def test_row_edit_requires_table_to_exist(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/ghosts/rows",
        json={"values": {"id": 1}},
    )
    assert resp.status_code == 400
