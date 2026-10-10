/**
 * Adapters from the real Go backend responses to the UI's domain types (types.ts).
 *
 * The UI was first built against a proposed contract; the Go backend is the source of truth
 * (audit/FRONTEND_INTEGRATION_NOTES.md). Every shape difference is translated here, in one
 * place, so pages and components keep using the domain types. Nothing here invents data:
 * a field the backend does not send becomes null/undefined, never a made-up value.
 */
import { safeUrl } from "@/lib/sources";
import type * as T from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const id = (v: unknown): T.ID => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ── Users / GitHub ── */

export function toMe(raw: unknown): T.MeResponse & { pushes: T.Push[] } {
  const r = isObj(raw) ? raw : {};
  const u = isObj(r.user) ? r.user : {};
  const g = isObj(r.github) ? r.github : {};
  const connected = g.connected === true || g.status === "connected";
  const status: T.GithubConnectionStatus = connected ? "connected" : g.status === "error" ? "error" : "not_connected";
  const scopes = typeof g.scopes === "string" ? g.scopes.split(/[ ,]+/).filter(Boolean) : (arr(g.scopes) as string[]);
  return {
    user: {
      id: id(u.id),
      name: s(u.name),
      email: s(u.email),
      github_username: /^(dev|local):/.test(String(u.github_username ?? "")) ? "" : String(u.github_username ?? ""),
      avatar_url: s(u.avatar_url),
      created_at: String(u.created_at ?? ""),
    },
    github: { status, scopes, default_repo: s(g.default_repo), connected_at: s(g.connected_at) },
    pushes: arr(r.pushes).map(toPush),
  };
}

/* ── Workspaces ── */

export function toWorkspace(raw: unknown): T.WorkspaceSummary {
  const w = isObj(raw) && isObj(raw.workspace) ? raw.workspace : isObj(raw) ? raw : {};
  return {
    id: id(w.id),
    owner_id: id(w.owner_id),
    title: String(w.title ?? ""),
    compute_budget: (w.compute_budget as T.ComputeBudget) ?? "quick",
    note: s(w.note),
    created_at: String(w.created_at ?? ""),
    role: (s(w.role) ?? undefined) as T.WorkspaceRole | undefined,
  };
}

export function toUpload(raw: unknown): T.Upload {
  const u = isObj(raw) ? raw : {};
  return {
    id: id(u.id),
    workspace_id: id(u.workspace_id),
    kind: u.kind as T.UploadKind,
    path_or_url: String(u.path_or_url ?? ""),
    filename: s(u.original_name ?? u.filename),
    size_bytes: num(u.size_bytes),
    created_at: s(u.created_at) ?? undefined,
  };
}

export function toWorkspaceDetail(raw: unknown): T.WorkspaceDetail {
  const r = isObj(raw) ? raw : {};
  const w = isObj(r.workspace) ? r.workspace : r;
  // Backend lists main runs newest first; the UI expects oldest → newest.
  const runs = arr(r.runs).map(toRun).reverse();
  return {
    ...toWorkspace(w),
    uploads: arr(r.uploads).map(toUpload),
    runs,
    role: (s(r.role) ?? s(w.role) ?? undefined) as T.WorkspaceRole | undefined,
  };
}

/* ── Runs ── */

const RUN_STATUS: Record<string, T.RunStatus> = {
  queued: "queued",
  running: "running",
  waiting_approval: "waiting_approval",
  paused: "paused",
  completed: "succeeded",
  failed: "failed",
  stopped: "stopped",
  rejected: "stopped",
};

const STAGE: Record<string, T.RunStage> = {
  research: "research",
  plan_approval: "plan_approval",
  coding: "coding",
  testing: "testing",
  gap: "testing",
  whatif: "whatifs",
  whatifs: "whatifs",
  push: "push",
  done: "done",
};

