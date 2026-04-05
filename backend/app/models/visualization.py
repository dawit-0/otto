from datetime import datetime, timezone

from sqlalchemy import Integer, String, Text, DateTime, Float, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SavedVisualization(Base):
    __tablename__ = "saved_visualizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_id: Mapped[str] = mapped_column(String, index=True)
    db_name: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    sql: Mapped[str] = mapped_column(Text)
    chart_type: Mapped[str] = mapped_column(String)  # line, bar, area, pie, scatter, stat, gauge, table
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # axis mappings, colors, thresholds, etc.
    # Grid layout position
    grid_x: Mapped[int] = mapped_column(Integer, default=0)
    grid_y: Mapped[int] = mapped_column(Integer, default=0)
    grid_w: Mapped[int] = mapped_column(Integer, default=6)
    grid_h: Mapped[int] = mapped_column(Integer, default=4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class VisualizationHistory(Base):
    __tablename__ = "visualization_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_id: Mapped[str] = mapped_column(String, index=True)
    db_name: Mapped[str] = mapped_column(String)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    sql: Mapped[str] = mapped_column(Text)
    chart_type: Mapped[str] = mapped_column(String)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String)  # "success" or "error"
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
