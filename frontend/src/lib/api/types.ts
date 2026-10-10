/**
 * Domain + transport types for the Go backend contract.
 *
 * Sources:
 *  - allaboutourproject.md §20 (event schema), §22 (database tables), §23 (routes).
 *  - Fields marked `@proposed` are NOT in the agreed contract yet; they are frontend
 *    proposals recorded in FRONTEND_INTEGRATION_NOTES.md for the backend teammate.
 *    UI code must treat them as optional.
 */

export type ID = string;
export type ISODate = string;

/* ───────────────────────────── Users / GitHub ───────────────────────────── */

/** §22 users */
export interface User {
  id: ID;
  name: string | null;
  email: string | null;
  github_username: string;
  avatar_url: string | null;
  created_at: ISODate;
}

export type GithubConnectionStatus = "connected" | "not_connected" | "revoked" | "error";

/** §22 github_connections (token is never sent to the browser). */
export interface GithubConnection {
  status: GithubConnectionStatus;
  scopes: string[];
  /** "owner/name" of the repository used for pushes. */
  default_repo: string | null;
  connected_at: ISODate | null;
}

/** GET /me — "Profile and GitHub connection status". */
export interface MeResponse {
  user: User;
  github: GithubConnection;
}

export interface GithubRepo {
  id: number | string;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch?: string;
  updated_at?: ISODate;
  /** Whether the connected token can push to it. */
  can_push?: boolean;
}

/** POST /github/repos */
export interface CreateRepoRequest {
  name: string;
  private: boolean;
  description?: string;
}

/** PUT /github/default-repo */
export interface SetDefaultRepoRequest {
  full_name: string;
}

/* ───────────────────────────── Workspaces ───────────────────────────── */

/** §7 step 2: "Quick (about 5 minutes)", "Standard (about 15 minutes)", "Deep (Kaggle GPU)". */
export type ComputeBudget = "quick" | "standard" | "deep";

export type WorkspaceRole = "owner" | "editor" | "viewer";

/** §22 workspaces */
export interface Workspace {
  id: ID;
  owner_id: ID;
  title: string;
  compute_budget: ComputeBudget;
  note: string | null;
  created_at: ISODate;
}

export type UploadKind = "paper" | "dataset" | "repo_link" | "note";

/** §22 uploads */
export interface Upload {
  id: ID;
  workspace_id: ID;
  kind: UploadKind;
  path_or_url: string;
  /** @proposed */
  filename?: string | null;
  /** @proposed */
  size_bytes?: number | null;
  /** @proposed */
  created_at?: ISODate;
}

/** §22 papers */
export interface Paper {
  id: ID;
  workspace_id: ID;
  title: string | null;
  arxiv_id: string | null;
  summary: string | null;
}

/** GET /workspaces/{id}. Nested collections are @proposed (needed to open a workspace). */
export interface WorkspaceDetail extends Workspace {
  uploads?: Upload[];
  papers?: Paper[];
  runs?: Run[];
  role?: WorkspaceRole;
  latest_push?: Push | null;
}

/** GET /workspaces (@proposed) — list for the dashboard. */
export interface WorkspaceSummary extends Workspace {
  role?: WorkspaceRole;
  latest_run?: Run | null;
  repo_url?: string | null;
  paper_count?: number;
}

/** POST /workspaces */
export interface CreateWorkspaceRequest {
  title: string;
  compute_budget: ComputeBudget;
  note?: string;
}

/** POST /workspaces/{id}/uploads — sent as multipart/form-data. */
export interface UploadRequest {
  kind: Exclude<UploadKind, "note">;
  file?: File;
  url?: string;
}

/* ───────────────────────────── Runs ───────────────────────────── */

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "stopped";

/** §25.4: Research → Plan approval → Coding → Testing → What-ifs → Push. */
export type RunStage = "research" | "plan_approval" | "coding" | "testing" | "whatifs" | "push" | "done";

/** §22 runs */
export interface Run {
  id: ID;
  workspace_id: ID;
  parent_run_id: ID | null;
  branch_name: string | null;
  status: RunStatus;
  started_at: ISODate | null;
  finished_at: ISODate | null;
  git_commit: string | null;
  /** Why the run failed or stopped, as recorded by the backend. */
  error?: string | null;
  /** @proposed */
  stage?: RunStage;
  /** @proposed */
  compute_budget?: ComputeBudget;
}

/** POST /workspaces/{id}/runs */
export interface StartRunRequest {
  compute_budget: ComputeBudget;
  /** @proposed — start a child run (e.g. re-run from a parent). */
  parent_run_id?: ID;
}

