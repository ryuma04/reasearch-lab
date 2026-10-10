/** Pure layout of the Research Map (no React): used by the on-screen map and by the SVG / PNG / JSON exports. */
import type { MapNode, ResearchMap } from "@/lib/api/types";

export const CARD_W = 210;
export const CARD_H = 66;
export const GAP_Y = 18;
export const GAP_X = 22;
export const FRAME_PAD = 22;
export const FRAME_HEAD = 34;
export const COL_GAP = 90;
export const MAX_ROWS = 6;

export type Status = MapNode["status"];
export const STATUS: Record<Status, { stroke: string; fill: string; dot: string; label: string }> = {
  waiting: { stroke: "#b8b5c9", fill: "#ffffff", dot: "#9794ab", label: "waiting" },
  working: { stroke: "#5b8fd6", fill: "#f4f8fe", dot: "#2f6fbf", label: "working" },
  done: { stroke: "#7fbf6a", fill: "#ffffff", dot: "#3f8a2e", label: "done" },
  problem: { stroke: "#e07f7a", fill: "#fff6f5", dot: "#c9544f", label: "problem" },
};

export interface GroupDef {
  key: string;
  title: string;
  tint: string;
  border: string;
  kinds: string[];
}

export const GROUPS: GroupDef[] = [
  { key: "research", title: "Paper & claims", tint: "#f1edff", border: "#d9d0fb", kinds: ["paper", "claim"] },
  { key: "sources", title: "Sources & data", tint: "#eaf4fd", border: "#cfe3f7", kinds: ["source", "dataset"] },
  { key: "related", title: "Related work", tint: "#eef7f1", border: "#d3e8da", kinds: ["related"] },
  { key: "code", title: "Code", tint: "#fdf3e7", border: "#f3dcbf", kinds: ["code", "file", "note"] },
  { key: "tests", title: "Tests", tint: "#fdeeee", border: "#f4d2d0", kinds: ["test"] },
  { key: "results", title: "Results & experiments", tint: "#ecf7e8", border: "#d0e9c6", kinds: ["result", "experiment", "whatif", "gap"] },
];
export const AGENT_GROUP: GroupDef = { key: "agents", title: "Agents", tint: "#f5f4f8", border: "#e2e0ea", kinds: ["agent"] };

export const AGENT_NAMES: Record<string, string> = {
  "research.paper_reader": "Paper Reader", "research.source_finder": "Source Finder", "coding.writer": "Code Writer",
  "coding.reviewer": "Code Reviewer", "testing.designer": "Test Designer", "testing.runner": "Test Runner",
  gap_detective: "Gap Detective", whatif: "What-If Planner", observer: "Observer",
};

/** Which agent produced which kind of node (fixed pipeline) → dotted "implied" edges. */
export const PRODUCER: Record<string, string> = {
  paper: "research.paper_reader", claim: "research.paper_reader", source: "research.source_finder",
  dataset: "research.source_finder", file: "coding.writer", code: "coding.writer", test: "testing.designer",
  result: "testing.runner", experiment: "gap_detective", gap: "gap_detective", whatif: "whatif",
};

