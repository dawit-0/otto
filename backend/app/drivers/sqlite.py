from __future__ import annotations

import sqlite3
from typing import Any

from app.drivers.base import DatabaseDriver


class SQLiteDriver(DatabaseDriver):

    def __init__(self, path: str):
        self._path = path

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        return conn

    def close(self, conn: Any) -> None:
        conn.close()

    def execute(self, conn: Any, sql: str) -> tuple[list[str], list[dict]]:
        cursor = conn.execute(sql)
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return columns, rows
        conn.commit()
        return [], [{"affected_rows": cursor.rowcount}]

    def validate(self) -> None:
        conn = sqlite3.connect(self._path)
        try:
            conn.execute("SELECT 1")
        finally:
            conn.close()

    def list_table_names(self, conn: Any) -> set[str]:
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        return {row[0] for row in cursor.fetchall()}

    def get_table_info(self, conn: Any) -> list[dict]:
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = []
        for row in cursor.fetchall():
            name = row["name"]
            quoted = self.quote_identifier(name)

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
                quoted_idx = self.quote_identifier(idx["name"])
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

    def get_table_data(
        self, conn: Any, table: str, limit: int, offset: int,
    ) -> dict:
        self.assert_valid_table(conn, table)
        quoted = self.quote_identifier(table)
        cursor = conn.execute(
            f"SELECT * FROM {quoted} ORDER BY rowid DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchall()]
        count = conn.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
        return {
            "columns": columns,
            "rows": rows,
            "total": count,
            "limit": limit,
            "offset": offset,
        }
