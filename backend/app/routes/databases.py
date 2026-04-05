import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/databases", tags=["databases"])

# In-memory registry of connected databases
databases: dict[str, str] = {}  # id -> file path


class ConnectRequest(BaseModel):
    path: str


def get_connection(db_id: str) -> sqlite3.Connection:
    if db_id not in databases:
        raise HTTPException(status_code=404, detail="Database not found")
    conn = sqlite3.connect(databases[db_id])
    conn.row_factory = sqlite3.Row
    return conn


def get_table_info(conn: sqlite3.Connection) -> list[dict]:
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = []
    for row in cursor.fetchall():
        name = row["name"]
        cols_cursor = conn.execute(f'PRAGMA table_info("{name}")')
        columns = []
        for col in cols_cursor.fetchall():
            columns.append({
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "pk": bool(col["pk"]),
                "default": col["dflt_value"],
            })

        count_cursor = conn.execute(f'SELECT COUNT(*) as cnt FROM "{name}"')
        row_count = count_cursor.fetchone()["cnt"]

        fk_cursor = conn.execute(f'PRAGMA foreign_key_list("{name}")')
        foreign_keys = []
        for fk in fk_cursor.fetchall():
            foreign_keys.append({
                "from_column": fk["from"],
                "to_table": fk["table"],
                "to_column": fk["to"],
            })

        idx_cursor = conn.execute(f'PRAGMA index_list("{name}")')
        indexes = []
        for idx in idx_cursor.fetchall():
            idx_info = conn.execute(f"PRAGMA index_info(\"{idx['name']}\")").fetchall()
            indexes.append({
                "name": idx["name"],
                "unique": bool(idx["unique"]),
                "columns": [i["name"] for i in idx_info],
            })

        tables.append({
            "name": name,
            "columns": columns,
            "row_count": row_count,
            "foreign_keys": foreign_keys,
            "indexes": indexes,
        })
    return tables


@router.post("/connect")
def connect_database(req: ConnectRequest):
    path = os.path.expanduser(req.path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"File not found: {path}")

    try:
        conn = sqlite3.connect(path)
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        raise HTTPException(status_code=400, detail="Not a valid SQLite database")

    db_id = Path(path).stem + "_" + str(abs(hash(path)))[:8]
    databases[db_id] = path
    return {"id": db_id, "name": Path(path).stem, "path": path}


@router.post("/upload")
async def upload_database(file: UploadFile = File(...)):
    upload_dir = os.path.join(tempfile.gettempdir(), "otto_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    dest = os.path.join(upload_dir, file.filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        conn = sqlite3.connect(dest)
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        os.remove(dest)
        raise HTTPException(status_code=400, detail="Not a valid SQLite database")

    db_id = Path(dest).stem + "_" + str(abs(hash(dest)))[:8]
    databases[db_id] = dest
    return {"id": db_id, "name": Path(dest).stem, "path": dest}


@router.get("")
def list_databases():
    result = []
    for db_id, path in databases.items():
        result.append({"id": db_id, "name": Path(path).stem, "path": path})
    return result


@router.delete("/{db_id}")
def disconnect_database(db_id: str):
    if db_id not in databases:
        raise HTTPException(status_code=404, detail="Database not found")
    del databases[db_id]
    return {"ok": True}


@router.get("/{db_id}/schema")
def get_schema(db_id: str):
    conn = get_connection(db_id)
    try:
        tables = get_table_info(conn)
        return {"tables": tables}
    finally:
        conn.close()


@router.get("/{db_id}/tables/{table_name}/data")
def get_table_data(db_id: str, table_name: str, limit: int = 100, offset: int = 0):
    conn = get_connection(db_id)
    try:
        cursor = conn.execute(
            f'SELECT * FROM "{table_name}" LIMIT ? OFFSET ?',
            (limit, offset),
        )
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchall()]
        count = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
        return {"columns": columns, "rows": rows, "total": count, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