/** §20 live event (also §22 run_events). */
export interface RunEvent {
  /** §22 run_events.id — used for de-duplication and SSE resume. */
  id?: ID;
  run_id: ID;
  time: ISODate;
  /** Dotted agent path, e.g. "coding.debugger" or "manager". */
  agent: string;
  type: RunEventType | (string & {});
  message: string;
  why?: string | null;
  links?: Record<string, string | undefined>;
  cost?: { tokens?: number; sandbox_seconds?: number };
  /** @proposed — structured payload (stage, status, progress, checkpoint name, …). `rawType` is the backend's own event type. */
  data?: Record<string, unknown>;
}

/**
 * Event vocabulary the UI understands. Only "fix_applied" appears in the spec (§20);
 * the rest are @proposed. Unknown types are still rendered generically.
 */
export type RunEventType =
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "stage_changed"
  | "agent_created"
  | "task_started"
  | "task_progress"
  | "task_done"
  | "task_failed"
  | "error"
  | "fix_attempt"
  | "fix_applied"
  | "needs_help"
  | "agent_paused"
  | "agent_resumed"
  | "agent_stopped"
  | "checkpoint_waiting"
  | "checkpoint_resolved"
  | "team_decision"
  | "memory_reused"
  | "sandbox_started"
  | "sandbox_finished"
  | "test_passed"
  | "test_failed"
  | "scorecard_updated"
  | "whatif_branch_started"
  | "whatif_branch_stopped"
  | "whatif_branch_done"
  | "map_updated"
  | "push_started"
  | "push_blocked"
  | "push_succeeded"
  | "push_failed"
  | "heartbeat";

export type CheckpointDecision = "approve" | "edit" | "reject";

/** POST /runs/{id}/checkpoints/{name} */
export interface CheckpointRequest {
  decision: CheckpointDecision;
  /** Free-text edit (e.g. "use only 10,000 training images"), or a note for help / reject. */
  instructions?: string;
  /** Exact setting edits at the plan checkpoint, e.g. {"train.epochs_student": 10}. */
  changes?: Record<string, string | number | boolean>;
  /** Chosen option at the long_run checkpoint ("reduce" | "full"). */
  option?: string;
}

/** GET /runs/{id}/checkpoints — approvals asked of the researcher (plan, long_run, help). */
export interface RunCheckpoint {
  id: ID;
  run_id: ID;
  name: string;
  status: "pending" | "approved" | "edited" | "rejected";
  /** What the researcher is asked to review (shape depends on `name`). */
  payload: Record<string, unknown>;
  response: Record<string, unknown>;
  created_at: ISODate;
  resolved_at: ISODate | null;
}

export interface CheckpointResult {
  name: string;
  decision: CheckpointDecision;
  run?: Run;
}

/** §9.1: Pause, Stop, Retry, Give instruction (plus Resume). */
export type AgentActionKind = "pause" | "resume" | "stop" | "retry" | "instruct";

/** POST /runs/{id}/agents/{agent}/action */
export interface AgentActionRequest {
  action: AgentActionKind;
  instruction?: string;
}

export interface AgentActionResult {
  agent: string;
  action: AgentActionKind;
  accepted: boolean;
  message?: string;
}

/* ───────────────────────────── Evidence ───────────────────────────── */

/** Normalised (0–1) rectangle on a PDF page, from §22 claims.position_on_page. */
export interface PagePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** §22 claims */
export interface Claim {
  id: ID;
  paper_id: ID;
  description: string;
  value: number;
  unit: string | null;
  page: number | null;
  table_ref: string | null;
  position_on_page: PagePosition | null;
  condition: string | null;
  /** Exact sentence from the paper the number was taken from. */
  quote?: string | null;
  /** Relative tolerance used to call a result a "match". */
  tolerance?: number | null;
  higher_is_better?: boolean;
  /** Name expected in results/metrics.json. */
  metric_name?: string | null;
}

/** §22 metrics — the only source of measured numbers (Hero 2). */
export interface Metric {
  id: ID;
  run_id: ID;
  name: string;
  value: number;
  log_file_hash: string;
  log_line: number | null;
  /** @proposed */
  log_file?: string | null;
  /** @proposed — commit of the code that produced the metric. */
  git_commit?: string | null;
  /** @proposed */
  recorded_at?: ISODate | null;
  /** @proposed — the exact log line text. */
  log_excerpt?: string | null;
}

export type ClaimStatus = "match" | "close" | "different";

