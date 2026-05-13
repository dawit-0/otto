# Otto

A lightweight web-based database explorer with schema visualization, data browsing, SQL querying, chart dashboards, and AI-assisted query generation.

## Features

- **Schema** — Interactive graph of tables and foreign-key relationships (pan, zoom, minimap)
- **Data** — Paginated table browser with column/row count display
- **Query** — SQL editor with execution history, saved queries, and column profiling
- **Visualize** — Drag-and-drop dashboard with 8 chart types; panels are persistent and resizable
- **AI Assist** — Generate SQL from natural language; schema-aware, dialect-specific (SQLite / PostgreSQL)
- **Multi-database** — Connect SQLite files (path or upload) and PostgreSQL simultaneously

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Recharts, React Flow, react-grid-layout |
| Backend | Python 3, FastAPI, SQLAlchemy, Uvicorn |
| Databases | SQLite, PostgreSQL |

## Quick Start

**Prerequisites:** Node.js, Python 3

```bash
# Install dependencies
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

# Start the backend (port 8000)
cd backend && python main.py

# Start the frontend (port 5173) — in a new terminal
cd frontend && npm run dev
```

Open **http://localhost:5173**, then connect a database from the sidebar.

### Sample database

```bash
python scripts/create_sample_db.py
```

Generates `sample.db` with four related tables (users, projects, tasks, comments).

## Chart Types

`line` · `bar` · `area` · `pie` · `scatter` · `stat` · `gauge` · `table`

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Enter` | Execute query |
| `Escape` | Close modal / dismiss AI input |

## API Reference

### Databases

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/databases/connect` | Connect by file path or connection string |
| `POST` | `/api/databases/upload` | Upload a SQLite file |
| `GET` | `/api/databases` | List connected databases |
| `DELETE` | `/api/databases/{id}` | Disconnect a database |
| `GET` | `/api/databases/{id}/schema` | Tables, columns, row counts, foreign keys, indexes |
| `GET` | `/api/databases/{id}/tables/{table}/data` | Paginated row data (`limit`, `offset`) |

### Query

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/query` | Execute SQL; returns columns, rows, duration |
| `GET` | `/api/history` | Query history (`db_id`, `limit`, `offset`) |
| `DELETE` | `/api/history` | Clear history |
| `DELETE` | `/api/history/{id}` | Delete one history entry |
| `GET` | `/api/saved-queries` | List saved queries |
| `POST` | `/api/saved-queries` | Save a query (name, sql, description) |
| `PUT` | `/api/saved-queries/{id}` | Update a saved query |
| `DELETE` | `/api/saved-queries/{id}` | Delete a saved query |

### Visualizations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/visualizations/run` | Execute a visualization query |
| `GET` | `/api/visualizations` | List saved dashboard panels |
| `POST` | `/api/visualizations` | Save a panel (title, sql, chart_type, config, grid position) |
| `PUT` | `/api/visualizations/{id}` | Update a panel |
| `PUT` | `/api/visualizations/layout/batch` | Update grid positions for multiple panels |
| `DELETE` | `/api/visualizations/{id}` | Delete a panel |
| `GET` | `/api/visualizations/history` | Visualization execution history |
| `DELETE` | `/api/visualizations/history` | Clear visualization history |
| `DELETE` | `/api/visualizations/history/{id}` | Delete one visualization history entry |

### AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ai/generate-query` | Generate SQL from a natural language prompt |

## Project Structure

```
otto/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── requirements.txt
│   └── app/
│       ├── database.py      # Connection management
│       └── routes/          # databases, query, history, visualizations, ai, saved_queries
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       └── components/      # SchemaGraph, DataView, QueryEditor, QueryInsights,
│                            # VisualizationDashboard, VisualizationEditor, charts/
└── scripts/
    └── create_sample_db.py
```

## Running Tests

```bash
cd backend && pytest
```
