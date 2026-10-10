"""Unit tests for pure logic (no database, Redis or network needed)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lab import coding, intent, llm, memory, project, whatif  # noqa: E402
from lab.recipes import distillation  # noqa: E402


def test_parse_json_variants():
    assert llm.parse_json('{"a": 1}') == {"a": 1}
    assert llm.parse_json('```json\n{"a": 2}\n```') == {"a": 2}
    assert llm.parse_json('Sure! {"a": 3} done') == {"a": 3}
    assert llm.parse_json("nothing") is None


def test_error_signature_is_stable_across_paths_and_numbers():
    a = 'File "/work/src/train.py", line 12\nModuleNotFoundError: No module named \'sklearn\''
    b = 'File "/tmp/x/run.py", line 99\nModuleNotFoundError: No module named \'sklearn\''
    assert memory.error_signature(a) == memory.error_signature(b)
    assert "sklearn" in memory.error_signature(a)


def test_hash_embedding_similarity():
    v1 = memory._hash_embed("numpy 2.0 breaks old code pin numpy")
    v2 = memory._hash_embed("pin numpy because numpy 2.0 breaks code")
    v3 = memory._hash_embed("telegram voice command approval")
    dot = lambda x, y: sum(p * q for p, q in zip(x, y))  # noqa: E731
    assert len(v1) == memory.DIM
    assert dot(v1, v2) > dot(v1, v3)


def test_heuristic_fixes():
    ops, desc = coding.heuristic_fix("ModuleNotFoundError: No module named 'sklearn'")
    assert ops == [{"op": "add_requirement", "value": "scikit-learn"}]
    ops, _ = coding.heuristic_fix("A module that was compiled using NumPy 1.x cannot be run in NumPy 2.0")
    assert ops[0]["value"] == "numpy<2"
    assert coding.heuristic_fix("ValueError: something unrelated") is None


def test_config_labels_every_setting(tmp_path):
    text = project.write_config(tmp_path, [
        {"name": "distill.temperature", "value": "20", "source": "paper", "source_ref": "p.3", "reason": "T=20"},
        {"name": "train.epochs_student", "value": "3", "source": "compute_change", "source_ref": "", "reason": "budget",
         "paper_value": "long"},
    ])
    assert "temperature: 20  # from the paper (p.3)" in text
    assert "changed to fit compute" in text and "[paper: long]" in text
    assert project._typed("0.05") == 0.05 and project._typed("mnist") == "mnist"


def test_whatif_parse_without_ai():
    names = [s["name"] for s in distillation.settings("quick")]
    b = whatif.parse("What if the temperature is 2, 5, 10 or 20?", names)
    assert [x["change"]["distill.temperature"] for x in b] == [2, 5, 10, 20]
    b = whatif.parse("What if we use Fashion-MNIST instead of MNIST?", names)
    assert b[0]["change"] == {"data.dataset": "fashion_mnist"}
    b = whatif.parse("What if the small model has only 100 hidden units?", names)
    assert b[0]["change"] == {"model.student_hidden": 100}


def test_intent_rules_without_ai():
    runs = [{"id": 7, "pending_checkpoint": "plan"}]
    assert intent.understand("How is the run going?", runs)["action"] == "status"
    i = intent.understand("Try temperature 5 as a new branch", runs)
    assert i["action"] == "whatif" and i["run_id"] == 7 and i["needs_confirm"]
    i = intent.understand("approve", runs)
    assert i["action"] == "approve" and i["checkpoint"] == "plan"


def test_recipe_settings_have_sources():
    for budget in ("quick", "standard", "deep"):
        for s in distillation.settings(budget):
            assert s["source"] in project.SOURCE_LABEL
            if s["source"] == "compute_change":
                assert s.get("paper_value")
    assert distillation.matches("", "1503.02531v1", "")
    assert set(distillation.files()) >= {"src/train.py", "src/download_data.py", "tests/test_correctness.py", "requirements.txt"}
