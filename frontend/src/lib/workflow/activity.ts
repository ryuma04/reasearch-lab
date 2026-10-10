/**
 * Presentation helpers that turn REAL events into readable UI. They only reclassify and label
 * what the backend reported; they never invent an event, a status or a number.
 */
import type { RunEvent, RunFile } from "@/lib/api/types";
import { rawType } from "./state";

/* ── Narration ── */

export type Category = "research" | "plan" | "coding" | "debug" | "test" | "system";
export type Mood = "info" | "ok" | "warn" | "error" | "wait";

export interface Narrated {
  id: string;
  time: string;
  agent: string;
  category: Category;
  mood: Mood;
  /** Plain-language headline for the event. */
  title: string;
  /** The agent's own sentence (already readable), shown under the headline when it adds information. */
  detail: string | null;
  /** Why the agent did it, as reported. */
  why: string | null;
  /** Raw technical text (log lines, stack traces): hidden behind "Show technical details". */
  technical: string | null;
  raw: string;
}

const TITLES: Record<string, { title: string; mood: Mood }> = {
  run_queued: { title: "Run accepted and queued", mood: "info" },
  stage: { title: "Moved to the next stage", mood: "info" },
  agent_started: { title: "Agent started a task", mood: "info" },
  agent_finished: { title: "Agent finished its task", mood: "ok" },
  agent_failed: { title: "An agent task failed", mood: "error" },
  progress: { title: "Progress update", mood: "info" },
  claims_found: { title: "Claims found in the paper", mood: "ok" },
  brief_ready: { title: "Research Brief is ready", mood: "ok" },
  plan_ready: { title: "Pipeline plan prepared", mood: "info" },
  assumption: { title: "A setting was chosen", mood: "info" },
  checkpoint_waiting: { title: "Waiting for your approval", mood: "wait" },
  checkpoint_resolved: { title: "You answered an approval", mood: "ok" },
  plan_edited: { title: "Plan edited by you", mood: "info" },
  budget_estimate: { title: "Run time estimated on this machine", mood: "info" },
  budget_choice: { title: "Run length chosen", mood: "info" },
  files_written: { title: "Code files were created", mood: "ok" },
  review: { title: "Code was reviewed against the brief", mood: "info" },
  sandbox_started: { title: "Sandbox execution started", mood: "info" },
  sandbox_finished: { title: "Sandbox execution finished", mood: "info" },
  error_seen: { title: "An error was detected", mood: "error" },
  fix_applied: { title: "A fix was applied", mood: "ok" },
  fix_failed: { title: "No automatic fix was found", mood: "error" },
  retrying: { title: "Retrying after a fix", mood: "info" },
  memory_saved: { title: "A fix was saved to Lab Memory", mood: "ok" },
  results_ready: { title: "Results recorded from the sandbox run", mood: "ok" },
  tests_written: { title: "Tests were written", mood: "ok" },
  tests_finished: { title: "Tests finished", mood: "info" },
  claim_scored: { title: "A claim was scored", mood: "info" },
  gap_differences: { title: "Differences from the paper's setup listed", mood: "info" },
  gap_experiment: { title: "A one-change experiment ran", mood: "info" },
  gap_explained: { title: "The gap was explained with evidence", mood: "ok" },
  gap_result: { title: "A gap experiment finished", mood: "info" },
  whatif_asked: { title: "What-if question received", mood: "info" },
  whatif_branch: { title: "A what-if branch started", mood: "info" },
  whatif_stopped: { title: "A branch was stopped early", mood: "info" },
  whatif_finished: { title: "A what-if branch finished", mood: "ok" },
  run_completed: { title: "The run finished", mood: "ok" },
  run_failed: { title: "The run failed", mood: "error" },
  run_stopped: { title: "The run was stopped", mood: "warn" },
  run_rejected: { title: "The plan was rejected", mood: "warn" },
  paused: { title: "Paused", mood: "warn" },
  resumed: { title: "Resumed", mood: "info" },
  stop_requested: { title: "Stop requested", mood: "warn" },
  retry_requested: { title: "Retry requested", mood: "info" },
  instruction_given: { title: "You gave an instruction", mood: "info" },
};

export function categoryOf(e: RunEvent): Category {
  const t = rawType(e);
  if (["error_seen", "fix_applied", "fix_failed", "retrying", "memory_saved"].includes(t)) return "debug";
  if (t.startsWith("checkpoint") && String(e.links?.checkpoint) === "plan") return "plan";
  if (t === "plan_edited" || t === "plan_ready") return "plan";
  if (e.agent.startsWith("research.")) return "research";
  if (e.agent.startsWith("coding.") || e.agent === "sandbox") return "coding";
  if (e.agent.startsWith("testing.") || e.agent === "gap_detective" || e.agent === "whatif") return "test";
  if (t === "brief_ready" || t === "claims_found") return "research";
  return "system";
}

