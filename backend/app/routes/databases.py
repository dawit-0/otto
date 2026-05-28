import json
import os
import shutil
import sqlite3
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.drivers import DatabaseDriver, get_driver
from app.logging import get_logger
from app.models.connection import ConnectedDatabase

logger = get_logger("databases")

router = APIRouter(prefix="/api/databases", tags=["databases"])


class ConnectRequest(BaseModel):
    db_type: str = "sqlite"
    path: str | None = None
    host: str | None = None
    port: int = 5432
    database: str | None = None
    username: str | None = None
    password: str | None = None


def _resolve_record(db_id: str, db: Session) -> ConnectedDatabase:
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Database not found")
    return record


def get_driver_for_db(db_id: str, db: Session) -> DatabaseDriver:
    record = _resolve_record(db_id, db)
    return get_driver(record)


def get_connection(db_id: str, db: Session) -> Any:
    record = _resolve_record(db_id, db)
    driver = get_driver(record)
    return driver.connect()


def get_db_name(db_id: str, db: Session) -> str:
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    return record.name if record else db_id


def get_db_type(db_id: str, db: Session) -> str:
    record = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    return record.db_type if record else "sqlite"


def _register(db_id: str, name: str, db: Session, *, path: str = "",
              db_type: str = "sqlite", connection_string: str | None = None) -> None:
    existing = db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    if not existing:
        db.add(ConnectedDatabase(
            db_id=db_id, name=name, path=path,
            db_type=db_type, connection_string=connection_string,
        ))
        db.commit()


def _build_pg_connection_string(req: ConnectRequest) -> str:
    parts = [f"host={req.host}", f"port={req.port}", f"dbname={req.database}"]
    if req.username:
        parts.append(f"user={req.username}")
    if req.password:
        parts.append(f"password={req.password}")
    return " ".join(parts)


@router.post("/connect")
def connect_database(req: ConnectRequest, db: Session = Depends(get_db)):
    if req.db_type == "postgres":
        if not req.host or not req.database:
            raise HTTPException(status_code=400, detail="host and database are required for PostgreSQL")

        conn_str = _build_pg_connection_string(req)
        from app.drivers.postgres import PostgresDriver
        driver = PostgresDriver(conn_str)
        try:
            driver.validate()
        except Exception as e:
            logger.error("Failed to connect to PostgreSQL: %s", e)
            raise HTTPException(status_code=400, detail=f"Cannot connect to PostgreSQL: {e}")

        raw = f"{req.host}:{req.port}/{req.database}"
        db_id = f"pg_{req.database}_{sha256(raw.encode()).hexdigest()[:8]}"
        name = req.database
        _register(db_id, name, db, db_type="postgres", connection_string=conn_str)
        logger.info("Connected PostgreSQL database '%s' (id=%s)", name, db_id)
        return {"id": db_id, "name": name, "path": "", "db_type": "postgres"}

    # SQLite path
    path = os.path.expanduser(req.path or "")
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
    _register(db_id, name, db, path=path, db_type="sqlite")
    logger.info("Connected database '%s' (id=%s)", name, db_id)
    return {"id": db_id, "name": name, "path": path, "db_type": "sqlite"}


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
    _register(db_id, name, db, path=dest, db_type="sqlite")
    logger.info("Uploaded and connected database '%s' (id=%s)", name, db_id)
    return {"id": db_id, "name": name, "path": dest, "db_type": "sqlite"}


@router.get("")
def list_databases(db: Session = Depends(get_db)):
    records = db.query(ConnectedDatabase).all()
    result = []
    for r in records:
        if r.db_type == "postgres":
            result.append({"id": r.db_id, "name": r.name, "path": "", "db_type": "postgres"})
        elif os.path.isfile(r.path):
            result.append({"id": r.db_id, "name": r.name, "path": r.path, "db_type": "sqlite"})
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
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        tables = driver.get_table_info(conn)
        return {"tables": tables}
    finally:
        driver.close(conn)


