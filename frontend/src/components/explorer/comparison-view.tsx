"use client";

import * as React from "react";
import { CheckCircle, MinusCircle, Question, Quotes, Hourglass, XCircle } from "@phosphor-icons/react";
import type { CapabilityStatus, DescriptiveColumn, XCell, XComparison, XPaper } from "@/lib/explorer/types";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { SourceLink } from "@/components/workflow/source-link";

const STATUS: Record<CapabilityStatus, { label: string; short: string; Icon: React.ElementType; cls: string }> = {
  implemented_verified: { label: "Implemented and verified", short: "Implemented", Icon: CheckCircle, cls: "bg-success-soft text-success" },
  explicitly_not_implemented: { label: "Explicitly not implemented", short: "Not implemented", Icon: XCircle, cls: "bg-danger-soft text-danger" },
  not_reported: { label: "Not reported or unknown", short: "Not reported", Icon: Question, cls: "bg-ink/5 text-muted" },
  proposed_not_validated: { label: "Proposed but not validated", short: "Proposed", Icon: Hourglass, cls: "bg-warning-soft text-warning" },
};

const COLUMNS: { key: DescriptiveColumn; title: string }[] = [
  { key: "models", title: "Models, algorithms and technologies" },
  { key: "datasets", title: "Datasets and evaluation" },
  { key: "metrics", title: "Performance metrics" },
  { key: "strengths", title: "Strengths" },
  { key: "limitations", title: "Limitations" },
];

function Evidence({ cell, byId }: { cell: XCell; byId: Map<string, XPaper> }) {
  return (
    <div className="mt-1.5 space-y-1">
      {cell.evidence.map((e, i) => {
        const p = byId.get(e.paper_id);
        return (
          <blockquote key={i} className="flex gap-1.5 border-l-2 border-lavender pl-2 text-[11px] text-ink-soft"><Quotes size={10} className="mt-0.5 shrink-0" />
            <span>{e.quote}{p?.url && <> <SourceLink url={p.url} kind="paper" label="source ↗" className="ml-1" /></>}</span></blockquote>
        );
      })}
    </div>
  );
}

function StatusCell({ cell, byId }: { cell: XCell; byId: Map<string, XPaper> }) {
  const [open, setOpen] = React.useState(false);
  const m = STATUS[(cell.status in STATUS ? cell.status : "not_reported") as CapabilityStatus];
  const can = cell.evidence.length > 0 || !!cell.text;
  return (
    <div className="min-w-[130px]">
      <button type="button" disabled={!can} aria-expanded={can ? open : undefined} onClick={() => setOpen((o) => !o)} title={m.label}
        className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold", m.cls, can && "hover:brightness-95")}>
        <m.Icon size={13} weight="fill" /> {m.short}
      </button>
      {open && <div className="mt-1">{cell.text && <p className="text-xs text-ink-soft">{cell.text}</p>}<Evidence cell={cell} byId={byId} /></div>}
    </div>
  );
}

export function ComparisonView({ comparison, papers }: { comparison: XComparison; papers: XPaper[] }) {
  const byId = React.useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  if (!comparison.ai) {
    return <EmptyState title="The comparison needs an AI provider" body="Add a Groq or Gemini key, then refresh." />;
  }
  const filled = comparison.capabilities.length > 0 || COLUMNS.some((c) => Object.keys(comparison.descriptive[c.key] ?? {}).length > 0);
  if (!filled) return <EmptyState title="Nothing to compare" body="The abstracts had no quotable details." />;

  return (
    <div className="space-y-6">
      <Card variant="bento" className="flex flex-wrap items-center gap-2 p-3 text-xs" aria-label="Legend">
        <span className="font-bold text-muted">Status legend</span>
        {(Object.keys(STATUS) as CapabilityStatus[]).map((k) => { const m = STATUS[k]; return <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold", m.cls)}><m.Icon size={12} weight="fill" /> {m.label}</span>; })}
        <span className="text-muted">Not mentioned means not reported, not absent. Click a status to see its quote.</span>
      </Card>

      {comparison.capabilities.length > 0 && (
        <section aria-label="Capabilities by system" className="space-y-2">
          <h2 className="font-display text-lg font-semibold">Functionality by system</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-canvas text-xs">
                  <th className="sticky left-0 z-10 bg-canvas px-3 py-2.5">Capability</th>
                  {comparison.systems.map((s) => (
                    <th key={s.id} className="px-3 py-2.5 align-bottom font-semibold">
                      <span className="line-clamp-3 block max-w-[190px]">{s.name}</span>
                      <span className="text-[11px] font-normal text-muted">{s.year ?? "year unknown"}</span>
                      {s.is_uploaded && <Badge tone="purple" solid className="ml-1">your paper</Badge>}
                      {s.url && <div><SourceLink url={s.url} kind="paper" /></div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-cool">
                {comparison.capabilities.map((c) => (
                  <tr key={c.name}>
                    <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2.5 align-top font-semibold"><span className="block max-w-[180px]">{c.name}</span>{c.description && <span className="block text-[11px] font-normal text-muted">{c.description}</span>}</th>
                    {comparison.systems.map((s) => <td key={s.id} className="px-3 py-2.5 align-top"><StatusCell cell={c.cells[s.id] ?? { status: "not_reported", text: "", evidence: [] }} byId={byId} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {comparison.underexplored.length > 0 && (
        <section aria-label="Underexplored capabilities" className="space-y-2">
          <h2 className="font-display text-lg font-semibold">Missing or underexplored capabilities</h2>
          <ul className="space-y-2">
            {comparison.underexplored.map((u) => (
              <li key={u.capability} className="flex flex-wrap items-start gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
                <MinusCircle size={18} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1"><p className="font-semibold">{u.capability}</p><p className="text-xs text-ink-soft">{u.note} Verified in {u.implemented_in.length} of {comparison.systems.length} systems.</p></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {COLUMNS.map(({ key, title }) => (
        <section key={key} aria-label={title} className="space-y-2">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <tbody className="divide-y divide-line-cool">
                {comparison.systems.map((s) => {
                  const cell = comparison.descriptive[key]?.[s.id];
                  return (
                    <tr key={s.id}>
                      <th scope="row" className="w-[230px] bg-canvas px-3 py-2.5 align-top text-xs font-semibold"><span className="line-clamp-3">{s.name}</span><span className="font-normal text-muted">{s.year ?? ""}</span></th>
                      <td className="px-3 py-2.5 align-top">{cell ? <><p className="text-ink-soft">{cell.text}</p><Evidence cell={cell} byId={byId} /></> : <span className="text-xs text-muted">Not reported</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
