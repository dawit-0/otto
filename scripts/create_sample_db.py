"""Create a sample SQLite database for testing Otto."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'sample.db')

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

c.executescript("""
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    project_id INTEGER NOT NULL,
    assignee_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO users (name, email) VALUES
    ('Alice', 'alice@example.com'),
    ('Bob', 'bob@example.com'),
    ('Charlie', 'charlie@example.com'),
    ('Diana', 'diana@example.com');

INSERT OR IGNORE INTO projects (name, description, owner_id) VALUES
    ('Otto', 'Database visualization tool', 1),
    ('AgentFlow', 'AI workflow engine', 2),
    ('Website', 'Company website redesign', 3);

INSERT OR IGNORE INTO tasks (title, status, project_id, assignee_id) VALUES
    ('Design schema graph', 'done', 1, 1),
    ('Build query editor', 'in_progress', 1, 2),
    ('Add dark mode', 'pending', 1, 3),
    ('Setup CI/CD', 'done', 2, 2),
    ('Write docs', 'pending', 2, 4),
    ('Homepage mockup', 'in_progress', 3, 3),
    ('SEO audit', 'pending', 3, 1);

INSERT OR IGNORE INTO comments (body, task_id, author_id) VALUES
    ('Looking great!', 1, 2),
    ('Can we add zoom controls?', 1, 3),
    ('Working on it now', 2, 2),
    ('Pipeline is green', 4, 2),
    ('Added initial draft', 6, 3);
""")

conn.commit()
conn.close()
print(f"Sample database created at: {os.path.abspath(DB_PATH)}")
