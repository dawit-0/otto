from __future__ import annotations

import sqlite3
from typing import Any

from app.drivers.base import DatabaseDriver

# Public name used to expose SQLite's implicit `rowid` as a row identifier.
# A plain `rowid` alias in `SELECT *, rowid` resolves to the existing INTEGER
# PRIMARY KEY column name (if any), so we give it a name that can never
# collide with a real column and is safe to round-trip through the API.
ROWID_ALIAS = "__row_id__"


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

    def get_editable_row_id_columns(self, conn: Any, table: str) -> list[str] | None:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        if "rowid" in valid_columns or ROWID_ALIAS in valid_columns:
            # A real column shadows the rowid alias — too ambiguous to edit safely.
            return None
        quoted = self.quote_identifier(table)
        try:
            conn.execute(f"SELECT rowid FROM {quoted} LIMIT 0")
        except sqlite3.OperationalError:
            # WITHOUT ROWID tables have no rowid alias.
            return None
        return [ROWID_ALIAS]

    def _select_by_rowid(self, conn: Any, table: str, rowid: Any) -> dict:
        quoted = self.quote_identifier(table)
        alias = self.quote_identifier(ROWID_ALIAS)
        row = conn.execute(
            f"SELECT *, rowid AS {alias} FROM {quoted} WHERE rowid = ?", (rowid,)
        ).fetchone()
        return dict(row) if row else {}

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

        row_id_columns = self.get_editable_row_id_columns(conn, table)
        editable = row_id_columns == [ROWID_ALIAS]
        select_extra = f", rowid AS {self.quote_identifier(ROWID_ALIAS)}" if editable else ""
        if not order_sql and editable:
            order_sql = "ORDER BY rowid DESC"

        data_sql = f"SELECT *{select_extra} FROM {quoted} {where_sql} {order_sql} LIMIT ? OFFSET ?"
        cursor = conn.execute(data_sql, (*where_params, limit, offset))
        columns = [desc[0] for desc in cursor.description]
        if select_extra:
            columns = columns[:-1]
        rows = [dict(row) for row in cursor.fetchall()]

        count_sql = f"SELECT COUNT(*) FROM {quoted} {where_sql}"
        count = conn.execute(count_sql, where_params).fetchone()[0]

        return {
            "columns": columns,
            "rows": rows,
            "total": count,
            "limit": limit,
            "offset": offset,
            "row_id_columns": row_id_columns,
        }

    def insert_row(self, conn: Any, table: str, values: dict[str, Any]) -> dict:
        self.assert_valid_table(conn, table)
        quoted = self.quote_identifier(table)
        valid_columns = set(self.get_column_names(conn, table))
        unknown = set(values) - valid_columns
        if unknown:
            raise ValueError(f"Unknown column(s): {', '.join(sorted(unknown))}")

        if values:
            cols_sql = ", ".join(self.quote_identifier(c) for c in values)
            placeholders = ", ".join("?" for _ in values)
            sql = f"INSERT INTO {quoted} ({cols_sql}) VALUES ({placeholders})"
            params = list(values.values())
        else:
            sql = f"INSERT INTO {quoted} DEFAULT VALUES"
            params = []

        cursor = conn.execute(sql, params)
        conn.commit()

        if self.get_editable_row_id_columns(conn, table) != [ROWID_ALIAS]:
            # WITHOUT ROWID tables can't be re-fetched by rowid; echo back what
            # was inserted (defaults applied by the DB won't be reflected).
            return dict(values)

        return self._select_by_rowid(conn, table, cursor.lastrowid)

    def _rowid_alias_column(self, conn: Any, table: str) -> str | None:
        """Return the single-column INTEGER PRIMARY KEY name, if any.

        Such a column is a direct alias for ``rowid``, so updating it changes
        which ``rowid`` the row lives at.
        """
        quoted = self.quote_identifier(table)
        cols = conn.execute(f"PRAGMA table_info({quoted})").fetchall()
        pk_cols = [c for c in cols if c["pk"] == 1]
        if len(pk_cols) == 1 and (pk_cols[0]["type"] or "").upper() == "INTEGER":
            return pk_cols[0]["name"]
        return None

    def update_row(self, conn: Any, table: str, row_id: dict[str, Any], values: dict[str, Any]) -> dict:
        self.assert_valid_table(conn, table)
        id_cols = self.get_editable_row_id_columns(conn, table)
        if id_cols is None:
            raise ValueError(f"Table '{table}' has no row identifier and cannot be edited")
        if set(row_id) != set(id_cols):
            raise ValueError("row_id must match the table's identifier columns")
        if not values:
            raise ValueError("No values to update")
        valid_columns = set(self.get_column_names(conn, table))
        unknown = set(values) - valid_columns
        if unknown:
            raise ValueError(f"Unknown column(s): {', '.join(sorted(unknown))}")

        quoted = self.quote_identifier(table)
        set_sql = ", ".join(f"{self.quote_identifier(c)} = ?" for c in values)
        old_rowid = row_id[ROWID_ALIAS]
        params = [*values.values(), old_rowid]

        cursor = conn.execute(f"UPDATE {quoted} SET {set_sql} WHERE rowid = ?", params)
        if cursor.rowcount == 0:
            conn.rollback()
            raise ValueError("Row not found")
        conn.commit()

        # If the update changed the INTEGER PRIMARY KEY, the rowid moved too.
        alias_col = self._rowid_alias_column(conn, table)
        new_rowid = values.get(alias_col, old_rowid) if alias_col else old_rowid
        return self._select_by_rowid(conn, table, new_rowid)

    def delete_row(self, conn: Any, table: str, row_id: dict[str, Any]) -> None:
        self.assert_valid_table(conn, table)
        id_cols = self.get_editable_row_id_columns(conn, table)
        if id_cols is None:
            raise ValueError(f"Table '{table}' has no row identifier and cannot be edited")
        if set(row_id) != set(id_cols):
            raise ValueError("row_id must match the table's identifier columns")

        quoted = self.quote_identifier(table)
        cursor = conn.execute(f"DELETE FROM {quoted} WHERE rowid = ?", (row_id[ROWID_ALIAS],))
        if cursor.rowcount == 0:
            conn.rollback()
            raise ValueError("Row not found")
        conn.commit()
