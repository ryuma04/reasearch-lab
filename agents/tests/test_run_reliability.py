"""Graph setup runs once even when several workers start together, and a finished run's status is never reopened by gap or what-if work."""
import pathlib
import re
import threading
import time

from lab import graph

LAB = pathlib.Path(graph.__file__).parent


def test_the_graph_and_its_checkpoint_tables_are_set_up_exactly_once_under_concurrency(monkeypatch):
    calls = {"pool": 0, "setup": 0, "build": 0, "executed": []}
    active = {"n": 0, "max": 0}

    class Cur:
        def fetchone(self):
            return {"got": True}

    class Conn:
        def execute(self, sql, params=None):
            calls["executed"].append(sql.split("(")[0].strip())
            return Cur()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class Pool:
        def __init__(self, *a, **k):
            calls["pool"] += 1

        def connection(self):
            return Conn()

    class Saver:
        def __init__(self, pool):
            pass

        def setup(self):
            calls["setup"] += 1
            active["n"] += 1
            active["max"] = max(active["max"], active["n"])
            time.sleep(0.05)  # a slow migration: a second concurrent setup would overlap here
            active["n"] -= 1

    monkeypatch.setattr(graph, "_graph", None)
    monkeypatch.setattr(graph, "ConnectionPool", Pool)
    monkeypatch.setattr(graph, "PostgresSaver", Saver)
    monkeypatch.setattr(graph, "build", lambda saver: calls.__setitem__("build", calls["build"] + 1) or object())
    monkeypatch.setattr(graph, "_unpooled", lambda url: url)
    results = []
    threads = [threading.Thread(target=lambda: results.append(graph.get_graph())) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert calls["pool"] == calls["setup"] == calls["build"] == 1 and active["max"] == 1
    assert len({id(r) for r in results}) == 1  # every thread got the same graph
    ex = calls["executed"]
    assert ex.index("SELECT pg_try_advisory_lock") < ex.index("CREATE SCHEMA IF NOT EXISTS langgraph") < ex.index("SELECT pg_advisory_unlock")


def test_the_setup_lock_is_released_even_when_setup_fails(monkeypatch):
    executed = []

    class Cur:
        def fetchone(self):
            return {"got": True}

    class Conn:
        def execute(self, sql, params=None):
            executed.append(sql.split("(")[0].strip())
            return Cur()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class Pool:
        def __init__(self, *a, **k):
            pass

        def connection(self):
            return Conn()

    class Saver:
        def __init__(self, pool):
            pass

        def setup(self):
            raise RuntimeError("migration failed")

    monkeypatch.setattr(graph, "_graph", None)
    monkeypatch.setattr(graph, "ConnectionPool", Pool)
    monkeypatch.setattr(graph, "PostgresSaver", Saver)
    monkeypatch.setattr(graph, "_unpooled", lambda url: url)
    try:
        graph.get_graph()
        raise AssertionError("should have raised")
    except RuntimeError:
        pass
    assert executed[-1] == "SELECT pg_advisory_unlock" and graph._graph is None  # a later call tries again


def test_gap_and_whatif_only_finish_their_own_child_runs():
    for name in ("gap.py", "whatif.py"):
        text = (LAB / name).read_text(encoding="utf-8")
        assert "UPDATE runs" not in text, f"{name} must not write run status directly"
        for m in re.finditer(r"finish_run\(([^,]+),", text):
            assert m.group(1).strip() in ("child", 'r["child"]'), f"{name} finishes {m.group(1)}, which is not a child run"


def test_the_gap_detective_finishes_before_the_run_is_marked_completed():
    src = (LAB / "graph.py").read_text(encoding="utf-8")
    assert 'g.add_edge("gap", "finalize")' in src and 'g.add_conditional_edges("test", after_test, ["gap", "finalize"])' in src
    assert src.count("status='completed'") == 1 and src.index("status='completed'") > src.index("def n_finalize")  # only finalize completes a run


def test_only_a_retry_or_resume_ever_moves_a_run_back_to_running():
    writers = []
    for p in LAB.glob("*.py"):
        for m in re.finditer(r"UPDATE runs SET status='running'[^\n]*", p.read_text(encoding="utf-8")):
            writers.append((p.name, m.group(0)[:80]))
    names = {n for n, _ in writers}
    assert names <= {"graph.py", "worker.py", "bus.py"}, writers
    # graph.py: the start node; worker.py: an explicit retry; bus.py: resume after a pause (guarded by status='paused')
    assert any(n == "bus.py" and "status='paused'" in t for n, t in writers) or "bus.py" not in names


def test_a_waiting_process_polls_the_lock_instead_of_blocking_inside_a_statement(monkeypatch):
    """A blocking pg_advisory_lock deadlocks against the library's CREATE INDEX CONCURRENTLY (found in a live two-process start)."""
    answers = iter([{"got": False}, {"got": False}, {"got": True}])
    sql_seen = []

    class Cur:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return self.row

    class Conn:
        def execute(self, sql, params=None):
            sql_seen.append(sql)
            return Cur(next(answers))

    slept = []
    monkeypatch.setattr(graph.time, "sleep", slept.append)
    graph._acquire_setup_lock(Conn())
    assert len(sql_seen) == 3 and all("pg_try_advisory_lock" in q and "pg_advisory_lock(" not in q.replace("pg_try_advisory_lock(", "") for q in sql_seen)
    assert slept == [0.5, 0.5]


def test_waiting_for_the_setup_lock_gives_up_with_a_clear_error(monkeypatch):
    class Cur:
        def fetchone(self):
            return {"got": False}

    class Conn:
        def execute(self, sql, params=None):
            return Cur()

    clock = iter([0, 1, 2, 500])
    monkeypatch.setattr(graph.time, "time", lambda: next(clock))
    monkeypatch.setattr(graph.time, "sleep", lambda s: None)
    try:
        graph._acquire_setup_lock(Conn(), timeout=60)
        raise AssertionError("should have timed out")
    except RuntimeError as e:
        assert "timed out waiting" in str(e)
