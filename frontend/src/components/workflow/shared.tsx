"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CaretDown, CheckCircle, Clock, Hourglass, Robot, WarningCircle, XCircle } from "@phosphor-icons/react";
import { userMessage } from "@/lib/api/errors";
import { runApi } from "@/lib/api/services";
import type { CheckpointRequest, RunCheckpoint, RunEvent } from "@/lib/api/types";
import { qk } from "@/lib/hooks/queries";
import { agentActivity, narrate, type AgentActivity, type Mood, type Narrated } from "@/lib/workflow/activity";
import type { StageStatus } from "@/lib/workflow/state";
import { cn, formatDuration, formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/overlays";
import { Badge, Card, StatusDot, Textarea, type Tone } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";

export const stageStatusMeta: Record<StageStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "faint" },
  active: { label: "In progress", tone: "sky" },
  awaiting: { label: "Needs you", tone: "purple" },
  done: { label: "Done", tone: "mint" },
  failed: { label: "Failed", tone: "pink" },
  stopped: { label: "Stopped", tone: "faint" },
  skipped: { label: "Not needed", tone: "cream" },
};

const MOOD_DOT: Record<Mood, "faint" | "sky" | "mint" | "sun" | "pink" | "purple"> = { info: "sky", ok: "mint", warn: "sun", error: "pink", wait: "purple" };

/* ── Agent card ── */

const AGENT_TONE = { waiting: "faint", working: "sky", done: "mint", failed: "pink", stopped: "faint" } as const;
const AGENT_LABEL = { waiting: "Waiting", working: "Running", done: "Completed", failed: "Failed", stopped: "Stopped" } as const;

