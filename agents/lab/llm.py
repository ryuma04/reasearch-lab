"""AI router: Groq -> Gemini -> OpenRouter fallback chain, guarded by the Go rate limiter.

Roles map to the models of allaboutourproject.md Section 15. If no provider key is set,
`chat()` returns None and every caller falls back to deterministic logic, so the system
still runs end to end (with reduced intelligence) until keys are added.
"""
from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass

import httpx

from . import api
from .config import settings

log = logging.getLogger("lab.llm")

# Tokens used by the agent task currently running in this thread/context (for the reward loop).
current_tokens: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("current_tokens", default=None)

_http = httpx.Client(timeout=httpx.Timeout(20.0, read=float(settings.ai_timeout)))


# ---------- Agent -> provider registry (the single place that says who talks to whom) ----------

@dataclass(frozen=True)
class Route:
    provider: str                       # groq | gemini | arina
    role: str                           # which model of the provider (planner | reviewer | writer | fast | long)
    pool: str | None = None             # env prefix of the agent's own keys: <pool>_1, <pool>_2 (or <pool> alone)
    aliases: tuple[str, ...] = ()       # other accepted prefixes for the same pool
    model_env: str | None = None        # optional env var overriding the model for this agent (Arina)
    purpose: str = ""


AGENTS: dict[str, Route] = {
    "research_a": Route("groq", "long", "GROQ_RESEARCH_A_KEY", purpose="Paper Reader: claims, settings and summary from the paper"),
    "research_b": Route("groq", "planner", "GROQ_RESEARCH_B_KEY", purpose="Research Gap Explorer: related-paper extraction, comparison, gaps, recommendations"),
    "planning_a": Route("gemini", "planner", "GEMINI_PLANNING_A_KEY", ("GEMINI_PLANNER_A_KEY",), purpose="Initial Implementation Planner"),
    "planning_b": Route("gemini", "planner", "GEMINI_PLANNING_B_KEY", ("GEMINI_PLANNER_B_KEY",), purpose="Implementation Plan Optimizer"),
    "change_analyzer": Route("gemini", "planner", purpose="Change-request analysis (shares the shared Gemini keys)"),
    "coding": Route("arina", "planner", model_env="ARINA_MODEL_CODING", purpose="Code Writer and version change edits"),
    "debugging": Route("arina", "planner", model_env="ARINA_MODEL_DEBUGGING", purpose="Code Reviewer and Debugger"),
    "testing": Route("groq", "planner", "GROQ_TESTING_API_KEY", purpose="Test design"),
    "final_synthesis": Route("groq", "writer", "GROQ_FINAL_SYNTHESIS_API_KEY", purpose="Plain-language explanation of measured results"),
}
# Calls without an agent (small decisions such as intent classification) use the shared chain (Groq, then Gemini, then OpenRouter).

AUTH_COOLDOWN = 3600.0  # a key the provider rejected is not retried for an hour (and an operator warning is logged)
KEY_PATTERN = re.compile(r"(gsk_|AIza|AQ\.|elev_|hf_|sk-)[A-Za-z0-9_\-.]{8,}")

# Safe metadata of every model call in this context: agent, provider, model, attempt, status, latency, error category.
# It never holds keys, prompts or responses.
invocations: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar("llm_invocations", default=None)
last_outcome: contextvars.ContextVar[dict] = contextvars.ContextVar("llm_last_outcome", default={})
_slots: dict[str, threading.BoundedSemaphore] = {}
_slots_lock = threading.Lock()


def _known_keys() -> list[str]:
    ks = [k for k in (*settings.groq_api_keys, *settings.gemini_api_keys, settings.arina_api_key, settings.openrouter_api_key, settings.hf_token) if k]
    for r in AGENTS.values():
        ks += _dedicated(r)
    return sorted({k for k in ks if len(k) >= 8}, key=len, reverse=True)


def redact(text: object) -> str:
    """Remove every configured key and anything shaped like a provider key from a string before it is logged or stored."""
    s = str(text)
    for k in _known_keys():
        s = s.replace(k, "[redacted]")
    return KEY_PATTERN.sub("[redacted]", s)


