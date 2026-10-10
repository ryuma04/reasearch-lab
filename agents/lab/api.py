"""Client for the Go API's internal endpoints: sandbox execution, proof checker, rate limiter."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from .config import settings

log = logging.getLogger("lab.api")

_client = httpx.Client(
    base_url=settings.api_url,
    headers={"X-Internal-Token": settings.internal_token},
    timeout=httpx.Timeout(10.0, read=None),  # sandbox calls can run for a long time
)


@dataclass
class ExecResult:
    exec_id: int
    exit_code: int
    timed_out: bool
    duration_ms: int
    log_path: str
    log_hash: str
    log_tail: str
    code_version: str
    metrics: list[dict] = field(default_factory=list)
    metrics_error: str = ""
    # succeeded | failed | timed_out | cancelled | error (Docker unavailable, image missing, ...)
    status: str = ""
    attempt: int = 1
    cancelled: bool = False
    error: str = ""
    stderr_tail: str = ""
    metrics_status: str = "not_collected"  # valid | invalid | missing | not_collected
    artifacts: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        if self.status:
            return self.status == "succeeded"
        return self.exit_code == 0 and not self.timed_out

    @property
    def seconds(self) -> float:
        return self.duration_ms / 1000.0

    def error_report(self) -> str:
        """The actual failure for the Debugger: the sandbox's verdict plus the real output."""
        parts = []
        if self.error:
            parts.append(f"[sandbox] {self.error}")
        if self.metrics_error and self.metrics_error not in self.error:
            parts.append(f"[sandbox] results rejected: {self.metrics_error}")
        parts.append(self.log_tail)
        return "\n".join(p for p in parts if p)


def sandbox_exec(run_id: int, phase: str, command: str, timeout_sec: int, agent: str,
                 env: dict | None = None, image: str = "python", collect_metrics: bool | None = None,
                 attempt: int = 0, required_metrics: list[str] | None = None) -> ExecResult:
    """Run a command in a fresh, locked-down container through the Go API (never on this host).
    The agent cannot choose mounts, network, limits or the image beyond python|r."""
    body = {"run_id": run_id, "phase": phase, "command": command, "timeout_sec": timeout_sec,
            "agent": agent, "env": env or {}, "image": image}
    if collect_metrics is not None:
        body["collect_metrics"] = collect_metrics
    if attempt:
        body["attempt"] = attempt
    if required_metrics:
        body["required_metrics"] = [m for m in required_metrics if m]
    resp = _client.post("/internal/sandbox/exec", json=body)
    resp.raise_for_status()
    d = resp.json()
    return ExecResult(
        exec_id=d["exec_id"], exit_code=d["exit_code"], timed_out=d["timed_out"], duration_ms=d["duration_ms"],
        log_path=d["log_path"], log_hash=d["log_hash"], log_tail=d.get("log_tail", ""),
        code_version=d.get("code_version", ""), metrics=d.get("metrics") or [], metrics_error=d.get("metrics_error", ""),
        status=d.get("status", ""), attempt=d.get("attempt", attempt or 1), cancelled=d.get("cancelled", False),
        error=d.get("error", ""), stderr_tail=d.get("stderr_tail", ""), metrics_status=d.get("metrics_status", ""),
        artifacts=d.get("artifacts") or [],
    )


def proof_check(run_id: int, text: str) -> dict:
    """Remove sentences with numbers that no run produced (Hero 2). Fails closed."""
    try:
        resp = _client.post("/internal/proof/check", json={"run_id": run_id, "text": text}, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        log.warning("proof check unavailable: %s", e)
        return {"clean_text": "", "flagged": [{"sentence": text, "unproven_numbers": ["(checker unavailable)"]}]}


def rate_acquire(provider: str, model: str) -> dict:
    try:
        resp = _client.post("/internal/ratelimit/acquire", json={"provider": provider, "model": model}, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        log.warning("rate limiter unavailable (%s); allowing request", e)
        return {"allowed": True, "retry_after_ms": 0}


def ping() -> bool:
    try:
        return _client.get("/livez", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False
