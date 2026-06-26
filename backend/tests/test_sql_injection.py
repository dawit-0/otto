"""End-to-end tests for SQL-injection hardening of schema/data endpoints.

The table-data endpoint interpolates ``table_name`` from the URL path into a
SQL query (SQLite cannot bind identifiers). These tests verify that:

  * Unknown / malicious table names are rejected with 404 before any SQL is
    built against the user database.
  * Tables whose names happen to contain SQL-significant characters are still
    readable when they genuinely exist — quoting must be correct, not lossy.
  * Injection attempts cannot destroy or mutate the target database.
"""

import sqlite3

import pytest


@pytest.fixture()
def weird_db(tmp_path):
    """A database with a legitimately awkward table name containing a quote."""
    path = str(tmp_path / "weird.db")
    conn = sqlite3.connect(path)
    conn.executescript(
        '''
        CREATE TABLE "we""ird" (id INTEGER PRIMARY KEY, v TEXT);
        INSERT INTO "we""ird" VALUES (1, 'hello'), (2, 'world');
        '''
    )
    conn.close()
    return path


def _connect(client, path):
    resp = client.post("/api/databases/connect", json={"path": path})
    assert resp.status_code == 200
    return resp.json()


# ── Injection attempts are rejected ──


@pytest.mark.parametrize(
    "payload",
    [
        'books"; DROP TABLE authors; --',
        'books" UNION SELECT sql FROM sqlite_master --',
        "books'; DELETE FROM books; --",
        "nope",  # simply doesn't exist
    ],
)
def test_table_data_rejects_injection_payloads(client, sample_db, payload):
    info = _connect(client, sample_db)
    # URL-path-encode the payload segment via httpx's normal handling.
    resp = client.get(
        f"/api/databases/{info['id']}/tables/{payload}/data"
    )
    assert resp.status_code == 404, resp.text
    detail = resp.json()["detail"].lower()
    assert "unknown table" in detail


def test_injection_does_not_drop_real_tables(client, sample_db):
    """After an attempted DROP via the URL, the schema must be intact."""
    info = _connect(client, sample_db)

    client.get(
        f"/api/databases/{info['id']}/tables/books\"; DROP TABLE authors; --/data"
    )

    # Both tables should still be present.
    schema = client.get(f"/api/databases/{info['id']}/schema").json()
    names = {t["name"] for t in schema["tables"]}
    assert {"authors", "books"}.issubset(names)

    # And the real rows are still readable.
    rows = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert rows["total"] == 2


def test_injection_does_not_leak_via_union(client, sample_db):
    """A UNION-based attempt must fail at the validation layer, not execute."""
    info = _connect(client, sample_db)
    resp = client.get(
        f"/api/databases/{info['id']}/tables/books\" UNION SELECT sql, 1, 1, 1 FROM sqlite_master --/data"
    )
    assert resp.status_code == 404
    # No columns/rows leaked.
    body = resp.json()
    assert "columns" not in body
    assert "rows" not in body


# ── Legitimate tables with SQL-significant characters still work ──


def test_table_with_embedded_quote_is_readable(client, weird_db):
    """A real table named ``we"ird`` (quote in the name) must be queryable."""
    info = _connect(client, weird_db)

    schema = client.get(f"/api/databases/{info['id']}/schema").json()
    names = [t["name"] for t in schema["tables"]]
    assert 'we"ird' in names

    # The HTTP client handles URL-escaping of the " character.
    resp = client.get(f"/api/databases/{info['id']}/tables/we\"ird/data")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    assert {"id", "v"} == set(data["columns"])


# ── Row mutation endpoints reject injection attempts ──


@pytest.mark.parametrize(
    "payload",
    [
        'books"; DROP TABLE authors; --',
        "nope",
    ],
)
def test_row_mutation_rejects_unknown_table(client, sample_db, payload):
    info = _connect(client, sample_db)
    resp = client.post(
        f"/api/databases/{info['id']}/tables/{payload}/rows",
        json={"values": {"id": 1}},
    )
    assert resp.status_code == 404, resp.text
    assert "unknown table" in resp.json()["detail"].lower()


def test_row_mutation_rejects_malicious_column_name(client, sample_db):
    """A column name crafted to break out of the quoted identifier must be
    rejected by the unknown-column check before any SQL is built."""
    info = _connect(client, sample_db)
    payload = 'title"; DROP TABLE authors; --'
    resp = client.put(
        f"/api/databases/{info['id']}/tables/books/rows",
        json={"pk": {"id": 1}, "values": {payload: "x"}},
    )
    assert resp.status_code == 400, resp.text
    assert "unknown column" in resp.json()["detail"].lower()

    # The real tables must still be intact.
    schema = client.get(f"/api/databases/{info['id']}/schema").json()
    names = {t["name"] for t in schema["tables"]}
    assert {"authors", "books"}.issubset(names)


def test_insert_row_rejects_injection_in_table_name_and_leaves_data_intact(client, sample_db):
    info = _connect(client, sample_db)
    client.post(
        f"/api/databases/{info['id']}/tables/books\"; DROP TABLE authors; --/rows",
        json={"values": {"id": 99}},
    )
    rows = client.get(f"/api/databases/{info['id']}/tables/authors/data").json()
    assert rows["total"] == 2


# ── Schema endpoint handles awkward names without failing ──


def test_schema_endpoint_handles_quoted_table_name(client, weird_db):
    info = _connect(client, weird_db)
    resp = client.get(f"/api/databases/{info['id']}/schema")
    assert resp.status_code == 200
    tables = {t["name"]: t for t in resp.json()["tables"]}
    assert 'we"ird' in tables
    assert tables['we"ird']["row_count"] == 2
