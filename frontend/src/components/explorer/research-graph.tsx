"use client";

import * as React from "react";
import { RELATION_LABEL } from "@/lib/explorer/timeline";
import type { XEdge, XPaper } from "@/lib/explorer/types";
import { cn } from "@/lib/utils";
import { authorsLine } from "./paper-detail";

const DOT: Record<XPaper["relation"], string> = {
  seed: "border-purple bg-purple",
  builds_on: "border-ink-soft bg-white",
  cited_by: "border-sky-deep bg-sky-soft",
  related: "border-line bg-canvas",
};

/** Oldest first; papers without a year go last (never given a guessed year). */
export function graphOrder(papers: XPaper[]): XPaper[] {
  return [...papers].sort((a, b) => {
    if (a.year == null || b.year == null) return a.year == null ? (b.year == null ? 0 : 1) : -1;
    return a.year - b.year || (a.is_seed ? 1 : 0) - (b.is_seed ? 1 : 0) || a.title.localeCompare(b.title);
  });
}

/**
 * Research graph: one vertical line through time, every paper a node branching off it on
 * alternating sides with its title, authors, year and abstract. Selecting a node highlights the
 * papers it is linked to by a real citation.
 */
export function ResearchGraph({ papers, edges, selected, onSelect }: {
  papers: XPaper[];
  edges: XEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ordered = React.useMemo(() => graphOrder(papers), [papers]);
  const near = React.useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const e of edges) {
      if (e.from === selected) s.add(e.to);
      if (e.to === selected) s.add(e.from);
    }
    return s.size > 1 ? s : null; // nothing linked: highlight the node only, never dim the whole graph
  }, [selected, edges]);
  const links = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1);
      m.set(e.to, (m.get(e.to) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  let lastYear: number | null | undefined;
  return (
    <ol className="relative mx-auto max-w-5xl px-3 py-6 sm:px-6" aria-label="Research graph" data-testid="research-graph">
      {/* the spine */}
      <span aria-hidden className="absolute bottom-0 left-[22px] top-0 w-0.5 bg-ink/15 md:left-1/2 md:-translate-x-1/2" />
      {ordered.map((p, i) => {
        const right = i % 2 === 0;
        const showYear = p.year !== lastYear;
        lastYear = p.year;
        const faded = !!near && !near.has(p.id);
        const on = selected === p.id;
        return (
          <li key={p.id} className="relative">
            {showYear && (
              <div className="relative z-10 mb-3 flex pl-11 md:justify-center md:pl-0">
                <span className="rounded-full bg-pill px-3 py-1 text-xs font-bold text-white">{p.year ?? "Year not reported"}</span>
              </div>
            )}
            <div className={cn("relative mb-6 flex items-center pl-11 md:pl-0", right ? "md:justify-end" : "md:justify-start")}>
              {/* node on the spine and its branch */}
              <span aria-hidden className={cn("absolute left-[14px] top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border-2 md:left-1/2 md:-translate-x-1/2",
                DOT[p.relation], on && "ring-4 ring-purple/30")} />
              <span aria-hidden className={cn("absolute top-1/2 hidden h-0.5 w-[calc(4%+12px)] bg-ink/20 md:block",
                right ? "left-1/2" : "right-1/2", on && "bg-purple")} />
              <button type="button" onClick={() => onSelect(on ? null : p.id)} aria-pressed={on}
                className={cn("w-full rounded-2xl border-2 bg-white p-4 text-left shadow-clay-sm transition hover:-translate-y-0.5 md:w-[46%]",
                  p.is_seed ? "border-purple" : "border-line", on && "ring-2 ring-purple", faded && "opacity-35")}>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={cn("rounded-full px-2 py-0.5 font-bold", p.is_seed ? "bg-purple text-white" : "bg-ink/5 text-ink-soft")}>{RELATION_LABEL[p.relation]}</span>
                  {p.category && <span className="rounded-full bg-lavender-soft px-2 py-0.5 font-semibold text-purple-deep">{p.category}</span>}
                  {(links.get(p.id) ?? 0) > 0 && <span className="text-muted">{links.get(p.id)} citation link{links.get(p.id) === 1 ? "" : "s"}</span>}
                </div>
                <p className="mt-2 font-display text-[15px] font-bold leading-snug">{p.title}</p>
                <p className="mt-1 text-xs text-ink-soft">{authorsLine(p)}<span className="text-muted"> ({p.year ?? "year not reported"})</span></p>
                <p className={cn("mt-2 text-[13px] leading-relaxed text-ink-soft", !on && "line-clamp-3")}>
                  {p.abstract ?? <span className="italic text-muted">No abstract available from the sources.</span>}
                </p>
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