export function toRun(raw: unknown): T.Run {
  const r = isObj(raw) && isObj(raw.run) ? raw.run : isObj(raw) ? raw : {};
  return {
    id: id(r.id),
    workspace_id: id(r.workspace_id),
    parent_run_id: r.parent_run_id == null ? null : id(r.parent_run_id),
    branch_name: s(r.branch_name),
    status: RUN_STATUS[String(r.status)] ?? "queued",
    started_at: s(r.started_at),
    finished_at: s(r.finished_at),
    git_commit: s(r.git_commit),
    error: s(r.error),
    stage: STAGE[String(r.stage)],
    compute_budget: (r.compute_budget as T.ComputeBudget) ?? undefined,
  };
}

/**
 * Backend event types → UI event vocabulary. Types not listed pass through unchanged
 * (the feed still shows them; only board status derivation needs the mapping).
 */
const EVENT_TYPE: Record<string, string> = {
  agent_started: "task_started",
  agent_finished: "task_done",
  agent_failed: "task_failed",
  progress: "task_progress",
  stage: "stage_changed",
  run_completed: "run_finished",
  run_stopped: "run_failed",
  run_rejected: "run_failed",
  paused: "agent_paused",
  resumed: "agent_resumed",
  stop_requested: "agent_stopped",
  error_seen: "error",
  fix_failed: "fix_attempt",
  retrying: "fix_attempt",
  claim_scored: "scorecard_updated",
  results_ready: "scorecard_updated",
  gap_explained: "scorecard_updated",
  tests_finished: "test_passed",
  whatif_branch: "whatif_branch_started",
  whatif_stopped: "whatif_branch_stopped",
  whatif_finished: "whatif_branch_done",
  whatif_failed: "whatif_branch_done",
  push_done: "push_succeeded",
  secret_scan_passed: "push_started",
  push_n8n: "push_started",
  push_fallback: "push_started",
};

export function toEvent(raw: unknown): T.RunEvent {
  const e = isObj(raw) ? raw : {};
  const linksIn = isObj(e.links) ? e.links : {};
  const links: Record<string, string> = {};
  for (const [k, v] of Object.entries(linksIn)) {
    if (v === null || v === undefined || typeof v === "object") continue; // map_nodes etc. are for the Observer
    links[k] = String(v);
  }
  const type = String(e.type ?? "");
  const data: Record<string, unknown> = { rawType: type };
  if (type === "stage" && typeof linksIn.stage === "string") data.stage = STAGE[linksIn.stage] ?? linksIn.stage;
  if (typeof linksIn.checkpoint === "string") data.checkpoint = linksIn.checkpoint;
  if (type === "run_stopped" || type === "run_rejected") data.terminal = type;
  const cost = isObj(e.cost) ? e.cost : {};
  return {
    id: e.id === undefined || e.id === null ? undefined : String(e.id),
    run_id: id(e.run_id),
    time: String(e.time ?? ""),
    agent: String(e.agent ?? "system"),
    type: EVENT_TYPE[type] ?? type,
    message: String(e.message ?? ""),
    why: s(e.why),
    links,
    cost: { tokens: num(cost.tokens) ?? 0, sandbox_seconds: num(cost.sandbox_seconds) ?? 0 },
    data,
  };
}

/* ── Evidence ── */

function toPosition(raw: unknown): T.PagePosition | null {
  if (!isObj(raw)) return null;
  if (["x", "y", "width", "height"].every((k) => typeof raw[k] === "number")) return raw as unknown as T.PagePosition;
  const x0 = num(raw.x0), y0 = num(raw.y0), x1 = num(raw.x1), y1 = num(raw.y1);
  const pw = num(raw.page_width), ph = num(raw.page_height);
  if (x0 === null || y0 === null || x1 === null || y1 === null || !pw || !ph) return null;
  return { x: x0 / pw, y: y0 / ph, width: (x1 - x0) / pw, height: (y1 - y0) / ph };
}

export function toClaim(raw: unknown): T.Claim {
  const c = isObj(raw) ? raw : {};
  return {
    id: id(c.id),
    paper_id: id(c.paper_id),
    description: String(c.description ?? ""),
    value: Number(c.value),
    unit: s(c.unit),
    page: num(c.page),
    table_ref: s(c.table_ref),
    position_on_page: toPosition(c.position_on_page),
    condition: s(c.condition),
    quote: s(c.quote),
    tolerance: num(c.tolerance),
    higher_is_better: c.higher_is_better === true,
    metric_name: s(c.metric_name),
  };
}

