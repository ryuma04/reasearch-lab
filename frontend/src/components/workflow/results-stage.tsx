"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowSquareOut, CheckCircle, FileText, UploadSimple, Prohibit, WarningOctagon } from "@phosphor-icons/react";
import type { Run, RunEvent } from "@/lib/api/types";
import { useBrief, useGaps, useMe, useResearchMap, useRunFiles, useScorecard, useSettings, useTests, useWhatIfs } from "@/lib/hooks/queries";
import { buildExecutions, buildIncidents } from "@/lib/workflow/activity";
import type { StageKey } from "@/lib/workflow/state";
import { formatBytes, formatDuration } from "@/lib/utils";
import { whatIfStatusMeta } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/content";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, QueryView, Skeleton } from "@/components/ui/states";
import { ResearchMapView } from "@/components/run/research-map";
import { ScorecardTable } from "@/components/results/tabs";
import { summarize } from "./test-stage";

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "ok" | "bad" }) {
  return (
    <Card variant="bento" className="p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={`tabular font-display text-3xl font-bold ${tone === "bad" ? "text-danger" : tone === "ok" ? "text-success" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </Card>
  );
}

/** Final, persisted results. Everything here is read from the backend, so reopening the tab shows the same page. */
export function ResultsStage({ run, workspaceId, events, outcome, onOpen }: {
  run: Run; workspaceId: string; events: RunEvent[]; outcome: "succeeded" | "failed" | "stopped" | null; onOpen: (k: StageKey) => void;
}) {
  const runId = run.id;
  const scorecard = useScorecard(runId);
  const tests = useTests(runId);
  const files = useRunFiles(runId);
  const brief = useBrief(runId);
  const settings = useSettings(runId);
  const gaps = useGaps(runId);
  const whatifs = useWhatIfs(runId);
  const map = useResearchMap(runId);
  const me = useMe();

  const execs = React.useMemo(() => buildExecutions(events).filter((e) => !e.running), [events]);
  const incidents = React.useMemo(() => buildIncidents(events, outcome === "failed"), [events, outcome]);
  const t = tests.data ? summarize(tests.data.tests) : null;
  const sc = scorecard.data ?? [];
  const matched = sc.filter((e) => e.status === "match").length;
  const measured = sc.filter((e) => e.metric).length;
  const pushes = (me.data as unknown as { pushes?: { run_id: string; repo_url: string | null; status: string }[] } | undefined)?.pushes ?? [];
  const repo = pushes.find((p) => p.run_id === runId && p.status === "succeeded");
  const base = `/workspaces/${workspaceId}`;

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl p-5 ${outcome === "succeeded" ? "bg-success-soft" : outcome === "failed" ? "bg-danger-soft" : "bg-ink/5"}`}>
        {outcome === "succeeded" ? <CheckCircle size={28} weight="fill" className="text-success" /> : outcome === "failed" ? <WarningOctagon size={28} weight="fill" className="text-danger" /> : <Prohibit size={28} weight="fill" className="text-muted" />}
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold">{outcome === "succeeded" ? "The run finished" : outcome === "failed" ? "The run failed" : "The run was stopped"}</p>
          <p className="text-sm text-ink-soft">
            {outcome === "succeeded"
              ? sc.length ? `${matched} of ${sc.length} claims matched the paper${t && t.failed + t.error ? ` · ${t.failed + t.error} test${t.failed + t.error === 1 ? "" : "s"} failed` : ""}.` : "No claims were scored."
              : run.error || "No further reason was recorded. See the activity and logs below."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary"><Link href={`${base}/replay?run=${runId}`}>Replay the run</Link></Button>
          {outcome === "succeeded" && <Button asChild size="sm" variant="purple"><Link href={`${base}/publish?run=${runId}`}><UploadSimple size={15} /> Publish to Hugging Face</Link></Button>}
          {repo?.repo_url && <Button asChild size="sm" variant="outline"><a href={repo.repo_url} target="_blank" rel="noopener noreferrer"><ArrowSquareOut size={15} /> Repository</a></Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Summary">
        <Stat label="Claims matched" value={sc.length ? `${matched}/${sc.length}` : "—"} sub={measured < sc.length ? `${sc.length - measured} not measured` : "all measured"} tone={sc.length && matched === sc.length ? "ok" : undefined} />
        <Stat label="Tests" value={t ? `${t.passed}/${t.total}` : "—"} sub={t ? `${t.failed + t.error} failed · ${t.skipped} skipped` : "no report"} tone={t && t.failed + t.error ? "bad" : t && t.total ? "ok" : undefined} />
        <Stat label="Sandbox runs" value={execs.length} sub={`${execs.filter((e) => e.exitCode === 0).length} exited cleanly`} />
        <Stat label="Errors repaired" value={`${incidents.filter((i) => i.status === "verified").length}/${incidents.length}`} sub="verified by a clean re-run" />
        <Stat label="Files" value={files.data?.length ?? "—"} sub={files.data ? formatBytes(files.data.reduce((a, f) => a + (f.size_bytes ?? 0), 0)) : undefined} />
      </div>

      <section className="space-y-3"><SectionTitle kicker="Verified" title="Claim Scorecard" />
        <p className="text-xs text-muted">Measured numbers: each comes from metrics.json written by code that ran in the sandbox, with its run, code version and log line.</p>
        <QueryView query={scorecard} feature="Claim Scorecard" isEmpty={(x) => !x.length} empty={<EmptyState title="No claims were scored" body="The run did not reach scoring, so nothing is shown rather than guessing." />}>
          {(entries) => <ScorecardTable entries={entries} />}
        </QueryView>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card variant="bento" className="space-y-2 p-5"><p className="font-display text-lg font-bold">Approved plan (settings used)</p>
          {settings.isPending ? <Skeleton className="h-24" /> : (
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">{(settings.data ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2"><code className="text-xs">{s.name}</code> = <b>{s.value}</b>
                {s.source_ref === "changed by the researcher" ? <Badge tone="sun">edited by you</Badge> : null}
                {s.paper_value && s.paper_value !== s.value ? <span className="text-xs text-muted">paper: {s.paper_value}</span> : null}</li>
            ))}</ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpen("plan")}>Open the plan</Button></Card>
        <Card variant="bento" className="space-y-2 p-5"><p className="font-display text-lg font-bold">Generated files</p>
          {files.isPending ? <Skeleton className="h-24" /> : (
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">{(files.data ?? []).map((f) => (
              <li key={f.path} className="flex items-center gap-2"><FileText size={14} className="text-muted" /><code className="min-w-0 flex-1 truncate text-xs">{f.path}</code><span className="text-[11px] text-muted">{formatBytes(f.size_bytes)}</span></li>
            ))}</ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpen("coding")}>Open the code and logs</Button></Card>
      </div>

      {(gaps.data?.explanation || (whatifs.data?.length ?? 0) > 0) && (
        <section className="space-y-3"><SectionTitle kicker="Explained" title="Differences and what-ifs" />
          {gaps.data?.explanation && <Card variant="bento" className="p-5 text-sm"><p className="font-bold">Why a result differs</p><p className="mt-1 text-ink-soft">{gaps.data.explanation}</p>
            <p className="mt-2 text-xs text-muted">AI-written explanation. Numbers inside were checked against recorded runs.</p></Card>}
          {(whatifs.data ?? []).length > 0 && (
            <ul className="space-y-2">{whatifs.data!.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 text-sm shadow-sm"><span className="min-w-0 flex-1 font-semibold">{b.question}</span>
                <Badge tone={whatIfStatusMeta[b.status].tone}>{whatIfStatusMeta[b.status].label}</Badge>{b.result_metric && <span className="tabular font-bold">{b.result_metric.value}</span>}</li>
            ))}</ul>
          )}
        </section>
      )}

      <section className="space-y-3"><SectionTitle kicker="Everything found" title="Research map" />
        {map.data && map.data.nodes.length ? <ResearchMapView map={map.data} /> : <EmptyState title="No map was recorded" />}</section>

      {brief.data?.brief_markdown && (
        <details className="rounded-2xl border border-line bg-white p-4"><summary className="cursor-pointer font-display font-bold">Research Brief (AI-written summary)</summary>
          <Markdown className="mt-3 text-sm">{brief.data.brief_markdown}</Markdown></details>
      )}

      {execs.length > 0 && <p className="text-xs text-muted">Total sandbox time: {formatDuration(execs.reduce((a, e) => a + (e.durationSec ?? 0), 0))} across {execs.length} runs.</p>}
    </div>
  );
}
