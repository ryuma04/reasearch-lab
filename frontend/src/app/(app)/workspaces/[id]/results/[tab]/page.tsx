"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { motion } from "motion/react";
import { DownloadSimple, GithubLogo, SpeakerHigh } from "@phosphor-icons/react";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { useBriefing, useScorecard } from "@/lib/hooks/queries";
import { runApi } from "@/lib/api/services";
import { isApiError } from "@/lib/api/errors";
import { useSelectedRun } from "@/components/run/workspace-header";
import { CodingTab, MemoryTab, NotesTab, ResearchTab, ScorecardTab, AgentsTab, TestingTab, WhatIfTab } from "@/components/results/tabs";
import { claimStatusMeta, runStatusMeta } from "@/lib/status";
import { cn, formatDateTime, shortId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";

const TABS = ["research", "coding", "testing", "scorecard", "whatifs", "agents", "memory", "notes"] as const;
const LABEL: Record<(typeof TABS)[number], string> = { research: "Research", coding: "Coding", testing: "Testing", scorecard: "Scorecard", whatifs: "What-ifs", agents: "Agents", memory: "Memory", notes: "Notes" };

export default function ResultsPage() {
  const { id, tab } = useParams<{ id: string; tab: string }>();
  const { runId, run, ws } = useSelectedRun(id);
  const stream = useRunStream(runId ? { runId } : null, run ? !["succeeded", "failed", "stopped"].includes(run.status) : true);
  const sc = useScorecard(runId);
  const briefing = useBriefing(runId);
  if (!(TABS as readonly string[]).includes(tab)) notFound();
  if (!runId) return tab === "notes" ? <NotesTab workspaceId={id} /> : <EmptyState title="No run yet" body="Results appear after the first run." />;
  const q = `?run=${encodeURIComponent(runId)}`;
  const readOnly = ws.data?.role === "viewer";
  const counts = (sc.data ?? []).reduce<Record<string, number>>((a, e) => ({ ...a, [e.status ?? "unverified"]: (a[e.status ?? "unverified"] ?? 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Run summary · traceable</p>
          <p className="mt-1 text-sm">Run <code className="font-mono">{shortId(runId, 10)}</code>{run?.git_commit && <> · commit <code className="font-mono">{shortId(run.git_commit)}</code></>}{run?.branch_name && <> · {run.branch_name}</>} · finished {formatDateTime(run?.finished_at)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {run && <Badge tone={runStatusMeta[run.status].tone} solid>{runStatusMeta[run.status].label}</Badge>}
            {sc.data && (["match", "close", "different", "unverified"] as const).map((k) => counts[k] ? <Badge key={k} tone={claimStatusMeta[k].tone}>{counts[k]} {claimStatusMeta[k].label}</Badge> : null)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary"><a href={runApi.reportUrl(runId, "md")} download><DownloadSimple size={16} /> Report .md</a></Button>
          <Button asChild size="sm" variant="secondary"><a href={runApi.reportUrl(runId, "pdf")} download><DownloadSimple size={16} /> Report .pdf</a></Button>
          <Button asChild size="sm"><Link href={`/workspaces/${id}/publish${q}`}><GithubLogo size={16} /> Publish</Link></Button>
        </div>
        {briefing.data?.audio_url ? (
          <div className="w-full"><p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-muted"><SpeakerHigh size={14} /> Audio briefing</p><audio controls src={briefing.data.audio_url} className="w-full" /></div>
        ) : briefing.error && isApiError(briefing.error) && briefing.error.kind === "unavailable" ? (
          <p className="w-full text-xs text-muted">Audio briefing: endpoint <code>GET /runs/{"{id}"}/briefing</code> not available yet.</p>
        ) : null}
      </Card>

      <nav className="-mx-1 flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-clay-sm" aria-label="Result tabs">
        {TABS.map((t) => (
          <Link key={t} href={`/workspaces/${id}/results/${t}${q}`} aria-current={tab === t ? "page" : undefined} className={cn("relative inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold", tab === t ? "text-ink" : "text-ink-soft hover:text-ink")}>
            {tab === t && <motion.span layoutId="results-tab" className="absolute inset-0 rounded-full bg-sun" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className="relative">{LABEL[t as keyof typeof LABEL]}</span>
          </Link>
        ))}
      </nav>

      {tab === "research" && <ResearchTab runId={runId} />}
      {tab === "coding" && <CodingTab runId={runId} events={stream.events} />}
      {tab === "testing" && <TestingTab runId={runId} />}
      {tab === "scorecard" && <ScorecardTab runId={runId} workspaceId={id} />}
      {tab === "whatifs" && <WhatIfTab runId={runId} readOnly={readOnly} />}
      {tab === "agents" && <AgentsTab events={stream.events} />}
      {tab === "memory" && <MemoryTab runId={runId} />}
      {tab === "notes" && <NotesTab workspaceId={id} readOnly={readOnly} />}
    </div>
  );
}
