/**
 * DEMO SAMPLE DATA — development only (NEXT_PUBLIC_USE_MOCKS=true).
 * These are illustrative values for UI development. They are NOT results of any real run
 * and are always displayed under a "Demo data" banner.
 */
import type * as T from "../types";

export const DEMO_USER: T.User = {
  id: "u_demo",
  name: "Demo Researcher",
  email: "demo@example.com",
  github_username: "demo-researcher",
  avatar_url: null,
  created_at: "2026-10-01T09:00:00Z",
};

export const DEMO_REPOS: T.GithubRepo[] = [
  { id: 1, name: "distillation-repro", full_name: "demo-researcher/distillation-repro", private: false, html_url: "https://github.com/demo-researcher/distillation-repro", description: "Demo repository", default_branch: "main", updated_at: "2026-10-09T12:00:00Z", can_push: true },
  { id: 2, name: "lab-notes", full_name: "demo-researcher/lab-notes", private: true, html_url: "https://github.com/demo-researcher/lab-notes", description: null, default_branch: "main", updated_at: "2026-10-02T12:00:00Z", can_push: true },
];

export const DEMO_AGENTS: T.Agent[] = [
  { id: "a_manager", name: "Team Manager", kind: "core", stage: "active", current_version_id: "v_m3", avg_score: 0.78, task_count: 41, event_key: "manager",
    current_version: { id: "v_m3", agent_id: "a_manager", instructions: "Plan skills, assign agents, score outcomes.", tools: ["registry", "memory.search"], model: "groq/gpt-oss-120b", skill_tags: ["planning", "assignment"], created_reason: "Initial version" } },
  { id: "a_research", name: "Research Agent", kind: "core", stage: "active", current_version_id: "v_r2", avg_score: 0.82, task_count: 18, event_key: "research",
    current_version: { id: "v_r2", agent_id: "a_research", instructions: "Read the paper, extract claims with page refs, find sources.", tools: ["docling", "arxiv", "semantic_scholar", "hf_hub"], model: "gemini-flash", skill_tags: ["paper reading", "claims extraction", "source finding"], created_reason: "Added arXiv LaTeX source reading" } },
  { id: "a_coding", name: "Coding Agent", kind: "core", stage: "active", current_version_id: "v_c4", avg_score: 0.71, task_count: 26, event_key: "coding",
    current_version: { id: "v_c4", agent_id: "a_coding", instructions: "Write, run and repair code in the sandbox; write metrics.json.", tools: ["sandbox.exec", "memory.search"], model: "groq/gpt-oss-120b", skill_tags: ["pytorch training", "debugging"], created_reason: "Refined after repeated dependency failures" } },
  { id: "a_testing", name: "Testing Agent", kind: "core", stage: "active", current_version_id: "v_t2", avg_score: 0.76, task_count: 17, event_key: "testing",
    current_version: { id: "v_t2", agent_id: "a_testing", instructions: "Design correctness and claim tests; fill the Claim Scorecard.", tools: ["sandbox.exec", "pytest"], model: "groq/qwen3-32b", skill_tags: ["test design", "claim checking"], created_reason: "Initial version" } },
  { id: "a_observer", name: "Observer", kind: "core", stage: "active", current_version_id: "v_o1", avg_score: null, task_count: 12, event_key: "observer",
    current_version: { id: "v_o1", agent_id: "a_observer", instructions: "Turn events into the research map.", tools: ["map"], model: "groq/llama-3.1-8b-instant", skill_tags: ["visualisation"], created_reason: "Initial version" } },
  { id: "a_subset", name: "Dataset Subset Planner", kind: "specialist", stage: "trial", current_version_id: "v_s1", avg_score: 0.64, task_count: 2, event_key: "dataset_subset_planner",
    current_version: { id: "v_s1", agent_id: "a_subset", instructions: "Pick a balanced subset that fits the compute budget; record it as an assumption.", tools: ["sandbox.exec"], model: "groq/llama-3.3-70b", skill_tags: ["data budgeting"], created_reason: "Full MNIST training exceeds the Quick budget on this laptop" } },
  { id: "a_hps1", name: "Hyperparameter Scout v1", kind: "specialist", stage: "retired", current_version_id: "v_h1", avg_score: 0.31, task_count: 4, event_key: "hyperparameter_scout_v1",
    current_version: { id: "v_h1", agent_id: "a_hps1", instructions: "Grid-search unstated settings.", tools: ["sandbox.exec"], model: "groq/gpt-oss-120b", skill_tags: ["hyperparameter search"], created_reason: "Paper omits learning-rate schedule" } },
  { id: "a_hps2", name: "Hyperparameter Scout v2", kind: "specialist", stage: "active", current_version_id: "v_h2", avg_score: 0.69, task_count: 5, event_key: "hyperparameter_scout_v2",
    current_version: { id: "v_h2", agent_id: "a_hps2", instructions: "Successive-halving search on unstated settings.", tools: ["sandbox.exec"], model: "groq/llama-3.3-70b", skill_tags: ["hyperparameter search"], created_reason: "Replaces v1 with cheaper successive halving" } },
];

