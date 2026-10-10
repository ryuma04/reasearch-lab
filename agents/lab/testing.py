"""Testing Agent: Test Designer (3.1) and Test Runner (3.2), and the Claim Scorecard.

Scorecard numbers come only from the metrics table, which the Go API filled from
results/metrics.json written by the sandboxed code (Hero 2).
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET

from . import api, bus, db, llm, steps
from .observer import edge, node
from .project import fmt, load_settings, pdir, write_files

CLAIM_TESTS = '''"""Claim tests: compare each result with the paper, within the paper-claim tolerance."""
import json
import os

import pytest

HERE = os.path.dirname(__file__)
CLAIMS = json.load(open(os.path.join(HERE, "claims_expected.json")))
METRICS_PATH = os.path.join(HERE, "..", "results", "metrics.json")


def _metrics():
    if not os.path.exists(METRICS_PATH):
        pytest.skip("results/metrics.json not produced yet")
    m = json.load(open(METRICS_PATH))
    return m["metrics"] if isinstance(m.get("metrics"), dict) else m  # structured or legacy flat form


@pytest.mark.parametrize("claim", CLAIMS, ids=[c["metric_name"] for c in CLAIMS])
def test_claim(claim):
    m = _metrics()
    assert claim["metric_name"] in m, f"code did not report {claim['metric_name']}"
    ours, paper, tol = float(m[claim["metric_name"]]), float(claim["value"]), float(claim["tolerance"])
    if claim["higher_is_better"]:
        assert ours >= paper * (1 - tol), f"ours {ours} vs paper {paper} (tolerance {tol:.0%})"
    else:
        assert ours <= paper * (1 + tol), f"ours {ours} vs paper {paper} (tolerance {tol:.0%})"
'''

SMOKE_TEST = '''"""Generic correctness tests: the run wrote finite numbers for every expected metric."""
import json
import math
import os

HERE = os.path.dirname(__file__)


def test_metrics_are_finite_numbers():
    m = json.load(open(os.path.join(HERE, "..", "results", "metrics.json")))
    m = m["metrics"] if isinstance(m.get("metrics"), dict) else m
    assert m, "metrics.json is empty"
    for k, v in m.items():
        if isinstance(v, (int, float)):
            assert math.isfinite(v), k
'''


def claims_for_run(run_id: int) -> list[dict]:
    return db.q("""SELECT c.* FROM claims c JOIN papers p ON p.id=c.paper_id
                   JOIN runs r ON r.workspace_id=p.workspace_id WHERE r.id=%s ORDER BY c.id""", (run_id,))


def design_tests(run_id: int) -> list[str]:
    root = pdir(run_id)
    slug = "testing.designer"
    with steps.step(run_id, slug, "Writing correctness tests and one claim test per paper claim",
                   "Claim tests compare our numbers with the paper's, with a tolerance") as t:
        claims = claims_for_run(run_id)
        expected = [{"metric_name": c["metric_name"], "value": c["value"], "tolerance": c["tolerance"],
                     "higher_is_better": c["higher_is_better"], "description": c["description"]} for c in claims]
        files = {"tests/claims_expected.json": json.dumps(expected, indent=2), "tests/test_claims.py": CLAIM_TESTS}
        if not (root / "tests" / "test_correctness.py").exists():
            generated = None
            if llm.agent_available("testing"):
                code = "\n".join(p.read_text(encoding="utf-8")[:6000] for p in (root / "src").glob("*.py"))
                res = llm.chat("planner", steps.instructions(slug) + " Write pytest correctness tests (no training, fast, "
                               "CPU) for this code. Import modules from src via sys.path. Output only Python code.",
                               code, max_tokens=3000, agent="testing")
                if res and "def test_" in res.text:
                    generated = res.text.replace("```python", "").replace("```", "").strip() + "\n"
            files["tests/test_correctness.py"] = generated or SMOKE_TEST
        written = write_files(root, files)
        tests = sorted(p.relative_to(root).as_posix() for p in (root / "tests").glob("test_*.py"))
        t.notes = f"{len(expected)} claim tests, files: {', '.join(tests)}"
        nodes = [node(f"test:{tf}", "test", tf, "waiting") for tf in tests]
        edges_ = [edge(f"claim:{c['id']}", "test:tests/test_claims.py", "tested by") for c in claims]
        bus.emit(run_id, slug, "tests_written", f"Wrote {len(tests)} test files ({len(expected)} claim tests)", "",
                 {"files": written, "map_nodes": nodes, "map_edges": edges_})
    return tests


def run_tests(run_id: int) -> dict:
    slug = "testing.runner"
    root = pdir(run_id)
    with steps.step(run_id, slug, "Running all tests in the sandbox (offline)", "") as t:
        res = api.sandbox_exec(run_id, "test",
                               "PYTHONPATH=src python -m pytest -q tests -p no:cacheprovider --junitxml=results/junit.xml",
                               600, slug, collect_metrics=False)
        t.sandbox_seconds += res.seconds
        summary = _junit(root / "results" / "junit.xml")
        summary.update(exit_code=res.exit_code, exec_status=res.status or ("succeeded" if res.ok else "failed"),
                       error=res.error, log_tail=res.error_report() or res.log_tail)
        t.notes = f"{summary['passed']} passed, {summary['failed']} failed, {summary['skipped']} skipped"
        nodes = [node(f"test:{f}", "test", f, "problem" if any(c["file"] == f and c["status"] == "failed" for c in summary["cases"])
                      else "done") for f in {c["file"] for c in summary["cases"]}]
        bus.emit(run_id, slug, "tests_finished",
                 f"Tests: {summary['passed']} passed, {summary['failed']} failed, {summary['skipped']} skipped",
                 "Claim tests failing means a result differs from the paper, not that the code is broken",
                 {"summary": {k: v for k, v in summary.items() if k != "cases"}, "exec_id": res.exec_id,
                  "map_nodes": nodes})
        summary["exec_id"] = res.exec_id
    return summary


def is_claim_case(case: dict) -> bool:
    return (case.get("file") or "").endswith("test_claims.py")


def assess(summary: dict) -> dict:
    """Verdict from execution evidence only: {status, reason, correctness_failed, claims_failed, warnings}.

    success | success_with_warnings | failed (a required correctness test failed: a code problem) |
    blocked (the tests could not run, so nothing is verified). A claim test failing means a result differs
    from the paper, which the scorecard and Gap Detective explain; it is not a code failure.
    """
    failed = [c for c in summary.get("cases", []) if c["status"] == "failed"]
    correctness = [c["name"] for c in failed if not is_claim_case(c)]
    claims = [c["name"] for c in failed if is_claim_case(c)]
    base = {"correctness_failed": correctness, "claims_failed": claims, "warnings": []}
    if summary.get("exec_status") == "error":
        return {**base, "status": "blocked", "reason": f"The sandbox could not run the tests: {summary.get('error') or 'unknown error'}"}
    if summary.get("exec_status") in ("timed_out", "cancelled"):
        return {**base, "status": "blocked", "reason": f"The test run {summary['exec_status'].replace('_', ' ')} before finishing"}
    if not summary.get("total"):
        return {**base, "status": "blocked",
                "reason": "pytest produced no results (results/junit.xml is missing or empty), so no test was verified"}
    if correctness:
        return {**base, "status": "failed", "reason": f"{len(correctness)} required correctness test(s) failed: " + ", ".join(correctness[:5])}
    warnings = []
    if summary.get("skipped"):
        warnings.append(f"{summary['skipped']} test(s) were skipped, not passed")
    if claims:
        warnings.append(f"{len(claims)} claim test(s) failed: our results differ from the paper")
    return {**base, "status": "success_with_warnings" if warnings else "success", "reason": "", "warnings": warnings}


def run_and_repair(run_id: int, max_repairs: int | None = None) -> dict:
    """Run the tests; when a correctness test fails, send the real pytest output to the Debugger, re-install if
    needed and re-run the tests. Bounded by MAX_REPAIR_ATTEMPTS. The outcome comes only from the re-run results."""
    from . import coding
    from .config import settings as cfg
    limit = cfg.max_repair_attempts if max_repairs is None else max_repairs
    history: list[dict] = []
    summary: dict = {}
    verdict: dict = {}
    for attempt in range(limit + 1):
        summary = run_tests(run_id)
        verdict = assess(summary)
        history.append({"attempt": attempt, "status": verdict["status"], "failed": verdict["correctness_failed"]})
        if verdict["status"] != "failed" or attempt == limit:
            break
        if attempt > 0 and set(history[-1]["failed"]) == set(history[-2]["failed"]):
            bus.emit(run_id, "testing.runner", "debug_ineffective",
                     "The last fix did not change which correctness tests fail",
                     "A fix is not accepted without a passing re-run")
        if not coding._fix(run_id, "coding.reviewer", summary.get("log_tail") or verdict["reason"], attempt + 1, ""):
            break  # the Debugger found nothing: the failure stays a failure
        ok, tail = coding.ensure_installed(run_id)
        if not ok:
            verdict = {**verdict, "status": "blocked", "reason": "Re-installing after the fix failed: " + tail[-300:]}
            break
    if verdict["status"] == "failed":
        verdict["reason"] += f" (still failing after {len(history)} test run(s); {limit} repair attempt(s) allowed)"
    verdict["history"] = history
    verdict["summary"] = {k: v for k, v in summary.items() if k not in ("cases", "log_tail")}
    return verdict


def _junit(path) -> dict:
    out = {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "cases": []}
    if not path.exists():
        return out
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return out
    for tc in root.iter("testcase"):
        status = "passed"
        if tc.find("failure") is not None or tc.find("error") is not None:
            status = "failed"
        elif tc.find("skipped") is not None:
            status = "skipped"
        f = (tc.get("classname") or "").replace(".", "/")
        out["cases"].append({"name": tc.get("name"), "file": f"{f}.py" if f else "", "status": status})
        out["total"] += 1
        out[status] += 1
    return out


def compute_scorecard(run_id: int) -> list[dict]:
    """Match / Close / Different for every claim, using only database numbers."""
    slug = "testing.runner"
    compute_changes = [s for s in load_settings(run_id) if s["source"] in ("compute_change", "researcher")]
    rows = []
    with steps.step(run_id, slug, "Filling the Claim Scorecard: our numbers vs the paper's", "") as t:
        for c in claims_for_run(run_id):
            m = db.q1("SELECT * FROM metrics WHERE run_id=%s AND name=%s ORDER BY id DESC LIMIT 1", (run_id, c["metric_name"]))
            if not m:
                status, diff, rel, expl = "missing", None, None, "The code did not report this metric."
            else:
                diff = m["value"] - c["value"]
                rel = abs(diff) / abs(c["value"]) if c["value"] else abs(diff)
                worse = diff < 0 if c["higher_is_better"] else diff > 0
                tol = float(c["tolerance"])
                if rel <= tol or not worse:
                    status = "match"
                    expl = "Within the tolerance of the paper's number." if worse else "As good as or better than the paper."
                elif rel <= 2.5 * tol and compute_changes:
                    status = "close"
                    expl = "Small difference with a known reason: " + "; ".join(
                        f"{s['name']}: {s['reason']}" for s in compute_changes[:2])
                else:
                    status = "different"
                    expl = "Large difference; the Gap Detective will test why."
            db.ex("""INSERT INTO scorecard_entries (run_id, claim_id, metric_id, difference, relative_difference, status, explanation)
                     VALUES (%s,%s,%s,%s,%s,%s,%s)
                     ON CONFLICT (run_id, claim_id) DO UPDATE SET metric_id=EXCLUDED.metric_id, difference=EXCLUDED.difference,
                        relative_difference=EXCLUDED.relative_difference, status=EXCLUDED.status, explanation=EXCLUDED.explanation""",
                  (run_id, c["id"], m["id"] if m else None, diff, rel, status, expl))
            rows.append({"claim": c, "metric": m, "status": status, "difference": diff})
            colour = {"match": "done", "close": "done", "different": "problem", "missing": "problem"}[status]
            bus.emit(run_id, slug, "claim_scored",
                     f"{c['description']}: paper {fmt(c['value'])}, ours {fmt(m['value']) if m else 'n/a'} -> {status.upper()}",
                     expl, {"claim_id": c["id"], "metric_id": m["id"] if m else None, "status": status,
                            "map_nodes": [node(f"claim:{c['id']}", "claim", None, colour, result=status)],
                            "map_edges": [edge("result:metrics", f"claim:{c['id']}", status)] if m else []})
        n_match = sum(r["status"] == "match" for r in rows)
        t.notes = f"{n_match} of {len(rows)} claims matched"
    return rows
