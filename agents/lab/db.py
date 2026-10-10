"""PostgreSQL access (the schema is owned and migrated by the Go API)."""
from __future__ import annotations

import json
import time
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import settings

pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=12,
    kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
    open=False,
)


def open_pool(wait_seconds: int = 60) -> None:
    pool.open(wait=False)
    deadline = time.time() + wait_seconds
    while True:
        try:
            with pool.connection(timeout=5) as c:
                c.execute("SELECT 1 FROM runs LIMIT 1")  # schema must exist (Go migrates it)
            return
        except Exception as e:  # noqa: BLE001
            if time.time() > deadline:
                raise RuntimeError(f"database not ready: {e}") from e
            time.sleep(2)


def J(v: Any) -> Jsonb:
    return Jsonb(v)


def q(sql: str, params: Any = None) -> list[dict]:
    with pool.connection() as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else []


def q1(sql: str, params: Any = None) -> dict | None:
    rows = q(sql, params)
    return rows[0] if rows else None


def ex(sql: str, params: Any = None) -> int:
    with pool.connection() as c:
        return c.execute(sql, params).rowcount


def scalar(sql: str, params: Any = None) -> Any:
    row = q1(sql, params)
    return next(iter(row.values())) if row else None


def dumps(v: Any) -> str:
    return json.dumps(v, default=str)