export const DEMO_DECISIONS: T.TeamDecision[] = [
  { id: "d1", run_id: "r_demo1", decision: "create", agent_ids: ["a_subset"], reason: "Created 'Dataset Subset Planner' because the full dataset needs ~3 hours on this laptop and no current agent handles data budgeting.", created_at: "2026-10-09T10:01:10Z" },
  { id: "d2", run_id: "r_demo1", decision: "assign", agent_ids: ["a_coding"], reason: "Assigned Coding Agent v4 to 'pytorch training' (best past score for this skill).", created_at: "2026-10-09T10:01:12Z" },
  { id: "d3", run_id: "r_demo0", decision: "replace", agent_ids: ["a_hps1", "a_hps2"], reason: "Hyperparameter Scout v2 does the same skill with similar results at a third of the compute.", created_at: "2026-10-05T16:20:00Z" },
  { id: "d4", run_id: "r_demo0", decision: "retire", agent_ids: ["a_hps1"], reason: "Retired 'Hyperparameter Scout v1': average score 0.31 over 4 tasks after refinement.", created_at: "2026-10-05T16:21:00Z" },
];

export const DEMO_MEMORY: T.MemoryItem[] = [
  { id: "m_17", kind: "error_fix", text: "numpy 2.0 breaks legacy torchvision MNIST loader → pin numpy<2", details: { error: "AttributeError: module 'numpy' has no attribute 'float'", fix: "numpy<2" }, times_used: 4, success_rate: 1, source_run_id: "r_demo0", created_at: "2026-10-05T15:00:00Z" },
  { id: "m_21", kind: "setting", text: "Quick budget on 4-core CPU: 20k-image MNIST subset, batch 128, 5 epochs fits in ~6 minutes", details: { budget: "quick" }, times_used: 2, success_rate: 0.9, source_run_id: "r_demo0" },
  { id: "m_30", kind: "experiment", text: "Temperature 20 distillation on MNIST subset closed most of the gap vs. baseline", details: {}, times_used: 1, success_rate: null, source_run_id: "r_demo0" },
  { id: "m_33", kind: "agent_skill", text: "Coding Agent v4 scores 0.83 on 'pytorch training' but 0.52 on 'data cleaning'", details: {}, times_used: 3, success_rate: null },
];

export const PAPER: T.Paper = { id: "p_hinton", workspace_id: "w_demo1", title: "Distilling the Knowledge in a Neural Network", arxiv_id: "1503.02531", summary: "A small network trained on a large network's softened outputs performs nearly as well as the large network." };

export const CLAIMS: T.Claim[] = [
  { id: "c1", paper_id: "p_hinton", description: "Big model (2×1200, dropout) test errors on MNIST", value: 67, unit: "errors", page: 3, table_ref: "§3", position_on_page: { x: 0.12, y: 0.42, width: 0.3, height: 0.03 }, condition: "Full MNIST, jittered inputs" },
  { id: "c2", paper_id: "p_hinton", description: "Small model (2×800) trained alone", value: 146, unit: "errors", page: 3, table_ref: "§3", position_on_page: { x: 0.12, y: 0.5, width: 0.3, height: 0.03 }, condition: "No regularisation" },
  { id: "c3", paper_id: "p_hinton", description: "Small model distilled at temperature 20", value: 74, unit: "errors", page: 3, table_ref: "§3", position_on_page: { x: 0.12, y: 0.58, width: 0.3, height: 0.03 }, condition: "T = 20" },
];

export function demoMetric(runId: string, id: string, name: string, value: number, line: number): T.Metric {
  return { id, run_id: runId, name, value, log_file_hash: "sha256:9f2c…e41a", log_line: line, log_file: "logs/train.log", git_commit: "a1b2c3d", recorded_at: "2026-10-09T10:14:32Z", log_excerpt: `${name}: ${value}` };
}

