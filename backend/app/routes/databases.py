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
from app.drivers.base import DatabaseDriver

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


# ── Row mutation models ────────────────────────────────────────────────────────

class InsertRowRequest(BaseModel):
    values: dict[str, Any]


class UpdateRowRequest(BaseModel):
    pk_values: dict[str, Any]
    updates: dict[str, Any]


class DeleteRowRequest(BaseModel):
    pk_values: dict[str, Any]


def _validate_columns(columns: list[str], valid: set[str]) -> None:
    for col in columns:
        if col not in valid:
            raise HTTPException(status_code=400, detail=f"Unknown column: {col!r}")


def _get_driver_pk_columns(driver: DatabaseDriver, conn: Any, table: str) -> list[str]:
    from app.drivers.sqlite import SQLiteDriver
    from app.drivers.postgres import PostgresDriver
    if isinstance(driver, SQLiteDriver):
        quoted = driver.quote_identifier(table)
        cursor = conn.execute(f"PRAGMA table_info({quoted})")
        rows = cursor.fetchall()
        return [r["name"] for r in rows if r["pk"] > 0]
    if isinstance(driver, PostgresDriver):
        return driver._get_pk_columns(conn, table)
    return []


@router.post("/{db_id}/tables/{table_name}/rows")
def insert_row(db_id: str, table_name: str, req: InsertRowRequest, db: Session = Depends(get_db)):
    if not req.values:
        raise HTTPException(status_code=400, detail="No values provided")
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        valid_columns = set(driver.get_column_names(conn, table_name))
        _validate_columns(list(req.values.keys()), valid_columns)

        ph = driver.placeholder
        quoted = driver.quote_identifier(table_name)
        col_parts = [driver.quote_identifier(c) for c in req.values]
        params = [None if v == "" and v is not False else v for v in req.values.values()]
        sql = f"INSERT INTO {quoted} ({', '.join(col_parts)}) VALUES ({', '.join([ph] * len(params))})"
        driver.execute_params(conn, sql, params)
        logger.info("Inserted row into '%s' (db_id=%s)", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error inserting row into '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.patch("/{db_id}/tables/{table_name}/rows")
def update_row(db_id: str, table_name: str, req: UpdateRowRequest, db: Session = Depends(get_db)):
    if not req.updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    if not req.pk_values:
        raise HTTPException(status_code=400, detail="pk_values required for update")
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        valid_columns = set(driver.get_column_names(conn, table_name))
        _validate_columns(list(req.pk_values.keys()) + list(req.updates.keys()), valid_columns)

        ph = driver.placeholder
        quoted = driver.quote_identifier(table_name)
        set_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.updates]
        set_params = list(req.updates.values())
        where_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.pk_values]
        where_params = list(req.pk_values.values())

        sql = f"UPDATE {quoted} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
        driver.execute_params(conn, sql, [*set_params, *where_params])
        logger.info("Updated row in '%s' (db_id=%s)", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error updating row in '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.delete("/{db_id}/tables/{table_name}/rows")
def delete_row(db_id: str, table_name: str, req: DeleteRowRequest, db: Session = Depends(get_db)):
    if not req.pk_values:
        raise HTTPException(status_code=400, detail="pk_values required for delete")
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        valid_columns = set(driver.get_column_names(conn, table_name))
        _validate_columns(list(req.pk_values.keys()), valid_columns)

        ph = driver.placeholder
        quoted = driver.quote_identifier(table_name)
        where_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.pk_values]
        where_params = list(req.pk_values.values())

        sql = f"DELETE FROM {quoted} WHERE {' AND '.join(where_parts)}"
        driver.execute_params(conn, sql, where_params)
        logger.info("Deleted row from '%s' (db_id=%s)", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error deleting row from '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
