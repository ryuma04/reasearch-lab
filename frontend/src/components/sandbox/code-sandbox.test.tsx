import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __setTransport } from "@/lib/api/client";
import type { EndpointDef } from "@/lib/api/endpoints";
import type { RunStatus } from "@/lib/api/types";
import { CodeSandbox } from "./code-sandbox";

// Monaco needs a real browser (web workers, canvas measurements); jsdom gets a stand-in with the
// same props so the integration around it (open, edit, read-only, save) is what is tested.
vi.mock("@monaco-editor/react", () => ({
  default: (p: { path: string; value: string; language: string; options?: { readOnly?: boolean }; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" data-language={p.language} aria-label={`editor ${p.path}`} value={p.value}
      readOnly={p.options?.readOnly} onChange={(e) => p.onChange?.(e.target.value)} />
  ),
}));

const TRAIN = "import json\nprint('hello')\n";

type Exec = Record<string, unknown>;

/** A fake Go backend: records calls and serves state that each test controls. */
function fakeBackend() {
  const calls: { key: string; method: string; url: string; body: unknown }[] = [];
  const state = {
    health: { available: true, image: "tapu-sena/sandbox-python:latest", image_present: true, limits: { cpus: 2, memory_bytes: 4294967296, pids: 256, timeout_sec: 300 } } as Record<string, unknown>,
    files: [
      { path: "src/train.py", size: TRAIN.length, editable: true },
      { path: "configs/config.yaml", size: 10, editable: true },
      { path: "results/metrics.json", size: 40, editable: false },
      { path: "models/model.pt", size: 1000, editable: false },
    ] as Exec[],
    content: { "src/train.py": TRAIN, "configs/config.yaml": "seed: 0\n", "results/metrics.json": '{"metrics":{"test_errors":81}}' } as Record<string, string>,
    executions: [] as Exec[],
    log: "",
    stderr: "",
    startError: null as null | { status: number; error: string },
    heal: [] as Exec[],
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const transport = async (url: string, init: RequestInit, def: EndpointDef) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key: def.key, method: String(init.method), url, body });
    const u = new URL(url, "http://x");
    switch (def.key) {
      case "sandboxStatus": return json(state.health);
      case "files": return json(state.files);
      case "fileContent": return new Response(state.content[u.searchParams.get("path") ?? ""] ?? "", { headers: { "content-type": "text/plain" } });
      case "brief": return json({ papers: [{ id: 1, claims: [{ id: 3, metric_name: "test_errors", value: 74, page: 3, description: "distilled" }] }] });
      case "saveFile": state.content[body.path] = body.content; return json({ path: body.path, size: body.content.length });
      case "startExecution": {
        if (state.startError) return json({ error: state.startError.error }, state.startError.status);
        const e = { id: 41, run_id: 7, phase: "execute", status: "running", source: "user", attempt: state.executions.length + 1, command: `python -u ${body.entrypoint}`,
          entrypoint: body.entrypoint, started_at: new Date().toISOString(), metrics_status: "not_collected", artifacts: [], metrics: [] };
        state.executions.unshift(e);
        return json(e, 202);
      }
      case "listExecutions": return json(state.executions);
      case "getExecution": return json(state.executions.find((e) => String(e.id) === u.pathname.split("/").pop()) ?? {}, 200);
      case "executionLogs": {
        const text = u.searchParams.get("stream") === "stderr" ? state.stderr : state.log;
        const off = Number(u.searchParams.get("offset") ?? 0);
        const ex = state.executions[0];
        const done = ex ? ex.status !== "running" : true;
        return json({ content: text.slice(off), offset: off, next_offset: text.length, size: text.length, complete: done, status: ex?.status });
      }
      case "cancelExecution": {
        const ex = state.executions[0]!;
        Object.assign(ex, { status: "cancelled", cancelled: true, exit_code: -1, error: "cancelled by the researcher", duration_ms: 1500 });
        return json({ status: "cancelling" }, 202);
      }
      case "startHeal": {
        const sess = { id: 5, status: "running", message: "", max_attempts: 3, attempts: [] };
        state.heal.unshift(sess);
        return json(sess, 202);
      }
      case "listHeal": return json(state.heal);
      default: return json({ error: "not found" }, 404);
    }
  };
  return { calls, state, transport };
}

function renderSandbox(b: ReturnType<typeof fakeBackend>, runStatus: RunStatus = "waiting_approval") {
  __setTransport(b.transport as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CodeSandbox runId="7" runStatus={runStatus} /></QueryClientProvider>);
}

const finish = (b: ReturnType<typeof fakeBackend>, patch: Exec) => Object.assign(b.state.executions[0]!, patch);

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  __setTransport(null);
  vi.restoreAllMocks();
});

