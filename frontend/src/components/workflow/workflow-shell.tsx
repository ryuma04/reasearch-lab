"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUUpLeft, Pause, Play, Stop, Timer } from "@phosphor-icons/react";
import { userMessage } from "@/lib/api/errors";
import { runApi } from "@/lib/api/services";
import { qk, useAgents, useCheckpoints, useRun, useWorkspace } from "@/lib/hooks/queries";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { runStatusMeta } from "@/lib/status";
import { canOpen, deriveWorkflow, type StageKey } from "@/lib/workflow/state";
import { formatDuration, shortId } from "@/lib/utils";
import { ConnectionPill } from "@/components/run/board";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/overlays";
import { Badge, StatusDot } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { CodingStage } from "./coding-stage";
import { DebugStage } from "./debug-stage";
import { PlanStage } from "./plan-stage";
import { ResearchStage } from "./research-stage";
import { ResultsStage } from "./results-stage";
import { StageNav } from "./stage-nav";
import { TestStage } from "./test-stage";
import type { AgentInfo } from "./types";

/**
 * Stages this workflow tab shows. The Research & Planning experience owns the first two; the coding, debugging, testing and
 * results components (and their backend stages) are kept untouched for the teammates building them. To expose them
 * again, add their keys here: no other change is needed.
 */
export const WORKFLOW_SCOPE: StageKey[] = ["research", "plan"];
const KEYS = WORKFLOW_SCOPE;

/** Seconds since `from` while `live`, ticking once a second only then. */
function useElapsed(from: string | null, to: string | null, live: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!from) return null;
  const end = to ? Date.parse(to) : now;
  return Math.max(0, (end - Date.parse(from)) / 1000);
}