@router.get("/{db_id}/overview")
def get_overview(db_id: str, db: Session = Depends(get_db)):
    record = _resolve_record(db_id, db)
    driver = get_driver(record)
    conn = driver.connect()
    try:
        tables = driver.get_table_info(conn)

        # DB-type-specific metadata
        if record.db_type == "postgres":
            _, rows = driver.execute(conn, "SELECT version()")
            db_version = rows[0].get("version", "")[:60] if rows else ""
            _, view_rows = driver.execute(
                conn,
                "SELECT count(*) AS cnt FROM information_schema.views WHERE table_schema = 'public'",
            )
            view_count = int(view_rows[0]["cnt"]) if view_rows else 0
            _, trig_rows = driver.execute(
                conn,
                "SELECT count(*) AS cnt FROM information_schema.triggers WHERE trigger_schema = 'public'",
            )
            trigger_count = int(trig_rows[0]["cnt"]) if trig_rows else 0
            file_size_bytes = 0
            display_path = record.connection_string or ""
        else:
            _, rows = driver.execute(conn, "SELECT sqlite_version() AS v")
            db_version = rows[0]["v"] if rows else ""
            _, master_rows = driver.execute(
                conn,
                "SELECT type FROM sqlite_master WHERE type IN ('view','trigger') AND name NOT LIKE 'sqlite_%'",
            )
            view_count = sum(1 for r in master_rows if r["type"] == "view")
            trigger_count = sum(1 for r in master_rows if r["type"] == "trigger")
            try:
                file_size_bytes = os.path.getsize(record.path)
            except OSError:
                file_size_bytes = 0
            display_path = record.path

        total_rows = sum(t["row_count"] for t in tables)
        total_columns = sum(len(t["columns"]) for t in tables)
        total_indexes = sum(len(t["indexes"]) for t in tables)

        table_summaries = [
            {
                "name": t["name"],
                "row_count": t["row_count"],
                "column_count": len(t["columns"]),
                "index_count": len(t["indexes"]),
                "fk_count": len(t["foreign_keys"]),
                "has_pk": any(c["pk"] for c in t["columns"]),
                "columns": [
                    {"name": c["name"], "type": c["type"] or "ANY", "pk": c["pk"], "notnull": c["notnull"]}
                    for c in t["columns"]
                ],
            }
            for t in tables
        ]

        return {
            "db_info": {
                "path": display_path,
                "file_size_bytes": file_size_bytes,
                "db_version": db_version,
                "db_type": record.db_type,
            },
            "stats": {
                "table_count": len(tables),
                "total_rows": total_rows,
                "total_columns": total_columns,
                "index_count": total_indexes,
                "view_count": view_count,
                "trigger_count": trigger_count,
            },
            "tables": table_summaries,
        }
    finally:
        driver.close(conn)


@router.get("/{db_id}/tables/{table_name}/columns/{column_name}/profile")
def get_column_profile(
    db_id: str,
    table_name: str,
    column_name: str,
    db: Session = Depends(get_db),
):
    from app.utils.sql_safety import quote_identifier

    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        tables = driver.get_table_info(conn)
        table = next((t for t in tables if t["name"] == table_name), None)
        if not table:
            raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

        col_def = next((c for c in table["columns"] if c["name"] == column_name), None)
        if not col_def:
            raise HTTPException(status_code=404, detail=f"Column '{column_name}' not found")

        col_type = (col_def["type"] or "").upper()
        is_numeric = any(
            t in col_type
            for t in ["INT", "REAL", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER", "BIGINT", "SMALLINT"]
        )

        q_table = quote_identifier(table_name)
        q_col = quote_identifier(column_name)

        _, stats_rows = driver.execute(
            conn,
            f"SELECT COUNT(*) AS total_count, "
            f"SUM(CASE WHEN {q_col} IS NULL THEN 1 ELSE 0 END) AS null_count, "
            f"COUNT(DISTINCT {q_col}) AS unique_count "
            f"FROM {q_table}",
        )
        stats = stats_rows[0] if stats_rows else {}
        total_count = int(stats.get("total_count") or 0)
        null_count = int(stats.get("null_count") or 0)
        unique_count = int(stats.get("unique_count") or 0)
        null_percent = round((null_count / total_count * 100) if total_count else 0, 1)

        min_val = max_val = avg_val = None
        if is_numeric:
            _, num_rows = driver.execute(
                conn,
                f"SELECT MIN({q_col}) AS min_val, MAX({q_col}) AS max_val, "
                f"AVG(CAST({q_col} AS FLOAT)) AS avg_val "
                f"FROM {q_table} WHERE {q_col} IS NOT NULL",
            )
            if num_rows:
                min_val = num_rows[0].get("min_val")
                max_val = num_rows[0].get("max_val")
                raw_avg = num_rows[0].get("avg_val")
                avg_val = round(float(raw_avg), 4) if raw_avg is not None else None

        _, top_rows = driver.execute(
            conn,
            f"SELECT {q_col} AS value, COUNT(*) AS count "
            f"FROM {q_table} WHERE {q_col} IS NOT NULL "
            f"GROUP BY {q_col} ORDER BY count DESC LIMIT 10",
        )
        top_values = [
            {"value": str(r.get("value")), "count": int(r.get("count") or 0)}
            for r in top_rows
        ]

        return {
            "column": column_name,
            "type": col_def["type"] or "ANY",
            "total_count": total_count,
            "null_count": null_count,
            "null_percent": null_percent,
            "unique_count": unique_count,
            "is_numeric": is_numeric,
            "min": min_val,
            "max": max_val,
            "avg": avg_val,
            "top_values": top_values,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error profiling column '%s.%s': %s", table_name, column_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.get("/{db_id}/tables/{table_name}/data")
def get_table_data(
    db_id: str,
    table_name: str,
    limit: int = 100,
    offset: int = 0,
    sort_column: Optional[str] = None,
    sort_direction: str = "asc",
    filters: Optional[str] = None,
    db: Session = Depends(get_db),
):
    parsed_filters: list[dict] = []
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filters JSON")

    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        return driver.get_table_data(
            conn, table_name, limit, offset,
            sort_column=sort_column,
            sort_direction=sort_direction,
            filters=parsed_filters,
        )
    except ValueError as e:
        logger.warning("Rejected table data request: %s", e)
        status = 404 if str(e).lower().startswith("unknown table") else 400
        raise HTTPException(status_code=status, detail=str(e))
    except Exception as e:
        logger.error("Error reading table '%s' from db_id=%s: %s", table_name, db_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
