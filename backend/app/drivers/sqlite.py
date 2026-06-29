from __future__ import annotations

import sqlite3
from typing import Any

from app.drivers.base import DatabaseDriver


class SQLiteDriver(DatabaseDriver):

    placeholder = "?"

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

    def explain_analyze(self, conn: Any, sql: str) -> dict:
        # SQLite has no runtime "ANALYZE" like PostgreSQL; EXPLAIN QUERY PLAN
        # is the equivalent the optimizer exposes. It is read-only and never
        # executes the underlying statement, so it is safe for any SQL.
        cursor = conn.execute(f"EXPLAIN QUERY PLAN {sql}")
        rows = [dict(row) for row in cursor.fetchall()]
        return {
            "command": "EXPLAIN QUERY PLAN",
            "format": "tree",
            "summary": {},
            "text": self._format_query_plan(rows),
            "rows": rows,
        }

    @staticmethod
    def _format_query_plan(rows: list[dict]) -> str:
        """Render EXPLAIN QUERY PLAN rows as an indented tree.

        Each row carries (id, parent, detail); children reference their parent's
        id, and top-level nodes have parent 0.
        """
        children: dict[int, list[dict]] = {}
        for row in rows:
            children.setdefault(row.get("parent", 0), []).append(row)

        lines: list[str] = []

        def walk(parent_id: int, depth: int) -> None:
            for row in children.get(parent_id, []):
                lines.append("  " * depth + str(row.get("detail", "")))
                walk(row["id"], depth + 1)

        walk(0, 0)
        return "\n".join(lines)

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

    def get_column_names(self, conn: Any, table: str) -> list[str]:
        quoted = self.quote_identifier(table)
        cursor = conn.execute(f"PRAGMA table_info({quoted})")
        return [row["name"] for row in cursor.fetchall()]

    def get_table_data(
        self, conn: Any, table: str, limit: int, offset: int,
        sort_column: str | None = None,
        sort_direction: str = "asc",
        filters: list[dict] | None = None,
    ) -> dict:
        self.assert_valid_table(conn, table)
        quoted = self.quote_identifier(table)
        valid_columns = set(self.get_column_names(conn, table))

        where_sql, where_params = self.build_filter_clause(filters or [], valid_columns)
        order_sql = self.build_order_by(sort_column, sort_direction, valid_columns)
        if not order_sql:
            order_sql = "ORDER BY rowid DESC"

        pk_cols = self.get_primary_key_columns(conn, table)
        use_rowid = pk_cols == ["rowid"]
        select_cols = "rowid AS __rowid, *" if use_rowid else "*"

        data_sql = f"SELECT {select_cols} FROM {quoted} {where_sql} {order_sql} LIMIT ? OFFSET ?"
        cursor = conn.execute(data_sql, (*where_params, limit, offset))
        all_columns = [desc[0] for desc in cursor.description]
        rows = [dict(row) for row in cursor.fetchall()]
        display_columns = [c for c in all_columns if c != "__rowid"]

        count_sql = f"SELECT COUNT(*) FROM {quoted} {where_sql}"
        count = conn.execute(count_sql, where_params).fetchone()[0]

        return {
            "columns": display_columns,
            "rows": rows,
            "total": count,
            "limit": limit,
            "offset": offset,
            "primary_key": pk_cols,
            "editable": True,
        }

    def get_primary_key_columns(self, conn: Any, table: str) -> list[str]:
        self.assert_valid_table(conn, table)
        quoted = self.quote_identifier(table)
        cols_cursor = conn.execute(f"PRAGMA table_info({quoted})")
        pk_rows = sorted(
            (row for row in cols_cursor.fetchall() if row["pk"]),
            key=lambda row: row["pk"],
        )
        if pk_rows:
            return [row["name"] for row in pk_rows]
        # Rowid tables (the vast majority of SQLite tables) always have an
        # implicit, unique `rowid` we can use as a row identity even without
        # a declared PRIMARY KEY. WITHOUT ROWID tables would fail at the SQL
        # layer when this is used, which surfaces as a clear 400 to the user.
        return ["rowid"]

    def _quoted_pk_clause(self, pk: dict[str, Any], valid_columns: set[str]) -> tuple[str, list]:
        allowed = valid_columns | {"rowid"}
        self.assert_valid_columns(pk.keys(), allowed)
        clause = " AND ".join(f"{self.quote_identifier(c)} = ?" for c in pk)
        return clause, list(pk.values())

    def insert_row(self, conn: Any, table: str, values: dict[str, Any]) -> dict[str, Any]:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        self.assert_valid_columns(values.keys(), valid_columns)
        quoted = self.quote_identifier(table)

        if values:
            cols = ", ".join(self.quote_identifier(c) for c in values)
            placeholders = ", ".join("?" for _ in values)
            cursor = conn.execute(
                f"INSERT INTO {quoted} ({cols}) VALUES ({placeholders})",
                list(values.values()),
            )
        else:
            cursor = conn.execute(f"INSERT INTO {quoted} DEFAULT VALUES")
        conn.commit()

        row_cursor = conn.execute(
            f"SELECT rowid AS __rowid, * FROM {quoted} WHERE rowid = ?", (cursor.lastrowid,)
        )
        row = row_cursor.fetchone()
        return dict(row) if row else {}

    def update_row(self, conn: Any, table: str, pk: dict[str, Any], updates: dict[str, Any]) -> None:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        if not pk:
            raise ValueError("pk must not be empty")
        if not updates:
            raise ValueError("updates must not be empty")
        self.assert_valid_columns(updates.keys(), valid_columns)
        where_clause, where_params = self._quoted_pk_clause(pk, valid_columns)

        quoted = self.quote_identifier(table)
        set_clause = ", ".join(f"{self.quote_identifier(c)} = ?" for c in updates)
        cursor = conn.execute(
            f"UPDATE {quoted} SET {set_clause} WHERE {where_clause}",
            [*updates.values(), *where_params],
        )
        conn.commit()
        if cursor.rowcount == 0:
            raise ValueError("Row not found (it may have been modified or deleted)")
        if cursor.rowcount > 1:
            raise ValueError("Update matched more than one row; refusing to proceed")

    def delete_row(self, conn: Any, table: str, pk: dict[str, Any]) -> None:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        if not pk:
            raise ValueError("pk must not be empty")
        where_clause, where_params = self._quoted_pk_clause(pk, valid_columns)

        quoted = self.quote_identifier(table)
        cursor = conn.execute(f"DELETE FROM {quoted} WHERE {where_clause}", where_params)
        conn.commit()
        if cursor.rowcount == 0:
            raise ValueError("Row not found (it may have already been deleted)")
        if cursor.rowcount > 1:
            raise ValueError("Delete matched more than one row; refusing to proceed")
