import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __setTransport } from "@/lib/api/client";
import type { EndpointDef } from "@/lib/api/endpoints";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), useParams: () => ({}) }));

import { RequestChanges, changeRequestProblem } from "./request-changes";
import { CompareView } from "./compare-view";
import { PaperWorkspace } from "./paper-workspace";
import { VersionList } from "./version-list";

type Obj = Record<string, unknown>;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
function use(handler: (def: EndpointDef, url: string, body: unknown) => Response | undefined) {
  const calls: { key: string; url: string; body: unknown }[] = [];
  __setTransport((async (url: string, init: RequestInit, def: EndpointDef) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key: def.key, url, body });
    return handler(def, url, body) ?? json({}, 404);
  }) as never);
  return calls;
}
function show(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => { __setTransport(null); push.mockReset(); });

describe("RequestChanges", () => {
  it("rejects empty and too-short requests without calling the backend", () => {
    expect(changeRequestProblem("")).toMatch(/Describe/);
    expect(changeRequestProblem("fix")).toMatch(/few words/);
    expect(changeRequestProblem("add a regression test")).toBeNull();
    const calls = use(() => undefined);
    show(<RequestChanges runId="7" workspaceId="3" />);
    fireEvent.click(screen.getByRole("button", { name: /Request Changes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze Changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Describe what you want to change/);
    expect(calls).toHaveLength(0);
  });

  it("sends the typed text for the right run and opens the new version", async () => {
    const calls = use((def) => (def.key === "requestChange" ? json({ new_run_id: 12, created: true, change: { id: 1 } }, 201) : undefined));
    show(<RequestChanges runId="7" workspaceId="3" />);
    fireEvent.click(screen.getByRole("button", { name: /Request Changes/ }));
    expect(screen.getByText(/the current one stays exactly as it is/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What would you like to change?"), { target: { value: "  Use a modular monolith and add tests  " } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze Changes" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspaces/3/run/12"));
    const c = calls.find((x) => x.key === "requestChange")!;
    expect(c.url).toContain("/runs/7/changes");
    expect(c.body).toEqual({ request: "Use a modular monolith and add tests" });
  });

  it("shows the server's reason when the request is refused", async () => {
    use((def) => (def.key === "requestChange" ? json({ error: "Changes can be requested once a version has finished (this one is running)." }, 409) : undefined));
    show(<RequestChanges runId="7" workspaceId="3" />);
    fireEvent.click(screen.getByRole("button", { name: /Request Changes/ }));
    fireEvent.change(screen.getByLabelText("What would you like to change?"), { target: { value: "add three new tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze Changes" }));
    expect(await screen.findByText(/once a version has finished/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("VersionList and CompareView", () => {
  const versions = [{ run_id: 7, label: "Original", parent_run_id: null, status: "completed", stage: "push", error: "", created_at: "", finished_at: null, change: null, change_status: null },
    { run_id: 12, label: "Version 2", parent_run_id: 7, status: "failed", stage: "testing", error: "2 required tests failed", created_at: "", finished_at: null, change: "Use a modular monolith", change_status: "analyzed" }];

  it("lists each version with its own status, request and comparison link", async () => {
    use((def) => (def.key === "versions" ? json({ versions, current: 7 }) : undefined));
    show(<VersionList runId="7" workspaceId="3" />);
    expect(await screen.findByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("“Use a modular monolith”")).toBeInTheDocument();
    expect(screen.getByText("2 required tests failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Compare with the one I'm viewing/ })).toHaveAttribute("href", "/workspaces/3/compare?from=7&to=12");
  });

  it("shows old and new code with added and removed lines, and metrics not measured on one side", async () => {
    const result = { old: { run_id: 7, status: "completed", stage: "push", error: "" }, new: { run_id: 12, status: "completed", stage: "push", error: "" }, change: { request: "lower the learning rate" },
      files: [{ path: "src/train.py", status: "modified", added: 1, removed: 1, diff: ["  import json", "- lr = 0.05", "+ lr = 0.01"] }, { path: "tests/test_new.py", status: "added", added: 2, removed: 0, diff: ["+ def test_x():", "+     pass"] }],
      skipped: { "src/big.bin": "binary file" }, metrics: [{ name: "acc", old: 0.9, new: 0.95 }, { name: "new_metric", old: null, new: 1 }],
      scorecard: { old: { match: 1 }, new: { match: 2 } }, plan: { added: ["Add regression tests"], removed: [] }, note: "Differences are computed" };
    use((def, url) => (def.key === "compare" ? (url.includes("with=12") ? json(result) : undefined) : def.key === "versions" ? json({ versions, current: 7 }) : undefined));
    show(<CompareView workspaceId="3" from="7" to="12" />);
    expect(await screen.findByText(/Original \(old\) → Version 2 \(new\)/)).toBeInTheDocument();
    expect(screen.getByText("- lr = 0.05")).toBeInTheDocument();
    expect(screen.getByText("+ lr = 0.01")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
    expect(screen.getByText("not measured")).toBeInTheDocument();
    expect(screen.getByText(/Not compared: src\/big.bin \(binary file\)/)).toBeInTheDocument();
    expect(screen.getByText(/Added:/)).toBeInTheDocument();
  });

  it("says identical versions have identical code instead of inventing differences", async () => {
    use((def) => (def.key === "compare" ? json({ old: { run_id: 7, status: "completed" }, new: { run_id: 12, status: "completed" }, change: null, files: [], skipped: {}, metrics: [], scorecard: { old: {}, new: {} }, plan: { added: null, removed: null }, note: "n" }) : def.key === "versions" ? json({ versions, current: 7 }) : undefined));
    show(<CompareView workspaceId="3" from="7" to="12" />);
    expect(await screen.findByText(/identical code/)).toBeInTheDocument();
    expect(screen.getByText(/Neither version has recorded metrics/)).toBeInTheDocument();
  });
});

describe("PaperWorkspace", () => {
  const sections = [{ key: "overview", title: "Research overview", markdown: "# Research overview\n\nThe paper studied X." }, { key: "results", title: "Experimental setup and results", markdown: "# Results\n\n```mermaid\nflowchart LR\n A-->B\n```" }];

  it("offers to prepare the materials when none exist and queues generation once", async () => {
    let state: Obj = { status: "none", run_id: 7, sections: [] };
    const calls = use((def) => (def.key === "paper" ? json(state) : def.key === "generatePaper" ? (state = { status: "queued", run_id: 7, sections: [] }, json({ queued: true }, 202)) : undefined));
    show(<PaperWorkspace runId="7" />);
    fireEvent.click(await screen.findByRole("button", { name: /Prepare Research Paper Materials/ }));
    await waitFor(() => expect(calls.filter((c) => c.key === "generatePaper")).toHaveLength(1));
    expect(await screen.findByText(/Generating the materials/)).toBeInTheDocument();
  });

  it("renders sections, shows mermaid source, the version and what is missing in a partial package", async () => {
    use((def) => (def.key === "paper" ? json({ status: "partial", run_id: 12, sections, manifest: { generated_at: "2026-10-11T10:00:00+00:00", method: "assembled from recorded artifacts", completeness: { overview: "partial", results: "complete" }, missing: { overview: ["research gaps (Gap Explorer not run)"] } } }) : undefined));
    show(<PaperWorkspace runId="12" />);
    expect(await screen.findByText("The paper studied X.")).toBeInTheDocument();
    expect(screen.getByText(/Partial package/)).toBeInTheDocument();
    expect(screen.getByText(/research gaps \(Gap Explorer not run\)/)).toBeInTheDocument();
    expect(screen.getByText(/from run #12/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Experimental setup and results/ }));
    expect(await screen.findByText("Diagram source (Mermaid)")).toBeInTheDocument();
  });

  it("flags materials generated before the version changed as stale", async () => {
    use((def) => (def.key === "paper" ? json({ status: "ready", run_id: 7, stale: true, sections, manifest: { generated_at: "x", completeness: {}, missing: {} } }) : undefined));
    show(<PaperWorkspace runId="7" />);
    expect(await screen.findByText(/changed after the materials were generated/)).toBeInTheDocument();
  });
});
