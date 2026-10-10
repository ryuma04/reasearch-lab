"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { FilePdf, LinkSimple, Database, GithubLogo, Play, ShareNetwork, Plus } from "@phosphor-icons/react";
import { runApi, workspaceApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import type { ShareLink } from "@/lib/api/types";
import { qk } from "@/lib/hooks/queries";
import { useSelectedRun } from "@/components/run/workspace-header";
import { APP_ORIGIN } from "@/lib/config";
import { budgetLabel, runStatusMeta } from "@/lib/status";
import { formatDateTime, shortId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Input, SectionTitle } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { Sheet, toast } from "@/components/ui/overlays";
import { CopyButton } from "@/components/ui/content";

const uploadIcon = { paper: FilePdf, dataset: Database, repo_link: GithubLogo, note: LinkSimple };

export default function WorkspaceOverview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { ws, runs } = useSelectedRun(id);
  const [share, setShare] = React.useState<ShareLink | null>(null);
  const [hours, setHours] = React.useState("24");

  const start = useMutation({
    mutationFn: () => runApi.start(id, { compute_budget: ws.data!.compute_budget }),
    onSuccess: async (run) => {
      await qc.invalidateQueries({ queryKey: qk.workspace(id) });
      router.push(`/workspaces/${id}/run/${encodeURIComponent(run.id)}`);
    },
    onError: (e) => toast.error("Couldn't start the run", userMessage(e)),
  });
  const shareM = useMutation({
    mutationFn: () => workspaceApi.share(id, { expires_in_hours: Number(hours) || undefined }),
    onSuccess: (s) => setShare(s),
    onError: (e) => toast.error("Couldn't create a share link", userMessage(e)),
  });

  if (!ws.data) return null;
  const w = ws.data;
  const shareUrl = share ? share.url ?? `${APP_ORIGIN || window.location.origin}/share/${encodeURIComponent(share.token)}` : "";
  const readOnly = w.role === "viewer";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card className="p-6">
          <SectionTitle title="Runs" action={!readOnly && <Button size="sm" variant="purple" loading={start.isPending} disabled={!w.papers?.length && !(w.uploads ?? []).some((u) => u.kind === "paper")} onClick={() => start.mutate()}><Play size={16} weight="bold" /> Start {runs.length ? "new" : ""} run ({budgetLabel(w.compute_budget)})</Button>} />
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" body="Start a run to bring in the agent team." />
          ) : (
            <ul className="mt-4 space-y-2">
              {[...runs].reverse().map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3">
                  <span className="font-display text-sm font-bold">Run #{runs.length - i}</span>
                  <span className="font-mono text-xs text-muted">{shortId(r.id)}{r.branch_name ? ` · ${r.branch_name}` : ""}{r.git_commit ? ` · ${shortId(r.git_commit)}` : ""}</span>
                  <Badge tone={runStatusMeta[r.status].tone} solid>{runStatusMeta[r.status].label}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(r.started_at)}</span>
                  <span className="ml-auto flex gap-1.5">
                    <Button asChild size="sm" variant="secondary"><Link href={`/workspaces/${id}/live?run=${r.id}`}>Live</Link></Button>
                    <Button asChild size="sm" variant="soft"><Link href={`/workspaces/${id}/results/scorecard?run=${r.id}`}>Results</Link></Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <SectionTitle title="Uploads" action={<Badge>{(w.uploads ?? []).length} items</Badge>} />
          {(w.uploads ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No uploads recorded. {w.uploads === undefined && "(GET /workspaces/{id} did not include an uploads list — see integration notes.)"}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {(w.uploads ?? []).map((u) => {
                const I = uploadIcon[u.kind];
                return (
                  <li key={u.id} className="flex items-center gap-3 rounded-2xl bg-canvas p-3 text-sm">
                    <I size={20} weight="duotone" /><Badge>{u.kind.replace("_", " ")}</Badge>
                    <span className="min-w-0 flex-1 truncate">{u.filename ?? u.path_or_url}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {w.note && <p className="mt-4 rounded-2xl bg-sun-soft p-3 text-sm text-sun-deep"><b>Researcher note:</b> {w.note}</p>}
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="p-6">
          <SectionTitle title="Live share link" kicker="Read-only · QR" />
          <p className="mt-2 text-sm text-muted">Teammates, a professor or judges can watch the board, map and scorecard live — they can&apos;t change anything.</p>
          {!readOnly && (
            <div className="mt-4 flex items-end gap-2">
              <Field label="Expires after (hours)" htmlFor="share-h"><Input id="share-h" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} className="w-32" /></Field>
              <Button variant="outline" loading={shareM.isPending} onClick={() => shareM.mutate()}><ShareNetwork size={18} weight="bold" /> Create link</Button>
            </div>
          )}
        </Card>
        <Card variant="soft" tone="lavender" className="p-6">
          <p className="font-display text-base font-bold">Quick links</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary"><Link href={`/workspaces/${id}/results/notes`}>Notes</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href={`/workspaces/${id}/map`}>Research map</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href={`/workspaces/${id}/publish`}>Publish to GitHub</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href="/workspaces/new"><Plus size={14} /> New workspace</Link></Button>
          </div>
        </Card>
      </div>

      <Sheet open={!!share} onOpenChange={(o) => !o && setShare(null)} title="Share live view" description={share?.expires_at ? `Expires ${formatDateTime(share.expires_at)}` : "Read-only link"} mode="center">
        {share && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit rounded-[24px] border-2 border-ink bg-white p-4 shadow-pop"><QRCodeSVG value={shareUrl} size={200} /></div>
            <div className="flex items-center gap-2 rounded-2xl bg-pill p-2 pl-4 text-left"><span className="min-w-0 flex-1 truncate font-mono text-xs text-white">{shareUrl}</span><CopyButton text={shareUrl} /></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