export function toCheckpoint(raw: unknown): T.RunCheckpoint {
  const c = isObj(raw) ? raw : {};
  const status = String(c.status);
  return {
    id: id(c.id),
    run_id: id(c.run_id),
    name: String(c.name ?? ""),
    status: (["pending", "approved", "edited", "rejected"].includes(status) ? status : "pending") as T.RunCheckpoint["status"],
    payload: isObj(c.payload) ? c.payload : {},
    response: isObj(c.response) ? c.response : {},
    created_at: String(c.created_at ?? ""),
    resolved_at: s(c.resolved_at),
  };
}

export function toMetric(raw: unknown): T.Metric | null {
  if (!isObj(raw)) return null;
  return {
    id: id(raw.id),
    run_id: id(raw.run_id),
    name: String(raw.name ?? ""),
    value: Number(raw.value),
    log_file_hash: String(raw.log_file_hash ?? ""),
    log_line: num(raw.log_line),
    log_file: s(raw.log_file),
    git_commit: s(raw.code_version ?? raw.git_commit),
    recorded_at: s(raw.created_at ?? raw.recorded_at),
    log_excerpt: s(raw.log_line_text ?? raw.log_excerpt),
  };
}

export function toScorecardEntry(raw: unknown, runId: string): T.ScorecardEntry {
  const r = isObj(raw) ? raw : {};
  const status = String(r.status ?? "");
  const metric = toMetric(r.ours ?? r.metric);
  const claim = isObj(r.claim) ? r.claim : {};
  return {
    id: id(r.id),
    run_id: runId,
    claim: toClaim(claim),
    metric,
    difference: num(r.difference),
    // "missing" = the code never reported this metric: shown as not measured, never as a number.
    status: metric && (status === "match" || status === "close" || status === "different") ? status : null,
    explanation: s(r.explanation),
    tolerance: num(claim.tolerance),
  };
}

export function toSetting(raw: unknown, runId: string): T.RunSetting {
  const r = isObj(raw) ? raw : {};
  return {
    id: id(r.id),
    run_id: runId,
    name: String(r.name ?? ""),
    value: String(r.value ?? ""),
    source: (r.source === "researcher" ? "assumption" : r.source) as T.SettingSource,
    source_ref: s(r.source_ref) ?? (r.source === "researcher" ? "changed by the researcher" : null),
    reason: s(r.reason),
    paper_value: s(r.paper_value),
  };
}

const WHATIF_STATUS: Record<string, T.WhatIfStatus> = {
  pending: "queued",
  running: "running",
  stopped_early: "stopped_early",
  done: "done",
  failed: "failed",
};

export function toWhatIf(raw: unknown, runId: string): T.WhatIfBranch {
  const b = isObj(raw) ? raw : {};
  return {
    id: id(b.id),
    run_id: runId,
    question: String(b.label && b.label !== "planning" ? `${b.question} — ${b.label}` : (b.question ?? "")),
    settings_change: isObj(b.settings_change) ? b.settings_change : {},
    status: WHATIF_STATUS[String(b.status)] ?? "queued",
    result_metric: toMetric(b.result),
    child_run_id: b.child_run_id == null ? null : id(b.child_run_id),
    branch_name: s(b.branch_name),
    round: num(b.round),
    stop_reason: s(b.reason),
    suggested_by: "researcher",
  };
}

