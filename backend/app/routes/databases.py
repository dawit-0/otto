import json
import os
import shutil
import sqlite3
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.drivers import DatabaseDriver, get_driver
from app.logging import get_logger
from app.models.connection import ConnectedDatabase

_NUMERIC_BASE_TYPES = frozenset(
    {
        "int",
        "integer",
        "bigint",
        "smallint",
        "tinyint",
        "mediumint",
        "real",
        "float",
        "double",
        "numeric",
        "decimal",
        "number",
        "serial",
        "bigserial",
        "float4",
        "float8",
        "int2",
        "int4",
        "int8",
    }
)


def _is_numeric_type(type_str: str | None) -> bool:
    if not type_str:
        return False
    base = type_str.lower().split("(")[0].strip().split()[0]
    return base in _NUMERIC_BASE_TYPES


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
    record = (
        db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    )
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
    record = (
        db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    )
    return record.name if record else db_id


def get_db_type(db_id: str, db: Session) -> str:
    record = (
        db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    )
    return record.db_type if record else "sqlite"


def _register(
    db_id: str,
    name: str,
    db: Session,
    *,
    path: str = "",
    db_type: str = "sqlite",
    connection_string: str | None = None,
) -> None:
    existing = (
        db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    )
    if not existing:
        db.add(
            ConnectedDatabase(
                db_id=db_id,
                name=name,
                path=path,
                db_type=db_type,
                connection_string=connection_string,
            )
        )
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
            raise HTTPException(
                status_code=400, detail="host and database are required for PostgreSQL"
            )

        conn_str = _build_pg_connection_string(req)
        from app.drivers.postgres import PostgresDriver

        driver = PostgresDriver(conn_str)
        try:
            driver.validate()
        except Exception as e:
            logger.error("Failed to connect to PostgreSQL: %s", e)
            raise HTTPException(
                status_code=400, detail=f"Cannot connect to PostgreSQL: {e}"
            )

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
            result.append(
                {"id": r.db_id, "name": r.name, "path": "", "db_type": "postgres"}
            )
        elif os.path.isfile(r.path):
            result.append(
                {"id": r.db_id, "name": r.name, "path": r.path, "db_type": "sqlite"}
            )
        else:
            db.delete(r)
    db.commit()
    return result


@router.delete("/{db_id}")
def disconnect_database(db_id: str, db: Session = Depends(get_db)):
    record = (
        db.query(ConnectedDatabase).filter(ConnectedDatabase.db_id == db_id).first()
    )
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
                    {
                        "name": c["name"],
                        "type": c["type"] or "ANY",
                        "pk": c["pk"],
                        "notnull": c["notnull"],
                    }
                    for c in t["columns"]
                ],
                "indexes": t["indexes"],
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
            conn,
            table_name,
            limit,
            offset,
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


class InsertRowRequest(BaseModel):
    values: dict[str, str | None]


class UpdateRowRequest(BaseModel):
    pk_values: dict[str, str | None]
    updates: dict[str, str | None]


class DeleteRowRequest(BaseModel):
    pk_values: dict[str, str | None]


