"""The test stage decides from real results: a debugger that claims success never overrides failing tests."""
from lab import coding, testing


def case(name, status, file="tests/test_correctness.py"):
    return {"name": name, "file": file, "status": status}


def summary(cases, **kw):
    s = {"cases": cases, "total": len(cases), "passed": sum(c["status"] == "passed" for c in cases),
         "failed": sum(c["status"] == "failed" for c in cases), "skipped": sum(c["status"] == "skipped" for c in cases),
         "exec_status": "failed" if any(c["status"] == "failed" for c in cases) else "succeeded", "log_tail": "AssertionError"}
    s.update(kw)
    return s


def test_all_passing_is_success():
    v = testing.assess(summary([case("a", "passed"), case("claim", "passed", "tests/test_claims.py")]))
    assert v["status"] == "success" and v["warnings"] == []


def test_correctness_failure_is_a_failed_verdict():
    v = testing.assess(summary([case("shape", "failed"), case("a", "passed")]))
    assert v["status"] == "failed" and v["correctness_failed"] == ["shape"]


def test_claim_failure_is_a_warning_not_a_code_failure():
    v = testing.assess(summary([case("a", "passed"), case("claim", "failed", "tests/test_claims.py")]))
    assert v["status"] == "success_with_warnings" and v["claims_failed"] == ["claim"] and v["correctness_failed"] == []


def test_skipped_tests_are_never_counted_as_passed():
    v = testing.assess(summary([case("a", "passed"), case("b", "skipped")]))
    assert v["status"] == "success_with_warnings" and "skipped" in v["warnings"][0]


def test_no_results_means_blocked_not_success():
    v = testing.assess(summary([], exec_status="succeeded"))
    assert v["status"] == "blocked" and "no test was verified" in v["reason"]


def test_sandbox_error_and_timeout_are_blocked():
    assert testing.assess(summary([case("a", "passed")], exec_status="error", error="Docker is not running"))["status"] == "blocked"
    assert testing.assess(summary([case("a", "passed")], exec_status="timed_out"))["status"] == "blocked"


def _wire(monkeypatch, runs, fixes, install_ok=True):
    """runs: successive test summaries; fixes: successive results of the debugger (True = a fix was applied)."""
    calls = {"tests": 0, "fix": 0}
    it, fx = iter(runs), iter(fixes)

    def fake_run(_rid):
        calls["tests"] += 1
        return next(it)

    def fake_fix(*_a, **_k):
        calls["fix"] += 1
        return next(fx)

    monkeypatch.setattr(testing, "run_tests", fake_run)
    monkeypatch.setattr(coding, "_fix", fake_fix)
    monkeypatch.setattr(coding, "ensure_installed", lambda *_a, **_k: (install_ok, "install failed"))
    monkeypatch.setattr(testing.bus, "emit", lambda *a, **k: None)
    return calls


def test_a_fix_only_counts_after_a_passing_rerun(monkeypatch):
    calls = _wire(monkeypatch, [summary([case("shape", "failed")]), summary([case("shape", "passed")])], [True])
    v = testing.run_and_repair(1, max_repairs=2)
    assert v["status"] == "success" and calls == {"tests": 2, "fix": 1}


def test_debugger_claiming_a_fix_does_not_hide_a_persisting_failure_and_retries_are_bounded(monkeypatch):
    bad = summary([case("shape", "failed")])
    calls = _wire(monkeypatch, [bad, bad, bad], [True, True, True])
    v = testing.run_and_repair(1, max_repairs=2)
    assert v["status"] == "failed" and "still failing" in v["reason"]
    assert calls == {"tests": 3, "fix": 2}  # initial run + 2 repairs, then it stops
    assert [h["status"] for h in v["history"]] == ["failed", "failed", "failed"]


def test_no_fix_found_leaves_the_failure_in_place(monkeypatch):
    calls = _wire(monkeypatch, [summary([case("shape", "failed")])], [False])
    v = testing.run_and_repair(1, max_repairs=3)
    assert v["status"] == "failed" and calls["tests"] == 1


def test_failed_reinstall_after_a_fix_is_blocked(monkeypatch):
    _wire(monkeypatch, [summary([case("shape", "failed")])], [True], install_ok=False)
    v = testing.run_and_repair(1, max_repairs=2)
    assert v["status"] == "blocked" and "Re-installing" in v["reason"]


def test_blocked_tests_are_not_sent_to_the_debugger(monkeypatch):
    calls = _wire(monkeypatch, [summary([], exec_status="error", error="Docker is not running")], [])
    v = testing.run_and_repair(1, max_repairs=2)
    assert v["status"] == "blocked" and calls == {"tests": 1, "fix": 0}
