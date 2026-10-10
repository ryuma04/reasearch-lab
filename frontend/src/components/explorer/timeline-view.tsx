"use client";

import * as React from "react";
import { MagnifyingGlass, Minus, Plus } from "@phosphor-icons/react";
import { CARD_H, CARD_W, NO_FILTERS, RELATION_LABEL, activeFilterCount, facets, layoutTimeline, matches, type Filters } from "@/lib/explorer/timeline";
import type { Relation, XData } from "@/lib/explorer/types";
import { cn } from "@/lib/utils";
import { Card, Input, Select } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { authorsLine, PaperDetail } from "./paper-detail";

const REL_STYLE: Record<Relation, string> = {
  seed: "border-purple bg-lavender-soft",
  builds_on: "border-line bg-white",
  cited_by: "border-sky/50 bg-sky-soft/40",
  related: "border-line bg-canvas",
};

/** Interactive research evolution timeline: papers in year columns, joined by real citation links. */
export function TimelineView({ data }: { data: XData }) {
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [sel, setSel] = React.useState<string | null>(data.seed_id);
  const [scale, setScale] = React.useState(1);
  const fct = React.useMemo(() => facets(data.papers), [data.papers]);
  const byId = React.useMemo(() => new Map(data.papers.map((p) => [p.id, p])), [data.papers]);
  const visible = React.useMemo(() => data.papers.filter((p) => matches(p, filters)), [data.papers, filters]);
  const layout = React.useMemo(() => layoutTimeline(visible, data.edges), [visible, data.edges]);
  const selected = sel ? byId.get(sel) ?? null : null;
  const near = React.useMemo(() => {
    if (!sel) return null;
    const s = new Set([sel]);
    for (const e of data.edges) { if (e.from === sel) s.add(e.to); if (e.to === sel) s.add(e.from); }
    return s;
  }, [sel, data.edges]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const years = fct.minYear != null && fct.maxYear != null ? Array.from({ length: fct.maxYear - fct.minYear + 1 }, (_, i) => fct.minYear! + i) : [];
  const nFilters = activeFilterCount(filters);

  return (
    <div className="space-y-4">
      <Card variant="bento" className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-sm">
            <MagnifyingGlass size={15} className="text-muted" />
            <input value={filters.query} onChange={(e) => set("query", e.target.value)} placeholder="Search titles and contributions" aria-label="Search the timeline" className="w-full bg-transparent outline-none" />
          </label>
          <span className="text-xs text-muted" aria-live="polite">Showing {visible.length} of {data.papers.length} papers</span>
          {nFilters > 0 && <button type="button" onClick={() => setFilters(NO_FILTERS)} className="rounded-full bg-lavender-soft px-3 py-1.5 text-xs font-semibold text-purple-deep">Reset {nFilters} filter{nFilters === 1 ? "" : "s"}</button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Select aria-label="Show papers by relationship" value={filters.relation} onChange={(e) => set("relation", e.target.value as Filters["relation"])}>
            <option value="all">All relationships</option>
            {(["builds_on", "cited_by", "related"] as Relation[]).map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}
          </Select>
          <Select aria-label="From year" value={filters.yearFrom ?? ""} onChange={(e) => set("yearFrom", e.target.value ? Number(e.target.value) : null)}>
            <option value="">From any year</option>{years.map((y) => <option key={y} value={y}>From {y}</option>)}
          </Select>
          <Select aria-label="To year" value={filters.yearTo ?? ""} onChange={(e) => set("yearTo", e.target.value ? Number(e.target.value) : null)}>
            <option value="">To any year</option>{years.map((y) => <option key={y} value={y}>To {y}</option>)}
          </Select>
          <Select aria-label="Research category" value={filters.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">All categories</option>{fct.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select aria-label="Methodology" value={filters.method} onChange={(e) => set("method", e.target.value)}>
            <option value="">All methodologies</option>{fct.methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Input aria-label="Author" placeholder="Author name" value={filters.author} onChange={(e) => set("author", e.target.value)} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card variant="bento" className="relative overflow-hidden">
          {visible.length <= 1 && data.papers.length > 1 ? (
            <div className="p-6"><EmptyState title="No papers match these filters" body="Reset the filters to see the whole timeline." /></div>
          ) : (
            <>
              <div className="max-h-[72vh] overflow-auto" role="group" aria-label="Research evolution timeline">
                <div style={{ width: layout.width * scale, height: layout.height * scale }}>
                  <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
                    {layout.columns.map((c) => (
                      <div key={c.label + c.x} className="absolute top-3 text-xs font-bold text-ink-soft" style={{ left: c.x, width: CARD_W }}>
                        <span className="rounded-full bg-ink/5 px-2.5 py-1">{c.label}</span> <span className="ml-1 font-normal text-muted">{c.count}</span>
                      </div>
                    ))}
                    <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height} aria-hidden>
                      <defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8f8aa8" /></marker>
                        <marker id="tl-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7b5cf0" /></marker></defs>
                      {layout.edges.map((e) => {
                        const hot = !!sel && (e.from === sel || e.to === sel);
                        return <path key={`${e.from}>${e.to}`} d={e.d} fill="none" stroke={hot ? "#7b5cf0" : "#b9b5cb"} strokeWidth={hot ? 2.2 : 1.2} opacity={sel && !hot ? 0.25 : 0.9} markerEnd={`url(#${hot ? "tl-arrow-hot" : "tl-arrow"})`}><title>{e.evidence}</title></path>;
                      })}
                    </svg>
                    {layout.nodes.map((n) => {
                      const p = n.paper;
                      const faded = !!near && !near.has(p.id);
                      return (
                        <button key={p.id} type="button" aria-pressed={sel === p.id} onClick={() => setSel(p.id === sel ? null : p.id)}
                          style={{ left: n.x, top: n.y, width: CARD_W, height: CARD_H }}
                          className={cn("absolute flex flex-col justify-between rounded-xl border-2 px-2.5 py-2 text-left shadow-sm transition", REL_STYLE[p.relation], sel === p.id && "ring-2 ring-purple", faded && "opacity-30")}>
                          <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{p.title}</span>
                          <span className="flex items-center gap-1.5 text-[10.5px] text-muted"><span className="truncate">{authorsLine(p, 1)}</span>{p.category && <span className="ml-auto shrink-0 rounded bg-ink/5 px-1.5 py-0.5">{p.category}</span>}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-xl border border-line bg-white shadow-clay-sm">
                <button type="button" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))} className="p-2 hover:bg-canvas"><Minus size={14} /></button>
                <button type="button" aria-label="Reset zoom" onClick={() => setScale(1)} className="border-x border-line px-2 text-xs font-semibold hover:bg-canvas">{Math.round(scale * 100)}%</button>
                <button type="button" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(1.6, +(s + 0.15).toFixed(2)))} className="p-2 hover:bg-canvas"><Plus size={14} /></button>
              </div>
            </>
          )}
          <p className="border-t border-line-cool px-4 py-2 text-[11px] text-muted">
            Columns are publication years. An arrow runs from the earlier paper to the later paper that cites it, and appears only where a reference list says so: no arrow means no citation was found, not that the papers are unrelated.
          </p>
        </Card>

        <Card variant="bento" className="h-fit p-5 xl:sticky xl:top-20">
          {selected ? <PaperDetail paper={selected} byId={byId} edges={data.edges} onSelect={setSel} onClose={() => setSel(null)} /> : (
            <p className="text-sm text-muted">Select a paper on the timeline to read its contribution, limitations and sources, and to open the original publication.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
