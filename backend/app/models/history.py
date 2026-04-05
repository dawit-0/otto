from datetime import datetime, timezone

from sqlalchemy import Integer, String, Text, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class QueryHistory(Base):
    __tablename__ = "query_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_id: Mapped[str] = mapped_column(String, index=True)
    db_name: Mapped[str] = mapped_column(String)
    sql: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String)  # "success" or "error"
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    executed_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
