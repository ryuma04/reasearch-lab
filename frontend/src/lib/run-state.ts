/**
 * Event-sourced Live Agent Board state. Everything on the board is derived from
 * backend events (GET /runs/{id}/events + SSE) — no timers or fake progress.
 */
import type { RunEvent, RunStage } from "@/lib/api/types";

export type AgentStatus = "waiting" | "working" | "done" | "blocked" | "failed" | "awaiting_approval" | "paused" | "stopped";

export interface AgentCardState {
  /** Top-level agent key, e.g. "coding" for "coding.debugger". */
  key: string;
  status: AgentStatus;
  task: string | null;
  why: string | null;
  subAgent: string | null;
  progress: number | null;
  tokens: number;
  sandboxSeconds: number;
  lastEventAt: string | null;
  eventCount: number;
  errors: number;
  fixes: number;
  memoryFixes: number;
  links: Record<string, string>;
}

export interface PendingCheckpoint {
  name: string;
  message: string;
  why: string | null;
  agent: string;
  since: string;
  links: Record<string, string>;
}

export interface BoardState {
  stage: RunStage | null;
  /** True when stage came from an explicit stage_changed event (vs inferred). */
  stageExplicit: boolean;
  agents: AgentCardState[];
  pendingCheckpoints: PendingCheckpoint[];
  totals: { tokens: number; sandboxSeconds: number };
  finished: "succeeded" | "failed" | null;
  lastEventAt: string | null;
}

export const STAGES: { key: RunStage; label: string }[] = [
  { key: "research", label: "Research" },
  { key: "plan_approval", label: "Plan approval" },
  { key: "coding", label: "Coding" },
  { key: "testing", label: "Testing" },
  { key: "whatifs", label: "What-ifs" },
  { key: "push", label: "Push" },
];

const STAGE_SET = new Set<string>([...STAGES.map((s) => s.key), "done"]);

/** Canonical display order for core agents; dynamic specialists follow. */
const CORE_ORDER = ["manager", "research", "coding", "testing", "observer"];

export function agentKey(agent: string): string {
  return (agent.split(".")[0] ?? agent).trim() || "unknown";
}

export function eventKey(e: RunEvent): string {
  return e.id ?? `${e.time}|${e.agent}|${e.type}|${e.message}`;
}

