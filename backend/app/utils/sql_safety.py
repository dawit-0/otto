"""Helpers for safely embedding SQL identifiers in queries.

These utilities work with both SQLite and PostgreSQL — double-quote escaping
is the SQL standard for identifiers.
"""

from __future__ import annotations

import re
from typing import Any

# Statements that mutate or remove existing rows/objects rather than only
# adding new ones. Used to gate the "are you sure?" confirmation flow in the
# query route — INSERT and read-only statements are never destructive.
DESTRUCTIVE_DML = {"UPDATE", "DELETE"}
DESTRUCTIVE_DDL = {"DROP", "TRUNCATE", "ALTER"}

_LEADING_LINE_COMMENT = re.compile(r"\A\s*--[^\n]*\n")
_LEADING_BLOCK_COMMENT = re.compile(r"\A\s*/\*.*?\*/", re.DOTALL)
_LEADING_KEYWORD = re.compile(r"\s*([A-Za-z]+)")


def classify_statement(sql: str) -> str:
    """Return the uppercased leading keyword of a SQL statement.

    Skips leading whitespace and SQL comments first, so a commented-out
    statement like ``-- note\\n  delete from t`` still classifies as
    ``"DELETE"``.
    """
    text = sql
    while True:
        match = _LEADING_LINE_COMMENT.match(text) or _LEADING_BLOCK_COMMENT.match(text)
        if not match:
            break
        text = text[match.end():]
    match = _LEADING_KEYWORD.match(text)
    return match.group(1).upper() if match else ""


def has_where_clause(sql: str) -> bool:
    """Heuristic check for a top-level WHERE clause.

    Used only to decide how strongly to word a confirmation warning, so a
    false positive from "WHERE" appearing inside a string literal is a
    harmless cosmetic miss, not a safety issue.
    """
    return re.search(r"\bWHERE\b", sql, re.IGNORECASE) is not None


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
