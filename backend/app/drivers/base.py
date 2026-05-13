from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DatabaseDriver(ABC):

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
    ) -> dict:
        """Return {columns, rows, total, limit, offset}."""
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
