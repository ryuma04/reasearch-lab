"""AI provider routing: every agent uses its assigned provider and keys, rotation and retries are bounded and honest,
Arina's contract is respected and no secret leaks. Provider calls are mocked; nothing here reaches a real provider."""
import ast
import dataclasses
import json
import pathlib

import httpx
import pytest

from lab import llm

POOL_VARS = ["GROQ_RESEARCH_A_KEY", "GROQ_RESEARCH_B_KEY", "GEMINI_PLANNING_A_KEY", "GEMINI_PLANNING_B_KEY", "GEMINI_PLANNER_A_KEY", "GEMINI_PLANNER_B_KEY",
             "GROQ_TESTING_API_KEY", "GROQ_FINAL_SYNTHESIS_API_KEY"]
SECRET = "gsk_SECRETVALUE1234567890"


@pytest.fixture
def env(monkeypatch):
    for p in POOL_VARS:
        for suffix in ("", "_1", "_2"):
            monkeypatch.delenv(p + suffix, raising=False)
    for k, v in {"GROQ_RESEARCH_A_KEY_1": "ra1", "GROQ_RESEARCH_A_KEY_2": "ra2", "GROQ_RESEARCH_B_KEY_1": "rb1", "GROQ_RESEARCH_B_KEY_2": "rb2",
                 "GEMINI_PLANNING_A_KEY_1": "pa1", "GEMINI_PLANNING_A_KEY_2": "pa2", "GEMINI_PLANNING_B_KEY_1": "pb1", "GEMINI_PLANNING_B_KEY_2": "pb2",
                 "GROQ_TESTING_API_KEY": "tk", "GROQ_FINAL_SYNTHESIS_API_KEY": "fk"}.items():
        monkeypatch.setenv(k, v)
    s = dataclasses.replace(llm.settings, groq_api_keys=("shared-g1", "shared-g2"), gemini_api_keys=("shared-m1",), arina_api_key="arina-key",
                            arina_base_url="https://gateway.example/api/ai", arina_model="gpt-5-mini", ai_max_retries=3, ai_backoff=0.0,
                            arina_fallback_shared=False, gemini_models=("gem-a",), openrouter_api_key="")
    monkeypatch.setattr(llm, "settings", s)
    monkeypatch.setattr(llm.api, "rate_acquire", lambda *a, **k: {"allowed": True})
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    llm._cooldown.clear()
    llm._health_cache.clear()
    llm.last_outcome.set({})
    return s


class Calls:
    def __init__(self, monkeypatch):
        self.log: list[tuple[str, str, str]] = []  # (provider, model, key)
        self.script = {}  # key -> exception to raise
        monkeypatch.setattr(llm, "_openai_compatible", self._groq)
        monkeypatch.setattr(llm, "_gemini", self._gemini)
        monkeypatch.setattr(llm, "arina", self._arina)

    def _go(self, provider, model, key):
        self.log.append((provider, model, key))
        if key in self.script:
            raise self.script[key]
        return llm.Result("ok", 3, provider, model)

    def _groq(self, provider, model, key, *a):
        return self._go(provider, model, key)

    def _gemini(self, model, key, *a):
        return self._go("gemini", model, key)

    def _arina(self, system, user, **kw):
        self.log.append(("arina", kw.get("model") or "", "arina-key"))
        if "arina" in self.script:
            raise self.script["arina"]
        return llm.Result("ok", 3, "arina", kw.get("model") or "")

    def providers(self):
        return {p for p, _, _ in self.log}

    def keys(self):
        return [k for _, _, k in self.log]


@pytest.fixture
def calls(env, monkeypatch):
    return Calls(monkeypatch)


# ---------- configuration ----------

def test_every_agent_is_assigned_to_the_required_provider():
    want = {"research_a": "groq", "research_b": "groq", "planning_a": "gemini", "planning_b": "gemini", "coding": "arina", "debugging": "arina",
            "testing": "groq", "final_synthesis": "groq"}
    assert {a: llm.AGENTS[a].provider for a in want} == want


def test_each_agent_gets_only_its_own_pool(env):
    assert llm.keys_for("research_a") == ("groq", ["ra1", "ra2"], "dedicated")
    assert llm.keys_for("research_b") == ("groq", ["rb1", "rb2"], "dedicated")
    assert llm.keys_for("planning_a") == ("gemini", ["pa1", "pa2"], "dedicated")
    assert llm.keys_for("planning_b") == ("gemini", ["pb1", "pb2"], "dedicated")
    assert llm.keys_for("testing") == ("groq", ["tk"], "dedicated") and llm.keys_for("final_synthesis") == ("groq", ["fk"], "dedicated")
    assert llm.keys_for("coding") == ("arina", ["arina-key"], "shared")


