import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { XPaper } from "@/lib/explorer/types";
import { graphOrder, ResearchGraph } from "./research-graph";

const paper = (id: string, year: number | null, extra: Partial<XPaper> = {}): XPaper => ({
  id, title: `Paper ${id}`, authors: ["Ada Lovelace", "Alan Turing"], year, venue: null, url: null, doi: null, arxiv_id: null,
  citations: null, relation: "related", sources: [], is_seed: false, has_abstract: true, abstract: `Abstract of ${id}.`,
  category: null, category_source: null, methodology: [], contribution: null, limitations: [], future_work: [], datasets: [],
  metrics: [], facts_by: null, ...extra,
});

const papers = [
  paper("c", 2021),
  paper("seed", 2019, { is_seed: true, relation: "seed" }),
  paper("u", null, { abstract: null, has_abstract: false }),
  paper("a", 2015, { relation: "builds_on", category: "Graph networks" }),
];
const edges = [{ from: "seed", to: "a", kind: "cites" as const, evidence: "reference list" }];

describe("ResearchGraph", () => {
  it("orders papers oldest first and keeps papers without a year last", () => {
    expect(graphOrder(papers).map((p) => p.id)).toEqual(["a", "seed", "c", "u"]);
  });

  it("shows title, authors, year and abstract for each node, and says when an abstract is missing", () => {
    render(<ResearchGraph papers={papers} edges={edges} selected={null} onSelect={() => {}} />);
    const graph = screen.getByTestId("research-graph");
    const items = within(graph).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Paper a")]));
    expect(items[0]).toHaveTextContent("Paper a");
    expect(items[0]).toHaveTextContent("Ada Lovelace, Alan Turing (2015)");
    expect(items[0]).toHaveTextContent("Abstract of a.");
    expect(items[0]).toHaveTextContent("Graph networks");
    expect(items[3]).toHaveTextContent("No abstract available from the sources.");
    expect(within(graph).getByText("Year not reported")).toBeInTheDocument();
    for (const y of ["2015", "2019", "2021"]) expect(within(graph).getByText(y)).toBeInTheDocument();
  });

  it("selects a node and fades papers without a citation link to it", () => {
    let chosen: string | null = null;
    const { rerender } = render(<ResearchGraph papers={papers} edges={edges} selected={null} onSelect={(id) => (chosen = id)} />);
    fireEvent.click(screen.getByRole("button", { name: /Paper seed/ }));
    expect(chosen).toBe("seed");
    rerender(<ResearchGraph papers={papers} edges={edges} selected="seed" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /Paper a/ }).className).not.toContain("opacity-35");
    expect(screen.getByRole("button", { name: /Paper c/ }).className).toContain("opacity-35");
  });
});

describe("ResearchGraph selection without links", () => {
  it("does not dim the graph when the selected paper has no citation links", () => {
    render(<ResearchGraph papers={papers} edges={[]} selected="seed" onSelect={() => {}} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).not.toContain("opacity-35");
  });
});
