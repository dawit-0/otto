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

**Prerequisites:** Node.js, Python 3, [uv](https://docs.astral.sh/uv/)

```bash
# Install dependencies
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# Start the backend (port 8000)
cd backend && uv run python main.py

# Start the frontend (port 5173) — in a new terminal
cd frontend && npm run dev
```

Open **http://localhost:5173**, then connect a database from the sidebar.

### Sample database

```bash
uv run python scripts/create_sample_db.py
```

Generates `sample.db` with four related tables (users, projects, tasks, comments).

## Chart Types

`line` · `bar` · `area` · `pie` · `scatter` · `stat` · `gauge` · `table`

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Enter` | Execute query |
| `Escape` | Close modal / dismiss AI input |

## Running Tests

```bash
cd backend && uv run pytest
```
