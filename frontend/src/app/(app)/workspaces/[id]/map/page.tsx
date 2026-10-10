"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { DownloadSimple } from "@phosphor-icons/react";
import type { MapNode } from "@/lib/api/types";
import { useBrief, useResearchMap } from "@/lib/hooks/queries";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { useSelectedRun } from "@/components/run/workspace-header";
import { CheckpointPanel } from "@/components/run/board";
import { MapLegend, ResearchMapView } from "@/components/run/research-map";
import { Button } from "@/components/ui/button";
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

  const exportSvg = () => {
    const svg = document.querySelector("[aria-label^='Research map'] ") as SVGElement | null;
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `research-map-${runId}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      {plan && (
        <CheckpointPanel runId={runId} checkpoint={plan}>
          <p className="mt-2 text-sm text-muted">Checkpoint 1: no code is written until you approve this plan.</p>
        </CheckpointPanel>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MapLegend />
            <Button size="sm" variant="secondary" onClick={exportSvg} disabled={!map.data}><DownloadSimple size={16} /> Export image</Button>
          </div>
          <QueryView query={map} feature="Research map" skeleton={<Skeleton className="aspect-[3/2]" />} isEmpty={(m) => !m.nodes.length} empty={<EmptyState title="Map is empty" body="The Observer adds nodes as agents report findings." />}>
            {(m) => <ResearchMapView map={m} onSelect={setSel} selected={sel?.id} />}
          </QueryView>
          {sel && (
            <Card variant="bento" className="p-4">
              <div className="flex items-center gap-2"><Badge tone="lavender">{sel.kind}</Badge><Badge>{sel.status}</Badge></div>
              <p className="mt-2 font-semibold">{sel.label}</p>
              {sel.detail && <p className="mt-1 text-sm text-muted">{sel.detail}</p>}
            </Card>
          )}
        </div>
        <Card className="h-fit p-5">
          <SectionTitle title="Proposed plan" kicker="Rationale" />
          {brief.isPending ? <Skeleton className="mt-4 h-40" /> : brief.error ? <div className="mt-4"><ErrorState error={brief.error} title="Research brief" onRetry={() => void brief.refetch()} /></div> : brief.data && (
            <div className="mt-3 space-y-4 text-sm">
              {brief.data.plan?.length ? <ol className="list-decimal space-y-1 pl-5">{brief.data.plan.map((p) => <li key={p}>{p}</li>)}</ol> : null}
              <p className="rounded-2xl bg-lavender-soft p-3 text-purple-deep"><b>Recommendation:</b> {brief.data.recommendation}</p>
              {brief.data.skills?.length ? <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Skills list</p><div className="mt-1 flex flex-wrap gap-1">{brief.data.skills.map((k) => <Badge key={k} tone="sky">{k}</Badge>)}</div></div> : null}
              {brief.data.missing_details.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Missing details</p><ul className="mt-1 space-y-1">{brief.data.missing_details.map((m) => <li key={m.name}><b>{m.name}</b>: {m.note}{m.assumed_value && <> → assume <code>{m.assumed_value}</code></>}</li>)}</ul></div>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
