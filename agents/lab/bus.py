"""Redis bus shared with the Go API (see backend/internal/bus).

Events go to lab:events (Go saves them and streams them over SSE); jobs come from lab:jobs.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

import redis

from .config import settings

log = logging.getLogger("lab.bus")

JOBS_KEY = "lab:jobs"
PROCESSING_KEY = "lab:jobs:processing"  # jobs being handled (see worker.py)
EVENTS_KEY = "lab:events"

r = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=30, socket_connect_timeout=5,
                         health_check_interval=30)


class RunStopped(Exception):
    """The researcher stopped the run."""


def emit(run_id: int, agent: str, type_: str, message: str, why: str = "",
         links: dict | None = None, cost: dict | None = None) -> None:
    """Send one event. Every live feature (board, map, replay) is built from these."""
    ev = {
        "run_id": int(run_id),
        "time": datetime.now(timezone.utc).isoformat(),
        "agent": agent,
        "type": type_,
        "message": message[:2000],
        "why": why[:1000],
        "links": links or {},
        "cost": cost or {"tokens": 0, "sandbox_seconds": 0},
    }
    try:
        from . import observer  # local import to avoid a cycle
        observer.on_event(ev)
    except Exception as e:  # noqa: BLE001 - the map must never break a run
        log.warning("observer failed: %s", e)
    try:
        r.lpush(EVENTS_KEY, json.dumps(ev, default=str))
    except redis.RedisError as e:
        log.error("emit failed: %s", e)


def control(run_id: int) -> str:
    return r.get(f"lab:run:{run_id}:control") or ""


def check_control(run_id: int) -> None:
    """Called between steps: waits while paused, raises RunStopped when stopped."""
    from . import db

    announced = False
    while True:
        c = control(run_id)
        if c == "stop":
            raise RunStopped()
        if c != "pause":
            if announced:
                db.ex("UPDATE runs SET status='running' WHERE id=%s AND status='paused'", (run_id,))
            return
        if not announced:
            db.ex("UPDATE runs SET status='paused' WHERE id=%s", (run_id,))
            announced = True
        time.sleep(2)


def instructions(run_id: int, agent_prefix: str = "") -> list[str]:
    """Researcher instructions for this run (for agent_prefix, plus run-wide ones). Not consumed."""
    out = []
    for raw in r.lrange(f"lab:run:{run_id}:instructions", 0, -1):
        try:
            item = json.loads(raw)
        except ValueError:
            continue
        a = item.get("agent", "run")
        if a == "run" or not agent_prefix or a.startswith(agent_prefix):
            out.append(item.get("text", ""))
    return [t for t in out if t]


def push_job(job: dict) -> None:
    r.lpush(JOBS_KEY, json.dumps(job))
