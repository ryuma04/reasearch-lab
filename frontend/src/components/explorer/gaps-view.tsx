"use client";

import * as React from "react";
import { Lightbulb, Quotes, SealCheck } from "@phosphor-icons/react";
import type { useExplorerActions } from "@/lib/explorer/api";
import type { XData, XFeedback, XGap } from "@/lib/explorer/types";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { SourceLink } from "@/components/workflow/source-link";
import { FeedbackBar } from "./feedback";

const CONF_TONE = { high: "mint", medium: "sun", low: "faint" } as const;
const IMPACT_TONE = { high: "pink", medium: "sun", low: "faint" } as const;
const CATEGORY: Record<string, string> = {
  shared_limitation: "Shared limitation", missing_functionality: "Missing functionality", open_question: "Open question",
  efficiency: "Efficiency", evaluation: "Evaluation weakness", combination: "Combine approaches",
};

function GapCard({ g, mine, canEdit, actions }: { g: XGap; mine?: XFeedback; canEdit: boolean; actions: ReturnType<typeof useExplorerActions> }) {
  const backed = g.kind === "evidence_backed";
  return (
    <Card variant="bento" className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={backed ? "mint" : "lavender"} solid>{backed ? <><SealCheck size={12} weight="fill" /> Evidence-backed</> : <><Lightbulb size={12} weight="fill" /> AI hypothesis</>}</Badge>
        <Badge tone="faint">{CATEGORY[g.category] ?? g.category}</Badge>
        <Badge tone={CONF_TONE[g.confidence]} title={g.confidence_basis}>Confidence: {g.confidence}</Badge>
        <Badge tone={IMPACT_TONE[g.impact]} title="An AI estimate, not a measurement">Potential impact: {g.impact}</Badge>
      </div>
      <h3 className="font-display text-lg font-semibold leading-snug">{g.title}</h3>
      <p className="text-sm text-ink-soft">{g.explanation}</p>
      <p className="text-xs text-muted"><b>Confidence basis:</b> {g.confidence_basis}.{g.impact_reason ? ` Impact: ${g.impact_reason}` : ""}</p>
      {g.why_investigate && <p className="rounded-lg bg-canvas p-2.5 text-sm"><b>Why it may be worth investigating:</b> {g.why_investigate}</p>}

      {g.evidence.length > 0 ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Supporting papers ({g.supporting_papers.length})</p>
          <ul className="mt-1 space-y-2">
            {g.evidence.map((e, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium">{e.title}{e.year ? ` (${e.year})` : ""} <SourceLink url={e.url} kind="paper" className="ml-1" /></p>
                <blockquote className="mt-0.5 flex gap-1.5 border-l-2 border-lavender pl-2 text-xs text-ink-soft"><Quotes size={11} className="mt-0.5 shrink-0" />{e.quote}</blockquote>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="text-xs text-muted">No verified quote supports this idea, so it is shown as a hypothesis for you to judge, not as a finding.</p>}
      <p className="text-[11px] text-muted">{g.novelty}</p>

      <FeedbackBar mine={mine} canEdit={canEdit} busy={actions.feedback.isPending || actions.clear.isPending}
        onSave={(b) => actions.feedback.mutate({ item_type: "gap", item_id: g.id, ...b })} onClear={(id) => actions.clear.mutate(id)} />
    </Card>
  );
}

export function GapsView({ data, feedback, canEdit, actions }: { data: XData; feedback: XFeedback[]; canEdit: boolean; actions: ReturnType<typeof useExplorerActions> }) {
  if (!data.gaps.length) {
    return <EmptyState title="No research gaps were identified" body={data.comparison.ai ? "The papers found did not give enough verifiable evidence to propose gaps. That is shown as empty rather than invented." : "Identifying gaps needs an AI provider (Groq or Gemini key). Add one and refresh the analysis."} />;
  }
  const mine = (id: string) => feedback.find((f) => f.mine && f.item_type === "gap" && f.item_id === id);
  const backed = data.gaps.filter((g) => g.kind === "evidence_backed");
  const hyp = data.gaps.filter((g) => g.kind === "hypothesis");
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-white p-3 text-sm text-ink-soft shadow-sm">
        Gaps are proposals drawn from the {data.limits.papers_found} papers found. <b>Evidence-backed</b> gaps cite exact sentences from those papers; <b>AI hypotheses</b> do not and need your judgement. None of them is claimed to be novel.
      </p>
      {[{ title: `Evidence-backed gaps (${backed.length})`, list: backed }, { title: `AI-generated hypotheses (${hyp.length})`, list: hyp }].filter((s) => s.list.length).map((s) => (
        <section key={s.title} className="space-y-3" aria-label={s.title}>
          <h2 className="font-display text-lg font-semibold">{s.title}</h2>
          {s.list.map((g) => <GapCard key={g.id} g={g} mine={mine(g.id)} canEdit={canEdit} actions={actions} />)}
        </section>
      ))}
    </div>
  );
}