def test_the_alternative_planner_variable_names_are_accepted(env, monkeypatch):
    for k in ("GEMINI_PLANNING_A_KEY_1", "GEMINI_PLANNING_A_KEY_2"):
        monkeypatch.delenv(k)
    monkeypatch.setenv("GEMINI_PLANNER_A_KEY_1", "alt1")
    monkeypatch.setenv("GEMINI_PLANNER_A_KEY_2", "alt2")
    assert llm.keys_for("planning_a")[1] == ["alt1", "alt2"]


def test_with_only_two_gemini_keys_the_report_says_the_pools_are_shared(env, monkeypatch):
    for p in ("GEMINI_PLANNING_A_KEY", "GEMINI_PLANNING_B_KEY"):
        monkeypatch.delenv(p + "_1"); monkeypatch.delenv(p + "_2")
    monkeypatch.setenv("GEMINI_PLANNING_A_KEY_1", "same1"); monkeypatch.setenv("GEMINI_PLANNING_A_KEY_2", "same2")
    monkeypatch.setenv("GEMINI_PLANNING_B_KEY_1", "same1"); monkeypatch.setenv("GEMINI_PLANNING_B_KEY_2", "same2")
    assert any("the same gemini key is configured for both" in i for i in llm.config_issues())


def test_missing_credentials_are_reported_not_silently_replaced(env, monkeypatch):
    monkeypatch.setattr(llm, "settings", dataclasses.replace(env, gemini_api_keys=(), groq_api_keys=(), arina_api_key=""))
    for p in POOL_VARS:
        for suffix in ("", "_1", "_2"):
            monkeypatch.delenv(p + suffix, raising=False)
    assert not llm.agent_available("planning_a") and not llm.agent_available("research_a") and not llm.agent_available("coding")
    h = {a["agent"]: a for a in llm.health("none")["agents"]}
    assert h["planning_a"]["status"] == "invalid_configuration" and h["coding"]["status"] == "invalid_configuration"
    assert llm.chat("planner", "s", "u", agent="planning_a") is None and llm.last_outcome.get()["kind"] == "no_keys"


def test_an_invalid_arina_url_is_rejected(env, monkeypatch):
    monkeypatch.setattr(llm, "settings", dataclasses.replace(env, arina_base_url="not a url"))
    assert any("ARINA_BASE_URL" in i for i in llm.config_issues())
    assert not llm.agent_available("coding")
    with pytest.raises(llm.ArinaUnavailable, match="not a valid"):
        llm.arina("s", "u")


def test_no_key_value_appears_in_health_issues_or_redacted_errors(env, monkeypatch):
    monkeypatch.setenv("GROQ_RESEARCH_A_KEY_1", SECRET)
    blob = json.dumps(llm.health("none")) + " ".join(llm.config_issues())
    assert SECRET not in blob and "ra2" not in blob
    assert SECRET not in llm.redact(f"Incorrect API key provided: {SECRET}") and "[redacted]" in llm.redact(f"bad key {SECRET}")
    assert "AIzaSyABCDEFGHIJKLMN" not in llm.redact("key AIzaSyABCDEFGHIJKLMN invalid")


def test_unknown_agent_is_an_error_not_a_silent_default(env):
    with pytest.raises(ValueError):
        llm.chat("planner", "s", "u", agent="reserch_a")
    with pytest.raises(ValueError):
        llm.invoke("nobody", "s", "u")


# ---------- routing ----------

@pytest.mark.parametrize("agent,provider,keys", [("research_a", "groq", {"ra1", "ra2"}), ("research_b", "groq", {"rb1", "rb2"}),
                                                  ("planning_a", "gemini", {"pa1", "pa2"}), ("planning_b", "gemini", {"pb1", "pb2"}),
                                                  ("testing", "groq", {"tk"}), ("final_synthesis", "groq", {"fk"}), ("coding", "arina", {"arina-key"}),
                                                  ("debugging", "arina", {"arina-key"})])
def test_each_agent_calls_its_provider_with_its_own_keys(calls, agent, provider, keys):
    res = llm.invoke(agent, "s", "u")
    assert res is not None and res.provider == provider
    assert calls.providers() == {provider} and set(calls.keys()) <= keys


