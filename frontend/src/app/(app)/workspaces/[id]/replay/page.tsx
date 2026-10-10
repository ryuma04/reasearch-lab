"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Pause, Play, Rewind } from "@phosphor-icons/react";
import { useRunEvents } from "@/lib/hooks/queries";
import { deriveBoard } from "@/lib/run-state";
import { useSelectedRun } from "@/components/run/workspace-header";
import { AgentCard, EventFeed, StageBar } from "@/components/run/board";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { EmptyState, QueryView } from "@/components/ui/states";

const SPEEDS = [1, 4, 16];

/** Run Replay (Hero 11): plays saved events from GET /runs/{id}/events on their real timeline. */
export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { runId } = useSelectedRun(id);
  const events = useRunEvents(runId);
  if (!runId) return <EmptyState title="No run to replay" />;
  return (
    <QueryView query={events} feature="Run replay" isEmpty={(e) => !e.length} empty={<EmptyState title="No saved events" />}>
      {(list) => <Player events={[...list].sort((a, b) => a.time.localeCompare(b.time))} runId={runId} workspaceId={id} />}
    </QueryView>
  );
}

function Player({ events, runId, workspaceId }: { events: Parameters<typeof deriveBoard>[0]; runId: string; workspaceId: string }) {
  const t0 = Date.parse(events[0]!.time);
  const tEnd = Date.parse(events.at(-1)!.time);
  const duration = Math.max(1, tEnd - t0);
  const [pos, setPos] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(4);

  React.useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setPos((p) => {
        const next = p + (now - last) * speed;
        if (next >= duration) { setPlaying(false); return duration; }
        return next;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const visible = events.filter((e) => Date.parse(e.time) - t0 <= pos);
  const board = deriveBoard(visible);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="icon" variant="outline" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (pos >= duration) setPos(0); setPlaying((p) => !p); }}>{playing ? <Pause size={20} weight="bold" /> : <Play size={20} weight="bold" />}</Button>
          <Button size="icon-sm" variant="secondary" aria-label="Restart" onClick={() => { setPos(0); setPlaying(false); }}><Rewind size={16} weight="bold" /></Button>
          <div className="flex gap-1">{SPEEDS.map((s) => <Button key={s} size="sm" variant={speed === s ? "primary" : "secondary"} onClick={() => setSpeed(s)}>{s}×</Button>)}</div>
          <span className="tabular ml-auto font-mono text-xs text-muted">{formatTime(new Date(t0 + pos).toISOString())} · {visible.length}/{events.length} events</span>
        </div>
        <input type="range" min={0} max={duration} value={pos} onChange={(e) => { setPos(Number(e.target.value)); setPlaying(false); }} className="mt-4 w-full accent-purple" aria-label="Replay position" />
      </Card>
      <StageBar stage={board.stage} finished={board.finished} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-4 md:grid-cols-2">{board.agents.map((a) => <AgentCard key={a.key} card={a} runId={runId} workspaceId={workspaceId} readOnly />)}</div>
        <Card variant="bento" className="max-h-[70vh] overflow-y-auto"><EventFeed events={visible} /></Card>
      </div>
    </div>
  );
}
