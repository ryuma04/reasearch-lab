"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowSquareOut, CheckCircle, CircleNotch, Lock, Globe, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { isApiError, userMessage } from "@/lib/api/errors";
import { hfApi } from "@/lib/api/services";
import type { HfPublication } from "@/lib/api/types";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Progress, SectionTitle } from "@/components/ui/primitives";
import { ErrorState, Skeleton } from "@/components/ui/states";

const errText = (e: unknown) => (isApiError(e) && e.message && e.message !== e.kind ? e.message : userMessage(e));
const live = (p?: HfPublication) => p?.status === "queued" || p?.status === "uploading";

function useDebounced<T>(v: T, ms = 500) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const NAME_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;

/** Mirrors the server's rule (hfpublish.ValidateRepoName) so a half-typed name is explained inline, not sent. */
export function repoNameProblem(name: string): string | null {
  if (!name) return null;
  const parts = name.split("/");
  if (parts.length > 2) return "Use a name like my-model or owner/my-model.";
  for (const p of parts) {
    if (!NAME_PART.test(p) || p.includes("--") || p.includes("..")) {
      return `"${p}" is not a valid Hugging Face name: start and end with a letter or digit; use letters, digits, '-', '_' or '.' (no '--' or '..'), up to 96 characters.`;
    }
  }
  return null;
}

