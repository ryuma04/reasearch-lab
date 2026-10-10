import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { XData, XGap } from "@/lib/explorer/types";
import { filterGaps, GapsView, sortGaps } from "./gaps-view";

const gap = (id: string, kind: XGap["kind"], impact: XGap["impact"], confidence: XGap["confidence"] = "low", evidence = 0): XGap => ({
  id, title: `Gap ${id}`, category: "shared_limitation", explanation: `Explanation of ${id}.`, kind, confidence,
  confidence_basis: kind === "hypothesis" ? "no verified quote: an AI hypothesis, not a finding" : "two quotes",
  evidence: Array.from({ length: evidence }, (_, i) => ({ paper_id: `p${i}`, title: `Source ${i}`, year: 2020, url: "https://example.org", quote: `Quote ${i}` })),
  supporting_papers: Array.from({ length: evidence }, (_, i) => `p${i}`), impact, impact_reason: `Impact of ${id}`,
  why_investigate: `Why ${id}`, novelty: "Not verified as novel.",
});

const gaps = [gap("h-low", "hypothesis", "low"), gap("h-high", "hypothesis", "high"), gap("e-med", "evidence_backed", "medium", "high", 2)];
const data = { gaps, limits: { papers_found: 9 }, comparison: { ai: true } } as unknown as XData;
const actions = { feedback: { isPending: false, mutate: vi.fn() }, clear: { isPending: false, mutate: vi.fn() } } as never;

describe("GapsView", () => {
  it("sorts evidence first, then by impact, and filters", () => {
    expect(sortGaps(gaps).map((g) => g.id)).toEqual(["e-med", "h-high", "h-low"]);
    expect(filterGaps(gaps, "evidence").map((g) => g.id)).toEqual(["e-med"]);
    expect(filterGaps(gaps, "ai")).toHaveLength(2);
    expect(filterGaps(gaps, "high").map((g) => g.id)).toEqual(["h-high"]);
  });

  it("says the AI caveat once for the page, not on every card", () => {
    render(<GapsView data={data} feedback={[]} canEdit actions={actions} />);
    expect(screen.getByTestId("gaps-note")).toHaveTextContent("no quote, judge it yourself");
    expect(screen.queryByText(/No verified quote supports this idea/)).not.toBeInTheDocument();
    expect(screen.queryByText("Not verified as novel.")).not.toBeInTheDocument(); // only inside More
    for (const card of screen.getAllByTestId("gap-card")) {
      expect(within(card).queryByText(/Why it matters/)).not.toBeInTheDocument();
      expect(within(card).getAllByText(/Backed by evidence|AI idea/).length).toBeGreaterThan(0); // the badge stays on each card
    }
  });

  it("keeps details and quotes one click away", () => {
    render(<GapsView data={data} feedback={[]} canEdit actions={actions} />);
    const first = screen.getAllByTestId("gap-card")[0]!;
    fireEvent.click(within(first).getByRole("button", { name: "More (2 sources)" }));
    expect(within(first).getByText("Quote 0")).toBeInTheDocument();
    expect(within(first).getByText(/Why e-med/)).toBeInTheDocument();
    expect(within(first).getByText("Not verified as novel.")).toBeInTheDocument();
  });

  it("filter buttons show counts and change the list", () => {
    render(<GapsView data={data} feedback={[]} canEdit actions={actions} />);
    expect(screen.getByRole("tab", { name: /AI ideas 2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /High impact/ }));
    expect(screen.getAllByTestId("gap-card")).toHaveLength(1);
    expect(screen.getByText("Gap h-high")).toBeInTheDocument();
  });
});
