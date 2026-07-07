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
    def insert_row(self, conn: Any, table: str, values: dict) -> dict:
        """Insert a new row. Returns the inserted row as a dict."""
        ...

    @abstractmethod
    def update_row(self, conn: Any, table: str, pk_values: dict, updates: dict) -> dict:
        """Update a row identified by pk_values. Returns the updated row."""
        ...

    @abstractmethod
    def delete_row(self, conn: Any, table: str, pk_values: dict) -> int:
        """Delete a row identified by pk_values. Returns affected row count."""
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
