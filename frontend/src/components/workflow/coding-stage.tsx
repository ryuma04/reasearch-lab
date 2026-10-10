"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretDown, CaretRight, CheckCircle, File, FileCode, FileText, Flask, Folder, FolderOpen, MagnifyingGlass, Terminal, WarningCircle, XCircle } from "@phosphor-icons/react";
import { runApi } from "@/lib/api/services";
import type { RunCheckpoint, RunEvent, RunFile } from "@/lib/api/types";
import { qk, useFileContent, useRunFiles } from "@/lib/hooks/queries";
import { agentActivity, buildExecutions, buildTree, redact, type Execution, type TreeNode } from "@/lib/workflow/activity";
import { TOKEN_CLASS, detectLang, highlightLine } from "@/lib/workflow/highlight";
import { cn, formatBytes, formatDuration, formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/content";
import { Badge, Card, StatusDot } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { AgentCardView, HelpCard, LongRunCard } from "./shared";
import type { AgentInfo } from "./types";

/* ── File explorer ── */

function iconFor(name: string) {
  if (/\.(py|r|sh)$/i.test(name)) return FileCode;
  if (/test/i.test(name)) return Flask;
  if (/\.(md|txt|log|json|ya?ml|toml|xml)$/i.test(name)) return FileText;
  return File;
}

const TreeRow = React.memo(function TreeRow({ node, depth, open, toggle, selected, select, changes }: {
  node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; select: (p: string) => void; changes: Map<string, "new" | "modified">;
}) {
  const isOpen = open.has(node.path);
  const Icon = node.dir ? (isOpen ? FolderOpen : Folder) : iconFor(node.name);
  const change = node.dir ? null : changes.get(node.path);
  return (
    <>
      <li>
        <button type="button" role="treeitem" aria-expanded={node.dir ? isOpen : undefined} aria-selected={selected === node.path}
          onClick={() => (node.dir ? toggle(node.path) : select(node.path))}
          className={cn("flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px] hover:bg-lavender-soft", selected === node.path && "bg-lavender-soft font-semibold")}
          style={{ paddingLeft: 6 + depth * 14 }}>
          {node.dir ? (isOpen ? <CaretDown size={11} /> : <CaretRight size={11} />) : <span className="w-[11px]" />}
          <Icon size={15} weight={node.dir ? "fill" : "regular"} className={node.dir ? "text-sun-deep" : "text-muted"} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {change && <Badge tone={change === "new" ? "mint" : "sun"} className="px-1.5 py-0.5 text-[9px]">{change}</Badge>}
        </button>
      </li>
      {node.dir && isOpen && node.children.map((c) => <TreeRow key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} selected={selected} select={select} changes={changes} />)}
    </>
  );
});

/** Flags files that appear or change size AFTER the first snapshot of this tab (real API data only). */
function useFileChanges(files: RunFile[] | undefined) {
  const snapshot = React.useRef<Map<string, number | null> | null>(null);
  const [changes, setChanges] = React.useState<Map<string, "new" | "modified">>(new Map());
  React.useEffect(() => {
    if (!files) return;
    const now = new Map(files.map((f) => [f.path, f.size_bytes] as const));
    const prev = snapshot.current;
    if (prev) {
      setChanges((old) => {
        const next = new Map(old);
        for (const [p, size] of now) {
          if (!prev.has(p)) next.set(p, "new");
          else if (prev.get(p) !== size && next.get(p) !== "new") next.set(p, "modified");
        }
        return next;
      });
    }
    snapshot.current = now;
  }, [files]);
  return changes;
}

function Explorer({ files, selected, select, changes }: { files: RunFile[]; selected: string | null; select: (p: string) => void; changes: Map<string, "new" | "modified"> }) {
  const [q, setQ] = React.useState("");
  const tree = React.useMemo(() => buildTree(files, null), [files]);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !files.length) return;
    seeded.current = true;
    setOpen(new Set(files.flatMap((f) => f.path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/")))));
  }, [files]);
  const toggle = React.useCallback((p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }), []);
  const matches = q.trim() ? files.filter((f) => f.path.toLowerCase().includes(q.trim().toLowerCase())) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="m-2 flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm">
        <MagnifyingGlass size={14} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" aria-label="Search files" className="w-full bg-transparent outline-none" />
      </label>
      <ul role="tree" aria-label="Project files" className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {matches ? (
          matches.length ? matches.map((f) => (
            <li key={f.path}><button type="button" onClick={() => select(f.path)} className={cn("w-full truncate rounded-lg px-2 py-1 text-left text-[13px] hover:bg-lavender-soft", selected === f.path && "bg-lavender-soft font-semibold")}>{f.path}</button></li>
          )) : <li className="p-3 text-sm text-muted">No file matches “{q}”.</li>
        ) : tree.map((n) => <TreeRow key={n.path} node={n} depth={0} open={open} toggle={toggle} selected={selected} select={select} changes={changes} />)}
      </ul>
    </div>
  );
}

