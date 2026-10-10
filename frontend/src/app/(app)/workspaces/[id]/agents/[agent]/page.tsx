"use client";

import { useParams } from "next/navigation";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { useAgents } from "@/lib/hooks/queries";
import { agentKey } from "@/lib/run-state";
import { useSelectedRun } from "@/components/run/workspace-header";
import { AgentCard, EventFeed } from "@/components/run/board";
import { humanize } from "@/lib/utils";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, SkeletonList } from "@/components/ui/states";

/** "Clicking an agent card opens its full work in a new browser tab" (§25.6). */
export default function AgentWorkPage() {
  const { id, agent } = useParams<{ id: string; agent: string }>();
  const key = decodeURIComponent(agent);
  const { runId } = useSelectedRun(id);
  const s = useRunStream(runId ? { runId } : null);
  const agents = useAgents();
  const reg = agents.data?.find((a) => a.event_key === key);
  const card = s.board.agents.find((a) => a.key === key);
  const mine = s.events.filter((e) => agentKey(e.agent) === key);
  if (!runId) return <EmptyState title="No run selected" />;
  return (
    <div className="space-y-5">
      <SectionTitle kicker="Agent's full work" title={reg?.name ?? humanize(key)} action={reg && <Badge tone="lavender">{reg.kind} · {reg.stage}</Badge>} />
      {reg?.current_version && <Card variant="bento" className="p-5 text-sm"><p className="font-bold">Instructions (v{reg.current_version.id})</p><p className="mt-1 text-ink-soft">{reg.current_version.instructions}</p><p className="mt-2 text-xs text-muted">Model {reg.current_version.model} · tools {reg.current_version.tools.join(", ")}</p></Card>}
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div>{card ? <AgentCard card={card} runId={runId} workspaceId={id} /> : s.historyLoading ? <SkeletonList rows={1} /> : <EmptyState title="No activity for this agent" />}</div>
        <Card variant="bento"><div className="border-b border-line-cool px-5 py-3"><p className="font-display font-bold">All events ({mine.length})</p></div><EventFeed events={mine} max={500} /></Card>
      </div>
    </div>
  );
}
