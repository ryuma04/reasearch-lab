"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { Brain, CheckCircle, DownloadSimple, FilePdf, Flask, MagnifyingGlass, SealCheck, TreeStructure, WarningCircle, XCircle, Robot, User, Info, FloppyDisk } from "@phosphor-icons/react";
import type { Metric, ScorecardEntry, WhatIfBranch } from "@/lib/api/types";
import { runApi, workspaceApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { qk, useAgents, useBrief, useFileContent, useGaps, useNotes, useRunFiles, useRunMemory, useScorecard, useSettings, useTests, useWhatIfs } from "@/lib/hooks/queries";
import { repairHistory } from "@/lib/run-state";
import type { RunEvent } from "@/lib/api/types";
import { agentStageMeta, claimStatusMeta, settingSourceMeta, whatIfStatusMeta } from "@/lib/status";
import { LIMITS } from "@/lib/config";
import { cn, formatBytes, formatDateTime, formatNumber, shortId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Mono, SectionTitle, StatCard, Textarea } from "@/components/ui/primitives";
import { CodeViewer, Markdown } from "@/components/ui/content";
import { EmptyState, ErrorState, QueryView, Skeleton } from "@/components/ui/states";
import { Sheet, toast } from "@/components/ui/overlays";
import { EventFeed } from "@/components/run/board";

/* ── Hero 2: every number links to its proof ── */
export function ProofNumber({ metric, className }: { metric: Metric | null | undefined; className?: string }) {
  if (!metric) return <span className="text-sm font-semibold text-faint" title="No measured value — never filled in by AI">Unverified</span>;
  return (
    <Popover.Root>
      <Popover.Trigger className={cn("tabular rounded-lg px-1 font-display font-bold underline decoration-purple decoration-dotted decoration-2 underline-offset-4 hover:bg-lavender-soft", className)} aria-label={`${metric.value} — show proof`}>
        {formatNumber(metric.value, 4)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-72 rounded-[20px] border-2 border-ink bg-white p-4 text-sm shadow-pop-lg">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-success"><SealCheck size={14} weight="fill" /> Measured, not written by AI</p>
          <dl className="mt-2 space-y-1 text-xs">
            <Row k="Metric" v={<Mono>{metric.name}</Mono>} />
            <Row k="Run" v={<Mono>{shortId(metric.run_id, 10)}</Mono>} />
            {metric.git_commit && <Row k="Commit" v={<Mono>{shortId(metric.git_commit)}</Mono>} />}
            <Row k="Log" v={<Mono>{metric.log_file ?? "log"}{metric.log_line != null ? `:${metric.log_line}` : ""}</Mono>} />
            <Row k="Log hash" v={<Mono>{metric.log_file_hash}</Mono>} />
            {metric.recorded_at && <Row k="Recorded" v={formatDateTime(metric.recorded_at)} />}
          </dl>
          {metric.log_excerpt && <pre className="mt-2 overflow-x-auto rounded-xl bg-pill p-2 font-mono text-[11px] text-white">{metric.log_excerpt}</pre>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="min-w-0 truncate text-right">{v}</dd></div>;

/* ── Research ── */
export function ResearchTab({ runId }: { runId: string }) {
  const brief = useBrief(runId);
  return (
    <QueryView query={brief} feature="Research Brief">
      {(b) => (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-5">
            <Card className="p-6"><SectionTitle title="Summary" /><p className="mt-3 text-ink-soft">{b.summary}</p>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-muted">Method</p><ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{b.method.map((m) => <li key={m}>{m}</li>)}</ol></Card>
            <Card className="p-6"><SectionTitle title="Claims list" kicker={`${b.claims.length} claims`} />
              <ul className="mt-3 space-y-2">{b.claims.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-canvas p-3 text-sm"><span className="flex-1 font-semibold">{c.description}</span><span className="tabular font-display font-bold">{c.value} {c.unit}</span><Badge tone="mint">p.{c.page ?? "?"}{c.table_ref ? ` · ${c.table_ref}` : ""}</Badge></li>
              ))}</ul></Card>
          </div>
          <div className="space-y-5">
            <Card variant="soft" tone="lavender" className="p-6"><p className="font-display font-bold">Recommendation</p><p className="mt-2 text-sm">{b.recommendation}</p></Card>
            <Card className="p-6"><SectionTitle title="Sources" />
              <ul className="mt-3 space-y-2">{b.sources.map((s) => (
                <li key={s.id} className="rounded-2xl border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone="sky">{s.kind}</Badge>{s.official && <Badge tone="mint">official</Badge>}{s.used && <Badge tone="purple" solid>used</Badge>}{s.fits_budget === false && <Badge tone="pink">too big</Badge>}</div>
                  <p className="mt-1.5 font-semibold">{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{s.title}</a> : s.title}</p>
                  <p className="text-xs text-muted">{[s.license, s.size, s.notes].filter(Boolean).join(" · ")}</p>
                </li>
              ))}</ul></Card>
            <Card className="p-6"><SectionTitle title="Missing details" />
              <ul className="mt-3 space-y-2 text-sm">{b.missing_details.map((m) => <li key={m.name} className="rounded-2xl bg-warning-soft p-3"><b>{m.name}</b> — {m.note}{m.assumed_value && <> Assumed: <Mono>{m.assumed_value}</Mono></>}</li>)}</ul></Card>
          </div>
        </div>
      )}
    </QueryView>
  );
}

/* ── Coding ── */
export function CodingTab({ runId, events }: { runId: string; events: RunEvent[] }) {
  const files = useRunFiles(runId);
  const settings = useSettings(runId);
  const [path, setPath] = React.useState<string | null>(null);
  const content = useFileContent(runId, path);
  const repairs = repairHistory(events);
  React.useEffect(() => { if (!path && files.data?.length) setPath(files.data.find((f) => f.kind === "code")?.path ?? files.data[0]!.path); }, [files.data, path]);
  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 rounded-2xl bg-sky-soft p-3 text-sm text-sky-deep"><Info size={18} /> All generated code runs only in the backend&apos;s isolated sandbox. Nothing here is executed in your browser.</p>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card variant="bento" className="p-2">
          <QueryView query={files} feature="Generated files" isEmpty={(f) => !f.length} empty={<p className="p-4 text-sm text-muted">No files yet.</p>}>
            {(list) => (
              <ul>{list.map((f) => (
                <li key={f.path}><button onClick={() => setPath(f.path)} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-mono text-xs", path === f.path ? "bg-pill text-white" : "hover:bg-canvas")}>
                  <span className="min-w-0 flex-1 truncate">{f.path}</span><span className="opacity-60">{formatBytes(f.size_bytes)}</span></button></li>
              ))}</ul>
            )}
          </QueryView>
        </Card>
        <div>
          {!path ? <EmptyState title="Pick a file" /> : content.isPending ? <Skeleton className="h-80" /> : content.error ? <ErrorState error={content.error} title="File content" onRetry={() => void content.refetch()} /> : (
            <CodeViewer code={content.data ?? ""} title={path} actions={<a href={runApi.fileDownloadUrl(runId, path)} className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20" download><DownloadSimple size={14} /> Download</a>} />
          )}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6"><SectionTitle title="Missing Details Log" kicker="Every setting & its source" />
          <QueryView query={settings} feature="Settings" isEmpty={(s) => !s.length}>
            {(list) => (
              <ul className="mt-3 space-y-1.5">{list.map((s) => {
                const m = settingSourceMeta[s.source];
                return (
                  <li key={s.id} className="flex items-start gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-canvas" title={`${m.label}${s.source_ref ? ` — ${s.source_ref}` : ""}${s.reason ? ` — ${s.reason}` : ""}`}>
                    <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", m.dot)} aria-hidden />
                    <div className="min-w-0 flex-1"><p><Mono>{s.name}</Mono> = <b>{s.value}</b></p><p className="text-xs text-muted">{m.label}{s.source_ref ? ` · ${s.source_ref}` : ""}{s.reason ? ` · ${s.reason}` : ""}</p></div>
                  </li>
                );
              })}</ul>
            )}
          </QueryView>
        </Card>
        <Card variant="bento"><div className="border-b border-line-cool px-5 py-3"><p className="font-display font-bold">Repair history</p><p className="text-xs text-muted">Each error and its fix, from run events</p></div>
          <EventFeed events={repairs} /></Card>
      </div>
    </div>
  );
}

/* ── Testing ── */
export function TestingTab({ runId }: { runId: string }) {
  const tests = useTests(runId);
  return (
    <QueryView query={tests} feature="Test report" isEmpty={(t) => !t.tests.length} empty={<EmptyState title="No tests yet" body="The Testing Agent writes tests after coding finishes." />}>
      {(r) => {
        const passed = r.tests.filter((t) => t.status === "passed").length;
        return (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Passed" value={passed} tone="mint" icon={<CheckCircle size={18} weight="duotone" />} />
              <StatCard label="Failed / error" value={r.tests.filter((t) => t.status === "failed" || t.status === "error").length} tone="pink" icon={<XCircle size={18} weight="duotone" />} />
              <StatCard label="Total" value={r.tests.length} tone="sky" icon={<Flask size={18} weight="duotone" />} />
            </div>
            {(["correctness", "claim"] as const).map((kind) => (
              <Card key={kind} className="p-6"><SectionTitle title={kind === "claim" ? "Claim tests" : "Correctness tests"} />
                <ul className="mt-3 space-y-2">{r.tests.filter((t) => t.kind === kind).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-canvas p-3 text-sm">
                    {t.status === "passed" ? <CheckCircle size={18} weight="fill" className="text-success" /> : t.status === "skipped" ? <Info size={18} className="text-muted" /> : <XCircle size={18} weight="fill" className="text-danger" />}
                    <span className="flex-1 font-semibold">{t.name}</span>{t.message && <span className="font-mono text-xs text-muted">{t.message}</span>}<span className="text-xs text-muted">{t.duration_ms != null ? `${t.duration_ms} ms` : ""}</span>
                  </li>
                ))}</ul></Card>
            ))}
          </div>
        );
      }}
    </QueryView>
  );
}

/* ── Scorecard + Gap Detective ── */
export function ScorecardTable({ entries, paperFileUrl }: { entries: ScorecardEntry[]; paperFileUrl?: (paperId: string) => string }) {
  const [open, setOpen] = React.useState<ScorecardEntry | null>(null);
  const counts = entries.reduce<Record<string, number>>((a, e) => ({ ...a, [e.status ?? "unverified"]: (a[e.status ?? "unverified"] ?? 0) + 1 }), {});
  return (
    <>
      <div className="flex flex-wrap gap-2">{(["match", "close", "different", "unverified"] as const).map((k) => <Badge key={k} tone={claimStatusMeta[k].tone} solid>{counts[k] ?? 0} {claimStatusMeta[k].label}</Badge>)}</div>
      <Card className="mt-4 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-canvas text-left text-[11px] font-bold uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-3">Claim</th><th className="px-4 py-3">Paper</th><th className="px-4 py-3">Ours (measured)</th><th className="px-4 py-3">Difference</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Proof</span></th></tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const st = claimStatusMeta[e.status ?? "unverified"];
                return (
                  <tr key={e.id} className="border-t border-line transition-colors hover:bg-canvas/60">
                    <td className="px-4 py-3"><p className="font-semibold">{e.claim.description}</p>{e.claim.condition && <p className="text-xs text-muted">{e.claim.condition}</p>}</td>
                    <td className="tabular px-4 py-3">{formatNumber(e.claim.value)} {e.claim.unit} <span className="block text-xs text-muted">p.{e.claim.page ?? "?"}{e.claim.table_ref ? ` · ${e.claim.table_ref}` : ""}</span></td>
                    <td className="px-4 py-3"><ProofNumber metric={e.metric} /></td>
                    <td className="tabular px-4 py-3">{e.difference != null ? `${e.difference > 0 ? "+" : ""}${formatNumber(e.difference)}` : "—"}{e.tolerance != null && <span className="block text-xs text-muted">tolerance ±{Math.round(e.tolerance * 100)}%</span>}</td>
                    <td className="px-4 py-3"><Badge tone={st.tone} solid>{st.label}</Badge></td>
                    <td className="px-4 py-3"><Button size="sm" variant="soft" onClick={() => setOpen(e)}>Evidence</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Claim evidence" description={open?.claim.description}>
        {open && (
          <div className="space-y-4 text-sm">
            <Card variant="flat" className="p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted">From the paper</p>
              <p className="tabular mt-1 font-display text-2xl font-bold">{formatNumber(open.claim.value)} {open.claim.unit}</p>
              <p className="text-muted">Page {open.claim.page ?? "unknown"}{open.claim.table_ref ? ` · ${open.claim.table_ref}` : ""}</p>
              {paperFileUrl && open.claim.page != null && <a className="mt-2 inline-flex items-center gap-1 font-semibold text-purple-deep underline" href={`${paperFileUrl(open.claim.paper_id)}#page=${open.claim.page}`} target="_blank" rel="noopener noreferrer"><FilePdf size={16} /> Open paper at page {open.claim.page}</a>}
            </Card>
            <Card variant="flat" className="p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted">From our run</p>
              {open.metric ? (<><p className="mt-1 text-2xl"><ProofNumber metric={open.metric} /></p>{open.metric.log_excerpt && <CodeViewer code={open.metric.log_excerpt} title={`${open.metric.log_file ?? "log"}:${open.metric.log_line ?? "?"}`} maxHeight="8rem" />}</>) : <p className="mt-1 text-muted">Not measured yet — no number is shown until the sandbox writes one.</p>}
            </Card>
            {open.explanation && <p className="rounded-2xl bg-lavender-soft p-3 text-purple-deep"><b>AI explanation:</b> {open.explanation}</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}

export function ScorecardTab({ runId, workspaceId }: { runId: string; workspaceId: string }) {
  const sc = useScorecard(runId);
  const gaps = useGaps(runId);
  return (
    <div className="space-y-6">
      <QueryView query={sc} feature="Claim Scorecard" isEmpty={(s) => !s.length} empty={<EmptyState title="No claims scored yet" />}>
        {(entries) => <ScorecardTable entries={entries} paperFileUrl={workspaceApi.paperFileUrl} />}
      </QueryView>
      <section>
        <SectionTitle kicker="Gap Detective" title="Why do our numbers differ?" />
        <div className="mt-4">
          <QueryView query={gaps} feature="Gap analysis" isEmpty={(g) => !g.differences.length}>
            {(g) => (
              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <Card className="p-6"><ul className="space-y-3">{g.differences.sort((a, b) => a.rank - b.rank).map((d) => (
                  <li key={d.id} className="rounded-2xl border border-line p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="ink" solid>#{d.rank}</Badge><Mono>{d.setting}</Mono><span>ours <b>{d.ours}</b> vs paper <b>{d.paper}</b></span></div>
                    {d.experiment ? (
                      <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone="mint">Measured</Badge> Diagnostic run result: <ProofNumber metric={d.experiment.metric} />{d.experiment.gap_closed != null && <span className="text-muted">· closed {formatNumber(d.experiment.gap_closed)} of the gap</span>} <Badge>{d.experiment.status}</Badge></p>
                    ) : <p className="mt-2 flex items-center gap-2 text-muted"><Badge tone="sun">Hypothesis</Badge> Not tested yet — possible cause only.</p>}
                  </li>
                ))}</ul></Card>
                <div className="space-y-4">
                  {g.explanation && <Card variant="soft" tone="lavender" className="p-5 text-sm"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"><Robot size={14} /> AI explanation (numbers come only from measured runs)</p><p className="mt-2">{g.explanation}</p></Card>}
                  {g.seed_runs?.length ? <Card variant="bento" className="p-5 text-sm"><p className="font-bold">Seed variation</p><div className="mt-2 flex flex-wrap gap-3">{g.seed_runs.map((m) => <ProofNumber key={m.id} metric={m} />)}</div></Card> : null}
                </div>
              </div>
            )}
          </QueryView>
        </div>
      </section>
      <p className="text-xs text-muted">Workspace {shortId(workspaceId)} · run {shortId(runId)}</p>
    </div>
  );
}

/* ── What-ifs ── */
export function WhatIfTab({ runId, readOnly }: { runId: string; readOnly?: boolean }) {
  const list = useWhatIfs(runId, 10_000);
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const create = useMutation({
    mutationFn: (question: string) => runApi.createWhatIf(runId, { question }),
    onSuccess: async (b) => {
      setQ("");
      toast.success("What-if submitted", `${b.length || 1} branch(es) created by the backend`);
      await qc.invalidateQueries({ queryKey: qk.whatifs(runId) });
    },
    onError: (e) => toast.error("Couldn't ask what-if", userMessage(e)),
  });
  const best = (list.data ?? []).filter((b) => b.status === "done" && b.result_metric).sort((a, b) => a.result_metric!.value - b.result_metric!.value)[0];
  return (
    <div className="space-y-5">
      {!readOnly && (
        <Card className="p-5">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) create.mutate(q.trim()); }}>
            <Textarea className="min-h-12 flex-1" rows={1} value={q} onChange={(e) => setQ(e.target.value)} maxLength={LIMITS.questionMax} placeholder='e.g. "What if the temperature is 2, 5, 10 or 20?"' aria-label="What-if question" />
            <Button type="submit" variant="purple" loading={create.isPending} disabled={!q.trim()}><TreeStructure size={18} weight="bold" /> Ask what-if</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Voice input requires a backend speech endpoint that is not in the contract yet.</p>
        </Card>
      )}
      <QueryView query={list} feature="What-if branches" isEmpty={(l) => !l.length} empty={<EmptyState title="No what-if branches yet" body="Ask a question — each becomes a small experiment branch." />}>
        {(branches) => (
          <div className="relative space-y-3 border-l-4 border-ink/10 pl-5">
            {branches.map((b: WhatIfBranch) => {
              const st = whatIfStatusMeta[b.status];
              return (
                <Card key={b.id} className={cn("relative p-4", b.status === "stopped_early" && "opacity-60", best?.id === b.id && "ring-2 ring-success")}>
                  <span className="absolute -left-[30px] top-6 h-4 w-4 rounded-full border-2 border-ink bg-white" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-semibold">{b.question}</p><Badge tone={st.tone} solid>{st.label}</Badge>{best?.id === b.id && <Badge tone="mint" solid>Best so far</Badge>}</div>
                  <p className="mt-1 text-xs text-muted">{Object.entries(b.settings_change).map(([k, v]) => `${k} = ${String(v)}`).join(", ") || "Settings pending"}{b.branch_name ? ` · branch ${b.branch_name}` : ""}{b.round != null ? ` · round ${b.round}` : ""}{b.budget_seconds ? ` · budget ${b.budget_seconds}s` : ""}{b.suggested_by === "manager" ? " · suggested by Team Manager" : ""}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">{b.result_metric ? <>Result: <ProofNumber metric={b.result_metric} /> <span className="text-xs text-muted">{b.result_metric.name}</span></> : <span className="text-muted">{b.status === "proposed" ? "Not run — a suggestion, not a discovery." : "No measured result yet."}</span>}</div>
                  {b.stop_reason && <p className="mt-1 text-xs text-muted">Stopped: {b.stop_reason}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </QueryView>
    </div>
  );
}

/* ── Team ── */
export function TeamTab({ events }: { events: RunEvent[] }) {
  const agents = useAgents();
  const decisions = events.filter((e) => e.type === "team_decision");
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <QueryView query={agents} feature="Agent team" isEmpty={(a) => !a.length}>
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2">{list.map((a) => (
            <Link key={a.id} href={`/team?agent=${encodeURIComponent(a.id)}`}><Card interactive className="h-full p-4">
              <div className="flex items-center justify-between gap-2"><p className="font-bold">{a.name}</p><Badge tone={agentStageMeta[a.stage].tone} solid>{agentStageMeta[a.stage].label}</Badge></div>
              <p className="mt-1 text-xs text-muted">{a.kind}{a.current_version?.model ? ` · ${a.current_version.model}` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-1">{a.current_version?.skill_tags.map((s) => <Badge key={s} tone="sky">{s}</Badge>)}</div>
              <p className="tabular mt-3 font-display text-xl font-bold">{a.avg_score != null ? a.avg_score.toFixed(2) : "—"} <span className="text-xs font-normal text-muted">avg score</span></p>
            </Card></Link>
          ))}</div>
        )}
      </QueryView>
      <Card variant="bento"><div className="border-b border-line-cool px-5 py-3"><p className="font-display font-bold">Team decisions in this run</p></div>
        <EventFeed events={decisions} /></Card>
    </div>
  );
}

/* ── Memory ── */
export function MemoryTab({ runId }: { runId: string }) {
  const mem = useRunMemory(runId);
  return (
    <QueryView query={mem} feature="Run memory">
      {(m) => (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-6"><SectionTitle title="Reused from earlier runs" kicker="Retrieved memory — not measured here" />
            <ul className="mt-3 space-y-2">{m.reused.length ? m.reused.map((r) => (
              <li key={r.item.id} className="rounded-2xl bg-lavender-soft p-3 text-sm"><p className="flex items-center gap-1.5 font-semibold"><Brain size={16} /> {r.item.text}</p><p className="mt-1 text-xs text-purple-deep">Learned in run {r.item.source_run_id ?? "?"} · used by {r.agent ?? "agent"} at {formatDateTime(r.used_at)}</p></li>
            )) : <li className="text-sm text-muted">Nothing reused.</li>}</ul></Card>
          <Card className="p-6"><SectionTitle title="Learned in this run" kicker="Saved to Lab Memory" />
            <ul className="mt-3 space-y-2">{m.learned.length ? m.learned.map((i) => (
              <li key={i.id} className="rounded-2xl bg-mint-soft p-3 text-sm"><Badge tone="mint" solid>{i.kind.replace("_", " ")}</Badge><p className="mt-1 font-semibold">{i.text}</p></li>
            )) : <li className="text-sm text-muted">Nothing new learned.</li>}</ul></Card>
          <p className="text-sm lg:col-span-2"><Link href="/memory" className="font-semibold text-purple-deep underline"><MagnifyingGlass size={14} className="inline" /> Search the whole Lab Memory</Link></p>
        </div>
      )}
    </QueryView>
  );
}

/* ── Notes ── */
export function NotesTab({ workspaceId, readOnly }: { workspaceId: string; readOnly?: boolean }) {
  const notes = useNotes(workspaceId);
  const qc = useQueryClient();
  const mine = notes.data?.find((n) => typeof n.author === "object" ? n.author.type === "user" : n.author === "user");
  const [draft, setDraft] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const value = draft ?? mine?.markdown ?? "";
  const save = useMutation({
    mutationFn: () => workspaceApi.saveNotes(workspaceId, { markdown: value }),
    onSuccess: async () => { setDraft(null); await qc.invalidateQueries({ queryKey: qk.notes(workspaceId) }); toast.success("Notes saved"); },
    onError: (e) => toast.error("Couldn't save notes", userMessage(e)),
  });
  return (
    <QueryView query={notes} feature="Notes">
      {(list) => (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-1.5 font-display font-bold"><User size={18} /> Your notes</p>
              <div className="flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</Button>
                {!readOnly && <Button size="sm" loading={save.isPending} disabled={draft === null} onClick={() => save.mutate()}><FloppyDisk size={16} /> Save</Button>}</div></div>
            {preview || readOnly ? <div className="mt-3 min-h-60 rounded-2xl bg-canvas p-4"><Markdown>{value || "_Empty_"}</Markdown></div>
              : <Textarea className="mt-3 min-h-80 font-mono text-[13px]" value={value} onChange={(e) => setDraft(e.target.value)} aria-label="Markdown notes" />}
            {draft !== null && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><WarningCircle size={14} /> Unsaved changes</p>}
          </Card>
          <div className="space-y-3">
            <p className="font-display font-bold">Agent notes</p>
            {list.filter((n) => n !== mine).length === 0 && <p className="text-sm text-muted">No agent notes yet.</p>}
            {list.filter((n) => n !== mine).map((n) => (
              <Card key={n.id} variant="bento" className="p-4"><p className="flex items-center gap-1.5 text-xs font-bold text-muted"><Robot size={14} /> {typeof n.author === "object" ? n.author.name : n.author} · {formatDateTime(n.updated_at)}</p><Markdown className="mt-1 text-sm">{n.markdown}</Markdown></Card>
            ))}
          </div>
        </div>
      )}
    </QueryView>
  );
}
