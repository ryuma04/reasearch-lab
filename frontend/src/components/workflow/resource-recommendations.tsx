"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowSquareOut, CheckCircle, Hourglass, SealCheck, WarningCircle } from "@phosphor-icons/react";
import { resourceApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { qk, useResources } from "@/lib/hooks/queries";
import type { ResourceDecisionKind, ResourceRec } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/states";
import { toast } from "@/components/ui/overlays";

const CATEGORY: Record<string, { label: string; tone: "mint" | "sky" | "sun" | "faint" | "coral" }> = {
  better_alternative: { label: "Recommended as a better alternative", tone: "mint" },
  relevant_alternative: { label: "Relevant alternative", tone: "sky" },
  possible_needs_validation: { label: "Possible alternative, needs validation", tone: "sun" },
  not_better: { label: "Not better than your original", tone: "faint" },
  insufficient_evidence: { label: "Insufficient evidence", tone: "faint" },
  inaccessible: { label: "Inaccessible or unsupported", tone: "coral" },
};
const ACTION: Record<string, string> = { replace: "Could replace your original", supplement: "Could supplement your original", keep_original: "Keep your original" };
const DECISION_LABEL: Record<ResourceDecisionKind, string> = { accept: "Accepted", reject: "Rejected", keep_original: "Keeping your original", supplement: "Using as a supplement" };

function Rec({ r, runId, canAct }: { r: ResourceRec; runId: string; canAct: boolean }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.resources(runId) });
  const decide = useMutation({
    mutationFn: (d: ResourceDecisionKind) => resourceApi.decide(runId, r.id, d),
    onSuccess: refresh,
    onError: (e) => toast.error("Couldn't save your decision", userMessage(e)),
  });
  const clear = useMutation({ mutationFn: () => resourceApi.clear(runId, r.id), onSuccess: refresh, onError: (e) => toast.error("Couldn't undo", userMessage(e)) });
  const cat = CATEGORY[r.category] ?? CATEGORY.insufficient_evidence!;
  const busy = decide.isPending || clear.isPending;
  return (
    <li className="space-y-2 rounded-2xl border border-line-cool p-4" data-rec={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={cat.tone} solid={r.category === "better_alternative"}>{r.category === "better_alternative" && <SealCheck size={12} weight="fill" />} {cat.label}</Badge>
        <Badge tone="faint">{r.kind}</Badge><Badge tone="faint">{r.source}</Badge>
        {r.score != null && <span className="text-xs text-muted" title="Computed from fetched metadata only">Suitability {r.score}/100 · confidence {r.confidence}</span>}
        {r.decision && <Badge tone="lavender" solid>{DECISION_LABEL[r.decision.decision]}</Badge>}
      </div>
      <p className="font-semibold">
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-purple-deep underline">{r.name} <ArrowSquareOut size={14} /></a>
      </p>
      <p className="text-sm text-ink-soft">{r.summary} <span className="font-semibold">{ACTION[r.action]}.</span></p>
      {r.advantages.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Advantages over your original</p><ul className="list-disc pl-5 text-sm">{r.advantages.map((a) => <li key={a}>{a}</li>)}</ul></div>}
      {r.limitations.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Limitations and trade-offs</p><ul className="list-disc pl-5 text-sm">{r.limitations.map((a) => <li key={a}>{a}</li>)}</ul></div>}
      {r.evidence.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-muted">Evidence ({r.evidence.length})</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">{r.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
      )}
      {r.category !== "inaccessible" && (canAct ? (
        <div className="flex flex-wrap gap-1.5 border-t border-line-cool pt-2" role="group" aria-label={`Decision for ${r.name}`}>
          <Button size="sm" variant="secondary" disabled={busy} aria-pressed={r.decision?.decision === "accept"} onClick={() => decide.mutate("accept")}>Accept</Button>
          <Button size="sm" variant="secondary" disabled={busy} aria-pressed={r.decision?.decision === "supplement"} onClick={() => decide.mutate("supplement")}>Use as supplement</Button>
          <Button size="sm" variant="secondary" disabled={busy} aria-pressed={r.decision?.decision === "reject"} onClick={() => decide.mutate("reject")}>Reject</Button>
          <Button size="sm" variant="secondary" disabled={busy} aria-pressed={r.decision?.decision === "keep_original"} onClick={() => decide.mutate("keep_original")}>Keep original</Button>
          {r.decision && <Button size="sm" variant="ghost" disabled={busy} onClick={() => clear.mutate()}>Undo</Button>}
        </div>
      ) : <p className="text-xs text-muted">View-only access: only an owner or editor can decide.</p>)}
    </li>
  );
}

/** AI-discovered better resources for the run, with the researcher's decisions. The original resources are never replaced without a decision. */
export function ResourceRecommendations({ runId, canAct }: { runId: string; canAct: boolean }) {
  const q = useResources(runId);
  if (q.isPending) return <div className="space-y-2" role="status" aria-label="Searching for alternatives"><p className="flex items-center gap-2 text-sm text-muted"><Hourglass size={16} /> Searching for alternatives…</p><Skeleton className="h-24" /></div>;
  if (q.error) return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the resource review: {userMessage(q.error)}</p>;
  const { discovery, recommendations: recs, originals } = q.data;
  const orig = [...originals.datasets, ...originals.repositories];
  const failed = discovery.status === "failed";
  return (
    <div className="space-y-3">
      {discovery.status === "not_run" ? (
        <p className="rounded-2xl bg-canvas p-3 text-sm text-muted">{discovery.note}</p>
      ) : failed ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-warning-soft p-3 text-sm"><WarningCircle size={18} className="mt-0.5 shrink-0 text-warning" />
          <span><b>Search failed.</b> {discovery.note} This does not mean there are no better resources.</span></p>
      ) : (
        <p className="flex items-start gap-2 rounded-2xl bg-lavender-soft p-3 text-sm"><CheckCircle size={18} className="mt-0.5 shrink-0 text-purple-deep" /><span>{discovery.note}
          {discovery.status === "partial" && <b> Some providers failed, so this is not a complete search.</b>}</span></p>
      )}
      {discovery.providers.length > 0 && (
        <p className="text-xs text-muted">Providers: {discovery.providers.map((p) => `${p.name} ${p.status.replace("_", " ")}`).join(" · ")}</p>
      )}
      {orig.length > 0 && (
        <div><p className="text-xs font-bold uppercase tracking-wider text-muted">Your original resources (kept unless you accept an alternative)</p>
          <ul className="mt-1 space-y-0.5 text-sm">{orig.map((o, i) => <li key={i}>{o.url ? <a className="text-purple-deep underline" target="_blank" rel="noopener noreferrer" href={o.url}>{o.name || o.url}</a> : o.name}</li>)}</ul></div>
      )}
      {recs.length > 0 && <ul className="space-y-3" aria-label="AI-discovered better resources">{recs.map((r) => <Rec key={r.id} r={r} runId={runId} canAct={canAct} />)}</ul>}
      {!failed && discovery.status !== "not_run" && recs.length === 0 && <p className="text-sm text-muted">No alternative resource was established. Your originals stay as they are.</p>}
    </div>
  );
}
