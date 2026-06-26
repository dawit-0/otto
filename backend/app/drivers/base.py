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
    def _execute_write(self, conn: Any, sql: str, params: list) -> int:
        """Execute a parameterized write statement, commit, and return rowcount."""
        ...

    def get_primary_key_columns(self, conn: Any, table: str) -> list[str]:
        info = self.get_table_info(conn)
        table_info = next((t for t in info if t["name"] == table), None)
        if table_info is None:
            return []
        return [c["name"] for c in table_info["columns"] if c["pk"]]

    def update_row(
        self, conn: Any, table: str, pk_values: dict[str, Any], changes: dict[str, Any],
    ) -> dict:
        """Update a single row identified by its primary key.

        ``pk_values`` must supply exactly the table's primary-key columns;
        any of those keys present in ``changes`` are ignored, since renaming
        a row's identity through an inline edit is not supported.
        """
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        pk_cols = sorted(self.get_primary_key_columns(conn, table))
        if not pk_cols:
            raise ValueError("Table has no primary key; rows cannot be updated")

        unknown_pk = set(pk_values) - valid_columns
        if unknown_pk:
            raise ValueError(f"Unknown column: {sorted(unknown_pk)[0]!r}")
        if set(pk_values) != set(pk_cols):
            raise ValueError("Primary key values must include exactly: " + ", ".join(pk_cols))

        edit_cols = {k: v for k, v in changes.items() if k not in pk_cols}
        unknown_change = set(edit_cols) - valid_columns
        if unknown_change:
            raise ValueError(f"Unknown column: {sorted(unknown_change)[0]!r}")
        if not edit_cols:
            raise ValueError("No editable columns supplied")

        edit_names = sorted(edit_cols)
        ph = self.placeholder
        set_sql = ", ".join(f"{self.quote_identifier(c)} = {ph}" for c in edit_names)
        where_sql = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk_cols)
        params = [edit_cols[c] for c in edit_names] + [pk_values[c] for c in pk_cols]

        sql = f"UPDATE {self.quote_identifier(table)} SET {set_sql} WHERE {where_sql}"
        affected = self._execute_write(conn, sql, params)
        if affected == 0:
            raise ValueError("Row not found")
        return {"affected_rows": affected}

    def insert_row(self, conn: Any, table: str, values: dict[str, Any]) -> dict:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        if not values:
            raise ValueError("No values supplied")
        unknown = set(values) - valid_columns
        if unknown:
            raise ValueError(f"Unknown column: {sorted(unknown)[0]!r}")

        col_names = sorted(values)
        ph = self.placeholder
        col_sql = ", ".join(self.quote_identifier(c) for c in col_names)
        val_sql = ", ".join([ph] * len(col_names))
        params = [values[c] for c in col_names]

        sql = f"INSERT INTO {self.quote_identifier(table)} ({col_sql}) VALUES ({val_sql})"
        affected = self._execute_write(conn, sql, params)
        return {"affected_rows": affected}

    def delete_row(self, conn: Any, table: str, pk_values: dict[str, Any]) -> dict:
        self.assert_valid_table(conn, table)
        valid_columns = set(self.get_column_names(conn, table))
        pk_cols = sorted(self.get_primary_key_columns(conn, table))
        if not pk_cols:
            raise ValueError("Table has no primary key; rows cannot be deleted")

        unknown = set(pk_values) - valid_columns
        if unknown:
            raise ValueError(f"Unknown column: {sorted(unknown)[0]!r}")
        if set(pk_values) != set(pk_cols):
            raise ValueError("Primary key values must include exactly: " + ", ".join(pk_cols))

        ph = self.placeholder
        where_sql = " AND ".join(f"{self.quote_identifier(c)} = {ph}" for c in pk_cols)
        params = [pk_values[c] for c in pk_cols]

        sql = f"DELETE FROM {self.quote_identifier(table)} WHERE {where_sql}"
        affected = self._execute_write(conn, sql, params)
        if affected == 0:
            raise ValueError("Row not found")
        return {"affected_rows": affected}

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
