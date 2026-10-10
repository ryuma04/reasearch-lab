"use client";

import * as React from "react";
import { CheckCircle, CircleNotch, WarningCircle, XCircle } from "@phosphor-icons/react";
import type { HealSession, HealStatus, RepairAttempt } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Badge, type Tone } from "@/components/ui/primitives";
import { ErrorState, Skeleton } from "@/components/ui/states";

const SESSION_META: Record<HealStatus, { label: string; tone: Tone }> = {
  queued: { label: "Starting", tone: "faint" },
  running: { label: "Fixing", tone: "sky" },
  fixed: { label: "Fixed", tone: "mint" },
  failed: { label: "Not fixed", tone: "coral" },
  error: { label: "Could not run", tone: "pink" },
};

const RESULT: Record<RepairAttempt["status"], string> = {
  running: "Running the fixed code",
  fixed: "Ran without errors",
  still_failing: "Still failing",
  tests_failed: "Tests failed",
  no_fix: "No safe fix found",
  sandbox_error: "The sandbox could not run it",
};

const SOURCE: Record<string, string> = {
  arina: "Arina AI", memory: "Lab Memory", pattern: "Known fix", cache: "Saved answer", fallback_ai: "Backup AI",
};

export const healActive = (s?: HealSession[]) => !!s?.some((x) => x.status === "queued" || x.status === "running");

/** A unified diff with added and removed lines coloured. */
export function DiffView({ diff }: { diff: string }) {
  if (!diff) return null;
  return (
    <pre data-testid="diff" className="overflow-x-auto rounded-xl bg-[#1e1e1e] p-3 font-mono text-[12px] leading-relaxed text-[#d4d4d4]">
      {diff.split("\n").map((line, i) => (
        <div key={i} className={cn(
          line.startsWith("+") && !line.startsWith("+++") && "bg-[#1f3d2a] text-[#b5f5c8]",
          line.startsWith("-") && !line.startsWith("---") && "bg-[#4a1f24] text-[#ffc1c7]",
          line.startsWith("@@") && "text-[#9cdcfe]",
        )}>{line || " "}</div>
      ))}
    </pre>
  );
}

function Tests({ t }: { t: RepairAttempt["tests"] }) {
  if (t.error) return <span>Tests could not run: {t.error}</span>;
  if (!t.total) return <span>{t.note ? "No tests to run" : ""}</span>;
  return <span>Tests: {t.passed ?? 0} passed, {t.failed ?? 0} failed</span>;
}

function Attempt({ a }: { a: RepairAttempt }) {
  const ok = a.status === "fixed";
  const live = a.status === "running";
  return (
    <li className="space-y-2 rounded-2xl border border-line-cool p-3" data-testid="repair-attempt">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>Attempt {a.attempt}</b>
        {a.fix_source && <Badge tone="lavender">{SOURCE[a.fix_source] ?? a.fix_source}</Badge>}
        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", ok ? "text-success" : live ? "text-sky-deep" : "text-danger")}>
          {ok ? <CheckCircle size={14} weight="fill" /> : live ? <CircleNotch size={14} className="animate-spin" /> : <XCircle size={14} weight="fill" />}
          {RESULT[a.status]}
        </span>
        <span className="text-xs text-muted"><Tests t={a.tests} /></span>
      </div>
      <div>
        <p className="text-xs font-bold text-muted">Error</p>
        <p className="font-mono text-xs text-danger">{a.error_summary}</p>
        {a.error_text && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-muted">Show full error</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-2 font-mono text-[11px]">{a.error_text}</pre>
          </details>
        )}
      </div>
      {a.explanation && (
        <div>
          <p className="text-xs font-bold text-muted">What was wrong</p>
          <p className="whitespace-pre-line text-sm">{a.explanation}</p>
        </div>
      )}
      {a.diff && (
        <div>
          <p className="text-xs font-bold text-muted">Change</p>
          <DiffView diff={a.diff} />
        </div>
      )}
    </li>
  );
}

export function HealPanel({ sessions, loading, error }: { sessions: HealSession[]; loading: boolean; error: unknown }) {
  if (loading) return <div className="p-4"><Skeleton className="h-24" /></div>;
  if (error) return <div className="p-4"><ErrorState error={error} title="Fixes" /></div>;
  if (!sessions.length) {
    return <p className="p-6 text-sm text-muted">When a run fails, press <b>Fix with AI</b>. The debugger tries up to 3 fixes and checks each one by running the code again.</p>;
  }
  return (
    <div className="space-y-5 p-4 sm:p-5" data-testid="heal-panel">
      {sessions.map((s) => {
        const m = SESSION_META[s.status];
        const live = s.status === "queued" || s.status === "running";
        return (
          <section key={s.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={m.tone} solid={!live}>
                {live ? <CircleNotch size={12} className="animate-spin" /> : s.status === "fixed" ? <CheckCircle size={12} weight="bold" /> : <WarningCircle size={12} weight="bold" />}
                {m.label}
              </Badge>
              <span className="text-xs text-muted">{s.attempts.length} of {s.max_attempts} attempts</span>
            </div>
            {s.message && <p className={cn("text-sm", s.status === "fixed" ? "text-ink" : "text-danger")} data-testid="heal-message">{s.message}</p>}
            <ol className="space-y-3">{s.attempts.map((a) => <Attempt key={a.id} a={a} />)}</ol>
          </section>
        );
      })}
    </div>
  );
}