def _dedicated(route: Route) -> list[str]:
    names: list[str] = []
    for p in ((route.pool,) if route.pool else ()) + route.aliases:
        names += [f"{p}_1", f"{p}_2", p]
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        v = os.environ.get(n, "").strip()
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def keys_for(agent: str) -> tuple[str, list[str], str]:
    """(provider, keys, source): the agent's own keys when it has any, else the shared keys of the SAME provider."""
    route = AGENTS[agent]
    own = _dedicated(route)
    if own:
        return route.provider, own, "dedicated"
    shared = {"groq": list(settings.groq_api_keys), "gemini": list(settings.gemini_api_keys),
              "arina": [settings.arina_api_key] if settings.arina_api_key else []}[route.provider]
    return route.provider, shared, "shared" if shared else "none"


def model_for(agent: str) -> str:
    route = AGENTS[agent]
    if route.provider == "arina":
        return (os.environ.get(route.model_env or "", "") or settings.arina_model).strip()
    if route.provider == "gemini":
        return settings.gemini_models[0] if settings.gemini_models else ""
    return settings.model_planner if route.role == "long" else ROLE_MODELS.get(route.role, ROLE_MODELS["writer"])()


def pool_keys(agent: str | None) -> tuple[str, list[str]] | None:
    """(provider, keys) of the agent's own dedicated pool, or None when it has none."""
    if not agent or agent not in AGENTS:
        return None
    own = _dedicated(AGENTS[agent])
    return (AGENTS[agent].provider, own) if own else None


def _slot(label: str) -> threading.BoundedSemaphore:
    with _slots_lock:
        if label not in _slots:
            _slots[label] = threading.BoundedSemaphore(max(1, settings.ai_per_key_concurrency))
        return _slots[label]


def _record(agent, provider, model, attempt, ok, started, category="") -> None:
    rec = {"agent": agent or "shared", "provider": provider, "model": model, "attempt": attempt, "ok": ok,
           "latency_ms": int((time.time() - started) * 1000), "error_category": category}
    log.info("llm_invocation %s", rec)
    acc = invocations.get()
    if acc is not None:
        acc.append(rec)


@dataclass
class Result:
    text: str
    tokens: int
    provider: str
    model: str

    def json(self) -> dict | list | None:
        return parse_json(self.text)


def available() -> bool:
    return bool(settings.groq_api_key or settings.gemini_api_key or settings.openrouter_api_key)


def agent_available(agent: str) -> bool:
    """True when the agent's assigned provider has credentials (and, for Arina, a usable URL). No network call."""
    if agent not in AGENTS:
        return False
    provider, keys, _ = keys_for(agent)
    if not keys:
        return False
    return provider != "arina" or bool(re.match(r"^https?://[^\s/]+", settings.arina_base_url or ""))


def providers() -> dict:
    return {"groq_keys": len(settings.groq_api_keys), "gemini_keys": len(settings.gemini_api_keys),
            "gemini_models": list(settings.gemini_models), "openrouter": bool(settings.openrouter_api_key)}


ROLE_MODELS = {
    "planner": lambda: settings.model_planner,    # Code Writer, Debugger, test design
    "reviewer": lambda: settings.model_reviewer,  # second opinion
    "writer": lambda: settings.model_writer,      # summaries, explanations
    "fast": lambda: settings.model_fast,          # small decisions
}


def _agent_chain(agent: str, role: str) -> list[tuple[str, str, str, str]]:
    """Only the agent's assigned provider and keys. It never contains another provider or another agent's dedicated keys."""
    provider, keys, _ = keys_for(agent)
    if provider == "gemini":
        return [("gemini", m, k, f"{agent}:{i + 1}") for m in settings.gemini_models for i, k in enumerate(keys)]
    if provider == "groq":
        model = settings.model_planner if role == "long" else ROLE_MODELS.get(role, ROLE_MODELS["writer"])()
        return [("groq", model, k, f"{agent}:{i + 1}") for i, k in enumerate(keys)]
    return []


def _chain(role: str) -> list[tuple[str, str, str, str]]:
    """Shared chain for calls with no agent: (provider, model, api key, rate-limit label) in order of preference."""
    groq_model = settings.model_planner if role == "long" else ROLE_MODELS.get(role, ROLE_MODELS["writer"])()
    groq = [("groq", groq_model, k, f"groq{i}") for i, k in enumerate(settings.groq_api_keys)]
    gemini = [("gemini", m, k, f"gemini{i}") for m in settings.gemini_models for i, k in enumerate(settings.gemini_api_keys)]
    chain = gemini + groq if role == "long" else groq + gemini  # whole paper with figures: Gemini first
    if settings.openrouter_api_key:
        chain.append(("openrouter", "meta-llama/llama-3.3-70b-instruct:free", settings.openrouter_api_key, "openrouter"))
    return chain


