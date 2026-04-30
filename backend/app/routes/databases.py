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


def _type_affinity(declared_type: str) -> str:
    """Map a SQLite declared type to a broad affinity category."""
    t = declared_type.upper()
    if "INT" in t:
        return "numeric"
    if any(k in t for k in ("CHAR", "CLOB", "TEXT")):
        return "text"
    if any(k in t for k in ("REAL", "FLOA", "DOUB")):
        return "numeric"
    if any(k in t for k in ("DATE", "TIME")):
        return "text"
    if t in ("", "BLOB"):
        return "other"
    # NUMERIC affinity (e.g. NUMERIC, DECIMAL)
    return "numeric"


def _profile_column(conn: sqlite3.Connection, table_quoted: str, col_name: str, declared_type: str, row_count: int) -> dict:
    col_quoted = quote_identifier(col_name)
    affinity = _type_affinity(declared_type)

    null_count = conn.execute(
        f"SELECT COUNT(*) FROM {table_quoted} WHERE {col_quoted} IS NULL"
    ).fetchone()[0]
    null_pct = round(null_count / row_count * 100, 1) if row_count > 0 else 0.0

    unique_count = conn.execute(
        f"SELECT COUNT(DISTINCT {col_quoted}) FROM {table_quoted}"
    ).fetchone()[0]
    unique_pct = round(unique_count / row_count * 100, 1) if row_count > 0 else 0.0

    sample_rows = conn.execute(
        f"SELECT DISTINCT {col_quoted} FROM {table_quoted} WHERE {col_quoted} IS NOT NULL LIMIT 3"
    ).fetchall()
    sample_values = [row[0] for row in sample_rows]

    result: dict = {
        "name": col_name,
        "type": declared_type,
        "affinity": affinity,
        "null_count": null_count,
        "null_pct": null_pct,
        "unique_count": unique_count,
        "unique_pct": unique_pct,
        "sample_values": sample_values,
    }

    non_null = row_count - null_count

    if affinity == "numeric" and non_null > 0:
        stats = conn.execute(
            f"SELECT MIN(CAST({col_quoted} AS REAL)), MAX(CAST({col_quoted} AS REAL)), AVG(CAST({col_quoted} AS REAL)) "
            f"FROM {table_quoted} WHERE {col_quoted} IS NOT NULL"
        ).fetchone()
        min_val, max_val, avg_val = stats
        result["min"] = min_val
        result["max"] = max_val
        result["avg"] = round(avg_val, 4) if avg_val is not None else None

        # Build a 10-bucket histogram
        histogram = []
        if min_val is not None and max_val is not None and min_val != max_val:
            span = max_val - min_val
            bucket_rows = conn.execute(
                f"SELECT CAST(MIN(CAST((CAST({col_quoted} AS REAL) - ?) / ? * 10 AS INT), 9) AS INT) AS b, COUNT(*) "
                f"FROM {table_quoted} WHERE {col_quoted} IS NOT NULL GROUP BY b ORDER BY b",
                (min_val, span),
            ).fetchall()
            bucket_map = {row[0]: row[1] for row in bucket_rows}
            for i in range(10):
                start = min_val + (span * i / 10)
                end = min_val + (span * (i + 1) / 10)
                histogram.append({
                    "bucket_start": round(start, 4),
                    "bucket_end": round(end, 4),
                    "count": bucket_map.get(i, 0),
                })
        elif min_val is not None:
            histogram.append({"bucket_start": min_val, "bucket_end": min_val, "count": non_null})
        result["histogram"] = histogram

    elif affinity == "text" and non_null > 0:
        avg_len = conn.execute(
            f"SELECT AVG(LENGTH(CAST({col_quoted} AS TEXT))) FROM {table_quoted} WHERE {col_quoted} IS NOT NULL"
        ).fetchone()[0]
        result["avg_length"] = round(avg_len, 1) if avg_len is not None else None

        top_rows = conn.execute(
            f"SELECT CAST({col_quoted} AS TEXT), COUNT(*) as cnt FROM {table_quoted} "
            f"WHERE {col_quoted} IS NOT NULL GROUP BY {col_quoted} ORDER BY cnt DESC LIMIT 10"
        ).fetchall()
        result["top_values"] = [{"value": str(r[0]), "count": r[1]} for r in top_rows]

    return result


@router.get("/{db_id}/tables/{table_name}/profile")
def get_table_profile(db_id: str, table_name: str, db: Session = Depends(get_db)):
    conn = get_connection(db_id, db)
    try:
        try:
            assert_valid_table(conn, table_name)
        except ValueError:
            raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")

        quoted = quote_identifier(table_name)
        row_count = conn.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]

        cols_cursor = conn.execute(f"PRAGMA table_info({quoted})")
        columns = []
        for col in cols_cursor.fetchall():
            try:
                profile = _profile_column(conn, quoted, col["name"], col["type"] or "", row_count)
                columns.append(profile)
            except Exception as e:
                logger.warning("Failed to profile column '%s': %s", col["name"], e)
                columns.append({
                    "name": col["name"],
                    "type": col["type"] or "",
                    "affinity": "other",
                    "null_count": 0,
                    "null_pct": 0.0,
                    "unique_count": 0,
                    "unique_pct": 0.0,
                    "sample_values": [],
                })

        logger.info("Profiled table '%s' (db_id=%s): %d columns, %d rows", table_name, db_id, len(columns), row_count)
        return {"table": table_name, "row_count": row_count, "columns": columns}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error profiling table '%s' from db_id=%s: %s", table_name, db_id, e)
        raise HTTPException(status_code=400, detail=str(e))
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
