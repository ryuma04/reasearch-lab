"""API key switching: when one key hits its limit (HTTP 429), the next key is used."""
import os
import sys
from dataclasses import replace

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lab import api, llm  # noqa: E402


def _setup(monkeypatch, handler):
    s = replace(llm.settings, groq_api_keys=("key-A", "key-B", "key-C"), gemini_api_keys=("gem-A",),
                gemini_models=("gemini-test",), openrouter_api_key="")
    monkeypatch.setattr(llm, "settings", s)
    monkeypatch.setattr(llm, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(api, "rate_acquire", lambda provider, model: {"allowed": True})
    llm._cooldown.clear()


def _ok(text="hello"):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}], "usage": {"total_tokens": 7}})


def test_switches_to_next_key_on_429_and_cools_down(monkeypatch):
    used = []

    def handler(req: httpx.Request):
        key = req.headers.get("authorization", "").removeprefix("Bearer ")
        used.append(key)
        if key == "key-A":
            return httpx.Response(429, headers={"retry-after": "60"}, json={"error": "rate limit"})
        return _ok()

    _setup(monkeypatch, handler)
    res = llm.chat("fast", "sys", "hi")
    assert res is not None and res.text == "hello"
    assert used == ["key-A", "key-B"]          # A hit its limit -> switched to B in the same call

    used.clear()
    llm.chat("fast", "sys", "hi again")
    assert used == ["key-B"]                    # A is cooling down, skipped without a request


def test_falls_back_to_gemini_when_all_groq_keys_are_limited(monkeypatch):
    def handler(req: httpx.Request):
        if "groq.com" in str(req.url):
            return httpx.Response(429, headers={"retry-after": "30"})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "from gemini"}]}}],
                                         "usageMetadata": {"totalTokenCount": 3}})

    _setup(monkeypatch, handler)
    res = llm.chat("fast", "sys", "hi")
    assert res.provider == "gemini" and res.text == "from gemini"


def test_skips_key_when_our_rate_limiter_says_it_is_full(monkeypatch):
    used = []

    def handler(req):
        used.append(req.headers["authorization"])
        return _ok()

    _setup(monkeypatch, handler)
    monkeypatch.setattr(api, "rate_acquire", lambda provider, model: {"allowed": provider != "groq0"})
    llm.chat("fast", "sys", "hi")
    assert used == ["Bearer key-B"]            # key-A's daily/minute quota is full: never called


def test_returns_none_when_every_key_is_exhausted(monkeypatch):
    _setup(monkeypatch, lambda req: httpx.Response(429, headers={"retry-after": "3600"}))  # too long to wait for
    assert llm.chat("fast", "sys", "hi") is None  # callers then use their non-AI fallback


def test_waits_for_short_rate_limit_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(429, headers={"retry-after": "5"}) if calls["n"] <= 4 else _ok("after wait")

    _setup(monkeypatch, handler)
    monkeypatch.setattr(llm.time, "sleep", lambda s: [llm._cooldown.update({k: 0 for k in llm._cooldown})])
    res = llm.chat("fast", "sys", "hi")   # 3 Groq keys + 1 Gemini key all limited, then a key frees up
    assert res is not None and res.text == "after wait"
