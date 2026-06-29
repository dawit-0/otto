"""Tests for inline row editing: insert, update, and delete via the data browser."""


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


# ── Table data exposes primary key / editability ──


def test_table_data_reports_primary_key_and_editable(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.get(f"/api/databases/{info['id']}/tables/books/data")
    data = resp.json()
    assert data["primary_key"] == ["id"]
    assert data["editable"] is True


# ── Update ──


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"title": "Alpha Revised", "pages": 999}},
    )
    assert resp.status_code == 200, resp.text

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    row = next(r for r in data["rows"] if r["id"] == 1)
    assert row["title"] == "Alpha Revised"
    assert row["pages"] == 999


def test_update_row_unknown_column_rejected(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"nope": "x"}},
    )
    assert resp.status_code == 400
    assert "unknown column" in resp.json()["detail"].lower()


def test_update_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 9999}, "updates": {"title": "Nope"}},
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_update_row_empty_updates_rejected(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {}},
    )
    assert resp.status_code == 400


def test_update_row_unknown_table(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/nope/rows",
        json={"pk": {"id": 1}, "updates": {"x": 1}},
    )
    assert resp.status_code == 404


def test_update_row_injection_attempt_in_column_name(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {'title"; DROP TABLE authors; --': "x"}},
    )
    assert resp.status_code == 400
    # Table must still exist.
    schema = client.get(f"/api/databases/{info['id']}/schema").json()
    assert "authors" in {t["name"] for t in schema["tables"]}


# ── Insert ──


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"values": {"title": "Delta", "author_id": 2, "pages": 50}},
    )
    assert resp.status_code == 200, resp.text
    row = resp.json()["row"]
    assert row["title"] == "Delta"
    assert row["author_id"] == 2
    assert row["pages"] == 50
    assert "id" in row

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    assert data["total"] == 4


def test_insert_row_unknown_column_rejected(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_insert_row_missing_required_column_fails(client, sample_db):
    info = _connect(client, sample_db)
    # `title` is NOT NULL with no default, and `author_id` is a required FK.
    resp = client.post(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"values": {"pages": 10}},
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
    assert resp.status_code == 200, resp.text

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    assert data["total"] == 2
    assert all(r["id"] != 3 for r in data["rows"])


def test_delete_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 9999}},
    )
    assert resp.status_code == 400


def test_delete_row_empty_pk_rejected(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {}},
    )
    assert resp.status_code == 400


# ── Tables without a declared PRIMARY KEY still work via rowid ──


def test_rowid_fallback_for_table_without_explicit_pk(client, tmp_path):
    import sqlite3

    path = str(tmp_path / "norowidpk.db")
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hello'), ('world');"
    )
    conn.close()

    resp = client.post("/api/databases/connect", json={"path": path})
    info = resp.json()

    data = client.get(f"/api/databases/{info['id']}/tables/notes/data").json()
    assert data["primary_key"] == ["rowid"]
    assert data["editable"] is True
    assert "rowid" not in data["columns"]
    target = next(r for r in data["rows"] if r["body"] == "hello")
    assert "__rowid" in target

    upd = client.patch(
        f"/api/databases/{info['id']}/tables/notes/rows",
        json={"pk": {"rowid": target["__rowid"]}, "updates": {"body": "updated"}},
    )
    assert upd.status_code == 200, upd.text

    data2 = client.get(f"/api/databases/{info['id']}/tables/notes/data").json()
    assert any(r["body"] == "updated" for r in data2["rows"])
