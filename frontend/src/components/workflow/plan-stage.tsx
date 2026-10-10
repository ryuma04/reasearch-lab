"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, FilePdf, Lock, NotePencil, PencilSimple, Quotes, WarningCircle } from "@phosphor-icons/react";
import { userMessage } from "@/lib/api/errors";
import { runApi, workspaceApi } from "@/lib/api/services";
import type { Claim, RunCheckpoint, RunEvent, RunSetting } from "@/lib/api/types";
import { qk, useBrief, useResearchMap, useSettings } from "@/lib/hooks/queries";
import { buildPlanTasks, validateEdits } from "@/lib/workflow/plan";
import { rawType } from "@/lib/workflow/state";
import { settingSourceMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/overlays";
import { Badge, Card, Input, Textarea } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { SourceLink } from "./source-link";
import { ImplementationPlans, planReviewOf } from "./implementation-plans";
import { ResourceRecommendations } from "./resource-recommendations";
import { ChangeBanner } from "@/components/versions/change-banner";
import { useResolveCheckpoint } from "./shared";
import type { AgentInfo } from "./types";

type Draft = { changes: Record<string, string | number | boolean>; note: string; saved_at?: string };

function Block({ n, title, children, hint }: { n: number; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card variant="bento" className="space-y-3 p-5">
      <div><p className="flex items-center gap-2 font-display text-lg font-bold"><span className="grid h-7 w-7 place-items-center rounded-full bg-lavender-soft text-sm text-purple-deep">{n}</span>{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}</div>
      {children}
    </Card>
  );
}

function ClaimRow({ c }: { c: Claim }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="rounded-2xl bg-canvas p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-semibold">{c.description}</span>
        <span className="tabular font-display font-bold">{c.value}{c.unit ? ` ${c.unit}` : ""}</span>
        <Badge tone="mint">p.{c.page ?? "?"}{c.table_ref ? ` · ${c.table_ref}` : ""}</Badge>
        {c.tolerance != null && <Badge tone="faint">±{Math.round(c.tolerance * 100)}%</Badge>}
      </div>
      {(c.quote || c.page) && <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-[11px] font-semibold text-purple-deep">{open ? "Hide evidence" : "Show evidence"}</button>}
      {open && (
        <div className="mt-2 space-y-1.5 text-ink-soft">
          {c.quote && <blockquote className="flex gap-2 border-l-4 border-lavender pl-3"><Quotes size={14} className="mt-1 shrink-0" />{c.quote}</blockquote>}
          {c.page && <a target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-deep underline" href={`${workspaceApi.paperFileUrl(c.paper_id)}#page=${c.page}`}><FilePdf size={14} /> Open the paper at page {c.page} ↗</a>}
        </div>
      )}
    </li>
  );
}

const eq = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] === a[k]);
};

