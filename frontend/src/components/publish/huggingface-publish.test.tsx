import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __setTransport } from "@/lib/api/client";
import type { EndpointDef } from "@/lib/api/endpoints";
import { HuggingFacePublish } from "./huggingface-publish";

type Obj = Record<string, unknown>;

function backend(plan: Obj) {
  const calls: { key: string; url: string; body: unknown }[] = [];
  const state = { plan, pubs: [] as Obj[] };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  const transport = async (url: string, init: RequestInit, def: EndpointDef) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key: def.key, url, body });
    if (def.key === "hfPreview") return json(state.plan);
    if (def.key === "hfList") return json(state.pubs);
    if (def.key === "hfPublish") {
      const p = { id: 1, repo_name: body.repo, private: body.private, status: "queued", stage: "queued", files_done: 0, files_total: 3, bytes_done: 0, bytes_total: 300 };
      state.pubs.unshift(p);
      return json(p, 202);
    }
    return json({ error: "not found" }, 404);
  };
  return { calls, state, transport };
}

const PLAN = {
  configured: true, blockers: [], suggested_repo: "digits-run-33", total_bytes: 290, model_card: "# digits-run-33\n\n| acc | 0.95 |",
  files: [{ path: "models/clf.joblib", size: 250, sha256: "a", kind: "model", required: true },
    { path: "results/metrics.json", size: 40, sha256: "b", kind: "metrics", required: true }],
  excluded: [{ path: "data/", reason: "dataset files are not uploaded" }],
};

function show(b: ReturnType<typeof backend>) {
  __setTransport(b.transport as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><HuggingFacePublish runId="33" /></QueryClientProvider>);
}

afterEach(() => __setTransport(null));

describe("HuggingFacePublish", () => {
  it("shows the files, needs confirmation and sends the chosen name and visibility", async () => {
    const b = backend(PLAN);
    show(b);
    expect(await screen.findByText("models/clf.joblib")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText(/dataset files are not uploaded/)).toBeInTheDocument();
    expect(screen.getByTestId("hf-card")).toHaveTextContent("| acc | 0.95 |");
    await waitFor(() => expect(screen.getByLabelText(/Repository name/)).toHaveValue("digits-run-33"));
    const publish = screen.getByRole("button", { name: /Publish to Hugging Face/ });
    expect(publish).toBeDisabled(); // nothing goes out without confirmation
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    fireEvent.click(await screen.findByLabelText(/Upload these 3 files to a public Hugging Face repository/));
    fireEvent.click(publish);
    await waitFor(() => expect(b.calls.some((c) => c.key === "hfPublish")).toBe(true));
    expect(b.calls.find((c) => c.key === "hfPublish")!.body).toEqual({ repo: "digits-run-33", private: false, include_code: false, confirm: true });
  });

  it("shows progress, then the Hub link only after success", async () => {
    const b = backend(PLAN);
    b.state.pubs = [{ id: 1, repo_name: "digits", repo_id: "Ryuma04/digits", private: true, status: "uploading", stage: "uploading models/clf.joblib",
      files_done: 1, files_total: 3, bytes_done: 250, bytes_total: 300, repo_url: "https://huggingface.co/Ryuma04/digits" }];
    show(b);
    expect(await screen.findByText(/1 of 3 files/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /huggingface\.co/ })).not.toBeInTheDocument(); // not confirmed yet
    Object.assign(b.state.pubs[0]!, { status: "succeeded", stage: "done", files_done: 3, bytes_done: 300, commit_url: "https://huggingface.co/Ryuma04/digits/commit/abc" });
    const link = await screen.findByRole("link", { name: /https:\/\/huggingface\.co\/Ryuma04\/digits/ }, { timeout: 4000 });
    expect(link).toHaveAttribute("href", "https://huggingface.co/Ryuma04/digits");
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("shows failures and blockers without a link", async () => {
    const b = backend({ ...PLAN, blockers: ["Hugging Face is not set up on the server: add HF_TOKEN to .env and restart"] });
    b.state.pubs = [{ id: 1, repo_name: "digits", private: true, status: "failed", error: "Hugging Face rejected the access token (HF_TOKEN).",
      repo_url: "https://huggingface.co/x/should-not-show" }];
    show(b);
    expect(await screen.findByText(/rejected the access token/)).toBeInTheDocument();
    expect(screen.getByText(/add HF_TOKEN to .env/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish to Hugging Face/ })).toBeDisabled();
    expect(screen.queryByText(/should-not-show/)).not.toBeInTheDocument();
  });
});
