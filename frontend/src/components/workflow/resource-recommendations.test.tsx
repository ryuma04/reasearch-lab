import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __setTransport } from "@/lib/api/client";
import type { EndpointDef } from "@/lib/api/endpoints";
import { ResourceRecommendations } from "./resource-recommendations";

type Obj = Record<string, unknown>;
const rec = (id: string, name: string, category: string, extra: Obj = {}) => ({
  id, kind: "dataset", source: "huggingface", url: `https://huggingface.co/datasets/${name}`, name, original: { name: "cow-photos", url: null },
  category, action: category === "better_alternative" ? "replace" : "supplement", score: 78, confidence: "high", summary: `${name} scores 78/100 against 40/100 for your dataset.`,
  advantages: ["Documentation: Description of 380 characters"], limitations: ["Freshness: Updated 3.0 years ago"], evidence: ["Matches 4 of 8 research terms"], decision: null, ...extra,
});
const DISCOVERY = { status: "completed", note: "1 better alternative(s) found. Your original resources are kept unless you accept a recommendation.", providers: [{ name: "huggingface", status: "ok" }, { name: "kaggle", status: "not_configured" }] };

function backend(state: { resources: Obj; decisions: { key: string; body: unknown; url: string }[] }, status = 200) {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  __setTransport((async (url: string, init: RequestInit, def: EndpointDef) => {
    if (def.key === "resources") return status === 200 ? json(state.resources) : json({ error: "boom" }, status);
    if (def.key === "setResourceDecision" || def.key === "clearResourceDecision") {
      state.decisions.push({ key: def.key, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const recs = state.resources.recommendations as Obj[];
      const id = url.split("/").pop();
      const target = recs.find((r) => r.id === id)!;
      target.decision = def.key === "setResourceDecision" ? { rec_id: id, decision: JSON.parse(String(init.body)).decision, note: "", updated_at: "" } : null;
      return def.key === "clearResourceDecision" ? new Response(null, { status: 204 }) : json(target.decision);
    }
    return json({}, 404);
  }) as never);
}

function show(canAct = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ResourceRecommendations runId="7" canAct={canAct} /></QueryClientProvider>);
}
afterEach(() => __setTransport(null));

const base = (recommendations: Obj[], discovery: Obj = DISCOVERY) => ({ discovery, recommendations, originals: { datasets: [{ name: "cow-photos", url: "https://huggingface.co/datasets/me/cow-photos" }], repositories: [] } });

describe("ResourceRecommendations", () => {
  it("shows a loading state while discovery data loads", () => {
    __setTransport((() => new Promise(() => undefined)) as never);
    show();
    expect(screen.getByRole("status", { name: "Searching for alternatives" })).toBeInTheDocument();
  });

  it("shows the original, several recommendations with their own category, and correct source links", async () => {
    backend({ resources: base([rec("rec-a", "org/cattle-breeds", "better_alternative"), rec("rec-b", "x/cow-small", "relevant_alternative")]), decisions: [] });
    show();
    expect(await screen.findByText("Recommended as a better alternative")).toBeInTheDocument();
    expect(screen.getByText("Relevant alternative")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "cow-photos" })).toHaveAttribute("href", "https://huggingface.co/datasets/me/cow-photos");
    expect(screen.getByRole("link", { name: /org\/cattle-breeds/ })).toHaveAttribute("href", "https://huggingface.co/datasets/org/cattle-breeds");
    expect(screen.getAllByText("Documentation: Description of 380 characters")).toHaveLength(2);
    expect(screen.getByText(/Could replace your original/)).toBeInTheDocument();
  });

  it("accepting and rejecting updates only the chosen item and sends the right decision", async () => {
    const state = { resources: base([rec("rec-a", "org/cattle-breeds", "better_alternative"), rec("rec-b", "x/cow-small", "relevant_alternative")]), decisions: [] as { key: string; body: unknown; url: string }[] };
    backend(state);
    show();
    const first = (await screen.findByRole("group", { name: "Decision for org/cattle-breeds" }));
    fireEvent.click(within(first).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("group", { name: "Decision for x/cow-small" })).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());
    expect(state.decisions.map((d) => [d.url.split("/").pop(), (d.body as Obj).decision])).toEqual([["rec-a", "accept"], ["rec-b", "reject"]]);
    fireEvent.click(within(screen.getByRole("group", { name: "Decision for org/cattle-breeds" })).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Accepted")).not.toBeInTheDocument());
    expect(screen.getByText("Rejected")).toBeInTheDocument(); // the other item is untouched
  });

  it("says honestly that nothing was found when discovery completed with no results", async () => {
    backend({ resources: base([], { status: "completed", note: "No alternative was found.", providers: [{ name: "huggingface", status: "ok" }] }), decisions: [] });
    show();
    expect(await screen.findByText(/No alternative resource was established/)).toBeInTheDocument();
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument();
  });

  it("shows a provider failure as a failure, never as an empty successful search", async () => {
    backend({ resources: base([], { status: "failed", note: "Discovery could not be completed (no provider answered).", providers: [{ name: "huggingface", status: "failed" }] }), decisions: [] });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Search failed/);
    expect(screen.getByRole("alert")).toHaveTextContent(/does not mean there are no better resources/);
    expect(screen.queryByText(/No alternative resource was established/)).not.toBeInTheDocument();
  });

  it("hides the decision buttons for view-only users and for inaccessible candidates", async () => {
    backend({ resources: base([rec("rec-a", "org/cattle-breeds", "better_alternative"), rec("rec-c", "gone/set", "inaccessible")]), decisions: [] });
    show(false);
    expect(await screen.findByText(/View-only access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("explains runs from before the review existed", async () => {
    backend({ resources: { discovery: { status: "not_run", note: "This run was created before the better-resource review existed.", providers: [] }, recommendations: [], originals: { datasets: [], repositories: [] } }, decisions: [] });
    show();
    expect(await screen.findByText(/created before the better-resource review existed/)).toBeInTheDocument();
  });
});
