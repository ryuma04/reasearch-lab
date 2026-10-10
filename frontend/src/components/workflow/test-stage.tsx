"use client";

import * as React from "react";
import { CheckCircle, MinusCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import type { RunEvent, TestCase } from "@/lib/api/types";
import { useGaps, useScorecard, useTests } from "@/lib/hooks/queries";
import { buildExecutions } from "@/lib/workflow/activity";
import { formatDuration } from "@/lib/utils";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, ErrorState, QueryView, Skeleton } from "@/components/ui/states";
import { ScorecardTable } from "@/components/results/tabs";
import { AgentGrid } from "./shared";
import { TerminalPanel } from "./coding-stage";
import type { AgentInfo } from "./types";

const STATUS = {
  passed: { label: "Passed", tone: "mint", Icon: CheckCircle, color: "text-success" },
  failed: { label: "Failed", tone: "pink", Icon: XCircle, color: "text-danger" },
  error: { label: "Error", tone: "pink", Icon: WarningCircle, color: "text-danger" },
  skipped: { label: "Skipped", tone: "faint", Icon: MinusCircle, color: "text-muted" },
} as const;

export function summarize(tests: TestCase[]) {
  const c = { total: tests.length, passed: 0, failed: 0, error: 0, skipped: 0, ms: 0 };
  for (const t of tests) {
    c[t.status] += 1;
    c.ms += t.duration_ms ?? 0;
  }
  return c;
}

const GROUPS: { kind: TestCase["kind"]; title: string; hint: string }[] = [
  { kind: "correctness", title: "Correctness tests", hint: "Does the code do what the paper's method says?" },
  { kind: "claim", title: "Claim tests", hint: "Is each measured result within tolerance of the paper's number? A failure here means a result differs, not that the code is broken." },
];

function Group({ title, hint, tests }: { title: string; hint: string; tests: TestCase[] }) {
  const s = summarize(tests);
  if (!tests.length) return null;
  return (
    <Card variant="bento" className="overflow-hidden">
      <div className="border-b border-line-cool p-4">
        <div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-bold">{title}</p>
          <Badge tone="mint">{s.passed} passed</Badge><Badge tone={s.failed + s.error ? "pink" : "faint"}>{s.failed + s.error} failed</Badge><Badge tone="faint">{s.skipped} skipped</Badge>
          <span className="ml-auto text-xs text-muted">{formatDuration(s.ms / 1000)} total</span></div>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      <ul className="divide-y divide-line-cool">
        {tests.map((t) => {
          const m = STATUS[t.status];
          return (
            <li key={t.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2"><m.Icon size={16} weight="fill" className={m.color} /><span className="min-w-0 flex-1 truncate font-mono text-xs">{t.name}</span>
                {t.file && <span className="hidden text-[11px] text-muted sm:inline">{t.file}</span>}
                <Badge tone={m.tone}>{m.label}</Badge>{t.duration_ms != null && <span className="text-[11px] text-muted">{t.duration_ms} ms</span>}</div>
              {t.message && t.status !== "passed" && <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink/90 p-2 font-mono text-[11px] text-white/90">{t.message}</pre>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function TestStage({ runId, events, agents, ended }: { runId: string; events: RunEvent[]; agents: AgentInfo[]; ended: boolean }) {
  const tests = useTests(runId);
  const scorecard = useScorecard(runId);
  const gaps = useGaps(runId);
  const testers = React.useMemo(() => agents.filter((a) => a.group === "testing" || a.group === "gap_detective"), [agents]);
  const execs = React.useMemo(() => buildExecutions(events), [events]);
  const checks = execs.filter((e) => !e.running);

  return (
    <div className="space-y-6">
      <section className="space-y-3"><SectionTitle kicker="Agents" title="Who is testing" />
        {testers.length ? <AgentGrid events={events} agents={testers} ended={ended} /> : <Skeleton className="h-32" />}</section>

      <section className="space-y-3" aria-label="Build and run checks">
        <SectionTitle kicker="Executed in the sandbox" title="Build and run checks" />
        {checks.length ? (
          <div className="flex flex-wrap gap-2">
            {checks.map((e) => (
              <Badge key={e.execId} tone={e.exitCode === 0 ? "mint" : "pink"} className="px-3 py-1.5 text-xs">
                {e.exitCode === 0 ? <CheckCircle size={13} weight="fill" /> : <XCircle size={13} weight="fill" />} {e.phase || "run"} · exit {e.exitCode ?? "?"} · {formatDuration(e.durationSec)}
              </Badge>
            ))}
          </div>
        ) : <p className="text-sm text-muted">Nothing has finished running yet.</p>}
      </section>

      <section className="space-y-3" aria-label="Test results">
        <SectionTitle kicker="pytest" title="Test results" />
        {tests.isPending ? <Skeleton className="h-40" /> : tests.error ? <ErrorState error={tests.error} title="Test results" onRetry={() => void tests.refetch()} /> : !tests.data || !tests.data.tests.length ? (
          <EmptyState title="Tests have not run yet" body="The Test Designer writes tests from the Claims List, then the Test Runner runs them in the sandbox. Counts appear here only from that real report." />
        ) : (
          <>
            {(() => { const s = summarize(tests.data.tests); return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Test totals">
                {([["Passed", s.passed, "text-success"], ["Failed", s.failed + s.error, s.failed + s.error ? "text-danger" : "text-muted"], ["Skipped", s.skipped, "text-muted"], ["Total", s.total, "text-ink"]] as const).map(([l, v, c]) => (
                  <Card key={l} variant="bento" className="p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted">{l}</p><p className={`tabular font-display text-3xl font-bold ${c}`}>{v}</p></Card>
                ))}
              </div>); })()}
            {GROUPS.map((g) => <Group key={g.kind} title={g.title} hint={g.hint} tests={tests.data!.tests.filter((t) => t.kind === g.kind)} />)}
          </>
        )}
      </section>

      <section className="space-y-3" aria-label="Claim scorecard">
        <SectionTitle kicker="Proof" title="Claim Scorecard" />
        <QueryView query={scorecard} feature="Claim Scorecard" isEmpty={(x) => !x.length} empty={<EmptyState title="No claims scored yet" body="Each claim is scored from numbers the sandbox run wrote to metrics.json. Until then it stays unverified." />}>
          {(entries) => <ScorecardTable entries={entries} />}
        </QueryView>
      </section>

      {gaps.data?.explanation && (
        <Card variant="bento" className="space-y-2 p-5"><p className="font-display text-lg font-bold">Why a result differs (Gap Detective)</p>
          <p className="text-sm text-ink-soft">{gaps.data.explanation}</p>
          <p className="text-xs text-muted">Every number in this explanation is checked against recorded runs; sentences with unproven numbers are removed.</p></Card>
      )}

      <TerminalPanel runId={runId} events={events} defaultOpen={false} />
    </div>
  );
}
