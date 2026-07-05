"""Tests for the CSV import endpoint."""

import io


CSV_BASIC = b"name,age,salary\nAlice,30,75000.5\nBob,25,60000.0\nCharlie,35,90000.0\n"
CSV_WITH_QUOTES = b'city,note\n"New York","Home, sweet home"\nParis,"City of ""Light"""\n'
CSV_EMPTY_VALS = b"id,label\n1,foo\n2,\n3,bar\n"


def _connect(client, sample_db):
    r = client.post("/api/databases/connect", json={"db_type": "sqlite", "path": sample_db})
    assert r.status_code == 200
    return r.json()["id"]


def _import(client, db_id, csv_bytes, table_name, col_types, if_exists="fail"):
    return client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": table_name, "column_types": str(col_types).replace("'", '"'), "if_exists": if_exists},
        files={"file": ("data.csv", io.BytesIO(csv_bytes), "text/csv")},
    )


def _col_types_json(cols):
    import json
    return json.dumps(cols)


def test_import_basic(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([
        {"name": "name", "type": "TEXT"},
        {"name": "age", "type": "INTEGER"},
        {"name": "salary", "type": "REAL"},
    ])
    res = client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "employees", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(CSV_BASIC), "text/csv")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["rows_imported"] == 3
    assert body["table"] == "employees"
    assert body["columns"] == 3


def test_import_table_appears_in_schema(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "name", "type": "TEXT"}, {"name": "age", "type": "INTEGER"}, {"name": "salary", "type": "REAL"}])
    client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "employees", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(CSV_BASIC), "text/csv")},
    )
    schema = client.get(f"/api/databases/{db_id}/schema").json()
    names = [t["name"] for t in schema["tables"]]
    assert "employees" in names


def test_import_if_exists_fail_conflict(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "name", "type": "TEXT"}])
    # First import succeeds
    client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(b"name\nAlice\n"), "text/csv")},
    )
    # Second import with same table should fail
    res = client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(b"name\nBob\n"), "text/csv")},
    )
    assert res.status_code == 409


def test_import_if_exists_replace(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "name", "type": "TEXT"}])
    client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(b"name\nAlice\nBob\n"), "text/csv")},
    )
    res = client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "replace"},
        files={"file": ("data.csv", io.BytesIO(b"name\nCharlie\n"), "text/csv")},
    )
    assert res.status_code == 200
    assert res.json()["rows_imported"] == 1

    data = client.get(f"/api/databases/{db_id}/tables/people/data").json()
    assert data["total"] == 1


def test_import_if_exists_append(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "name", "type": "TEXT"}])
    client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(b"name\nAlice\n"), "text/csv")},
    )
    res = client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "people", "column_types": col_types, "if_exists": "append"},
        files={"file": ("data.csv", io.BytesIO(b"name\nBob\nCharlie\n"), "text/csv")},
    )
    assert res.status_code == 200
    data = client.get(f"/api/databases/{db_id}/tables/people/data").json()
    assert data["total"] == 3


def test_import_invalid_table_name(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "x", "type": "TEXT"}])
    for bad_name in ("123bad", "has space", "drop;table", ""):
        res = client.post(
            f"/api/databases/{db_id}/import-csv",
            data={"table_name": bad_name, "column_types": col_types, "if_exists": "fail"},
            files={"file": ("data.csv", io.BytesIO(b"x\n1\n"), "text/csv")},
        )
        assert res.status_code == 400, f"Expected 400 for table name {bad_name!r}"


def test_import_empty_csv_creates_table(client, sample_db):
    db_id = _connect(client, sample_db)
    col_types = _col_types_json([{"name": "name", "type": "TEXT"}])
    res = client.post(
        f"/api/databases/{db_id}/import-csv",
        data={"table_name": "empty_tbl", "column_types": col_types, "if_exists": "fail"},
        files={"file": ("data.csv", io.BytesIO(b"name\n"), "text/csv")},
    )
    assert res.status_code == 200
    assert res.json()["rows_imported"] == 0

    schema = client.get(f"/api/databases/{db_id}/schema").json()
    names = [t["name"] for t in schema["tables"]]
    assert "empty_tbl" in names
