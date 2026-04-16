"""Helpers for safely embedding SQLite identifiers in queries.

SQLite's driver only supports binding values, not identifiers (table/column/
index names). We cannot use parameterized queries for schema objects, so we
must (a) quote them correctly and (b) verify they exist in the target database
before interpolating them into SQL.
"""

from __future__ import annotations

import sqlite3


def quote_identifier(name: str) -> str:
    """Return a safely quoted SQLite identifier.

    Wraps the name in double quotes and escapes any embedded double quote by
    doubling it, matching SQLite's identifier syntax. Rejects NUL bytes, which
    SQLite cannot represent in an identifier and which would silently truncate
    the string at the C API boundary.
    """
    if not isinstance(name, str):
        raise ValueError("Identifier must be a string")
    if name == "":
        raise ValueError("Identifier must not be empty")
    if "\x00" in name:
        raise ValueError("Identifier must not contain NUL bytes")
    return '"' + name.replace('"', '""') + '"'


def list_table_names(conn: sqlite3.Connection) -> set[str]:
    """Return the set of table names defined in the connected database."""
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    return {row[0] for row in cursor.fetchall()}


def assert_valid_table(conn: sqlite3.Connection, table_name: str) -> str:
    """Verify a table exists and return it (for fluent use).

    Raises ``ValueError`` if the table is not present. Callers are expected to
    translate this into an HTTP 404.
    """
    if not isinstance(table_name, str) or table_name == "":
        raise ValueError("Table name must be a non-empty string")
    if table_name not in list_table_names(conn):
        raise ValueError(f"Unknown table: {table_name}")
    return table_name
