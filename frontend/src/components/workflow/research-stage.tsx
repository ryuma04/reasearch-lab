"use client";

import * as React from "react";
import { ArrowRight, FilePdf, Quotes, X } from "@phosphor-icons/react";
import type { Claim, MapNode, ResearchMap, RunEvent } from "@/lib/api/types";
import { workspaceApi } from "@/lib/api/services";
import { useBrief, useResearchMap, useResources } from "@/lib/hooks/queries";
import { metaFacts, sourceKindOf } from "@/lib/sources";
import { rawType, type StageKey } from "@/lib/workflow/state";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ResearchMapView } from "@/components/run/research-map";
import { ActivityTimeline } from "./shared";
import { AgentSequence } from "./agent-sequence";
import { ReportView } from "./report-view";
import { SourceLink } from "./source-link";
import type { AgentInfo } from "./types";

const RESEARCH_KINDS = new Set(["paper", "claim", "source", "dataset", "related"]);

/** Everything before the plan approval gate belongs to Research & Planning. */
export function researchEvents(events: RunEvent[]): RunEvent[] {
  const gate = events.findIndex((e) => rawType(e) === "checkpoint_waiting" && e.links?.checkpoint === "plan");
  return gate === -1 ? events : events.slice(0, gate + 1);
}

/** Only what the research agents discovered, and the links between those things. */
export function researchGraph(map: ResearchMap): ResearchMap {
  const ids = new Set(map.nodes.filter((n) => RESEARCH_KINDS.has(n.kind)).map((n) => n.id));
  return { ...map, nodes: map.nodes.filter((n) => ids.has(n.id)), edges: map.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

function NodeDetail({ node, map, claim, onSelect, onClose }: { node: MapNode; map: ResearchMap; claim?: Claim; onSelect: (id: string) => void; onClose: () => void }) {
  const kind = sourceKindOf(node.source_type, node.kind);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const links = map.edges.filter((e) => e.from === node.id || e.to === node.id);
  const facts = metaFacts(node.meta);
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="lavender">{node.kind === "related" ? "related paper" : node.source_type ?? node.kind}</Badge>
            <Badge tone={node.status === "problem" ? "pink" : node.status === "done" ? "mint" : "faint"}>{node.status}</Badge></div>
          <p className="mt-1.5 break-words font-display text-base font-semibold leading-snug">{node.label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Back to the graph overview" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-ink/5"><X size={14} weight="bold" /></button>
      </div>

      {node.url ? (
        <div className="rounded-lg bg-canvas p-2.5"><p className="truncate text-[11px] text-muted" title={node.url}>{node.url}</p><SourceLink url={node.url} kind={kind} /></div>
      ) : node.kind === "paper" || node.kind === "related" || node.kind === "source" ? (
        <p className="rounded-lg bg-canvas p-2.5 text-xs text-muted">No web link was reported for this source, so none is shown.</p>
      ) : null}
      {facts.length > 0 && <p className="text-xs text-ink-soft">{facts.join(" · ")}</p>}
      {node.detail && <p className="text-sm text-ink-soft">{node.detail}</p>}

      {claim && (
        <div className="space-y-1.5 rounded-lg bg-canvas p-2.5 text-sm">
          <p><b>Reported value:</b> {claim.value}{claim.unit ? ` ${claim.unit}` : ""}{claim.tolerance != null ? ` · match if within ±${Math.round(claim.tolerance * 100)}%` : ""}</p>
          <p className="text-xs text-muted">{claim.page ? `Page ${claim.page}` : "Page not located"}{claim.table_ref ? ` · ${claim.table_ref}` : ""}</p>
          {claim.quote && <blockquote className="flex gap-2 border-l-4 border-lavender pl-3 text-ink-soft"><Quotes size={13} className="mt-1 shrink-0" />{claim.quote}</blockquote>}
          {claim.page && <a className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-deep underline" target="_blank" rel="noopener noreferrer" href={`${workspaceApi.paperFileUrl(claim.paper_id)}#page=${claim.page}`}><FilePdf size={13} /> Open the paper at page {claim.page} ↗</a>}
        </div>
      )}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Relationships ({links.length})</p>
        {links.length ? (
          <ul className="mt-1 space-y-1">
            {links.map((e, i) => {
              const otherId = e.from === node.id ? e.to : e.from;
              const other = byId.get(otherId);
              return (
                <li key={`${e.id}-${i}`}>
                  <button type="button" onClick={() => onSelect(otherId)} className="w-full rounded-lg bg-white px-2.5 py-1.5 text-left text-sm shadow-sm hover:bg-lavender-soft">
                    <span className="text-muted">{e.from === node.id ? "→" : "←"} {e.label || "related to"}</span> <b>{other?.label ?? otherId}</b>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-1 text-sm text-muted">The agents reported no relationships for this item, so none are drawn.</p>}
      </div>
    </div>
  );
}

export function ResearchGraphPanel({ runId, map }: { runId: string; map: ResearchMap }) {
  const brief = useBrief(runId);
  const resources = useResources(runId);
  const decisions = Object.fromEntries((resources.data?.recommendations ?? []).filter((r) => r.decision).map((r) => [r.id, r.decision!.decision]));
  const [selId, setSelId] = React.useState<string | null>(null);
  const sel = selId ? map.nodes.find((n) => n.id === selId) ?? null : null;
  const claim = sel?.kind === "claim" ? brief.data?.claims.find((c) => sel.label.startsWith(c.description.slice(0, 40))) : undefined;
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_340px]">
      <ResearchMapView map={map} onSelect={(n) => setSelId(n.id)} selected={selId} decisions={decisions} />
      <Card variant="bento" className="h-fit p-4">
        {sel ? <NodeDetail node={sel} map={map} claim={claim} onSelect={setSelId} onClose={() => setSelId(null)} /> : (
          <div className="space-y-2 text-sm"><p className="font-display text-base font-semibold">Evidence</p>
            <p className="text-muted">Select a card to see where it comes from, open the original source, and follow its relationships.</p>
            <p className="text-xs text-muted">{map.nodes.length} items · {map.edges.length} relationships reported by the agents.</p></div>
        )}
      </Card>
    </div>
  );
}

export function ResearchStage({ runId, events, agents, ended, researchDone, running, onOpen, objective }: {
  runId: string; events: RunEvent[]; agents: AgentInfo[]; ended: boolean; researchDone: boolean; running: boolean; onOpen: (k: StageKey) => void; objective?: string | null;
}) {
  const map = useResearchMap(runId);
  const brief = useBrief(runId);
  const research = React.useMemo(() => agents.filter((a) => a.group === "research"), [agents]);
  const scoped = React.useMemo(() => researchEvents(events), [events]);
  const graph = React.useMemo(() => (map.data ? researchGraph(map.data) : null), [map.data]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-4" aria-label="Research agents">
          <h2 className="font-display text-lg font-semibold">Research agents</h2>
          <AgentSequence events={events} agents={research} ended={ended} brief={brief.data} />
          <details className="rounded-xl border border-line bg-white">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">Activity log ({scoped.length})</summary>
            <div className="max-h-96 overflow-y-auto border-t border-line-cool"><ActivityTimeline events={scoped} empty="The run is queued. Activity appears here as soon as the research agents start." /></div>
          </details>
        </section>
        <section className="min-w-0 space-y-3" aria-label="Research graph">
          <h2 className="font-display text-lg font-semibold">Research graph</h2>
          {map.isPending ? <Skeleton className="h-[420px]" /> : map.error ? <ErrorState error={map.error} title="Research graph" onRetry={() => void map.refetch()} /> :
            graph && graph.nodes.length ? <ResearchGraphPanel runId={runId} map={graph} /> : (
              <EmptyState title="Research evidence is still being collected" body="The graph fills in as the Paper Reader finds claims and the Source Finder finds datasets, code and related papers. Nothing is drawn until it exists." />
            )}
        </section>
      </div>

      <ReportView runId={runId} brief={brief.data} loading={brief.isPending} error={brief.error} researchRunning={running} ended={ended} objective={objective} />

      {researchDone && (
        <div className="flex justify-end"><Button variant="purple" size="lg" onClick={() => onOpen("plan")}>Continue to the Coding Plan <ArrowRight size={18} weight="bold" /></Button></div>
      )}
    </div>
  );
}
