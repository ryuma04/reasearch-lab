"use client";

import * as React from "react";
import { CaretDown, Info, Lightbulb, Quotes, SealCheck } from "@phosphor-icons/react";
import type { useExplorerActions } from "@/lib/explorer/api";
import type { XData, XFeedback, XGap } from "@/lib/explorer/types";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { SourceLink } from "@/components/workflow/source-link";
import { FeedbackBar } from "./feedback";

const CONF_TONE = { high: "mint", medium: "sun", low: "faint" } as const;
const IMPACT_TONE = { high: "pink", medium: "sun", low: "faint" } as const;
const RANK = { high: 0, medium: 1, low: 2 } as const;
const CATEGORY: Record<string, string> = {
  shared_limitation: "Shared limitation", missing_functionality: "Missing functionality", open_question: "Open question",
  efficiency: "Efficiency", evaluation: "Evaluation weakness", combination: "Combine approaches",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Filter = "all" | "evidence" | "ai" | "high";

/** Evidence first, then higher impact, then higher confidence. */
export function sortGaps(gaps: XGap[]): XGap[] {
  return [...gaps].sort((a, b) =>
    (a.kind === "evidence_backed" ? 0 : 1) - (b.kind === "evidence_backed" ? 0 : 1)
    || RANK[a.impact] - RANK[b.impact] || RANK[a.confidence] - RANK[b.confidence]);
}

export function filterGaps(gaps: XGap[], f: Filter): XGap[] {
  if (f === "evidence") return gaps.filter((g) => g.kind === "evidence_backed");
  if (f === "ai") return gaps.filter((g) => g.kind === "hypothesis");
  if (f === "high") return gaps.filter((g) => g.impact === "high");
  return gaps;
}

function GapCard({ g, mine, canEdit, actions }: { g: XGap; mine?: XFeedback; canEdit: boolean; actions: ReturnType<typeof useExplorerActions> }) {
  const backed = g.kind === "evidence_backed";
  const [open, setOpen] = React.useState(false);
  const detailsId = `gap-${g.id}-details`;
  return (
    <Card variant="bento" className="space-y-2.5 p-5" data-testid="gap-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={backed ? "mint" : "lavender"} solid>{backed ? <><SealCheck size={12} weight="fill" /> Backed by evidence</> : <><Lightbulb size={12} weight="fill" /> AI idea</>}</Badge>
        <Badge tone={IMPACT_TONE[g.impact]} title={g.impact_reason || "An AI estimate, not a measurement"}>{cap(g.impact)} impact</Badge>
      </div>
      <h3 className="font-display text-lg font-semibold leading-snug">{g.title}</h3>
      <p className={cn("text-sm text-ink-soft", !open && "line-clamp-2")}>{g.explanation}</p>

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={detailsId}
        className="inline-flex items-center gap-1 text-sm font-semibold text-purple-deep">
        <CaretDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        {open ? "Less" : backed ? `More (${g.supporting_papers.length} source${g.supporting_papers.length === 1 ? "" : "s"})` : "More"}
      </button>

      {open && (
        <div id={detailsId} className="space-y-3 rounded-xl bg-canvas p-3 text-sm">
          <p className="flex flex-wrap gap-1.5"><Badge tone={CONF_TONE[g.confidence]} title={g.confidence_basis}>{cap(g.confidence)} confidence</Badge><Badge tone="faint">{CATEGORY[g.category] ?? g.category}</Badge></p>
          {g.why_investigate && <p><b>Why it matters:</b> {g.why_investigate}</p>}
          {g.impact_reason && <p><b>Impact:</b> {g.impact_reason}</p>}
          {g.evidence.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted">Sources</p>
              <ul className="mt-1 space-y-2">
                {g.evidence.map((e, i) => (
                  <li key={i}>
                    <p className="font-medium">{e.title}{e.year ? ` (${e.year})` : ""} <SourceLink url={e.url} kind="paper" className="ml-1" /></p>
                    <blockquote className="mt-0.5 flex gap-1.5 border-l-2 border-lavender pl-2 text-xs text-ink-soft"><Quotes size={11} className="mt-0.5 shrink-0" />{e.quote}</blockquote>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {g.novelty && <p className="text-xs text-muted">{g.novelty}</p>}
        </div>
      )}

      <FeedbackBar mine={mine} canEdit={canEdit} busy={actions.feedback.isPending || actions.clear.isPending}
        onSave={(b) => actions.feedback.mutate({ item_type: "gap", item_id: g.id, ...b })} onClear={(id) => actions.clear.mutate(id)} />
    </Card>
  );
}

export function GapsView({ data, feedback, canEdit, actions }: { data: XData; feedback: XFeedback[]; canEdit: boolean; actions: ReturnType<typeof useExplorerActions> }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const sorted = React.useMemo(() => sortGaps(data.gaps), [data.gaps]);
  if (!data.gaps.length) {
    return <EmptyState title="No research gaps were identified" body={data.comparison.ai ? "The papers found did not give enough verifiable evidence to propose gaps. That is shown as empty rather than invented." : "Identifying gaps needs an AI provider (Groq or Gemini key). Add one and refresh the analysis."} />;
  }
  const mine = (id: string) => feedback.find((f) => f.mine && f.item_type === "gap" && f.item_id === id);
  const shown = filterGaps(sorted, filter);
  const count = (f: Filter) => filterGaps(data.gaps, f).length;
  const FILTERS: [Filter, string][] = [["all", "All"], ["evidence", "Backed by evidence"], ["ai", "AI ideas"], ["high", "High impact"]];

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-white p-3 text-sm text-ink-soft shadow-sm" data-testid="gaps-note">
        <Info size={18} className="mt-0.5 shrink-0 text-purple-deep" />
        <span>
          <b>Backed by evidence</b>: quoted from the papers. <b>AI idea</b>: no quote, judge it yourself.
        </span>
      </p>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter gaps">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold",
              filter === k ? "bg-pill text-white" : "bg-white text-ink-soft shadow-clay-sm hover:text-ink")}>
            {label} <span className={cn("text-xs", filter === k ? "opacity-80" : "text-muted")}>{count(k)}</span>
          </button>
        ))}
      </div>

      {shown.length ? (
        <div className="space-y-3">
          {shown.map((g) => <GapCard key={g.id} g={g} mine={mine(g.id)} canEdit={canEdit} actions={actions} />)}
        </div>
      ) : (
        <p className="rounded-xl bg-white p-4 text-sm text-muted">Nothing matches this filter.</p>
      )}
    </div>
  );
}
