from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.drivers.base import DatabaseDriver
from app.logging import get_logger
from app.routes.databases import get_driver_for_db

logger = get_logger("rows")

router = APIRouter(prefix="/api/databases", tags=["rows"])


class InsertRowRequest(BaseModel):
    values: dict[str, Any]


class UpdateRowRequest(BaseModel):
    pk: dict[str, Any]
    values: dict[str, Any]


class DeleteRowRequest(BaseModel):
    pk: dict[str, Any]


def _require_pk(driver: DatabaseDriver, conn: Any, table_name: str) -> None:
    if not driver.get_primary_key_columns(conn, table_name):
        raise HTTPException(
            status_code=400,
            detail=f"Table '{table_name}' has no primary key; row editing is not supported.",
        )


@router.post("/{db_id}/tables/{table_name}/rows")
def insert_row(db_id: str, table_name: str, req: InsertRowRequest, db: Session = Depends(get_db)):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        row = driver.insert_row(conn, table_name, req.values)
        logger.info("Inserted row into '%s' (db_id=%s)", table_name, db_id)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.put("/{db_id}/tables/{table_name}/rows")
def update_row(db_id: str, table_name: str, req: UpdateRowRequest, db: Session = Depends(get_db)):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        _require_pk(driver, conn, table_name)
        if not req.pk:
            raise HTTPException(status_code=400, detail="pk is required to update a row")
        row = driver.update_row(conn, table_name, req.pk, req.values)
        logger.info("Updated row in '%s' (db_id=%s)", table_name, db_id)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)


@router.delete("/{db_id}/tables/{table_name}/rows")
def delete_row(db_id: str, table_name: str, req: DeleteRowRequest, db: Session = Depends(get_db)):
    driver = get_driver_for_db(db_id, db)
    conn = driver.connect()
    try:
        driver.assert_valid_table(conn, table_name)
        _require_pk(driver, conn, table_name)
        if not req.pk:
            raise HTTPException(status_code=400, detail="pk is required to delete a row")
        driver.delete_row(conn, table_name, req.pk)
        logger.info("Deleted row from '%s' (db_id=%s)", table_name, db_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        driver.close(conn)
