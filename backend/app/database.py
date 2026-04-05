import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.models.base import Base

# Store the internal database alongside the backend code
_DB_DIR = Path(os.environ.get("OTTO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
_DB_DIR.mkdir(parents=True, exist_ok=True)
_DB_PATH = _DB_DIR / "otto.db"

engine = create_engine(f"sqlite:///{_DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)


def init_db() -> None:
    """Create all tables that don't exist yet."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