export function demoScorecard(runId: string): T.ScorecardEntry[] {
  return [
    { id: "s1", run_id: runId, claim: CLAIMS[0]!, metric: demoMetric(runId, "mt1", "teacher_test_errors", 70, 188), difference: 3, status: "match", explanation: null, tolerance: 0.1 },
    { id: "s2", run_id: runId, claim: CLAIMS[1]!, metric: demoMetric(runId, "mt2", "baseline_test_errors", 151, 201), difference: 5, status: "match", explanation: null, tolerance: 0.1 },
    { id: "s3", run_id: runId, claim: CLAIMS[2]!, metric: demoMetric(runId, "mt3", "distilled_test_errors", 81, 214), difference: 7, status: "close", explanation: "Fewer epochs than the paper (see Gap Detective).", tolerance: 0.1 },
  ];
}

export function demoSettings(runId: string): T.RunSetting[] {
  return [
    { id: "st1", run_id: runId, name: "temperature", value: "20", source: "paper", source_ref: "p.3", reason: null },
    { id: "st2", run_id: runId, name: "hidden_units_student", value: "800", source: "paper", source_ref: "p.3", reason: null },
    { id: "st3", run_id: runId, name: "optimizer", value: "SGD (momentum 0.9)", source: "official_code", source_ref: "n/a — no official code; torchvision example train.py:L41", reason: null },
    { id: "st4", run_id: runId, name: "learning_rate", value: "0.01", source: "assumption", source_ref: null, reason: "Paper does not state it; common default for MLPs on MNIST." },
    { id: "st5", run_id: runId, name: "epochs", value: "5", source: "compute_change", source_ref: null, reason: "Reduced to fit the Quick (~5 min) budget." },
    { id: "st6", run_id: runId, name: "train_subset", value: "20,000 images", source: "compute_change", source_ref: null, reason: "Dataset Subset Planner: balanced subset to fit budget." },
    { id: "st7", run_id: runId, name: "input_jitter", value: "off", source: "assumption", source_ref: null, reason: "Paper mentions jitter without parameters." },
  ];
}

export function demoBrief(runId: string): T.ResearchBrief {
  return {
    run_id: runId,
    summary: "The paper shows that a small network trained to match a large network's temperature-softened outputs ('soft targets') generalises almost as well as the large network, and much better than the same small network trained on hard labels alone.",
    method: ["Train a large teacher MLP (2×1200, dropout) on MNIST.", "Compute teacher logits; soften with temperature T.", "Train a 2×800 student on a weighted sum of soft-target and hard-label losses.", "Report test errors for teacher, baseline student and distilled student."],
    claims: CLAIMS,
    missing_details: [
      { name: "learning_rate", note: "Not stated in the paper.", assumed_value: "0.01" },
      { name: "epochs", note: "Paper trains 'for a long time'.", assumed_value: "5 (budget)" },
      { name: "jitter amount", note: "Input jitter mentioned without parameters.", assumed_value: "off" },
    ],
    sources: [
      { id: "src1", kind: "dataset", title: "MNIST (torchvision)", url: "https://pytorch.org/vision/stable/datasets.html", official: true, license: "CC BY-SA 3.0", size: "11 MB", fits_budget: true, used: true, notes: null },
      { id: "src2", kind: "code", title: "No official code released", url: null, official: null, license: null, size: null, fits_budget: null, used: false, notes: "Clean re-implementation recommended." },
      { id: "src3", kind: "paper", title: "Follow-up: Born-Again Neural Networks (2018)", url: "https://arxiv.org/abs/1805.04770", official: false, license: null, size: null, fits_budget: true, used: false, notes: "Candidate what-if branch." },
    ],
    recommendation: "Use the torchvision MNIST loader; no official code exists, so re-implement cleanly. Use a 20k balanced subset and 5 epochs to fit the Quick budget, and record both as compute changes.",
    skills: ["load MNIST", "train a small neural network", "soft-target loss with temperature", "count test errors"],
    plan: ["Teacher: 2×1200 MLP with dropout, 5 epochs on 20k subset", "Baseline student: 2×800 MLP, hard labels", "Distilled student: 2×800 MLP, T = 20", "Claim tests with ±10% tolerance"],
  };
}

