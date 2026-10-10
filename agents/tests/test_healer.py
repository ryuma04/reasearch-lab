"""Self-Healing Debugger tests. Arina, the sandbox, the database and Redis are all fakes:
these tests spend no tokens and start no containers."""
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lab import api, bus, healer, llm, memory, project  # noqa: E402
from lab.config import settings  # noqa: E402

BUGGY = 'import json\ncfg = {"learning_rate": 0.1}\nlr = cfg["lr"]\nprint("lr", lr)\njson.dump({"metrics": {"acc": 0.9}}, open("results/metrics.json", "w"))\n'
TRACE = ('Traceback (most recent call last):\n  File "/work/src/train.py", line 3, in <module>\n'
         '    lr = cfg["lr"]\nKeyError: \'lr\'\n')


def res(status, exec_id=1, **kw):
    d = dict(exec_id=exec_id, exit_code=0 if status == "succeeded" else 1, timed_out=status == "timed_out", duration_ms=100,
             log_path="l", log_hash="h", log_tail="", code_version="c", status=status)
    d.update(kw)
    return api.ExecResult(**d)


class FakeRedis:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ex=None):
        self.d[k] = v

    def incrby(self, k, n):
        self.d[k] = int(self.d.get(k, 0)) + n


class FakeDB:
    """Stores heal_sessions / repair_attempts updates the way the real tables would."""

    def __init__(self):
        self.attempts, self.session = {}, {"status": "queued"}

    @staticmethod
    def J(v):
        return v

    def scalar(self, sql, args):
        aid = len(self.attempts) + 1
        self.attempts[aid] = dict(zip(["session_id", "run_id", "attempt", "error_kind", "error_summary", "error_text"], args),
                                  status="running")
        return aid

    def ex(self, sql, args=()):
        if sql.startswith("UPDATE repair_attempts"):
            cols = re.findall(r"(\w+)=%s", sql.split("WHERE")[0])
            self.attempts[args[-1]].update(dict(zip(cols, args)))
        elif "heal_sessions SET status=%s" in sql:
            self.session.update(status=args[0], message=args[1], tokens=args[2])
        elif "heal_sessions SET status='running'" in sql:
            self.session["status"] = "running"


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "project"
    (root / "src").mkdir(parents=True)
    (root / "tests").mkdir()
    (root / "results").mkdir()
    (root / "src" / "train.py").write_text(BUGGY)
    (root / "src" / "unrelated.py").write_text("SECRET_UNRELATED = 1\n" * 50)
    (root / "tests" / "test_basic.py").write_text("def test_ok():\n    assert True\n")
    s = {"db": FakeDB(), "redis": FakeRedis(), "arina": [], "execs": [], "root": root, "answers": [], "exec_results": [],
         "test_results": [], "saved": [], "events": []}
    monkeypatch.setattr(healer, "db", s["db"])
    monkeypatch.setattr(healer, "pdir", lambda run_id: root)
    monkeypatch.setattr(project, "pdir", lambda run_id: root)
    monkeypatch.setattr(bus, "r", s["redis"])
    monkeypatch.setattr(bus, "emit", lambda *a, **k: s["events"].append(a))
    monkeypatch.setattr(memory, "find_fix", lambda text: None)
    monkeypatch.setattr(memory, "save_fix", lambda *a: s["saved"].append(a))
    monkeypatch.setattr(memory, "mark_used", lambda *a: None)

    def fake_arina(system, user, max_output_tokens=None, **_kw):
        s["arina"].append(user)
        if not s["answers"]:
            return llm.Result(text='{"cause": "no idea", "explanation": "", "edits": []}', tokens=50, provider="arina", model="m")
        return llm.Result(text=json.dumps(s["answers"].pop(0)), tokens=400, provider="arina", model="m")

    monkeypatch.setattr(llm, "arina", fake_arina)

    def fake_exec(run_id, phase, command, timeout, agent, env=None, image="python", collect_metrics=None, attempt=0,
                  required_metrics=None):
        s["execs"].append((phase, command))
        if phase == "test":
            r = s["test_results"].pop(0) if s["test_results"] else ("succeeded", 1, 0)
            status, passed, failed = r
            cases = "".join('<testcase classname="tests.test_basic" name="t%d"/>' % i for i in range(passed))
            cases += "".join('<testcase classname="tests.test_basic" name="f%d"><failure message="x"/></testcase>' % i for i in range(failed))
            (root / "results" / "heal-junit.xml").write_text(f"<testsuites><testsuite>{cases}</testsuite></testsuites>")
            return res(status, exec_id=900 + len(s["execs"]), log_tail="AssertionError: wrong shape" if failed else "")
        return s["exec_results"].pop(0) if s["exec_results"] else res("succeeded", exec_id=100 + len(s["execs"]))

    monkeypatch.setattr(api, "sandbox_exec", fake_exec)
    return s