/** §22 scorecard_entries (joined with claim + metric). */
export interface ScorecardEntry {
  id: ID;
  run_id: ID;
  claim: Claim;
  metric: Metric | null;
  difference: number | null;
  /** null while the claim is not yet tested — shown as "Unverified". */
  status: ClaimStatus | null;
  explanation: string | null;
  /** @proposed — relative tolerance used for "match" (e.g. 0.10). */
  tolerance?: number | null;
}

export type SettingSource = "paper" | "official_code" | "assumption" | "compute_change";

/** §22 settings — Missing Details Log (Hero 4). */
export interface RunSetting {
  id: ID;
  run_id: ID;
  name: string;
  value: string;
  source: SettingSource;
  source_ref: string | null;
  reason: string | null;
  /** The paper's own value, when ours was changed to fit the budget. */
  paper_value?: string | null;
}

/* ───────────────────────────── What-ifs ───────────────────────────── */

export type WhatIfStatus = "proposed" | "queued" | "running" | "stopped_early" | "done" | "failed";

/** §22 whatif_branches */
export interface WhatIfBranch {
  id: ID;
  run_id: ID;
  question: string;
  settings_change: Record<string, unknown>;
  status: WhatIfStatus;
  /** @proposed — expanded from result_metric_id. */
  result_metric?: Metric | null;
  /** @proposed */
  child_run_id?: ID | null;
  /** @proposed — git branch in the researcher's repository. */
  branch_name?: string | null;
  /** @proposed */
  budget_seconds?: number | null;
  /** @proposed — successive-halving round reached. */
  round?: number | null;
  /** @proposed */
  stop_reason?: string | null;
  /** @proposed — "researcher" or "manager" (Team Manager suggestion). */
  suggested_by?: "researcher" | "manager";
}

/** POST /runs/{id}/whatif */
export interface WhatIfRequest {
  question: string;
}

/* ───────────────────────────── Agents / team ───────────────────────────── */

export type AgentStage = "trial" | "active" | "refined" | "merged" | "replaced" | "retired";
export type AgentKind = "core" | "specialist";

/** §22 agent_versions */
export interface AgentVersion {
  id: ID;
  agent_id: ID;
  instructions: string;
  tools: string[];
  model: string;
  skill_tags: string[];
  created_reason: string | null;
  /** @proposed */
  created_at?: ISODate;
}

/** §22 agents (GET /agents). */
export interface Agent {
  id: ID;
  name: string;
  kind: AgentKind;
  stage: AgentStage;
  current_version_id: ID | null;
  /** @proposed — expanded current version. */
  current_version?: AgentVersion | null;
  /** @proposed */
  avg_score?: number | null;
  /** @proposed */
  task_count?: number;
  /** @proposed — dotted event path this agent emits as (e.g. "coding"). */
  event_key?: string;
}

/** §22 agent_tasks */
export interface AgentTask {
  id: ID;
  run_id: ID;
  agent_id: ID;
  skill: string;
  outcome: number | null;
  feedback: -1 | 0 | 1 | null;
  tokens: number;
  sandbox_seconds: number;
  wasted_tries: number;
  score: number | null;
  /** @proposed */
  created_at?: ISODate;
}

export type TeamDecisionKind = "create" | "refine" | "merge" | "replace" | "retire" | "assign";

/** §22 team_decisions */
export interface TeamDecision {
  id: ID;
  run_id: ID;
  decision: TeamDecisionKind;
  agent_ids: ID[];
  reason: string;
  /** @proposed */
  created_at?: ISODate;
}

/** GET /agents/{id}/history */
export interface AgentHistory {
  agent: Agent;
  versions: AgentVersion[];
  tasks: AgentTask[];
  decisions: TeamDecision[];
}

/* ───────────────────────────── Memory / notes ───────────────────────────── */

export type MemoryKind = "error_fix" | "setting" | "experiment" | "agent_skill";

/** §22 memory_items */
export interface MemoryItem {
  id: ID;
  kind: MemoryKind;
  text: string;
  details: Record<string, unknown>;
  times_used: number;
  success_rate: number | null;
  /** @proposed — run where this memory was learned (provenance). */
  source_run_id?: ID | null;
  /** @proposed */
  created_at?: ISODate;
  /** @proposed — similarity score for search results. */
  similarity?: number | null;
}

/** GET /runs/{id}/memory (@proposed) */
export interface RunMemory {
  learned: MemoryItem[];
  reused: { item: MemoryItem; used_at: ISODate; event_id?: ID | null; agent?: string | null }[];
}

/** §22 notes */
export interface Note {
  id: ID;
  workspace_id: ID;
  /** §22 says "user or agent"; we accept a plain string or a structured author. */
  author: string | { type: "user" | "agent"; id: ID; name: string };
  markdown: string;
  updated_at: ISODate;
}