/* ── Code viewer (read-only snapshot of the sandbox file) ── */

const MAX_LINES = 1500;

function Viewer({ runId, path, size, changed }: { runId: string; path: string | null; size: number | null; changed?: "new" | "modified" }) {
  const content = useFileContent(runId, path);
  const [all, setAll] = React.useState(false);
  React.useEffect(() => setAll(false), [path]);
  const lang = path ? detectLang(path) : "text";
  const text = typeof content.data === "string" ? content.data : "";
  const lines = React.useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  const shown = all ? lines : lines.slice(0, MAX_LINES);
  const rows = React.useMemo(() => shown.map((l) => highlightLine(l, lang)), [shown, lang]);

  if (!path) return <EmptyState title="Select a file" body="Pick a file in the explorer to read what the agents wrote." />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-ink bg-pill">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/85">{path}</span>
        {changed && <Badge tone={changed === "new" ? "mint" : "sun"} solid>{changed === "new" ? "newly created" : "modified"}</Badge>}
        <span className="text-[11px] text-white/50">{lang} · {formatBytes(size)} · read-only snapshot</span>
        {text && <CopyButton text={text} />}
      </div>
      {content.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-4 w-2/3 bg-white/10" /><Skeleton className="h-4 w-1/2 bg-white/10" /><Skeleton className="h-4 w-3/4 bg-white/10" /></div>
        : content.error ? <div className="p-4"><ErrorState error={content.error} title="Couldn't read this file" onRetry={() => void content.refetch()} /></div>
        : (
          <pre tabIndex={0} aria-label={`Contents of ${path}`} className="min-h-0 flex-1 overflow-auto py-3 text-[12.5px] leading-6 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-lavender">
            <code>
              {rows.map((toks, i) => (
                <div key={i} className="flex px-3">
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-white/30">{i + 1}</span>
                  <span className="whitespace-pre">{toks.length ? toks.map((t, j) => <span key={j} className={TOKEN_CLASS[t.kind]}>{t.text}</span>) : " "}</span>
                </div>
              ))}
              {!all && lines.length > MAX_LINES && (
                <div className="px-3 pt-2"><Button size="sm" variant="secondary" onClick={() => setAll(true)}>Show all {lines.length} lines</Button></div>
              )}
              {!text && <div className="px-3 text-white/50">(empty file)</div>}
            </code>
          </pre>
        )}
    </div>
  );
}

/* ── Terminal: real sandbox executions and their logs ── */