export interface LNode extends MapNode {
  kindRaw: string;
  group: string;
  x: number;
  y: number;
}
export interface LEdge {
  id: string;
  from: string;
  to: string;
  label: string | null;
  implied: boolean;
}
export interface Frame {
  def: GroupDef;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

export function displayKind(n: MapNode): string {
  if (n.kind === "note" && (n.id.startsWith("file:") || /\.(py|ya?ml|r|json|txt|md|sh|ipynb)$/i.test(n.label))) {
    return /^tests?\//.test(n.label) ? "test" : "file";
  }
  if (n.id.startsWith("dataset:")) return "dataset";
  if (n.id.startsWith("whatif:")) return "whatif";
  if (n.id.startsWith("gap:")) return "gap";
  if (n.id.startsWith("experiment:")) return "experiment";
  return n.kind;
}

export function prettyLabel(n: MapNode, kind: string): string {
  if (kind === "agent") return AGENT_NAMES[n.label] ?? AGENT_NAMES[n.id.replace(/^agent:/, "")] ?? n.label;
  return n.label || n.id;
}

export function layout(map: ResearchMap) {
  const nodes: LNode[] = map.nodes.map((n) => {
    const kind = displayKind(n);
    const group = (kind === "agent" ? AGENT_GROUP : GROUPS.find((g) => g.kinds.includes(kind)) ?? GROUPS[2]!).key;
    return { ...n, kindRaw: kind, label: prettyLabel(n, kind), group, x: 0, y: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: LEdge[] = map.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to)
    .map((e, i) => ({ id: e.id || `e${i}`, from: e.from, to: e.to, label: e.label ?? null, implied: false }));
  const linked = new Set(edges.flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
  // Implied pipeline edges: producing agent → artifact, paper → claims, when not already reported.
  const paper = nodes.find((n) => n.kindRaw === "paper");
  for (const n of nodes) {
    const agentId = `agent:${PRODUCER[n.kindRaw] ?? ""}`;
    if (byId.has(agentId) && !linked.has(`${agentId}>${n.id}`)) {
      edges.push({ id: `imp:${agentId}:${n.id}`, from: agentId, to: n.id, label: null, implied: true });
    }
    if (paper && n.kindRaw === "claim" && !linked.has(`${paper.id}>${n.id}`)) {
      edges.push({ id: `imp:paper:${n.id}`, from: paper.id, to: n.id, label: "claims", implied: true });
    }
  }

  // Lay out each stage frame as a column (wrapping into sub-columns), in pipeline order.
  const frames: Frame[] = [];
  let x = 0;
  const yOf = new Map<string, number>();
  const neighbours = (id: string) => edges.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
  for (const def of GROUPS) {
    const members = nodes.filter((n) => n.group === def.key);
    if (!members.length) continue;
    // Order cards by where their already-placed neighbours sit (fewer crossing connectors).
    members.sort((a, b) => {
      const ya = avg(neighbours(a.id).map((id) => yOf.get(id)).filter((v): v is number => v !== undefined));
      const yb = avg(neighbours(b.id).map((id) => yOf.get(id)).filter((v): v is number => v !== undefined));
      if (ya !== yb) return ya - yb;
      return kindRank(a.kindRaw) - kindRank(b.kindRaw) || a.label.localeCompare(b.label);
    });
    const cols = Math.ceil(members.length / MAX_ROWS);
    const rows = Math.min(members.length, MAX_ROWS);
    members.forEach((n, i) => {
      const c = Math.floor(i / MAX_ROWS);
      const r = i % MAX_ROWS;
      n.x = x + FRAME_PAD + c * (CARD_W + GAP_X);
      n.y = FRAME_HEAD + FRAME_PAD + r * (CARD_H + GAP_Y);
      yOf.set(n.id, n.y);
    });
    const w = FRAME_PAD * 2 + cols * CARD_W + (cols - 1) * GAP_X;
    const h = FRAME_HEAD + FRAME_PAD * 2 + rows * CARD_H + (rows - 1) * GAP_Y;
    frames.push({ def, x, y: 0, w, h, count: members.length });
    x += w + COL_GAP;
  }
  // Vertically centre each frame against the tallest one.
  const tallest = Math.max(0, ...frames.map((f) => f.h));
  for (const f of frames) {
    const dy = (tallest - f.h) / 2;
    f.y += dy;
    for (const n of nodes) if (n.group === f.def.key) n.y += dy;
  }
  // Agents frame underneath, as a row.
  const agents = nodes.filter((n) => n.group === "agents");
  if (agents.length) {
    const order = Object.keys(AGENT_NAMES);
    agents.sort((a, b) => order.indexOf(a.id.replace(/^agent:/, "")) - order.indexOf(b.id.replace(/^agent:/, "")));
    const top = tallest + 70;
    const perRow = Math.max(1, Math.floor((Math.max(x - COL_GAP, CARD_W) - FRAME_PAD * 2 + GAP_X) / (CARD_W + GAP_X)));
    agents.forEach((n, i) => {
      n.x = FRAME_PAD + (i % perRow) * (CARD_W + GAP_X);
      n.y = top + FRAME_HEAD + FRAME_PAD + Math.floor(i / perRow) * (CARD_H + GAP_Y);
    });
    const rows = Math.ceil(agents.length / perRow);
    const cols = Math.min(agents.length, perRow);
    frames.push({
      def: AGENT_GROUP, x: 0, y: top, count: agents.length,
      w: FRAME_PAD * 2 + cols * CARD_W + (cols - 1) * GAP_X,
      h: FRAME_HEAD + FRAME_PAD * 2 + rows * CARD_H + (rows - 1) * GAP_Y,
    });
  }
  const width = Math.max(1, ...frames.map((f) => f.x + f.w));
  const height = Math.max(1, ...frames.map((f) => f.y + f.h));
  return { nodes, byId, edges, frames, width, height };
}

function avg(v: number[]) {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.POSITIVE_INFINITY;
}
function kindRank(k: string) {
  return ["paper", "claim", "source", "related", "dataset", "file", "code", "test", "result", "experiment", "gap", "whatif", "agent"].indexOf(k);
}

/** Curved connector between the facing sides of two cards. */
export function edgePath(a: LNode, b: LNode) {
  const sameColumn = Math.abs(a.x - b.x) < CARD_W / 2;
  if (sameColumn) {
    const x1 = a.x + CARD_W;
    const y1 = a.y + CARD_H / 2;
    const y2 = b.y + CARD_H / 2;
    const bulge = 40 + Math.min(80, Math.abs(y2 - y1) / 4);
    return { d: `M${x1},${y1} C${x1 + bulge},${y1} ${x1 + bulge},${y2} ${x1},${y2}`, mx: x1 + bulge * 0.75, my: (y1 + y2) / 2 };
  }
  const forward = b.x > a.x;
  const vertical = Math.abs(a.y - b.y) > 160 && Math.abs(a.x - b.x) < CARD_W * 1.5;
  if (vertical) {
    const down = b.y > a.y;
    const x1 = a.x + CARD_W / 2;
    const y1 = down ? a.y + CARD_H : a.y;
    const x2 = b.x + CARD_W / 2;
    const y2 = down ? b.y : b.y + CARD_H;
    const c = Math.max(40, Math.abs(y2 - y1) / 2);
    return { d: `M${x1},${y1} C${x1},${y1 + (down ? c : -c)} ${x2},${y2 - (down ? c : -c)} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }
  const x1 = forward ? a.x + CARD_W : a.x;
  const x2 = forward ? b.x : b.x + CARD_W;
  const y1 = a.y + CARD_H / 2;
  const y2 = b.y + CARD_H / 2;
  const c = Math.max(50, Math.abs(x2 - x1) / 2);
  return { d: `M${x1},${y1} C${x1 + (forward ? c : -c)},${y1} ${x2 - (forward ? c : -c)},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

