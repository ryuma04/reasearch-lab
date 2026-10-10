"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Coins, Timer, CheckCircle } from "@phosphor-icons/react";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { useSelectedRun } from "@/components/run/workspace-header";
import { AgentCard, CheckpointPanel, ConnectionPill, EventFeed, StageBar } from "@/components/run/board";
import { formatDuration, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, StatCard } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/states";

export default function LiveBoardPage() {
  const { id } = useParams<{ id: string }>();
  const { runId, ws } = useSelectedRun(id);
  const s = useRunStream(runId ? { runId } : null);
  const q = runId ? `?run=${encodeURIComponent(runId)}` : "";

  if (ws.isPending) return <SkeletonList />;
  if (!runId) return <EmptyState title="No run yet" body="Start a run from the workspace overview." action={<Button asChild><Link href={`/workspaces/${id}`}>Go to overview</Link></Button>} />;
  const { board } = s;
  const readOnly = ws.data?.role === "viewer";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StageBar stage={board.stage} finished={board.finished} />
        <ConnectionPill state={s.state} stale={s.stale} />
      </div>

      {board.finished === "succeeded" && (
        <div className="flex flex-wrap items-center gap-3 rounded-[24px] border-2 border-ink bg-mint p-4 shadow-pop">
          <CheckCircle size={24} weight="fill" />
          <p className="flex-1 font-semibold">All agents have finished. The board is now the Results page.</p>
          <Button asChild><Link href={`/workspaces/${id}/results/scorecard${q}`}>Open results <ArrowRight size={16} weight="bold" /></Link></Button>
        </div>
      )}

      {board.pendingCheckpoints.map((c) => (
        <CheckpointPanel key={c.name} runId={runId} checkpoint={c}>
          {c.name.includes("plan") && <p className="mt-2 text-sm"><Link href={`/workspaces/${id}/map${q}`} className="font-semibold text-purple-deep underline">Review the Research Map and plan first →</Link></p>}
        </CheckpointPanel>
      ))}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Agents active" value={board.agents.filter((a) => a.status === "working").length} hint={`${board.agents.length} on this run's team`} tone="sky" />
        <StatCard label="AI tokens so far" value={formatNumber(board.totals.tokens)} tone="lavender" icon={<Coins size={18} weight="duotone" />} hint="Summed from event cost fields" />
        <StatCard label="Sandbox time" value={formatDuration(board.totals.sandboxSeconds)} tone="mint" icon={<Timer size={18} weight="duotone" />} />
      </div>

      {s.historyError ? <ErrorState error={s.historyError} title="Saved events" /> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section aria-label="Agents">
          {s.historyLoading && !board.agents.length ? (
            <SkeletonList rows={3} />
          ) : board.agents.length === 0 ? (
            <EmptyState title="Waiting for the Team Manager" body="Agent cards appear as soon as the backend reports activity." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {board.agents.map((a) => <AgentCard key={a.key} card={a} runId={runId} workspaceId={id} readOnly={readOnly} />)}
            </div>
          )}
        </section>
        <Card variant="bento" className="max-h-[70vh] overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-line-cool bg-white px-4 py-3"><p className="font-display text-sm font-bold">Event stream</p></div>
          <EventFeed events={s.events} />
        </Card>
      </div>
    </div>
  );
}
