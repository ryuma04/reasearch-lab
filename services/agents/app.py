"""FastAPI agent service.

The Go API calls these endpoints synchronously (health, Lab Memory search, command
understanding, status summary); long work arrives through the Redis job queue and is run by
the background worker started here.

Run: uvicorn app:app --port 8001   (from services/agents)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from lab import api, bus, db, intent, llm, memory, steps
from lab.config import settings
from lab.worker import worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    worker.start()
    yield
    worker.stop.set()


app = FastAPI(title="Research Lab Agents", version="1.0", lifespan=lifespan)


def internal(x_internal_token: str = Header(default="")) -> None:
    if not settings.internal_token or x_internal_token != settings.internal_token:
        raise HTTPException(status_code=403, detail="forbidden")


@app.get("/health")
def health() -> dict:
    out: dict = {"service": "agents"}
    try:
        db.scalar("SELECT 1")
        out["database"] = True
    except Exception as e:  # noqa: BLE001
        out["database"] = f"error: {e}"
    try:
        out["redis"] = bool(bus.r.ping())
    except Exception as e:  # noqa: BLE001
        out["redis"] = f"error: {e}"
    out["go_api"] = api.ping()
    out["worker"] = {"alive": worker.alive, "active_jobs": len(worker.active), "processed": worker.processed,
                     "concurrency": settings.concurrency}
    out["llm_providers"] = llm.providers()
    out["llm_mode"] = "ai" if llm.available() else "fallback (no AI keys: recipes and rules only)"
    out["embedder"] = memory.embedder_name()
    out["agents"] = list(steps.AGENTS)
    return out


@app.get("/memory/search", dependencies=[Depends(internal)])
def memory_search(q: str = "", kind: str = "", limit: int = 20) -> list[dict]:
    rows = memory.search(q, kind, max(1, min(limit, 100)))
    for r in rows:
        r.pop("embedding", None)
        if r.get("similarity") is not None:
            r["similarity"] = float(r["similarity"])
    return rows


class RunCtx(BaseModel):
    id: int
    workspace_id: int = 0
    title: str = ""
    status: str = ""
    stage: str = ""
    pending_checkpoint: str = ""


class IntentReq(BaseModel):
    text: str
    runs: list[RunCtx] = []


@app.post("/intent", dependencies=[Depends(internal)])
def understand(req: IntentReq) -> dict:
    return intent.understand(req.text, [r.model_dump() for r in req.runs])


@app.get("/runs/{run_id}/summary", dependencies=[Depends(internal)])
def run_summary(run_id: int) -> dict:
    return {"text": intent.summary(run_id)}


@app.get("/agents", dependencies=[Depends(internal)])
def agents() -> dict:
    """The fixed agents of the pipeline."""
    return {k: {"name": v[0], "instructions": v[1]} for k, v in steps.AGENTS.items()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=settings.port)