export function WorkflowShell({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();

  const ws = useWorkspace(workspaceId);
  const [poll, setPoll] = React.useState<number | false>(5000);
  const runQ = useRun(runId, poll);
  const cps = useCheckpoints(runId);
  const agentsQ = useAgents();
  const run = runQ.data ?? null;
  const terminalNow = run ? ["succeeded", "failed", "stopped"].includes(run.status) : false;
  const stream = useRunStream({ runId }, !terminalNow);
  React.useEffect(() => setPoll(terminalNow ? false : stream.state === "open" ? 15000 : 4000), [terminalNow, stream.state]);

  const wf = React.useMemo(() => deriveWorkflow({ run, checkpoints: cps.data ?? [], events: stream.events }), [run, cps.data, stream.events]);
  const agents: AgentInfo[] = React.useMemo(() => (agentsQ.data ?? []).map((a) => ({ id: a.id, name: a.name, description: a.description, group: a.group })), [agentsQ.data]);

  // Which stage is shown: follow the live stage, unless the person opened another one (kept in ?stage= so refresh keeps it).
  // Backend stages outside this workflow's scope (coding, testing, …) map to the last visible stage.
  const current: StageKey = KEYS.includes(wf.current) ? wf.current : (KEYS.at(-1) as StageKey);
  const visibleStages = React.useMemo(() => wf.stages.filter((s) => KEYS.includes(s.key)), [wf.stages]);
  const asked = sp.get("stage") as StageKey | null;
  const pinned = asked && KEYS.includes(asked) && canOpen(wf, asked) && asked !== current ? asked : null;
  const view: StageKey = pinned ?? current;
  const select = (k: StageKey) => {
    const usp = new URLSearchParams(sp.toString());
    if (k === current) usp.delete("stage");
    else usp.set("stage", k);
    router.replace(`${pathname}${usp.size ? `?${usp}` : ""}`, { scroll: false });
  };

  const [busy, setBusy] = React.useState(false);
  const act = async (action: "pause" | "resume" | "stop" | "retry") => {
    if (busy) return;
    if (action === "stop" && !window.confirm("Stop this run? Work stops at the next safe step.")) return;
    if (action === "retry" && !window.confirm("Retry from the last saved step?")) return;
    setBusy(true);
    try {
      await runApi.agentAction(runId, "run", { action });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.run(runId) }), qc.invalidateQueries({ queryKey: qk.checkpoints(runId) })]);
      toast.success(action === "stop" ? "Stop requested" : action === "pause" ? "Pause requested" : action === "resume" ? "Resumed" : "Retry requested");
    } catch (e) {
      toast.error("That didn't work", userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const first = stream.events[0]?.time ?? null;
  const last = stream.events.at(-1)?.time ?? null;
  const elapsed = useElapsed(run?.started_at ?? first, terminalNow ? run?.finished_at ?? last : null, !terminalNow && !!first);
  const canAct = ws.data?.role === "owner" || ws.data?.role === "editor";

  if (runQ.isPending || ws.isPending) return <div className="space-y-4 p-4"><Skeleton className="h-20" /><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  if (runQ.error) return <div className="mx-auto max-w-2xl p-6"><ErrorState error={runQ.error} title="Couldn't open this run" onRetry={() => void runQ.refetch()} /></div>;
  if (ws.error) return <div className="mx-auto max-w-2xl p-6"><ErrorState error={ws.error} title="Couldn't open this workspace" onRetry={() => void ws.refetch()} /></div>;
  if (!run || run.workspace_id !== workspaceId) return <div className="mx-auto max-w-2xl p-6"><EmptyState title="Run not found in this workspace" body="Check the link, or open the run from the workspace page." action={<Button asChild><Link href={`/workspaces/${workspaceId}`}>Back to the workspace</Link></Button>} /></div>;

  const meta = runStatusMeta[run.status];
  const stageLabel = wf.stages.find((s) => s.key === current)?.label ?? "";
  const ended = wf.terminal !== null;
  const plan = (cps.data ?? []).find((c) => c.name === "plan") ?? null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Run summary">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to the workspace"><Link href={`/workspaces/${workspaceId}`}><ArrowLeft size={18} weight="bold" /></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-semibold leading-tight sm:text-2xl">{ws.data?.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>Run <code>{shortId(run.id)}</code></span>
            <span aria-hidden>·</span><span>Stage: <b className="text-ink-soft">{stageLabel}</b></span>
            {elapsed != null && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><Timer size={12} /> {formatDuration(elapsed)}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} solid className="px-3 py-1.5 text-xs">{!ended && run.status !== "waiting_approval" && run.status !== "paused" && <StatusDot tone="sky" pulse />}{meta.label}</Badge>
          {!ended && <ConnectionPill state={stream.state} stale={stream.stale} />}
          {canAct && !ended && run.status === "paused" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("resume")}><Play size={14} weight="fill" /> Resume</Button>}
          {canAct && !ended && run.status !== "paused" && run.status !== "waiting_approval" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("pause")}><Pause size={14} weight="fill" /> Pause</Button>}
          {canAct && !ended && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("stop")}><Stop size={14} weight="fill" /> Stop</Button>}
          {canAct && wf.terminal === "failed" && <Button size="sm" variant="purple" disabled={busy} onClick={() => void act("retry")}><ArrowUUpLeft size={14} weight="bold" /> Retry from last step</Button>}
        </div>
      </header>

      {!ended && (stream.state === "reconnecting" || stream.state === "failed" || stream.stale) && (
        <p role="status" className="rounded-2xl bg-warning-soft px-4 py-2 text-sm font-semibold text-warning">
          {stream.state === "failed" ? "Live updates are unavailable. This page refreshes the saved run state every few seconds instead." : stream.stale ? "No updates for a while. The run may be busy; the latest saved state is shown." : "Reconnecting to live updates… showing the last saved state."}
        </p>
      )}
      {wf.awaiting?.name === "plan" && view !== "plan" && canAct && (
        <p role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-lavender-soft px-4 py-2 text-sm font-semibold text-purple-deep">
          The Coding Plan is ready and waiting for your approval.
          <Button size="sm" variant="purple" onClick={() => select("plan")}>Review the plan</Button>
        </p>
      )}

      <StageNav stages={visibleStages} view={view} current={current} onSelect={select} />
      {view !== current && (
        <p className="text-sm text-muted">You are looking at another stage. <button type="button" className="font-semibold text-purple-deep underline" onClick={() => select(current)}>Jump to the current stage ({stageLabel})</button></p>
      )}

      <main id="stage-panel" aria-live="off" className="min-h-[50vh]" aria-label={wf.stages.find((s) => s.key === view)?.label}>
        {stream.historyError ? <ErrorState error={stream.historyError} title="Couldn't load the run's activity" /> : null}
        {view === "research" && <ResearchStage runId={runId} events={stream.events} agents={agents} ended={ended} researchDone={wf.reached >= 1} running={wf.stages[0]?.status === "active"} onOpen={select} objective={ws.data?.note} />}
        {view === "plan" && <PlanStage runId={runId} cp={plan} canAct={canAct} agents={agents} events={stream.events} />}
        {KEYS.includes("coding") && view === "coding" && <CodingStage runId={runId} events={stream.events} agents={agents} ended={ended} awaiting={wf.awaiting} canAct={canAct} />}
        {KEYS.includes("debugging") && view === "debugging" && <DebugStage runId={runId} events={stream.events} agents={agents} ended={ended} failed={wf.terminal === "failed"} awaiting={wf.awaiting} canAct={canAct} />}
        {KEYS.includes("testing") && view === "testing" && <TestStage runId={runId} events={stream.events} agents={agents} ended={ended} />}
        {KEYS.includes("results") && view === "results" && <ResultsStage run={run} workspaceId={workspaceId} events={stream.events} outcome={wf.terminal} onOpen={select} />}
      </main>
    </div>
  );
}
