"use client";

import * as React from "react";
import { CaretDown, CheckCircle, Circle, Clock, Warning, XCircle } from "@phosphor-icons/react";
import type { ResearchBrief, RunEvent } from "@/lib/api/types";
import { agentActivity, narrate, type AgentActivity, type Narrated } from "@/lib/workflow/activity";
import { relate, type Relation } from "@/lib/workflow/sequence";
import { cn, formatDuration, formatTime } from "@/lib/utils";
import { Spinner } from "./spinner";
import { SourceLink } from "./source-link";
import type { AgentInfo } from "./types";

const STATUS_LABEL = { waiting: "Waiting", working: "Running", done: "Completed", failed: "Failed", stopped: "Stopped" } as const;

function Marker({ status }: { status: AgentActivity["status"] }) {
  if (status === "working") return <Spinner />;
  if (status === "done") return <CheckCircle size={20} weight="fill" className="text-success" />;
  if (status === "failed") return <XCircle size={20} weight="fill" className="text-danger" />;
  if (status === "stopped") return <Warning size={20} weight="fill" className="text-muted" />;
  return <Circle size={20} className="text-muted" />;
}

function relationText(r: Relation, name: (id: string) => string): string | null {
  switch (r.kind) {
    case "first": return null;
    case "after": return `Started after ${name(r.agent)} finished`;
    case "parallel": return `Ran in parallel with ${name(r.agent)}`;
    case "waiting": return r.blocked ? `Starts after ${name(r.agent)} finishes` : `Next in line after ${name(r.agent)}`;
  }
}

/** What each agent actually produced, from persisted data. Nothing is shown for an agent that produced nothing. */
function Outputs({ id, brief }: { id: string; brief?: ResearchBrief }) {
  if (!brief) return null;
  if (id === "research.paper_reader") {
    const n = brief.claims.length;
    if (!n && !brief.summary) return null;
    return (
      <div className="text-sm">
        {n > 0 && <p><b>{n} claim{n === 1 ? "" : "s"}</b> extracted with page and quote{brief.method.length ? ` · ${brief.method.length} method step${brief.method.length === 1 ? "" : "s"}` : ""}{brief.missing_details.length ? ` · ${brief.missing_details.length} missing detail${brief.missing_details.length === 1 ? "" : "s"}` : ""}.</p>}
      </div>
    );
  }
  if (id === "research.source_finder") {
    if (!brief.sources.length) return null;
    return (
      <ul className="space-y-1.5 text-sm" aria-label="Sources found">
        {brief.sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{s.kind === "code" ? "repository" : s.kind}</span>
            <span className="min-w-0 break-words font-medium">{s.title}</span>
            <span className="text-xs text-muted">{[s.year, s.citations != null ? `${s.citations.toLocaleString()} citations` : null, s.license ? `licence ${s.license}` : null, s.notes].filter(Boolean).join(" · ")}</span>
            <SourceLink url={s.url} kind={s.kind === "code" ? "repository" : s.kind === "dataset" ? "dataset" : "paper"} />
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

const Entry = React.memo(function Entry({ info, act, rel, index, last, brief, nameOf }: {
  info: AgentInfo; act: AgentActivity; rel: Relation; index: number; last: boolean; brief?: ResearchBrief; nameOf: (id: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const latest: Narrated | null = act.latest;
  const rtext = relationText(rel, nameOf);
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className="z-10 grid h-7 w-7 place-items-center rounded-full bg-white ring-2 ring-line"><Marker status={act.status} /></span>
        {!last && <span aria-hidden className={cn("w-0.5 flex-1", act.status === "done" ? "bg-success/60" : "bg-line")} />}
      </div>
      <div className={cn("min-w-0 flex-1 pb-6", last && "pb-0")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="font-display text-base font-semibold">Agent {index + 1} — {info.name}</p>
          <span className={cn("text-xs font-bold", act.status === "failed" ? "text-danger" : act.status === "working" ? "text-sky-deep" : act.status === "done" ? "text-success" : "text-muted")}>{STATUS_LABEL[act.status]}</span>
          {act.startedAt && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Clock size={11} /> {formatTime(act.startedAt)}{act.durationSec != null ? ` · ${formatDuration(act.durationSec)}` : ""}</span>}
        </div>
        {rtext && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{rtext}</p>}
        <p className="mt-0.5 text-sm text-ink-soft">{info.description}</p>
        <div className="mt-2 space-y-2 rounded-lg border-l-2 border-line bg-white/60 py-1 pl-3" aria-live="polite">
          {latest ? (
            <p className="text-sm"><b>{latest.title}.</b> {latest.detail}</p>
          ) : act.status === "waiting" ? (
            <p className="text-sm text-muted">Nothing reported yet: this agent has not started.</p>
          ) : act.status === "working" ? (
            <p className="text-sm text-muted">Running. It has not reported a finding yet.</p>
          ) : (
            <p className="text-sm text-muted">Finished without further notes.</p>
          )}
          {act.errors > 0 && <p role="alert" className="text-sm font-semibold text-danger">{act.errors} problem{act.errors === 1 ? "" : "s"} reported. See the details below.</p>}
          {act.status !== "waiting" && <Outputs id={info.id} brief={brief} />}
        </div>
        {act.events > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-purple-deep">
            <CaretDown size={11} className={cn("transition-transform", open && "rotate-180")} /> {open ? "Hide" : "Show"} technical details ({act.events} event{act.events === 1 ? "" : "s"})
          </button>
        )}
        {open && <AgentLog id={info.id} />}
      </div>
    </li>
  );
});

const LogContext = React.createContext<RunEvent[]>([]);

function AgentLog({ id }: { id: string }) {
  const events = React.useContext(LogContext);
  const rows = React.useMemo(() => events.filter((e) => e.agent === id || e.agent.startsWith(id + ".")).slice(-40).map(narrate).filter((n): n is Narrated => !!n), [events, id]);
  return (
    <ul className="mt-1 max-h-60 space-y-1 overflow-auto rounded-lg bg-ink/90 p-2.5 font-mono text-[11px] leading-5 text-white/90">
      {rows.map((n) => <li key={n.id}><span className="text-white/50">{formatTime(n.time)}</span> {n.raw}: {n.technical ?? n.detail ?? n.title}</li>)}
    </ul>
  );
}

/** The research agents as a readable top-to-bottom sequence, built from the real agent registry. */
export function AgentSequence({ events, agents, ended, brief }: { events: RunEvent[]; agents: AgentInfo[]; ended: boolean; brief?: ResearchBrief }) {
  const acts = React.useMemo(() => agents.map((a) => agentActivity(events, a.id, ended)), [events, agents, ended]);
  const rels = React.useMemo(() => relate(acts), [acts]);
  const nameOf = React.useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? id, [agents]);
  if (!agents.length) return <p className="text-sm text-muted">Loading the agent registry…</p>;
  return (
    <LogContext.Provider value={events}>
      <ol aria-label="Research agents in order" className="space-y-0">
        {agents.map((a, i) => <Entry key={a.id} info={a} act={acts[i]!} rel={rels[i]!} index={i} last={i === agents.length - 1} brief={brief} nameOf={nameOf} />)}
      </ol>
    </LogContext.Provider>
  );
}