def chat(role: str, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 2048,
         temperature: float = 0.2, agent: str | None = None) -> Result | None:
    """A Groq / Gemini call. With an agent it uses only that agent's provider and keys (rotating inside the pool);
    without one it uses the shared chain. Retries are bounded (AI_MAX_RETRIES): a rate limit waits for the first key
    to free up (up to 45 s), a transient failure backs off, and anything a retry cannot fix stops immediately."""
    if agent is not None and agent not in AGENTS:
        raise ValueError(f"unknown agent '{agent}'")
    if agent is not None and AGENTS[agent].provider == "arina":
        return invoke(agent, system, user, json_mode=json_mode, max_tokens=max_tokens, temperature=temperature)
    for attempt in range(max(1, settings.ai_max_retries)):
        res = _try_chain(role, system, user, json_mode, max_tokens, temperature, agent)
        if res is not None:
            return res
        out = last_outcome.get()
        if out.get("kind") == "rate_limited":
            wait = out.get("wait", 0)
            if not wait or wait > 45:
                return None
            log.info("every key of '%s' is briefly rate limited; waiting %.0fs", agent or "shared", wait)
            time.sleep(wait + 0.5)
        elif out.get("kind") == "transient":
            time.sleep(settings.ai_backoff * (2 ** attempt))
        else:  # auth, invalid_request, no_keys, error: retrying cannot help
            return None
    return None


def _try_chain(role, system, user, json_mode, max_tokens, temperature, agent=None) -> Result | None:
    chain = _agent_chain(agent, role) if agent else _chain(role)
    kinds: set[str] = set()
    waits: list[float] = []
    attempt = 0
    if not chain:
        last_outcome.set({"kind": "no_keys"})
        _record(agent, AGENTS[agent].provider if agent else "none", "-", 0, False, time.time(), "not_configured")
        return None
    for provider, model, key, label in chain:
        remaining = _cooldown.get(label, 0) - time.time()
        if remaining > 0:
            kinds.add("rate_limited")
            waits.append(remaining)
            continue
        dec = api.rate_acquire(label, model)
        if not dec.get("allowed", True):
            log.info("rate limit for %s:%s, switching key", label, model)
            kinds.add("rate_limited")
            waits.append(float(dec.get("retry_after") or 5))
            continue
        attempt += 1
        started = time.time()
        try:
            with _slot(label):  # at most AI_MAX_CONCURRENCY_PER_KEY requests in flight on one key
                if provider == "gemini":
                    res = _gemini(model, key, system, user, json_mode, max_tokens, temperature)
                else:
                    res = _openai_compatible(provider, model, key, system, user, json_mode, max_tokens, temperature)
        except RateLimited as e:
            _cooldown[label] = time.time() + e.retry_after
            waits.append(e.retry_after)
            kinds.add("rate_limited")
            log.warning("%s:%s rate limited by the provider for %.0fs", label, model, e.retry_after)
            _record(agent, provider, model, attempt, False, started, "rate_limited")
            continue
        except Exception as e:  # noqa: BLE001 - classify, then try the next key only when that can help
            code = _http_status(e)
            msg = redact(e)[:200]
            if code in (401, 403):
                _cooldown[label] = time.time() + AUTH_COOLDOWN
                log.error("OPERATOR WARNING: the %s key '%s' was rejected by the provider (HTTP %s); it is paused for 1 hour", provider, label, code)
                kinds.add("auth")
                _record(agent, provider, model, attempt, False, started, "auth")
                continue
            log.warning("%s:%s failed: %s", label, model, msg)
            if code in (400, 404, 422):  # a bad request fails identically on the other key: stop, do not rotate
                last_outcome.set({"kind": "invalid_request", "message": msg})
                _record(agent, provider, model, attempt, False, started, "invalid_request")
                return None
            kinds.add("transient" if (code is None or code >= 500) else "error")
            _record(agent, provider, model, attempt, False, started, "transient" if (code is None or code >= 500) else "error")
            continue
        _record(agent, provider, model, attempt, True, started)
        last_outcome.set({"kind": "ok"})
        acc = current_tokens.get()
        if acc is not None:
            acc[0] += res.tokens
        return res
    kind = "transient" if "transient" in kinds else "rate_limited" if "rate_limited" in kinds else "auth" if "auth" in kinds else "error"
    last_outcome.set({"kind": kind, "wait": min(waits) if waits else 0})
    return None


