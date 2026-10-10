"""Job worker: consumes lab:jobs from Redis (pushed by the Go API) and runs them in threads.

Job types: start_run, resume (after a checkpoint), retry, whatif.

Delivery is at-least-once: a job is atomically moved from lab:jobs to lab:jobs:processing
(BLMOVE) and removed only after it has been handled. Jobs left in the processing list by a
crashed worker are put back on start; a recovered start_run continues from the last LangGraph
checkpoint (as a retry) instead of starting the run over.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import redis
from langgraph.types import Command

from . import bus, db, whatif
from .config import settings as cfg

log = logging.getLogger("lab.worker")


class Worker:
    def __init__(self) -> None:
        self.pool = ThreadPoolExecutor(max_workers=cfg.concurrency, thread_name_prefix="job")
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None
        self.active: dict[str, dict] = {}
        self.processed = 0
        self.run_locks: dict[int, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def start(self) -> None:
        self._recover()
        self.thread = threading.Thread(target=self._loop, name="job-consumer", daemon=True)
        self.thread.start()

    @property
    def alive(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    def _recover(self) -> None:
        """Requeue jobs a previous worker process popped but never finished (single worker process)."""
        try:
            moved = 0
            while True:
                raw = bus.r.lmove(bus.PROCESSING_KEY, bus.JOBS_KEY, "RIGHT", "RIGHT")
                if raw is None:
                    break
                moved += 1
            if moved:
                log.warning("requeued %d unfinished job(s) from a previous worker", moved)
        except redis.RedisError as e:
            log.warning("could not recover unfinished jobs: %s", e)

    def _loop(self) -> None:
        log.info("worker listening on %s (concurrency %d)", bus.JOBS_KEY, cfg.concurrency)
        while not self.stop.is_set():
            try:
                raw = bus.r.blmove(bus.JOBS_KEY, bus.PROCESSING_KEY, 5, "RIGHT", "LEFT")
            except redis.RedisError as e:
                log.warning("redis: %s", e)
                time.sleep(2)
                continue
            if not raw:
                continue
            try:
                job = json.loads(raw)
            except ValueError:
                log.warning("bad job: %s", raw[:200])
                self._ack(raw)
                continue
            if job.get("type") == "start_run" and self._has_checkpoint(job):
                job["type"] = "retry"  # recovered after a crash: continue, do not start over
            self.pool.submit(self._run, job, raw)

    def _ack(self, raw: str) -> None:
        try:
            bus.r.lrem(bus.PROCESSING_KEY, 1, raw)
        except redis.RedisError as e:
            log.warning("could not acknowledge job: %s", e)

    @staticmethod
    def _has_checkpoint(job: dict) -> bool:
        try:
            row = db.q1("SELECT status FROM runs WHERE id=%s", (int(job.get("run_id") or 0),))
            return bool(row and row["status"] not in ("queued",))
        except Exception:  # noqa: BLE001
            return False

    def _lock(self, run_id: int) -> threading.Lock:
        with self._locks_guard:
            return self.run_locks.setdefault(run_id, threading.Lock())

    def _run(self, job: dict, raw: str | None = None) -> None:
        typ, run_id = job.get("type"), int(job.get("run_id") or 0)
        key = f"{typ}:{run_id}:{time.time():.3f}"
        self.active[key] = job
        try:
            if typ in ("start_run", "resume", "retry"):
                with self._lock(run_id):  # one graph step at a time per run
                    self._graph_job(typ, run_id, job)
            elif typ == "explorer":  # Research Gap Explorer: independent of the research workflow
                from .explorer import run as explorer_run
                explorer_run.run(int(job.get("analysis_id") or 0))
            elif typ == "whatif":
                self._guard(run_id, lambda: whatif.run_question(run_id, job["question_id"], job["question"]), main=False)
            else:
                log.warning("unknown job type %s", typ)
        except Exception:  # noqa: BLE001
            log.exception("job failed: %s", job)
        finally:
            if raw is not None:
                self._ack(raw)
            self.active.pop(key, None)
            self.processed += 1

    def _graph_job(self, typ: str, run_id: int, job: dict) -> None:
        from .graph import get_graph

        config = {"configurable": {"thread_id": f"run-{run_id}"}, "recursion_limit": 100}
        if typ == "start_run":
            inp = {"run_id": run_id}
        elif typ == "resume":
            inp = Command(resume=job.get("response") or {})
        else:
            bus.emit(run_id, "system", "retrying", "Continuing from the last saved step", "")
            db.ex("UPDATE runs SET status='running', error='' WHERE id=%s", (run_id,))
            inp = None

        def go():
            graph = get_graph()
            graph.invoke(inp, config)
            st = graph.get_state(config)
            if st.next:  # paused at a checkpoint
                return
            outcome = (st.values or {}).get("outcome")
            if outcome == "rejected":
                db.ex("UPDATE runs SET status='rejected', finished_at=now() WHERE id=%s", (run_id,))
            elif outcome == "failed":
                db.ex("UPDATE runs SET status='failed', error='stopped after asking the researcher for help', finished_at=now() WHERE id=%s", (run_id,))
                bus.emit(run_id, "system", "run_failed", "The run stopped: the researcher chose not to continue", "")

        self._guard(run_id, go, main=True)

    def _guard(self, run_id: int, fn, main: bool) -> None:
        try:
            fn()
        except bus.RunStopped:
            if main:
                db.ex("UPDATE runs SET status='stopped', error='stopped by the researcher', finished_at=now() WHERE id=%s", (run_id,))
            bus.r.delete(f"lab:run:{run_id}:control")
            bus.emit(run_id, "system", "run_stopped", "Stopped by the researcher", "")
        except Exception as e:  # noqa: BLE001
            log.exception("run %s failed", run_id)
            if main:
                db.ex("UPDATE runs SET status='failed', error=%s, finished_at=now() WHERE id=%s", (str(e)[:2000], run_id))
            bus.emit(run_id, "system", "run_failed", f"Run failed: {e}"[:500],
                     "Use Retry to continue from the last saved step", {"trace": traceback.format_exc()[-1500:]})


worker = Worker()
