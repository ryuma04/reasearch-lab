package main

// Sample workspace 1: the main demo paper (Hinton, Vinyals & Dean 2015). Paper numbers are the
// paper's MNIST results; "ours" numbers are illustrative placeholders, labelled as sample data.
func (s *seeder) distillation() {
	s.workspace(sample{
		title:      "Sample — Distilling the Knowledge in a Neural Network",
		arxiv:      "1503.02531",
		paperTitle: "Distilling the Knowledge in a Neural Network",
		summary:    "A small network trained to match a large network's softened outputs (temperature T) learns almost as well as the large network.",
		budget:     "quick",
		sources:    []string{"MNIST (torchvision)", "Related: Born-Again Networks (2018)"},
		codeFiles:  []string{"src/train.py", "src/models.py", "src/distill.py", "src/download_data.py", "configs/config.yaml"},
		claims: []claim{
			{"teacher_test_errors", "Big net (2x1200 ReLU, dropout, jittered input)", "Section 3 (MNIST)", "achieved 67 test errors", 67, 72, 4, "match", "Within the tolerance of the paper's number."},
			{"student_baseline_test_errors", "Small net (2x800 ReLU) trained alone", "Section 3 (MNIST)", "146 test errors", 146, 151, 4, "match", "Within the tolerance of the paper's number."},
			{"student_distilled_test_errors", "Small net distilled from the big net (T=20)", "Section 3 (MNIST)", "only 74 test errors", 74, 81, 4, "different", "Large difference; the Gap Detective tested why."},
		},
		settings: [][5]string{
			{"distill.temperature", "20", "paper", "Stated on page 4", "20"},
			{"model.student_hidden", "800", "paper", "2 hidden layers of 800 units (page 4)", "800"},
			{"model.teacher_hidden", "1200", "paper", "2 hidden layers of 1200 units (page 4)", "1200"},
			{"train.epochs_student", "8", "compute_change", "Fits the 5-minute quick budget on a laptop CPU", "not stated (long training)"},
			{"data.train_subset", "20000", "compute_change", "Balanced subset to fit the quick budget", "60000"},
			{"data.jitter_pixels", "0", "compute_change", "Jitter doubles training time", "2"},
			{"distill.alpha", "0.9", "assumption", "Common weighting of soft vs hard targets; the paper does not give one value", ""},
			{"train.lr", "0.05", "assumption", "Common SGD default for small MLPs", ""},
		},
		events: []event{
			{"system", "run_queued", "Run queued with the quick budget (SAMPLE DATA)", "This workspace shows illustrative data for a walkthrough", nil, 0, 0},
			{"system", "stage", "Stage: research", "", map[string]any{"stage": "research"}, 0, 0},
			{"research.paper_reader", "agent_started", "Reading arXiv:1503.02531 from its LaTeX source", "LaTeX source avoids OCR mistakes in numbers", nil, 0, 0},
			{"research.paper_reader", "claims_found", "Claims List: 3 claims on page 4", "Every claim keeps its page and quote", nil, 2140, 0},
			{"research.source_finder", "agent_finished", "No official code; MNIST via torchvision", "Licence and size checked for each source", nil, 610, 0},
			{"system", "stage", "Stage: plan approval", "", map[string]any{"stage": "plan_approval"}, 0, 0},
			{"system", "checkpoint_waiting", "Checkpoint 1: review the plan", "The researcher stays in control of important steps", map[string]any{"checkpoint": "plan"}, 0, 0},
			{"researcher", "checkpoint_resolved", "Researcher approved the plan checkpoint", "Decision made via web", map[string]any{"checkpoint": "plan", "action": "approve"}, 0, 0},
			{"system", "stage", "Stage: coding", "", map[string]any{"stage": "coding"}, 0, 0},
			{"coding.writer", "agent_finished", "Code Writer finished: 6 files, config with 15 labelled settings", "", nil, 3890, 0},
			{"coding.reviewer", "error_seen", "ImportError: numpy 2.0 is not compatible with this code", "Read from the sandbox log", nil, 0, 12.4},
			{"coding.reviewer", "fix_applied", "Fixed from memory: pin numpy<2", "Same error seen in an earlier run; that fix worked", map[string]any{"memory_item": 0, "from_memory": true}, 0, 0},
			{"sandbox", "sandbox_finished", "Sandbox execute ok in 412.0s; recorded 3 metrics from metrics.json", "", nil, 0, 412},
			{"system", "stage", "Stage: testing", "", map[string]any{"stage": "testing"}, 0, 0},
			{"testing.runner", "tests_finished", "Tests: 5 passed, 1 failed (claim test for the distilled student)", "A failing claim test means a result differs from the paper", nil, 0, 21},
			{"testing.runner", "claim_scored", "Distilled student: paper 74, ours 81 -> DIFFERENT", "", nil, 0, 0},
			{"gap_detective", "gap_explained", "Most of the gap comes from training 8 epochs instead of the paper's long training", "Tested with one-change experiments", nil, 520, 190},
			{"system", "run_completed", "Run complete: 2 of 3 claims matched (SAMPLE DATA)", "Approve the push to GitHub when you are happy", nil, 0, 0},
		},
		brief: "# Research Brief — Distilling the Knowledge in a Neural Network\n\n> SAMPLE DATA for a walkthrough.\n\n" +
			"**What the paper does:** trains a small network on the softened outputs (temperature 20) of a large network.\n\n" +
			"**Claims (page 4, MNIST):** big net 67 test errors · small net alone 146 · small net distilled 74.\n\n" +
			"**Missing details:** number of epochs, the soft/hard target weighting.\n\n" +
			"**Sources:** no official code; MNIST through torchvision.\n\n" +
			"**Recommendation:** clean re-implementation; reduce epochs and data to fit a laptop CPU, then let the Gap Detective test those changes.\n",
		train:    "# SAMPLE FILE — placeholder for the generated training script.\n# A real run writes the full project here and results/metrics.json from the sandbox.\n",
		gapClaim: 2,
		gap: map[string]any{
			"differences": []map[string]any{
				{"setting": "train.epochs_student", "label": "Train longer (8 -> 30 epochs)", "ours": "8", "paper": "long training", "likely": "high"},
				{"setting": "data.jitter_pixels", "label": "Add the paper's 2-pixel jitter", "ours": "0", "paper": "2", "likely": "medium"},
				{"setting": "data.train_subset", "label": "Use all 60,000 images", "ours": "20000", "paper": "60000", "likely": "medium"},
			},
			"experiments": []map[string]any{
				{"setting": "train.epochs_student", "label": "Train longer (8 -> 30 epochs)", "value": 77},
				{"setting": "data.jitter_pixels", "label": "Add the paper's 2-pixel jitter", "value": 79},
			},
			"explanation": "SAMPLE: Our distilled model made 81 errors; the paper reports 74. Training longer reduced it to 77, adding jitter to 79. The rest is likely normal run-to-run variation.",
		},
		whatifQ:      "What if the temperature is 2, 5, 10 or 20?",
		branchMetric: "student_distilled_test_errors",
		branches:     [][3]any{{"temperature = 10", 78.0, "done"}, {"temperature = 20", 81.0, "done"}, {"temperature = 5", 88.0, "stopped_early"}, {"temperature = 2", 97.0, "stopped_early"}},
		memory: [][2]string{
			{"error_fix", "ImportError with numpy 2.0 in older code -> pin numpy<2"},
			{"setting", "Distillation on MNIST, quick budget: 8 epochs, 20k images, T=20 ran in about 7 minutes"},
		},
	})
}

