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
    return {"groq": bool(settings.groq_api_key), "gemini": bool(settings.gemini_api_key),
            "openrouter": bool(settings.openrouter_api_key)}


ROLE_MODELS = {
    "planner": lambda: settings.model_planner,    # Team Manager, Code Writer, Debugger
    "reviewer": lambda: settings.model_reviewer,  # second opinion
    "writer": lambda: settings.model_writer,      # summaries, explanations
    "fast": lambda: settings.model_fast,          # small decisions
}


def _chain(role: str) -> list[tuple[str, str]]:
    chain: list[tuple[str, str]] = []
    if role == "long":  # whole paper with figures: Gemini first
        if settings.gemini_api_key:
            chain.append(("gemini", settings.model_gemini))
        if settings.groq_api_key:
            chain.append(("groq", settings.model_writer))
    else:
        if settings.groq_api_key:
            chain.append(("groq", ROLE_MODELS.get(role, ROLE_MODELS["writer"])()))
        if settings.gemini_api_key:
            chain.append(("gemini", settings.model_gemini))
    if settings.openrouter_api_key:
        chain.append(("openrouter", "meta-llama/llama-3.3-70b-instruct:free"))
    return chain


def chat(role: str, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 2048,
         temperature: float = 0.2) -> Result | None:
    """Call the best available model for the role. Returns None if every provider is unavailable."""
    for provider, model in _chain(role):
        dec = api.rate_acquire(provider, model)
        if not dec.get("allowed", True):
            wait = dec.get("retry_after_ms", 0) / 1000
            if wait <= 6:
                time.sleep(wait)
                dec = api.rate_acquire(provider, model)
            if not dec.get("allowed", True):
                log.info("rate limit for %s:%s, switching provider", provider, model)
                continue
        try:
            if provider == "gemini":
                res = _gemini(model, system, user, json_mode, max_tokens, temperature)
            else:
                res = _openai_compatible(provider, model, system, user, json_mode, max_tokens, temperature)
        except Exception as e:  # noqa: BLE001 - try the next provider
            log.warning("%s:%s failed: %s", provider, model, e)
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
    return res.json(), res.tokens


def _openai_compatible(provider, model, system, user, json_mode, max_tokens, temperature) -> Result:
    if provider == "groq":
        url, key = "https://api.groq.com/openai/v1/chat/completions", settings.groq_api_key
    else:
        url, key = "https://openrouter.ai/api/v1/chat/completions", settings.openrouter_api_key
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    resp = _http.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    d = resp.json()
    text = d["choices"][0]["message"].get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # reasoning models
    tokens = int((d.get("usage") or {}).get("total_tokens", 0))
    return Result(text=text, tokens=tokens, provider=provider, model=model)


def _gemini(model, system, user, json_mode, max_tokens, temperature) -> Result:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    gen = {"maxOutputTokens": max_tokens, "temperature": temperature}
    if json_mode:
        gen["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": gen,
    }
    resp = _http.post(url, json=body, headers={"x-goog-api-key": settings.gemini_api_key})
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    d = resp.json()
    parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
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