/** GET /runs/{id}/research → Research Brief: the Markdown report plus the structured brief.json the agents wrote. */
export function toBrief(raw: unknown, runId: string): T.ResearchBrief & { brief_markdown: string | null } {
  const r = isObj(raw) ? raw : {};
  const papers = arr(r.papers).filter(isObj);
  const md = s(r.brief_markdown);
  const sj = isObj(r.brief) ? r.brief : null;
  const jp = sj ? arr(sj.papers).filter(isObj) : [];
  const src = sj && isObj(sj.sources) ? sj.sources : {};
  const sources: T.SourceRef[] = [];
  arr(src.datasets).filter(isObj).forEach((d, i) =>
    sources.push({ id: `dataset:${i}`, kind: "dataset", title: String(d.name ?? "Dataset"), url: safeUrl(d.url), official: d.official === true, license: s(d.licence), size: s(d.size),
      fits_budget: typeof d.fits_budget === "boolean" ? d.fits_budget : null, used: true, notes: d.user_provided ? "provided by you" : s(d.how), relation: "used by the paper" }));
  arr(src.repositories).filter(isObj).forEach((x, i) =>
    sources.push({ id: `repo:${i}`, kind: "code", title: String(x.name ?? x.url ?? "Repository"), url: safeUrl(x.url), official: x.official === true, license: s(x.licence), size: null,
      fits_budget: null, used: null, notes: x.user_provided ? "provided by you" : x.official ? "official code" : "found by title search, not confirmed official", relation: s(x.description) }));
  arr(src.related_papers).filter(isObj).forEach((x, i) =>
    sources.push({ id: `related:${i}`, kind: "paper", title: String(x.title ?? "Related paper"), url: x.arxiv ? safeUrl(`https://arxiv.org/abs/${String(x.arxiv)}`) : null, official: null, license: null, size: null,
      fits_budget: null, used: null, notes: null, year: num(x.year), citations: num(x.citations), relation: "cites this paper" }));
  return {
    run_id: runId,
    summary: (jp.length ? jp : papers).map((p) => s(p.summary)).filter(Boolean).join("\n\n"),
    method: jp.flatMap((p) => arr(p.method).map(String)),
    claims: papers.flatMap((p) => arr(p.claims).map((c) => toClaim({ ...(c as Obj), paper_id: p.id }))),
    missing_details: jp.flatMap((p) => arr(p.missing_details).map((m) => ({ name: String(m), note: "Not stated in the paper", assumed_value: null }))),
    sources,
    recommendation: s(src.recommendation) ?? "",
    brief_markdown: md,
    ...(sj ? { title: s(jp[0]?.title) ?? undefined } : {}),
  } as T.ResearchBrief & { brief_markdown: string | null };
}

const MAP_KINDS = new Set(["paper", "claim", "source", "related", "dataset", "code", "file", "test", "result", "experiment", "whatif", "gap", "agent", "note"]);
const MAP_STATUS = new Set(["waiting", "working", "done", "problem"]);

export function toMap(raw: unknown, runId: string): T.ResearchMap {
  const r = isObj(raw) ? raw : {};
  const g = isObj(r.graph) ? r.graph : r;
  return {
    run_id: runId,
    nodes: arr(g.nodes).filter(isObj).map((n) => ({
      id: id(n.id),
      kind: (MAP_KINDS.has(String(n.kind)) ? n.kind : "note") as T.MapNodeKind,
      label: String(n.label ?? n.id ?? ""),
      status: (MAP_STATUS.has(String(n.status)) ? n.status : "waiting") as T.MapNodeStatus,
      detail: s(n.detail),
      url: safeUrl(n.url),
      source_type: s(n.source_type),
      meta: isObj(n.meta) ? n.meta : undefined,
    })),
    edges: arr(g.edges).filter(isObj).map((e, i) => ({
      id: id(e.id ?? `e${i}`),
      from: id(e.from),
      to: id(e.to),
      label: s(e.label),
    })),
    updated_at: s(r.updated_at),
  };
}

