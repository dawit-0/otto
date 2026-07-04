import csv
import io
import json
import re
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.databases import get_db_type, get_driver_for_db

logger = get_logger("import")
router = APIRouter(prefix="/api/databases", tags=["import"])

_MAX_PREVIEW_ROWS = 5
_MAX_IMPORT_ROWS = 100_000
_MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


# ── Parsing helpers ───────────────────────────────────────────────────────────

def _infer_type(values: list[str]) -> str:
    non_empty = [v for v in values if v.strip()]
    if not non_empty:
        return "TEXT"
    try:
        for v in non_empty:
            int(v)
        return "INTEGER"
    except ValueError:
        pass
    try:
        for v in non_empty:
            float(v)
        return "REAL"
    except ValueError:
        pass
    return "TEXT"


def _parse_csv(content: str) -> tuple[list[str], list[dict], int]:
    try:
        dialect = csv.Sniffer().sniff(content[:4096], delimiters=',\t;|')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(content), dialect=dialect)
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = [
        {h.strip(): (v or '') for h, v in row.items()}
        for row in reader
    ]
    return headers, rows, len(rows)


def _parse_json_array(content: str) -> tuple[list[str], list[dict], int]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("JSON must be a top-level array of objects")
    if not data:
        raise ValueError("JSON array is empty")
    if not isinstance(data[0], dict):
        raise ValueError("JSON elements must be objects")
    headers = list(dict.fromkeys(k for row in data for k in row))
    rows = [
        {h: '' if row.get(h) is None else str(row[h]) for h in headers}
        for row in data
    ]
    return headers, rows, len(rows)


def _detect_format(filename: str, content: str) -> str:
    if filename.lower().endswith('.json'):
        return 'json'
    stripped = content.lstrip()
    if stripped.startswith('[') or stripped.startswith('{'):
        return 'json'
    return 'csv'


def _safe_col_name(name: str) -> str:
    s = re.sub(r'[^\w]', '_', name.strip())
    s = re.sub(r'_+', '_', s).strip('_')
    return s or 'col'


def _sql_type(inferred: str, db_type: str) -> str:
    if inferred == "INTEGER":
        return "INTEGER"
    if inferred == "REAL":
        return "DOUBLE PRECISION" if db_type == "postgres" else "REAL"
    return "TEXT"


def _coerce(val: str | None, sql_type: str) -> Any:
    if val is None or val == '':
        return None
    if sql_type == "INTEGER":
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return None
    if sql_type in ("REAL", "DOUBLE PRECISION"):
        try:
            return float(val)
        except (ValueError, TypeError):
            return None
    return val


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{db_id}/import/preview")
async def import_preview(
    db_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Parse an uploaded CSV or JSON file and return column metadata + preview rows."""
    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    content = raw.decode('utf-8-sig', errors='replace')
    filename = file.filename or 'upload'
    fmt = _detect_format(filename, content)

    try:
        if fmt == 'json':
            headers, rows, total = _parse_json_array(content)
        else:
            headers, rows, total = _parse_csv(content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not headers:
        raise HTTPException(status_code=422, detail="No columns detected in file")
    if total > _MAX_IMPORT_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"File has {total:,} rows; maximum is {_MAX_IMPORT_ROWS:,}",
        )

    columns = [
        {
            "original_name": h,
            "name": _safe_col_name(h),
            "inferred_type": _infer_type([row.get(h, '') for row in rows]),
        }
        for h in headers
    ]

    stem = filename.rsplit('.', 1)[0] if '.' in filename else filename
    default_table = re.sub(r'[^\w]', '_', stem.strip()).strip('_').lower() or 'imported'

    return {
        "format": fmt,
        "total_rows": total,
        "columns": columns,
        "preview": rows[:_MAX_PREVIEW_ROWS],
        "default_table_name": default_table,
    }


@router.post("/{db_id}/import/execute")
async def import_execute(
    db_id: str,
    file: UploadFile = File(...),
    table_name: str = Form(...),
    if_exists: str = Form("fail"),
    column_types: str = Form("{}"),
    db: Session = Depends(get_db),
):
    """Import a CSV or JSON file into a database table."""
    if if_exists not in ("fail", "replace", "append"):
        raise HTTPException(status_code=422, detail="if_exists must be fail, replace, or append")
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name):
        raise HTTPException(status_code=422, detail="Invalid table name (letters, digits, underscores only)")

    try:
        col_types_override: dict[str, str] = json.loads(column_types)
    except json.JSONDecodeError:
        col_types_override = {}

    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    content = raw.decode('utf-8-sig', errors='replace')
    filename = file.filename or 'upload'
    fmt = _detect_format(filename, content)

    try:
        if fmt == 'json':
            headers, rows, total = _parse_json_array(content)
        else:
            headers, rows, total = _parse_csv(content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not headers:
        raise HTTPException(status_code=422, detail="No columns detected")
    if total > _MAX_IMPORT_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"File has {total:,} rows; maximum is {_MAX_IMPORT_ROWS:,}",
        )

    driver = get_driver_for_db(db_id, db)
    db_type = get_db_type(db_id, db)
    conn = driver.connect()

    try:
        col_map = []
        for h in headers:
            inferred = _infer_type([row.get(h, '') for row in rows])
            override = col_types_override.get(h, inferred)
            if override not in ("TEXT", "INTEGER", "REAL"):
                override = inferred
            st = _sql_type(override, db_type)
            col_map.append({"original": h, "safe": _safe_col_name(h), "sql_type": st})

        table_q = driver.quote_identifier(table_name)
        existing = driver.list_table_names(conn)

        if table_name in existing:
            if if_exists == "fail":
                raise HTTPException(
                    status_code=409,
                    detail=f"Table '{table_name}' already exists. Choose 'Replace' or 'Append'.",
                )
            if if_exists == "replace":
                driver.execute(conn, f"DROP TABLE IF EXISTS {table_q}")

        if table_name not in existing or if_exists == "replace":
            col_defs = ", ".join(
                f"{driver.quote_identifier(c['safe'])} {c['sql_type']}"
                for c in col_map
            )
            driver.execute(conn, f"CREATE TABLE {table_q} ({col_defs})")

        if rows:
            ph = driver.placeholder
            col_names_q = ", ".join(driver.quote_identifier(c['safe']) for c in col_map)
            placeholders = ", ".join([ph] * len(col_map))
            insert_sql = f"INSERT INTO {table_q} ({col_names_q}) VALUES ({placeholders})"

            cursor = conn.cursor()
            batch_size = 500
            for i in range(0, len(rows), batch_size):
                batch = [
                    tuple(
                        _coerce(row.get(c['original'], ''), c['sql_type'])
                        for c in col_map
                    )
                    for row in rows[i : i + batch_size]
                ]
                cursor.executemany(insert_sql, batch)
            conn.commit()

        logger.info(
            "Imported %d rows into '%s' (db_id=%s, if_exists=%s)",
            len(rows), table_name, db_id, if_exists,
        )
        return {"table_name": table_name, "rows_imported": len(rows)}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Import failed for db_id=%s table='%s': %s", db_id, table_name, exc)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        driver.close(conn)
