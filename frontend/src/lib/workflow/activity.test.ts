import { describe, expect, it } from "vitest";
import type { RunEvent, RunFile } from "@/lib/api/types";
import { agentActivity, buildExecutions, buildIncidents, buildTree, locationsIn, narrate, redact } from "./activity";
import { detectLang, highlightLine } from "./highlight";

let n = 0;
const ev = (agent: string, rawType: string, message = rawType, links: Record<string, string> = {}, cost?: RunEvent["cost"]): RunEvent => ({
  id: String(++n), run_id: "1", time: new Date(1_700_000_000_000 + n * 4000).toISOString(), agent, type: rawType, message, links, cost, data: { rawType },
});

describe("narrate", () => {
  it("labels known events, keeps the agent's own sentence, hides heartbeats", () => {
    const e = narrate(ev("research.paper_reader", "claims_found", "Claims List: 3 claims in 'X'"));
    expect(e?.title).toBe("Claims found in the paper");
    expect(e?.detail).toBe("Claims List: 3 claims in 'X'");
    expect(e?.category).toBe("research");
    expect(narrate({ ...ev("system", "heartbeat"), type: "heartbeat", data: { rawType: "heartbeat" } })).toBeNull();
  });

  it("moves stack traces behind technical details", () => {
    const e = narrate(ev("coding.reviewer", "error_seen", "Error: ImportError: numpy 2", { signature: "ImportError: numpy 2" }));
    expect(e?.category).toBe("debug");
    expect(e?.mood).toBe("error");
    expect(e?.technical).toContain("ImportError");
    expect(e?.title).toBe("An error was detected");
  });

  it("never invents a title for unknown events: it uses the message", () => {
    expect(narrate(ev("system", "something_new", "Something new happened"))?.title).toBe("Something new happened");
  });
});

describe("agentActivity", () => {
  it("derives status and duration only from start/finish events", () => {
    const events = [ev("research.paper_reader", "agent_started"), ev("research.paper_reader", "claims_found", "3 claims"), ev("research.paper_reader", "agent_finished")];
    const a = agentActivity(events, "research.paper_reader");
    expect(a.status).toBe("done");
    expect(a.durationSec).toBe(8);
    expect(a.findings).toHaveLength(1);
    expect(agentActivity(events, "research.source_finder").status).toBe("waiting");
    expect(agentActivity([ev("research.paper_reader", "agent_started")], "research.paper_reader", true).status).toBe("stopped");
  });
});

describe("executions and incidents", () => {
  const log = { exec_id: "7", log: "logs/execute-7.log" };
  it("pairs sandbox start and finish by execution id", () => {
    const x = buildExecutions([
      ev("sandbox", "sandbox_started", "Sandbox execute: python src/train.py", log),
      ev("sandbox", "sandbox_finished", "Sandbox execute ok in 3.0s", { ...log, exit_code: "0" }, { sandbox_seconds: 3 }),
      ev("sandbox", "sandbox_started", "Sandbox install: pip install x", { exec_id: "8", log: "logs/install-8.log" }),
    ]);
    expect(x[0]).toMatchObject({ phase: "execute", command: "python src/train.py", exitCode: 0, running: false, durationSec: 3 });
    expect(x[1]).toMatchObject({ phase: "install", running: true, exitCode: null });
  });

  it("an incident is only 'verified' after a later sandbox run exits 0", () => {
    const base = [ev("coding.reviewer", "error_seen", "Error: ModuleNotFoundError", { signature: "ModuleNotFoundError" }), ev("coding.reviewer", "fix_applied", "Fix: pin numpy<2", { from_memory: "true" })];
    expect(buildIncidents(base)[0]!.status).toBe("fix_applied");
    expect(buildIncidents(base)[0]!.fixes[0]!.fromMemory).toBe(true);
    expect(buildIncidents([...base, ev("sandbox", "sandbox_finished", "ok", { exit_code: "0" })])[0]!.status).toBe("verified");
    expect(buildIncidents([...base, ev("sandbox", "sandbox_finished", "bad", { exit_code: "1" })])[0]!.status).toBe("failed");
    expect(buildIncidents(base, true)[0]!.status).toBe("failed");
  });

  it("finds failing file and line in tracebacks", () => {
    expect(locationsIn('Traceback...\n  File "/work/src/train.py", line 42, in main')).toEqual([{ file: "src/train.py", line: 42 }]);
  });
});

describe("file tree", () => {
  const files: RunFile[] = [
    { path: "src/train.py", kind: "code", size_bytes: 10 },
    { path: "README.md", kind: "other", size_bytes: 5 },
    { path: "src/models.py", kind: "code", size_bytes: 7 },
  ];
  it("nests folders first and flags new / modified files against a previous snapshot", () => {
    const prev = new Map<string, number | null>([["src/train.py", 8], ["README.md", 5]]);
    const t = buildTree(files, prev);
    expect(t.map((x) => x.name)).toEqual(["src", "README.md"]);
    const src = t[0]!.children;
    expect(src.find((c) => c.name === "train.py")!.change).toBe("modified");
    expect(src.find((c) => c.name === "models.py")!.change).toBe("new");
    expect(buildTree(files, null).every((x) => x.change === null)).toBe(true);
  });
});

describe("redact and highlight", () => {
  it("hides credentials in logs", () => {
    expect(redact("key=gsk_abcdefghijklmnopqrstuvwx and token: ghp_abcdefghijklmnopqrstuvwxyz0123")).not.toMatch(/gsk_abc|ghp_abc/);
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("[redacted]");
  });
  it("tokenises python and detects languages", () => {
    expect(detectLang("src/train.py")).toBe("python");
    expect(detectLang("configs/config.yaml")).toBe("yaml");
    const toks = highlightLine("def train(x):  # go", "python");
    expect(toks.find((t) => t.text === "def")?.kind).toBe("kw");
    expect(toks.find((t) => t.text === "train")?.kind).toBe("fn");
    expect(toks.find((t) => t.text.startsWith("# go"))?.kind).toBe("com");
    expect(toks.map((t) => t.text).join("")).toBe("def train(x):  # go");
  });
});