def _http_status(e: Exception) -> int | None:
    m = re.match(r"HTTP (\d{3})", str(e))
    return int(m.group(1)) if m else None


def chat_json(role: str, system: str, user: str, *, max_tokens: int = 4096, agent: str | None = None) -> tuple[dict | list | None, int]:
    res = chat(role, system + "\nRespond with valid JSON only.", user, json_mode=True, max_tokens=max_tokens, agent=agent)
    if res is None:
        return None, 0
    data = res.json()
    if data is None:
        log.warning("%s:%s returned invalid JSON (%d chars)", res.provider, res.model, len(res.text))
    return data, res.tokens


def invoke(agent: str, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 2048, temperature: float = 0.2) -> Result | None:
    """The one entry point for an assigned agent. Groq and Gemini agents rotate inside their pool; Arina agents call the
    Arina gateway. On failure it returns None (the reason is in last_error()) and never claims success. Another provider
    answers only for an Arina agent and only when ARINA_FALLBACK_TO_SHARED=true, and then Result.provider says so."""
    route = AGENTS.get(agent)
    if route is None:
        raise ValueError(f"unknown agent '{agent}'")
    if route.provider != "arina":
        return chat(route.role, system, user, json_mode=json_mode, max_tokens=max_tokens, temperature=temperature, agent=agent)
    model = model_for(agent)
    started = time.time()
    try:
        res = arina(system, user, max_output_tokens=max_tokens, model=model, cap=settings.arina_max_output_tokens_code)
        _record(agent, "arina", model, 1, True, started)
        last_outcome.set({"kind": "ok"})
        return res
    except ArinaUnavailable as e:
        msg = redact(e)
        cat = ("not_configured" if "not set" in msg or "not a valid" in msg else "budget" if "budget" in msg else "too_large" if "48 KB" in msg
               else "rate_limited" if "rate limited" in msg else "invalid_request" if "HTTP 400" in msg else "provider_error")
        _record(agent, "arina", model, 1, False, started, cat)
        last_outcome.set({"kind": cat, "message": msg})
        log.warning("Arina failed for '%s': %s", agent, msg[:200])
        if not settings.arina_fallback_shared:
            return None
    log.warning("ARINA_FALLBACK_TO_SHARED is on: '%s' is answered by the shared chain instead of Arina", agent)
    fb = chat(route.role, system, user, json_mode=json_mode, max_tokens=max_tokens, temperature=temperature)
    _record(agent, fb.provider if fb else "none", fb.model if fb else "-", 2, fb is not None, started, "" if fb else "fallback_failed")
    return fb


def last_error() -> str:
    return last_outcome.get().get("message") or last_outcome.get().get("kind", "")


def invoke_json(agent: str, system: str, user: str, *, max_tokens: int = 4096) -> tuple[dict | list | None, int]:
    res = invoke(agent, system + "\nRespond with valid JSON only.", user, json_mode=True, max_tokens=max_tokens)
    if res is None:
        return None, 0
    data = res.json()
    if data is None:
        log.warning("%s:%s returned invalid JSON (%d chars)", res.provider, res.model, len(res.text))
    return data, res.tokens


# ---------- configuration check and connection health ----------

def config_issues() -> list[str]:
    """Problems found without any network call. Never contains a key."""
    issues: list[str] = []
    url = settings.arina_base_url
    if not re.match(r"^https?://[^\s/]+", url or ""):
        issues.append("ARINA_BASE_URL is not a valid http(s) URL")
    if settings.ai_max_retries < 1:
        issues.append("AI_MAX_RETRIES must be at least 1")
    seen: dict[str, str] = {}
    for name, r in AGENTS.items():
        if r.pool and (r.provider != "arina"):
            for k in _dedicated(r):
                if k in seen and seen[k] != name:
                    issues.append(f"the same {r.provider} key is configured for both '{seen[k]}' and '{name}' (they share one quota)")
                seen.setdefault(k, name)
    return issues


_health_cache: dict[tuple[str, str], tuple[float, dict]] = {}
HEALTH_TTL = 300.0