FIX_LR = {"cause": "The config key is learning_rate, not lr.", "explanation": "Read the key that exists.",
          "edits": [{"path": "src/train.py", "old": 'lr = cfg["lr"]', "new": 'lr = cfg["learning_rate"]'}]}


def failed_run():
    return res("failed", exec_id=7, stderr_tail=TRACE, log_tail="lr starting\n" + TRACE, error="the program exited with code 1")


# ---------- detection ----------

def test_detect_failure_reads_exit_code_stderr_and_traceback():
    f = healer.detect_failure(failed_run())
    assert f.kind == "exception" and f.error_type == "KeyError" and f.frames == [("src/train.py", 3)]
    assert "KeyError: 'lr' (src/train.py line 3)" == f.summary
    assert healer.detect_failure(res("succeeded")) is None
    assert healer.detect_failure(res("timed_out", exit_code=-1)).kind == "timeout"
    assert healer.detect_failure(res("failed", exit_code=137, error="ran out of memory")).kind == "oom"
    r = res("failed", exit_code=0, metrics_status="invalid", metrics_error='metric "acc" is not a finite number')
    assert healer.detect_failure(r).kind == "results"
    sb = healer.detect_failure(res("error", exit_code=-1, error="Docker is not available"))
    assert sb.kind == "sandbox_error" and not sb.fixable
    # library frames are ignored; only the project's own files are context
    _, _, frames = healer.parse_traceback('File "/usr/lib/python3.11/json/__init__.py", line 1\nFile "/work/src/a.py", line 9\nValueError: x')
    assert frames == [("src/a.py", 9)]


def test_context_sends_only_the_failing_code(env):
    f = healer.detect_failure(failed_run())
    ctx = healer.relevant_context(env["root"], f)
    assert 'lr = cfg["lr"]' in ctx and "SECRET_UNRELATED" not in ctx
    big = "\n".join(f"x{i} = {i}" for i in range(2000))
    (env["root"] / "src" / "train.py").write_text(big)
    f.frames = [("src/train.py", 1000)]
    ctx = healer.relevant_context(env["root"], f)
    assert "x999 = 999" in ctx and "x10 = 10\n" not in ctx and len(ctx) < 3000


# ---------- successful fix ----------

def test_successful_fix_is_verified_by_a_real_rerun_and_tests(env):
    env["answers"] = [FIX_LR]
    out = healer.heal(1, 5, failed_run())
    assert out == {"status": "fixed", "attempts": 1}
    a = env["db"].attempts[1]
    assert a["status"] == "fixed" and a["fix_source"] == "arina"
    assert '-lr = cfg["lr"]' in a["diff"] and '+lr = cfg["learning_rate"]' in a["diff"]
    assert a["tests"]["passed"] == 1 and a["tests"]["failed"] == 0
    assert "KeyError" in a["error_text"] and "learning_rate, not lr" in a["explanation"]
    assert 'cfg["learning_rate"]' in (env["root"] / "src" / "train.py").read_text()
    assert [e[0] for e in env["execs"]] == ["execute", "test"]  # re-run, then the tests
    assert "--ignore=tests/test_claims.py" in env["execs"][1][1]
    assert env["db"].session["status"] == "fixed" and "Fixed on attempt 1" in env["db"].session["message"]
    assert len(env["arina"]) == 1 and env["saved"]  # one model call; the fix goes to Lab Memory


