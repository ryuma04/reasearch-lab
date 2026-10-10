"""Plan validation, the optimizer's failure handling, and per-agent key-pool routing."""
import copy

import pytest

from lab import llm, planner

BRIEF = {"papers": [{"title": "P", "summary": "s", "claims": [{"description": "small net", "value": 74, "unit": "errors"}],
                     "method": [], "settings": [], "missing_details": []}], "sources": {"recommendation": ""}}


def good_plan():
    reqs = planner.requirements_from(BRIEF)
    return planner.template_plan(BRIEF, reqs), [r["id"] for r in reqs]


def test_template_plan_validates_and_covers_every_requirement():
    plan, rids = good_plan()
    assert planner.validate(plan, rids)["ok"]
    assert any(t["kind"] == "test" for t in plan["tasks"])


def test_validator_rejects_cycles_unknown_deps_missing_tests_and_uncovered_requirements():
    plan, rids = good_plan()
    cyc = copy.deepcopy(plan)
    cyc["tasks"][0]["depends_on"] = ["T3"]
    assert "cycle" in " ".join(planner.validate(cyc, rids)["errors"])
    unk = copy.deepcopy(plan)
    unk["tasks"][1]["depends_on"] = ["T99"]
    assert "unknown task" in " ".join(planner.validate(unk, rids)["errors"])
    notest = copy.deepcopy(plan)
    for t in notest["tasks"]:
        t["kind"] = "code"
    assert "no test task" in " ".join(planner.validate(notest, rids)["errors"])
    assert "not covered" in " ".join(planner.validate(plan, rids + ["R99"])["errors"])
    nofields = copy.deepcopy(plan)
    nofields["tasks"][0]["validation"] = ""
    assert not planner.validate(nofields, rids)["ok"]


def test_diff_is_computed_from_the_two_plans():
    plan, _ = good_plan()
    opt = copy.deepcopy(plan)
    opt["tasks"].append({**plan["tasks"][-1], "id": "T6", "title": "Add regression tests", "kind": "test", "depends_on": ["T5"]})
    opt["tasks"][2]["validation"] = "A stricter check"
    opt["risks"] = plan["risks"] + ["Dataset download may be blocked"]
    d = planner.diff(plan, opt)
    assert d["added"] == ["T6: Add regression tests"] and d["tests_added"] == ["T6: Add regression tests"]
    assert d["risks_added"] == ["Dataset download may be blocked"] and any("T3" in c for c in d["changed"])


@pytest.fixture
def quiet(monkeypatch, tmp_path):
    monkeypatch.setattr(planner.bus, "emit", lambda *a, **k: None)
    monkeypatch.setattr(planner, "pdir", lambda rid: tmp_path)
    monkeypatch.setattr(planner.db, "ex", lambda *a, **k: None)


def test_optimizer_failure_keeps_the_initial_plan_and_says_so(monkeypatch, quiet):
    monkeypatch.setattr(planner, "_ask", lambda agent, *a: (None, {}))
    review = planner.build_plans(1, BRIEF)
    assert review["ready"] == "initial" and review["optimized"]["plan"] is None and "initial plan is kept" in review["optimized"]["failure"]


def test_an_optimizer_that_copies_the_plan_is_not_accepted_as_an_improvement(monkeypatch, quiet):
    def ask(agent, system, user):
        plan, _ = good_plan()
        return (plan, {}) if agent == "planning_b" else (None, {})
    monkeypatch.setattr(planner, "_ask", ask)
    review = planner.build_plans(1, BRIEF)
    assert review["optimized"]["plan"] is None and "no meaningful change" in review["optimized"]["failure"]


def test_a_real_improvement_is_kept_beside_the_original(monkeypatch, quiet):
    plan, _ = good_plan()
    better = copy.deepcopy(plan)
    better["tasks"].append({**plan["tasks"][-1], "id": "T6", "title": "Regression tests", "kind": "test", "depends_on": ["T5"]})
    better["weaknesses"] = [{"issue": "no regression tests", "fix": "added T6"}]
    monkeypatch.setattr(planner, "_ask", lambda agent, *a: (copy.deepcopy(better), {"provider": "gemini"}) if agent == "planning_b" else (None, {}))
    review = planner.build_plans(1, BRIEF)
    assert review["ready"] == "optimized" and review["initial"]["plan"]["tasks"][-1]["id"] == "T5"
    assert review["optimized"]["diff"]["added"] and review["optimized"]["weaknesses"]


