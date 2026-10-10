"""Coding Agent / Debugger <-> sandbox integration (no database, Redis, Docker or network needed:
the Go sandbox API is replaced by fakes that return what it would return)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lab import api, bus, coding, project  # noqa: E402


def result(status="succeeded", exec_id=1, metrics=None, **kw) -> api.ExecResult:
    base = dict(exec_id=exec_id, exit_code=0 if status == "succeeded" else 1, timed_out=status == "timed_out",
                duration_ms=1200, log_path=f"logs/execute-{exec_id}.log", log_hash="sha256:x", log_tail="",
                code_version="abc", metrics=metrics if metrics is not None else [], status=status)
    base.update(kw)
    return api.ExecResult(**base)


@pytest.fixture
def loop(monkeypatch):
    """Fakes around repair_and_run: records executions and Debugger calls."""
    state = {"runs": [], "fixes": [], "events": [], "results": []}
    monkeypatch.setattr(bus, "emit", lambda run_id, agent, typ, msg, why="", links=None: state["events"].append((typ, msg, links)))
    monkeypatch.setattr(bus, "check_control", lambda run_id: None)
    monkeypatch.setattr(coding, "ensure_installed", lambda run_id, help_instruction="": (True, ""))
    monkeypatch.setattr(coding, "required_metrics", lambda run_id: ["test_errors"])

    def fake_execute(run_id, timeout, env=None, attempt=0, required=None):
        state["runs"].append({"attempt": attempt, "required": required})
        return state["results"].pop(0) if state["results"] else result("failed", exec_id=attempt,
                                                                           log_tail="Traceback...\nValueError: boom",
                                                                           error="the program exited with code 1")

    def fake_fix(run_id, slug, log_tail, attempt, help_instruction):
        state["fixes"].append({"attempt": attempt, "error": log_tail})
        return True

    monkeypatch.setattr(coding, "execute", fake_execute)
    monkeypatch.setattr(coding, "_fix", fake_fix)
    return state


def test_debugger_stops_after_three_repairs_by_default(loop):
    res, msg = coding.repair_and_run(1, 60)
    assert res is None
    assert len(loop["runs"]) == 4 and len(loop["fixes"]) == 3  # first run + 3 automatic repairs
    assert [r["attempt"] for r in loop["runs"]] == [1, 2, 3, 4]
    assert "after 4 run(s) (3 automatic repairs allowed)" in msg
    for n in (1, 2, 3, 4):
        assert f"attempt {n} (execution #{n}): failed" in msg
    assert "Code sandbox" in msg and "ValueError: boom" in msg  # actionable, with the real error
    assert sum(1 for e in loop["events"] if e[0] == "attempt_result") == 4


def test_retry_limit_is_configurable(loop):
    res, msg = coding.repair_and_run(1, 60, max_repairs=1)
    assert res is None and len(loop["runs"]) == 2 and len(loop["fixes"]) == 1


def test_debugger_receives_the_real_error_and_rerun_succeeds(loop):
    loop["results"] = [
        result("failed", exec_id=11, log_tail='File "/work/src/train.py", line 3\nKeyError: \'lr\'',
               error="the program exited with code 1"),
        result("failed", exec_id=12, exit_code=0, log_tail="done", metrics_status="invalid",
               error="results rejected: metric \"acc\" is not a finite number",
               metrics_error='metric "acc" is not a finite number'),
        result("succeeded", exec_id=13, metrics=[{"id": 5, "name": "test_errors", "value": 81}]),
    ]
    res, msg = coding.repair_and_run(1, 60)
    assert res is not None and res.exec_id == 13 and msg == ""
    assert "KeyError: 'lr'" in loop["fixes"][0]["error"]
    assert "not a finite number" in loop["fixes"][1]["error"]
    assert all(r["required"] == ["test_errors"] for r in loop["runs"])


def test_cancelled_run_is_not_repaired(loop):
    loop["results"] = [result("cancelled", cancelled=True, exit_code=-1, error="cancelled by the researcher")]
    res, msg = coding.repair_and_run(1, 60)
    assert res is None and loop["fixes"] == [] and "cancelled" in msg


def test_docker_unavailable_is_not_treated_as_a_code_bug(loop):
    loop["results"] = [result("error", exit_code=-1, error="Docker is not available, so the code was not run.")]
    res, msg = coding.repair_and_run(1, 60)
    assert res is None and loop["fixes"] == [] and "Docker is not available" in msg


def test_error_report_contains_sandbox_verdict_and_output():
    r = result("failed", log_tail="Traceback\nZeroDivisionError", error="the program exited with code 1",
               metrics_error="")
    assert "[sandbox] the program exited with code 1" in r.error_report() and "ZeroDivisionError" in r.error_report()
    assert not r.ok and result("succeeded").ok
    assert not result("failed", exit_code=0).ok  # exit 0 with rejected results is not success


def test_sandbox_exec_sends_attempt_and_required_metrics(monkeypatch):
    sent = {}

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"exec_id": 9, "exit_code": 0, "timed_out": False, "duration_ms": 10, "log_path": "l", "log_hash": "h",
                    "status": "succeeded", "attempt": 2, "metrics": [], "metrics_status": "valid", "artifacts": [
                        {"path": "models/m.pt", "kind": "model", "verified": True}]}

    monkeypatch.setattr(api._client, "post", lambda url, json: sent.update(url=url, body=json) or Resp())
    r = api.sandbox_exec(3, "execute", "python src/train.py", 60, "coding.writer", attempt=2, required_metrics=["a", ""])
    assert sent["url"] == "/internal/sandbox/exec"
    assert sent["body"]["attempt"] == 2 and sent["body"]["required_metrics"] == ["a"]
    assert set(sent["body"]) <= {"run_id", "phase", "command", "timeout_sec", "agent", "env", "image", "attempt",
                                 "required_metrics", "collect_metrics"}  # no mounts, network or limits
    assert r.ok and r.attempt == 2 and r.artifacts[0]["verified"] is True


# ---------- the agents cannot write outside the editable project files ----------

def test_safe_rel():
    for good in ["src/train.py", "configs/config.yaml", "tests/test_x.py", "requirements.txt"]:
        assert project.safe_rel(good, editable_only=True) == good
    for bad in ["../x.py", "/etc/passwd", "C:/Windows/x", "src/../../x", "src/.env", "results/metrics.json",
                "logs/x.log", "models/m.pt", ".gitignore", "src/a\x00.py", ""]:
        assert project.safe_rel(bad, editable_only=True) is None, bad
    assert project.safe_rel("research/brief.md") == "research/brief.md"


def test_apply_ops_refuses_unsafe_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(project, "pdir", lambda run_id: tmp_path)
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "train.py").write_text("lr = 1\n")
    outside = tmp_path.parent / f"outside-{tmp_path.name}.txt"
    done, _ = project.apply_ops(1, [
        {"op": "write", "path": str(outside), "content": "pwned"},
        {"op": "write", "path": "../escape.py", "content": "pwned"},
        {"op": "write", "path": "results/metrics.json", "content": '{"metrics": {"acc": 0.99}}'},
        {"op": "replace", "path": "/etc/hosts", "old": "a", "new": "b"},
        {"op": "replace", "path": "src/train.py", "old": "lr = 1", "new": "lr = 0.1"},
    ])
    assert done == ["edited src/train.py"]
    assert not outside.exists() and not (tmp_path.parent / "escape.py").exists()
    assert not (tmp_path / "results" / "metrics.json").exists()  # the Debugger can never fabricate results
    assert (tmp_path / "src" / "train.py").read_text() == "lr = 0.1\n"


def test_write_files_does_not_follow_symlinks(tmp_path):
    target = tmp_path / "host_file.txt"
    target.write_text("original")
    proj = tmp_path / "project"
    (proj / "src").mkdir(parents=True)
    try:
        os.symlink(target, proj / "src" / "train.py")
    except OSError:
        pytest.skip("symlinks not available")
    assert project.write_files(proj, {"src/train.py": "overwrite"}, editable_only=True) == []
    assert target.read_text() == "original"
