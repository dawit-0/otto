from __future__ import annotations

from app.drivers.base import DatabaseDriver
from app.drivers.sqlite import SQLiteDriver
from app.drivers.postgres import PostgresDriver

__all__ = ["DatabaseDriver", "SQLiteDriver", "PostgresDriver", "get_driver"]


def get_driver(record) -> DatabaseDriver:
    if record.db_type == "postgres":
        return PostgresDriver(record.connection_string)
    return SQLiteDriver(record.path)