def test_an_invalid_optimized_plan_is_rejected(monkeypatch, quiet):
    plan, _ = good_plan()
    bad = copy.deepcopy(plan)
    bad["tasks"][0]["depends_on"] = ["T4"]  # cycle
    monkeypatch.setattr(planner, "_ask", lambda agent, *a: (bad, {}) if agent == "planning_b" else (None, {}))
    review = planner.build_plans(1, BRIEF)
    assert review["ready"] == "initial" and "failed validation" in review["optimized"]["failure"]


# ---------- key pools ----------

def test_each_agent_only_sees_its_own_pair_of_keys(monkeypatch):
    for k, v in {"GROQ_RESEARCH_A_KEY_1": "a1", "GROQ_RESEARCH_A_KEY_2": "a2", "GROQ_RESEARCH_B_KEY_1": "b1", "GROQ_RESEARCH_B_KEY_2": "b2",
                 "GEMINI_PLANNING_A_KEY_1": "pa1", "GEMINI_PLANNING_A_KEY_2": "pa2", "GEMINI_PLANNING_B_KEY_1": "pb1", "GEMINI_PLANNING_B_KEY_2": "pb2"}.items():
        monkeypatch.setenv(k, v)
    assert llm.pool_keys("research_a") == ("groq", ["a1", "a2"])
    assert llm.pool_keys("research_b") == ("groq", ["b1", "b2"])
    assert llm.pool_keys("planning_a") == ("gemini", ["pa1", "pa2"])
    assert llm.pool_keys("planning_b") == ("gemini", ["pb1", "pb2"])
    assert {k for _, _, k, _ in llm._agent_chain("planning_a", "planner")} == {"pa1", "pa2"}
    assert {k for _, _, k, _ in llm._agent_chain("research_b", "long")} == {"b1", "b2"}
    assert llm.pool_keys("unknown_agent") is None


def test_an_unconfigured_pool_falls_back_to_the_shared_keys(monkeypatch):
    for k in ("GEMINI_PLANNING_A_KEY_1", "GEMINI_PLANNING_A_KEY_2"):
        monkeypatch.delenv(k, raising=False)
    assert llm._agent_chain("planning_a", "planner") is None


def _pool_env(monkeypatch):
    monkeypatch.setenv("GROQ_RESEARCH_A_KEY_1", "k1")
    monkeypatch.setenv("GROQ_RESEARCH_A_KEY_2", "k2")
    monkeypatch.setattr(llm.api, "rate_acquire", lambda *a, **k: {"allowed": True})
    llm._cooldown.clear()


def test_rate_limit_rotates_to_the_other_key_of_the_same_pool(monkeypatch):
    _pool_env(monkeypatch)
    used = []

    def fake(provider, model, key, *a):
        used.append(key)
        if key == "k1":
            raise llm.RateLimited(30)
        return llm.Result("ok", 5, provider, model)
    monkeypatch.setattr(llm, "_openai_compatible", fake)
    res = llm.chat("writer", "s", "u", agent="research_a")
    assert res and used == ["k1", "k2"] and llm._cooldown["research_a:1"] > 0


def test_auth_error_pauses_the_key_and_uses_the_other_one(monkeypatch):
    _pool_env(monkeypatch)

    def fake(provider, model, key, *a):
        if key == "k1":
            raise RuntimeError("HTTP 401: invalid api key")
        return llm.Result("ok", 1, provider, model)
    monkeypatch.setattr(llm, "_openai_compatible", fake)
    assert llm.chat("writer", "s", "u", agent="research_a").text == "ok"
    assert llm._cooldown["research_a:1"] - llm.time.time() > 3000


def test_an_invalid_request_does_not_burn_the_other_key(monkeypatch):
    _pool_env(monkeypatch)
    used = []

    def fake(provider, model, key, *a):
        used.append(key)
        raise RuntimeError("HTTP 400: bad request")
    monkeypatch.setattr(llm, "_openai_compatible", fake)
    assert llm.chat("writer", "s", "u", agent="research_a") is None and used == ["k1"]


def test_both_keys_unavailable_is_an_explicit_none_and_records_safe_metadata(monkeypatch):
    _pool_env(monkeypatch)
    monkeypatch.setattr(llm, "_openai_compatible", lambda *a: (_ for _ in ()).throw(llm.RateLimited(60)))
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    acc: list = []
    tok = llm.invocations.set(acc)
    try:
        assert llm.chat("writer", "s", "u", agent="research_a") is None
    finally:
        llm.invocations.reset(tok)
    assert acc and all(set(r) == {"agent", "provider", "model", "attempt", "ok", "latency_ms", "error_category"} for r in acc)
    assert "k1" not in str(acc) and acc[0]["agent"] == "research_a"