def test_a_retry_never_switches_the_agent_to_another_provider(calls):
    calls.script = {"pa1": RuntimeError("HTTP 503: down"), "pa2": RuntimeError("HTTP 503: down")}
    assert llm.invoke("planning_a", "s", "u") is None
    assert calls.providers() == {"gemini"}  # Groq keys exist (shared) but are never tried for a Gemini agent
    assert llm.last_outcome.get()["kind"] == "transient"


def test_one_agents_exhausted_pool_never_borrows_another_agents_keys(calls):
    calls.script = {"ra1": llm.RateLimited(600), "ra2": llm.RateLimited(600)}
    assert llm.invoke("research_a", "s", "u") is None
    assert set(calls.keys()) == {"ra1", "ra2"}


# ---------- rotation, retries, backoff ----------

def test_a_rate_limited_primary_rotates_to_the_secondary(calls):
    calls.script = {"ra1": llm.RateLimited(30)}
    assert llm.invoke("research_a", "s", "u").provider == "groq"
    assert calls.keys() == ["ra1", "ra2"] and max(v for k, v in llm._cooldown.items() if k.split("|")[0] == "research_a:1") > llm.time.time()  # rate limits pause key+model
    calls.log.clear()
    assert llm.invoke("research_a", "s", "u") is not None
    assert calls.keys() == ["ra2"]  # the limited key is not used again while paused


def test_both_keys_unavailable_returns_none_with_the_real_reason(calls):
    calls.script = {"rb1": llm.RateLimited(900), "rb2": llm.RateLimited(900)}
    assert llm.invoke("research_b", "s", "u") is None
    assert llm.last_outcome.get()["kind"] == "rate_limited"
    assert len(calls.log) == 2  # waits longer than 45 s are not slept through; no retry loop


def test_a_short_rate_limit_is_waited_out_once_then_succeeds(calls, monkeypatch):
    seq = {"n": 0}
    orig = calls._groq

    def flaky(provider, model, key, *a):
        seq["n"] += 1
        if seq["n"] <= 2:
            raise llm.RateLimited(5)
        return orig(provider, model, key, *a)
    monkeypatch.setattr(llm, "_openai_compatible", flaky)
    slept = []
    monkeypatch.setattr(llm.time, "sleep", lambda t: (slept.append(t), llm._cooldown.clear()))  # time passes: the pause ends
    assert llm.invoke("research_a", "s", "u") is not None
    assert slept and slept[0] >= 5


def test_an_invalid_request_does_not_rotate_keys(calls):
    calls.script = {"pb1": RuntimeError("HTTP 400: bad payload")}
    assert llm.invoke("planning_b", "s", "u") is None
    assert calls.keys() == ["pb1"] and llm.last_outcome.get()["kind"] == "invalid_request"


def test_invalid_credentials_pause_the_key_and_the_other_key_is_used(calls):
    calls.script = {"ra1": RuntimeError("HTTP 401: invalid api key")}
    assert llm.invoke("research_a", "s", "u") is not None
    assert llm._cooldown["research_a:1"] - llm.time.time() > 3000


def test_only_invalid_credentials_stop_without_a_retry_loop(calls):
    calls.script = {"ra1": RuntimeError("HTTP 401: x"), "ra2": RuntimeError("HTTP 403: x")}
    assert llm.invoke("research_a", "s", "u") is None
    assert llm.last_outcome.get()["kind"] == "auth" and len(calls.log) == 2


def test_transient_failures_back_off_and_stop_at_the_retry_limit(calls, monkeypatch):
    calls.script = {"pa1": TimeoutError("timed out"), "pa2": RuntimeError("HTTP 500: oops")}
    slept = []
    monkeypatch.setattr(llm.time, "sleep", slept.append)
    monkeypatch.setattr(llm, "settings", dataclasses.replace(llm.settings, ai_max_retries=3, ai_backoff=1.5))
    assert llm.invoke("planning_a", "s", "u") is None
    assert len(calls.log) == 3 * 2  # 3 attempts x 2 keys (1 model): bounded, never infinite
    assert slept == [1.5, 3.0, 6.0]


def test_metadata_is_recorded_without_secrets(calls):
    acc: list = []
    tok = llm.invocations.set(acc)
    try:
        calls.script = {"ra1": llm.RateLimited(30)}
        llm.invoke("research_a", "secret prompt text", "u")
    finally:
        llm.invocations.reset(tok)
    assert [r["error_category"] for r in acc] == ["rate_limited", ""] and all(set(r) == {"agent", "provider", "model", "attempt", "ok", "latency_ms", "error_category"} for r in acc)
    assert "ra1" not in str(acc) and "secret prompt" not in str(acc) and acc[0]["agent"] == "research_a"


