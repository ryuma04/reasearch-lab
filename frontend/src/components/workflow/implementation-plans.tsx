"use client";

import * as React from "react";
import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

interface PlanTask { id: string; title?: string; description?: string; depends_on?: string[]; kind?: string; completion?: string; validation?: string; failure?: string; modules?: string[] }
interface Plan { objective?: string; tasks: PlanTask[]; risks?: string[]; assumptions?: string[]; external_dependencies?: string[]; acceptance?: string[] }
interface Validation { ok: boolean; errors: string[]; warnings: string[] }
interface Diff { added: string[]; removed: string[]; changed: string[]; reordered: string[]; tests_added: string[]; risks_added: string[]; decisions_added: string[] }
export interface PlanReview {
  ready: "initial" | "optimized" | null;
  initial?: { plan: Plan; source?: string; validation: Validation };
  optimized?: { plan: Plan | null; validation?: Validation | null; weaknesses?: { issue: string; fix: string }[]; diff?: Diff | null; failure?: string } | null;
}

/** Reads the review the planning agents saved with the plan checkpoint; returns null for runs created before it existed. */
export function planReviewOf(payload: Record<string, unknown> | undefined): PlanReview | null {
  const r = payload?.implementation_plans;
  return r && typeof r === "object" && "ready" in (r as object) ? (r as PlanReview) : null;
}

function Validity({ v }: { v?: Validation | null }) {
  if (!v) return null;
  return v.ok
    ? <Badge tone="mint" solid><CheckCircle size={12} weight="fill" /> Passed validation</Badge>
    : <Badge tone="coral" solid><XCircle size={12} weight="fill" /> Failed validation</Badge>;
}

function Tasks({ plan }: { plan: Plan }) {
  return (
    <ol className="space-y-2" aria-label="Plan tasks">
      {plan.tasks.map((t) => (
        <li key={t.id} className="rounded-2xl border border-line-cool p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold"><span className="font-mono text-xs">{t.id}</span> {t.title}
            {t.kind && <Badge tone="faint">{t.kind}</Badge>}
            {!!t.depends_on?.length && <span className="text-xs font-normal text-muted">after {t.depends_on.join(", ")}</span>}</p>
          {t.description && t.description !== t.title && <p className="mt-1 text-ink-soft">{t.description}</p>}
          <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-muted sm:grid-cols-[auto_1fr]">
            {t.completion && <><dt className="font-semibold">Done when</dt><dd>{t.completion}</dd></>}
            {t.validation && <><dt className="font-semibold">Verified by</dt><dd>{t.validation}</dd></>}
            {t.failure && <><dt className="font-semibold">Fails when</dt><dd>{t.failure}</dd></>}
          </dl>
        </li>
      ))}
    </ol>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><p className="text-xs font-bold uppercase tracking-wider text-muted">{title} ({items.length})</p><ul className="mt-0.5 list-disc pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul></div>;
}

/** The original proposal and the optimized plan side by side, clearly labelled, with what the optimizer changed. */
export function ImplementationPlans({ review }: { review: PlanReview }) {
  const opt = review.optimized?.plan ? review.optimized : null;
  const [tab, setTab] = React.useState<"initial" | "optimized">(opt ? "optimized" : "initial");
  const shown = tab === "optimized" && opt ? opt.plan! : review.initial?.plan;
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Implementation plans" className="flex flex-wrap gap-2">
        {([["initial", "Initial plan (original proposal)"], ["optimized", "Optimized plan"]] as const).map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} disabled={k === "optimized" && !opt} onClick={() => setTab(k)}
            className={cn("rounded-full px-4 py-2 text-sm font-semibold", tab === k ? "bg-pill text-white" : "bg-white text-ink-soft shadow-clay-sm", k === "optimized" && !opt && "opacity-50")}>
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {tab === "initial" ? <Validity v={review.initial?.validation} /> : <Validity v={review.optimized?.validation} />}
        </span>
      </div>

      {!opt && review.optimized?.failure && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-warning-soft p-3 text-sm"><WarningCircle size={18} className="mt-0.5 shrink-0 text-warning" /> Optimization did not produce a plan: {review.optimized.failure}.</p>
      )}
      {review.ready === null && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm font-semibold text-danger">No plan passed validation, so coding cannot start. Problems: {(review.initial?.validation.errors ?? []).join("; ")}</p>
      )}
      {tab === "initial" && review.initial && !review.initial.validation.ok && <ul className="list-disc pl-5 text-sm text-danger">{review.initial.validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      {tab === "optimized" && opt && (
        <div className="space-y-3 rounded-2xl bg-lavender-soft p-3">
          <p className="text-sm font-semibold">What the optimizer changed</p>
          {!!opt.weaknesses?.length && <ul className="list-disc pl-5 text-sm">{opt.weaknesses.map((w, i) => <li key={i}><b>{w.issue}</b>: {w.fix}</li>)}</ul>}
          {opt.diff && <div className="grid gap-3 sm:grid-cols-2">
            <DiffList title="Tasks added" items={opt.diff.added} /><DiffList title="Tasks changed" items={opt.diff.changed} />
            <DiffList title="Tasks removed" items={opt.diff.removed} /><DiffList title="Tests added" items={opt.diff.tests_added} />
            <DiffList title="New risks" items={opt.diff.risks_added} /><DiffList title="Design decisions added" items={opt.diff.decisions_added} />
          </div>}
        </div>
      )}
      {shown && <><p className="text-sm text-ink-soft">{shown.objective}</p><Tasks plan={shown} /></>}
      {shown && !!shown.risks?.length && <DiffList title="Risks" items={shown.risks} />}
      {shown && !!shown.assumptions?.length && <DiffList title="Assumptions" items={shown.assumptions} />}
      {shown && !!shown.external_dependencies?.length && <DiffList title="External dependencies" items={shown.external_dependencies} />}
    </div>
  );
}
