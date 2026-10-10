"use client";

import Link from "next/link";
import { Flask, GithubLogo, Plus, ArrowRight, Warning } from "@phosphor-icons/react";
import { useMe, useWorkspaces } from "@/lib/hooks/queries";
import { isApiError } from "@/lib/api/errors";
import { budgetLabel, runStatusMeta } from "@/lib/status";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, StatCard } from "@/components/ui/primitives";
import { EmptyState, EndpointUnavailable, ErrorState, SkeletonList } from "@/components/ui/states";

export default function DashboardPage() {
  const me = useMe();
  const ws = useWorkspaces();
  const gh = me.data?.github;
  const list = ws.data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Research lab</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Hello, {me.data?.user.name?.split(" ")[0] ?? me.data?.user.github_username}.</h1>
        </div>
        <Button asChild variant="purple"><Link href="/workspaces/new"><Plus size={18} weight="bold" /> New workspace</Link></Button>
      </div>

      {gh && gh.status !== "connected" && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-[24px] border-2 border-ink bg-sun-soft p-4 shadow-pop">
          <Warning size={22} weight="duotone" className="text-sun-deep" />
          <p className="flex-1 text-sm font-semibold">GitHub is not connected. You can run research, but you must connect GitHub before any push.</p>
          <Button asChild size="sm" variant="outline"><Link href="/profile">Connect GitHub</Link></Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Workspaces" value={ws.data ? list.length : "—"} icon={<Flask size={18} weight="duotone" />} />
        <StatCard label="Runs in progress" value={ws.data ? list.filter((w) => w.latest_run && ["running", "waiting_approval", "queued", "paused"].includes(w.latest_run.status)).length : "—"} tone="sky" icon={<Flask size={18} weight="duotone" />} />
        <StatCard label="Finished runs" value={ws.data ? list.filter((w) => w.latest_run?.status === "succeeded").length : "—"} tone="mint" icon={<Flask size={18} weight="duotone" />} />
        <StatCard label="Push repository" value={<span className="text-base">{gh?.default_repo ?? "Not set"}</span>} tone="sun" icon={<GithubLogo size={18} weight="duotone" />} hint={gh?.status === "connected" ? "GitHub connected" : "GitHub not connected"} />
      </div>

      <section>
        <h2 className="text-xl font-bold">Your workspaces</h2>
        <div className="mt-4">
          {ws.isPending ? (
            <SkeletonList />
          ) : ws.error ? (
            isApiError(ws.error) && ws.error.kind === "unavailable" ? (
              <div className="space-y-4">
                <EndpointUnavailable error={ws.error} feature="Workspace list" />
                <p className="text-center text-sm text-muted">You can still <Link className="font-semibold text-purple-deep underline" href="/workspaces/new">create a workspace</Link> and open it directly.</p>
              </div>
            ) : (
              <ErrorState error={ws.error} title="Couldn't load workspaces" onRetry={() => void ws.refetch()} />
            )
          ) : list.length === 0 ? (
            <EmptyState title="No workspaces yet" body="Create a workspace, upload a paper, and the agent team will get to work." action={<Button asChild variant="purple"><Link href="/workspaces/new"><Plus size={18} weight="bold" /> New workspace</Link></Button>} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((w) => {
                const st = w.latest_run ? runStatusMeta[w.latest_run.status] : null;
                return (
                  <Link key={w.id} href={`/workspaces/${w.id}`} className="block rounded-[28px]">
                    <Card interactive className="h-full p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 text-lg font-bold">{w.title}</h3>
                        {st ? <Badge tone={st.tone} solid>{st.label}</Badge> : <Badge>No run yet</Badge>}
                      </div>
                      <p className="mt-2 text-xs text-muted">Budget: {budgetLabel(w.compute_budget)} · Created {formatDateTime(w.created_at)}</p>
                      {w.note && <p className="mt-3 line-clamp-2 text-sm text-ink-soft">“{w.note}”</p>}
                      <div className="mt-4 flex items-center justify-between text-sm font-semibold text-purple-deep">
                        {w.repo_url ? <span className="flex items-center gap-1 truncate"><GithubLogo size={14} />{w.repo_url.replace("https://github.com/", "")}</span> : <span />}
                        <span className="flex items-center gap-1">Open <ArrowRight size={14} weight="bold" /></span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
