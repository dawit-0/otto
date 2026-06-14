"""Tests for inline row editing: insert, update, and delete on table data."""

import sqlite3

import pytest


def _connect(client, db_path):
    resp = client.post("/api/databases/connect", json={"path": db_path})
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture()
def editable_db(tmp_path):
    """A SQLite database with a table that has a primary key and one that doesn't."""
    db_path = str(tmp_path / "editable.db")
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE authors (
            id    INTEGER PRIMARY KEY,
            name  TEXT NOT NULL,
            email TEXT
        );
        CREATE TABLE tags (
            label TEXT,
            color TEXT
        );
        INSERT INTO authors VALUES (1, 'Alice', 'alice@example.com');
        INSERT INTO authors VALUES (2, 'Bob', 'bob@example.com');
        INSERT INTO tags VALUES ('fiction', 'blue');
    """)
    conn.close()
    return db_path


# ── Insert ──


def test_insert_row(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200
    row = resp.json()["row"]
    assert row["name"] == "Carol"
    assert row["email"] == "carol@example.com"
    assert row["id"] == 3  # autoincrement

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3


def test_insert_row_unknown_column(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400
    assert "unknown column" in resp.json()["detail"].lower()


# ── Update ──


def test_update_row(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"name": "Alice Updated"}},
    )
    assert resp.status_code == 200
    row = resp.json()["row"]
    assert row["name"] == "Alice Updated"
    assert row["id"] == 1

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    updated = next(r for r in data["rows"] if r["id"] == 1)
    assert updated["name"] == "Alice Updated"


def test_update_row_to_null(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"email": None}},
    )
    assert resp.status_code == 200
    assert resp.json()["row"]["email"] is None


def test_update_row_not_found(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 999}, "values": {"name": "Nobody"}},
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_update_row_no_primary_key(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/tags/rows",
        json={"pk": {"label": "fiction"}, "values": {"color": "red"}},
    )
    assert resp.status_code == 400
    assert "primary key" in resp.json()["detail"].lower()


def test_update_row_pk_mismatch(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"name": "Alice"}, "values": {"email": "x@example.com"}},
    )
    assert resp.status_code == 400
    assert "primary key" in resp.json()["detail"].lower()


def test_update_row_unknown_column(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.patch(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 1}, "values": {"nope": "x"}},
    )
    assert resp.status_code == 400
    assert "unknown column" in resp.json()["detail"].lower()


# ── Delete ──


def test_delete_row(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 2}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 1
    assert all(r["id"] != 2 for r in data["rows"])


def test_delete_row_not_found(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"pk": {"id": 999}},
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_delete_row_no_primary_key(client, editable_db):
    info = _connect(client, editable_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/tags/rows",
        json={"pk": {"label": "fiction"}},
    )
    assert resp.status_code == 400
    assert "primary key" in resp.json()["detail"].lower()
