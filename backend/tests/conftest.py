"""
Shared fixtures for Otto backend tests.

Sets up an isolated test environment with:
- A temporary Otto internal database (overrides get_db)
- A sample SQLite database with realistic test data
- A FastAPI TestClient wired to the test database
"""

import os
import sqlite3
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# Point Otto data dir to a temp location BEFORE importing app modules
_test_dir = tempfile.mkdtemp(prefix="otto_test_")
os.environ["OTTO_DATA_DIR"] = _test_dir

from app.database import get_db
from app.models.base import Base
from main import app


@pytest.fixture()
def db_engine(tmp_path):
    """Create an isolated SQLAlchemy engine using a file-based SQLite DB."""
    db_file = tmp_path / "otto_test.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    """Yield an isolated SQLAlchemy session."""
    Session = sessionmaker(bind=db_engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    """FastAPI TestClient with the get_db dependency overridden."""

    def _override():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def sample_db(tmp_path):
    """Create a small SQLite database with two related tables and return its path."""
    db_path = str(tmp_path / "sample.db")
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE authors (
            id    INTEGER PRIMARY KEY,
            name  TEXT NOT NULL,
            email TEXT UNIQUE
        );
        CREATE TABLE books (
            id        INTEGER PRIMARY KEY,
            title     TEXT NOT NULL,
            author_id INTEGER NOT NULL REFERENCES authors(id),
            pages     INTEGER DEFAULT 0
        );
        INSERT INTO authors VALUES (1, 'Alice', 'alice@example.com');
        INSERT INTO authors VALUES (2, 'Bob', 'bob@example.com');
        INSERT INTO books VALUES (1, 'Alpha', 1, 200);
        INSERT INTO books VALUES (2, 'Beta', 1, 150);
        INSERT INTO books VALUES (3, 'Gamma', 2, 300);
    """)
    conn.close()
    return db_path
