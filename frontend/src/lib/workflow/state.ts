/**
 * Workflow state machine for the dedicated run tab.
 *
 * Everything here is DERIVED from server state: the run (status + stage), its checkpoints
 * (approvals) and its saved/live events. The frontend never marks a stage complete on its own;
 * a click can only request a change (approve, stop, …) and the stage moves when the backend says so.
 *
 * UI stages            Backend (agents/lab/graph.py)
 *   research           stage "research"
 *   plan               stage "plan_approval" + checkpoint "plan"
 *   coding             stage "coding" (+ checkpoints "long_run", "help")
 *   debugging          the repair loop inside "coding" (error_seen → fix_applied → re-run)
 *   testing            stages "testing" / "gap"
 *   results            terminal run (completed / failed / stopped)
 */
import type { RunCheckpoint, RunEvent, Run } from "@/lib/api/types";

export type StageKey = "research" | "plan" | "coding" | "debugging" | "testing" | "results";
export type StageStatus = "pending" | "active" | "awaiting" | "done" | "failed" | "stopped" | "skipped";

export interface StageInfo {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** One plain sentence: why the stage is in this state / what it is waiting for. */
  reason: string;
  /** Pending stages cannot be opened: their prerequisites are not met. */
  canOpen: boolean;
}

export const STAGE_ORDER: { key: StageKey; label: string }[] = [
  { key: "research", label: "Research & Planning" },
  { key: "plan", label: "Coding Plan" },
  { key: "coding", label: "Coding" },
  { key: "debugging", label: "Debugging" },
  { key: "testing", label: "Testing" },
  { key: "results", label: "Results" },
];

export interface WorkflowState {
  stages: StageInfo[];
  /** The stage the tab follows by default. */
  current: StageKey;
  terminal: "succeeded" | "failed" | "stopped" | null;
  /** The approval the researcher currently has to answer, if any. */
  awaiting: RunCheckpoint | null;
  errorCount: number;
  /** An error was detected and no re-run has succeeded since. */
  repairOpen: boolean;
  /** Highest backend stage reached: -1 queued, 0 research, 1 plan approval, 2 coding, 3 testing and later. */
  reached: number;
}

export const rawType = (e: RunEvent): string => (typeof e.data?.rawType === "string" ? e.data.rawType : e.type);

const BACKEND_RANK: Record<string, number> = { research: 0, plan_approval: 1, coding: 2, testing: 3, whatifs: 3, push: 3, done: 3 };

/** Latest error vs latest clean (exit code 0) sandbox run, from events. */
export function repairSignals(events: RunEvent[]) {
  let errors = 0;
  let lastError = -1;
  let lastClean = -1;
  events.forEach((e, i) => {
    const t = rawType(e);
    if (t === "error_seen") {
      errors += 1;
      lastError = i;
    }
    if (t === "sandbox_finished" && e.links?.exit_code === "0") lastClean = i;
  });
  return { errors, open: lastError > lastClean };
}

