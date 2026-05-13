"""Helpers for safely embedding SQL identifiers in queries.

These utilities work with both SQLite and PostgreSQL — double-quote escaping
is the SQL standard for identifiers.
"""

from __future__ import annotations

from typing import Any


def quote_identifier(name: str) -> str:
    """Return a safely quoted SQL identifier.

    Wraps the name in double quotes and escapes any embedded double quote by
    doubling it, matching the SQL standard identifier syntax.
    """
    if not isinstance(name, str):
        raise ValueError("Identifier must be a string")
    if name == "":
        raise ValueError("Identifier must not be empty")
    if "\x00" in name:
        raise ValueError("Identifier must not contain NUL bytes")
    return '"' + name.replace('"', '""') + '"'