export const DEMO_FILES: T.RunFile[] = [
  { path: "src/train.py", kind: "code", size_bytes: 4210 },
  { path: "src/model.py", kind: "code", size_bytes: 1288 },
  { path: "configs/config.yaml", kind: "config", size_bytes: 640 },
  { path: "requirements.txt", kind: "config", size_bytes: 88 },
  { path: "tests/test_claims.py", kind: "test", size_bytes: 1502 },
  { path: "results/metrics.json", kind: "metrics", size_bytes: 214 },
  { path: "logs/train.log", kind: "log", size_bytes: 18044 },
];

export const DEMO_FILE_CONTENT: Record<string, string> = {
  "src/train.py": `# DEMO SAMPLE FILE\nimport json, torch\nfrom model import MLP\n\ndef distill_loss(student_logits, teacher_logits, labels, T=20.0, alpha=0.9):\n    soft = torch.nn.functional.kl_div(\n        torch.log_softmax(student_logits / T, dim=1),\n        torch.softmax(teacher_logits / T, dim=1),\n        reduction="batchmean",\n    ) * (T * T)\n    hard = torch.nn.functional.cross_entropy(student_logits, labels)\n    return alpha * soft + (1 - alpha) * hard\n\n# ... training loop ...\njson.dump({"distilled_test_errors": errors}, open("results/metrics.json", "w"))\n`,
  "src/model.py": `# DEMO SAMPLE FILE\nimport torch.nn as nn\n\nclass MLP(nn.Module):\n    def __init__(self, hidden=800, dropout=0.0):\n        super().__init__()\n        self.net = nn.Sequential(\n            nn.Flatten(), nn.Linear(784, hidden), nn.ReLU(), nn.Dropout(dropout),\n            nn.Linear(hidden, hidden), nn.ReLU(), nn.Dropout(dropout), nn.Linear(hidden, 10))\n\n    def forward(self, x):\n        return self.net(x)\n`,
  "configs/config.yaml": `# DEMO SAMPLE FILE\ntemperature: 20        # paper p.3\nstudent_hidden: 800    # paper p.3\nlearning_rate: 0.01    # assumption\nepochs: 5              # compute change\ntrain_subset: 20000    # compute change\n`,
  "requirements.txt": "torch==2.3.1+cpu\ntorchvision==0.18.1+cpu\nnumpy<2\npytest==8.2.2\n",
  "tests/test_claims.py": `# DEMO SAMPLE FILE\nimport json\nM = json.load(open("results/metrics.json"))\n\ndef test_distilled_within_tolerance():\n    assert M["distilled_test_errors"] <= 74 * 1.10\n`,
  "results/metrics.json": `{\n  "_demo": true,\n  "teacher_test_errors": 70,\n  "baseline_test_errors": 151,\n  "distilled_test_errors": 81\n}\n`,
  "logs/train.log": "[DEMO LOG]\nepoch 1 loss 0.412\nepoch 2 loss 0.233\n...\nteacher_test_errors: 70\nbaseline_test_errors: 151\ndistilled_test_errors: 81\n",
};

export function demoTests(runId: string): T.TestReport {
  return {
    run_id: runId,
    tests: [
      { id: "t1", name: "softmax with temperature sums to 1", kind: "correctness", status: "passed", duration_ms: 12, message: null, claim_id: null, file: "tests/test_correctness.py" },
      { id: "t2", name: "student has 2×800 hidden units", kind: "correctness", status: "passed", duration_ms: 4, message: null, claim_id: null, file: "tests/test_correctness.py" },
      { id: "t3", name: "train and test data do not overlap", kind: "correctness", status: "passed", duration_ms: 310, message: null, claim_id: null, file: "tests/test_correctness.py" },
      { id: "t4", name: "teacher errors within 10% of 67", kind: "claim", status: "passed", duration_ms: 3, message: null, claim_id: "c1", file: "tests/test_claims.py" },
      { id: "t5", name: "baseline errors within 10% of 146", kind: "claim", status: "passed", duration_ms: 3, message: null, claim_id: "c2", file: "tests/test_claims.py" },
      { id: "t6", name: "distilled errors within 10% of 74", kind: "claim", status: "passed", duration_ms: 3, message: "81 ≤ 81.4", claim_id: "c3", file: "tests/test_claims.py" },
    ],
  };
}

