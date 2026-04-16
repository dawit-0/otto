import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.connection import ConnectedDatabase
from app.utils.sql_safety import assert_valid_table, quote_identifier

logger = get_logger("databases")

router = APIRouter(prefix="/api/databases", tags=["databases"])


class ConnectRequest(BaseModel):
    path: str


def _resolve_path(db_id: str, db: Session) -> str:
    """Look up the file path for a db_id from the persistent store."""
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Database not found")
    return record.path


def get_connection(db_id: str, db: Session) -> sqlite3.Connection:
    path = _resolve_path(db_id, db)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def get_db_name(db_id: str, db: Session) -> str:
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    return record.name if record else db_id


def _register(db_id: str, name: str, path: str, db: Session) -> None:
    """Insert or update a connected database record."""
    existing = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    if not existing:
        db.add(ConnectedDatabase(db_id=db_id, name=name, path=path))
        db.commit()


def get_table_info(conn: sqlite3.Connection) -> list[dict]:
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = []
    for row in cursor.fetchall():
        name = row["name"]
        quoted = quote_identifier(name)
        cols_cursor = conn.execute(f"PRAGMA table_info({quoted})")
        columns = []
        for col in cols_cursor.fetchall():
            columns.append({
                "name": col["name"],
                "type": col["type"],
                "notnull": bool(col["notnull"]),
                "pk": bool(col["pk"]),
                "default": col["dflt_value"],
            })

        count_cursor = conn.execute(f"SELECT COUNT(*) as cnt FROM {quoted}")
        row_count = count_cursor.fetchone()["cnt"]

        fk_cursor = conn.execute(f"PRAGMA foreign_key_list({quoted})")
        foreign_keys = []
        for fk in fk_cursor.fetchall():
            foreign_keys.append({
                "from_column": fk["from"],
                "to_table": fk["table"],
                "to_column": fk["to"],
            })

        idx_cursor = conn.execute(f"PRAGMA index_list({quoted})")
        indexes = []
        for idx in idx_cursor.fetchall():
            quoted_idx = quote_identifier(idx["name"])
            idx_info = conn.execute(f"PRAGMA index_info({quoted_idx})").fetchall()
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
def connect_database(req: ConnectRequest, db: Session = Depends(get_db)):
    path = os.path.expanduser(req.path)
    logger.info("Connecting to database at %s", path)
    if not os.path.isfile(path):
        logger.warning("File not found: %s", path)
        raise HTTPException(status_code=400, detail=f"File not found: {path}")

    try:
        conn = sqlite3.connect(path)
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        logger.error("Invalid SQLite database: %s", path)
        raise HTTPException(status_code=400, detail="Not a valid SQLite database")

    db_id = Path(path).stem + "_" + str(abs(hash(path)))[:8]
    name = Path(path).stem
    _register(db_id, name, path, db)
    logger.info("Connected database '%s' (id=%s)", name, db_id)
    return {"id": db_id, "name": name, "path": path}


@router.post("/upload")
async def upload_database(file: UploadFile = File(...), db: Session = Depends(get_db)):
    logger.info("Uploading database file: %s", file.filename)
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
        logger.error("Uploaded file is not a valid SQLite database: %s", file.filename)
        os.remove(dest)
        raise HTTPException(status_code=400, detail="Not a valid SQLite database")

    db_id = Path(dest).stem + "_" + str(abs(hash(dest)))[:8]
    name = Path(dest).stem
    _register(db_id, name, dest, db)
    logger.info("Uploaded and connected database '%s' (id=%s)", name, db_id)
    return {"id": db_id, "name": name, "path": dest}


@router.get("")
def list_databases(db: Session = Depends(get_db)):
    records = db.query(ConnectedDatabase).all()
    # Filter out entries whose files no longer exist
    result = []
    for r in records:
        if os.path.isfile(r.path):
            result.append({"id": r.db_id, "name": r.name, "path": r.path})
        else:
            db.delete(r)
    db.commit()
    return result


@router.delete("/{db_id}")
def disconnect_database(db_id: str, db: Session = Depends(get_db)):
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    if not record:
        logger.warning("Disconnect requested for unknown db_id=%s", db_id)
        raise HTTPException(status_code=404, detail="Database not found")
    logger.info("Disconnecting database '%s' (id=%s)", record.name, db_id)
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.get("/{db_id}/schema")
def get_schema(db_id: str, db: Session = Depends(get_db)):
    conn = get_connection(db_id, db)
    try:
        tables = get_table_info(conn)
        return {"tables": tables}
    finally:
        conn.close()


@router.get("/{db_id}/tables/{table_name}/data")
def get_table_data(db_id: str, table_name: str, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    conn = get_connection(db_id, db)
    try:
        try:
            assert_valid_table(conn, table_name)
        except ValueError:
            logger.warning("Rejected table data request for unknown table '%s' on db_id=%s", table_name, db_id)
            raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")

        quoted = quote_identifier(table_name)
        cursor = conn.execute(
            f"SELECT * FROM {quoted} LIMIT ? OFFSET ?",
            (limit, offset),
        )
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchall()]
        count = conn.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
        return {"columns": columns, "rows": rows, "total": count, "limit": limit, "offset": offset}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error reading table '%s' from db_id=%s: %s", table_name, db_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
