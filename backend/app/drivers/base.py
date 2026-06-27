from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


ALLOWED_FILTER_OPS = {
    "contains", "equals", "not_equals", "starts_with",
    "gt", "lt", "gte", "lte",
    "is_null", "is_not_null",
}


class DatabaseDriver(ABC):

    # Subclasses override with their parameter placeholder ("?" or "%s")
    placeholder: str = "?"

    @abstractmethod
    def connect(self) -> Any:
        ...

    @abstractmethod
    def close(self, conn: Any) -> None:
        ...

    @abstractmethod
    def execute(self, conn: Any, sql: str) -> tuple[list[str], list[dict]]:
        """Execute SQL and return (column_names, rows_as_dicts).

        Commits automatically for DML statements (no cursor.description).
        """
        ...

    @abstractmethod
    def explain_analyze(self, conn: Any, sql: str) -> dict:
        """Run the database's EXPLAIN ANALYZE equivalent for ``sql``.

        Each driver implements this against its own dialect (PostgreSQL's
        ``EXPLAIN ANALYZE`` vs SQLite's ``EXPLAIN QUERY PLAN``) but normalizes
        the result into a common shape::

            {
                "command": str,   # the SQL command actually issued
                "format": str,    # "text" or "tree" (hint for the UI)
                "summary": dict,  # high-level metrics, e.g. timing (may be empty)
                "text": str,      # human-readable plan for display
                "rows": list,     # the raw plan rows, dialect-specific
            }
        """
        ...

    @abstractmethod
    def get_table_info(self, conn: Any) -> list[dict]:
        """Return schema in standard format:
        [{name, columns, row_count, foreign_keys, indexes}]
        """
        ...

    @abstractmethod
    def list_table_names(self, conn: Any) -> set[str]:
        ...

    @abstractmethod
    def get_table_data(
        self, conn: Any, table: str, limit: int, offset: int,
        sort_column: str | None = None,
        sort_direction: str = "asc",
        filters: list[dict] | None = None,
    ) -> dict:
        """Return {columns, rows, total, limit, offset}."""
        ...

    @abstractmethod
    def get_column_names(self, conn: Any, table: str) -> list[str]:
        """Return the ordered list of column names for a table."""
        ...

    @abstractmethod
    def validate(self) -> None:
        """Test connectivity. Raise on failure."""
        ...

    @abstractmethod
    def execute_params(self, conn: Any, sql: str, params: list) -> int:
        """Execute a parameterized DML statement, commit, and return the
        number of affected rows."""
        ...

    def quote_identifier(self, name: str) -> str:
        if not isinstance(name, str) or name == "":
            raise ValueError("Identifier must be a non-empty string")
        if "\x00" in name:
            raise ValueError("Identifier must not contain NUL bytes")
        return '"' + name.replace('"', '""') + '"'

    def assert_valid_table(self, conn: Any, table_name: str) -> str:
        if not isinstance(table_name, str) or table_name == "":
            raise ValueError("Table name must be a non-empty string")
        if table_name not in self.list_table_names(conn):
            raise ValueError(f"Unknown table: {table_name}")
        return table_name

    def build_filter_clause(
        self,
        filters: list[dict],
        valid_columns: set[str],
    ) -> tuple[str, list]:
        """Build a safe parameterized WHERE clause from a filter list.

        Each filter is a dict with keys: col, op, val. Column names are
        validated against ``valid_columns``; operators against ALLOWED_FILTER_OPS.
        Values are returned as a parallel param list so the caller binds them
        with the driver's parameter API.
        """
        if not filters:
            return "", []
        ph = self.placeholder
        clauses: list[str] = []
        params: list = []
        for f in filters:
            col = f.get("col", "")
            op = f.get("op", "")
            val = f.get("val", "")
            if col not in valid_columns:
                raise ValueError(f"Unknown column: {col!r}")
            if op not in ALLOWED_FILTER_OPS:
                raise ValueError(f"Unknown operator: {op!r}")
            qcol = self.quote_identifier(col)
            if op == "contains":
                clauses.append(f"CAST({qcol} AS TEXT) LIKE {ph}")
                params.append(f"%{val}%")
            elif op == "starts_with":
                clauses.append(f"CAST({qcol} AS TEXT) LIKE {ph}")
                params.append(f"{val}%")
            elif op == "equals":
                clauses.append(f"{qcol} = {ph}")
                params.append(val)
            elif op == "not_equals":
                clauses.append(f"{qcol} != {ph}")
                params.append(val)
            elif op == "gt":
                clauses.append(f"{qcol} > {ph}")
                params.append(val)
            elif op == "lt":
                clauses.append(f"{qcol} < {ph}")
                params.append(val)
            elif op == "gte":
                clauses.append(f"{qcol} >= {ph}")
                params.append(val)
            elif op == "lte":
                clauses.append(f"{qcol} <= {ph}")
                params.append(val)
            elif op == "is_null":
                clauses.append(f"{qcol} IS NULL")
            elif op == "is_not_null":
                clauses.append(f"{qcol} IS NOT NULL")
        return "WHERE " + " AND ".join(clauses), params

    def build_order_by(
        self,
        sort_column: str | None,
        sort_direction: str,
        valid_columns: set[str],
    ) -> str:
        if not sort_column:
            return ""
        if sort_column not in valid_columns:
            raise ValueError(f"Unknown column: {sort_column!r}")
        direction = "DESC" if (sort_direction or "asc").lower() == "desc" else "ASC"
        return f"ORDER BY {self.quote_identifier(sort_column)} {direction}"

    def get_primary_key_columns(self, conn: Any, table: str) -> list[str]:
        """Return the primary key column names for ``table``, in order.
        Empty if the table has no primary key."""
        for t in self.get_table_info(conn):
            if t["name"] == table:
                return [c["name"] for c in t["columns"] if c["pk"]]
        return []

    @staticmethod
    def format_literal(value: Any) -> str:
        """Render a value as a SQL literal for display purposes (query
        history, audit trail). Never used to build executed SQL."""
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return str(value)
        return "'" + str(value).replace("'", "''") + "'"

    def _validate_columns(self, conn: Any, table: str, columns: list[str]) -> None:
        valid_columns = set(self.get_column_names(conn, table))
        for col in columns:
            if col not in valid_columns:
                raise ValueError(f"Unknown column: {col!r}")

    def render_update_sql(self, table: str, pk_values: dict, updates: dict) -> str:
        set_sql = ", ".join(
            f"{self.quote_identifier(c)} = {self.format_literal(v)}" for c, v in updates.items()
        )
        where_sql = " AND ".join(
            f"{self.quote_identifier(c)} = {self.format_literal(v)}" for c, v in pk_values.items()
        )
        return f"UPDATE {self.quote_identifier(table)} SET {set_sql} WHERE {where_sql}"

    def render_insert_sql(self, table: str, values: dict) -> str:
        cols_sql = ", ".join(self.quote_identifier(c) for c in values)
        vals_sql = ", ".join(self.format_literal(v) for v in values.values())
        return f"INSERT INTO {self.quote_identifier(table)} ({cols_sql}) VALUES ({vals_sql})"

    def render_delete_sql(self, table: str, pk_values: dict) -> str:
        where_sql = " AND ".join(
            f"{self.quote_identifier(c)} = {self.format_literal(v)}" for c, v in pk_values.items()
        )
        return f"DELETE FROM {self.quote_identifier(table)} WHERE {where_sql}"

    def update_row(self, conn: Any, table: str, pk_values: dict, updates: dict) -> int:
        """Update the single row matched by ``pk_values`` with ``updates``.
        Returns the number of affected rows."""
        self.assert_valid_table(conn, table)
        if not pk_values:
            raise ValueError("Row updates require primary key values")
        if not updates:
            return 0
        self._validate_columns(conn, table, [*pk_values, *updates])
        ph = self.placeholder
        set_clause = ", ".join(f"{self.quote_identifier(c)} = {ph}" for c in updates)
        where_clause = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk_values)
        sql = f"UPDATE {self.quote_identifier(table)} SET {set_clause} WHERE {where_clause}"
        return self.execute_params(conn, sql, [*updates.values(), *pk_values.values()])

    def insert_row(self, conn: Any, table: str, values: dict) -> int:
        """Insert a new row. Columns omitted from ``values`` fall back to the
        table's defaults (e.g. autoincrement primary keys)."""
        self.assert_valid_table(conn, table)
        if not values:
            raise ValueError("Insert requires at least one column value")
        self._validate_columns(conn, table, list(values))
        ph = self.placeholder
        cols_sql = ", ".join(self.quote_identifier(c) for c in values)
        placeholders_sql = ", ".join(ph for _ in values)
        sql = f"INSERT INTO {self.quote_identifier(table)} ({cols_sql}) VALUES ({placeholders_sql})"
        return self.execute_params(conn, sql, list(values.values()))

    def delete_row(self, conn: Any, table: str, pk_values: dict) -> int:
        """Delete the single row matched by ``pk_values``. Returns the number
        of affected rows."""
        self.assert_valid_table(conn, table)
        if not pk_values:
            raise ValueError("Row deletion requires primary key values")
        self._validate_columns(conn, table, list(pk_values))
        where_clause = " AND ".join(
            f"{self.quote_identifier(c)} = {self.placeholder}" for c in pk_values
        )
        sql = f"DELETE FROM {self.quote_identifier(table)} WHERE {where_clause}"
        return self.execute_params(conn, sql, list(pk_values.values()))