# ---------- Arina ----------

class FakeResp:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code, self._b, self.headers, self.text = status, body or {}, headers or {}, json.dumps(body or {})

    def json(self):
        return self._b


def arina_http(monkeypatch, resp):
    seen = {}

    def post(url, content=None, headers=None, **kw):
        seen.update(url=url, headers=headers, body=json.loads(content))
        return resp
    monkeypatch.setattr(llm._http, "post", post)
    monkeypatch.setattr(llm, "arina_tokens_used", lambda: 0)
    monkeypatch.setattr(llm, "_arina_record", lambda t: None)
    return seen


OK_BODY = {"choices": [{"message": {"content": "<think>x</think>{\"a\": 1}"}, "finish_reason": "stop"}], "usage": {"total_tokens": 42}}


def test_arina_request_matches_the_gateway_contract(env, monkeypatch):
    seen = arina_http(monkeypatch, FakeResp(body=OK_BODY))
    res = llm.arina("system text", "user text", max_output_tokens=900, model="gpt-5-mini")
    b = seen["body"]
    assert seen["url"] == "https://gateway.example/api/ai" and seen["headers"]["Authorization"] == "Bearer arina-key"
    assert b["model"] == "gpt-5-mini" and b["stream"] is False and b["max_completion_tokens"] == 900 and "max_tokens" not in b
    assert b["messages"] == [{"role": "system", "content": "system text"}, {"role": "user", "content": "user text"}] and "reasoning_effort" in b
    assert res.text == '{"a": 1}' and res.tokens == 42 and res.provider == "arina"  # reasoning tags removed, usage read


def test_deepseek_models_use_max_tokens(env, monkeypatch):
    seen = arina_http(monkeypatch, FakeResp(body=OK_BODY))
    llm.arina("s", "u", max_output_tokens=500, model="deepseek-v4-pro")
    assert seen["body"]["max_tokens"] == 500 and "max_completion_tokens" not in seen["body"] and "reasoning_effort" not in seen["body"]


def test_arina_errors_are_structured_and_never_show_the_key(env, monkeypatch):
    arina_http(monkeypatch, FakeResp(status=401, body={"error": f"invalid key {SECRET}"}))
    monkeypatch.setattr(llm, "settings", dataclasses.replace(llm.settings, arina_api_key=SECRET))
    with pytest.raises(llm.ArinaUnavailable) as e:
        llm.arina("s", "u")
    assert "401" in str(e.value) and SECRET not in str(e.value)
    arina_http(monkeypatch, FakeResp(status=429, headers={"retry-after": "7"}))
    with pytest.raises(llm.ArinaUnavailable, match="rate limited"):
        llm.arina("s", "u")
    arina_http(monkeypatch, FakeResp(body={"choices": [{"message": {"content": ""}, "finish_reason": "length"}]}))
    with pytest.raises(llm.ArinaUnavailable, match="empty answer"):
        llm.arina("s", "u")


def test_arina_missing_key_oversized_request_and_budget(env, monkeypatch):
    arina_http(monkeypatch, FakeResp(body=OK_BODY))
    with pytest.raises(llm.ArinaUnavailable, match="48 KB"):
        llm.arina("s", "x" * 60_000)
    monkeypatch.setattr(llm, "arina_tokens_used", lambda: 10**9)
    with pytest.raises(llm.ArinaUnavailable, match="budget"):
        llm.arina("s", "u")
    monkeypatch.setattr(llm, "settings", dataclasses.replace(llm.settings, arina_api_key=""))
    with pytest.raises(llm.ArinaUnavailable, match="not set"):
        llm.arina("s", "u")


def test_coding_and_debugging_can_use_different_arina_models(env, monkeypatch, calls):
    monkeypatch.setenv("ARINA_MODEL_CODING", "gpt-5.6-luna")
    monkeypatch.delenv("ARINA_MODEL_DEBUGGING", raising=False)
    llm.invoke("coding", "s", "u")
    llm.invoke("debugging", "s", "u")
    assert [m for _, m, _ in calls.log] == ["gpt-5.6-luna", "gpt-5-mini"]


def test_arina_failure_is_not_replaced_by_another_provider_by_default(calls):
    calls.script = {"arina": llm.ArinaUnavailable("gateway down")}
    assert llm.invoke("debugging", "s", "u") is None
    assert calls.providers() == {"arina"} and llm.last_outcome.get()["kind"] == "provider_error"


