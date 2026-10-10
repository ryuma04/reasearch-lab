"use client";

import * as React from "react";
import { ArrowRight, Brain, CheckCircle, Circle, Clock, Wrench, XCircle } from "@phosphor-icons/react";
import type { RunCheckpoint, RunEvent } from "@/lib/api/types";
import { agentActivity, buildIncidents, narrate, type Incident } from "@/lib/workflow/activity";
import { cn, formatTime } from "@/lib/utils";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { AgentCardView, HelpCard } from "./shared";
import { TerminalPanel } from "./coding-stage";
import type { AgentInfo } from "./types";

const STEPS = ["Error detected", "Fix applied", "Fix verified"] as const;

function Stepper({ i }: { i: Incident }) {
  const reached = i.status === "detected" ? 0 : i.status === "fix_applied" ? 1 : i.status === "verified" ? 2 : i.fixes.length ? 1 : 0;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold" aria-label="Repair progress">
      {STEPS.map((s, idx) => {
        const done = idx <= reached;
        const failedHere = i.status === "failed" && idx === Math.min(reached + 1, 2);
        return (
          <li key={s} className="flex items-center gap-1.5">
            {failedHere ? <XCircle size={16} weight="fill" className="text-danger" /> : done ? <CheckCircle size={16} weight="fill" className={idx === 0 ? "text-danger" : "text-success"} /> : <Circle size={16} className="text-muted" />}
            <span className={cn(done ? "text-ink" : "text-muted", failedHere && "text-danger")}>{failedHere ? `${s}: did not happen` : s}</span>
            {idx < 2 && <ArrowRight size={12} className="text-muted" />}
          </li>
        );
      })}
    </ol>
  );
}

function IncidentCard({ i, n }: { i: Incident; n: number }) {
  const tone = i.status === "verified" ? "mint" : i.status === "failed" ? "pink" : "sun";
  const label = i.status === "verified" ? "Fix verified" : i.status === "failed" ? "Not resolved" : i.status === "fix_applied" ? "Fix applied, not verified yet" : "Error detected";
  return (
    <Card variant="bento" className={cn("space-y-3 p-5", i.status === "failed" && "border-danger/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-pink-soft text-sm font-bold text-danger">{n}</span>
        <p className="min-w-0 flex-1 break-words font-semibold">{i.signature || "An error was reported"}</p>
        <Badge tone={tone} solid={i.status === "verified"}>{label}</Badge>
      </div>
      <Stepper i={i} />
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-2xl bg-canvas p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">What failed · {formatTime(i.detectedAt)}</p>
          {i.locations.length > 0 && <ul className="mt-1 flex flex-wrap gap-1.5">{i.locations.map((l) => <li key={`${l.file}:${l.line}`}><code className="rounded-md bg-ink/90 px-1.5 py-0.5 text-[11px] text-white">{l.file}:{l.line}</code></li>)}</ul>}
          {i.details && <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-purple-deep">Show technical details</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink/90 p-2 font-mono text-[11px] text-white/90">{i.details}</pre></details>}
          {!i.locations.length && !i.details && <p className="mt-1 text-ink-soft">No file or line was reported.</p>}
        </div>
        <div className="rounded-2xl bg-canvas p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">What was changed</p>
          {i.fixes.length ? (
            <ul className="mt-1 space-y-1.5">
              {i.fixes.map((f) => (
                <li key={f.time} className="flex gap-1.5"><Wrench size={14} className="mt-0.5 shrink-0 text-success" /><span>{f.message}{f.fromMemory && <Badge tone="lavender" className="ml-1.5"><Brain size={10} /> from Lab Memory</Badge>}</span></li>
              ))}
            </ul>
          ) : <p className="mt-1 text-ink-soft">{i.noFixFound ? "No automatic fix was found for this error." : "No fix has been applied yet."}</p>}
          {i.verifiedAt && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-success"><CheckCircle size={13} weight="fill" /> A later sandbox run exited cleanly at {formatTime(i.verifiedAt)}.</p>}
          {i.status === "failed" && i.fixes.length > 0 && <p className="mt-2 text-xs font-semibold text-danger">The run failed again after this fix, so it is not counted as resolved.</p>}
        </div>
      </div>
    </Card>
  );
}

export function DebugStage({ runId, events, agents, ended, failed, awaiting, canAct }: {
  runId: string; events: RunEvent[]; agents: AgentInfo[]; ended: boolean; failed: boolean; awaiting: RunCheckpoint | null; canAct: boolean;
}) {
  const incidents = React.useMemo(() => buildIncidents(events, failed), [events, failed]);
  const reviewer = agents.find((a) => a.id === "coding.reviewer");
  const act = React.useMemo(() => agentActivity(events, "coding.reviewer", ended), [events, ended]);
  const reviews = React.useMemo(() => events.filter((e) => (e.data?.rawType ?? e.type) === "review").map(narrate), [events]);
  const verified = incidents.filter((i) => i.status === "verified").length;

  return (
    <div className="space-y-5">
      {canAct && awaiting?.name === "help" && <HelpCard runId={runId} cp={awaiting} />}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="space-y-3" aria-label="Errors and repairs">
          <SectionTitle kicker="Repair loop" title={incidents.length ? `${incidents.length} error${incidents.length === 1 ? "" : "s"} · ${verified} verified fixed` : "Errors and repairs"} />
          <p className="text-xs text-muted">A fix counts as verified only when a later sandbox run finishes with exit code 0. Repair is bounded: up to 4 install tries and 5 repair attempts for the run, then the agents ask you for help.</p>
          {incidents.length ? incidents.map((i, idx) => <IncidentCard key={i.id} i={i} n={idx + 1} />).reverse() : (
            <EmptyState title="No errors so far" body="If the code fails, the Debugger reads the error, applies a fix and re-runs it. Every step shows here, linked to the run. If nothing ever fails, this stage is marked as not needed." />
          )}
        </section>
        <div className="space-y-3">
          {reviewer && <AgentCardView name={reviewer.name} description={reviewer.description} a={act} />}
          {reviews.length > 0 && (
            <Card variant="bento" className="space-y-1.5 p-4 text-sm">
              <p className="font-bold">Code review notes</p>
              {reviews.map((r) => r && <p key={r.id} className="text-ink-soft"><Clock size={12} className="mr-1 inline" />{r.detail ?? r.title}</p>)}
            </Card>
          )}
        </div>
      </div>
      <TerminalPanel runId={runId} events={events} defaultOpen={false} />
    </div>
  );
}
