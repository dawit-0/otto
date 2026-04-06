import logging
import sys


def setup_logging() -> None:
    """Configure structured logging for the Otto backend."""
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger("otto")
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    # Prevent duplicate logs if uvicorn also configures the root logger
    root.propagate = False


def get_logger(name: str) -> logging.Logger:
    """Return a child logger under the 'otto' namespace."""
    return logging.getLogger(f"otto.{name}")