function LogView({ runId, ex }: { runId: string; ex: Execution }) {
  const path = ex.logPath;
  const q = useQuery({
    queryKey: qk.file(runId, path ?? ""),
    queryFn: ({ signal }) => runApi.fileContent(runId, path!, signal),
    enabled: !!path,
    refetchInterval: ex.running ? 2000 : false,
  });
  const boxRef = React.useRef<HTMLPreElement>(null);
  const text = typeof q.data === "string" ? redact(q.data) : "";
  const lines = text.split("\n");
  const tail = lines.length > 400 ? lines.slice(-400).join("\n") : text;
  React.useEffect(() => { if (ex.running && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [tail, ex.running]);
  if (!path) return <p className="p-3 text-xs text-white/60">No log file was reported for this execution.</p>;
  if (q.isPending) return <p className="p-3 text-xs text-white/60">Loading the log…</p>;
  if (q.error) return <p className="p-3 text-xs text-[#ff9b94]">The log couldn&apos;t be read yet (it may still be starting).</p>;
  return (
    <>
      {lines.length > 400 && <p className="px-3 pt-2 text-[11px] text-white/50">Showing the last 400 of {lines.length} lines.</p>}
      <pre ref={boxRef} tabIndex={0} aria-label={`Log of ${ex.phase}`} className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11.5px] leading-5 text-[#d6f5d6]">{tail || "(no output yet)"}</pre>
    </>
  );
}

export function TerminalPanel({ runId, events, defaultOpen = true }: { runId: string; events: RunEvent[]; defaultOpen?: boolean }) {
  const execs = React.useMemo(() => buildExecutions(events).reverse(), [events]);
  const [open, setOpen] = React.useState(defaultOpen);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const first = execs[0]?.execId;
  const current = expanded ?? first ?? null;
  const running = execs.some((e) => e.running);
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-ink bg-[#14121f]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-white">
        <Terminal size={16} weight="bold" /> <span className="font-mono text-sm font-bold">Sandbox terminal</span>
        {running && <Badge tone="sky" solid><StatusDot tone="sky" pulse /> running</Badge>}
        <span className="ml-auto text-xs text-white/50">{execs.length} execution{execs.length === 1 ? "" : "s"}</span>
        {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
      </button>
      {open && (
        <div className="border-t border-white/10">
          {!execs.length ? <p className="p-4 text-sm text-white/60">No code has run yet. Each install and run in the isolated container shows up here with its real output.</p> : (
            <ul>
              {execs.map((ex) => {
                const isOpen = current === ex.execId;
                const ok = ex.exitCode === 0;
                return (
                  <li key={ex.execId} className="border-b border-white/5 last:border-0">
                    <button type="button" onClick={() => setExpanded(isOpen ? "" : ex.execId)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-white hover:bg-white/5">
                      {ex.running ? <StatusDot tone="sky" pulse /> : ok ? <CheckCircle size={15} weight="fill" className="text-[#7be08a]" /> : <XCircle size={15} weight="fill" className="text-[#ff7b72]" />}
                      <Badge tone="faint" className="bg-white/10 text-white">{ex.phase || "run"}</Badge>
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-white/80">$ {ex.command || "…"}</code>
                      <span className="text-[11px] text-white/50">{ex.running ? `started ${formatTime(ex.startedAt)}` : `exit ${ex.exitCode ?? "?"} · ${formatDuration(ex.durationSec)}`}</span>
                    </button>
                    {isOpen && <LogView runId={runId} ex={ex} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Coding stage ── */

export function CodingStage({ runId, events, agents, ended, awaiting, canAct }: {
  runId: string; events: RunEvent[]; agents: AgentInfo[]; ended: boolean; awaiting: RunCheckpoint | null; canAct: boolean;
}) {
  const files = useRunFiles(runId);
  const changes = useFileChanges(files.data);
  const [path, setPath] = React.useState<string | null>(null);
  const list = React.useMemo(() => files.data ?? [], [files.data]);
  React.useEffect(() => {
    if (!path && list.length) setPath((list.find((f) => f.path.startsWith("src/") && f.kind === "code") ?? list.find((f) => f.kind === "code") ?? list[0]!).path);
  }, [list, path]);
  const sel = list.find((f) => f.path === path) ?? null;
  const coders = React.useMemo(() => agents.filter((a) => a.group === "coding"), [agents]);
  const acts = React.useMemo(() => coders.map((a) => ({ a, act: agentActivity(events, a.id, ended) })), [coders, events, ended]);

  return (
    <div className="space-y-4">
      {canAct && awaiting?.name === "long_run" && <LongRunCard runId={runId} cp={awaiting} />}
      {canAct && awaiting?.name === "help" && <HelpCard runId={runId} cp={awaiting} />}
      {!canAct && awaiting && <p className="rounded-2xl bg-lavender-soft p-3 text-sm font-semibold">Waiting for the owner or an editor to answer: {awaiting.name === "help" ? "the agents need help" : "choose the run length"}.</p>}

      <p className="flex items-start gap-2 rounded-2xl bg-sky-soft p-3 text-sm text-sky-deep"><WarningCircle size={18} className="mt-0.5 shrink-0" /> All generated code runs only in the backend&apos;s isolated sandbox. This view shows read-only snapshots of the files and the real output of each run.</p>

      <div className="grid gap-4 lg:h-[34rem] lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        <Card variant="bento" className="flex max-h-72 min-h-0 flex-col overflow-hidden lg:max-h-none" aria-label="Project explorer">
          <p className="border-b border-line-cool px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted">Project files · {list.length}</p>
          {files.isPending ? <div className="space-y-2 p-3"><Skeleton className="h-5" /><Skeleton className="h-5" /><Skeleton className="h-5" /></div>
            : files.error ? <div className="p-2"><ErrorState error={files.error} title="Files" onRetry={() => void files.refetch()} /></div>
            : list.length ? <Explorer files={list} selected={path} select={setPath} changes={changes} />
            : <p className="p-3 text-sm text-muted">No files yet. The Code Writer creates them after you approve the plan.</p>}
        </Card>
        <div className="h-[28rem] min-h-0 lg:h-auto"><Viewer runId={runId} path={path} size={sel?.size_bytes ?? null} changed={path ? changes.get(path) : undefined} /></div>
        <div className="max-h-[34rem] space-y-3 overflow-y-auto lg:max-h-none" aria-label="Coding agents">
          {acts.length ? acts.map(({ a, act }) => <AgentCardView key={a.id} name={a.name} description={a.description} a={act} />) : <Skeleton className="h-40" />}
        </div>
      </div>

      <TerminalPanel runId={runId} events={events} />
    </div>
  );
}