def test_deterministic_fix_spends_no_tokens(env, monkeypatch):
    trace = 'Traceback (most recent call last):\n  File "/work/src/train.py", line 1\nModuleNotFoundError: No module named \'sklearn\'\n'
    calls = []
    from lab import coding
    env_install = lambda run_id, agent, timeout=1200: calls.append("install") or res("succeeded", exec_id=50)  # noqa: E731
    monkeypatch.setattr(coding, "install", env_install)
    out = healer.heal(1, 5, res("failed", stderr_tail=trace, log_tail=trace))
    assert out["status"] == "fixed" and env["arina"] == [] and calls == ["install"]
    assert env["db"].attempts[1]["fix_source"] == "pattern"
    assert "+scikit-learn" in env["db"].attempts[1]["diff"]
    assert coding  # imported module patched above


# ---------- failed fixes and the retry limit ----------

def test_stops_after_three_attempts_and_shows_the_remaining_error(env):
    env["answers"] = [FIX_LR,
                      {"cause": "c2", "explanation": "", "edits": [{"path": "src/train.py", "old": 'print("lr", lr)', "new": 'print("lr:", lr)'}]},
                      {"cause": "c3", "explanation": "", "edits": [{"path": "src/train.py", "old": "import json", "new": "import json  # noqa"}]},
                      {"cause": "c4", "explanation": "", "edits": [{"path": "src/train.py", "old": "import json", "new": "import json, os"}]}]
    still = lambda n: res("failed", exec_id=200 + n, stderr_tail=f'Traceback (most recent call last):\n  File "/work/src/train.py", line 4\nValueError: bad shape {n}\n')  # noqa: E731
    env["exec_results"] = [still(1), still(2), still(3)]
    out = healer.heal(1, 5, failed_run())
    assert out == {"status": "failed", "attempts": 3}
    assert [a["status"] for a in env["db"].attempts.values()] == ["still_failing"] * 3
    assert len(env["arina"]) == 3 and len([e for e in env["execs"] if e[0] == "execute"]) == 3
    msg = env["db"].session["message"]
    assert env["db"].session["status"] == "failed" and "Not fixed after 3 attempts" in msg and "ValueError: bad shape 3" in msg
    assert env["saved"] == []  # nothing is learned from a fix that did not work


def test_no_fix_stops_without_claiming_success(env):
    env["answers"] = []  # the model has no safe edit
    out = healer.heal(1, 5, failed_run())
    assert out["status"] == "failed" and env["db"].attempts[1]["status"] == "no_fix"
    assert env["execs"] == [] and "Remaining error: KeyError" in env["db"].session["message"]


def test_edits_that_do_not_match_the_file_are_rejected(env):
    env["answers"] = [{"cause": "x", "explanation": "", "edits": [
        {"path": "src/train.py", "old": "does not exist", "new": "y"},
        {"path": "../outside.py", "old": "a", "new": "b"},
        {"path": "results/metrics.json", "old": "{", "new": '{"acc": 1}'}]}]
    out = healer.heal(1, 5, failed_run())
    assert out["status"] == "failed" and env["execs"] == []
    assert (env["root"] / "src" / "train.py").read_text() == BUGGY