export function demoGaps(runId: string): T.GapAnalysis {
  return {
    run_id: runId,
    claim_id: "c3",
    differences: [
      { id: "g1", setting: "epochs", ours: "5", paper: "long training (unstated)", rank: 1, experiment: { status: "done", run_id: "r_gap1", metric: demoMetric("r_gap1", "mg1", "distilled_test_errors", 77, 220), gap_closed: 4 } },
      { id: "g2", setting: "input_jitter", ours: "off", paper: "on (±2px)", rank: 2, experiment: { status: "done", run_id: "r_gap2", metric: demoMetric("r_gap2", "mg2", "distilled_test_errors", 75, 219), gap_closed: 2 } },
      { id: "g3", setting: "train_subset", ours: "20,000", paper: "60,000", rank: 3, experiment: null },
    ],
    explanation: "Training longer explains most of the difference; adding the paper's input jitter closes most of the rest. The remainder is within seed-to-seed variation.",
    seed_runs: [demoMetric("r_seed1", "ms1", "distilled_test_errors", 74, 214), demoMetric("r_seed2", "ms2", "distilled_test_errors", 78, 214), demoMetric("r_seed3", "ms3", "distilled_test_errors", 76, 214)],
  };
}

export function demoWhatIfs(runId: string): T.WhatIfBranch[] {
  return [
    { id: "wf1", run_id: runId, question: "What if the temperature is 2?", settings_change: { temperature: 2 }, status: "stopped_early", result_metric: demoMetric("r_w1", "mw1", "distilled_test_errors", 109, 90), branch_name: "whatif/temp-2", round: 1, stop_reason: "Clearly worse after round 1 (successive halving)", suggested_by: "researcher", budget_seconds: 60 },
    { id: "wf2", run_id: runId, question: "What if the temperature is 5?", settings_change: { temperature: 5 }, status: "stopped_early", result_metric: demoMetric("r_w2", "mw2", "distilled_test_errors", 92, 90), branch_name: "whatif/temp-5", round: 1, stop_reason: "Bottom half after round 1", suggested_by: "researcher", budget_seconds: 60 },
    { id: "wf3", run_id: runId, question: "What if the temperature is 10?", settings_change: { temperature: 10 }, status: "done", result_metric: demoMetric("r_w3", "mw3", "distilled_test_errors", 79, 210), branch_name: "whatif/temp-10", round: 2, stop_reason: null, suggested_by: "researcher", budget_seconds: 180 },
    { id: "wf4", run_id: runId, question: "What if we use Fashion-MNIST instead of MNIST?", settings_change: { dataset: "fashion-mnist" }, status: "proposed", result_metric: null, branch_name: null, round: null, stop_reason: null, suggested_by: "manager", budget_seconds: 300 },
  ];
}

export function demoMap(runId: string, progress: number): T.ResearchMap {
  const st = (at: number): T.MapNodeStatus => (progress >= at + 1 ? "done" : progress >= at ? "working" : "waiting");
  return {
    run_id: runId,
    updated_at: new Date().toISOString(),
    nodes: [
      { id: "paper", kind: "paper", label: "Hinton et al. 2015\nDistilling the Knowledge", status: "done" },
      { id: "c1", kind: "claim", label: "Teacher: 67 errors", status: st(1) },
      { id: "c2", kind: "claim", label: "Baseline: 146 errors", status: st(1) },
      { id: "c3", kind: "claim", label: "Distilled (T=20): 74 errors", status: progress >= 4 ? "problem" : st(1) },
      { id: "mnist", kind: "dataset", label: "MNIST (torchvision)\n20k subset", status: st(1) },
      { id: "train", kind: "code", label: "src/train.py", status: st(2) },
      { id: "tests", kind: "test", label: "tests/test_claims.py", status: st(3) },
      { id: "result", kind: "result", label: "metrics.json", status: st(3) },
    ],
    edges: [
      { id: "e1", from: "paper", to: "c1", label: "claims" },
      { id: "e2", from: "paper", to: "c2" },
      { id: "e3", from: "paper", to: "c3" },
      { id: "e4", from: "mnist", to: "train", label: "feeds" },
      { id: "e5", from: "train", to: "result", label: "writes" },
      { id: "e6", from: "tests", to: "c3", label: "tests" },
      { id: "e7", from: "result", to: "tests" },
    ],
  };
}

type Step = Omit<T.RunEvent, "run_id" | "time" | "id"> & { pause?: "plan" };

