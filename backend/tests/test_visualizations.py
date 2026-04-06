"""Tests for visualization run, CRUD, and history."""


def _connect(client, sample_db):
    resp = client.post("/api/databases/connect", json={"path": sample_db})
    return resp.json()


def _run_viz(client, db_id, sql="SELECT name, id FROM authors", chart_type="bar"):
    return client.post("/api/visualizations/run", json={
        "db_id": db_id,
        "sql": sql,
        "chart_type": chart_type,
        "title": "Test Chart",
    })


def _save_viz(client, db_info, title="My Chart"):
    return client.post("/api/visualizations", json={
        "db_id": db_info["id"],
        "db_name": db_info["name"],
        "title": title,
        "sql": "SELECT * FROM authors",
        "chart_type": "bar",
        "config": {"x": "name", "y": "id"},
    })


# ── Run ──


def test_run_visualization(client, sample_db):
    db_info = _connect(client, sample_db)
    resp = _run_viz(client, db_info["id"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 2
    assert "name" in data["columns"]


def test_run_visualization_bad_sql(client, sample_db):
    db_info = _connect(client, sample_db)
    resp = _run_viz(client, db_info["id"], sql="SELEKT nope")
    assert resp.status_code == 400


def test_run_records_history(client, sample_db):
    db_info = _connect(client, sample_db)
    _run_viz(client, db_info["id"])

    history = client.get(f"/api/visualizations/history?db_id={db_info['id']}").json()
    assert len(history) >= 1
    assert history[0]["status"] == "success"
    assert history[0]["chart_type"] == "bar"


# ── Save / List / Update / Delete ──


def test_save_and_list(client, sample_db):
    db_info = _connect(client, sample_db)
    save_resp = _save_viz(client, db_info)
    assert save_resp.status_code == 200
    saved = save_resp.json()
    assert saved["title"] == "My Chart"
    assert saved["chart_type"] == "bar"

    panels = client.get(f"/api/visualizations?db_id={db_info['id']}").json()
    assert len(panels) == 1
    assert panels[0]["id"] == saved["id"]


def test_update_visualization(client, sample_db):
    db_info = _connect(client, sample_db)
    saved = _save_viz(client, db_info).json()

    resp = client.put(f"/api/visualizations/{saved['id']}", json={
        "title": "Updated Title",
        "chart_type": "line",
    })
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["title"] == "Updated Title"
    assert updated["chart_type"] == "line"
    # Unchanged fields preserved
    assert updated["sql"] == "SELECT * FROM authors"


def test_update_nonexistent(client):
    resp = client.put("/api/visualizations/99999", json={"title": "Nope"})
    assert resp.status_code == 404


def test_delete_visualization(client, sample_db):
    db_info = _connect(client, sample_db)
    saved = _save_viz(client, db_info).json()

    resp = client.delete(f"/api/visualizations/{saved['id']}")
    assert resp.json()["deleted"] == 1

    panels = client.get(f"/api/visualizations?db_id={db_info['id']}").json()
    assert len(panels) == 0


def test_delete_nonexistent(client):
    resp = client.delete("/api/visualizations/99999")
    assert resp.json()["deleted"] == 0


# ── Layout batch update ──


def test_update_layout(client, sample_db):
    db_info = _connect(client, sample_db)
    p1 = _save_viz(client, db_info, "Panel 1").json()
    p2 = _save_viz(client, db_info, "Panel 2").json()

    resp = client.put("/api/visualizations/layout/batch", json={
        "panels": [
            {"id": p1["id"], "grid_x": 0, "grid_y": 0, "grid_w": 12, "grid_h": 6},
            {"id": p2["id"], "grid_x": 0, "grid_y": 6, "grid_w": 6, "grid_h": 3},
        ]
    })
    assert resp.json()["ok"] is True

    panels = {p["id"]: p for p in client.get("/api/visualizations").json()}
    assert panels[p1["id"]]["grid_w"] == 12
    assert panels[p2["id"]]["grid_y"] == 6


# ── Visualization History ──


def test_clear_visualization_history(client, sample_db):
    db_info = _connect(client, sample_db)
    _run_viz(client, db_info["id"])
    _run_viz(client, db_info["id"])

    resp = client.delete(f"/api/visualizations/history?db_id={db_info['id']}")
    assert resp.json()["deleted"] == 2

    history = client.get(f"/api/visualizations/history?db_id={db_info['id']}").json()
    assert len(history) == 0