def _probe(provider: str, key: str, model: str, level: str) -> dict:
    """One key, one provider: 'auth' uses the free models listing, 'request' sends a tiny completion."""
    started = time.time()
    try:
        if level == "auth":
            if provider == "groq":
                r = _http.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
            else:
                r = _http.get("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": key}, timeout=15)
            _check(r)
            status = "authentication_verified"
        else:
            if provider == "gemini":
                _gemini(model, key, "Reply with OK.", "ping", False, 64, 0.0)
            else:
                _openai_compatible("groq", model, key, "Reply with OK.", "ping", False, 16, 0.0)
            status = "request_verified"
        return {"status": status, "latency_ms": int((time.time() - started) * 1000), "error_category": ""}
    except RateLimited:
        return {"status": "rate_limited", "latency_ms": None, "error_category": "rate_limited"}
    except Exception as e:  # noqa: BLE001
        code = _http_status(e)
        return {"status": "authentication_failed" if code in (401, 403) else "invalid_request" if code in (400, 404, 422) else "provider_unavailable",
                "latency_ms": None, "error_category": f"http_{code}" if code else type(e).__name__}


def health(level: str = "none") -> dict:
    """Per-agent routing and connection status. level: none (configuration only), auth (free authenticated listing per key),
    request (a tiny completion per key; Arina costs a few tokens of the team budget). Live results are cached for 5 minutes."""
    if level not in ("none", "auth", "request"):
        raise ValueError("level must be none, auth or request")
    agents = []
    for name, route in AGENTS.items():
        provider, keys, source = keys_for(name)
        entry = {"agent": name, "provider": provider, "model": model_for(name), "purpose": route.purpose, "keys_configured": len(keys), "key_source": source,
                 "status": "configured" if keys else "invalid_configuration", "detail": "" if keys else "no credentials configured for this agent's provider",
                 "live_tested": False, "latency_ms": None, "error_category": "", "keys": []}
        if provider == "arina" and not re.match(r"^https?://[^\s/]+", settings.arina_base_url or ""):
            entry.update(status="invalid_configuration", detail="ARINA_BASE_URL is not a valid http(s) URL")
        elif keys and level != "none":
            ck = (name, level)
            cached = _health_cache.get(ck)
            if cached and time.time() - cached[0] < HEALTH_TTL:
                entry.update(cached[1])
            else:
                results = []
                if provider == "arina":
                    if level == "auth":
                        entry.update(detail="Arina has no authenticated no-cost endpoint; use level=request for a live check")
                    else:
                        t = time.time()
                        r = None
                        try:
                            r = arina("Reply with OK.", "ping", max_output_tokens=600, model=model_for(name))
                        except ArinaUnavailable as e:
                            results.append({"label": f"{name}:1", "status": "provider_unavailable", "latency_ms": None, "error_category": redact(e)[:80]})
                        if r:
                            results.append({"label": f"{name}:1", "status": "request_verified", "latency_ms": int((time.time() - t) * 1000), "error_category": ""})
                else:
                    model = settings.gemini_models[0] if provider == "gemini" else model_for(name)
                    for i, k in enumerate(keys, 1):
                        results.append({"label": f"{name}:{i}", **_probe(provider, k, model, level)})
                if results:
                    ok = [r for r in results if r["status"] in ("authentication_verified", "request_verified")]
                    best = ok[0] if ok else results[0]
                    upd = {"status": best["status"], "live_tested": True, "latency_ms": best["latency_ms"], "error_category": best["error_category"], "keys": results}
                    entry.update(upd)
                    _health_cache[ck] = (time.time(), upd)
        agents.append(entry)
    return {"level": level, "agents": agents, "issues": config_issues(), "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


class RateLimited(Exception):
    def __init__(self, retry_after: float):
        super().__init__(f"rate limited, retry after {retry_after}s")
        self.retry_after = retry_after


_cooldown: dict[str, float] = {}  # rate-limit label -> time when it may be used again


def _check(resp: httpx.Response) -> None:
    if resp.status_code == 429:
        try:
            ra = float(resp.headers.get("retry-after", "30"))
        except ValueError:
            ra = 30.0
        raise RateLimited(min(max(ra, 5.0), 3600.0))
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {redact(resp.text[:300])}")


def _openai_compatible(provider, model, key, system, user, json_mode, max_tokens, temperature) -> Result:
    if provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if "gpt-oss" in model:  # reasoning tokens count against the per-minute token limit
        body["reasoning_effort"] = "medium" if model == settings.model_planner else "low"
    resp = _http.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
    _check(resp)
    d = resp.json()
    text = d["choices"][0]["message"].get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # reasoning models
    tokens = int((d.get("usage") or {}).get("total_tokens", 0))
    return Result(text=text, tokens=tokens, provider=provider, model=model)


def _gemini(model, key, system, user, json_mode, max_tokens, temperature) -> Result:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    gen = {"maxOutputTokens": max_tokens + 8192, "temperature": temperature}  # thinking models need headroom
    if json_mode:
        gen["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen,
    }
    resp = _http.post(url, json=body, headers={"x-goog-api-key": key})
    _check(resp)
    d = resp.json()
    parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text.strip():
        raise RuntimeError(f"empty answer (finishReason={(d.get('candidates') or [{}])[0].get('finishReason')})")
    tokens = int((d.get("usageMetadata") or {}).get("totalTokenCount", 0))
    return Result(text=text, tokens=tokens, provider="gemini", model=model)


# ---------- Arina AI (Elevate gateway): the Self-Healing Debugger's model ----------

ARINA_MAX_REQUEST_BYTES = 48 * 1024  # gateway limit
ARINA_USED_KEY = "lab:arina:tokens_used"


class ArinaUnavailable(Exception):
    """Not configured, over budget, request too large or the gateway failed."""


def arina_available() -> bool:
    return bool(settings.arina_api_key)


def arina_tokens_used() -> int:
    from . import bus
    try:
        return int(bus.r.get(ARINA_USED_KEY) or 0)
    except Exception:  # noqa: BLE001
        return 0


def _arina_record(tokens: int) -> None:
    from . import bus
    try:
        bus.r.incrby(ARINA_USED_KEY, int(tokens))
    except Exception as e:  # noqa: BLE001
        log.warning("could not record Arina token use: %s", e)


def arina(system: str, user: str, *, max_output_tokens: int | None = None, model: str | None = None, cap: int | None = None) -> Result:
    """One Chat Completions call to the Elevate gateway (text only, no streaming). Refuses before
    sending if the team budget would be exceeded or the request is over 48 KB."""
    if not settings.arina_api_key:
        raise ArinaUnavailable("ARINA_API_KEY is not set")
    if not re.match(r"^https?://[^\s/]+", settings.arina_base_url or ""):
        raise ArinaUnavailable("ARINA_BASE_URL is not a valid http(s) URL")
    out = min(max_output_tokens or settings.arina_max_output_tokens, cap or settings.arina_max_output_tokens)
    model = model or settings.arina_model
    body = {"model": model, "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    # DeepSeek takes max_tokens; the GPT models take max_completion_tokens (and only the default temperature).
    body["max_tokens" if model.startswith("deepseek") else "max_completion_tokens"] = out
    if model.startswith("gpt-5") and settings.arina_reasoning_effort:
        body["reasoning_effort"] = settings.arina_reasoning_effort  # hidden reasoning also uses output tokens
    raw = json.dumps(body).encode()
    if len(raw) > ARINA_MAX_REQUEST_BYTES:
        raise ArinaUnavailable(f"request is {len(raw)} bytes, over the gateway's 48 KB limit")
    used = arina_tokens_used()
    if used + len(raw) // 4 + out > settings.arina_token_budget:
        raise ArinaUnavailable(f"Arina token budget reached ({used} of {settings.arina_token_budget} used)")
    try:
        headers = {"Authorization": f"Bearer {settings.arina_api_key}", "Content-Type": "application/json"}
        resp = _http.post(settings.arina_base_url, content=raw, headers=headers)
        if resp.status_code == 400 and "reasoning_effort" in body:  # gateway rejected the field: no tokens spent
            body.pop("reasoning_effort")
            raw = json.dumps(body).encode()
            resp = _http.post(settings.arina_base_url, content=raw, headers=headers)
        _check(resp)
        d = resp.json()
    except (RateLimited, RuntimeError, httpx.HTTPError, ValueError) as e:
        raise ArinaUnavailable(f"Arina request failed: {redact(e)}") from e
    choice = (d.get("choices") or [{}])[0]
    text = re.sub(r"<think>.*?</think>", "", (choice.get("message") or {}).get("content") or "", flags=re.S).strip()
    usage = d.get("usage") or {}
    tokens = int(usage.get("total_tokens") or (len(raw) // 4 + len(text) // 4))
    _arina_record(tokens)
    acc = current_tokens.get()
    if acc is not None:
        acc[0] += tokens
    if not text:
        raise ArinaUnavailable(f"empty answer (finish_reason={choice.get('finish_reason')})")
    return Result(text=text, tokens=tokens, provider="arina", model=model)


def parse_json(text: str):
    if not text:
        return None
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, flags=re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = t.find(open_c), t.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(t[start:end + 1])
            except ValueError:
                continue
    return None
