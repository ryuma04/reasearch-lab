"use client";

import { useParams } from "next/navigation";
import { Eye } from "@phosphor-icons/react";
import { useSharedScorecard, useSharedView } from "@/lib/hooks/queries";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { Logo } from "@/components/shell/logo";
import { AgentCard, ConnectionPill, EventFeed, StageBar } from "@/components/run/board";
import { ScorecardTable } from "@/components/results/tabs";
import { formatDateTime } from "@/lib/utils";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, ErrorState, QueryView, SkeletonList } from "@/components/ui/states";

/** Read-only live view opened by QR (Hero 11). No controls; access is enforced by the backend token. */
export default function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const view = useSharedView(token);
  const sharedRunId = view.data?.run?.id ?? null;
  const s = useRunStream(sharedRunId ? { share: token, runId: sharedRunId } : null);
  const sc = useSharedScorecard(token, sharedRunId);

  return (
    <div className="min-h-dvh bg-dots-cool">
      <header className="border-b border-ink/5 bg-canvas-cool/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo href="/" />
          <Badge tone="sky" solid><Eye size={12} weight="bold" /> Read-only live view</Badge>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {view.isPending ? <SkeletonList /> : view.error ? <ErrorState error={view.error} title="This share link is invalid or has expired" /> : view.data && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Shared workspace</p><h1 className="text-2xl font-semibold sm:text-3xl">{view.data.workspace.title}</h1>
                {view.data.expires_at && <p className="text-xs text-muted">Link expires {formatDateTime(view.data.expires_at)}</p>}</div>
              {view.data.run && <ConnectionPill state={s.state} stale={s.stale} />}
            </div>
            {!view.data.run ? <EmptyState title="No run has started yet" /> : (
              <>
                <StageBar stage={s.board.stage} finished={s.board.finished} />
                <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
                  <div className="grid gap-4 md:grid-cols-2">{s.board.agents.map((a) => <AgentCard key={a.key} card={a} runId={view.data!.run!.id} workspaceId={view.data!.workspace.id} readOnly />)}</div>
                  <Card variant="bento" className="max-h-[60vh] overflow-y-auto"><EventFeed events={s.events} /></Card>
                </div>
                <section><SectionTitle title="Claim Scorecard" />
                  <div className="mt-4"><QueryView query={sc} feature="Shared scorecard" isEmpty={(x) => !x.length}>{(entries) => <ScorecardTable entries={entries} />}</QueryView></div></section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
