# Otto

A modern web-based SQLite database explorer with interactive schema visualization, data browsing, and a built-in SQL query editor.

## Features

- **Schema Visualization** — Interactive graph view of tables and their relationships using automatic layout
- **Data Browser** — Paginated table viewer for exploring row data
- **SQL Query Editor** — Run arbitrary queries with Cmd+Enter support
- **Multi-Database** — Connect to multiple SQLite databases simultaneously via file path or upload

## Tech Stack

- **Frontend:** React, TypeScript, Vite, [React Flow](https://reactflow.dev/)
- **Backend:** Python, FastAPI, Uvicorn
- **Database:** SQLite (via Python standard library)

## Quick Start

### Prerequisites

- Node.js and npm
- Python 3

### 1. Install dependencies

```bash
# Backend
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

### 2. Start the servers

In one terminal, start the backend:

```bash
cd backend
python main.py
```

In another terminal, start the frontend:

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser and connect a SQLite database.

### 3. (Optional) Create a sample database

```bash
python scripts/create_sample_db.py
```

This generates a `sample.db` with example tables (users, projects, tasks, comments) you can use to try things out.

## Project Structure

```
otto/
├── backend/
│   ├── main.py              # FastAPI server and API routes
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # React components (SchemaGraph, DataTable, QueryEditor, ConnectModal)
│   │   ├── api.ts           # API client
│   │   ├── App.tsx          # Main app component
│   │   └── styles/          # Global CSS
│   ├── package.json
│   └── vite.config.ts
└── scripts/
    └── create_sample_db.py  # Sample database generator
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/databases/connect` | Connect to a database by file path |
| POST | `/api/databases/upload` | Upload a database file |
| GET | `/api/databases` | List connected databases |
| DELETE | `/api/databases/{db_id}` | Disconnect a database |
| GET | `/api/databases/{db_id}/schema` | Get schema (tables, columns, foreign keys, indexes) |
| GET | `/api/databases/{db_id}/tables/{table}/data` | Get paginated table data |
| POST | `/api/query` | Execute a SQL query |
