/** Pure logic for the Research Evolution Timeline: filtering, year-stage columns and edge geometry. */
import type { Relation, XEdge, XPaper } from "./types";

export interface Filters {
  yearFrom: number | null;
  yearTo: number | null;
  category: string;
  method: string;
  author: string;
  relation: Relation | "all";
  query: string;
}

export const NO_FILTERS: Filters = { yearFrom: null, yearTo: null, category: "", method: "", author: "", relation: "all", query: "" };

export const RELATION_LABEL: Record<Relation, string> = {
  seed: "Your uploaded paper",
  builds_on: "Earlier work it builds on",
  cited_by: "Later work that cites it",
  related: "Related research",
};

const lc = (s: string) => s.toLowerCase();

export function matches(p: XPaper, f: Filters): boolean {
  if (p.is_seed) return true; // the uploaded paper always stays visible: it is the anchor of the timeline
  if (f.relation !== "all" && p.relation !== f.relation) return false;
  if (f.yearFrom != null && (p.year == null || p.year < f.yearFrom)) return false;
  if (f.yearTo != null && (p.year == null || p.year > f.yearTo)) return false;
  if (f.category && p.category !== f.category) return false;
  if (f.method && !p.methodology.some((m) => lc(m) === lc(f.method))) return false;
  if (f.author && !p.authors.some((a) => lc(a).includes(lc(f.author.trim())))) return false;
  if (f.query.trim() && !lc(`${p.title} ${p.contribution ?? ""}`).includes(lc(f.query.trim()))) return false;
  return true;
}

export function activeFilterCount(f: Filters): number {
  return [f.yearFrom != null, f.yearTo != null, !!f.category, !!f.method, !!f.author.trim(), f.relation !== "all", !!f.query.trim()].filter(Boolean).length;
}

export function facets(papers: XPaper[]) {
  const years = papers.map((p) => p.year).filter((y): y is number => y != null);
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return {
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    categories: count(papers.map((p) => p.category).filter((c): c is string => !!c)),
    methods: count(papers.flatMap((p) => p.methodology)).slice(0, 40),
  };
}

export const CARD_W = 220;
export const CARD_H = 84;
const COL_GAP = 70;
const ROW_GAP = 14;
const HEAD = 46;
const PAD = 24;
const MAX_COLS = 8;

export interface TNode { paper: XPaper; x: number; y: number; col: number }
export interface TColumn { label: string; x: number; count: number }
export interface TEdge { from: string; to: string; d: string; evidence: string }
export interface TLayout { nodes: TNode[]; edges: TEdge[]; columns: TColumn[]; width: number; height: number }

const REL_RANK: Record<Relation, number> = { seed: 0, builds_on: 1, cited_by: 2, related: 3 };

/** Columns are years (or equal year-spans when there are many years). Papers without a year go last, honestly labelled. */
export function layoutTimeline(papers: XPaper[], edges: XEdge[]): TLayout {
  const dated = papers.filter((p) => p.year != null);
  const years = [...new Set(dated.map((p) => p.year as number))].sort((a, b) => a - b);
  const span = years.length ? years[years.length - 1]! - years[0]! + 1 : 1;
  const bucket = years.length > MAX_COLS ? Math.ceil(span / MAX_COLS) : 1;
  const colOf = (y: number) => Math.floor((y - years[0]!) / bucket);
  const nCols = years.length ? colOf(years[years.length - 1]!) + 1 : 0;
  const labels: string[] = Array.from({ length: nCols }, (_, c) => {
    const a = years[0]! + c * bucket;
    return bucket === 1 ? String(a) : `${a}–${a + bucket - 1}`;
  });
  const undated = papers.filter((p) => p.year == null);
  const totalCols = nCols + (undated.length ? 1 : 0);
  const cols: XPaper[][] = Array.from({ length: totalCols }, () => []);
  for (const p of dated) cols[colOf(p.year as number)]!.push(p);
  if (undated.length) cols[nCols] = undated;
  const nodes: TNode[] = [];
  const columns: TColumn[] = [];
  let height = HEAD + PAD;
  cols.forEach((list, c) => {
    list.sort((a, b) => REL_RANK[a.relation] - REL_RANK[b.relation] || (b.citations ?? 0) - (a.citations ?? 0));
    const x = PAD + c * (CARD_W + COL_GAP);
    columns.push({ label: c < nCols ? labels[c]! : "Year unknown", x, count: list.length });
    list.forEach((p, i) => {
      const y = HEAD + i * (CARD_H + ROW_GAP);
      nodes.push({ paper: p, x, y, col: c });
      height = Math.max(height, y + CARD_H + PAD);
    });
  });
  const byId = new Map(nodes.map((n) => [n.paper.id, n]));
  const out: TEdge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const citing = byId.get(e.from);
    const cited = byId.get(e.to);
    if (!citing || !cited || citing === cited) continue;
    const k = `${e.from}>${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // Draw from the earlier (left) card to the later one so the picture reads as evolution over time.
    const [a, b] = cited.x <= citing.x ? [cited, citing] : [citing, cited];
    const same = a.x === b.x;
    const x1 = same ? a.x + CARD_W : a.x + CARD_W;
    const y1 = a.y + CARD_H / 2;
    const x2 = same ? b.x + CARD_W : b.x;
    const y2 = b.y + CARD_H / 2;
    const c = same ? 46 : Math.max(36, (x2 - x1) / 2);
    out.push({ from: a.paper.id, to: b.paper.id, evidence: e.evidence, d: `M${x1},${y1} C${x1 + c},${y1} ${same ? x2 + c : x2 - c},${y2} ${x2},${y2}` });
  }
  return { nodes, edges: out, columns, width: PAD * 2 + Math.max(1, totalCols) * (CARD_W + COL_GAP) - COL_GAP, height };
}

/** Papers connected to `id` by a citation edge (both directions), for the detail panel. */
export function neighbours(id: string, edges: XEdge[]) {
  return {
    cites: edges.filter((e) => e.from === id).map((e) => e.to),
    citedBy: edges.filter((e) => e.to === id).map((e) => e.from),
  };
}
