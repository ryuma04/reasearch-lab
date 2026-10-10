import { describe, expect, it } from "vitest";
import type { AgentActivity } from "./activity";
import { relate } from "./sequence";

const act = (id: string, status: AgentActivity["status"], startedAt: string | null, endedAt: string | null): AgentActivity => ({
  id, status, startedAt, endedAt, durationSec: null, latest: null, findings: [], events: 0, errors: 0, tokens: 0,
});

describe("agent sequence", () => {
  it("is sequential when the second agent started after the first finished", () => {
    const r = relate([act("a", "done", "2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"), act("b", "working", "2026-01-01T00:00:11Z", null)]);
    expect(r[0]).toEqual({ kind: "first" });
    expect(r[1]).toEqual({ kind: "after", agent: "a" });
  });
  it("is parallel when the second started while the first was still running", () => {
    const r = relate([act("a", "working", "2026-01-01T00:00:00Z", null), act("b", "working", "2026-01-01T00:00:05Z", null)]);
    expect(r[1]).toEqual({ kind: "parallel", agent: "a" });
    const r2 = relate([act("a", "done", "2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"), act("b", "working", "2026-01-01T00:00:05Z", null)]);
    expect(r2[1]).toEqual({ kind: "parallel", agent: "a" });
  });
  it("does not claim a measured relationship for an agent that has not started", () => {
    const r = relate([act("a", "working", "2026-01-01T00:00:00Z", null), act("b", "waiting", null, null)]);
    expect(r[1]).toEqual({ kind: "waiting", agent: "a", blocked: true });
    const r2 = relate([act("a", "done", "2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"), act("b", "waiting", null, null)]);
    expect(r2[1]).toMatchObject({ kind: "waiting", blocked: false });
  });
});
