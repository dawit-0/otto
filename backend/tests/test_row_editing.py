"""Tests for the editable data grid: row update / delete / insert endpoints."""

import sqlite3


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


# ── Update ──


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"title": "Alpha Revised", "pages": 999}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    conn = sqlite3.connect(sample_db)
    row = conn.execute("SELECT title, pages FROM books WHERE id = 1").fetchone()
    conn.close()
    assert row == ("Alpha Revised", 999)


def test_update_row_logs_history(client, sample_db):
    info = _connect(client, sample_db)
    client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"title": "Alpha Revised"}},
    )
    history = client.get(f"/api/history?db_id={info['id']}").json()
    assert any(h["status"] == "success" and "UPDATE" in h["sql"] for h in history)


def test_update_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 9999}, "updates": {"title": "Nope"}},
    )
    assert resp.status_code == 404


def test_update_row_no_primary_key(client, tmp_path):
    db_path = str(tmp_path / "no_pk.db")
    conn = sqlite3.connect(db_path)
    conn.executescript("CREATE TABLE logs (msg TEXT); INSERT INTO logs VALUES ('hi');")
    conn.close()
    info = _connect(client, db_path)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/logs/rows",
        json={"pk": {"msg": "hi"}, "updates": {"msg": "bye"}},
    )
    assert resp.status_code == 400
    assert "primary key" in resp.json()["detail"].lower()


def test_update_row_cannot_edit_pk_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"id": 42}},
    )
    assert resp.status_code == 400
    assert "primary key" in resp.json()["detail"].lower()


def test_update_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_wrong_pk_columns(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"title": "Alpha"}, "updates": {"pages": 1}},
    )
    assert resp.status_code == 400


# ── Delete ──


def test_delete_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 2}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    conn = sqlite3.connect(sample_db)
    count = conn.execute("SELECT COUNT(*) FROM books WHERE id = 2").fetchone()[0]
    conn.close()
    assert count == 0


def test_delete_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 9999}},
    )
    assert resp.status_code == 404


def test_delete_row_no_primary_key(client, tmp_path):
    db_path = str(tmp_path / "no_pk.db")
    conn = sqlite3.connect(db_path)
    conn.executescript("CREATE TABLE logs (msg TEXT); INSERT INTO logs VALUES ('hi');")
    conn.close()
    info = _connect(client, db_path)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/logs/rows",
        json={"pk": {"msg": "hi"}},
    )
    assert resp.status_code == 400


# ── Insert ──


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 3, "name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    conn = sqlite3.connect(sample_db)
    row = conn.execute("SELECT name, email FROM authors WHERE id = 3").fetchone()
    conn.close()
    assert row == ("Carol", "carol@example.com")


def test_insert_row_with_autoincrement_pk_omitted(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"values": {"title": "Delta", "author_id": 1}},
    )
    assert resp.status_code == 200

    conn = sqlite3.connect(sample_db)
    row = conn.execute("SELECT title, author_id FROM books WHERE title = 'Delta'").fetchone()
    conn.close()
    assert row == ("Delta", 1)


def test_insert_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_insert_row_empty_values(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {}},
    )
    assert resp.status_code == 400


def test_insert_row_constraint_violation(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 1, "name": "Duplicate"}},
    )
    assert resp.status_code == 400
