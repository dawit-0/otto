from __future__ import annotations

from typing import Any

import psycopg2
import psycopg2.extras

from app.drivers.base import DatabaseDriver


class PostgresDriver(DatabaseDriver):

    placeholder = "%s"

    def __init__(self, connection_string: str):
        self._dsn = connection_string

    def connect(self) -> Any:
        return psycopg2.connect(self._dsn)

    def close(self, conn: Any) -> None:
        conn.close()

    def execute(self, conn: Any, sql: str) -> tuple[list[str], list[dict]]:
        cursor = conn.cursor()
        cursor.execute(sql)
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return columns, rows
        conn.commit()
        return [], [{"affected_rows": cursor.rowcount}]

    def execute_params(self, conn: Any, sql: str, params: list) -> tuple[list[str], list[dict]]:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return columns, rows
        conn.commit()
        return [], [{"affected_rows": cursor.rowcount}]

    def validate(self) -> None:
        conn = psycopg2.connect(self._dsn)
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.close()
        finally:
            conn.close()

    def list_table_names(self, conn: Any) -> set[str]:
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        )
        names = {row[0] for row in cur.fetchall()}
        cur.close()
        return names

    def get_table_info(self, conn: Any) -> list[dict]:
        table_names = sorted(self.list_table_names(conn))
        tables = []
        for name in table_names:
            columns = self._get_columns(conn, name)
            pk_cols = self._get_pk_columns(conn, name)
            for col in columns:
                col["pk"] = col["name"] in pk_cols

            tables.append({
                "name": name,
                "columns": columns,
                "row_count": self._get_row_count(conn, name),
                "foreign_keys": self._get_foreign_keys(conn, name),
                "indexes": self._get_indexes(conn, name),
            })
        return tables

    def get_column_names(self, conn: Any, table: str) -> list[str]:
        return [c["name"] for c in self._get_columns(conn, table)]

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
            pk_cols = self._get_pk_columns(conn, table)
            if pk_cols:
                order_sql = "ORDER BY " + ", ".join(
                    self.quote_identifier(c) + " DESC" for c in pk_cols
                )

        cur = conn.cursor()
        cur.execute(
            f"SELECT * FROM {quoted} {where_sql} {order_sql} LIMIT %s OFFSET %s",
            (*where_params, limit, offset),
        )
        columns = [desc[0] for desc in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

        cur.execute(f"SELECT COUNT(*) FROM {quoted} {where_sql}", where_params)
        total = cur.fetchone()[0]
        cur.close()

        return {
            "columns": columns,
            "rows": rows,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    # ── Private helpers ──

    def _get_columns(self, conn: Any, table: str) -> list[dict]:
        cur = conn.cursor()
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s "
            "ORDER BY ordinal_position",
            (table,),
        )
        columns = []
        for row in cur.fetchall():
            columns.append({
                "name": row[0],
                "type": row[1],
                "notnull": row[2] == "NO",
                "pk": False,
                "default": row[3],
            })
        cur.close()
        return columns

    def _get_pk_columns(self, conn: Any, table: str) -> list[str]:
        cur = conn.cursor()
        cur.execute(
            "SELECT kcu.column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu "
            "  ON tc.constraint_name = kcu.constraint_name "
            "  AND tc.table_schema = kcu.table_schema "
            "WHERE tc.table_schema = 'public' "
            "  AND tc.table_name = %s "
            "  AND tc.constraint_type = 'PRIMARY KEY' "
            "ORDER BY kcu.ordinal_position",
            (table,),
        )
        cols = [row[0] for row in cur.fetchall()]
        cur.close()
        return cols

    def _get_foreign_keys(self, conn: Any, table: str) -> list[dict]:
        cur = conn.cursor()
        cur.execute(
            "SELECT kcu.column_name, ccu.table_name, ccu.column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu "
            "  ON tc.constraint_name = kcu.constraint_name "
            "  AND tc.table_schema = kcu.table_schema "
            "JOIN information_schema.constraint_column_usage ccu "
            "  ON tc.constraint_name = ccu.constraint_name "
            "  AND tc.table_schema = ccu.table_schema "
            "WHERE tc.table_schema = 'public' "
            "  AND tc.table_name = %s "
            "  AND tc.constraint_type = 'FOREIGN KEY'",
            (table,),
        )
        fks = []
        for row in cur.fetchall():
            fks.append({
                "from_column": row[0],
                "to_table": row[1],
                "to_column": row[2],
            })
        cur.close()
        return fks

    def _get_indexes(self, conn: Any, table: str) -> list[dict]:
        cur = conn.cursor()
        cur.execute(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND tablename = %s",
            (table,),
        )
        indexes = []
        for row in cur.fetchall():
            indexname, indexdef = row
            unique = "UNIQUE" in indexdef.upper()
            cols = self._parse_index_columns(indexdef)
            indexes.append({
                "name": indexname,
                "unique": unique,
                "columns": cols,
            })
        cur.close()
        return indexes

    def _get_row_count(self, conn: Any, table: str) -> int:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {self.quote_identifier(table)}")
        count = cur.fetchone()[0]
        cur.close()
        return count

    @staticmethod
    def _parse_index_columns(indexdef: str) -> list[str]:
        start = indexdef.rfind("(")
        end = indexdef.rfind(")")
        if start == -1 or end == -1:
            return []
        col_str = indexdef[start + 1 : end]
        return [c.strip().strip('"') for c in col_str.split(",")]
