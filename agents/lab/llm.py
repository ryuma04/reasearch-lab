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
import time
from dataclasses import dataclass

import httpx

from . import api
from .config import settings

log = logging.getLogger("lab.llm")

# Tokens used by the agent task currently running in this thread/context (for the reward loop).
current_tokens: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("current_tokens", default=None)

_http = httpx.Client(timeout=httpx.Timeout(20.0, read=180.0))


# Per-agent key pools (spec: two keys per agent, never shared across agents). Variable names: <PREFIX>_1, <PREFIX>_2.
# An agent whose pool is not configured falls back to the shared GROQ_API_KEYS / GEMINI_API_KEYS lists.
AGENT_POOLS: dict[str, tuple[str, str]] = {
    "research_a": ("groq", "GROQ_RESEARCH_A_KEY"),
    "research_b": ("groq", "GROQ_RESEARCH_B_KEY"),
    "planning_a": ("gemini", "GEMINI_PLANNING_A_KEY"),
    "planning_b": ("gemini", "GEMINI_PLANNING_B_KEY"),
}
AUTH_COOLDOWN = 3600.0  # a key the provider rejected is not retried for an hour (and an operator warning is logged)

# Safe metadata of every model call in this context: agent, provider, model, attempt, status, latency, error category.
# It never holds keys, prompts or responses.
invocations: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar("llm_invocations", default=None)


def pool_keys(agent: str | None) -> tuple[str, list[str]] | None:
    """(provider, keys) of the agent's own pool, or None when the agent has no configured pool."""
    spec = AGENT_POOLS.get(agent or "")
    if not spec:
        return None
    keys = [v.strip() for v in (os.environ.get(f"{spec[1]}_1", ""), os.environ.get(f"{spec[1]}_2", "")) if v.strip()]
    return (spec[0], keys) if keys else None


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


def providers() -> dict:
    return {"groq_keys": len(settings.groq_api_keys), "gemini_keys": len(settings.gemini_api_keys),
            "gemini_models": list(settings.gemini_models), "openrouter": bool(settings.openrouter_api_key)}


ROLE_MODELS = {
    "planner": lambda: settings.model_planner,    # Code Writer, Debugger, test design
    "reviewer": lambda: settings.model_reviewer,  # second opinion
    "writer": lambda: settings.model_writer,      # summaries, explanations
    "fast": lambda: settings.model_fast,          # small decisions
}


def _agent_chain(agent: str, role: str) -> list[tuple[str, str, str, str]] | None:
    """Only the agent's own two keys (no spill into another agent's pool)."""
    pool = pool_keys(agent)
    if pool is None:
        return None
    provider, keys = pool
    if provider == "gemini":
        return [("gemini", m, k, f"{agent}:{i + 1}") for m in settings.gemini_models for i, k in enumerate(keys)]
    model = settings.model_planner if role == "long" else ROLE_MODELS.get(role, ROLE_MODELS["writer"])()
    return [("groq", model, k, f"{agent}:{i + 1}") for i, k in enumerate(keys)]


def _chain(role: str) -> list[tuple[str, str, str, str]]:
    """(provider, model, api key, rate-limit label) in order of preference. Every key of a provider
    is tried before moving to the next provider, so one exhausted key never stops the lab."""
    groq_model = settings.model_planner if role == "long" else ROLE_MODELS.get(role, ROLE_MODELS["writer"])()
    groq = [("groq", groq_model, k, f"groq{i}") for i, k in enumerate(settings.groq_api_keys)]
    gemini = [("gemini", m, k, f"gemini{i}") for m in settings.gemini_models for i, k in enumerate(settings.gemini_api_keys)]
    chain = gemini + groq if role == "long" else groq + gemini  # whole paper with figures: Gemini first
    if settings.openrouter_api_key:
        chain.append(("openrouter", "meta-llama/llama-3.3-70b-instruct:free", settings.openrouter_api_key, "openrouter"))
    return chain


def chat(role: str, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 2048,
         temperature: float = 0.2, agent: str | None = None) -> Result | None:
    """Call the best available model for the role, switching API key / provider when one hits its limit.
    If every key is only briefly rate-limited (per-minute limits), waits for the first one to free up."""
    for attempt in range(3):
        res = _try_chain(role, system, user, json_mode, max_tokens, temperature, agent)
        if res is not None:
            return res
        waits = [t - time.time() for t in _cooldown.values() if t > time.time()]
        if not waits or min(waits) > 45:
            return None
        log.info("all keys are briefly rate limited; waiting %.0fs for the first to free up", min(waits))
        time.sleep(min(waits) + 0.5)
    return None


def _try_chain(role, system, user, json_mode, max_tokens, temperature, agent=None) -> Result | None:
    pooled = _agent_chain(agent, role) if agent else None
    attempt = 0
    for provider, model, key, label in (pooled if pooled is not None else _chain(role)):
        if _cooldown.get(label, 0) > time.time():
            continue
        dec = api.rate_acquire(label, model)
        if not dec.get("allowed", True):
            log.info("rate limit for %s:%s, switching key/provider", label, model)
            continue
        attempt += 1
        started = time.time()
        try:
            if provider == "gemini":
                res = _gemini(model, key, system, user, json_mode, max_tokens, temperature)
            else:
                res = _openai_compatible(provider, model, key, system, user, json_mode, max_tokens, temperature)
        except RateLimited as e:
            _cooldown[label] = time.time() + e.retry_after
            log.warning("%s:%s rate limited by the provider for %.0fs", label, model, e.retry_after)
            _record(agent, provider, model, attempt, False, started, "rate_limited")
            continue
        except Exception as e:  # noqa: BLE001 - classify, then try the next key only when that can help
            code = _http_status(e)
            if code in (401, 403):
                _cooldown[label] = time.time() + AUTH_COOLDOWN
                log.error("OPERATOR WARNING: the %s key '%s' was rejected by the provider (HTTP %s); it is paused for 1 hour", provider, label, code)
                _record(agent, provider, model, attempt, False, started, "auth")
                continue
            log.warning("%s:%s failed: %s", label, model, str(e)[:200])
            if code in (400, 404, 422) and pooled is not None:  # a bad request will fail on the other key too
                _record(agent, provider, model, attempt, False, started, "invalid_request")
                return None
            _record(agent, provider, model, attempt, False, started, "transient" if (code is None or code >= 500) else "error")
            continue
        _record(agent, provider, model, attempt, True, started)
        acc = current_tokens.get()
        if acc is not None:
            acc[0] += res.tokens
        return res
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
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")


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


def arina(system: str, user: str, *, max_output_tokens: int | None = None) -> Result:
    """One Chat Completions call to the Elevate gateway (text only, no streaming). Refuses before
    sending if the team budget would be exceeded or the request is over 48 KB."""
    if not settings.arina_api_key:
        raise ArinaUnavailable("ARINA_API_KEY is not set")
    out = min(max_output_tokens or settings.arina_max_output_tokens, settings.arina_max_output_tokens)
    model = settings.arina_model
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
        raise ArinaUnavailable(f"Arina request failed: {e}") from e
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
