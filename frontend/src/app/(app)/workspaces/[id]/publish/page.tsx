"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, GithubLogo, ShieldCheck, ShieldWarning, WarningCircle, ArrowSquareOut, GitCommit } from "@phosphor-icons/react";
import { runApi } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import { qk, useMe, usePushStatus } from "@/lib/hooks/queries";
import { useSelectedRun } from "@/components/run/workspace-header";
import { pushStatusMeta } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/overlays";

/** Checkpoint 2 — the researcher must explicitly approve before POST /runs/{id}/push. */
export default function PublishPage() {
  const { id } = useParams<{ id: string }>();
  const { runId, run } = useSelectedRun(id);
  const me = useMe();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = React.useState(false);
  const status = usePushStatus(runId, (q) => (q.state.data && ["scanning", "pushing", "pending"].includes(q.state.data.status) ? 2000 : false));
  const push = useMutation({
    mutationFn: () => runApi.push(runId!, { approved: true, repo_full_name: me.data?.github.default_repo ?? undefined }),
    onSuccess: (p) => { qc.setQueryData(qk.pushStatus(runId!), p); toast.info("Push requested", "Secret scan and n8n workflow started by the backend."); },
    onError: (e) => toast.error("Push not started", userMessage(e)),
  });

  if (!runId) return <EmptyState title="No run to publish" />;
  const gh = me.data?.github;
  const connected = gh?.status === "connected";
  const p = push.data && (!status.data || status.data.id === push.data.id) ? status.data ?? push.data : status.data;
  const finished = run?.status === "succeeded";
  const inFlight = p && ["pending", "scanning", "pushing"].includes(p.status);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionTitle kicker="Checkpoint 2" title="Publish to GitHub" />
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3"><GithubLogo size={28} weight="duotone" />
          <div className="min-w-0 flex-1"><p className="text-sm text-muted">Destination repository</p><p className="truncate font-display text-lg font-bold">{gh?.default_repo ?? "Not chosen"}</p></div>
          <Button asChild size="sm" variant="secondary"><Link href="/profile">Change</Link></Button>
        </div>
        {!connected && <p className="flex items-center gap-2 rounded-2xl bg-warning-soft p-3 text-sm font-semibold text-warning" role="alert"><WarningCircle size={18} /> Connect GitHub on your profile before pushing.</p>}
        {connected && !gh?.default_repo && <p className="rounded-2xl bg-warning-soft p-3 text-sm font-semibold text-warning" role="alert">Choose or create a repository on your profile first.</p>}
        {!finished && <p className="rounded-2xl bg-sky-soft p-3 text-sm text-sky-deep">This run hasn&apos;t finished yet. You can push once all agents are done.</p>}
        <ul className="space-y-1.5 text-sm text-ink-soft">
          <li className="flex gap-2"><ShieldCheck size={18} className="shrink-0 text-success" /> The backend scans the bundle for secrets (Gitleaks) before anything leaves your machine.</li>
          <li className="flex gap-2"><GitCommit size={18} className="shrink-0 text-purple" /> n8n creates one meaningful commit per stage; each what-if goes to its own branch.</li>
          <li className="flex gap-2"><ShieldCheck size={18} className="shrink-0 text-success" /> Datasets aren&apos;t pushed (a download script is); your GitHub token never reaches the browser.</li>
        </ul>
        <label className="flex items-start gap-2 rounded-2xl bg-canvas p-3 text-sm font-semibold">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-purple" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I approve pushing this run&apos;s code, results and logs to {gh?.default_repo ?? "my repository"}.
        </label>
        <div className="fixed inset-x-3 bottom-24 z-30 md:static">
          <Button size="lg" variant="purple" className="w-full" disabled={!confirmed || !connected || !gh?.default_repo || !finished || !!inFlight} loading={push.isPending} onClick={() => push.mutate()}>
            <GithubLogo size={20} weight="bold" /> Approve push
          </Button>
        </div>
      </Card>

      {status.error && !(isApiError(status.error) && (status.error.kind === "not_found" || status.error.kind === "unavailable")) && <p className="text-sm text-danger">Couldn&apos;t load push status: {userMessage(status.error)}</p>}
      {status.error && isApiError(status.error) && status.error.kind === "unavailable" && push.data && <p className="text-xs text-muted">Live push status needs <Mono>GET /runs/{"{id}"}/push</Mono> (proposed); progress also arrives via push_* events.</p>}

      {p && (
        <Card className="space-y-4 p-6" aria-live="polite">
          <div className="flex items-center gap-2"><p className="flex-1 font-display text-lg font-bold">Push status</p><Badge tone={pushStatusMeta[p.status].tone} solid>{pushStatusMeta[p.status].label}</Badge></div>
          {p.secret_scan_result && (p.secret_scan_result.passed ? (
            <p className="flex items-center gap-2 text-sm text-success"><ShieldCheck size={18} weight="fill" /> Secret scan passed</p>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-danger/40 bg-danger-soft/50 p-4" role="alert">
              <p className="flex items-center gap-2 font-bold text-danger"><ShieldWarning size={20} weight="fill" /> Push blocked — secrets detected</p>
              <ul className="mt-2 space-y-1 text-sm">{p.secret_scan_result.findings.map((f, i) => <li key={i}><Mono>{f.file}:{f.line}</Mono> — {f.rule}{f.description ? ` (${f.description})` : ""}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">Remove the secret from the run output, then approve again.</p>
            </div>
          ))}
          {p.status === "failed" && <p className="text-sm text-danger">{p.error ?? "The push failed."} <Button size="sm" variant="outline" className="ml-2" onClick={() => push.mutate()}>Retry</Button></p>}
          {p.status === "succeeded" && p.repo_url && (
            <div className="space-y-2">
              <a href={p.repo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-purple-deep underline"><CheckCircle size={18} weight="fill" className="text-success" /> {p.repo_url} <ArrowSquareOut size={14} /></a>
              <ul className="space-y-1">{p.commit_urls.map((c) => <li key={c.url} className="flex items-center gap-2 text-sm"><GitCommit size={16} /><a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">{c.message}</a>{c.branch && <Badge>{c.branch}</Badge>}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
