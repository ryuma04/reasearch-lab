import type { ClaimStatus, ComputeBudget, PushStatus, RunStatus, SettingSource, WhatIfStatus, AgentStage } from "@/lib/api/types";
import type { AgentStatus } from "@/lib/run-state";
import type { Tone } from "@/components/ui/primitives";

/** §26: grey = waiting, blue = working, green = done/matched, amber = close/assumption, red = problem/different. */
export const agentStatusMeta: Record<AgentStatus, { label: string; tone: Tone; dot: "faint" | "sky" | "mint" | "sun" | "pink" | "purple" }> = {
  waiting: { label: "Waiting", tone: "faint", dot: "faint" },
  working: { label: "Working", tone: "sky", dot: "sky" },
  done: { label: "Done", tone: "mint", dot: "mint" },
  blocked: { label: "Needs help", tone: "sun", dot: "sun" },
  failed: { label: "Problem", tone: "pink", dot: "pink" },
  awaiting_approval: { label: "Awaiting approval", tone: "purple", dot: "purple" },
  paused: { label: "Paused", tone: "sun", dot: "sun" },
  stopped: { label: "Stopped", tone: "faint", dot: "faint" },
};

export const runStatusMeta: Record<RunStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "faint" },
  running: { label: "Running", tone: "sky" },
  waiting_approval: { label: "Awaiting approval", tone: "purple" },
  paused: { label: "Paused", tone: "sun" },
  succeeded: { label: "Finished", tone: "mint" },
  failed: { label: "Failed", tone: "pink" },
  stopped: { label: "Stopped", tone: "faint" },
};

export const claimStatusMeta: Record<ClaimStatus | "unverified", { label: string; tone: Tone }> = {
  match: { label: "Match", tone: "mint" },
  close: { label: "Close", tone: "sun" },
  different: { label: "Different", tone: "pink" },
  unverified: { label: "Unverified", tone: "faint" },
};

/** Hero 4 colours: green paper, blue official code, orange assumption, red compute change. */
export const settingSourceMeta: Record<SettingSource, { label: string; tone: Tone; dot: string }> = {
  paper: { label: "From the paper", tone: "mint", dot: "bg-success" },
  official_code: { label: "From official code", tone: "sky", dot: "bg-info" },
  assumption: { label: "Our assumption", tone: "sun", dot: "bg-warning" },
  compute_change: { label: "Changed to fit compute", tone: "pink", dot: "bg-danger" },
};

export const whatIfStatusMeta: Record<WhatIfStatus, { label: string; tone: Tone }> = {
  proposed: { label: "Suggested — needs approval", tone: "lavender" },
  queued: { label: "Queued", tone: "faint" },
  running: { label: "Running", tone: "sky" },
  stopped_early: { label: "Stopped early", tone: "faint" },
  done: { label: "Done", tone: "mint" },
  failed: { label: "Failed", tone: "pink" },
};

export const pushStatusMeta: Record<PushStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "faint" },
  scanning: { label: "Scanning for secrets", tone: "sky" },
  blocked: { label: "Blocked — secrets found", tone: "pink" },
  pushing: { label: "Pushing via n8n", tone: "sky" },
  succeeded: { label: "Published", tone: "mint" },
  failed: { label: "Failed", tone: "pink" },
};

export const agentStageMeta: Record<AgentStage, { label: string; tone: Tone }> = {
  trial: { label: "Trial", tone: "sky" },
  active: { label: "Active", tone: "mint" },
  refined: { label: "Refined", tone: "lavender" },
  merged: { label: "Merged", tone: "cream" },
  replaced: { label: "Replaced", tone: "sun" },
  retired: { label: "Retired", tone: "faint" },
};

export const BUDGETS: { key: ComputeBudget; label: string; hint: string }[] = [
  { key: "quick", label: "Quick", hint: "about 5 minutes · laptop CPU" },
  { key: "standard", label: "Standard", hint: "about 15 minutes · laptop CPU" },
  { key: "deep", label: "Deep", hint: "Kaggle GPU · free quota" },
];

export const budgetLabel = (b: ComputeBudget | undefined | null) => BUDGETS.find((x) => x.key === b)?.label ?? "—";
