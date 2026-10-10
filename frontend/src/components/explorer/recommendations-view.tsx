"use client";

import * as React from "react";
import { Trash } from "@phosphor-icons/react";
import type { useExplorerActions } from "@/lib/explorer/api";
import type { XData, XFeedback, XPaper, XRecommendation } from "@/lib/explorer/types";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { SourceLink } from "@/components/workflow/source-link";
import { FeedbackBar } from "./feedback";
import { HandoffButton } from "./handoff";

const GROUPS: { key: XRecommendation["category"]; title: string; hint: string }[] = [
  { key: "essential", title: "Essential improvements", hint: "Backed by evidence from more than one source of limitation." },
  { key: "high_value", title: "High-value opportunities", hint: "Backed by at least one verified limitation." },
  { key: "experimental", title: "Experimental ideas", hint: "AI hypotheses without verified evidence: worth testing, not worth trusting yet." },
];
const CX = { low: "mint", medium: "sun", high: "pink" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p><div className="mt-0.5 text-sm text-ink-soft">{children}</div></div>;
}

function RecCard({ r, mine, canEdit, actions, byId, arxivId }: { r: XRecommendation; mine?: XFeedback; canEdit: boolean; actions: ReturnType<typeof useExplorerActions>; byId: Map<string, XPaper>; arxivId?: string | null }) {
  const improvement = mine?.decision === "edited" && mine.edited.improvement ? mine.edited.improvement : r.improvement;
  const handoff = mine && (mine.decision === "accepted" || mine.decision === "edited");
  return (
    <Card variant="bento" className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="faint">Priority {r.priority}</Badge>
        <Badge tone={CX[r.complexity]}>Complexity: {r.complexity}</Badge>
        <Badge tone={r.evidence_backed ? "mint" : "lavender"}>{r.evidence_backed ? "Linked to evidence-backed gap" : "Experimental"}</Badge>
      </div>
      <h3 className="font-display text-lg font-semibold leading-snug">{r.title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Current limitation">{r.limitation}</Field>
        <Field label="Proposed improvement">{improvement}{mine?.decision === "edited" && <Badge tone="sun" className="ml-1.5">your version</Badge>}</Field>
        {r.benefit && <Field label="Expected benefit">{r.benefit}</Field>}
        {r.resources && <Field label="Resource requirements">{r.resources}</Field>}
        {r.dependencies.length > 0 && <Field label="Dependencies"><ul className="list-disc pl-4">{r.dependencies.map((d) => <li key={d}>{d}</li>)}</ul></Field>}
        {r.evaluation && <Field label="Suggested evaluation">{r.evaluation}</Field>}
      </div>
      <Field label={`Supporting research (${r.references.length})`}>
        {r.references.length ? (
          <ul className="space-y-0.5">{r.references.map((id) => { const p = byId.get(id); return p ? <li key={id}>{p.title}{p.year ? ` (${p.year})` : ""} <SourceLink url={p.url} kind="paper" className="ml-1" /></li> : null; })}</ul>
        ) : <span className="text-muted">No supporting papers: this is a hypothesis.</span>}
      </Field>
      <FeedbackBar mine={mine} canEdit={canEdit} busy={actions.feedback.isPending || actions.clear.isPending} editableText={r.improvement} editKey="improvement"
        onSave={(b) => actions.feedback.mutate({ item_type: "recommendation", item_id: r.id, ...b })} onClear={(id) => actions.clear.mutate(id)} />
      {handoff && canEdit && (
        <div className="flex flex-wrap items-center gap-2"><HandoffButton title={r.title} text={improvement} arxivId={arxivId} /><span className="text-xs text-muted">Creates a new workspace for the existing research workflow; nothing runs until you start it.</span></div>
      )}
    </Card>
  );
}

function Ideas({ feedback, canEdit, actions, arxivId }: { feedback: XFeedback[]; canEdit: boolean; actions: ReturnType<typeof useExplorerActions>; arxivId?: string | null }) {
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const ideas = feedback.filter((f) => f.item_type === "idea");
  return (
    <section className="space-y-3" aria-label="Your own ideas">
      <h2 className="font-display text-lg font-semibold">Your own research ideas ({ideas.length})</h2>
      {canEdit && (
        <Card variant="bento" className="space-y-2 p-4">
          <Input aria-label="Idea title" placeholder="Short title (optional)" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
          <Textarea aria-label="Describe your idea" placeholder="Describe the idea you want to explore…" value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} className="min-h-24 text-sm" />
          <Button size="sm" variant="purple" disabled={!text.trim()} loading={actions.idea.isPending} onClick={() => actions.idea.mutate({ title: title.trim(), text: text.trim() }, { onSuccess: () => { setTitle(""); setText(""); } })}>Add my idea</Button>
        </Card>
      )}
      {ideas.map((i) => (
        <Card key={i.id} variant="bento" className="space-y-2 p-4">
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-semibold">{i.edited.title || "Untitled idea"}</p><p className="whitespace-pre-wrap text-sm text-ink-soft">{i.edited.text}</p>
            <p className="mt-1 text-[11px] text-muted">{i.mine ? "Added by you" : "Added by a teammate"} · the Explorer has not checked this idea against the literature</p></div>
            {i.mine && canEdit && <Button size="icon-sm" variant="ghost" aria-label="Remove this idea" disabled={actions.clear.isPending} onClick={() => actions.clear.mutate(i.id)}><Trash size={15} /></Button>}</div>
          {canEdit && <HandoffButton title={i.edited.title || "My idea"} text={i.edited.text ?? ""} arxivId={arxivId} />}
        </Card>
      ))}
      {!ideas.length && <p className="text-sm text-muted">Ideas you add here are saved with this analysis. You can hand any of them to the research workflow.</p>}
    </section>
  );
}

export function RecommendationsView({ data, feedback, canEdit, actions }: { data: XData; feedback: XFeedback[]; canEdit: boolean; actions: ReturnType<typeof useExplorerActions> }) {
  const byId = React.useMemo(() => new Map(data.papers.map((p) => [p.id, p])), [data.papers]);
  const seed = data.papers.find((p) => p.is_seed);
  const mine = (id: string) => feedback.find((f) => f.mine && f.item_type === "recommendation" && f.item_id === id);
  return (
    <div className="space-y-8">
      {!data.recommendations.length ? (
        <EmptyState title="No improvement recommendations" body="Recommendations are built from verified research gaps. None could be produced from the papers found; you can still add your own ideas below." />
      ) : GROUPS.map((g) => {
        const list = data.recommendations.filter((r) => r.category === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="space-y-3" aria-label={g.title}>
            <div><h2 className="font-display text-lg font-semibold">{g.title} ({list.length})</h2><p className="text-xs text-muted">{g.hint}</p></div>
            {list.map((r) => <RecCard key={r.id} r={r} mine={mine(r.id)} canEdit={canEdit} actions={actions} byId={byId} arxivId={seed?.arxiv_id} />)}
          </section>
        );
      })}
      <Ideas feedback={feedback} canEdit={canEdit} actions={actions} arxivId={seed?.arxiv_id} />
    </div>
  );
}
