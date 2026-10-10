"""Versioned change requests (isolation, safe edits, honest failure) and the research-paper materials."""
import json

import pytest

from lab import change, paper

TRAIN = '"""Train the model."""\nimport json\n\nclass Net:\n    """A tiny network."""\n\ndef main():\n    json.dump({"metrics": {"acc": 0.9}}, open("results/metrics.json", "w"))\n'


@pytest.fixture
def world(monkeypatch, tmp_path):
    dirs = {1: tmp_path / "run1", 2: tmp_path / "run2"}
    (dirs[1] / "src").mkdir(parents=True)
    (dirs[1] / "src" / "train.py").write_text(TRAIN)
    (dirs[1] / "requirements.txt").write_text("numpy\n")
    (dirs[1] / "results").mkdir()
    (dirs[1] / "results" / "metrics.json").write_text("{}")
    (dirs[1] / "research").mkdir()
    (dirs[1] / "research" / "brief.json").write_text(json.dumps({"papers": [{"title": "P", "summary": "s", "claims": []}], "sources": {}}))
    events, writes = [], []
    monkeypatch.setattr(change, "pdir", lambda rid: dirs[rid])
    monkeypatch.setattr(change.bus, "emit", lambda run, agent, typ, msg, why="", links=None: events.append((typ, msg)))
    monkeypatch.setattr(change.db, "ex", lambda sql, params=(): writes.append((sql, params)))
    monkeypatch.setattr(change.db, "q", lambda *a, **k: [])
    monkeypatch.setattr(change, "load_settings", lambda rid: [])
    monkeypatch.setattr(change, "record_settings", lambda rid, items: None)
    return {"dirs": dirs, "events": events, "writes": writes}


CH = {"id": 5, "workspace_id": 1, "source_run_id": 1, "request_text": "Use a smaller learning rate and add a regression test", "analysis": {}}


def test_a_new_version_gets_its_own_copy_and_the_source_is_provably_unchanged(world, monkeypatch):
    monkeypatch.setattr(change.llm, "chat_json", lambda *a, **k: ({"intent": "lower the learning rate", "affected_modules": ["src/train.py"], "research": {}}, 10))
    before = change.tree_digest(world["dirs"][1])
    change.start_version(2, CH)
    assert (world["dirs"][2] / "src" / "train.py").read_text() == TRAIN
    assert not (world["dirs"][2] / "results").exists()  # results of the source are not carried over
    (world["dirs"][2] / "src" / "train.py").write_text("changed in version 2\n")  # writing in the copy ...
    assert change.tree_digest(world["dirs"][1]) == before  # ... never reaches the source
    assert (world["dirs"][1] / "src" / "train.py").read_text() == TRAIN
    created = [m for t, m in world["events"] if t == "version_created"]
    assert created and "own copy" in created[0]
    saved = next(p for s, p in world["writes"] if "UPDATE change_requests SET analysis" in s)[0].obj
    assert saved["isolation"]["source_unchanged"] is True and saved["source"] == "ai"


def test_without_an_ai_the_analysis_says_so_instead_of_pretending(world, monkeypatch):
    monkeypatch.setattr(change.llm, "chat_json", lambda *a, **k: (None, 0))
    change.start_version(2, CH)
    saved = next(p for s, p in world["writes"] if "UPDATE change_requests SET analysis" in s)[0].obj
    assert saved["source"] == "fallback" and "No AI provider answered" in saved["assumptions"][0]


def test_ambiguity_is_surfaced_as_an_event(world, monkeypatch):
    monkeypatch.setattr(change.llm, "chat_json", lambda *a, **k: ({"intent": "?", "ambiguity": "Replace or add?", "clarifying_question": "Do you want to replace the model?"}, 5))
    change.start_version(2, CH)
    assert any(t == "clarification" for t, _ in world["events"])


def test_edits_are_limited_to_allowed_paths_and_python_must_compile(tmp_path):
    ok, refused = change.validate_edits(tmp_path, [
        {"path": "src/train.py", "content": "x = 1\n"}, {"path": "../../etc/passwd", "content": "x"}, {"path": "/abs.py", "content": "x"},
        {"path": "src/broken.py", "content": "def f(:\n"}, {"path": "notes.txt", "content": "x"}, {"path": "src/x.py"}, "junk"])
    assert list(ok) == ["src/train.py"]
    assert any("does not compile" in r for r in refused) and len(refused) >= 4


def test_applying_a_change_with_no_ai_fails_honestly_and_changes_no_file(world, monkeypatch):
    monkeypatch.setattr(change, "for_run", lambda rid: CH)
    shutil_copy(world)
    monkeypatch.setattr(change.llm, "arina", lambda *a, **k: (_ for _ in ()).throw(change.llm.ArinaUnavailable("no key")))
    monkeypatch.setattr(change.llm, "available", lambda: False)
    with pytest.raises(change.ChangeFailed, match="No code was changed|no code was changed"):
        change.apply_changes(2)
    assert (world["dirs"][2] / "src" / "train.py").read_text() == TRAIN


