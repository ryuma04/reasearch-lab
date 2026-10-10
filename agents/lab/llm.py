"""AI router: Groq -> Gemini -> OpenRouter fallback chain, guarded by the Go rate limiter.

Roles map to the models of allaboutourproject.md Section 15. If no provider key is set,
`chat()` returns None and every caller falls back to deterministic logic, so the system
still runs end to end (with reduced intelligence) until keys are added.
"""
from __future__ import annotations

import contextvars
import json
import logging
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
    "planner": lambda: settings.model_planner,    # Team Manager, Code Writer, Debugger
    "reviewer": lambda: settings.model_reviewer,  # second opinion
    "writer": lambda: settings.model_writer,      # summaries, explanations
    "fast": lambda: settings.model_fast,          # small decisions
}


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
         temperature: float = 0.2) -> Result | None:
    """Call the best available model for the role, switching API key / provider when one hits its limit.
    If every key is only briefly rate-limited (per-minute limits), waits for the first one to free up."""
    for attempt in range(3):
        res = _try_chain(role, system, user, json_mode, max_tokens, temperature)
        if res is not None:
            return res
        waits = [t - time.time() for t in _cooldown.values() if t > time.time()]
        if not waits or min(waits) > 45:
            return None
        log.info("all keys are briefly rate limited; waiting %.0fs for the first to free up", min(waits))
        time.sleep(min(waits) + 0.5)
    return None


def _try_chain(role, system, user, json_mode, max_tokens, temperature) -> Result | None:
    for provider, model, key, label in _chain(role):
        if _cooldown.get(label, 0) > time.time():
            continue
        dec = api.rate_acquire(label, model)
        if not dec.get("allowed", True):
            log.info("rate limit for %s:%s, switching key/provider", label, model)
            continue
        try:
            if provider == "gemini":
                res = _gemini(model, key, system, user, json_mode, max_tokens, temperature)
            else:
                res = _openai_compatible(provider, model, key, system, user, json_mode, max_tokens, temperature)
        except RateLimited as e:
            _cooldown[label] = time.time() + e.retry_after
            log.warning("%s:%s rate limited by the provider for %.0fs", label, model, e.retry_after)
            continue
        except Exception as e:  # noqa: BLE001 - try the next key/provider
            log.warning("%s:%s failed: %s", label, model, e)
            continue
        acc = current_tokens.get()
        if acc is not None:
            acc[0] += res.tokens
        return res
    return None


def chat_json(role: str, system: str, user: str, *, max_tokens: int = 4096) -> tuple[dict | list | None, int]:
    res = chat(role, system + "\nRespond with valid JSON only.", user, json_mode=True, max_tokens=max_tokens)
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
