import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.logging import get_logger
from app.routes.databases import get_connection
from app.utils.sql_safety import quote_identifier

logger = get_logger("search")

router = APIRouter(prefix="/api/databases", tags=["search"])


@router.get("/{db_id}/search")
def search_database(
    db_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=5, ge=1, le=50),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if not term:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    conn = get_connection(db_id, db)
    try:
        table_cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        table_names = [row["name"] for row in table_cursor.fetchall()]

        results = []
        total_matches = 0

        for table_name in table_names:
            quoted_table = quote_identifier(table_name)

            cols_cursor = conn.execute(f"PRAGMA table_info({quoted_table})")
            columns = [(col["name"], col["type"]) for col in cols_cursor.fetchall()]
            if not columns:
                continue

            col_names = [c[0] for c in columns]
            like_param = f"%{term}%"

            where_parts = [
                f"CAST({quote_identifier(name)} AS TEXT) LIKE ?"
                for name, _ in columns
            ]
            where_clause = " OR ".join(where_parts)
            params = [like_param] * len(columns)

            try:
                count_row = conn.execute(
                    f"SELECT COUNT(*) FROM {quoted_table} WHERE {where_clause}",
                    params,
                ).fetchone()
                match_count = count_row[0]
            except Exception as e:
                logger.warning("Count failed for table '%s': %s", table_name, e)
                continue

            if match_count == 0:
                continue

            total_matches += match_count

            try:
                rows_cursor = conn.execute(
                    f"SELECT * FROM {quoted_table} WHERE {where_clause} LIMIT ?",
                    params + [limit],
                )
                rows = [dict(zip(col_names, row)) for row in rows_cursor.fetchall()]
            except Exception as e:
                logger.warning("Row fetch failed for table '%s': %s", table_name, e)
                rows = []

            results.append(
                {
                    "table": table_name,
                    "columns": col_names,
                    "rows": rows,
                    "match_count": match_count,
                    "showing": len(rows),
                }
            )

        results.sort(key=lambda r: r["match_count"], reverse=True)

        logger.info(
            "Search '%s' on db_id=%s: %d matches across %d tables",
            term,
            db_id,
            total_matches,
            len(results),
        )

        return {
            "query": term,
            "total_tables_searched": len(table_names),
            "total_matches": total_matches,
            "results": results,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Search error for db_id=%s: %s", db_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