/** GET /runs/{id}/gap → the analysis of the first "Different" claim. */
export function toGap(raw: unknown, runId: string): T.GapAnalysis {
  const list = arr(raw).filter(isObj);
  const g = list[0] ?? {};
  const diffs = arr(g.differences).filter(isObj);
  const exps = arr(g.experiments).filter(isObj);
  return {
    run_id: runId,
    claim_id: g.claim_id == null ? null : id(g.claim_id),
    differences: diffs.map((d, i) => {
      const e = exps.find((x) => x.setting === d.setting);
      return {
        id: `${String(d.setting)}-${i}`,
        setting: String(d.label ?? d.setting ?? ""),
        ours: String(d.ours ?? ""),
        paper: String(d.paper || "not stated"),
        rank: i + 1,
        experiment: e
          ? {
              status: e.metric_id ? "done" : "failed",
              run_id: e.child_run_id == null ? null : id(e.child_run_id),
              metric: typeof e.value === "number"
                ? { id: id(e.metric_id), run_id: id(e.child_run_id), name: String(d.setting), value: e.value, log_file_hash: "", log_line: null }
                : null,
              gap_closed: null,
            }
          : null,
      };
    }),
    explanation: s(g.explanation),
  };
}

const FILE_KIND = (p: string): T.RunFileKind => {
  if (p.startsWith("tests/")) return "test";
  if (p.startsWith("logs/")) return "log";
  if (p.endsWith("metrics.json")) return "metrics";
  if (p.endsWith(".ipynb")) return "notebook";
  if (/\.(ya?ml|toml|ini|cfg)$/.test(p) || p.startsWith("configs/")) return "config";
  if (/\.(pt|pth|ckpt|pkl)$/.test(p)) return "model";
  if (/\.(py|r|R|sh)$/.test(p)) return "code";
  return "other";
};

export function toFile(raw: unknown): T.RunFile {
  const f = isObj(raw) ? raw : {};
  const path = String(f.path ?? "");
  return { path, kind: FILE_KIND(path), size_bytes: num(f.size ?? f.size_bytes), editable: f.editable === true };
}

const SANDBOX_STATUS = new Set(["queued", "running", "succeeded", "failed", "timed_out", "cancelled", "error"]);
const METRICS_STATUS = new Set(["valid", "invalid", "missing", "not_collected"]);

export function toSandboxExecution(raw: unknown): T.SandboxExecution {
  const e = isObj(raw) ? raw : {};
  const lim = isObj(e.limits) ? e.limits : {};
  const nano = num(lim.nano_cpus);
  return {
    id: id(e.id),
    run_id: id(e.run_id),
    phase: String(e.phase ?? ""),
    status: (SANDBOX_STATUS.has(String(e.status)) ? e.status : "error") as T.SandboxExecStatus,
    source: e.source === "user" ? "user" : "agent",
    agent: String(e.agent ?? ""),
    attempt: num(e.attempt) ?? 1,
    entrypoint: s(e.entrypoint),
    command: String(e.command ?? ""),
    exit_code: num(e.exit_code),
    timed_out: e.timed_out === true,
    cancelled: e.cancelled === true,
    duration_ms: num(e.duration_ms),
    started_at: s(e.started_at),
    finished_at: s(e.finished_at),
    log_hash: s(e.log_hash),
    code_version: s(e.code_version),
    error: s(e.error),
    metrics_status: (METRICS_STATUS.has(String(e.metrics_status)) ? e.metrics_status : "not_collected") as T.SandboxExecution["metrics_status"],
    metrics_error: s(e.metrics_error),
    artifacts: arr(e.artifacts).filter(isObj).map((a) => ({
      path: String(a.path ?? ""),
      kind: String(a.kind ?? "other"),
      format: s(a.format),
      size: num(a.size),
      verified: typeof a.verified === "boolean" ? a.verified : null,
      error: s(a.error),
    })),
    // Only numbers the backend recorded from the executed program; never filled in here.
    metrics: arr(e.metrics).filter(isObj).filter((m) => num(m.value) !== null).map((m) => ({
      id: id(m.id),
      name: String(m.name ?? ""),
      value: m.value as number,
      log_line: num(m.log_line),
      log_line_text: s(m.log_line_text),
    })),
    limits: { cpus: nano === null ? null : nano / 1e9, memory_bytes: num(lim.memory_bytes), pids: num(lim.pids) },
  };
}

