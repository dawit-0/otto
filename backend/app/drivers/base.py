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
    def update_row(self, conn: Any, table: str, pk: dict, values: dict) -> dict:
        """Update the single row matched by ``pk`` (column -> value) with
        ``values`` (column -> value). Returns the updated row.

        Raises ``ValueError`` if the table/columns are invalid, ``pk`` or
        ``values`` is empty, or no row matches ``pk``.
        """
        ...

    @abstractmethod
    def insert_row(self, conn: Any, table: str, values: dict) -> dict:
        """Insert a new row with ``values`` (column -> value). Columns not
        present in ``values`` are left to the database's default. Returns
        the inserted row.
        """
        ...

    @abstractmethod
    def delete_row(self, conn: Any, table: str, pk: dict) -> None:
        """Delete the single row matched by ``pk`` (column -> value).

        Raises ``ValueError`` if the table/columns are invalid, ``pk`` is
        empty, or no row matches ``pk``.
        """
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

    def check_row_columns(self, conn: Any, table: str, *column_dicts: dict) -> None:
        """Validate ``table`` and that every key in ``column_dicts`` is a real column."""
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        for d in column_dicts:
            for col in d:
                if col not in valid_columns:
                    raise ValueError(f"Unknown column: {col!r}")

    def build_update_sql(self, table: str, pk: dict, values: dict) -> tuple[str, list]:
        ph = self.placeholder
        set_clause = ", ".join(f"{self.quote_identifier(c)} = {ph}" for c in values)
        where_clause = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk)
        sql = f"UPDATE {self.quote_identifier(table)} SET {set_clause} WHERE {where_clause}"
        return sql, [*values.values(), *pk.values()]

    def build_insert_sql(self, table: str, values: dict) -> tuple[str, list]:
        ph = self.placeholder
        cols = ", ".join(self.quote_identifier(c) for c in values)
        placeholders = ", ".join([ph] * len(values))
        sql = f"INSERT INTO {self.quote_identifier(table)} ({cols}) VALUES ({placeholders})"
        return sql, list(values.values())

    def build_delete_sql(self, table: str, pk: dict) -> tuple[str, list]:
        ph = self.placeholder
        where_clause = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk)
        sql = f"DELETE FROM {self.quote_identifier(table)} WHERE {where_clause}"
        return sql, list(pk.values())