def test_failing_tests_count_as_not_fixed(env):
    env["answers"] = [FIX_LR, {"cause": "c", "explanation": "", "edits": [{"path": "src/train.py", "old": 'print("lr", lr)', "new": 'print("lr =", lr)'}]}]
    env["test_results"] = [("failed", 0, 1), ("succeeded", 1, 0)]
    out = healer.heal(1, 5, failed_run())
    assert out == {"status": "fixed", "attempts": 2}
    assert env["db"].attempts[1]["status"] == "tests_failed" and env["db"].attempts[2]["status"] == "fixed"


# ---------- sandbox errors ----------

def test_sandbox_error_is_not_sent_to_arina(env):
    out = healer.heal(1, 5, res("error", exit_code=-1, error="Docker is not available, so the code was not run."))
    assert out["status"] == "error" and env["arina"] == [] and env["db"].attempts == {}
    assert "Not a code problem" in env["db"].session["message"]


def test_sandbox_error_during_rerun_stops_the_session(env):
    env["answers"] = [FIX_LR]
    env["exec_results"] = [res("error", exit_code=-1, error="Docker is not available")]
    out = healer.heal(1, 5, failed_run())
    assert out["status"] == "error" and env["db"].attempts[1]["status"] == "sandbox_error"
    assert len(env["arina"]) == 1 and env["db"].session["status"] == "error"


# ---------- token budget ----------

def test_same_error_on_same_code_is_never_sent_twice(env):
    healer.heal(1, 5, failed_run())          # model: no fix (cached as "none")
    healer.heal(1, 6, failed_run())          # same code, same error: answered from the cache
    assert len(env["arina"]) == 1
    env["answers"] = [FIX_LR]
    (env["root"] / "src" / "train.py").write_text(BUGGY + "# edited\n")  # code changed: may ask again
    healer.heal(1, 7, failed_run())
    assert len(env["arina"]) == 2


def test_arina_request_format_and_budget(monkeypatch):
    saved = {k: getattr(settings, k) for k in ("arina_api_key", "arina_model", "arina_max_output_tokens", "arina_token_budget", "arina_reasoning_effort", "arina_base_url")}
    try:
        _arina_checks(monkeypatch)
    finally:
        for k, v in saved.items():
            object.__setattr__(settings, k, v)


def _arina_checks(monkeypatch):
    sent = {}

    class Resp:
        status_code = 200
        headers = {}
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}], "usage": {"total_tokens": 120}}

    def post(url, content, headers):
        sent.update(url=url, body=json.loads(content), headers=headers)
        return Resp()

    r = FakeRedis()
    monkeypatch.setattr(bus, "r", r)
    monkeypatch.setattr(llm._http, "post", post)
    for k, v in dict(arina_api_key="k", arina_model="gpt-5-mini", arina_max_output_tokens=2500, arina_token_budget=800_000,
                     arina_reasoning_effort="low", arina_base_url="https://elevate1-0.vercel.app/api/ai").items():
        object.__setattr__(settings, k, v)
    out = llm.arina("sys", "user", max_output_tokens=99999)
    assert out.json() == {"ok": True} and out.provider == "arina"
    assert sent["url"] == "https://elevate1-0.vercel.app/api/ai" and sent["headers"]["Authorization"] == "Bearer k"
    b = sent["body"]
    assert b["model"] == "gpt-5-mini" and b["stream"] is False and b["max_completion_tokens"] == 2500  # capped
    assert "temperature" not in b and "max_tokens" not in b
    assert llm.arina_tokens_used() == 120
    object.__setattr__(settings, "arina_model", "deepseek-v4-pro")
    llm.arina("s", "u")
    assert sent["body"]["max_tokens"] == 2500 and "max_completion_tokens" not in sent["body"]
    with pytest.raises(llm.ArinaUnavailable, match="48 KB"):
        llm.arina("s", "x" * 60_000)
    r.d[llm.ARINA_USED_KEY] = 799_000
    sent.clear()
    with pytest.raises(llm.ArinaUnavailable, match="budget"):
        llm.arina("s", "u")
    assert sent == {}  # refused before any request was sent
    object.__setattr__(settings, "arina_model", "gpt-5-mini")
