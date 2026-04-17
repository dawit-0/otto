import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.models.visualization import SavedVisualization, VisualizationHistory
from app.routes.databases import get_connection, get_db_name

logger = get_logger("visualizations")

router = APIRouter(prefix="/api/visualizations", tags=["visualizations"])


# ── Request / Response schemas ──


class RunVisualizationRequest(BaseModel):
    db_id: str
    sql: str
    chart_type: str
    title: str | None = None
    config: dict | None = None


class SaveVisualizationRequest(BaseModel):
    db_id: str
    db_name: str
    title: str
    sql: str
    chart_type: str
    config: dict | None = None
    grid_x: int = 0
    grid_y: int = 0
    grid_w: int = 6
    grid_h: int = 4


class UpdateVisualizationRequest(BaseModel):
    title: str | None = None
    sql: str | None = None
    chart_type: str | None = None
    config: dict | None = None
    grid_x: int | None = None
    grid_y: int | None = None
    grid_w: int | None = None
    grid_h: int | None = None


class UpdateLayoutRequest(BaseModel):
    panels: list[dict]  # [{id, grid_x, grid_y, grid_w, grid_h}]


class VisualizationResponse(BaseModel):
    id: int
    db_id: str
    db_name: str
    title: str
    sql: str
    chart_type: str
    config: dict | None
    grid_x: int
    grid_y: int
    grid_w: int
    grid_h: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class VisualizationHistoryResponse(BaseModel):
    id: int
    db_id: str
    db_name: str
    title: str | None
    sql: str
    chart_type: str
    config: dict | None
    row_count: int | None
    duration_ms: float | None
    status: str
    error_message: str | None
    created_at: str

    model_config = {"from_attributes": True}


def _panel_to_response(p: SavedVisualization) -> VisualizationResponse:
    return VisualizationResponse(
        id=p.id, db_id=p.db_id, db_name=p.db_name, title=p.title,
        sql=p.sql, chart_type=p.chart_type, config=p.config,
        grid_x=p.grid_x, grid_y=p.grid_y, grid_w=p.grid_w, grid_h=p.grid_h,
        created_at=p.created_at.isoformat(), updated_at=p.updated_at.isoformat(),
    )


def _history_to_response(e: VisualizationHistory) -> VisualizationHistoryResponse:
    return VisualizationHistoryResponse(
        id=e.id, db_id=e.db_id, db_name=e.db_name, title=e.title,
        sql=e.sql, chart_type=e.chart_type, config=e.config,
        row_count=e.row_count, duration_ms=e.duration_ms,
        status=e.status, error_message=e.error_message,
        created_at=e.created_at.isoformat(),
    )


# ── Run a visualization query (+ record history) ──


@router.post("/run")
def run_visualization(req: RunVisualizationRequest, db: Session = Depends(get_db)):
    conn = get_connection(req.db_id, db)
    db_name = get_db_name(req.db_id, db)
    logger.info(
        "Running visualization '%s' (type=%s) on '%s'",
        req.title or "untitled", req.chart_type, db_name,
    )

    start = time.perf_counter()
    try:
        cursor = conn.execute(req.sql)
        duration_ms = (time.perf_counter() - start) * 1000

        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        else:
            columns = []
            rows = []

        logger.info(
            "Visualization '%s' succeeded: %d rows in %.1fms",
            req.title or "untitled", len(rows), duration_ms,
        )

        db.add(VisualizationHistory(
            db_id=req.db_id,
            db_name=db_name,
            title=req.title,
            sql=req.sql,
            chart_type=req.chart_type,
            config=req.config,
            row_count=len(rows),
            duration_ms=duration_ms,
            status="success",
        ))
        db.commit()

        return {"columns": columns, "rows": rows, "row_count": len(rows)}

    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.error(
            "Visualization '%s' failed after %.1fms: %s",
            req.title or "untitled", duration_ms, e,
        )
        db.add(VisualizationHistory(
            db_id=req.db_id,
            db_name=db_name,
            title=req.title,
            sql=req.sql,
            chart_type=req.chart_type,
            config=req.config,
            status="error",
            error_message=str(e),
            duration_ms=duration_ms,
        ))
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ── CRUD for saved (pinned) panels ──


@router.get("", response_model=list[VisualizationResponse])
def list_visualizations(db_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(SavedVisualization)
    if db_id:
        query = query.filter(SavedVisualization.db_id == db_id)
    panels = query.order_by(SavedVisualization.created_at).all()
    return [_panel_to_response(p) for p in panels]


@router.post("", response_model=VisualizationResponse)
def save_visualization(req: SaveVisualizationRequest, db: Session = Depends(get_db)):
    panel = SavedVisualization(
        db_id=req.db_id, db_name=req.db_name, title=req.title,
        sql=req.sql, chart_type=req.chart_type, config=req.config,
        grid_x=req.grid_x, grid_y=req.grid_y, grid_w=req.grid_w, grid_h=req.grid_h,
    )
    db.add(panel)
    db.commit()
    db.refresh(panel)
    return _panel_to_response(panel)


@router.put("/layout/batch")
def update_layout(req: UpdateLayoutRequest, db: Session = Depends(get_db)):
    for item in req.panels:
        panel = db.query(SavedVisualization).filter(SavedVisualization.id == item["id"]).first()
        if panel:
            panel.grid_x = item.get("grid_x", panel.grid_x)
            panel.grid_y = item.get("grid_y", panel.grid_y)
            panel.grid_w = item.get("grid_w", panel.grid_w)
            panel.grid_h = item.get("grid_h", panel.grid_h)
    db.commit()
    return {"ok": True}


# ── History (must be before /{panel_id} to avoid route conflicts) ──


@router.get("/history", response_model=list[VisualizationHistoryResponse])
def get_visualization_history(
    db_id: str | None = None,
    limit: int = Query(default=50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = db.query(VisualizationHistory)
    if db_id:
        query = query.filter(VisualizationHistory.db_id == db_id)
    entries = (
        query.order_by(desc(VisualizationHistory.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_history_to_response(e) for e in entries]


@router.delete("/history")
def clear_visualization_history(db_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(VisualizationHistory)
    if db_id:
        query = query.filter(VisualizationHistory.db_id == db_id)
    count = query.delete()
    db.commit()
    return {"deleted": count}


@router.delete("/history/{entry_id}")
def delete_visualization_history_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(VisualizationHistory).filter(VisualizationHistory.id == entry_id).first()
    if not entry:
        return {"deleted": 0}
    db.delete(entry)
    db.commit()
    return {"deleted": 1}


# ── Individual panel CRUD (after static routes) ──


@router.put("/{panel_id}", response_model=VisualizationResponse)
def update_visualization(panel_id: int, req: UpdateVisualizationRequest, db: Session = Depends(get_db)):
    panel = db.query(SavedVisualization).filter(SavedVisualization.id == panel_id).first()
    if not panel:
        raise HTTPException(status_code=404, detail="Panel not found")
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(panel, field, value)
    db.commit()
    db.refresh(panel)
    return _panel_to_response(panel)


@router.delete("/{panel_id}")
def delete_visualization(panel_id: int, db: Session = Depends(get_db)):
    panel = db.query(SavedVisualization).filter(SavedVisualization.id == panel_id).first()
    if not panel:
        return {"deleted": 0}
    db.delete(panel)
    db.commit()
    return {"deleted": 1}
