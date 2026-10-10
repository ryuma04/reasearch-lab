import { describe, expect, it } from "vitest";
import * as A from "./adapters";

// Fixtures are copied from the Go handlers' actual response shapes (backend/internal/...).

describe("adapters (Go backend → UI types)", () => {
  it("unwraps POST /workspaces {workspace, uploads} and stringifies ids", () => {
    const ws = A.toWorkspace({ workspace: { id: 7, owner_id: 1, title: "Distillation", compute_budget: "quick", note: "", created_at: "t" }, uploads: [] });
    expect(ws.id).toBe("7");
    expect(ws.note).toBeNull();
  });

  it("builds workspace detail with runs oldest → newest", () => {
    const d = A.toWorkspaceDetail({
      workspace: { id: 7, title: "x", compute_budget: "quick" },
      uploads: [{ id: 3, workspace_id: 7, kind: "paper", path_or_url: "https://arxiv.org/abs/1503.02531", original_name: "" }],
      runs: [{ id: 12, workspace_id: 7, status: "completed", stage: "done" }, { id: 11, workspace_id: 7, status: "failed", stage: "coding" }],
      role: "owner",
    });
    expect(d.runs!.map((r) => r.id)).toEqual(["11", "12"]);
    expect(d.runs![1]!.status).toBe("succeeded");
    expect(d.uploads![0]!.kind).toBe("paper");
    expect(d.role).toBe("owner");
  });

  it("maps /me github status and comma scopes", () => {
    const me = A.toMe({ user: { id: 1, name: "A", email: "a@x.io", github_username: "" }, github: { connected: false, status: "never", scopes: "repo,user:email", default_repo: "" }, pushes: [] });
    expect(me.github.status).toBe("not_connected");
    expect(me.github.scopes).toEqual(["repo", "user:email"]);
    expect(me.github.default_repo).toBeNull();
  });

  it("maps backend event types to the board vocabulary and keeps checkpoint names", () => {
    const e = A.toEvent({ id: 5, run_id: 9, time: "t", agent: "coding.writer", type: "agent_started", message: "m", why: "", links: { map_nodes: [{ id: "n" }] }, cost: { tokens: 3 } });
    expect(e.type).toBe("task_started");
    expect(e.id).toBe("5");
    expect(e.links).toEqual({});
    const cp = A.toEvent({ id: 6, run_id: 9, time: "t", agent: "system", type: "checkpoint_waiting", message: "m", links: { checkpoint: "plan" } });
    expect(cp.data?.checkpoint).toBe("plan");
    const st = A.toEvent({ id: 7, run_id: 9, time: "t", agent: "system", type: "stage", message: "m", links: { stage: "gap" } });
    expect(st.type).toBe("stage_changed");
    expect(st.data?.stage).toBe("testing");
  });

  it("scorecard: uses `ours` with its proof, and never shows a status without a measured value", () => {
    const row = {
      id: 1, status: "different", difference: 7, explanation: "x",
      claim: { id: 2, paper_id: 3, description: "distilled", value: 74, tolerance: 0.1, page: 9, position_on_page: { x0: 10, y0: 20, x1: 30, y1: 40, page_width: 100, page_height: 200 } },
      ours: { id: 4, run_id: 9, name: "student_distilled_test_errors", value: 81, code_version: "a1b2", log_file: "logs/execute-3.log", log_file_hash: "sha256:x", log_line: 214, log_line_text: "test_errors: 81" },
    };
    const e = A.toScorecardEntry(row, "9");
    expect(e.metric?.value).toBe(81);
    expect(e.metric?.git_commit).toBe("a1b2");
    expect(e.metric?.log_excerpt).toBe("test_errors: 81");
    expect(e.status).toBe("different");
    expect(e.claim.position_on_page).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.1 });
    const missing = A.toScorecardEntry({ ...row, status: "missing", ours: null }, "9");
    expect(missing.metric).toBeNull();
    expect(missing.status).toBeNull();
  });

  it("push: done → succeeded and secret scan findings", () => {
    const p = A.toPush({ id: 3, run_id: 9, status: "blocked", commit_urls: [], secret_scan_result: { scanner: "builtin", clean: false, findings: [{ file: "src/x.py", line: 4, rule: "groq-api-key" }] } });
    expect(p.status).toBe("blocked");
    expect(p.secret_scan_result?.passed).toBe(false);
    expect(p.secret_scan_result?.findings[0]?.line).toBe(4);
    expect(A.toPush({ id: 1, status: "done" }).status).toBe("succeeded");
  });

  it("map unwraps graph and gap pairs experiments with differences", () => {
    const m = A.toMap({ run_id: 9, graph: { nodes: [{ id: "paper", kind: "paper", label: "Hinton", status: "done" }], edges: [{ from: "paper", to: "c1", label: "claims" }] } }, "9");
    expect(m.nodes[0]!.label).toBe("Hinton");
    expect(m.edges[0]!.from).toBe("paper");
    const g = A.toGap([{ claim_id: 2, differences: [{ setting: "epochs", label: "train longer", ours: "5", paper: "" }], experiments: [{ setting: "epochs", metric_id: 8, child_run_id: 13, value: 77 }], explanation: "e" }], "9");
    expect(g.differences[0]!.experiment?.metric?.value).toBe(77);
    expect(g.differences[0]!.paper).toBe("not stated");
  });
});