/** Publish the run's verified model to the Hugging Face Hub. The upload runs on the server. */
export function HuggingFacePublish({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const [repo, setRepo] = React.useState("");
  const [isPrivate, setPrivate] = React.useState(true);
  const [withCode, setWithCode] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const repoQ = useDebounced(repo.trim());
  const nameProblem = repoNameProblem(repo.trim());

  const list = useQuery({
    queryKey: ["run", runId, "hf", "list"],
    queryFn: ({ signal }) => hfApi.list(runId, signal),
    refetchInterval: (q) => (q.state.data?.some(live) ? 1500 : false),
  });
  const latest = list.data?.[0];
  const busy = live(latest);

  const plan = useQuery({
    queryKey: ["run", runId, "hf", "preview", repoQ, withCode],
    queryFn: ({ signal }) => hfApi.preview(runId, repoQ, withCode, signal),
    enabled: !busy && !repoNameProblem(repoQ), // a half-typed name is not sent to the server
    placeholderData: keepPreviousData, // keep the form on screen while the name or options change
  });
  React.useEffect(() => {
    if (!repo && plan.data?.suggested_repo) setRepo(plan.data.suggested_repo);
  }, [plan.data?.suggested_repo, repo]);
  React.useEffect(() => setConfirmed(false), [repoQ, isPrivate, withCode]); // any change needs a new confirmation

  const publish = useMutation({
    mutationFn: () => hfApi.publish(runId, { repo: repo.trim(), private: isPrivate, include_code: withCode }),
    onSuccess: () => {
      setConfirmed(false);
      void qc.invalidateQueries({ queryKey: ["run", runId, "hf", "list"] });
    },
  });

  const p = plan.data;
  const problem = nameProblem ?? (plan.error && p ? errText(plan.error) : null);
  const blocked = !!p && p.blockers.length > 0;
  const fileCount = (p?.files.length ?? 0) + 1; // plus README.md

  return (
    <div className="space-y-5">
      <SectionTitle title="Publish to Hugging Face" />
      <Card className="space-y-5 p-6">
        {plan.isPending ? <Skeleton className="h-40" /> : plan.error && !p ? (
          <ErrorState error={plan.error} title="Hugging Face" onRetry={() => void plan.refetch()} />
        ) : p && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <label className="space-y-1.5">
                <span className="text-sm font-semibold">Repository name</span>
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={p.suggested_repo} disabled={busy}
                  aria-invalid={!!problem} aria-describedby="hf-repo-hint" />
                {problem
                  ? <span id="hf-repo-hint" role="alert" className="block text-xs font-semibold text-danger">{problem}</span>
                  : <span id="hf-repo-hint" className="block text-xs text-muted">Use a name, or owner/name to publish to an organization.</span>}
              </label>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-semibold">Visibility</legend>
                <div className="flex gap-2">
                  {([[true, "Private", Lock], [false, "Public", Globe]] as const).map(([val, label, Icon]) => (
                    <button key={label} type="button" aria-pressed={isPrivate === val} disabled={busy} onClick={() => setPrivate(val)}
                      className={cn("inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold",
                        isPrivate === val ? "bg-pill text-white" : "bg-white text-ink-soft shadow-clay-sm")}>
                      <Icon size={16} /> {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Files to upload ({fileCount}, {formatBytes(p.total_bytes)})</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-purple" checked={withCode} disabled={busy} onChange={(e) => setWithCode(e.target.checked)} />
                  Include code
                </label>
              </div>
              <ul className="divide-y divide-line-cool rounded-2xl border border-line-cool" data-testid="hf-files">
                {p.files.map((f) => (
                  <li key={f.path} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                    <Badge tone={f.kind === "model" ? "mint" : "faint"}>{f.kind}</Badge>
                    <span className="text-xs text-muted">{formatBytes(f.size)}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex-1 font-mono text-xs">README.md</span><Badge tone="lavender">model card</Badge>
                </li>
              </ul>
              {p.excluded.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted">Not uploaded ({p.excluded.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {p.excluded.map((x) => <li key={x.path}><span className="font-mono">{x.path}</span> <span className="text-muted">{x.reason}</span></li>)}
                  </ul>
                </details>
              )}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted">Preview the model card</summary>
                <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-canvas p-3 font-mono text-[11px]" data-testid="hf-card">{p.model_card}</pre>
              </details>
            </div>

            {blocked && (
              <div role="alert" className="rounded-2xl bg-warning-soft p-3 text-sm">
                <p className="font-semibold text-warning">Not ready to publish</p>
                <ul className="mt-1 list-disc pl-5">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            )}

            <label className="flex items-start gap-2 rounded-2xl bg-canvas p-3 text-sm font-semibold">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-purple" checked={confirmed} disabled={blocked || busy}
                onChange={(e) => setConfirmed(e.target.checked)} />
              Upload these {fileCount} files to a {isPrivate ? "private" : "public"} Hugging Face repository{isPrivate ? "" : " that anyone can see"}.
            </label>
            {publish.error && <p role="alert" className="text-sm text-danger">{errText(publish.error)}</p>}
            <Button size="lg" variant="purple" className="w-full" disabled={!confirmed || blocked || busy || !repo.trim() || !!problem}
              loading={publish.isPending} onClick={() => publish.mutate()}>
              <UploadSimple size={20} weight="bold" /> Publish to Hugging Face
            </Button>
          </>
        )}
      </Card>

      {latest && <PublicationStatus p={latest} />}
    </div>
  );
}

function PublicationStatus({ p }: { p: HfPublication }) {
  const pct = p.bytes_total > 0 ? p.bytes_done / p.bytes_total : 0;
  return (
    <Card className="space-y-3 p-6" aria-live="polite" data-testid="hf-status">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 font-display text-lg font-bold">{p.repo_id || p.repo_name}</p>
        <Badge tone={p.private ? "faint" : "sky"}>{p.private ? "Private" : "Public"}</Badge>
        {p.status === "succeeded" ? <Badge tone="mint" solid><CheckCircle size={12} weight="bold" /> Published</Badge>
          : p.status === "failed" ? <Badge tone="coral" solid><WarningCircle size={12} weight="bold" /> Failed</Badge>
          : p.status === "queued" ? <Badge tone="faint"><CircleNotch size={12} className="animate-spin" /> Waiting to start</Badge>
          : <Badge tone="sky" solid><CircleNotch size={12} className="animate-spin" /> Uploading</Badge>}
      </div>
      {live(p) && (
        <>
          <Progress value={pct} label="Upload progress" />
          <p className="text-sm text-muted">
            {p.status === "queued"
              ? "Waiting for the agents worker to start the upload. If nothing happens in 3 minutes it stops with a message."
              : `${p.stage[0]?.toUpperCase() ?? ""}${p.stage.slice(1)}. ${p.files_done} of ${p.files_total} files, ${formatBytes(p.bytes_done)} of ${formatBytes(p.bytes_total)}`}
          </p>
        </>
      )}
      {p.status === "failed" && <p role="alert" className="text-sm text-danger">{p.error || "The upload failed."}</p>}
      {p.status === "succeeded" && p.repo_url && (
        <div className="space-y-1">
          <a href={p.repo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-purple-deep underline">
            {p.repo_url} <ArrowSquareOut size={14} />
          </a>
          {p.commit_url && <p className="text-xs"><a href={p.commit_url} target="_blank" rel="noopener noreferrer" className="text-muted underline">See the commit</a></p>}
        </div>
      )}
    </Card>
  );
}