describe("CodeSandbox", () => {
  it("renders the Monaco editor with the project file and saves edits through the backend", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    const editor = await screen.findByLabelText("editor src/train.py");
    expect(editor).toHaveValue(TRAIN);
    expect(editor).toHaveAttribute("data-language", "python");
    expect(editor).not.toHaveAttribute("readonly");
    for (const folder of ["src/", "configs/", "tests/", "results/", "logs/"]) expect(screen.getByText(folder)).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: TRAIN + "print('edited')\n" } });
    const save = screen.getByRole("button", { name: /Save \(1\)/ });
    fireEvent.click(save);
    await waitFor(() => expect(b.calls.some((c) => c.key === "saveFile")).toBe(true));
    const put = b.calls.find((c) => c.key === "saveFile")!;
    expect(put.method).toBe("PUT");
    expect(put.body).toEqual({ path: "src/train.py", content: TRAIN + "print('edited')\n" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled());
  });

  it("opens results and logs read-only, and supports multiple tabs", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /metrics\.json/ }));
    const ro = await screen.findByLabelText("editor results/metrics.json");
    expect(ro).toHaveAttribute("readonly");
    expect(screen.getAllByRole("tab", { name: /train\.py|metrics\.json/ })).toHaveLength(2);
  });

  it("runs an experiment and shows the real running → success output, exit code, duration and measured metrics", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    const editor = await screen.findByLabelText("editor src/train.py");
    fireEvent.change(editor, { target: { value: TRAIN + "# tweak\n" } });
    b.state.log = "training teacher\n";
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));

    // Unsaved edits are saved before the run starts, and the selected entrypoint is sent.
    await waitFor(() => expect(b.calls.some((c) => c.key === "startExecution")).toBe(true));
    const keys = b.calls.map((c) => c.key);
    expect(keys.indexOf("saveFile")).toBeLessThan(keys.indexOf("startExecution"));
    expect(b.calls.find((c) => c.key === "startExecution")!.body).toMatchObject({ entrypoint: "src/train.py" });

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop execution/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("terminal-output")).toHaveTextContent("training teacher"));

    b.state.log += "student_distilled_test_errors: 81\n";
    finish(b, { status: "succeeded", exit_code: 0, duration_ms: 12_300, metrics_status: "valid", code_version: "a1b2c3",
      metrics: [{ id: 9, name: "test_errors", value: 81, log_line: 2, log_line_text: "student_distilled_test_errors: 81" }],
      artifacts: [{ path: "models/model.pt", kind: "model", format: "torch", size: 1000, verified: true }] });

    expect(await screen.findByText("Succeeded", {}, { timeout: 4000 })).toBeInTheDocument();
    const table = await screen.findByTestId("metrics-table", {}, { timeout: 4000 });
    const row = within(table).getByText("test_errors").closest("tr")!;
    expect(row).toHaveTextContent("81"); // measured by the run
    expect(row).toHaveTextContent("74"); // reported by the paper, in its own column
    expect(screen.getByText(/Took 12\.3 s/)).toBeInTheDocument();
    expect(screen.getByText("Loads OK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", expect.stringContaining("/runs/7/artifact?path=models%2Fmodel.pt"));
  });

  it("shows a failure with exit code, error and stderr", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    await screen.findByText("Running");
    b.state.log = "loading\nTraceback (most recent call last):\nValueError: shape mismatch\n";
    b.state.stderr = "Traceback (most recent call last):\nValueError: shape mismatch\n";
    finish(b, { status: "failed", exit_code: 1, duration_ms: 900, error: "the program exited with code 1" });
    expect(await screen.findByText("Failed", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText(/Failed with exit code 1\. the program exited with code 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Errors only" }));
    await waitFor(() => expect(screen.getByTestId("terminal-output")).toHaveTextContent("ValueError: shape mismatch"));
    expect(screen.getByTestId("terminal-output")).not.toHaveTextContent("loading");
  });

  it("shows a timeout", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    await screen.findByText("Running");
    finish(b, { status: "timed_out", timed_out: true, exit_code: -1, duration_ms: 300_000, error: "the time limit of 5m0s was reached" });
    expect(await screen.findByText("Timed out", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/hit the time limit/)).toBeInTheDocument();
  });

  it("cancels a running execution through the backend", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Stop execution/ }));
    await waitFor(() => expect(b.calls.some((c) => c.key === "cancelExecution" && c.url.includes("/sandbox/executions/41/cancel"))).toBe(true));
    expect(await screen.findByText(/Stopped by you/, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("explains when Docker is unavailable and does not start anything", async () => {
    const b = fakeBackend();
    b.state.health = { available: false, image_present: false, image: "x", error: "Docker is not available: cannot connect to the Docker daemon", limits: {} };
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    expect(await screen.findByText(/cannot connect to the Docker daemon/)).toBeInTheDocument();
    expect(screen.getByText("Sandbox unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Experiment/ })).toBeDisabled();
  });

  it("shows the backend's message when starting fails", async () => {
    const b = fakeBackend();
    b.state.startError = { status: 503, error: "Docker is not available, so code cannot run. Start Docker and try again." };
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    expect(await screen.findByText(/Docker is not available, so code cannot run/)).toBeInTheDocument();
  });

  it("is read-only while the agents are working, but still lists their attempts", async () => {
    const b = fakeBackend();
    b.state.executions = [
      { id: 12, status: "failed", source: "agent", agent: "coding.writer", attempt: 2, phase: "execute", exit_code: 1, error: "KeyError: 'lr'", duration_ms: 800, artifacts: [], metrics: [] },
      { id: 11, status: "failed", source: "agent", agent: "coding.writer", attempt: 1, phase: "execute", exit_code: 1, error: "No module named 'yaml'", duration_ms: 700, artifacts: [], metrics: [] },
    ];
    renderSandbox(b, "running");
    expect(await screen.findByLabelText("editor src/train.py")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /Run Experiment/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: /Attempts/ }));
    const list = await screen.findByTestId("attempts");
    expect(within(list).getByText("Attempt 2")).toBeInTheDocument();
    expect(within(list).getByText("Attempt 1")).toBeInTheDocument();
    expect(within(list).getByText("KeyError: 'lr'")).toBeInTheDocument();
  });

  async function failRun(b: ReturnType<typeof fakeBackend>) {
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    await screen.findByText("Running");
    b.state.stderr = "KeyError: 'lr'\n";
    finish(b, { status: "failed", exit_code: 1, duration_ms: 500, error: "the program exited with code 1" });
    return screen.findByRole("button", { name: /Fix with AI/ }, { timeout: 4000 });
  }

  it("fixes a failed run with AI and shows the error, explanation, diff and test results", async () => {
    const b = fakeBackend();
    fireEvent.click(await failRun(b));
    await waitFor(() => expect(b.calls.find((c) => c.key === "startHeal")?.body).toEqual({ exec_id: 41 }));
    expect(await screen.findByText("Fixing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Experiment/ })).toBeDisabled(); // nothing runs while it fixes
    Object.assign(b.state.heal[0]!, {
      status: "fixed", message: "Fixed on attempt 1: the patched code ran successfully in a fresh sandbox and 1 test(s) passed.",
      attempts: [{ id: 1, attempt: 1, status: "fixed", fix_source: "arina", error_summary: "KeyError: 'lr' (src/train.py line 3)",
        error_text: "Traceback\nKeyError: 'lr'", explanation: "The config key is learning_rate, not lr.",
        diff: "--- a/src/train.py\n+++ b/src/train.py\n@@ -3 +3 @@\n-lr = cfg[\"lr\"]\n+lr = cfg[\"learning_rate\"]\n",
        tests: { total: 1, passed: 1, failed: 0 } }],
    });
    expect(await screen.findByText("Fixed", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Arina AI")).toBeInTheDocument();
    expect(screen.getByText("KeyError: 'lr' (src/train.py line 3)")).toBeInTheDocument();
    expect(screen.getByText("The config key is learning_rate, not lr.")).toBeInTheDocument();
    expect(screen.getByTestId("diff")).toHaveTextContent('+lr = cfg["learning_rate"]');
    expect(screen.getByText("Tests: 1 passed, 0 failed")).toBeInTheDocument();
  });

  it("shows the remaining error when 3 fixes did not work, without claiming success", async () => {
    const b = fakeBackend();
    fireEvent.click(await failRun(b));
    await screen.findByText("Fixing");
    const att = (n: number) => ({ id: n, attempt: n, status: "still_failing", fix_source: "arina", error_summary: `ValueError: bad shape ${n}`,
      explanation: "try", diff: "-a\n+b\n", tests: {} });
    Object.assign(b.state.heal[0]!, { status: "failed", message: "Not fixed after 3 attempts. Remaining error: ValueError: bad shape 3",
      attempts: [att(1), att(2), att(3)] });
    expect(await screen.findByText("Not fixed", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByTestId("heal-message")).toHaveTextContent("Remaining error: ValueError: bad shape 3");
    expect(screen.getAllByTestId("repair-attempt")).toHaveLength(3);
    expect(screen.getAllByText("Still failing")).toHaveLength(3);
    expect(screen.queryByText("Fixed")).not.toBeInTheDocument();
  });

  it("offers no AI fix for sandbox errors", async () => {
    const b = fakeBackend();
    renderSandbox(b);
    await screen.findByLabelText("editor src/train.py");
    fireEvent.click(screen.getByRole("button", { name: /Run Experiment/ }));
    await screen.findByText("Running");
    finish(b, { status: "error", exit_code: -1, error: "Docker is not available" });
    expect(await screen.findByText("Sandbox error", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fix with AI/ })).not.toBeInTheDocument();
  });

  it("explains that code appears after the Coding Agent runs", async () => {
    const b = fakeBackend();
    b.state.files = [{ path: "research/brief.md", size: 5 }];
    renderSandbox(b);
    expect(await screen.findByText("No code yet")).toBeInTheDocument();
  });
});

// Keep act() warnings from timers quiet in CI output.
void act;