export function toSandboxHealth(raw: unknown): T.SandboxHealth {
  const h = isObj(raw) ? raw : {};
  const lim = isObj(h.limits) ? h.limits : {};
  return {
    available: h.available === true,
    image: String(h.image ?? ""),
    image_present: h.image_present === true,
    error: s(h.error),
    limits: { cpus: num(lim.cpus), memory_bytes: num(lim.memory_bytes), pids: num(lim.pids), timeout_sec: num(lim.timeout_sec), network: s(lim.network) },
  };
}

const HEAL_STATUS = new Set(["queued", "running", "fixed", "failed", "error"]);
const REPAIR_STATUS = new Set(["running", "fixed", "still_failing", "tests_failed", "no_fix", "sandbox_error"]);

export function toHfPlan(raw: unknown): T.HfPlan {
  const p = isObj(raw) ? raw : {};
  return {
    configured: p.configured === true,
    files: arr(p.files).filter(isObj).map((f) => ({ path: String(f.path ?? ""), size: num(f.size) ?? 0, sha256: String(f.sha256 ?? ""),
      kind: String(f.kind ?? ""), required: f.required === true })),
    excluded: arr(p.excluded).filter(isObj).map((x) => ({ path: String(x.path ?? ""), reason: String(x.reason ?? "") })),
    blockers: arr(p.blockers).map(String),
    model_card: String(p.model_card ?? ""),
    suggested_repo: String(p.suggested_repo ?? ""),
    total_bytes: num(p.total_bytes) ?? 0,
  };
}

const HF_STATUS = new Set(["queued", "uploading", "succeeded", "failed"]);

export function toHfPublication(raw: unknown): T.HfPublication {
  const p = isObj(raw) ? raw : {};
  return {
    id: id(p.id),
    repo_name: String(p.repo_name ?? ""),
    repo_id: String(p.repo_id ?? ""),
    private: p.private === true,
    status: (HF_STATUS.has(String(p.status)) ? p.status : "failed") as T.HfPublication["status"],
    stage: String(p.stage ?? ""),
    files_done: num(p.files_done) ?? 0,
    files_total: num(p.files_total) ?? 0,
    bytes_done: num(p.bytes_done) ?? 0,
    bytes_total: num(p.bytes_total) ?? 0,
    // A link only exists once the Hub confirmed the upload.
    repo_url: p.status === "succeeded" ? String(p.repo_url ?? "") : "",
    commit_url: p.status === "succeeded" ? String(p.commit_url ?? "") : "",
    error: String(p.error ?? ""),
    created_at: s(p.created_at),
  };
}

export function toHealSession(raw: unknown): T.HealSession {
  const h = isObj(raw) ? raw : {};
  return {
    id: id(h.id),
    status: (HEAL_STATUS.has(String(h.status)) ? h.status : "error") as T.HealStatus,
    message: String(h.message ?? ""),
    max_attempts: num(h.max_attempts) ?? 3,
    created_at: s(h.created_at),
    attempts: arr(h.attempts).filter(isObj).map((a) => ({
      id: id(a.id),
      attempt: num(a.attempt) ?? 1,
      error_summary: String(a.error_summary ?? ""),
      error_text: String(a.error_text ?? ""),
      fix_source: String(a.fix_source ?? ""),
      explanation: String(a.explanation ?? ""),
      diff: String(a.diff ?? ""),
      files: arr(a.files).map(String),
      exec_id: a.exec_id == null ? null : id(a.exec_id),
      tests: isObj(a.tests) ? (a.tests as T.RepairAttempt["tests"]) : {},
      status: (REPAIR_STATUS.has(String(a.status)) ? a.status : "running") as T.RepairStatus,
    })),
  };
}

export function toLogChunk(raw: unknown): T.LogChunk {
  const l = isObj(raw) ? raw : {};
  const offset = num(l.offset) ?? 0;
  return {
    content: typeof l.content === "string" ? l.content : "",
    offset,
    next_offset: num(l.next_offset) ?? offset,
    size: num(l.size) ?? 0,
    complete: l.complete === true,
    status: SANDBOX_STATUS.has(String(l.status)) ? (l.status as T.SandboxExecStatus) : null,
  };
}

