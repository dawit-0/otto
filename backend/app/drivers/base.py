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
    def get_pk_columns(self, conn: Any, table: str) -> list[str]:
        """Return the primary-key column names for a table (empty if none)."""
        ...

    @abstractmethod
    def execute_params(self, conn: Any, sql: str, params: list) -> tuple[list[str], list[dict], int]:
        """Execute a parameterized statement and commit automatically.

        Returns (column_names, rows_as_dicts, rowcount). Unlike ``execute``,
        this never interpolates values into the SQL text, so it's the
        primitive row-edit operations build on.
        """
        ...

    @abstractmethod
    def validate(self) -> None:
        """Test connectivity. Raise on failure."""
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

    def update_row(self, conn: Any, table: str, pk_values: dict, updates: dict) -> int:
        """Update a single row identified by its primary key.

        Returns the number of rows matched by the primary key (0 if the row
        no longer exists). Refuses to run the UPDATE unless exactly one row
        matches, so a bad or stale primary key can never edit multiple rows.
        """
        self.assert_valid_table(conn, table)
        pk_columns = set(self.get_pk_columns(conn, table))
        if not pk_columns:
            raise ValueError(f"Table '{table}' has no primary key, so rows cannot be edited safely")
        if set(pk_values) != pk_columns:
            raise ValueError("Primary key values do not match the table's primary key columns")
        if not updates:
            raise ValueError("No fields to update")
        valid_columns = set(self.get_column_names(conn, table))
        for col in updates:
            if col not in valid_columns:
                raise ValueError(f"Unknown column: {col!r}")
            if col in pk_columns:
                raise ValueError("Primary key columns cannot be edited")

        ph = self.placeholder
        where_clause = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk_values)
        where_params = list(pk_values.values())

        matched = self._count_matching(conn, table, where_clause, where_params)
        if matched != 1:
            return matched

        set_clause = ", ".join(f"{self.quote_identifier(c)} = {ph}" for c in updates)
        self.execute_params(
            conn,
            f"UPDATE {self.quote_identifier(table)} SET {set_clause} WHERE {where_clause}",
            list(updates.values()) + where_params,
        )
        return 1

    def delete_row(self, conn: Any, table: str, pk_values: dict) -> int:
        """Delete a single row identified by its primary key.

        Returns the number of rows matched (0 if already gone). Refuses to
        run the DELETE unless exactly one row matches.
        """
        self.assert_valid_table(conn, table)
        pk_columns = set(self.get_pk_columns(conn, table))
        if not pk_columns:
            raise ValueError(f"Table '{table}' has no primary key, so rows cannot be deleted safely")
        if set(pk_values) != pk_columns:
            raise ValueError("Primary key values do not match the table's primary key columns")

        ph = self.placeholder
        where_clause = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk_values)
        where_params = list(pk_values.values())

        matched = self._count_matching(conn, table, where_clause, where_params)
        if matched != 1:
            return matched

        self.execute_params(
            conn,
            f"DELETE FROM {self.quote_identifier(table)} WHERE {where_clause}",
            where_params,
        )
        return 1

    def insert_row(self, conn: Any, table: str, values: dict) -> None:
        """Insert a new row. Columns omitted from ``values`` use their DB default."""
        self.assert_valid_table(conn, table)
        if not values:
            raise ValueError("No values to insert")
        valid_columns = set(self.get_column_names(conn, table))
        for col in values:
            if col not in valid_columns:
                raise ValueError(f"Unknown column: {col!r}")

        ph = self.placeholder
        columns_sql = ", ".join(self.quote_identifier(c) for c in values)
        placeholders_sql = ", ".join([ph] * len(values))
        self.execute_params(
            conn,
            f"INSERT INTO {self.quote_identifier(table)} ({columns_sql}) VALUES ({placeholders_sql})",
            list(values.values()),
        )

    def _count_matching(self, conn: Any, table: str, where_clause: str, where_params: list) -> int:
        _, rows, _ = self.execute_params(
            conn,
            f"SELECT COUNT(*) AS cnt FROM {self.quote_identifier(table)} WHERE {where_clause}",
            where_params,
        )
        return int(rows[0]["cnt"]) if rows else 0
