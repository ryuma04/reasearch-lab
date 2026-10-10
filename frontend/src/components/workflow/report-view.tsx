"use client";

import * as React from "react";
import { DownloadSimple, FileDoc, FileText, BracketsCurly } from "@phosphor-icons/react";
import { userMessage } from "@/lib/api/errors";
import { workspaceApi } from "@/lib/api/services";
import type { ResearchBrief } from "@/lib/api/types";
import { downloadReport, type ReportFormat } from "@/lib/workflow/report-export";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/content";
import { toast } from "@/components/ui/overlays";
import { Card } from "@/components/ui/primitives";
import { SourceLink, SourceTitle } from "./source-link";

type Brief = ResearchBrief & { brief_markdown: string | null };

const NOT_PRODUCED = ["problem statement", "research gaps", "supporting and contradictory evidence", "suggested experiments"];

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`rep-${n}`} className="border-t border-line-cool pt-4 first:border-0 first:pt-0">
      <h3 id={`rep-${n}`} className="font-display text-base font-semibold"><span className="mr-2 text-muted">{n}.</span>{title}</h3>
      <div className="mt-2 space-y-2 text-sm text-ink-soft">{children}</div>
    </section>
  );
}

export function ExportReportButtons({ runId, disabled }: { runId: string; disabled?: boolean }) {
  const [busy, setBusy] = React.useState<ReportFormat | null>(null);
  const go = async (f: ReportFormat) => {
    if (busy) return; // no duplicate requests
    setBusy(f);
    try {
      const name = await downloadReport(runId, f);
      toast.success("Report downloaded", name);
    } catch (e) {
      toast.error("Export failed", e instanceof Error ? e.message : userMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const items: { f: ReportFormat; label: string; Icon: React.ElementType }[] = [{ f: "md", label: "Markdown", Icon: FileText }, { f: "pdf", label: "PDF", Icon: FileDoc }, { f: "json", label: "JSON", Icon: BracketsCurly }];
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export the research report">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted"><DownloadSimple size={14} /> Export</span>
      {items.map(({ f, label, Icon }) => (
        <Button key={f} size="sm" variant="secondary" disabled={disabled || (busy !== null && busy !== f)} loading={busy === f} onClick={() => void go(f)}>
          <Icon size={14} /> {busy === f ? "Preparing…" : label}
        </Button>
      ))}
    </div>
  );
}

export function ReportView({ runId, brief, loading, error, researchRunning, ended, objective }: {
  runId: string; brief?: Brief; loading: boolean; error?: unknown; researchRunning: boolean; ended: boolean; objective?: string | null;
}) {
  const hasContent = !!brief && (!!brief.summary || brief.claims.length > 0 || brief.sources.length > 0 || !!brief.brief_markdown);
  let n = 0;
  return (
    <Card variant="bento" className="space-y-4 p-5" aria-label="Research report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-xl font-semibold">Research report</h2>
          <p className="text-xs text-muted">Built from what the research agents saved. Sections the agents did not produce are not shown.</p></div>
        <ExportReportButtons runId={runId} disabled={!hasContent} />
      </div>

      {loading ? <p className="text-sm text-muted">Loading the saved report…</p>
        : error ? <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">The report could not be loaded. Reload the page, or try again in a moment.</p>
        : !hasContent ? (
          <p className="rounded-xl bg-canvas p-4 text-sm text-ink-soft">
            {researchRunning ? "The report is being generated. It appears here as soon as the Paper Reader and Source Finder have saved their findings."
              : ended ? "No report was produced for this run: the research agents stopped before saving a brief."
              : "The research has not started yet."}
          </p>
        ) : (
          <div className="space-y-4">
            {objective && <Section n={++n} title="Research objective"><p className="whitespace-pre-wrap">{objective}</p></Section>}
            {brief!.summary && <Section n={++n} title="Paper summary"><p className="whitespace-pre-wrap">{brief!.summary}</p></Section>}
            {brief!.method.length > 0 && <Section n={++n} title="Methods and technical approach"><ol className="list-decimal space-y-1 pl-5">{brief!.method.map((m, i) => <li key={i}>{m}</li>)}</ol></Section>}
            {brief!.claims.length > 0 && (
              <Section n={++n} title="Key findings (results the paper reports)">
                <ul className="space-y-2">
                  {brief!.claims.map((c) => (
                    <li key={c.id} className="rounded-lg bg-canvas p-3">
                      <p className="font-semibold text-ink">{c.description}: <span className="tabular">{c.value}{c.unit ? ` ${c.unit}` : ""}</span></p>
                      <p className="text-xs text-muted">{c.page ? `Page ${c.page}` : "Page not located"}{c.table_ref ? ` · ${c.table_ref}` : ""}</p>
                      {c.quote && <blockquote className="mt-1 border-l-4 border-lavender pl-3 text-ink-soft">“{c.quote}”</blockquote>}
                      {c.page && <SourceLink url={`${workspaceApi.paperFileUrl(c.paper_id)}#page=${c.page}`} kind="paper" label="Open the paper at this page ↗" className="mt-1" />}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {brief!.sources.some((s) => s.kind === "dataset") && (
              <Section n={++n} title="Datasets">
                <ul className="space-y-1">{brief!.sources.filter((s) => s.kind === "dataset").map((s) => (
                  <li key={s.id}><SourceTitle title={s.title} url={s.url} /> <span className="text-xs text-muted">{[s.size, s.license && `licence ${s.license}`, s.notes].filter(Boolean).join(" · ")}</span> <SourceLink url={s.url} kind="dataset" className="ml-1" /></li>
                ))}</ul>
              </Section>
            )}
            {brief!.sources.some((s) => s.kind === "code") && (
              <Section n={++n} title="Code repositories">
                <ul className="space-y-1">{brief!.sources.filter((s) => s.kind === "code").map((s) => (
                  <li key={s.id}><SourceTitle title={s.title} url={s.url} /> <span className="text-xs text-muted">{[s.notes, s.license && `licence ${s.license}`].filter(Boolean).join(" · ")}</span> <SourceLink url={s.url} kind="repository" className="ml-1" /></li>
                ))}</ul>
              </Section>
            )}
            {brief!.sources.some((s) => s.relation === "cites this paper") && (
              <Section n={++n} title="Related work (papers that cite this paper)">
                <ul className="space-y-1">{brief!.sources.filter((s) => s.relation === "cites this paper").map((s) => (
                  <li key={s.id}><SourceTitle title={s.title} url={s.url} /> <span className="text-xs text-muted">{[s.year, s.citations != null && `${s.citations.toLocaleString()} citations`].filter(Boolean).join(" · ")}</span> <SourceLink url={s.url} kind="paper" className="ml-1" /></li>
                ))}</ul>
              </Section>
            )}
            {brief!.missing_details.length > 0 && <Section n={++n} title="Limitations and uncertainties (not stated in the paper)"><ul className="list-disc space-y-0.5 pl-5">{brief!.missing_details.map((m) => <li key={m.name}>{m.name}</li>)}</ul></Section>}
            {brief!.recommendation && <Section n={++n} title="Recommendation and implications for the Coding Plan"><p className="whitespace-pre-wrap">{brief!.recommendation}</p></Section>}

            <p className="border-t border-line-cool pt-3 text-xs text-muted">
              Not produced by the current research agents, so not shown: {NOT_PRODUCED.join(", ")}.
              {!ended && researchRunning ? " Sections can still appear while research is running." : ""}
            </p>
            {brief!.brief_markdown && (
              <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Original brief file (research/brief.md)</summary>
                <Markdown className="mt-2 text-sm">{brief!.brief_markdown}</Markdown></details>
            )}
          </div>
        )}
    </Card>
  );
}
