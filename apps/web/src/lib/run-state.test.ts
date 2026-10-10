import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/lib/api/types";
import { deriveBoard, mergeEvents } from "./run-state";

const ev = (over: Partial<RunEvent>): RunEvent => ({ run_id: "r1", time: "2026-10-10T10:00:00Z", agent: "manager", type: "task_started", message: "m", ...over });

describe("mergeEvents", () => {
  it("de-duplicates by id, drops heartbeats and sorts by time", () => {
    const a = ev({ id: "1", time: "2026-10-10T10:00:02Z" });
    const b = ev({ id: "2", time: "2026-10-10T10:00:01Z" });
    const merged = mergeEvents([a], [b, a, ev({ id: "3", type: "heartbeat" })]);
    expect(merged.map((e) => e.id)).toEqual(["2", "1"]);
  });
  it("returns the same array when nothing new arrives", () => {
    const a = ev({ id: "1" });
    const list = [a];
    expect(mergeEvents(list, [a])).toBe(list);
  });
});

describe("deriveBoard", () => {
  it("groups sub-agents and derives status, costs, memory fixes and stage", () => {
    const board = deriveBoard([
      ev({ id: "1", agent: "coding.writer", type: "task_started", message: "Writing", cost: { tokens: 100 } }),
      ev({ id: "2", agent: "coding.debugger", type: "error", message: "boom", time: "2026-10-10T10:00:01Z" }),
      ev({ id: "3", agent: "coding.debugger", type: "fix_applied", message: "pinned", why: "seen before", links: { memory_item: "m_17" }, cost: { tokens: 50, sandbox_seconds: 2 }, time: "2026-10-10T10:00:02Z" }),
    ]);
    const coding = board.agents.find((a) => a.key === "coding")!;
    expect(coding.status).toBe("working");
    expect(coding.errors).toBe(1);
    expect(coding.memoryFixes).toBe(1);
    expect(coding.tokens).toBe(150);
    expect(coding.why).toBe("seen before");
    expect(board.stage).toBe("coding");
    expect(board.totals).toEqual({ tokens: 150, sandboxSeconds: 2 });
  });

  it("tracks pending checkpoints until resolved", () => {
    const waiting = deriveBoard([ev({ id: "1", type: "checkpoint_waiting", data: { checkpoint: "plan" }, message: "Approve plan" })]);
    expect(waiting.pendingCheckpoints.map((c) => c.name)).toEqual(["plan"]);
    expect(waiting.stage).toBe("plan_approval");
    const resolved = deriveBoard([
      ev({ id: "1", type: "checkpoint_waiting", data: { checkpoint: "plan" } }),
      ev({ id: "2", type: "checkpoint_resolved", data: { checkpoint: "plan" }, time: "2026-10-10T10:00:05Z" }),
    ]);
    expect(resolved.pendingCheckpoints).toHaveLength(0);
  });

  it("prefers explicit stage_changed over inference and never invents progress", () => {
    const b = deriveBoard([
      ev({ id: "1", type: "stage_changed", data: { stage: "testing" } }),
      ev({ id: "2", agent: "research", type: "task_started", time: "2026-10-10T10:00:01Z" }),
    ]);
    expect(b.stage).toBe("testing");
    expect(b.agents.every((a) => a.progress === null)).toBe(true);
  });
});
