from __future__ import annotations

import csv
import io
import json
import re
from typing import Callable, Iterator

from fastapi.responses import StreamingResponse

ALLOWED_FORMATS = {"csv", "json"}


def _sanitize_filename(stem: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.-]', '_', stem) or "export"


def _csv_lines(columns: list[str], rows: Iterator[dict]) -> Iterator[str]:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    yield buf.getvalue()
    for row in rows:
        buf.seek(0)
        buf.truncate(0)
        writer.writerow(row.get(col) for col in columns)
        yield buf.getvalue()


def _json_lines(rows: Iterator[dict]) -> Iterator[str]:
    yield "["
    first = True
    for row in rows:
        chunk = json.dumps(row, default=str)
        yield chunk if first else "," + chunk
        first = False
    yield "]"


def export_response(
    columns: list[str],
    rows: Iterator[dict],
    fmt: str,
    filename_stem: str,
    on_done: Callable[[], None] | None = None,
) -> StreamingResponse:
    fmt = (fmt or "csv").lower()
    if fmt not in ALLOWED_FORMATS:
        raise ValueError(f"format must be one of {sorted(ALLOWED_FORMATS)}")

    if fmt == "csv":
        media_type = "text/csv"
        body = _csv_lines(columns, rows)
    else:
        media_type = "application/json"
        body = _json_lines(rows)

    def wrapped() -> Iterator[str]:
        try:
            yield from body
        finally:
            if on_done:
                on_done()

    filename = f"{_sanitize_filename(filename_stem)}.{fmt}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(wrapped(), media_type=media_type, headers=headers)