/** Scripted event timeline for a demo run. The run pauses at the plan checkpoint until approved. */
export const SCRIPT: Step[] = [
  { agent: "manager", type: "run_started", message: "Run started with the Quick budget", why: "Researcher uploaded 1 paper", data: { stage: "research" } },
  { agent: "manager", type: "stage_changed", message: "Stage: Research", data: { stage: "research" } },
  { agent: "manager", type: "task_started", message: "Making the skills list for this paper", why: "Need to know which agents to assign", cost: { tokens: 640 } },
  { agent: "manager", type: "team_decision", message: "Created specialist 'Dataset Subset Planner'", why: "Full MNIST needs ~3 hours on this laptop and no agent handles data budgeting", links: { agent: "a_subset" }, cost: { tokens: 220 } },
  { agent: "dataset_subset_planner", type: "agent_created", message: "Waiting for the Research Brief", why: "Created by Team Manager" },
  { agent: "research.paper_reader", type: "task_started", message: "Reading arXiv LaTeX source (1503.02531)", why: "LaTeX gives exact numbers with no OCR errors", cost: { tokens: 1800 } },
  { agent: "research.paper_reader", type: "task_progress", message: "Reading page 3: MNIST results", data: { progress: 0.6 }, cost: { tokens: 2400 } },
  { agent: "research.source_finder", type: "task_progress", message: "Checking torchvision MNIST loader licence", why: "Official dataset source preferred", data: { progress: 0.8 }, cost: { tokens: 600 } },
  { agent: "dataset_subset_planner", type: "task_done", message: "Chose a balanced 20,000-image subset", why: "Fits the ~5 minute budget", cost: { tokens: 300, sandbox_seconds: 20 } },
  { agent: "research", type: "task_done", message: "Research Brief ready: 3 claims, 3 missing details", cost: { tokens: 900 } },
  { agent: "observer", type: "map_updated", message: "Map updated: paper, 3 claims, 1 dataset" },
  { agent: "manager", type: "stage_changed", message: "Stage: Plan approval", data: { stage: "plan_approval" } },
  { agent: "manager", type: "checkpoint_waiting", message: "Approve the research plan before any code is written", why: "Checkpoint 1 — researcher approval required", links: { checkpoint: "plan" }, data: { checkpoint: "plan" }, pause: "plan" },
  { agent: "manager", type: "checkpoint_resolved", message: "Plan approved by researcher", links: { checkpoint: "plan" }, data: { checkpoint: "plan" } },
  { agent: "manager", type: "stage_changed", message: "Stage: Coding", data: { stage: "coding" } },
  { agent: "coding.writer", type: "task_started", message: "Writing src/train.py and configs/config.yaml", links: { file: "src/train.py" }, cost: { tokens: 3100 } },
  { agent: "coding.writer", type: "sandbox_started", message: "Installing torch 2.3.1 (CPU) in a fresh sandbox", why: "Exact versions in requirements.txt", cost: { sandbox_seconds: 25 } },
  { agent: "coding.debugger", type: "error", message: "AttributeError: module 'numpy' has no attribute 'float'", links: { file: "src/train.py" }, cost: { sandbox_seconds: 3 } },
  { agent: "coding.debugger", type: "fix_applied", message: "Fixed import error: pinned numpy<2 (known fix from memory)", why: "Same error seen in run #3; that fix worked", links: { memory_item: "m_17", file: "requirements.txt" }, cost: { tokens: 812, sandbox_seconds: 0 } },
  { agent: "coding.writer", type: "task_progress", message: "Training teacher (epoch 3/5)", data: { progress: 0.55 }, cost: { sandbox_seconds: 70 } },
  { agent: "coding", type: "task_done", message: "Training finished; metrics.json written by the code", links: { file: "results/metrics.json" }, cost: { sandbox_seconds: 140 } },
  { agent: "manager", type: "stage_changed", message: "Stage: Testing", data: { stage: "testing" } },
  { agent: "testing.test_designer", type: "task_started", message: "Writing 3 correctness tests and 3 claim tests", cost: { tokens: 1500 } },
  { agent: "testing.test_runner", type: "test_passed", message: "6 / 6 tests passed", cost: { sandbox_seconds: 8 } },
  { agent: "testing", type: "scorecard_updated", message: "Claim Scorecard: 2 Match, 1 Close", cost: { tokens: 200 } },
  { agent: "testing", type: "task_done", message: "Scorecard complete" },
  { agent: "observer", type: "map_updated", message: "Map updated: tests linked to claims" },
  { agent: "manager", type: "stage_changed", message: "Stage: What-ifs", data: { stage: "whatifs" } },
  { agent: "manager", type: "whatif_branch_done", message: "Temperature sweep: T=10 best on this budget", why: "Successive halving stopped T=2 and T=5 early" },
  { agent: "manager", type: "run_finished", message: "Run finished: 3 of 3 claims within tolerance", data: { stage: "done" } },
];