export function toTests(raw: unknown, runId: string): T.TestReport {
  const r = isObj(raw) ? raw : {};
  return {
    run_id: runId,
    tests: arr(r.tests).filter(isObj).map((t, i) => ({
      id: `${String(t.file)}::${String(t.name)}::${i}`,
      name: String(t.name ?? ""),
      kind: t.kind === "claim" ? "claim" : "correctness",
      status: (["passed", "failed", "skipped", "error"].includes(String(t.status)) ? t.status : "error") as T.TestCase["status"],
      duration_ms: num(t.duration_ms),
      message: s(t.message),
      claim_id: null,
      file: s(t.file),
    })),
  };
}

export function toMemoryItem(raw: unknown): T.MemoryItem {
  const m = isObj(raw) ? raw : {};
  return {
    id: id(m.id),
    kind: m.kind as T.MemoryKind,
    text: String(m.text ?? ""),
    details: isObj(m.details) ? m.details : {},
    times_used: num(m.times_used) ?? 0,
    success_rate: num(m.success_rate),
    source_run_id: m.source_run_id == null ? null : id(m.source_run_id),
    created_at: s(m.created_at) ?? undefined,
    similarity: num(m.similarity),
  };
}

export function toRunMemory(raw: unknown): T.RunMemory {
  const r = isObj(raw) ? raw : {};
  return {
    learned: arr(r.learned).map(toMemoryItem),
    reused: arr(r.reused).filter(isObj).map((x) => ({
      item: toMemoryItem(x.item),
      used_at: String(x.used_at ?? ""),
      event_id: x.event_id == null ? null : id(x.event_id),
      agent: s(x.agent),
    })),
  };
}

/* ── Publishing / sharing ── */

const PUSH_STATUS: Record<string, T.PushStatus> = {
  pending: "pending",
  pushing: "pushing",
  blocked: "blocked",
  done: "succeeded",
  failed: "failed",
};

export function toPush(raw: unknown): T.Push {
  const p = isObj(raw) ? raw : {};
  const scan = isObj(p.secret_scan_result) ? p.secret_scan_result : null;
  const findings = scan ? arr(scan.findings).filter(isObj) : [];
  return {
    id: id(p.id ?? p.push_id),
    run_id: id(p.run_id),
    repo_url: s(p.repo_url),
    commit_urls: arr(p.commit_urls).filter(isObj).map((c) => ({
      message: String(c.message ?? ""),
      url: String(c.url ?? ""),
      branch: s(c.branch),
    })),
    status: PUSH_STATUS[String(p.status)] ?? "pending",
    secret_scan_result:
      scan && "clean" in scan
        ? {
            passed: scan.clean === true,
            findings: findings.map((f) => ({
              file: String(f.file ?? ""),
              line: Number(f.line ?? 0),
              rule: String(f.rule ?? ""),
              description: s(f.description) ?? undefined,
            })),
          }
        : null,
    error: s(p.error),
    created_at: s(p.created_at) ?? undefined,
  };
}

export function toShareLink(raw: unknown): T.ShareLink & { qr_png_base64?: string } {
  const r = isObj(raw) ? raw : {};
  return {
    token: String(r.token ?? ""),
    expires_at: s(r.expires_at),
    url: s(r.url) ?? undefined,
    qr_png_base64: s(r.qr_png_base64) ?? undefined,
  };
}

export function toSharedView(raw: unknown): T.SharedView & { runs: T.Run[] } {
  const r = isObj(raw) ? raw : {};
  const runs = arr(r.runs).map(toRun); // newest first
  return { workspace: toWorkspace(r.workspace), run: runs[0] ?? null, runs, expires_at: null };
}

export interface AgentInfo {
  id: string;
  group: string;
  name: string;
  description: string;
}

export function toAgents(raw: unknown): (T.Agent & { description: string; group: string })[] {
  return arr(raw)
    .filter(isObj)
    .map((a) => ({
      id: id(a.id),
      name: String(a.name ?? a.id ?? ""),
      kind: "core" as const,
      stage: "active" as const,
      current_version_id: null,
      event_key: String(a.id ?? ""),
      description: String(a.description ?? ""),
      group: String(a.group ?? ""),
    }));
}