export function PlanStage({ runId, cp, canAct, agents, events }: { runId: string; cp: RunCheckpoint | null; canAct: boolean; agents: AgentInfo[]; events: RunEvent[] }) {
  const qc = useQueryClient();
  const brief = useBrief(runId);
  const settings = useSettings(runId);
  const map = useResearchMap(runId);
  const resolve = useResolveCheckpoint(runId);

  const pending = cp?.status === "pending";
  const saved: Draft | null = (cp?.payload?.draft as Draft | undefined) ?? null;
  const savedValues = React.useMemo(() => Object.fromEntries(Object.entries(saved?.changes ?? {}).map(([k, v]) => [k, String(v)])), [saved]);
  const [editing, setEditing] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  // Start from the server's saved draft whenever it changes on the server (also after a refresh or on another device).
  const seeded = React.useRef<string>("");
  React.useEffect(() => {
    const sig = JSON.stringify(saved ?? null);
    if (!pending || seeded.current === sig) return;
    seeded.current = sig;
    setValues(savedValues);
    setNote(saved?.note ?? "");
    if (saved && (Object.keys(savedValues).length || saved.note)) setEditing(true);
  }, [saved, savedValues, pending]);

  const list = React.useMemo(() => settings.data ?? [], [settings.data]);
  const claims = React.useMemo(() => brief.data?.claims ?? [], [brief.data]);
  const { changes, errors } = React.useMemo(() => validateEdits(list, values), [list, values]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = !eq(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, String(v)])), savedValues) || note.trim() !== (saved?.note ?? "");
  const savedCount = Object.keys(savedValues).length;
  const unsavedCount = Object.keys(changes).length + (note.trim() ? 1 : 0);

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: qk.checkpoints(runId) }), qc.invalidateQueries({ queryKey: qk.settings(runId) })]);
  const save = useMutation({
    mutationFn: () => runApi.savePlanDraft(runId, { changes, note: note.trim() }),
    onSuccess: async () => { await invalidate(); toast.success("Changes saved", "They stay saved if you refresh. Nothing runs until you approve."); },
    onError: (e) => toast.error("Couldn't save your changes", userMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => runApi.discardPlanDraft(runId),
    onSuccess: async () => { setValues({}); setNote(""); setEditing(false); setConfirming(false); seeded.current = ""; await invalidate(); },
    onError: (e) => toast.error("Couldn't discard the draft", userMessage(e)),
  });
  const revert = () => { setValues(savedValues); setNote(saved?.note ?? ""); if (!savedCount && !saved?.note) setEditing(false); };

  const tasks = React.useMemo(() => buildPlanTasks(agents, claims, list), [agents, claims, list]);
  const bySource = (src: RunSetting["source"][]) => list.filter((s) => src.includes(s.source));
  const dataSettings = list.filter((s) => s.name.startsWith("data."));
  const sources = brief.data?.sources ?? [];
  const mapSources = (map.data?.nodes ?? []).filter((n) => n.kind === "source" || n.kind === "dataset");
  const edits = events.filter((e) => rawType(e) === "plan_edited");
  const resolved = cp && !pending;
  const sourceMeta = (s: RunSetting) => settingSourceMeta[s.source] ?? { label: s.source, tone: "faint" as const, dot: "bg-muted" };

  // A plan can only be approved when it is complete and any edits are saved.
  const problems: string[] = [];
  if (!list.length) problems.push("no settings were produced");
  if (!claims.length) problems.push("no claims were extracted from the paper");
  const planReview = planReviewOf(cp?.payload);
  if (planReview && planReview.ready === null) problems.push("no implementation plan passed validation");
  const incomplete = problems.length > 0;

  if (!cp) return <EmptyState title="The Coding Plan is not ready yet" body="It is generated from the research findings. It appears here, ready for review, once the research agents finish." />;
  if (settings.isPending || brief.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (settings.error) return <ErrorState error={settings.error} title="Coding plan" onRetry={() => void settings.refetch()} />;

  const sendApproval = () =>
    resolve.mutate(savedCount || saved?.note ? { name: "plan", decision: "edit", changes: saved!.changes, instructions: saved!.note || undefined } : { name: "plan", decision: "approve" }, {
      onSuccess: () => { setConfirming(false); setEditing(false); },
    });

  return (
    <div className="space-y-5 pb-28">
      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl p-4", pending ? "bg-lavender-soft" : cp.status === "rejected" ? "bg-danger-soft" : "bg-success-soft")}>
        {pending ? <NotePencil size={22} weight="duotone" className="text-purple-deep" /> : cp.status === "rejected" ? <WarningCircle size={22} weight="duotone" className="text-danger" /> : <CheckCircle size={22} weight="fill" className="text-success" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{pending ? "Review the Coding Plan, then edit or approve it" : cp.status === "rejected" ? "You rejected this plan" : cp.status === "edited" ? "Approved with your edits" : "Approved"}</p>
          <p className="text-sm text-ink-soft">{pending ? "No code is written until you approve. The approved plan is saved and handed to the coding stage." : resolved && cp.resolved_at ? `Approval confirmed by the server at ${new Date(cp.resolved_at).toLocaleString()}. The approved version stays saved and cannot be changed here.` : ""}</p>
        </div>
        {!pending && <Lock size={18} className="text-muted" aria-label="Locked" />}
      </div>

      <ChangeBanner runId={runId} />

      <Block n={0} title="AI-Discovered Better Resources" hint="Discovered during research and compared with your own datasets and repositories. Nothing replaces your originals unless you accept it; your decisions are passed to the planner when you approve.">
        <ResourceRecommendations runId={runId} canAct={canAct} />
      </Block>

      {planReview && (
        <Block n={0} title="Implementation plan" hint="The Initial Planner drafts it, the Optimizer critiques it. Both are kept; coding starts only from a plan that passed validation.">
          <ImplementationPlans review={planReview} />
        </Block>
      )}

      <Block n={1} title="Research findings" hint="From the research agents. Open a claim to see the exact sentence and page in the paper.">
        {brief.data?.summary && <p className="text-sm text-ink-soft">{brief.data.summary}</p>}
        {claims.length ? <ul className="space-y-2">{claims.map((c) => <ClaimRow key={c.id} c={c} />)}</ul> : <p className="rounded-2xl bg-warning-soft p-3 text-sm">No claims were extracted, so the Claim Scorecard would be empty.</p>}
      </Block>

      <Block n={2} title="Technical decisions" hint="Every setting the code will use, with where it came from. Orange and red ones are the likeliest causes of any difference from the paper.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="text-xs uppercase tracking-wider text-muted"><th className="py-2 pr-3">Setting</th><th className="py-2 pr-3">Value</th><th className="py-2 pr-3">Source</th><th className="py-2">Evidence / reason</th></tr></thead>
            <tbody className="divide-y divide-line-cool">
              {list.map((s) => {
                const meta = sourceMeta(s);
                const err = errors[s.name];
                const touched = changes[s.name] !== undefined;
                return (
                  <tr key={s.id} className={cn(touched && "bg-sun/15")}>
                    <td className="py-2 pr-3 font-mono text-xs">{s.name}</td>
                    <td className="py-2 pr-3">
                      {editing && pending && canAct ? (
                        <div><Input aria-label={`Value of ${s.name}`} aria-invalid={!!err} className="h-9 w-40 py-1 text-sm" value={values[s.name] ?? s.value} onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))} />
                          {err && <p role="alert" className="mt-0.5 text-[11px] font-semibold text-danger">{err}</p>}</div>
                      ) : <span className="font-mono font-semibold">{pending && savedValues[s.name] !== undefined ? `${savedValues[s.name]} ` : s.value}{pending && savedValues[s.name] !== undefined && <span className="ml-1 text-[10px] font-bold text-warning">saved edit</span>}</span>}
                    </td>
                    <td className="py-2 pr-3"><Badge tone={meta.tone}><span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}</Badge></td>
                    <td className="py-2 text-xs text-ink-soft">{s.reason || s.source_ref || "—"}{s.paper_value && s.paper_value !== s.value ? <span className="text-muted"> · paper: {s.paper_value}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Block>

      <Block n={3} title="Implementation tasks" hint="The fixed pipeline, in order. File-level tasks are decided by the Code Writer and appear in the coding stage.">
        <ol className="space-y-2">
          {tasks.map((t, i) => (
            <li key={t.id} className="rounded-2xl bg-canvas p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold"><span className="tabular text-xs text-muted">{i + 1}.</span> {t.title}</p>
              <p className="mt-0.5 text-ink-soft">{t.explanation}</p>
              <p className="mt-1 text-xs text-muted"><b>Because:</b> {t.because}</p>
              <p className="text-xs text-muted"><b>Done when:</b> {t.acceptance}{t.dependsOn ? ` · after “${t.dependsOn}”` : ""}</p>
            </li>
          ))}
        </ol>
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block n={4} title="Data and dependencies">
          <ul className="space-y-1.5 text-sm">
            {sources.filter((s) => s.kind !== "paper").map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2"><Badge tone="sky">{s.kind === "code" ? "repository" : s.kind}</Badge><span>{s.title}</span><SourceLink url={s.url} kind={s.kind === "code" ? "repository" : "dataset"} /></li>
            ))}
            {!sources.length && mapSources.map((n) => <li key={n.id} className="flex gap-2"><Badge tone="sky">{n.kind}</Badge><span>{n.label}</span><SourceLink url={n.url} kind="source" /></li>)}
            {dataSettings.map((s) => <li key={s.id} className="flex gap-2 font-mono text-xs"><span className="text-muted">{s.name}</span> = {s.value}</li>)}
            {!sources.length && !mapSources.length && !dataSettings.length && <li className="text-muted">No datasets were reported yet.</li>}
          </ul>
          <p className="text-xs text-muted">Libraries are installed in the sandbox from the generated requirements.txt with exact versions. To use a different dataset or repository, add it in the workspace and start a new run.</p>
        </Block>
        <Block n={5} title="Evaluation and testing">
          <ul className="space-y-1 text-sm">
            <li>{claims.length} claim test{claims.length === 1 ? "" : "s"}: a result passes if within its tolerance of the paper.</li>
            <li>Correctness tests of the code itself.</li>
            <li>A result that differs is explained by experiments, not guessed.</li>
          </ul>
        </Block>
        <Block n={6} title="Risks and assumptions" hint="Where the reproduction can differ from the paper.">
          <ul className="space-y-1.5 text-sm">
            {bySource(["assumption", "compute_change"]).map((s) => (
              <li key={s.id}><Badge tone={sourceMeta(s).tone}>{sourceMeta(s).label}</Badge> <span className="font-mono text-xs">{s.name}</span> = {s.value}{s.paper_value ? <span className="text-muted"> (paper: {s.paper_value})</span> : null}{s.reason ? <span className="block text-xs text-muted">{s.reason}</span> : null}</li>
            ))}
            {!bySource(["assumption", "compute_change"]).length && <li className="text-muted">No assumptions were needed.</li>}
          </ul>
        </Block>
        <Block n={7} title="Expected artifacts">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            <li>Project code and configs/config.yaml</li><li>results/metrics.json written by the code</li><li>Test report and logs for every sandbox run</li><li>Claim Scorecard with proof for each number</li>
          </ul>
        </Block>
      </div>

      {edits.length > 0 && (
        <Card variant="bento" className="p-4 text-sm"><p className="font-bold">Edits applied</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">{edits.map((e) => <li key={e.id ?? e.time}>{e.message}</li>)}</ul></Card>
      )}

      {pending && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-white/95 p-3 backdrop-blur md:left-auto md:right-6 md:bottom-6 md:max-w-xl md:rounded-[24px] md:border-2 md:shadow-pop-lg">
          {!canAct ? <p className="text-sm font-semibold text-muted">You have view-only access: only an owner or editor can edit or approve this plan.</p> : confirming ? (
            <div className="space-y-2">
              <p className="font-semibold">Approve the plan with your saved edits and start coding?</p>
              <ul className="max-h-40 space-y-0.5 overflow-auto text-sm">
                {Object.entries(savedValues).map(([k, v]) => <li key={k}><span className="font-mono text-xs">{k}</span>: <s className="text-muted">{list.find((s) => s.name === k)?.value}</s> → <b>{v}</b></li>)}
                {saved?.note && <li>Instruction for the agents: <b>{saved.note}</b></li>}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button variant="success" loading={resolve.isPending} onClick={sendApproval}>Confirm approval</Button>
                <Button variant="secondary" disabled={resolve.isPending} onClick={() => setConfirming(false)}>Back</Button>
              </div>
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-muted">Anything else for the agents? (optional)
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="mt-1 min-h-16 text-sm" placeholder="e.g. keep the run under 10 minutes" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {dirty ? <Badge tone="sun">{unsavedCount} unsaved change{unsavedCount === 1 ? "" : "s"}</Badge> : savedCount || saved?.note ? <Badge tone="mint"><CheckCircle size={11} weight="fill" /> Saved</Badge> : <Badge tone="faint">No changes yet</Badge>}
                <Button variant="outline" size="sm" disabled={!dirty || hasErrors} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
                <Button variant="secondary" size="sm" disabled={!dirty || save.isPending} onClick={revert}>Cancel changes</Button>
                {(savedCount > 0 || !!saved?.note) && <Button variant="ghost" size="sm" disabled={discard.isPending} onClick={() => discard.mutate()}>Discard saved edits</Button>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="success" disabled={dirty || incomplete || (!savedCount && !saved?.note)} onClick={() => setConfirming(true)}>Approve edited plan</Button>
                {dirty && <span className="text-xs text-muted">Save your changes first, then approve.</span>}
                {!dirty && !savedCount && !saved?.note && <span className="text-xs text-muted">Change a value, save, then approve, or leave edit mode to approve as is.</span>}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="lg" variant="success" loading={resolve.isPending} disabled={incomplete} onClick={() => (savedCount || saved?.note ? setConfirming(true) : sendApproval())}><CheckCircle size={18} weight="bold" /> Approve Plan{savedCount || saved?.note ? " (with saved edits)" : ""}</Button>
                <Button size="lg" variant="outline" disabled={resolve.isPending} onClick={() => setEditing(true)}><PencilSimple size={18} weight="bold" /> Edit Plan</Button>
                <Button variant="ghost" disabled={resolve.isPending} onClick={() => { if (window.confirm("Reject this plan? The run will stop and nothing will be coded.")) resolve.mutate({ name: "plan", decision: "reject" }); }}>Reject</Button>
              </div>
              {incomplete && <p role="alert" className="text-xs font-semibold text-danger">This plan can’t be approved yet: {problems.join(" and ")}.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
