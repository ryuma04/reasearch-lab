"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import type { MapNode } from "@/lib/api/types";
import { useBrief, useResearchMap } from "@/lib/hooks/queries";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { useSelectedRun } from "@/components/run/workspace-header";
import { CheckpointPanel } from "@/components/run/board";
import { MapLegend, ResearchMapView } from "@/components/run/research-map";
import { Markdown } from "@/components/ui/content";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, ErrorState, QueryView, Skeleton } from "@/components/ui/states";

export default function MapPage() {
  const { id } = useParams<{ id: string }>();
  const { runId } = useSelectedRun(id);
  const map = useResearchMap(runId);
  const brief = useBrief(runId);
  const s = useRunStream(runId ? { runId } : null);
  const [sel, setSel] = React.useState<MapNode | null>(null);
  const plan = s.board.pendingCheckpoints.find((c) => c.name.includes("plan"));

  if (!runId) return <EmptyState title="No run yet" body="The Observer draws the map once a run starts." />;

  return (
    <div className="space-y-5">
      {plan && (
        <CheckpointPanel runId={runId} checkpoint={plan}>
          <p className="mt-2 text-sm text-muted">Checkpoint 1: no code is written until you approve this plan.</p>
        </CheckpointPanel>
      )}
      <div className="space-y-3">
        <MapLegend />
        <QueryView query={map} feature="Research map" skeleton={<Skeleton className="h-[68vh]" />} isEmpty={(m) => !m.nodes.length} empty={<EmptyState title="Map is empty" body="The Observer adds cards as the agents report what they found and made." />}>
          {(m) => <ResearchMapView map={m} onSelect={setSel} selected={sel?.id} />}
        </QueryView>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card variant="bento" className="h-fit p-5">
          <SectionTitle title={sel ? sel.label : "Select a card"} kicker={sel ? sel.kind : "Details"} />
          {sel ? (
            <>
              <div className="mt-2 flex items-center gap-2"><Badge tone="lavender">{sel.kind}</Badge><Badge>{sel.status}</Badge></div>
              {sel.detail ? <p className="mt-2 text-sm text-muted">{sel.detail}</p> : <p className="mt-2 text-sm text-muted">Its links are highlighted on the map.</p>}
            </>
          ) : <p className="mt-2 text-sm text-muted">Click any card to highlight what it is connected to. Drag to move, scroll to zoom.</p>}
        </Card>
        <Card className="h-fit p-5">
          <SectionTitle title="Proposed plan" kicker="Rationale" />
          {brief.isPending ? <Skeleton className="mt-4 h-40" /> : brief.error ? <div className="mt-4"><ErrorState error={brief.error} title="Research brief" onRetry={() => void brief.refetch()} /></div> : brief.data && (
            <div className="mt-3 space-y-4 text-sm">
              {brief.data.plan?.length ? <ol className="list-decimal space-y-1 pl-5">{brief.data.plan.map((p) => <li key={p}>{p}</li>)}</ol> : null}
              {brief.data.recommendation && <p className="rounded-2xl bg-lavender-soft p-3 text-purple-deep"><b>Recommendation:</b> {brief.data.recommendation}</p>}
              {brief.data.brief_markdown
                ? <div className="max-h-[420px] overflow-y-auto rounded-2xl bg-canvas p-4"><Markdown className="text-sm">{brief.data.brief_markdown}</Markdown></div>
                : !brief.data.recommendation && <p className="text-muted">The Research Agent has not written the brief yet.</p>}
              {brief.data.claims.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Claims to check</p><ul className="mt-1 space-y-1">{brief.data.claims.map((c) => <li key={c.id}>{c.description} — <b>{c.value}</b>{c.page ? <span className="text-muted"> (p.{c.page})</span> : null}</li>)}</ul></div>}
              {brief.data.missing_details.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Missing details</p><ul className="mt-1 space-y-1">{brief.data.missing_details.map((m) => <li key={m.name}><b>{m.name}</b>: {m.note}{m.assumed_value && <> → assume <code>{m.assumed_value}</code></>}</li>)}</ul></div>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
