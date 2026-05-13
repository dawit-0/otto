import os
import shutil
import sqlite3
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Any

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


@router.get("/{db_id}/tables/{table_name}/data")
def get_table_data(db_id: str, table_name: str, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        return driver.get_table_data(conn, table_name, limit, offset)
    except ValueError as e:
        logger.warning("Rejected table data request: %s", e)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error reading table '%s' from db_id=%s: %s", table_name, db_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