def shutil_copy(world):
    import shutil
    shutil.copytree(world["dirs"][1], world["dirs"][2], dirs_exist_ok=True)


def test_a_valid_ai_change_is_written_only_to_the_new_version(world, monkeypatch):
    monkeypatch.setattr(change, "for_run", lambda rid: CH)
    shutil_copy(world)
    new = TRAIN.replace("0.9", "0.95")

    class R:
        def json(self):
            return {"summary": "raise acc", "edits": [{"path": "src/train.py", "content": new}]}
    monkeypatch.setattr(change.llm, "arina", lambda *a, **k: R())
    assert change.apply_changes(2) == ["src/train.py"]
    assert "0.95" in (world["dirs"][2] / "src" / "train.py").read_text()
    assert "0.95" not in (world["dirs"][1] / "src" / "train.py").read_text()  # the original version is untouched


# ---------- paper materials ----------

def data(root, **kw):
    base = {"run": {"id": 2, "status": "completed", "error": "", "compute_budget": "quick", "workspace_id": 1, "parent_run_id": 1}, "root": root,
            "ws": {"note": ""}, "brief": {"papers": [{"title": "Distilling", "arxiv_id": "1503.02531", "summary": "A small net copies a big one.", "method": ["train teacher", "distil"],
                                                      "claims": [{"description": "student errors", "value": 74, "unit": "errors", "page": 4}]}],
                                          "sources": {"related_papers": [{"title": "Follow-up", "year": 2019, "arxiv": "1902.00001", "citations": 3}], "datasets": [], "repositories": []}},
            "review": {}, "events": [], "settings": [{"name": "train.lr", "value": "0.05", "source": "assumption", "reason": "common default"}], "metrics": [], "score": [],
            "gaps": [], "explorer": {}, "change": {"source_run_id": 1, "request_text": "smaller lr"}}
    base.update(kw)
    return base


def test_code_facts_come_from_the_parsed_source(world):
    f = paper.code_facts(world["dirs"][1])
    assert f[0]["file"] == "src/train.py" and {i["name"] for i in f[0]["items"]} == {"Net", "main"}
    assert f[0]["doc"] == "Train the model."


def test_metrics_missing_means_not_measured_and_the_package_is_partial(world):
    text, miss = paper.results(data(world["dirs"][1]))
    assert "no metric was recorded" in text and "measured metrics" in miss and "Not measured" in text


def test_recorded_metrics_scorecard_and_tests_are_reported_exactly(world):
    d = data(world["dirs"][1], metrics=[{"name": "student_errors", "value": 81.0, "code_version": "abc123", "log_file": "logs/e1.log", "log_line": 21, "exec_id": 9}],
             score=[{"description": "student errors", "paper": 74.0, "ours": 81.0, "unit": "errors", "page": 4, "status": "close"}],
             events=[{"time": None, "agent": "testing.runner", "type": "tests_finished", "message": "x", "links": {"summary": {"passed": 8, "failed": 3, "skipped": 0}}},
                     {"time": None, "agent": "testing.runner", "type": "test_verdict", "message": "x", "links": {"verdict": "success_with_warnings"}}])
    text, miss = paper.results(d)
    assert "| student_errors | 81 | abc123 | logs/e1.log:21 |" in text and "| student errors | 74 | 81 | close |" in text
    assert "8 passed, 3 failed, 0 skipped" in text and "success_with_warnings" in text and miss == []


def test_overview_never_invents_a_summary_gaps_or_related_work(world):
    d = data(world["dirs"][1], brief={"papers": [{"title": "P", "claims": []}], "sources": {}}, change=None)
    text, miss = paper.overview(d)
    assert "paper summary" in miss and "related work" in miss and "research gaps (Gap Explorer not run)" in miss
    assert "Original version." in text


def test_references_list_only_recorded_sources(world):
    text, _ = paper.references(data(world["dirs"][1]))
    assert "Follow-up (2019), https://arxiv.org/abs/1902.00001" in text and "https://arxiv.org/abs/1503.02531" in text


def test_the_overview_marks_the_version_and_its_change_request(world):
    text, _ = paper.overview(data(world["dirs"][1]))
    assert "run #2" in text and "smaller lr" in text and "created from run #1" in text.lower().replace("created from", "created from")


def test_algorithms_state_what_is_not_implemented(world):
    text, _ = paper.algorithms(data(world["dirs"][1]))
    assert "No meta-controller" in text and "`Net`" in text.replace("src/train.py` `Net`", "`Net`")
