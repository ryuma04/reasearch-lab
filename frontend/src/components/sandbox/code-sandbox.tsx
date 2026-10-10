"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CaretDown, ChartBar, FirstAid, MagicWand, CheckCircle, CircleNotch, Cpu, DownloadSimple, File, FileCode, FloppyDisk, FolderSimple,
  Hourglass, Info, ListNumbers, Lock, Play, Robot, Stop, StopCircle, Terminal, Timer, User, WarningCircle, X, XCircle,
} from "@phosphor-icons/react";
import { isApiError, userMessage } from "@/lib/api/errors";
import { runApi, sandboxApi } from "@/lib/api/services";
import type { Claim, RunFile, RunStatus, SandboxExecStatus, SandboxExecution } from "@/lib/api/types";
import { qk, useBrief, useExecution, useExecutions, useHealSessions, useRunFiles, useSandboxHealth } from "@/lib/hooks/queries";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Select, type Tone } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { CodeEditor } from "./code-editor";
import { useLogStream } from "./use-log-stream";
import { HealPanel, healActive } from "./heal-panel";

/* ── status vocabulary ── */

export const EXEC_META: Record<SandboxExecStatus, { label: string; tone: Tone; icon: React.ElementType }> = {
  queued: { label: "Queued", tone: "faint", icon: Hourglass },
  running: { label: "Running", tone: "sky", icon: CircleNotch },
  succeeded: { label: "Succeeded", tone: "mint", icon: CheckCircle },
  failed: { label: "Failed", tone: "coral", icon: XCircle },
  timed_out: { label: "Timed out", tone: "sun", icon: Timer },
  cancelled: { label: "Cancelled", tone: "faint", icon: StopCircle },
  error: { label: "Sandbox error", tone: "pink", icon: WarningCircle },
};

const isLive = (e?: SandboxExecution | null) => e?.status === "running" || e?.status === "queued";
const FOLDERS = ["src", "configs", "tests", "results", "models", "logs"] as const;
const BINARY = /\.(pt|pth|ckpt|pkl|pickle|joblib|ubj|xgb|onnx|npy|npz|png|jpe?g|gif|pdf|zip|gz|bin|h5)$/i;
const isArtifactPath = (p: string) => p.startsWith("results/") || p.startsWith("models/");

/** The backend's own message when it gave one (e.g. "Docker is not available …"). */
function errorText(e: unknown): string {
  if (isApiError(e) && e.message && e.message !== e.kind) return e.message;
  return userMessage(e);
}

function seconds(ms: number | null | undefined) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function useElapsed(start: string | null, live: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return start && live ? Math.max(0, now - new Date(start).getTime()) : null;
}

interface Buffer {
  original: string;
  value: string;
  loading: boolean;
  error: string | null;
}

/* ── main component ── */