def test_arina_fallback_happens_only_when_explicitly_enabled_and_says_so(calls, monkeypatch):
    monkeypatch.setattr(llm, "settings", dataclasses.replace(llm.settings, arina_fallback_shared=True))
    calls.script = {"arina": llm.ArinaUnavailable("gateway down")}
    res = llm.invoke("debugging", "s", "u")
    assert res is not None and res.provider == "groq"  # the result names the provider that really answered


def test_a_coding_agent_with_no_arina_key_reports_not_configured(env, monkeypatch):
    monkeypatch.setattr(llm, "settings", dataclasses.replace(env, arina_api_key=""))
    assert llm.invoke("coding", "s", "u") is None and llm.last_outcome.get()["kind"] == "not_configured"


# ---------- health ----------

def test_health_never_calls_a_provider_unless_asked(calls):
    h = llm.health("none")
    assert calls.log == [] and all(a["live_tested"] is False and a["status"] == "configured" for a in h["agents"])
    assert {a["agent"]: a["provider"] for a in h["agents"]}["planning_b"] == "gemini"


def test_live_health_reports_verified_rate_limited_and_rejected_keys_per_agent(env, monkeypatch):
    def probe(provider, key, model, level):
        return {"ra1": {"status": "authentication_failed", "latency_ms": None, "error_category": "http_401"},
                "ra2": {"status": "authentication_verified", "latency_ms": 120, "error_category": ""},
                "rb1": {"status": "rate_limited", "latency_ms": None, "error_category": "rate_limited"}}.get(key, {"status": "authentication_verified", "latency_ms": 90, "error_category": ""})
    monkeypatch.setattr(llm, "_probe", probe)
    h = {a["agent"]: a for a in llm.health("auth")["agents"]}
    assert h["research_a"]["status"] == "authentication_verified" and h["research_a"]["live_tested"] and [k["status"] for k in h["research_a"]["keys"]] == ["authentication_failed", "authentication_verified"]
    assert h["research_b"]["keys"][0]["status"] == "rate_limited"
    assert h["coding"]["live_tested"] is False and "level=request" in h["coding"]["detail"]  # Arina has no free authenticated endpoint
    assert "ra1" not in json.dumps(h)


def test_live_health_results_are_cached(env, monkeypatch):
    n = {"c": 0}

    def probe(*a):
        n["c"] += 1
        return {"status": "authentication_verified", "latency_ms": 1, "error_category": ""}
    monkeypatch.setattr(llm, "_probe", probe)
    llm.health("auth")
    first = n["c"]
    llm.health("auth")
    assert n["c"] == first  # no repeated provider calls within the cache window


# ---------- call-site audit: nothing bypasses the assigned routing ----------

LAB = pathlib.Path(llm.__file__).parent
EXPECTED = {  # file -> agents its model calls must use ('shared' = a deliberate un-assigned small decision)
    "research.py": {"research_a"}, "explorer/extract.py": {"research_b"}, "explorer/synth.py": {"research_b"}, "planner.py": {"dynamic"},
    "change.py": {"change_analyzer", "coding"}, "coding.py": {"coding", "debugging", "shared"}, "healer.py": {"debugging"}, "testing.py": {"testing"},
    "gap.py": {"final_synthesis", "shared"}, "intent.py": {"shared"}, "whatif.py": {"shared"},
}


def _agents_used(path: pathlib.Path) -> set[str]:
    out = set()
    for n in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name) and n.func.value.id == "llm"):
            continue
        if n.func.attr in ("invoke", "invoke_json"):
            out.add(n.args[0].value)
        elif n.func.attr in ("chat", "chat_json"):
            kw = {k.arg: k.value for k in n.keywords}
            a = kw.get("agent")
            out.add("shared" if a is None else a.value if isinstance(a, ast.Constant) else "dynamic")
        elif n.func.attr == "arina":
            out.add("DIRECT_ARINA")
    return out


@pytest.mark.parametrize("rel", sorted(EXPECTED))
def test_every_model_call_uses_its_assigned_agent(rel):
    used = _agents_used(LAB / rel)
    assert used and used <= EXPECTED[rel], f"{rel} calls {used}, expected within {EXPECTED[rel]}"
    assert "DIRECT_ARINA" not in used


def test_no_other_module_calls_a_provider_or_the_shared_chain_directly():
    allowed = set(EXPECTED) | {"llm.py"}
    for p in LAB.rglob("*.py"):
        rel = p.relative_to(LAB).as_posix()
        text = p.read_text(encoding="utf-8")
        if rel not in allowed:
            assert "api.groq.com" not in text and "generativelanguage.googleapis.com" not in text and "llm.chat" not in text and "llm.arina" not in text, rel
