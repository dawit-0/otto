from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import os
import json
import shutil
import tempfile
from pathlib import Path

app = FastAPI(title="Otto")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory registry of connected databases
databases: dict[str, str] = {}  # id -> file path


class ConnectRequest(BaseModel):
    path: str


class QueryRequest(BaseModel):
    db_id: str
    sql: str


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
        cols_cursor = conn.execute(f"PRAGMA table_info(\"{name}\")")
        columns = []
        for col in cols_cursor.fetchall():
            columns.append({
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "pk": bool(col["pk"]),
                "default": col["dflt_value"],
            })

        # Get row count
        count_cursor = conn.execute(f"SELECT COUNT(*) as cnt FROM \"{name}\"")
        row_count = count_cursor.fetchone()["cnt"]

        # Get foreign keys
        fk_cursor = conn.execute(f"PRAGMA foreign_key_list(\"{name}\")")
        foreign_keys = []
        for fk in fk_cursor.fetchall():
            foreign_keys.append({
                "from_column": fk["from"],
                "to_table": fk["table"],
                "to_column": fk["to"],
            })

        # Get indexes
        idx_cursor = conn.execute(f"PRAGMA index_list(\"{name}\")")
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


@app.post("/api/databases/connect")
def connect_database(req: ConnectRequest):
    path = os.path.expanduser(req.path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"File not found: {path}")

    # Verify it's a valid SQLite file
    try:
        conn = sqlite3.connect(path)
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        raise HTTPException(status_code=400, detail="Not a valid SQLite database")

    db_id = Path(path).stem + "_" + str(abs(hash(path)))[:8]
    databases[db_id] = path
    return {"id": db_id, "name": Path(path).stem, "path": path}


@app.post("/api/databases/upload")
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


@app.get("/api/databases")
def list_databases():
    result = []
    for db_id, path in databases.items():
        result.append({"id": db_id, "name": Path(path).stem, "path": path})
    return result


@app.delete("/api/databases/{db_id}")
def disconnect_database(db_id: str):
    if db_id not in databases:
        raise HTTPException(status_code=404, detail="Database not found")
    del databases[db_id]
    return {"ok": True}


@app.get("/api/databases/{db_id}/schema")
def get_schema(db_id: str):
    conn = get_connection(db_id)
    try:
        tables = get_table_info(conn)
        return {"tables": tables}
    finally:
        conn.close()


@app.get("/api/databases/{db_id}/tables/{table_name}/data")
def get_table_data(db_id: str, table_name: str, limit: int = 100, offset: int = 0):
    conn = get_connection(db_id)
    try:
        cursor = conn.execute(
            f"SELECT * FROM \"{table_name}\" LIMIT ? OFFSET ?",
            (limit, offset),
        )
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchall()]
        count = conn.execute(f"SELECT COUNT(*) FROM \"{table_name}\"").fetchone()[0]
        return {"columns": columns, "rows": rows, "total": count, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/api/query")
def execute_query(req: QueryRequest):
    conn = get_connection(req.db_id)
    try:
        cursor = conn.execute(req.sql)
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return {"columns": columns, "rows": rows, "row_count": len(rows)}
        else:
            conn.commit()
            return {"columns": [], "rows": [], "row_count": cursor.rowcount, "message": f"{cursor.rowcount} rows affected"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
