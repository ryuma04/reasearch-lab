import { describe, expect, it } from "vitest";
import type { ResearchMap } from "@/lib/api/types";
import { safeUrl, sourceActionLabel, sourceKindOf, metaFacts } from "@/lib/sources";
import { buildGraphFile, buildJson, buildSvg, wrapLabel } from "./graph-export";

const MAP: ResearchMap = {
  run_id: "7",
  updated_at: null,
  nodes: [
    { id: "paper:1", kind: "paper", label: "Distilling the Knowledge — résumé & <tags>", status: "done", url: "https://arxiv.org/abs/1503.02531", source_type: "paper" },
    { id: "claim:1", kind: "claim", label: "Small net distilled: 74", status: "problem" },
    { id: "dataset:0", kind: "source", label: "MNIST", status: "done", url: "https://pytorch.org/vision/mnist", source_type: "dataset", meta: { licence: "CC BY-SA 3.0" } },
    { id: "repo:0", kind: "source", label: "a/b", status: "done", url: null, source_type: "repository" },
    { id: "related:0", kind: "related", label: "Born-Again Networks (2018)", status: "done", url: "https://arxiv.org/abs/1805.04770", source_type: "paper", meta: { year: 2018 } },
  ],
  edges: [
    { id: "e1", from: "paper:1", to: "claim:1", label: "claims" },
    { id: "e2", from: "dataset:0", to: "paper:1", label: "used by" },
    { id: "e3", from: "related:0", to: "paper:1", label: "cites" },
    { id: "e4", from: "repo:0", to: "ghost:9", label: "dangling" },
  ],
};

describe("SVG export", () => {
  const { svg } = buildSvg(MAP);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

  it("is valid XML, not a blank container", () => {
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.tagName).toBe("svg");
    expect(Number(doc.documentElement.getAttribute("width"))).toBeGreaterThan(100);
  });
  it("draws every node as plain SVG shapes (no foreignObject) with its label", () => {
    expect(svg).not.toContain("foreignObject");
    const text = [...doc.querySelectorAll("text")].map((t) => t.textContent).join("\n");
    for (const label of ["MNIST", "a/b", "Born-Again Networks (2018)"]) expect(text).toContain(label);
    expect(text).toContain("résumé");
    expect(text).toContain("<tags>"); // escaped in the file, intact once parsed
  });
  it("draws valid edges only and keeps relationship labels", () => {
    expect(doc.querySelectorAll("path[marker-end]").length).toBe(3); // the dangling edge is dropped
    const text = [...doc.querySelectorAll("text")].map((t) => t.textContent).join("|");
    for (const l of ["claims", "used by", "cites"]) expect(text).toContain(l);
    expect(text).not.toContain("dangling");
  });
  it("links source nodes to their real URL and nothing else", () => {
    const hrefs = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["https://arxiv.org/abs/1503.02531", "https://pytorch.org/vision/mnist", "https://arxiv.org/abs/1805.04770"]));
    expect(hrefs).toHaveLength(3);
  });
});

describe("JSON export", () => {
  it("round-trips ids, relationships, URLs and metadata", async () => {
    const { blob, name } = await buildGraphFile(MAP, "json");
    expect(name).toBe("research-graph-run-7.json");
    const text = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(blob); });
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe("research-lab-graph");
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual(MAP.nodes.map((n) => n.id));
    expect(parsed.edges).toHaveLength(3);
    expect(parsed.edges.find((e: { id: string }) => e.id === "e3")).toMatchObject({ from: "related:0", to: "paper:1", label: "cites" });
    expect(parsed.nodes.find((n: { id: string }) => n.id === "dataset:0")).toMatchObject({ url: "https://pytorch.org/vision/mnist", meta: { licence: "CC BY-SA 3.0" } });
    expect(parsed.nodes.find((n: { id: string }) => n.id === "repo:0").url).toBeNull();
  });
  it("refuses to export an empty graph instead of writing an empty file", async () => {
    await expect(buildGraphFile({ ...MAP, nodes: [], edges: [] }, "svg")).rejects.toThrow(/empty/);
    expect(buildJson({ ...MAP, nodes: [], edges: [] }).nodes).toEqual([]);
  });
});

describe("labels and links", () => {
  it("wraps long labels to two lines with an ellipsis", () => {
    const w = wrapLabel("a very long research paper title that cannot possibly fit on a single card line at all", 28, 2);
    expect(w).toHaveLength(2);
    expect(w[1]!.endsWith("…")).toBe(true);
  });
  it("only allows plain http(s) links", () => {
    expect(safeUrl("https://arxiv.org/abs/1503.02531")).toBe("https://arxiv.org/abs/1503.02531");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.org/a", "https://user:pw@evil.example/x", "arxiv.org/abs/1", "", null, undefined, 42, "https://nodots"]) {
      expect(safeUrl(bad as unknown)).toBeNull();
    }
  });
  it("labels actions by what the source is and shows only real facts", () => {
    expect(sourceActionLabel(sourceKindOf("dataset"))).toBe("Open dataset ↗");
    expect(sourceActionLabel(sourceKindOf(undefined, "related"))).toBe("Open paper ↗");
    expect(sourceActionLabel(sourceKindOf("repository"))).toBe("Open repository ↗");
    expect(metaFacts({ year: 2018, citations: 900, licence: "MIT" })).toEqual(["2018", "900 citations", "licence MIT"]);
    expect(metaFacts(undefined)).toEqual([]);
  });
});