/** Split a message into a short readable first line and technical remainder (stack traces, long logs). */
function splitTechnical(text: string): { head: string; tech: string | null } {
  const lines = text.split("\n");
  const head = lines[0]!.trim();
  const rest = lines.slice(1).join("\n").trim();
  const long = head.length > 220;
  return { head: long ? head.slice(0, 217) + "…" : head, tech: rest || (long ? head : null) };
}

export function narrate(e: RunEvent): Narrated | null {
  const t = rawType(e);
  if (t === "heartbeat") return null;
  const meta = TITLES[t];
  const { head, tech } = splitTechnical(e.message || "");
  const title = meta?.title ?? (head || "Update");
  // Messages already written for people are shown as detail; error signatures are technical.
  const isErr = t === "error_seen" || t === "fix_failed" || t === "agent_failed" || t === "run_failed";
  let detail: string | null = meta && head && head !== title ? head : null;
  let technical = tech;
  if (t === "error_seen") {
    detail = "The sandbox run reported an error. The Debugger is reading it.";
    technical = [e.links?.signature, e.message].filter(Boolean).join("\n");
  }
  if (isErr && !technical && head.length > 80) technical = head;
  return {
    id: e.id ?? `${e.time}|${e.agent}|${t}|${e.message}`,
    time: e.time,
    agent: e.agent,
    category: categoryOf(e),
    mood: meta?.mood ?? "info",
    title,
    detail,
    why: e.why || null,
    technical,
    raw: t,
  };
}

/* ── Per-agent activity ── */

export type AgentRun = "waiting" | "working" | "done" | "failed" | "stopped";

export interface AgentActivity {
  id: string;
  status: AgentRun;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  /** Latest meaningful update (not a bare start/finish). */
  latest: Narrated | null;
  /** Findings this agent reported (claims found, brief ready, files written, tests written, …). */
  findings: Narrated[];
  events: number;
  errors: number;
  tokens: number;
}

const FINDING_TYPES = new Set(["claims_found", "brief_ready", "files_written", "tests_written", "results_ready", "gap_explained", "review", "claim_scored", "memory_saved"]);

export function agentActivity(events: RunEvent[], id: string, runEnded = false): AgentActivity {
  const mine = events.filter((e) => e.agent === id || e.agent.startsWith(id + "."));
  let status: AgentRun = "waiting";
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let errors = 0;
  let tokens = 0;
  const findings: Narrated[] = [];
  let latest: Narrated | null = null;
  for (const e of mine) {
    const t = rawType(e);
    tokens += e.cost?.tokens ?? 0;
    if (t === "agent_started") {
      status = "working";
      startedAt ??= e.time;
      endedAt = null;
    } else if (t === "agent_finished") {
      status = "done";
      endedAt = e.time;
    } else if (t === "agent_failed") {
      status = "failed";
      endedAt = e.time;
      errors += 1;
    } else if (status === "waiting") {
      status = "working";
      startedAt ??= e.time;
    }
    if (t === "error_seen" || t === "fix_failed") errors += 1;
    const n = narrate(e);
    if (n && t !== "agent_started" && t !== "agent_finished") latest = n;
    if (n && FINDING_TYPES.has(t)) findings.push(n);
  }
  if (runEnded && status === "working") status = "stopped";
  const durationSec = startedAt && endedAt ? Math.max(0, (Date.parse(endedAt) - Date.parse(startedAt)) / 1000) : null;
  return { id, status, startedAt, endedAt, durationSec, latest, findings, events: mine.length, errors, tokens };
}

/* ── Sandbox executions (terminal) ── */

export interface Execution {
  execId: string;
  phase: string;
  command: string;
  logPath: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationSec: number | null;
  running: boolean;
  summary: string | null;
}

