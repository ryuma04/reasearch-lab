"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ArrowClockwise, ChatText, CheckCircle, Pause, Play, Stop, ThumbsDown, ThumbsUp, WifiHigh, WifiSlash, Brain, ArrowSquareOut, Lightning, X, PencilSimple } from "@phosphor-icons/react";
import type { RunEvent } from "@/lib/api/types";
import type { AgentCardState, BoardState, PendingCheckpoint } from "@/lib/run-state";
import { STAGES } from "@/lib/run-state";
import type { StreamState } from "@/lib/api/sse";
import { runApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { agentStatusMeta } from "@/lib/status";
import { LIMITS } from "@/lib/config";
import { cn, formatDuration, formatNumber, formatTime, humanize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Progress, StatusDot, Textarea } from "@/components/ui/primitives";
import { Sheet, toast } from "@/components/ui/overlays";

export function StageBar({ stage, finished }: { stage: BoardState["stage"]; finished: BoardState["finished"] }) {
  const idx = stage === "done" ? STAGES.length : STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex gap-1.5 overflow-x-auto rounded-[24px] bg-white p-2 shadow-clay-sm" aria-label="Run stage">
      {STAGES.map((s, i) => {
        const state = i < idx || finished === "succeeded" ? "done" : i === idx ? "now" : "todo";
        return (
          <li key={s.key} aria-current={state === "now" ? "step" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold",
              state === "done" && "bg-mint-soft text-mint-deep", state === "now" && "border-2 border-ink bg-purple text-white shadow-pop", state === "todo" && "text-faint")}>
            {state === "done" ? <CheckCircle size={14} weight="fill" /> : <span className="tabular">{i + 1}</span>} {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export function ConnectionPill({ state, stale }: { state: StreamState; stale: boolean }) {
  const meta = stale
    ? { t: "No updates for a while", c: "bg-warning-soft text-warning", I: WifiSlash }
    : { connecting: { t: "Connecting…", c: "bg-sky-soft text-sky-deep", I: WifiHigh }, open: { t: "Live", c: "bg-success-soft text-success", I: WifiHigh }, reconnecting: { t: "Reconnecting…", c: "bg-warning-soft text-warning", I: WifiSlash }, closed: { t: "Not live", c: "bg-ink/5 text-muted", I: WifiSlash }, failed: { t: "Live stream unavailable", c: "bg-danger-soft text-danger", I: WifiSlash } }[state];
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold", meta.c)}>
      {state === "open" && !stale ? <StatusDot tone="mint" pulse /> : <meta.I size={14} weight="bold" />} {meta.t}
    </span>
  );
}

export function AgentCard({ card, runId, workspaceId, readOnly }: { card: AgentCardState; runId: string; workspaceId: string; readOnly?: boolean }) {
  const meta = agentStatusMeta[card.status];
  const [instructOpen, setInstructOpen] = React.useState(false);
  const act = useMutation({
    mutationFn: (v: { action: Parameters<typeof runApi.agentAction>[2]["action"]; instruction?: string }) => runApi.agentAction(runId, card.key, v),
    onSuccess: (res, v) => {
      if (res && res.accepted === false) toast.warning("Action not accepted", res.message);
      else toast.success(`${humanize(card.key)}: ${v.action.replace("_", " ")} sent`, "The board updates when the agent confirms.");
      setInstructOpen(false);
    },
    onError: (e) => toast.error("Action failed", userMessage(e)),
  });
  const working = card.status === "working";
  const pending = act.isPending;

  return (
    <Card className={cn("flex flex-col p-5", card.status === "awaiting_approval" && "ring-2 ring-purple")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold">{humanize(card.key)}</p>
          {card.subAgent && <p className="truncate text-xs text-muted">{humanize(card.subAgent)}</p>}
        </div>
        <Badge tone={meta.tone} solid className="shrink-0"><StatusDot tone={meta.dot} pulse={working} /> {meta.label}</Badge>
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-snug">{card.task ?? "Waiting for work"}</p>
      {card.why && <p className="mt-1.5 text-sm text-muted"><span className="font-semibold text-ink-soft">Why:</span> {card.why}</p>}
      {card.progress != null && <Progress className="mt-3" value={card.progress} label={`${card.key} progress`} />}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {card.memoryFixes > 0 && <Badge tone="lavender"><Brain size={12} /> {card.memoryFixes} fixed from memory</Badge>}
        {card.errors > 0 && <Badge tone="pink">{card.errors} errors</Badge>}
        {card.fixes > 0 && <Badge tone="mint">{card.fixes} fixes</Badge>}
      </div>
      <div className="mt-auto pt-4">
        <p className="tabular text-xs text-muted">{formatNumber(card.tokens)} tokens · {formatDuration(card.sandboxSeconds)} sandbox · {formatTime(card.lastEventAt)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {!readOnly && (
            <>
              {card.status === "paused" ? (
                <IconAction label="Resume" onClick={() => act.mutate({ action: "resume" })} disabled={pending}><Play size={16} weight="bold" /></IconAction>
              ) : (
                <IconAction label="Pause" onClick={() => act.mutate({ action: "pause" })} disabled={pending || !working}><Pause size={16} weight="bold" /></IconAction>
              )}
              <IconAction label="Stop" onClick={() => act.mutate({ action: "stop" })} disabled={pending || ["done", "stopped"].includes(card.status)}><Stop size={16} weight="bold" /></IconAction>
              <IconAction label="Retry" onClick={() => act.mutate({ action: "retry" })} disabled={pending || !["failed", "blocked", "stopped"].includes(card.status)}><ArrowClockwise size={16} weight="bold" /></IconAction>
              <IconAction label="Give instruction" onClick={() => setInstructOpen(true)} disabled={pending}><ChatText size={16} weight="bold" /></IconAction>
              <IconAction label="Thumbs up" onClick={() => act.mutate({ action: "thumbs_up" })} disabled={pending}><ThumbsUp size={16} weight="bold" /></IconAction>
              <IconAction label="Thumbs down" onClick={() => act.mutate({ action: "thumbs_down" })} disabled={pending}><ThumbsDown size={16} weight="bold" /></IconAction>
            </>
          )}
          <Link href={`/workspaces/${workspaceId}/agents/${encodeURIComponent(card.key)}?run=${encodeURIComponent(runId)}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-purple-deep underline underline-offset-2">
            Full work <ArrowSquareOut size={12} />
          </Link>
        </div>
      </div>
      {!readOnly && <InstructSheet open={instructOpen} onOpenChange={setInstructOpen} title={`Instruct ${humanize(card.key)}`} loading={pending} onSubmit={(t) => act.mutate({ action: "instruct", instruction: t })} />}
    </Card>
  );
}

function IconAction({ label, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-clay-sm transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-35" {...p}>
      {children}
    </button>
  );
}

function InstructSheet({ open, onOpenChange, title, onSubmit, loading }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; onSubmit: (t: string) => void; loading: boolean }) {
  const [text, setText] = React.useState("");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description="Plain words. The agent will acknowledge it on the board." mode="center">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(text.trim()); }} className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.instructionMax} placeholder="e.g. Use only 10,000 training images" aria-label="Instruction" autoFocus />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={loading} disabled={!text.trim()}>Send</Button></div>
      </form>
    </Sheet>
  );
}

/** Checkpoint panel — Approve / Edit / Reject via POST /runs/{id}/checkpoints/{name}. Large & bottom-anchored on phones (§26). */
export function CheckpointPanel({ runId, checkpoint, onResolved, children }: { runId: string; checkpoint: PendingCheckpoint; onResolved?: () => void; children?: React.ReactNode }) {
  const [mode, setMode] = React.useState<null | "edit" | "reject">(null);
  const [text, setText] = React.useState("");
  const m = useMutation({
    mutationFn: (v: { decision: "approve" | "edit" | "reject"; instructions?: string }) => runApi.checkpoint(runId, checkpoint.name, v),
    onSuccess: (_r, v) => {
      toast.success(v.decision === "approve" ? "Approved" : v.decision === "edit" ? "Edits sent" : "Rejected", "Waiting for the backend to continue the run.");
      setMode(null);
      onResolved?.();
    },
    onError: (e) => toast.error("Checkpoint action failed", userMessage(e)),
  });
  return (
    <div className="rounded-[28px] border-2 border-ink bg-white p-5 shadow-pop-lg">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="purple" solid><Lightning size={12} weight="fill" /> Approval required</Badge>
        <span className="text-xs font-semibold text-muted">Checkpoint “{humanize(checkpoint.name)}” · since {formatTime(checkpoint.since)}</span>
      </div>
      <p className="mt-3 font-display text-lg font-bold">{checkpoint.message}</p>
      {checkpoint.why && <p className="mt-1 text-sm text-muted">Why: {checkpoint.why}</p>}
      {children}
      {mode && (
        <div className="mt-4 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.instructionMax} aria-label={mode === "edit" ? "Plan edits" : "Reason for rejecting"}
            placeholder={mode === "edit" ? "e.g. Use only 10,000 training images" : "Optional: why are you rejecting this plan?"} autoFocus />
        </div>
      )}
      <div className="fixed inset-x-3 bottom-24 z-30 grid grid-cols-3 gap-2 rounded-[24px] border-2 border-ink bg-white p-2 shadow-pop md:static md:mt-5 md:flex md:border-0 md:p-0 md:shadow-none">
        {mode ? (
          <>
            <Button variant="secondary" onClick={() => setMode(null)}><X size={16} weight="bold" /> Back</Button>
            <Button className="col-span-2" variant={mode === "edit" ? "purple" : "danger"} size="lg" loading={m.isPending}
              disabled={mode === "edit" && !text.trim()} onClick={() => m.mutate({ decision: mode, instructions: text.trim() || undefined })}>
              {mode === "edit" ? "Send edits" : "Confirm reject"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="success" size="lg" loading={m.isPending} onClick={() => m.mutate({ decision: "approve" })}><CheckCircle size={20} weight="bold" /> Approve</Button>
            <Button variant="outline" size="lg" onClick={() => setMode("edit")}><PencilSimple size={20} weight="bold" /> Edit</Button>
            <Button variant="danger" size="lg" onClick={() => setMode("reject")}><X size={20} weight="bold" /> Reject</Button>
          </>
        )}
      </div>
    </div>
  );
}

const typeTone = (t: string) =>
  t.includes("fail") || t === "error" || t === "push_blocked" ? "pink" : t.includes("done") || t.includes("passed") || t === "fix_applied" || t.includes("succeeded") || t === "run_finished" ? "mint" : t.includes("checkpoint") ? "purple" : t === "team_decision" ? "lavender" : t === "memory_reused" ? "lavender" : "sky";

export function EventFeed({ events, max = 60, onSelect }: { events: RunEvent[]; max?: number; onSelect?: (e: RunEvent) => void }) {
  const list = events.slice(-max).reverse();
  if (!list.length) return <p className="p-6 text-center text-sm text-muted">No events yet. They appear here as agents work.</p>;
  return (
    <ol className="divide-y divide-line" aria-label="Event stream">
      {list.map((e, i) => (
        <li key={e.id ?? i} className={cn("flex gap-3 px-4 py-3", onSelect && "cursor-pointer hover:bg-canvas/60")} onClick={() => onSelect?.(e)}>
          <span className="tabular w-16 shrink-0 pt-0.5 font-mono text-[11px] text-muted">{formatTime(e.time)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold">{humanize(e.agent)}</span>
              <Badge tone={typeTone(e.type)}>{e.type.replaceAll("_", " ")}</Badge>
              {e.links?.memory_item && <Badge tone="lavender"><Brain size={11} /> memory {e.links.memory_item}</Badge>}
            </div>
            <p className="mt-0.5 break-words text-sm">{e.message}</p>
            {e.why && <p className="text-xs text-muted">Why: {e.why}</p>}
            {e.links?.file && <p className="font-mono text-[11px] text-sky-deep">{e.links.file}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