// Sample workspace 2: a backup paper from the problem statement's list (PINNs, Raissi et al. 2019).
func (s *seeder) pinn() {
	s.workspace(sample{
		title:      "Sample — Physics-Informed Neural Networks (Burgers' equation)",
		arxiv:      "1711.10561",
		paperTitle: "Physics Informed Deep Learning (Part I)",
		summary:    "A neural network trained with the PDE residual as a loss term solves Burgers' equation from a few boundary points.",
		budget:     "standard",
		sources:    []string{"burgers_shock.mat (authors' GitHub)", "maziarraissi/PINNs (official code)"},
		codeFiles:  []string{"src/train.py", "src/pinn.py", "configs/config.yaml"},
		claims: []claim{
			{"burgers_rel_l2_error_x1000", "Relative L2 error on Burgers' equation (x1000)", "Table 1", "relative L2 error 6.7e-04", 0.67, 0.71, 6, "match", "Within the tolerance of the paper's number."},
			{"burgers_rel_l2_error_100pts_x1000", "Relative L2 error with 100 boundary points (x1000)", "Table 2", "100 initial and boundary points", 1.9, 2.6, 7, "different", "Large difference; the Gap Detective tested why."},
		},
		settings: [][5]string{
			{"model.layers", "9", "paper", "9 layers of 20 neurons (page 6)", "9"},
			{"model.width", "20", "paper", "Page 6", "20"},
			{"train.optimizer", "L-BFGS", "paper", "Page 6", "L-BFGS"},
			{"data.collocation_points", "5000", "compute_change", "Fewer points to fit the 15-minute budget", "10000"},
			{"train.max_iter", "3000", "compute_change", "Caps L-BFGS iterations for CPU", "not stated"},
			{"seed", "0", "assumption", "Fixed seed for repeatable runs", ""},
		},
		events: []event{
			{"system", "run_queued", "Run queued with the standard budget (SAMPLE DATA)", "This workspace shows illustrative data for a walkthrough", nil, 0, 0},
			{"system", "stage", "Stage: research", "", map[string]any{"stage": "research"}, 0, 0},
			{"research.paper_reader", "claims_found", "Claims List: 2 claims (Tables 1 and 2)", "", nil, 1830, 0},
			{"system", "checkpoint_waiting", "Checkpoint 1: review the plan", "", map[string]any{"checkpoint": "plan"}, 0, 0},
			{"researcher", "checkpoint_resolved", "Researcher approved the plan checkpoint", "Decision made via web", map[string]any{"checkpoint": "plan", "action": "approve"}, 0, 0},
			{"system", "stage", "Stage: coding", "", map[string]any{"stage": "coding"}, 0, 0},
			{"coding.writer", "agent_finished", "Code Writer finished: PINN in PyTorch with an L-BFGS loop", "", nil, 4120, 0},
			{"sandbox", "sandbox_finished", "Sandbox execute ok in 655.0s; recorded 2 metrics from metrics.json", "", nil, 0, 655},
			{"system", "stage", "Stage: testing", "", map[string]any{"stage": "testing"}, 0, 0},
			{"testing.runner", "claim_scored", "100 boundary points: paper 1.9, ours 2.6 -> DIFFERENT", "", nil, 0, 0},
			{"system", "run_completed", "Run complete: 1 of 2 claims matched (SAMPLE DATA)", "", nil, 0, 0},
		},
		brief: "# Research Brief — Physics Informed Deep Learning (Part I)\n\n> SAMPLE DATA for a walkthrough.\n\n" +
			"**What the paper does:** fits u(t, x) of Burgers' equation with a network whose loss includes the PDE residual.\n\n" +
			"**Claims:** relative L2 error 6.7e-4 (Table 1); error with 100 boundary points (Table 2).\n\n" +
			"**Recommendation:** CPU-friendly; reduce collocation points for the standard budget.\n",
		train:    "# SAMPLE FILE — placeholder for the generated PINN script.\n",
		gapClaim: 1,
		gap: map[string]any{
			"differences": []map[string]any{
				{"setting": "data.collocation_points", "label": "Use 10,000 collocation points", "ours": "5000", "paper": "10000", "likely": "high"},
				{"setting": "train.max_iter", "label": "Let L-BFGS run to convergence", "ours": "3000", "paper": "not stated", "likely": "medium"},
			},
			"experiments": []map[string]any{
				{"setting": "data.collocation_points", "label": "Use 10,000 collocation points", "value": 2.1},
			},
			"explanation": "SAMPLE: With 10,000 collocation points the error fell from 2.6 to 2.1 (x1000), explaining most of the gap.",
		},
		whatifQ:      "What if we use 1,000 or 20,000 collocation points?",
		branchMetric: "burgers_rel_l2_error_x1000",
		branches:     [][3]any{{"collocation = 20000", 0.64, "done"}, {"collocation = 1000", 3.8, "stopped_early"}},
		memory: [][2]string{
			{"setting", "PINN Burgers, standard budget: 5000 collocation points, 3000 L-BFGS iterations"},
		},
	})
}