export function buildExecutions(events: RunEvent[]): Execution[] {
  const out = new Map<string, Execution>();
  for (const e of events) {
    const t = rawType(e);
    const execId = e.links?.exec_id;
    if (!execId || (t !== "sandbox_started" && t !== "sandbox_finished")) continue;
    const cur = out.get(execId) ?? {
      execId, phase: "", command: "", logPath: null, startedAt: e.time, finishedAt: null, exitCode: null, durationSec: null, running: true, summary: null,
    };
    if (e.links?.log) cur.logPath = e.links.log;
    if (t === "sandbox_started") {
      const m = /^Sandbox (\w+): ([\s\S]*)$/.exec(e.message);
      cur.phase = m?.[1] ?? cur.phase;
      cur.command = m?.[2] ?? cur.command;
      cur.startedAt = e.time;
    } else {
      cur.finishedAt = e.time;
      cur.running = false;
      cur.exitCode = e.links?.exit_code !== undefined ? Number(e.links.exit_code) : null;
      cur.durationSec = e.cost?.sandbox_seconds ?? (Date.parse(e.time) - Date.parse(cur.startedAt)) / 1000;
      cur.summary = e.message;
      if (!cur.phase) cur.phase = /^Sandbox (\w+)/.exec(e.message)?.[1] ?? "";
    }
    out.set(execId, cur);
  }
  return [...out.values()];
}

/** Hide anything that looks like a credential before it is rendered. */
export function redact(text: string): string {
  return text
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted github token]")
    .replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, "[redacted api key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted api key]")
    .replace(/\bsk-[A-Za-z0-9_-]{24,}\b/g, "[redacted api key]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/g, "$1[redacted]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S{6,}/gi, "$1[redacted]");
}

/* ── Debugging incidents ── */

export interface Incident {
  id: string;
  detectedAt: string;
  signature: string;
  details: string | null;
  /** Python frames named in the error text. */
  locations: { file: string; line: number }[];
  fixes: { time: string; message: string; fromMemory: boolean }[];
  noFixFound: boolean;
  retries: number;
  /** detected → fix_applied → verified (a later sandbox run exited 0) | failed (a later run still failed / run ended). */
  status: "detected" | "fix_applied" | "verified" | "failed";
  verifiedAt: string | null;
}

const FRAME = /File "([^"]+)", line (\d+)/g;
const INLINE = /([\w./\\-]+\.py):(\d+)/g;

export function locationsIn(text: string): { file: string; line: number }[] {
  const seen = new Set<string>();
  const out: { file: string; line: number }[] = [];
  for (const re of [FRAME, INLINE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = `${m[1]}:${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ file: m[1]!.replace(/^\/work\//, ""), line: Number(m[2]) });
      }
    }
  }
  return out.slice(0, 4);
}

export function buildIncidents(events: RunEvent[], runFailed = false): Incident[] {
  const list: Incident[] = [];
  const open = () => [...list].reverse().find((i) => i.status === "detected" || i.status === "fix_applied");
  for (const e of events) {
    const t = rawType(e);
    if (t === "error_seen") {
      const sig = (e.links?.signature || e.message.replace(/^Error:\s*/, "")).trim();
      list.push({
        id: e.id ?? e.time, detectedAt: e.time, signature: sig, details: e.message !== sig ? e.message : null,
        locations: locationsIn(`${sig}\n${e.message}`), fixes: [], noFixFound: false, retries: 0, status: "detected", verifiedAt: null,
      });
    } else if (t === "fix_applied") {
      const i = open();
      if (i) {
        i.fixes.push({ time: e.time, message: e.message, fromMemory: !!e.links?.from_memory || !!e.links?.memory_item });
        i.status = "fix_applied";
        i.noFixFound = false;
      }
    } else if (t === "fix_failed") {
      const i = open();
      if (i) i.noFixFound = true;
    } else if (t === "retrying") {
      const i = open();
      if (i) i.retries += 1;
    } else if (t === "sandbox_finished") {
      const code = e.links?.exit_code;
      for (const i of list) {
        if (i.status !== "fix_applied") continue;
        if (code === "0") {
          i.status = "verified";
          i.verifiedAt = e.time;
        } else if (code !== undefined) {
          i.status = "failed";
        }
      }
    }
  }
  if (runFailed) for (const i of list) if (i.status !== "verified") i.status = "failed";
  return list;
}

/* ── File explorer ── */

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  size: number | null;
  children: TreeNode[];
  change: "new" | "modified" | null;
}

/**
 * Build a folder tree from the flat file list. `previous` is the earlier snapshot of this tab
 * (path → size): files absent from it are "new", files whose size changed are "modified". No
 * snapshot (first load) means nothing is flagged.
 */
export function buildTree(files: RunFile[], previous: Map<string, number | null> | null): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, size: null, children: [], change: null };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === name && c.dir === !isFile);
      if (!next) {
        next = { name, path, dir: !isFile, size: isFile ? f.size_bytes : null, children: [], change: null };
        if (isFile && previous) {
          if (!previous.has(f.path)) next.change = "new";
          else if (previous.get(f.path) !== f.size_bytes) next.change = "modified";
        }
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}
