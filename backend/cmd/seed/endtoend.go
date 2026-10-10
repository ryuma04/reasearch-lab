package main

// Sample workspace 3: a complete start-to-finish run where everything goes right — the code is
// generated (the project's real distillation recipe files are copied in), the tests are written
// and all pass, and every claim matches. The numbers are still illustrative sample data.
func (s *seeder) endToEnd() {
	junit := `<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="10" time="8.412">
<testcase classname="tests.test_correctness" name="test_softened_probabilities_sum_to_one[1]" time="0.011"/>
<testcase classname="tests.test_correctness" name="test_softened_probabilities_sum_to_one[5]" time="0.004"/>
<testcase classname="tests.test_correctness" name="test_softened_probabilities_sum_to_one[20]" time="0.004"/>
<testcase classname="tests.test_correctness" name="test_higher_temperature_is_softer" time="0.006"/>
<testcase classname="tests.test_correctness" name="test_soft_loss_is_zero_when_student_matches_teacher" time="0.005"/>
<testcase classname="tests.test_correctness" name="test_parameter_counts_match_paper_architecture" time="0.031"/>
<testcase classname="tests.test_correctness" name="test_train_and_test_data_do_not_overlap" time="7.902"/>
<testcase classname="tests.test_claims" name="test_claim[teacher_test_errors]" time="0.002"/>
<testcase classname="tests.test_claims" name="test_claim[student_baseline_test_errors]" time="0.002"/>
<testcase classname="tests.test_claims" name="test_claim[student_distilled_test_errors]" time="0.002"/>
</testsuite></testsuites>
`
	claimsTest := `"""Claim tests written by the Test Designer: each result vs the paper, with a tolerance."""
import json, pathlib, pytest

METRICS = json.loads(pathlib.Path("results/metrics.json").read_text())
CLAIMS = [  # (metric, paper value, relative tolerance) — from the Claims List, page 4
    ("teacher_test_errors", 67, 0.10),
    ("student_baseline_test_errors", 146, 0.10),
    ("student_distilled_test_errors", 74, 0.10),
]

@pytest.mark.parametrize("name,paper,tol", CLAIMS, ids=[c[0] for c in CLAIMS])
def test_claim(name, paper, tol):
    assert METRICS[name] <= paper * (1 + tol)
`
	s.workspace(sample{
		title:      "Sample — End-to-end run: Distillation, all claims reproduced",
		arxiv:      "1503.02531",
		paperTitle: "Distilling the Knowledge in a Neural Network",
		summary:    "A small network trained on the softened outputs (T=20) of a large network nearly matches it on MNIST.",
		budget:     "standard",
		recipeDir:  "agents/lab/recipes/distillation_files",
		extraFiles: map[string]string{
			"tests/test_claims.py": claimsTest,
			"results/junit.xml":    junit,
			"configs/config.yaml": "# Every setting with its source (paper / assumption / compute change). SAMPLE DATA.\n" +
				"distill:\n  temperature: 20        # paper, p.4\n  alpha: 0.9             # assumption\n" +
				"model:\n  teacher_hidden: 1200   # paper, p.4\n  student_hidden: 800    # paper, p.4\n" +
				"train:\n  epochs_teacher: 30     # compute change (paper: long training)\n  epochs_student: 30     # compute change\n  lr: 0.05               # assumption\n" +
				"data:\n  train_subset: 60000    # paper\n  jitter_pixels: 2       # paper\n",
			"requirements.txt": "torch==2.3.1\ntorchvision==0.18.1\nnumpy<2\npytest==8.4.2\npyyaml==6.0.2\n",
		},
		claims: []claim{
			{"teacher_test_errors", "Big net (2x1200 ReLU, dropout, jittered input)", "Section 3 (MNIST)", "achieved 67 test errors", 67, 69, 4, "match", "Within the tolerance of the paper's number."},
			{"student_baseline_test_errors", "Small net (2x800 ReLU) trained alone", "Section 3 (MNIST)", "146 test errors", 146, 149, 4, "match", "Within the tolerance of the paper's number."},
			{"student_distilled_test_errors", "Small net distilled from the big net (T=20)", "Section 3 (MNIST)", "only 74 test errors", 74, 76, 4, "match", "Within the tolerance of the paper's number."},
		},
		gapClaim: -1, // nothing differs, so the Gap Detective has nothing to explain
		settings: [][5]string{
			{"distill.temperature", "20", "paper", "Stated on page 4", "20"},
			{"model.teacher_hidden", "1200", "paper", "Page 4", "1200"},
			{"model.student_hidden", "800", "paper", "Page 4", "800"},
			{"data.train_subset", "60000", "paper", "Full MNIST training set", "60000"},
			{"data.jitter_pixels", "2", "paper", "Jitter as in the paper", "2"},
			{"train.epochs_student", "30", "compute_change", "Standard budget; the paper trained longer", "not stated (long training)"},
			{"distill.alpha", "0.9", "assumption", "Common soft/hard weighting", ""},
			{"train.lr", "0.05", "assumption", "Common SGD default", ""},
		},
		events: []event{
			{"system", "run_queued", "Run queued with the standard budget (SAMPLE DATA)", "End-to-end sample: every stage succeeds", nil, 0, 0},
			{"system", "stage", "Stage: research", "", map[string]any{"stage": "research"}, 0, 0},
			{"research.paper_reader", "agent_started", "Getting arXiv:1503.02531 (LaTeX source and PDF)", "LaTeX source avoids OCR mistakes in numbers", nil, 0, 0},
			{"research.paper_reader", "claims_found", "Claims List: 3 claims, all on page 4", "Every claim keeps its page and the exact quote", nil, 2210, 0},
			{"research.source_finder", "agent_finished", "Sources: no official code; MNIST via torchvision (licence OK, 11 MB)", "", nil, 640, 0},
			{"research.paper_reader", "brief_ready", "Research Brief ready", "", nil, 0, 0},
			{"system", "stage", "Stage: plan approval", "", map[string]any{"stage": "plan_approval"}, 0, 0},
			{"system", "checkpoint_waiting", "Checkpoint 1: review the Research Map and plan", "The researcher stays in control of important steps", map[string]any{"checkpoint": "plan"}, 0, 0},
			{"researcher", "checkpoint_resolved", "Researcher approved the plan checkpoint", "Decision made via web", map[string]any{"checkpoint": "plan", "action": "approve"}, 0, 0},
			{"system", "stage", "Stage: coding", "", map[string]any{"stage": "coding"}, 0, 0},
			{"coding.writer", "agent_started", "Writing the project: data, models, distillation loss, training, config", "", nil, 0, 0},
			{"coding.writer", "files_written", "Wrote src/train.py, src/models.py, src/distill.py, src/download_data.py, configs/config.yaml, requirements.txt", "Every script writes results/metrics.json", nil, 4210, 0},
			{"coding.reviewer", "review", "Review passed: temperature 20 and layer sizes match the Research Brief", "Checked before running", nil, 980, 0},
			{"sandbox", "sandbox_finished", "Sandbox install ok in 48.2s", "Internet on only for the install step", nil, 0, 48.2},
			{"coding.writer", "budget_estimate", "Test drive: about 9 minutes for the full run (fits the standard budget)", "40 training steps measured on this laptop", nil, 0, 21},
			{"sandbox", "sandbox_finished", "Sandbox execute ok in 538.0s; recorded 3 metrics from metrics.json", "Offline, with CPU, memory and time limits", nil, 0, 538},
			{"system", "stage", "Stage: testing", "", map[string]any{"stage": "testing"}, 0, 0},
			{"testing.designer", "tests_written", "Wrote 7 correctness tests and 3 claim tests", "", nil, 1730, 0},
			{"testing.runner", "tests_finished", "Tests: 10 passed, 0 failed, 0 skipped", "All correctness and claim tests pass", nil, 0, 8.4},
			{"testing.runner", "claim_scored", "Big net: paper 67, ours 69 -> MATCH", "", nil, 0, 0},
			{"testing.runner", "claim_scored", "Small net alone: paper 146, ours 149 -> MATCH", "", nil, 0, 0},
			{"testing.runner", "claim_scored", "Distilled small net: paper 74, ours 76 -> MATCH", "", nil, 0, 0},
			{"system", "run_completed", "Run complete: 3 of 3 claims reproduced (SAMPLE DATA)", "Approve the push to GitHub when you are happy", nil, 0, 0},
		},
		brief: "# Research Brief — Distilling the Knowledge in a Neural Network\n\n> SAMPLE DATA: an end-to-end walkthrough where every stage succeeds.\n\n" +
			"**Claims (page 4, MNIST):** big net 67 test errors · small net alone 146 · distilled small net 74.\n\n" +
			"**Plan:** full MNIST, the paper's architecture and temperature, 30 epochs on the standard budget.\n\n" +
			"**Result:** all three claims within the 10% tolerance; 10/10 tests pass.\n",
		train:        "", // replaced by the real recipe's src/train.py
		whatifQ:      "What if we use Fashion-MNIST instead of MNIST?",
		branchMetric: "student_distilled_test_errors",
		branches:     [][3]any{{"dataset = fashion-mnist", 812.0, "done"}},
		memory: [][2]string{
			{"experiment", "Distillation on MNIST, standard budget: 3 of 3 claims within tolerance"},
		},
	})
}