/** PUT /workspaces/{id}/notes */
export interface UpdateNotesRequest {
  markdown: string;
}

/* ───────────────────────────── Publishing / sharing ───────────────────────────── */

export type PushStatus = "pending" | "scanning" | "blocked" | "pushing" | "succeeded" | "failed";

export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  description?: string;
}

export interface SecretScanResult {
  passed: boolean;
  findings: SecretFinding[];
}

export interface CommitLink {
  message: string;
  url: string;
  branch?: string | null;
}

/** §22 pushes */
export interface Push {
  id: ID;
  run_id: ID;
  repo_url: string | null;
  commit_urls: CommitLink[];
  status: PushStatus;
  secret_scan_result: SecretScanResult | null;
  /** @proposed */
  error?: string | null;
  /** @proposed */
  created_at?: ISODate;
  /** @proposed */
  workspace_id?: ID;
  /** @proposed */
  workspace_title?: string;
}

/** POST /runs/{id}/push — only sent after the researcher's explicit approval. */
export interface PushRequest {
  approved: true;
  /** Defaults to the user's default repository server-side when omitted. */
  repo_full_name?: string;
}

/** POST /workspaces/{id}/share */
export interface ShareRequest {
  expires_in_hours?: number;
}

export interface ShareLink {
  token: string;
  expires_at: ISODate | null;
  /** @proposed — absolute URL; otherwise built from NEXT_PUBLIC_APP_ORIGIN + /share/{token}. */
  url?: string;
}

/** GET /share/{token} (@proposed) */
export interface SharedView {
  workspace: Workspace;
  run: Run | null;
  expires_at: ISODate | null;
}

/* ───────────────────────────── @proposed run artifacts ───────────────────────────── */

export interface SourceRef {
  id: ID;
  kind: "code" | "dataset" | "model" | "paper";
  title: string;
  url: string | null;
  official: boolean | null;
  license: string | null;
  size: string | null;
  fits_budget: boolean | null;
  used: boolean | null;
  notes: string | null;
  /** Real metadata when the agents reported it (related papers). */
  year?: number | null;
  citations?: number | null;
  relation?: string | null;
}

export interface MissingDetail {
  name: string;
  note: string;
  assumed_value: string | null;
}

/** GET /runs/{id}/brief (@proposed) — Research Brief (§7 step 5). */
export interface ResearchBrief {
  run_id: ID;
  summary: string;
  method: string[];
  claims: Claim[];
  missing_details: MissingDetail[];
  sources: SourceRef[];
  recommendation: string;
  skills?: string[];
  /** Markdown brief written by the Research Agent (GET /runs/{id}/research). */
  brief_markdown?: string | null;
  /** Plan text shown at Checkpoint 1. */
  plan?: string[];
}

export type RunFileKind = "code" | "config" | "test" | "log" | "metrics" | "model" | "notebook" | "other";

export interface RunFile {
  path: string;
  kind: RunFileKind;
  size_bytes: number | null;
  sha?: string | null;
  /** The researcher may edit it in the code sandbox (src/, configs/, tests/, requirements.txt). */
  editable?: boolean;
}

/* ── Code sandbox (Docker execution through the Go backend) ── */

export type SandboxExecStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "error";

export interface SandboxArtifact {
  path: string;
  kind: string;
  format: string | null;
  size: number | null;
  /** Models only: loaded in a fresh container before the run counted as successful. */
  verified: boolean | null;
  error: string | null;
}

/** A number measured by the executed program (results/metrics.json), with its log line. */
export interface SandboxMetric {
  id: ID;
  name: string;
  value: number;
  log_line: number | null;
  log_line_text: string | null;
}

export interface SandboxExecution {
  id: ID;
  run_id: ID;
  phase: string;
  status: SandboxExecStatus;
  source: "agent" | "user";
  agent: string;
  attempt: number;
  entrypoint: string | null;
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  cancelled: boolean;
  duration_ms: number | null;
  started_at: ISODate | null;
  finished_at: ISODate | null;
  log_hash: string | null;
  code_version: string | null;
  error: string | null;
  metrics_status: "valid" | "invalid" | "missing" | "not_collected";
  metrics_error: string | null;
  artifacts: SandboxArtifact[];
  metrics: SandboxMetric[];
  limits: { cpus: number | null; memory_bytes: number | null; pids: number | null };
}

export interface SandboxHealth {
  available: boolean;
  image: string;
  image_present: boolean;
  error: string | null;
  limits: { cpus: number | null; memory_bytes: number | null; pids: number | null; timeout_sec: number | null; network: string | null };
}

