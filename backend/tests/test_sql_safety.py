"""Unit tests for the SQL identifier safety helpers and driver validation."""

import sqlite3

import pytest

from app.utils.sql_safety import classify_statement, has_where_clause, quote_identifier
from app.drivers.sqlite import SQLiteDriver


# ── classify_statement ──


@pytest.mark.parametrize("sql,expected", [
    ("SELECT * FROM t", "SELECT"),
    ("  select * from t", "SELECT"),
    ("insert into t values (1)", "INSERT"),
    ("UPDATE t SET x = 1", "UPDATE"),
    ("delete from t", "DELETE"),
    ("DROP TABLE t", "DROP"),
    ("truncate table t", "TRUNCATE"),
    ("ALTER TABLE t ADD COLUMN x", "ALTER"),
    ("-- a comment\nDELETE FROM t", "DELETE"),
    ("/* block comment */ DELETE FROM t", "DELETE"),
    ("", ""),
])
def test_classify_statement(sql, expected):
    assert classify_statement(sql) == expected


# ── has_where_clause ──


def test_has_where_clause_true_when_present():
    assert has_where_clause("DELETE FROM t WHERE id = 1") is True


def test_has_where_clause_false_when_absent():
    assert has_where_clause("DELETE FROM t") is False


def test_has_where_clause_case_insensitive():
    assert has_where_clause("delete from t where id = 1") is True


# ── quote_identifier ──


def test_quote_identifier_wraps_in_double_quotes():
    assert quote_identifier("users") == '"users"'


def test_quote_identifier_escapes_embedded_double_quotes():
    # A double quote inside an identifier must be doubled.
    assert quote_identifier('we"ird') == '"we""ird"'


def test_quote_identifier_preserves_single_quotes_and_semicolons():
    # These characters are harmless inside a quoted identifier; escaping only
    # applies to the double quote character.
    assert quote_identifier("foo'; DROP TABLE x; --") == '"foo\'; DROP TABLE x; --"'


def test_quote_identifier_rejects_empty_string():
    with pytest.raises(ValueError):
        quote_identifier("")


def test_quote_identifier_rejects_nul_byte():
    with pytest.raises(ValueError):
        quote_identifier("foo\x00bar")


def test_quote_identifier_rejects_non_string():
    with pytest.raises(ValueError):
        quote_identifier(None)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        quote_identifier(123)  # type: ignore[arg-type]


def test_quote_identifier_allows_unicode():
    assert quote_identifier("café") == '"café"'


def test_quoted_identifier_neutralises_injection_attempt():
    """A name containing a double-quote + SQL-suffix stays a single identifier."""
    payload = 'books" UNION SELECT sql FROM sqlite_master --'
    # When concatenated into SELECT * FROM <quoted>, the closing quote inside
    # the identifier is doubled, so the whole string remains one literal name.
    quoted = quote_identifier(payload)
    assert quoted.startswith('"')
    assert quoted.endswith('"')
    # The internal quote has been doubled.
    assert '""' in quoted
    # And there is no unescaped closing quote before the final character.
    inner = quoted[1:-1]
    # Every " in the inner portion must be part of a "" escape pair.
    assert inner.count('"') % 2 == 0


# ── list_table_names / assert_valid_table (via SQLiteDriver) ──


@pytest.fixture()
def driver_and_conn(tmp_path):
    path = tmp_path / "safety.db"
    c = sqlite3.connect(path)
    c.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER);
        INSERT INTO users VALUES (1, 'a'), (2, 'b');
        """
    )
    c.close()
    driver = SQLiteDriver(str(path))
    conn = driver.connect()
    try:
        yield driver, conn
    finally:
        driver.close(conn)


def test_list_table_names_returns_all_user_tables(driver_and_conn):
    driver, conn = driver_and_conn
    names = driver.list_table_names(conn)
    assert {"users", "orders"}.issubset(names)


def test_assert_valid_table_accepts_known(driver_and_conn):
    driver, conn = driver_and_conn
    assert driver.assert_valid_table(conn, "users") == "users"


def test_assert_valid_table_rejects_unknown(driver_and_conn):
    driver, conn = driver_and_conn
    with pytest.raises(ValueError):
        driver.assert_valid_table(conn, "no_such_table")


def test_assert_valid_table_rejects_injection_payload(driver_and_conn):
    driver, conn = driver_and_conn
    with pytest.raises(ValueError):
        driver.assert_valid_table(conn, 'users"; DROP TABLE users; --')
    # The real table is still present afterwards.
    assert "users" in driver.list_table_names(conn)


def test_assert_valid_table_rejects_empty(driver_and_conn):
    driver, conn = driver_and_conn
    with pytest.raises(ValueError):
        driver.assert_valid_table(conn, "")
