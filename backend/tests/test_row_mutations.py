"""Tests for inline row editing: update / insert / delete on connected tables."""

import sqlite3

import pytest


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    assert resp.status_code == 200
    return resp.json()


# ── Update ──


def test_update_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"title": "Alpha Revised", "pages": 999}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "affected_rows": 1}

    data = client.get(
        f"/api/databases/{info['id']}/tables/books/data?filters="
        '[{"col":"id","op":"equals","val":"1"}]'
    ).json()
    row = data["rows"][0]
    assert row["title"] == "Alpha Revised"
    assert row["pages"] == 999


def test_update_row_logs_history(client, sample_db):
    info = _connect(client, sample_db)
    client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 2}, "updates": {"title": "Beta Revised"}},
    )
    history = client.get(f"/api/history?db_id={info['id']}").json()
    assert any(h["status"] == "success" and "UPDATE" in h["sql"] for h in history)


def test_update_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 999}, "updates": {"title": "Nope"}},
    )
    assert resp.status_code == 404


def test_update_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"not_a_column": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_requires_full_primary_key(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {}, "updates": {"title": "x"}},
    )
    assert resp.status_code == 400


def test_update_row_no_primary_key_table_rejected(client, tmp_path):
    path = str(tmp_path / "nopk.db")
    conn = sqlite3.connect(path)
    conn.executescript("CREATE TABLE logs (msg TEXT); INSERT INTO logs VALUES ('hi');")
    conn.close()
    info = _connect(client, path)
    resp = client.put(
        f"/api/databases/{info['id']}/tables/logs/rows",
        json={"pk": {"msg": "hi"}, "updates": {"msg": "bye"}},
    )
    assert resp.status_code == 400
    assert "no primary key" in resp.json()["detail"].lower()


def test_update_row_injection_in_value_is_safe(client, sample_db):
    """A malicious value must be stored as data, never executed as SQL."""
    info = _connect(client, sample_db)
    payload = "x'); DROP TABLE authors; --"
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "updates": {"title": payload}},
    )
    assert resp.status_code == 200

    schema = client.get(f"/api/databases/{info['id']}/schema").json()
    names = {t["name"] for t in schema["tables"]}
    assert "authors" in names

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    row = next(r for r in data["rows"] if r["id"] == 1)
    assert row["title"] == payload


# ── Insert ──


def test_insert_row(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 3, "name": "Carol", "email": "carol@example.com"}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["affected_rows"] == 1

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3
    assert any(r["name"] == "Carol" for r in data["rows"])


def test_insert_row_omits_autoincrement_column(client, sample_db):
    """Leaving the primary key out lets SQLite assign it automatically."""
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"name": "Dave", "email": "dave@example.com"}},
    )
    assert resp.status_code == 200, resp.text

    data = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert data["total"] == 3
    assert any(r["name"] == "Dave" for r in data["rows"])


def test_insert_row_empty_values_rejected(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {}},
    )
    assert resp.status_code == 400


def test_insert_row_unknown_column(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"nope": "x"}},
    )
    assert resp.status_code == 400


def test_insert_row_violates_constraint(client, sample_db):
    """Duplicate unique email should surface as a 400, not a 500."""
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/authors/rows",
        json={"values": {"id": 5, "name": "Dup", "email": "alice@example.com"}},
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
    assert resp.json() == {"ok": True, "affected_rows": 1}

    data = client.get(f"/api/databases/{info['id']}/tables/books/data").json()
    assert data["total"] == 2
    assert all(r["id"] != 3 for r in data["rows"])


def test_delete_row_not_found(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 999}},
    )
    assert resp.status_code == 404


def test_delete_row_no_primary_key_table_rejected(client, tmp_path):
    path = str(tmp_path / "nopk2.db")
    conn = sqlite3.connect(path)
    conn.executescript("CREATE TABLE logs (msg TEXT); INSERT INTO logs VALUES ('hi');")
    conn.close()
    info = _connect(client, path)
    resp = client.request(
        "DELETE",
        f"/api/databases/{info['id']}/tables/logs/rows",
        json={"pk": {"msg": "hi"}},
    )
    assert resp.status_code == 400


def test_mutations_reject_unknown_table(client, sample_db):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/nope/rows",
        json={"values": {"x": 1}},
    )
    assert resp.status_code in (400, 404)
