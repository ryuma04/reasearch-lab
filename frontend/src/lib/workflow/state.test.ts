import { describe, expect, it } from "vitest";
import type { Run, RunCheckpoint, RunEvent } from "@/lib/api/types";
import { canOpen, deriveWorkflow } from "./state";

const run = (over: Partial<Run>): Run => ({
  id: "1", workspace_id: "1", parent_run_id: null, branch_name: "main", status: "running",
  started_at: null, finished_at: null, git_commit: null, ...over,
});
const cp = (name: string, status: RunCheckpoint["status"]): RunCheckpoint => ({
  id: name, run_id: "1", name, status, payload: {}, response: {}, created_at: "t", resolved_at: null,
});
let n = 0;
const ev = (rawType: string, links: Record<string, string> = {}): RunEvent => ({
  id: String(++n), run_id: "1", time: new Date(1_700_000_000_000 + n * 1000).toISOString(), agent: "coding.reviewer",
  type: rawType, message: rawType, links, data: { rawType },
});
const status = (s: ReturnType<typeof deriveWorkflow>, k: string) => s.stages.find((x) => x.key === k)!.status;

describe("workflow state machine", () => {
  it("queued run: research is active, everything else pending and locked", () => {
    const s = deriveWorkflow({ run: run({ status: "queued" }), checkpoints: [], events: [] });
    expect(status(s, "research")).toBe("active");
    expect(s.stages.filter((x) => x.key !== "research").every((x) => x.status === "pending" && !x.canOpen)).toBe(true);
    expect(s.current).toBe("research");
  });

  it("plan waiting: research done, plan awaiting approval, coding locked until approved", () => {
    const s = deriveWorkflow({ run: run({ status: "waiting_approval", stage: "plan_approval" }), checkpoints: [cp("plan", "pending")], events: [] });
    expect(status(s, "research")).toBe("done");
    expect(status(s, "plan")).toBe("awaiting");
    expect(status(s, "coding")).toBe("pending");
    expect(canOpen(s, "coding")).toBe(false);
    expect(s.current).toBe("plan");
    expect(s.awaiting?.name).toBe("plan");
  });

  it("approved plan unlocks coding even before the worker reports the coding stage", () => {
    const s = deriveWorkflow({ run: run({ stage: "plan_approval" }), checkpoints: [cp("plan", "approved")], events: [] });
    expect(status(s, "plan")).toBe("done");
    expect(status(s, "coding")).toBe("active");
    expect(s.current).toBe("coding");
  });

  it("an edited plan is reported as approved with edits", () => {
    const s = deriveWorkflow({ run: run({ stage: "coding" }), checkpoints: [cp("plan", "edited")], events: [] });
    expect(s.stages.find((x) => x.key === "plan")!.reason).toMatch(/edits/);
  });

  it("rejected plan: plan failed, coding never starts, run is terminal", () => {
    const s = deriveWorkflow({ run: run({ status: "stopped", stage: "plan_approval" }), checkpoints: [cp("plan", "rejected")], events: [] });
    expect(status(s, "plan")).toBe("failed");
    expect(status(s, "coding")).toBe("pending");
    expect(s.terminal).toBe("stopped");
    expect(s.current).toBe("results");
  });

  it("repair loop: debugging follows an unresolved error and finishes when a re-run succeeds", () => {
    const base = { run: run({ stage: "coding" }), checkpoints: [cp("plan", "approved")] };
    const open = deriveWorkflow({ ...base, events: [ev("error_seen"), ev("fix_applied")] });
    expect(status(open, "debugging")).toBe("active");
    expect(open.repairOpen).toBe(true);
    expect(open.current).toBe("debugging");
    const fixed = deriveWorkflow({ ...base, events: [ev("error_seen"), ev("fix_applied"), ev("sandbox_finished", { exit_code: "0" })] });
    expect(fixed.repairOpen).toBe(false);
    expect(status(fixed, "debugging")).toBe("done");
    expect(fixed.current).toBe("coding");
  });

  it("no errors: debugging is skipped once testing is reached", () => {
    const s = deriveWorkflow({ run: run({ stage: "testing" }), checkpoints: [cp("plan", "approved")], events: [ev("sandbox_finished", { exit_code: "0" })] });
    expect(status(s, "debugging")).toBe("skipped");
    expect(status(s, "coding")).toBe("done");
    expect(status(s, "testing")).toBe("active");
  });

  it("help checkpoint: coding and debugging wait for the researcher", () => {
    const s = deriveWorkflow({ run: run({ status: "waiting_approval", stage: "coding" }), checkpoints: [cp("plan", "approved"), cp("help", "pending")], events: [ev("error_seen")] });
    expect(status(s, "coding")).toBe("awaiting");
    expect(status(s, "debugging")).toBe("awaiting");
    expect(s.current).toBe("debugging");
  });

  it("long-run checkpoint waits in coding", () => {
    const s = deriveWorkflow({ run: run({ status: "waiting_approval", stage: "coding" }), checkpoints: [cp("plan", "approved"), cp("long_run", "pending")], events: [] });
    expect(status(s, "coding")).toBe("awaiting");
    expect(s.current).toBe("coding");
  });

  it("failed run keeps the failure visible on the stage it failed in", () => {
    const s = deriveWorkflow({ run: run({ status: "failed", stage: "coding" }), checkpoints: [cp("plan", "approved")], events: [ev("error_seen")] });
    expect(status(s, "coding")).toBe("failed");
    expect(status(s, "debugging")).toBe("failed");
    expect(status(s, "testing")).toBe("pending");
    expect(status(s, "results")).toBe("failed");
    expect(s.current).toBe("results");
  });

  it("succeeded run: every executed stage is done and results are open", () => {
    const s = deriveWorkflow({ run: run({ status: "succeeded", stage: "done" }), checkpoints: [cp("plan", "approved")], events: [] });
    expect(["research", "plan", "coding", "testing", "results"].every((k) => status(s, k) === "done")).toBe(true);
    expect(status(s, "debugging")).toBe("skipped");
    expect(s.current).toBe("results");
  });
});
