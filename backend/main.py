from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.logging import setup_logging, get_logger
from app.routes import databases, query, history, visualizations, ai, saved_queries

import time

setup_logging()
logger = get_logger("main")

app = FastAPI(title="Otto")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(databases.router)
app.include_router(query.router)
app.include_router(history.router)
app.include_router(visualizations.router)
app.include_router(ai.router)
app.include_router(saved_queries.router)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %d (%.1fms)",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    return response


@app.on_event("startup")
def on_startup():
    logger.info("Otto starting up")
    init_db()
    logger.info("Database initialized")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