export type HealStatus = "queued" | "running" | "fixed" | "failed" | "error";
export type RepairStatus = "running" | "fixed" | "still_failing" | "tests_failed" | "no_fix" | "sandbox_error";

export interface RepairAttempt {
  id: ID;
  attempt: number;
  error_summary: string;
  error_text: string;
  /** memory | pattern | cache | arina | fallback_ai */
  fix_source: string;
  explanation: string;
  diff: string;
  files: string[];
  exec_id: ID | null;
  tests: { total?: number; passed?: number; failed?: number; skipped?: number; note?: string; error?: string };
  status: RepairStatus;
}

export interface HealSession {
  id: ID;
  status: HealStatus;
  message: string;
  max_attempts: number;
  attempts: RepairAttempt[];
  created_at: ISODate | null;
}

/* ── Hugging Face Hub publishing ── */

export interface HfFile {
  path: string;
  size: number;
  sha256: string;
  kind: "model" | "metrics" | "config" | "requirements" | "code" | string;
  required: boolean;
}

export interface HfPlan {
  configured: boolean;
  files: HfFile[];
  excluded: { path: string; reason: string }[];
  blockers: string[];
  model_card: string;
  suggested_repo: string;
  total_bytes: number;
}

export interface HfPublication {
  id: ID;
  repo_name: string;
  repo_id: string;
  private: boolean;
  status: "queued" | "uploading" | "succeeded" | "failed";
  stage: string;
  files_done: number;
  files_total: number;
  bytes_done: number;
  bytes_total: number;
  repo_url: string;
  commit_url: string;
  error: string;
  created_at: ISODate | null;
}

export interface LogChunk {
  content: string;
  offset: number;
  next_offset: number;
  size: number;
  complete: boolean;
  status: SandboxExecStatus | null;
}

export interface TestCase {
  id: ID;
  name: string;
  kind: "correctness" | "claim";
  status: "passed" | "failed" | "skipped" | "error";
  duration_ms: number | null;
  message: string | null;
  claim_id: ID | null;
  file: string | null;
}

/** GET /runs/{id}/tests (@proposed) */
export interface TestReport {
  run_id: ID;
  tests: TestCase[];
}

export interface GapDifference {
  id: ID;
  setting: string;
  ours: string;
  paper: string;
  rank: number;
  /** Diagnostic experiment (measured) — absent means hypothesis only. */
  experiment: {
    status: "queued" | "running" | "done" | "failed" | "skipped";
    run_id: ID | null;
    metric: Metric | null;
    gap_closed: number | null;
  } | null;
}

/** GET /runs/{id}/gaps (@proposed) — Gap Detective (Hero 3). */
export interface GapAnalysis {
  run_id: ID;
  claim_id: ID | null;
  differences: GapDifference[];
  /** AI-written explanation; numbers inside must come from metrics (Hero 2). */
  explanation: string | null;
  seed_runs?: Metric[];
}

export type MapNodeKind =
  | "paper" | "claim" | "source" | "related" | "dataset" | "code" | "file" | "test" | "result" | "experiment" | "whatif" | "gap" | "agent" | "note";
export type MapNodeStatus = "waiting" | "working" | "done" | "problem";

export interface MapNode {
  id: ID;
  kind: MapNodeKind;
  label: string;
  status: MapNodeStatus;
  detail?: string | null;
  /** Original source (paper, dataset, repository) when the agents found a valid web URL. Never guessed. */
  url?: string | null;
  /** paper | dataset | repository, as reported by the agents. */
  source_type?: string | null;
  /** Facts the backend really reported: year, citations, licence, stars… */
  meta?: Record<string, unknown>;
}

export interface MapEdge {
  id: ID;
  from: ID;
  to: ID;
  label?: string | null;
}

/** GET /runs/{id}/map (@proposed) — Observer agent output (Hero 7). */
export interface ResearchMap {
  run_id: ID;
  nodes: MapNode[];
  edges: MapEdge[];
  updated_at: ISODate | null;
}

/** GET /runs/{id}/briefing (@proposed) — audio briefing (Hero 9). */
export interface AudioBriefing {
  script: string;
  audio_url: string | null;
  duration_seconds: number | null;
}

/* ───────────────────────────── Errors ───────────────────────────── */

/** Proposed error envelope; client also accepts {error:"msg"} and {message:"msg"}. */
export interface ApiErrorBody {
  error?: string | { code?: string; message?: string; fields?: Record<string, string> };
  message?: string;
  code?: string;
  fields?: Record<string, string>;
}