export const AgentCardView = React.memo(function AgentCardView({ name, description, a }: { name: string; description?: string; a: AgentActivity }) {
  return (
    <Card variant="bento" className={cn("p-4", a.status === "failed" && "border-danger/40")} aria-label={`${name}: ${AGENT_LABEL[a.status]}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lavender-soft text-purple-deep"><Robot size={18} weight="duotone" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{name}</p>
          <p className="truncate font-mono text-[11px] text-muted">{a.id}</p>
        </div>
        <Badge tone={AGENT_TONE[a.status]} solid={a.status === "working"}>
          {a.status === "working" && <StatusDot tone="sky" pulse />} {AGENT_LABEL[a.status]}
        </Badge>
      </div>
      {description && <p className="mt-2 text-xs text-muted">{description}</p>}
      <div className="mt-3 rounded-xl bg-canvas p-3 text-sm" aria-live="polite">
        {a.latest ? (
          <>
            <p className="font-semibold">{a.latest.title}</p>
            {a.latest.detail && <p className="mt-0.5 text-ink-soft">{a.latest.detail}</p>}
          </>
        ) : a.status === "waiting" ? (
          <p className="text-muted">Waiting for its turn. It has not reported anything yet.</p>
        ) : a.status === "working" ? (
          <p className="text-ink-soft">Working. No update reported yet.</p>
        ) : (
          <p className="text-ink-soft">Finished without extra notes.</p>
        )}
      </div>
      {a.findings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ink-soft">
          {a.findings.slice(-3).map((f) => <li key={f.id} className="flex gap-1.5"><CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-success" /><span>{f.detail ?? f.title}</span></li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {a.startedAt && <span className="inline-flex items-center gap-1"><Clock size={12} /> started {formatTime(a.startedAt)}</span>}
        {a.durationSec != null && <span>took {formatDuration(a.durationSec)}</span>}
        {a.tokens > 0 && <span>{a.tokens.toLocaleString()} tokens</span>}
        {a.errors > 0 && <span className="font-semibold text-danger">{a.errors} problem{a.errors === 1 ? "" : "s"}</span>}
      </div>
    </Card>
  );
});

export function AgentGrid({ events, agents, ended }: { events: RunEvent[]; agents: { id: string; name: string; description?: string }[]; ended: boolean }) {
  const list = React.useMemo(() => agents.map((ag) => ({ ag, a: agentActivity(events, ag.id, ended) })), [events, agents, ended]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map(({ ag, a }) => <AgentCardView key={ag.id} name={ag.name} description={ag.description} a={a} />)}
    </div>
  );
}

/* ── Activity timeline (real events, readable) ── */

const CATEGORY_LABEL: Record<string, string> = { research: "Research", plan: "Plan", coding: "Coding", debug: "Debugging", test: "Testing", system: "System" };

export const TimelineItem = React.memo(function TimelineItem({ n }: { n: Narrated }) {
  const [open, setOpen] = React.useState(false);
  const expandable = !!(n.technical || n.why);
  return (
    <li className="flex gap-3 px-4 py-2.5">
      <span className="mt-1.5 shrink-0"><StatusDot tone={MOOD_DOT[n.mood]} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{n.title}</span>
          <span className="text-[11px] text-muted">{formatTime(n.time)} · {CATEGORY_LABEL[n.category]}</span>
        </p>
        {n.detail && <p className="mt-0.5 break-words text-sm text-ink-soft">{n.detail}</p>}
        {expandable && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-purple-deep">
            <CaretDown size={11} className={cn("transition-transform", open && "rotate-180")} /> {open ? "Hide details" : "Show details"}
          </button>
        )}
        {open && (
          <div className="mt-1 space-y-1.5">
            {n.why && <p className="text-xs text-muted"><b>Why:</b> {n.why}</p>}
            {n.technical && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink/90 p-2.5 font-mono text-[11px] leading-5 text-white/90">{n.technical}</pre>}
            <p className="font-mono text-[10px] text-muted">{n.agent} · {n.raw}</p>
          </div>
        )}
      </div>
    </li>
  );
});

/** Newest first; long histories are paged (60 at a time) so the page stays fast. */
export function ActivityTimeline({ events, empty = "Nothing has been reported yet." }: { events: RunEvent[]; empty?: string }) {
  const [shown, setShown] = React.useState(60);
  const items = React.useMemo(() => events.map(narrate).filter((x): x is Narrated => !!x).reverse(), [events]);
  if (!items.length) return <EmptyState title="No activity yet" body={empty} />;
  return (
    <div>
      <ul className="divide-y divide-line-cool" aria-live="polite" aria-label="Activity timeline">
        {items.slice(0, shown).map((n) => <TimelineItem key={n.id} n={n} />)}
      </ul>
      {items.length > shown && (
        <div className="p-3 text-center"><Button size="sm" variant="secondary" onClick={() => setShown((s) => s + 60)}>Show {Math.min(60, items.length - shown)} earlier of {items.length - shown}</Button></div>
      )}
    </div>
  );
}

/* ── Approvals ── */

export function useResolveCheckpoint(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string } & CheckpointRequest) => {
      const { name, ...body } = v;
      return runApi.checkpoint(runId, name, body);
    },
    // The stage only changes once the server confirms: refetch, never assume.
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.checkpoints(runId) }), qc.invalidateQueries({ queryKey: qk.run(runId) }), qc.invalidateQueries({ queryKey: qk.settings(runId) })]);
    },
    onError: (e) => toast.error("Couldn't send your answer", userMessage(e)),
  });
}

interface LongRunPayload { estimated_seconds?: number; budget_seconds?: number; options?: { id: string; label: string; fraction?: number }[] }

export function LongRunCard({ runId, cp }: { runId: string; cp: RunCheckpoint }) {
  const p = cp.payload as LongRunPayload;
  const resolve = useResolveCheckpoint(runId);
  const [choice, setChoice] = React.useState(p.options?.[0]?.id ?? "reduce");
  return (
    <Card variant="sticker" className="space-y-3 p-5">
      <p className="flex items-center gap-2 font-display text-lg font-bold"><Hourglass size={20} weight="duotone" className="text-purple" /> The full run needs more time than your budget</p>
      <p className="text-sm text-ink-soft">
        Measured on this machine: about <b>{p.estimated_seconds ? Math.round(p.estimated_seconds / 60) : "?"} min</b> for the full plan; your budget allows <b>{p.budget_seconds ? Math.round(p.budget_seconds / 60) : "?"} min</b>.
      </p>
      <div role="radiogroup" aria-label="How long should the run be?" className="space-y-2">
        {(p.options ?? []).map((o) => (
          <label key={o.id} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 text-sm font-semibold", choice === o.id ? "border-purple bg-lavender-soft" : "border-line bg-white")}>
            <input type="radio" name="long-run" className="accent-purple" checked={choice === o.id} onChange={() => setChoice(o.id)} /> {o.label}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="success" loading={resolve.isPending} onClick={() => resolve.mutate({ name: cp.name, decision: "approve", option: choice })}>Continue with this option</Button>
        <Button variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ name: cp.name, decision: "reject" })}>Stop the run</Button>
      </div>
    </Card>
  );
}

export function HelpCard({ runId, cp }: { runId: string; cp: RunCheckpoint }) {
  const resolve = useResolveCheckpoint(runId);
  const [text, setText] = React.useState("");
  const problem = String(cp.payload.problem ?? "");
  return (
    <Card variant="sticker" className="space-y-3 p-5">
      <p className="flex items-center gap-2 font-display text-lg font-bold"><WarningCircle size={20} weight="duotone" className="text-coral-deep" /> The agents need your help</p>
      {problem && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink/90 p-3 font-mono text-[11px] leading-5 text-white/90">{problem}</pre>}
      <p className="text-sm text-muted">{String(cp.payload.hint ?? "Give an instruction (for example “use torch 2.2”) and the agents will try again, or stop the run.")}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Instruction for the agents (optional)" aria-label="Instruction for the agents" maxLength={1000} />
      <div className="flex flex-wrap gap-2">
        <Button variant="success" loading={resolve.isPending} onClick={() => resolve.mutate({ name: cp.name, decision: text.trim() ? "edit" : "approve", instructions: text.trim() || undefined })}>
          {text.trim() ? "Send instruction and retry" : "Retry"}
        </Button>
        <Button variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ name: cp.name, decision: "reject" })}><XCircle size={16} /> Stop the run</Button>
      </div>
    </Card>
  );
}
