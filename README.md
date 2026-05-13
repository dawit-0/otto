# Otto

A lightweight web-based database explorer with schema visualization, data browsing, SQL querying, and chart dashboards.

## Features

- **Schema** — Interactive graph view of tables and foreign-key relationships
- **Data** — Paginated table browser (100 rows/page)
- **Query** — SQL editor with `Cmd/Ctrl+Enter` execution, query history, and saved queries
- **Visualize** — Build and save charts (bar, line, pie, scatter) from any query result
- **AI Assist** — Generate SQL from a natural language prompt against the active schema
- **Multi-database** — Connect SQLite files (path or upload) and PostgreSQL databases simultaneously

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Recharts, React Flow |
| Backend | Python 3, FastAPI, SQLAlchemy, Uvicorn |
| Databases | SQLite, PostgreSQL |

## Quick Start

**Prerequisites:** Node.js, Python 3

```bash
# 1. Install dependencies
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

# 2. Start the backend (port 8000)
cd backend && python main.py

# 3. Start the frontend (port 5173) — in a new terminal
cd frontend && npm run dev
```

Open **http://localhost:5173**, then connect a database from the sidebar.

### Sample database

```bash
python scripts/create_sample_db.py
```

Generates `sample.db` with four related tables (users, projects, tasks, comments).

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/databases/connect` | Connect by file path or connection string |
| `POST` | `/api/databases/upload` | Upload a SQLite file |
| `GET` | `/api/databases` | List connected databases |
| `DELETE` | `/api/databases/{id}` | Disconnect a database |
| `GET` | `/api/databases/{id}/schema` | Tables, columns, foreign keys, indexes |
| `GET` | `/api/databases/{id}/tables/{table}/data` | Paginated row data |
| `POST` | `/api/query` | Execute a SQL query |
| `GET` | `/api/history` | Query execution history |
| `GET/POST` | `/api/saved-queries` | List or save queries |
| `POST` | `/api/visualizations/run` | Run a visualization query |
| `POST` | `/api/visualizations/save` | Save a visualization |
| `POST` | `/api/ai/query` | Generate SQL from a natural language prompt |

## Project Structure

```
otto/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── requirements.txt
│   └── app/
│       ├── database.py      # Connection management
│       ├── logging.py
│       └── routes/          # databases, query, history, visualizations, ai, saved_queries
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       └── components/      # SchemaGraph, DataView, QueryEditor, VisualizationDashboard, …
└── scripts/
    └── create_sample_db.py
```

## Running Tests

```bash
cd backend && pytest
```
