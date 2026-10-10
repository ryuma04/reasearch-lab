"use client";

import * as React from "react";
import { Quotes, X } from "@phosphor-icons/react";
import { neighbours, RELATION_LABEL } from "@/lib/explorer/timeline";
import type { XEdge, XFact, XPaper } from "@/lib/explorer/types";
import { Badge } from "@/components/ui/primitives";
import { SourceLink } from "@/components/workflow/source-link";

export function authorsLine(p: XPaper, max = 3): string {
  if (!p.authors.length) return "Authors not reported";
  return p.authors.slice(0, max).join(", ") + (p.authors.length > max ? ` and ${p.authors.length - max} more` : "");
}

function Facts({ title, items, empty }: { title: string; items: XFact[]; empty: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</p>
      {items.length ? (
        <ul className="mt-1 space-y-1.5">
          {items.map((f, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{f.text ?? f.name}{f.value ? `: ${f.value}` : ""}</span>
              <blockquote className="mt-0.5 flex gap-1.5 border-l-2 border-lavender pl-2 text-xs text-ink-soft"><Quotes size={11} className="mt-0.5 shrink-0" />{f.quote}</blockquote>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-muted">{empty}</p>}
    </div>
  );
}

/** Everything known about one paper. Facts shown with a quote were verified against the paper's own abstract. */
export function PaperDetail({ paper, byId, edges, onSelect, onClose }: { paper: XPaper; byId: Map<string, XPaper>; edges: XEdge[]; onSelect: (id: string) => void; onClose?: () => void }) {
  const nb = neighbours(paper.id, edges);
  const list = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is XPaper => !!p);
  const cites = list(nb.cites);
  const citedBy = list(nb.citedBy);
  return (
    <div className="space-y-3.5" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={paper.is_seed ? "purple" : "lavender"} solid={paper.is_seed}>{RELATION_LABEL[paper.relation]}</Badge>
            {paper.year != null && <Badge tone="faint">{paper.year}</Badge>}
            {paper.category && <Badge tone="sky" title={paper.category_source ?? undefined}>{paper.category}</Badge>}
          </div>
          <p className="mt-1.5 break-words font-display text-lg font-semibold leading-snug">{paper.title}</p>
          <p className="text-xs text-muted">{authorsLine(paper, 6)}{paper.venue ? ` · ${paper.venue}` : ""}{paper.citations != null ? ` · ${paper.citations.toLocaleString()} citations` : ""}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close details" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-ink/5"><X size={14} weight="bold" /></button>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {paper.url ? <SourceLink url={paper.url} kind="paper" label="Open the original publication ↗" /> : <span className="text-xs text-muted">No link to this publication was reported by the sources.</span>}
        {paper.arxiv_id && <SourceLink url={`https://arxiv.org/abs/${paper.arxiv_id}`} kind="paper" label={`arXiv:${paper.arxiv_id} ↗`} />}
        {paper.doi && <SourceLink url={`https://doi.org/${paper.doi}`} kind="paper" label={`DOI ${paper.doi} ↗`} />}
      </div>
      <p className="text-[11px] text-muted">Found via {paper.sources.length ? paper.sources.join(", ") : "the research analysis"}.</p>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Main contribution{paper.facts_by === "ai" && " (AI summary of the abstract)"}</p>
        <p className="mt-1 text-sm text-ink-soft">{paper.contribution ?? (paper.has_abstract ? "Not extracted." : "No abstract was available, so the contribution is not summarised.")}</p>
      </div>
      {paper.methodology.length > 0 && <div className="flex flex-wrap gap-1.5">{paper.methodology.map((m) => <Badge key={m} tone="cream">{m}</Badge>)}</div>}

      <Facts title="Reported limitations" items={paper.limitations} empty={paper.has_abstract ? "None stated in the abstract. This does not mean there are none." : "No abstract available."} />
      <Facts title="Future work mentioned" items={paper.future_work} empty="None stated in the abstract." />
      {paper.datasets.length > 0 && <Facts title="Datasets" items={paper.datasets} empty="" />}
      {paper.metrics.length > 0 && <Facts title="Reported metrics" items={paper.metrics} empty="" />}

      {(cites.length > 0 || citedBy.length > 0) && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Connections (from reference lists)</p>
          {cites.length > 0 && <ConnList label="Cites" papers={cites} onSelect={onSelect} />}
          {citedBy.length > 0 && <ConnList label="Cited by" papers={citedBy} onSelect={onSelect} />}
        </div>
      )}
      {paper.abstract && (
        <details className="rounded-lg border border-line p-2.5 text-sm"><summary className="cursor-pointer text-xs font-semibold">Abstract</summary><p className="mt-1.5 text-ink-soft">{paper.abstract}</p></details>
      )}
    </div>
  );
}

function ConnList({ label, papers, onSelect }: { label: string; papers: XPaper[]; onSelect: (id: string) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold">{label} ({papers.length})</p>
      <ul className="mt-0.5 space-y-0.5">
        {papers.slice(0, 8).map((p) => (
          <li key={p.id}><button type="button" onClick={() => onSelect(p.id)} className="w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-lavender-soft">{p.year ?? "n/a"} · {p.title}</button></li>
        ))}
        {papers.length > 8 && <li className="px-1.5 text-[11px] text-muted">and {papers.length - 8} more</li>}
      </ul>
    </div>
  );
}