export function CodeSandbox({ runId, runStatus }: { runId: string; runStatus: RunStatus | null }) {
  const qc = useQueryClient();
  const files = useRunFiles(runId);
  const health = useSandboxHealth();
  const executions = useExecutions(runId);
  const brief = useBrief(runId);
  const heal = useHealSessions(runId);

  const [tabs, setTabs] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [buffers, setBuffers] = React.useState<Record<string, Buffer>>({});
  const [selectedExec, setSelectedExec] = React.useState<string | null>(null);
  const [entry, setEntry] = React.useState<string>("");
  const [panel, setPanel] = React.useState<"terminal" | "results" | "attempts" | "fixes">("terminal");
  const [busy, setBusy] = React.useState<"saving" | "starting" | "cancelling" | "healing" | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = React.useState(true);

  const list = React.useMemo(() => files.data ?? [], [files.data]);
  const entrypoints = React.useMemo(() => list.filter((f) => /^(src|tests)\/.+\.py$/.test(f.path)).map((f) => f.path), [list]);
  const hasCode = list.some((f) => f.path.startsWith("src/"));

  // Default entrypoint and first open file: src/train.py when it exists.
  React.useEffect(() => {
    if (!entry && entrypoints.length) setEntry(entrypoints.includes("src/train.py") ? "src/train.py" : entrypoints[0]!);
  }, [entrypoints, entry]);
  React.useEffect(() => {
    if (tabs.length || !list.length) return;
    const first = list.find((f) => f.path === "src/train.py") ?? list.find((f) => f.path.startsWith("src/") && f.path.endsWith(".py"));
    if (first) openFile(first.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  // Follow the newest execution unless the researcher picked one.
  React.useEffect(() => {
    if (!selectedExec && executions.data?.length) setSelectedExec(executions.data[0]!.id);
  }, [executions.data, selectedExec]);

  const exec = useExecution(selectedExec);
  const current = exec.data ?? executions.data?.find((e) => e.id === selectedExec) ?? null;
  // The selected execution's own status is the freshest; the list only adds other executions.
  const anyLive = isLive(current) || (executions.data ?? []).some((e) => e.id !== current?.id && isLive(e));
  const healing = healActive(heal.data);
  const agentsBusy = runStatus === "queued" || runStatus === "running";
  const locked = agentsBusy || healing; // nobody edits while the agents or the debugger change the code

  const loadFile = React.useCallback(async (path: string) => {
    setBuffers((b) => ({ ...b, [path]: { original: b[path]?.original ?? "", value: b[path]?.value ?? "", loading: true, error: null } }));
    try {
      const text = await runApi.fileContent(runId, path);
      setBuffers((b) => {
        const prev = b[path];
        const dirty = prev && prev.value !== prev.original;
        return { ...b, [path]: { original: text, value: dirty ? prev.value : text, loading: false, error: null } };
      });
    } catch (e) {
      setBuffers((b) => ({ ...b, [path]: { original: "", value: "", loading: false, error: errorText(e) } }));
    }
  }, [runId]);

  function openFile(path: string) {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    if (!BINARY.test(path) && !buffers[path]) void loadFile(path);
  }

  function closeTab(path: string) {
    const b = buffers[path];
    if (b && b.value !== b.original && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
    setTabs((t) => {
      const next = t.filter((p) => p !== path);
      if (active === path) setActive(next.at(-1) ?? null);
      return next;
    });
    setBuffers(({ [path]: _drop, ...rest }) => rest);
  }

  const editable = (path: string) => list.find((f) => f.path === path)?.editable === true;
  const dirtyPaths = Object.entries(buffers).filter(([p, b]) => b.value !== b.original && editable(p)).map(([p]) => p);

  async function save(path: string) {
    const b = buffers[path];
    if (!b) return;
    await sandboxApi.saveFile(runId, path, b.value);
    setBuffers((all) => ({ ...all, [path]: { ...all[path]!, original: b.value } }));
  }

  async function saveAll() {
    setActionError(null);
    setBusy("saving");
    try {
      for (const p of dirtyPaths) await save(p);
      void qc.invalidateQueries({ queryKey: qk.files(runId) });
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function runExperiment() {
    if (!entry) return;
    setActionError(null);
    setBusy("starting");
    try {
      for (const p of dirtyPaths) await save(p); // the backend runs what is saved on disk
      const started = await sandboxApi.start(runId, entry);
      qc.setQueryData(qk.execution(started.id), started);
      setSelectedExec(started.id);
      setPanel("terminal");
      void qc.invalidateQueries({ queryKey: qk.executions(runId) });
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!current) return;
    setActionError(null);
    setBusy("cancelling");
    try {
      await sandboxApi.cancel(current.id);
      void qc.invalidateQueries({ queryKey: qk.execution(current.id) });
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function fixWithAI() {
    if (!current) return;
    setActionError(null);
    setBusy("healing");
    try {
      await sandboxApi.heal(runId, current.id);
      setPanel("fixes");
      void qc.invalidateQueries({ queryKey: ["run", runId, "sandbox", "heal"] });
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  // When the debugger finishes, the code on disk changed: reload files and follow its newest run.
  const wasHealing = React.useRef(false);
  React.useEffect(() => {
    if (wasHealing.current && !healing) {
      void qc.invalidateQueries({ queryKey: qk.files(runId) });
      void qc.invalidateQueries({ queryKey: qk.executions(runId) });
      tabs.filter((p) => !BINARY.test(p)).forEach((p) => void loadFile(p));
      setSelectedExec(null);
    }
    wasHealing.current = healing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healing]);

  // When an execution finishes: refresh the file list and open read-only files (results/, logs/).
  const prevStatus = React.useRef<SandboxExecStatus | null>(null);
  React.useEffect(() => {
    const s = current?.status ?? null;
    if (prevStatus.current && isLive({ status: prevStatus.current } as SandboxExecution) && s && !isLive(current)) {
      void qc.invalidateQueries({ queryKey: qk.files(runId) });
      void qc.invalidateQueries({ queryKey: qk.executions(runId) });
      tabs.filter((p) => !editable(p) && !BINARY.test(p)).forEach((p) => void loadFile(p));
      if (current?.status === "succeeded") setPanel("results");
    }
    prevStatus.current = s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status]);

  /* ── render ── */

  if (files.isPending) return <Skeleton className="h-[70vh]" />;
  if (files.error) return <ErrorState error={files.error} title="Project files" onRetry={() => void files.refetch()} />;
  if (!hasCode) {
    return (
      <EmptyState
        icon={<FileCode size={34} weight="duotone" className="text-purple-deep" />}
        title="No code yet"
        body="Code shows up here after you approve the plan."
      />
    );
  }

  const h = health.data;
  const dockerProblem = h && (!h.available || !h.image_present) ? h.error ?? "The sandbox is not ready." : null;
  const runDisabledReason = dockerProblem
    ? "Docker is not available"
    : agentsBusy
      ? "The agents are working on this run"
      : healing
        ? "The debugger is fixing the code"
      : anyLive
        ? "An execution is already running"
        : !entry
          ? "No Python entrypoint"
          : null;

  const activeBuffer = active ? buffers[active] : undefined;
  const activeEditable = !!active && editable(active) && !locked;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <Card variant="bento" className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SandboxHealthBadge loading={health.isPending} problem={dockerProblem} />
          {h?.limits && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Cpu size={14} /> Runs offline with {h.limits.cpus ?? "?"} CPUs, {h.limits.memory_bytes ? formatBytes(h.limits.memory_bytes) : "?"} memory
              {h.limits.timeout_sec ? ` and a ${Math.round(h.limits.timeout_sec / 60)} min limit` : ""}
            </span>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="sandbox-entry">Script to run</label>
          <Select id="sandbox-entry" className="h-9 w-full font-mono text-xs sm:w-56" value={entry} onChange={(e) => setEntry(e.target.value)}>
            {entrypoints.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Button size="sm" variant="secondary" onClick={() => void saveAll()} disabled={!dirtyPaths.length || locked || anyLive} loading={busy === "saving"}>
            <FloppyDisk size={16} weight="bold" /> Save{dirtyPaths.length ? ` (${dirtyPaths.length})` : ""}
          </Button>
          {isLive(current) ? (
            <Button size="sm" variant="danger" onClick={() => void stop()} loading={busy === "cancelling"} aria-label="Stop execution">
              <Stop size={16} weight="fill" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => void runExperiment()} disabled={!!runDisabledReason} loading={busy === "starting"} title={runDisabledReason ?? undefined}>
              <Play size={16} weight="fill" /> Run Experiment
            </Button>
          )}
        </div>
      </Card>

      {dockerProblem && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft/60 p-3 text-sm text-ink">
          <WarningCircle size={18} className="mt-0.5 shrink-0 text-danger" />
          <span><b>Code can&apos;t run right now.</b> {dockerProblem}</span>
        </p>
      )}
      {healing && (
        <p className="flex items-start gap-2 rounded-2xl bg-sky-soft p-3 text-sm text-sky-deep">
          <FirstAid size={18} className="mt-0.5 shrink-0" />
          The debugger is fixing the code and checking each fix by running it again. Editing is paused until it finishes.
        </p>
      )}
      {agentsBusy && (
        <p className="flex items-start gap-2 rounded-2xl bg-sky-soft p-3 text-sm text-sky-deep">
          <Robot size={18} className="mt-0.5 shrink-0" />
          The agents are working on this run. You can edit and run code when they pause.
        </p>
      )}
      {actionError && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft/60 p-3 text-sm">
          <WarningCircle size={18} className="mt-0.5 shrink-0 text-danger" /> {actionError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* file explorer */}
        <Card variant="bento" className="overflow-hidden">
          <button type="button" onClick={() => setExplorerOpen((o) => !o)} aria-expanded={explorerOpen}
            className="flex w-full items-center justify-between border-b border-line-cool px-4 py-2.5 text-left text-xs font-bold uppercase tracking-[0.12em] text-muted lg:pointer-events-none">
            Files <CaretDown size={14} className={cn("transition-transform lg:hidden", explorerOpen && "rotate-180")} />
          </button>
          <div className={cn("max-h-[40vh] overflow-auto p-2 lg:block lg:max-h-[calc(70vh+44px)]", !explorerOpen && "hidden")}>
            <FileExplorer files={list} active={active} dirty={dirtyPaths} onOpen={openFile} />
          </div>
        </Card>

        {/* editor */}
        <Card variant="bento" className="flex min-w-0 flex-col overflow-hidden">
          <div className="flex min-h-11 items-stretch overflow-x-auto border-b border-line-cool bg-canvas/60" role="tablist" aria-label="Open files">
            {tabs.map((p) => {
              const b = buffers[p];
              const dirty = !!b && b.value !== b.original;
              return (
                <div key={p} role="tab" aria-selected={active === p}
                  className={cn("group flex shrink-0 items-center gap-1.5 border-r border-line-cool px-3 font-mono text-xs", active === p ? "bg-white text-ink" : "text-muted hover:text-ink")}>
                  <button type="button" className="py-2.5" onClick={() => setActive(p)} title={p}>
                    {p.split("/").pop()}{dirty && <span className="ml-0.5 text-purple" aria-label="unsaved changes">*</span>}
                    {!editable(p) && <Lock size={11} className="ml-1 inline opacity-60" aria-label="read-only" />}
                  </button>
                  <button type="button" onClick={() => closeTab(p)} aria-label={`Close ${p}`} className="rounded p-0.5 opacity-60 hover:bg-ink/10 hover:opacity-100">
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="h-[50vh] min-h-[300px] lg:h-[70vh]">
            {!active ? (
              <div className="grid h-full place-items-center p-6 text-sm text-muted">Pick a file to open it.</div>
            ) : BINARY.test(active) ? (
              <BinaryFile runId={runId} path={active} />
            ) : !activeBuffer || activeBuffer.loading ? (
              <Skeleton className="h-full w-full rounded-none" />
            ) : activeBuffer.error ? (
              <div className="p-6"><p role="alert" className="text-sm text-danger">{activeBuffer.error}</p></div>
            ) : (
              <CodeEditor
                path={active}
                value={activeBuffer.value}
                readOnly={!activeEditable}
                onChange={(v) => setBuffers((b) => ({ ...b, [active]: { ...b[active]!, value: v } }))}
                onSave={() => { if (activeEditable && !anyLive) void saveAll(); }}
              />
            )}
          </div>
          {active && (
            <div className="flex items-center justify-between gap-2 border-t border-line-cool px-3 py-1.5 text-[11px] text-muted">
              <span className="truncate font-mono">{active}</span>
              <span>{activeEditable ? "Ctrl+S to save" : "Read only"}</span>
            </div>
          )}
        </Card>
      </div>

      {/* output panels */}
      <Card variant="bento" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-cool px-2 py-1.5">
          <div className="flex gap-1" role="tablist" aria-label="Execution panels">
            {([["terminal", "Output", Terminal], ["results", "Results", ChartBar], ["fixes", "Fixes", FirstAid], ["attempts", "Attempts", ListNumbers]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold", panel === k ? "bg-pill text-white" : "text-ink-soft hover:bg-ink/5")}>
                <Icon size={15} /> {label}
                {k === "attempts" && executions.data?.length ? <span className="text-xs opacity-70">({executions.data.length})</span> : null}
              </button>
            ))}
          </div>
          {current && <ExecSummary exec={current} />}
        </div>
        {panel === "terminal" && (
          <TerminalPanel exec={current} onFix={() => void fixWithAI()} fixing={busy === "healing"}
            canFix={!locked && !anyLive && !dockerProblem} />
        )}
        {panel === "fixes" && <HealPanel sessions={heal.data ?? []} loading={heal.isPending} error={heal.error} />}
        {panel === "results" && <ResultsPanel exec={current} runId={runId} claims={brief.data?.claims ?? []} />}
        {panel === "attempts" && (
          <AttemptsPanel executions={executions.data ?? []} loading={executions.isPending} error={executions.error}
            selected={selectedExec} onSelect={(id) => setSelectedExec(id)} />
        )}
      </Card>
    </div>
  );
}

/* ── pieces ── */

function SandboxHealthBadge({ loading, problem }: { loading: boolean; problem: string | null }) {
  if (loading) return <Badge tone="faint">Checking Docker</Badge>;
  if (problem) return <Badge tone="coral" solid><WarningCircle size={12} weight="bold" /> Sandbox unavailable</Badge>;
  return <Badge tone="mint" solid><CheckCircle size={12} weight="bold" /> Sandbox ready</Badge>;
}

function FileExplorer({ files, active, dirty, onOpen }: { files: RunFile[]; active: string | null; dirty: string[]; onOpen: (p: string) => void }) {
  const groups: { name: string; items: RunFile[] }[] = FOLDERS.map((f) => ({ name: `${f}/`, items: files.filter((x) => x.path.startsWith(`${f}/`)) }));
  const root = files.filter((x) => !x.path.includes("/"));
  return (
    <nav aria-label="Project files" className="space-y-2">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-ink-soft"><FolderSimple size={14} weight="duotone" /> {g.name}</p>
          {g.items.length === 0 ? (
            <p className="px-7 pb-1 text-[11px] text-faint">empty</p>
          ) : (
            <ul>{g.items.map((f) => <FileRow key={f.path} f={f} label={f.path.slice(g.name.length)} active={active} dirty={dirty} onOpen={onOpen} />)}</ul>
          )}
        </div>
      ))}
      {root.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-ink-soft"><FolderSimple size={14} weight="duotone" /> project</p>
          <ul>{root.map((f) => <FileRow key={f.path} f={f} label={f.path} active={active} dirty={dirty} onOpen={onOpen} />)}</ul>
        </div>
      )}
    </nav>
  );
}

function FileRow({ f, label, active, dirty, onOpen }: { f: RunFile; label: string; active: string | null; dirty: string[]; onOpen: (p: string) => void }) {
  const Icon = f.path.endsWith(".py") ? FileCode : File;
  return (
    <li>
      <button type="button" onClick={() => onOpen(f.path)} aria-current={active === f.path ? "true" : undefined}
        className={cn("flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-6 pr-2 text-left font-mono text-xs", active === f.path ? "bg-pill text-white" : "hover:bg-canvas")}>
        <Icon size={13} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {dirty.includes(f.path) && <span className="text-purple" aria-label="unsaved">*</span>}
        {!f.editable && <Lock size={10} className="shrink-0 opacity-50" aria-label="read-only" />}
      </button>
    </li>
  );
}

function BinaryFile({ runId, path }: { runId: string; path: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="font-semibold">{path}</p>
        <p className="mt-1 text-sm text-muted">This file can&apos;t be shown here.</p>
        {isArtifactPath(path) && (
          <a href={sandboxApi.artifactUrl(runId, path)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-pill px-4 py-2 text-sm font-semibold text-white" download>
            <DownloadSimple size={16} /> Download
          </a>
        )}
      </div>
    </div>
  );
}

export function ExecStatusBadge({ status }: { status: SandboxExecStatus }) {
  const m = EXEC_META[status];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone} solid={status !== "queued" && status !== "cancelled"} data-testid="exec-status">
      <Icon size={12} weight="bold" className={status === "running" ? "animate-spin" : undefined} /> {m.label}
    </Badge>
  );
}

function ExecSummary({ exec }: { exec: SandboxExecution }) {
  const live = isLive(exec);
  const elapsed = useElapsed(exec.started_at, live);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-muted">
      <ExecStatusBadge status={exec.status} />
      <span>Attempt {exec.attempt}</span>
      <span>{exec.source === "user" ? "By you" : "By the agent"}</span>
      {!live && exec.exit_code !== null && <span>Exit code <b className="text-ink">{exec.exit_code}</b></span>}
      <span>{live ? `Running for ${seconds(elapsed)}` : `Took ${seconds(exec.duration_ms)}`}</span>
    </div>
  );
}

function TerminalPanel({ exec, onFix, fixing, canFix }: { exec: SandboxExecution | null; onFix: () => void; fixing: boolean; canFix: boolean }) {
  const [stream, setStream] = React.useState<"combined" | "stderr">("combined");
  const log = useLogStream(exec?.id ?? null, stream);
  const ref = React.useRef<HTMLPreElement>(null);
  const stick = React.useRef(true);
  React.useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.text]);

  if (!exec) {
    return <p className="p-6 text-sm text-muted">Nothing has run yet. Press <b>Run Experiment</b> to start.</p>;
  }
  const live = isLive(exec);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-cool bg-canvas/50 px-3 py-1.5 text-xs">
        {(["combined", "stderr"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStream(s)} aria-pressed={stream === s}
            className={cn("rounded-full px-2.5 py-1 font-semibold", stream === s ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}>
            {s === "combined" ? "All output" : "Errors only"}
          </button>
        ))}
        <span className="ml-auto truncate font-mono text-muted">$ {exec.command}</span>
      </div>
      <pre ref={ref} data-testid="terminal-output" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="h-72 overflow-auto whitespace-pre-wrap break-words bg-[#1e1e1e] p-4 font-mono text-[12px] leading-relaxed text-[#d4d4d4] sm:h-80">
        {log.truncated && <span className="text-[#9cdcfe]">Older output is hidden here{"\n"}</span>}
        {log.text || (live ? "Waiting for output" : "No output")}
        {live && <span className="animate-pulse">▍</span>}
      </pre>
      {log.error ? <p className="px-4 py-2 text-xs text-danger">Could not load the output. {errorText(log.error)}</p> : null}
      {!live && <ExecOutcome exec={exec} />}
      {!live && (exec.status === "failed" || exec.status === "timed_out") && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-cool px-4 py-3">
          <Button size="sm" variant="purple" onClick={onFix} loading={fixing} disabled={!canFix}>
            <MagicWand size={16} weight="bold" /> Fix with AI
          </Button>
          <span className="text-xs text-muted">Up to 3 fixes. Each one is checked by running the code again.</span>
        </div>
      )}
    </div>
  );
}

/** What happened, in words: exit code, timeout, cancellation, Docker problems, rejected results. */
function ExecOutcome({ exec }: { exec: SandboxExecution }) {
  const box = "flex items-start gap-2 border-t border-line-cool px-4 py-3 text-sm";
  switch (exec.status) {
    case "succeeded":
      return <p className={cn(box, "bg-mint-soft/60")}><CheckCircle size={18} className="mt-0.5 shrink-0 text-success" /> Finished in {seconds(exec.duration_ms)}. Results saved.</p>;
    case "timed_out":
      return <p className={cn(box, "bg-sun-soft/70")}><Timer size={18} className="mt-0.5 shrink-0 text-sun-deep" /> Stopped because it hit the time limit. Try fewer epochs or less data.</p>;
    case "cancelled":
      return <p className={cn(box, "bg-ink/5")}><StopCircle size={18} className="mt-0.5 shrink-0" /> Stopped by you.</p>;
    case "error":
      return <p role="alert" className={cn(box, "bg-danger-soft/60")}><WarningCircle size={18} className="mt-0.5 shrink-0 text-danger" /> Could not run. {exec.error}</p>;
    default:
      return (
        <p role="alert" className={cn(box, "bg-danger-soft/60")}>
          <XCircle size={18} className="mt-0.5 shrink-0 text-danger" />
          <span>Failed{exec.exit_code !== null ? ` with exit code ${exec.exit_code}` : ""}. {exec.error ?? ""} See <b>Errors only</b> for details.</span>
        </p>
      );
  }
}

function fmtValue(v: number) {
  return Number.isInteger(v) ? String(v) : Math.abs(v) >= 1000 || Math.abs(v) < 0.001 ? v.toPrecision(6) : String(Number(v.toFixed(6)));
}

function ResultsPanel({ exec, runId, claims }: { exec: SandboxExecution | null; runId: string; claims: Claim[] }) {
  if (!exec) return <p className="p-6 text-sm text-muted">Results show here after a run.</p>;
  if (isLive(exec)) return <p className="flex items-center gap-2 p-6 text-sm text-muted"><CircleNotch size={16} className="animate-spin" /> Running. Results show when it finishes.</p>;
  const paperFor = (name: string) => claims.find((c) => c.metric_name === name);
  return (
    <div className="space-y-4 p-4 sm:p-5">
      {exec.metrics_status === "not_collected" ? (
        <p className="text-sm text-muted">This run has no results.</p>
      ) : exec.metrics_status !== "valid" ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft/60 p-3 text-sm">
          <WarningCircle size={18} className="mt-0.5 shrink-0 text-danger" />
          <span><b>No results saved.</b> {exec.metrics_status === "missing" ? "The code did not write results/metrics.json." : exec.metrics_error}</span>
        </p>
      ) : null}

      {exec.metrics.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
            <Info size={14} /> Measured numbers come from this run. Paper numbers come from the paper.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm" data-testid="metrics-table">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 pr-3">Metric</th><th className="pr-3">Measured</th><th className="pr-3">Paper</th><th>Log line</th></tr></thead>
              <tbody>
                {exec.metrics.map((m) => {
                  const c = paperFor(m.name);
                  return (
                    <tr key={m.id} className="border-t border-line-cool align-top">
                      <td className="py-2 pr-3 font-mono text-xs">{m.name}</td>
                      <td className="pr-3 font-display font-bold tabular">{fmtValue(m.value)}</td>
                      <td className="pr-3 text-ink-soft">{c ? <>{fmtValue(c.value)}{c.page ? <span className="text-xs text-muted"> (page {c.page})</span> : null}</> : <span className="text-faint">none</span>}</td>
                      <td className="max-w-[320px] truncate font-mono text-[11px] text-muted" title={m.log_line_text ?? ""}>{m.log_line ? `Line ${m.log_line}: ${m.log_line_text}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {exec.artifacts.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">Files made by this run</p>
          <ul className="space-y-1.5">
            {exec.artifacts.map((a) => (
              <li key={a.path} className="flex flex-wrap items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-sm">
                <span className="font-mono text-xs">{a.path}</span>
                <Badge tone="faint">{a.kind}</Badge>
                {a.size !== null && <span className="text-xs text-muted">{formatBytes(a.size)}</span>}
                {a.kind === "model" && (a.verified ? <Badge tone="mint" solid><CheckCircle size={11} weight="bold" /> Loads OK</Badge>
                  : a.verified === false ? <Badge tone="coral" solid title={a.error ?? ""}><XCircle size={11} weight="bold" /> Does not load</Badge> : null)}
                {exec.status === "succeeded" && (
                  <a className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-purple-deep hover:underline" href={sandboxApi.artifactUrl(runId, a.path)} download>
                    <DownloadSimple size={14} /> Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AttemptsPanel({ executions, loading, error, selected, onSelect }: {
  executions: SandboxExecution[]; loading: boolean; error: unknown; selected: string | null; onSelect: (id: string) => void;
}) {
  if (loading) return <div className="p-4"><Skeleton className="h-24" /></div>;
  if (error) return <div className="p-4"><ErrorState error={error} title="Executions" /></div>;
  if (!executions.length) return <p className="p-6 text-sm text-muted">Nothing has run yet.</p>;
  return (
    <ul className="divide-y divide-line-cool" data-testid="attempts">
      {executions.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => onSelect(e.id)} aria-current={selected === e.id ? "true" : undefined}
            className={cn("flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm", selected === e.id ? "bg-lavender-soft/60" : "hover:bg-canvas")}>
            <ExecStatusBadge status={e.status} />
            <span className="font-semibold">Attempt {e.attempt}</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              {e.source === "user" ? <><User size={12} /> You</> : <><Robot size={12} /> Agent</>}
            </span>
            {e.exit_code !== null && <span className="text-xs text-muted">Exit {e.exit_code}</span>}
            <span className="text-xs text-muted">{seconds(e.duration_ms)}</span>
            {e.error && <span className="w-full truncate text-xs text-danger sm:w-auto sm:flex-1">{e.error}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