export function deriveWorkflow(input: { run: Run | null; checkpoints: RunCheckpoint[]; events: RunEvent[] }): WorkflowState {
  const { run, checkpoints, events } = input;
  const status = run?.status ?? "queued";
  const terminal = status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : status === "stopped" ? "stopped" : null;

  const plan = checkpoints.find((c) => c.name === "plan");
  const planResolved = plan?.status === "approved" || plan?.status === "edited";
  const planRejected = plan?.status === "rejected";
  const awaiting =
    [...checkpoints].reverse().find((c) => c.status === "pending") ?? null;

  let reached = run?.stage ? (BACKEND_RANK[run.stage] ?? -1) : -1;
  if (plan) reached = Math.max(reached, 1);
  if (planResolved) reached = Math.max(reached, 2);
  if (status === "succeeded") reached = 3;
  const late = run?.stage === "whatifs" || run?.stage === "push" || run?.stage === "done" || status === "succeeded";

  const sig = repairSignals(events);
  const hasErrors = sig.errors > 0;
  const stopWord = terminal === "failed" ? "failed" : "stopped";
  const endState = (s: "failed" | "stopped"): StageStatus => s;

  const stages: StageInfo[] = STAGE_ORDER.map(({ key, label }) => ({ key, label, status: "pending" as StageStatus, reason: "", canOpen: false }));
  const set = (key: StageKey, s: StageStatus, reason: string) => {
    const st = stages.find((x) => x.key === key)!;
    st.status = s;
    st.reason = reason;
    st.canOpen = s !== "pending";
  };

  // 1 Research & Planning
  if (reached >= 1) set("research", "done", "The Research Brief and claims are ready.");
  else if (terminal && terminal !== "succeeded") set("research", endState(stopWord), `The run ${stopWord} before research finished.`);
  else set("research", "active", status === "queued" ? "Queued: waiting for the agent worker to pick the run up." : "The research agents are reading the paper and finding sources.");

  // 2 Coding Plan
  if (planRejected) set("plan", "failed", "You rejected the plan, so the run stopped here.");
  else if (planResolved) set("plan", "done", plan?.status === "edited" ? "Approved with your edits." : "Approved.");
  else if (reached >= 1 && !terminal) set("plan", "awaiting", "Waiting for your approval. No code is written until you approve.");
  else if (reached >= 1) set("plan", endState(stopWord), `The run ${stopWord} while the plan was waiting for approval.`);
  else set("plan", "pending", "Starts when the research is finished.");

  // 3 Coding
  const codingOpen = planResolved && reached >= 2;
  if (!planResolved) set("coding", "pending", "Starts only after you approve the plan.");
  else if (reached >= 3) set("coding", "done", "The code ran and produced its results.");
  else if (terminal) set("coding", endState(stopWord), `The run ${stopWord} during coding.`);
  else if (awaiting && (awaiting.name === "long_run" || awaiting.name === "help")) {
    set("coding", "awaiting", awaiting.name === "help" ? "The agents need your help to continue." : "Choose how long the full run may take.");
  } else set("coding", "active", reached >= 2 ? "The agents are writing, installing and running the code in the sandbox." : "Approved: coding is starting.");

  // 4 Debugging (the repair loop inside coding)
  if (!planResolved) set("debugging", "pending", "Starts if the code hits an error.");
  else if (hasErrors && reached >= 3) set("debugging", "done", `${sig.errors} error${sig.errors === 1 ? "" : "s"} detected and handled.`);
  else if (reached >= 3) set("debugging", "skipped", "No errors needed repair.");
  else if (hasErrors && terminal) set("debugging", endState(stopWord), `The run ${stopWord} while repairing an error.`);
  else if (hasErrors && awaiting?.name === "help") set("debugging", "awaiting", "Automatic repair gave up; the agents need your help.");
  else if (hasErrors) set("debugging", sig.open ? "active" : "done", sig.open ? "An error was detected and a fix is being applied and re-run." : "The last error was fixed and verified.");
  else if (codingOpen) set("debugging", "pending", "Starts if the code hits an error.");

  // 5 Testing
  if (reached < 3) set("testing", terminal && terminal !== "succeeded" && codingOpen ? "pending" : "pending", "Starts after the code has run.");
  else if (late) set("testing", "done", "Tests ran and the Claim Scorecard is filled.");
  else if (terminal) set("testing", endState(stopWord), `The run ${stopWord} during testing.`);
  else set("testing", "active", "Writing and running tests, then scoring each claim.");

  // 6 Results (terminal run)
  if (terminal === "succeeded") set("results", "done", "The run finished. Everything shown is persisted.");
  else if (terminal) set("results", endState(stopWord), `The run ${stopWord}. See what was produced before that.`);
  else set("results", "pending", "Available when the run finishes.");

  let current: StageKey;
  if (terminal) current = "results";
  else if (stages.find((s) => s.key === "debugging")!.status === "awaiting") current = "debugging";
  else if (hasErrors && sig.open && reached === 2 && planResolved) current = "debugging";
  else {
    const live = [...stages].reverse().find((s) => (s.status === "active" || s.status === "awaiting") && s.key !== "debugging");
    current = live?.key ?? "research";
  }
  return { stages, current, terminal, awaiting, errorCount: sig.errors, repairOpen: sig.open, reached };
}

/** Whether a stage tab may be opened. Pending stages never can. */
export function canOpen(state: WorkflowState, key: StageKey): boolean {
  return state.stages.find((s) => s.key === key)?.canOpen ?? false;
}