/** Merge events, de-duplicating by id (or a content key) and sorting by time. */
export function mergeEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const seen = new Set(existing.map(eventKey));
  const added = incoming.filter((e) => {
    if (e.type === "heartbeat") return false;
    const k = eventKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!added.length) return existing;
  return [...existing, ...added].sort((a, b) => a.time.localeCompare(b.time));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function inferStage(e: RunEvent): RunStage | null {
  const k = agentKey(e.agent);
  if (e.type === "checkpoint_waiting") {
    const name = str(e.data?.checkpoint) ?? e.links?.checkpoint ?? "";
    if (name.includes("plan")) return "plan_approval";
    if (name.includes("push")) return "push";
  }
  if (e.type.startsWith("push_")) return "push";
  if (e.type.startsWith("whatif_")) return "whatifs";
  if (k === "research") return "research";
  if (k === "coding") return "coding";
  if (k === "testing") return "testing";
  return null;
}

function statusFromEvent(e: RunEvent, prev: AgentStatus): AgentStatus {
  const explicit = str(e.data?.status);
  if (explicit && ["waiting", "working", "done", "blocked", "failed", "awaiting_approval", "paused", "stopped"].includes(explicit)) {
    return explicit as AgentStatus;
  }
  switch (e.type) {
    case "agent_created":
      return "waiting";
    case "task_started":
    case "task_progress":
    case "fix_attempt":
    case "fix_applied":
    case "agent_resumed":
    case "sandbox_started":
    case "memory_reused":
      return "working";
    case "task_done":
    case "sandbox_finished":
      return "done";
    case "task_failed":
    case "error":
    case "run_failed":
      return "failed";
    case "needs_help":
      return "blocked";
    case "checkpoint_waiting":
      return "awaiting_approval";
    case "checkpoint_resolved":
      return "working";
    case "agent_paused":
      return "paused";
    case "agent_stopped":
      return "stopped";
    default:
      return prev === "waiting" ? "working" : prev;
  }
}

function emptyCard(key: string): AgentCardState {
  return {
    key,
    status: "waiting",
    task: null,
    why: null,
    subAgent: null,
    progress: null,
    tokens: 0,
    sandboxSeconds: 0,
    lastEventAt: null,
    eventCount: 0,
    errors: 0,
    fixes: 0,
    memoryFixes: 0,
    links: {},
  };
}

export function deriveBoard(events: RunEvent[]): BoardState {
  const cards = new Map<string, AgentCardState>();
  const checkpoints = new Map<string, PendingCheckpoint>();
  let stage: RunStage | null = null;
  let stageExplicit = false;
  let finished: BoardState["finished"] = null;
  const totals = { tokens: 0, sandboxSeconds: 0 };

  for (const e of events) {
    if (e.type === "heartbeat") continue;
    const key = agentKey(e.agent);
    const card = cards.get(key) ?? emptyCard(key);
    const sub = e.agent.includes(".") ? e.agent.slice(key.length + 1) : null;

    card.status = statusFromEvent(e, card.status);
    if (e.type !== "agent_created" || !card.task) card.task = e.message || card.task;
    card.why = e.why ?? card.why;
    card.subAgent = sub ?? card.subAgent;
    const p = e.data?.progress;
    card.progress = typeof p === "number" && p >= 0 && p <= 1 ? p : card.status === "done" ? null : card.progress;
    card.tokens += e.cost?.tokens ?? 0;
    card.sandboxSeconds += e.cost?.sandbox_seconds ?? 0;
    card.lastEventAt = e.time;
    card.eventCount += 1;
    if (e.type === "error" || e.type === "task_failed") card.errors += 1;
    if (e.type === "fix_applied") {
      card.fixes += 1;
      if (e.links?.memory_item) card.memoryFixes += 1;
    }
    for (const [k, v] of Object.entries(e.links ?? {})) if (v) card.links[k] = v;
    cards.set(key, card);

    totals.tokens += e.cost?.tokens ?? 0;
    totals.sandboxSeconds += e.cost?.sandbox_seconds ?? 0;

    if (e.type === "stage_changed") {
      const s = str(e.data?.stage) ?? e.links?.stage ?? null;
      if (s && STAGE_SET.has(s)) {
        stage = s as RunStage;
        stageExplicit = true;
      }
    } else if (!stageExplicit) {
      stage = inferStage(e) ?? stage;
    }

    if (e.type === "checkpoint_waiting") {
      const name = str(e.data?.checkpoint) ?? e.links?.checkpoint ?? "plan";
      checkpoints.set(name, {
        name,
        message: e.message,
        why: e.why ?? null,
        agent: e.agent,
        since: e.time,
        links: Object.fromEntries(Object.entries(e.links ?? {}).filter(([, v]) => !!v)) as Record<string, string>,
      });
    }
    if (e.type === "checkpoint_resolved") {
      const name = str(e.data?.checkpoint) ?? e.links?.checkpoint ?? "plan";
      checkpoints.delete(name);
    }
    if (e.type === "run_finished") {
      finished = "succeeded";
      stage = "done";
    }
    if (e.type === "run_failed") finished = "failed";
  }

  const agents = [...cards.values()].sort((a, b) => {
    const ia = CORE_ORDER.indexOf(a.key);
    const ib = CORE_ORDER.indexOf(b.key);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return (a.lastEventAt ?? "").localeCompare(b.lastEventAt ?? "");
  });

  return {
    stage,
    stageExplicit,
    agents,
    pendingCheckpoints: [...checkpoints.values()],
    totals,
    finished,
    lastEventAt: events.length ? events[events.length - 1]!.time : null,
  };
}

/** Events that describe the code repair loop (Coding tab "repair history"). */
export function repairHistory(events: RunEvent[]): RunEvent[] {
  return events.filter((e) => ["error", "fix_attempt", "fix_applied", "task_failed", "needs_help"].includes(e.type));
}