@router.post("/{db_id}/tables/{table_name}/rows")
def insert_row(
    db_id: str,
    table_name: str,
    req: InsertRowRequest,
    db: Session = Depends(get_db),
):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        try:
            driver.assert_valid_table(conn, table_name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        valid_cols = set(driver.get_column_names(conn, table_name))
        filtered = {k: v for k, v in req.values.items() if v is not None and v != ""}
        for col in filtered:
            if col not in valid_cols:
                raise HTTPException(status_code=400, detail=f"Unknown column: {col!r}")
        if not filtered:
            raise HTTPException(status_code=400, detail="No values provided")
        tq = driver.quote_identifier(table_name)
        col_names = list(filtered.keys())
        col_exprs = ", ".join(driver.quote_identifier(c) for c in col_names)
        placeholders = ", ".join(driver.placeholder for _ in col_names)
        params = list(filtered.values())
        sql = f"INSERT INTO {tq} ({col_exprs}) VALUES ({placeholders})"
        driver.execute_params(conn, sql, params)
        logger.info("Inserted row into '%s' in db_id=%s", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("insert_row error for '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.patch("/{db_id}/tables/{table_name}/rows")
def update_row(
    db_id: str,
    table_name: str,
    req: UpdateRowRequest,
    db: Session = Depends(get_db),
):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        try:
            driver.assert_valid_table(conn, table_name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        valid_cols = set(driver.get_column_names(conn, table_name))
        for col in list(req.pk_values.keys()) + list(req.updates.keys()):
            if col not in valid_cols:
                raise HTTPException(status_code=400, detail=f"Unknown column: {col!r}")
        if not req.pk_values:
            raise HTTPException(status_code=400, detail="pk_values required")
        if not req.updates:
            raise HTTPException(status_code=400, detail="No updates provided")
        tq = driver.quote_identifier(table_name)
        ph = driver.placeholder
        set_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.updates]
        where_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.pk_values]
        sql = f"UPDATE {tq} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
        params = list(req.updates.values()) + list(req.pk_values.values())
        driver.execute_params(conn, sql, params)
        logger.info("Updated row in '%s' in db_id=%s", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("update_row error for '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.delete("/{db_id}/tables/{table_name}/rows")
def delete_row(
    db_id: str,
    table_name: str,
    req: DeleteRowRequest = Body(...),
    db: Session = Depends(get_db),
):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        try:
            driver.assert_valid_table(conn, table_name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        valid_cols = set(driver.get_column_names(conn, table_name))
        for col in req.pk_values:
            if col not in valid_cols:
                raise HTTPException(status_code=400, detail=f"Unknown column: {col!r}")
        if not req.pk_values:
            raise HTTPException(status_code=400, detail="pk_values required")
        tq = driver.quote_identifier(table_name)
        ph = driver.placeholder
        where_parts = [f"{driver.quote_identifier(c)} = {ph}" for c in req.pk_values]
        sql = f"DELETE FROM {tq} WHERE {' AND '.join(where_parts)}"
        params = list(req.pk_values.values())
        driver.execute_params(conn, sql, params)
        logger.info("Deleted row from '%s' in db_id=%s", table_name, db_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("delete_row error for '%s': %s", table_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.get("/{db_id}/tables/{table_name}/profile")
def get_table_profile(db_id: str, table_name: str, db: Session = Depends(get_db)):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        try:
            driver.assert_valid_table(conn, table_name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        all_tables = driver.get_table_info(conn)
        table_info = next((t for t in all_tables if t["name"] == table_name), None)
        if table_info is None:
            raise HTTPException(
                status_code=404, detail=f"Table '{table_name}' not found"
            )

        columns = table_info["columns"]
        row_count = table_info["row_count"]

        empty_profile = [
            {
                "name": c["name"],
                "type": c["type"] or "ANY",
                "null_count": 0,
                "null_pct": 0.0,
                "distinct_count": 0,
                "distinct_pct": 0.0,
                "is_numeric": _is_numeric_type(c["type"]),
                "min": None,
                "max": None,
                "avg": None,
                "top_values": [],
            }
            for c in columns
        ]

        if not columns or row_count == 0:
            return {
                "table": table_name,
                "row_count": row_count,
                "columns": empty_profile,
            }

        tq = driver.quote_identifier(table_name)

        # Single query: null counts + distinct counts for every column
        agg_exprs = ["COUNT(*) AS __total"]
        for i, col in enumerate(columns):
            cq = driver.quote_identifier(col["name"])
            agg_exprs.append(f"COUNT({cq}) AS __c{i}_nn")
            agg_exprs.append(f"COUNT(DISTINCT {cq}) AS __c{i}_dc")

        _, agg_rows = driver.execute(conn, f"SELECT {', '.join(agg_exprs)} FROM {tq}")
        agg = agg_rows[0] if agg_rows else {}
        total = int(agg.get("__total") or row_count)

        # Second query: min / max / avg for numeric columns only
        numeric_idx = [
            (i, col) for i, col in enumerate(columns) if _is_numeric_type(col["type"])
        ]
        num_stats: dict = {}
        if numeric_idx:
            num_exprs = []
            for i, col in numeric_idx:
                cq = driver.quote_identifier(col["name"])
                num_exprs.append(f"MIN({cq}) AS __c{i}_min")
                num_exprs.append(f"MAX({cq}) AS __c{i}_max")
                num_exprs.append(f"AVG({cq}) AS __c{i}_avg")
            try:
                _, num_rows = driver.execute(
                    conn, f"SELECT {', '.join(num_exprs)} FROM {tq}"
                )
                num_stats = num_rows[0] if num_rows else {}
            except Exception:
                pass

        result_columns = []
        for i, col in enumerate(columns):
            non_null = int(agg.get(f"__c{i}_nn") or 0)
            distinct = int(agg.get(f"__c{i}_dc") or 0)
            null_count = total - non_null
            null_pct = round(null_count / total * 100, 1) if total else 0.0
            distinct_pct = round(distinct / total * 100, 1) if total else 0.0
            is_num = _is_numeric_type(col["type"])

            min_val = num_stats.get(f"__c{i}_min") if is_num else None
            max_val = num_stats.get(f"__c{i}_max") if is_num else None
            avg_raw = num_stats.get(f"__c{i}_avg") if is_num else None
            avg_val = round(float(avg_raw), 4) if avg_raw is not None else None

            top_values: list[dict] = []
            if 0 < distinct <= 500:
                try:
                    cq = driver.quote_identifier(col["name"])
                    top_sql = (
                        f"SELECT {cq} AS value, COUNT(*) AS cnt FROM {tq} "
                        f"WHERE {cq} IS NOT NULL GROUP BY {cq} ORDER BY cnt DESC LIMIT 5"
                    )
                    _, top_rows = driver.execute(conn, top_sql)
                    top_values = [
                        {"value": str(r["value"]), "count": int(r["cnt"])}
                        for r in top_rows
                    ]
                except Exception:
                    pass

            result_columns.append(
                {
                    "name": col["name"],
                    "type": col["type"] or "ANY",
                    "null_count": null_count,
                    "null_pct": null_pct,
                    "distinct_count": distinct,
                    "distinct_pct": distinct_pct,
                    "is_numeric": is_num,
                    "min": str(min_val) if min_val is not None else None,
                    "max": str(max_val) if max_val is not None else None,
                    "avg": avg_val,
                    "top_values": top_values,
                }
            )

        return {"table": table_name, "row_count": total, "columns": result_columns}
    finally:
        driver.close(conn)
