"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle, FolderSimple, GithubLogo, HandPointing, MagnifyingGlass, Plus, Spinner } from "@phosphor-icons/react";
import { useMe, useWorkspaces } from "@/lib/hooks/queries";
import { isApiError } from "@/lib/api/errors";
import type { RunStage, RunStatus, WorkspaceSummary } from "@/lib/api/types";
import { budgetLabel, runStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeleteWorkspaceButton } from "@/components/workspace/delete-workspace";
import { Badge, StatusDot } from "@/components/ui/primitives";
import { EmptyState, EndpointUnavailable, ErrorState, Skeleton } from "@/components/ui/states";

/* ── groups and helpers ── */

type Group = "all" | "needs_you" | "running" | "finished" | "ended" | "none";

function groupOf(w: WorkspaceSummary): Exclude<Group, "all"> {
  const s = w.latest_run?.status;
  if (!s) return "none";
  if (s === "waiting_approval" || s === "paused") return "needs_you";
  if (s === "queued" || s === "running") return "running";
  if (s === "succeeded") return "finished";
  return "ended";
}

const GROUPS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "finished", label: "Finished" },
  { key: "ended", label: "Stopped" },
  { key: "none", label: "Not started" },
];

/** Colour of the card's accent bar, by run status. */
const ACCENT: Record<RunStatus | "none", string> = {
  queued: "bg-ink/20", running: "bg-sky", waiting_approval: "bg-purple", paused: "bg-sun",
  succeeded: "bg-mint", failed: "bg-danger", stopped: "bg-ink/25", none: "bg-ink/10",
};

const TILE = ["bg-lavender-soft text-purple-deep", "bg-sky-soft text-sky-deep", "bg-mint-soft text-mint-deep", "bg-sun-soft text-sun-deep", "bg-pink-soft text-pink-deep"];
const tileFor = (title: string) => TILE[[...title].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE.length]!;

const STEPS: { label: string; reached: RunStage[] }[] = [
  { label: "Research", reached: ["research", "plan_approval", "coding", "testing", "whatifs", "push", "done"] },
  { label: "Plan", reached: ["plan_approval", "coding", "testing", "whatifs", "push", "done"] },
  { label: "Coding", reached: ["coding", "testing", "whatifs", "push", "done"] },
  { label: "Testing", reached: ["testing", "whatifs", "push", "done"] },
  { label: "Results", reached: ["push", "done"] },
];

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : new Date(t).toLocaleDateString();
}

/* ── page ── */

export default function DashboardPage() {
  const me = useMe();
  const ws = useWorkspaces();
  const list = React.useMemo(() => ws.data ?? [], [ws.data]);
  const [group, setGroup] = React.useState<Group>("all");
  const [query, setQuery] = React.useState("");

  const counts = React.useMemo(() => {
    const c: Record<Group, number> = { all: list.length, needs_you: 0, running: 0, finished: 0, ended: 0, none: 0 };
    for (const w of list) c[groupOf(w)] += 1;
    return c;
  }, [list]);
  const shown = list.filter((w) => (group === "all" || groupOf(w) === group) && w.title.toLowerCase().includes(query.trim().toLowerCase()));
  const firstName = me.data?.user.name?.split(" ")[0] ?? me.data?.user.github_username ?? "";
  const waiting = list.find((w) => groupOf(w) === "needs_you");

  return (
    <div className="space-y-8">
      {/* hero */}
      <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-lavender-soft via-white to-sky-soft p-6 shadow-clay sm:p-8">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-lavender/40 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-20 right-1/3 h-48 w-48 rounded-full bg-sky/30 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Hello{firstName ? `, ${firstName}` : ""}.</h1>
            <p className="mt-2 text-sm text-ink-soft" data-testid="hero-summary">
              {!ws.data ? "Loading your lab" : counts.needs_you
                ? `${counts.needs_you} run${counts.needs_you === 1 ? " is" : "s are"} waiting for you.`
                : counts.running ? `${counts.running} run${counts.running === 1 ? " is" : "s are"} in progress.`
                : list.length ? "Nothing needs you right now." : "Start by creating a workspace."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {waiting?.latest_run && (
              <Button asChild variant="outline"><Link href={`/workspaces/${waiting.id}/run/${waiting.latest_run.id}`}><HandPointing size={18} /> Review {waiting.title}</Link></Button>
            )}
            <Button asChild variant="purple"><Link href="/workspaces/new"><Plus size={18} weight="bold" /> New workspace</Link></Button>
          </div>
        </div>

        {/* counters */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ["Workspaces", counts.all, FolderSimple, "bg-white text-purple-deep", "all"],
            ["Needs you", counts.needs_you, HandPointing, "bg-white text-purple", "needs_you"],
            ["Running", counts.running, Spinner, "bg-white text-sky-deep", "running"],
            ["Finished", counts.finished, CheckCircle, "bg-white text-mint-deep", "finished"],
          ] as const).map(([label, n, Icon, tone, g]) => (
            <button key={label} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
              className={cn("flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-left shadow-clay-sm backdrop-blur transition hover:-translate-y-0.5",
                group === g && "ring-2 ring-purple")}>
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-clay-sm", tone)}><Icon size={20} weight="duotone" /></span>
              <span>
                <span className="block font-display text-2xl font-extrabold leading-none">{ws.data ? n : "-"}</span>
                <span className="text-xs font-semibold text-muted">{label}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* list */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Your workspaces</h2>
          <label className="flex w-full items-center gap-2 rounded-full bg-white px-4 py-2 text-sm shadow-clay-sm sm:w-64">
            <MagnifyingGlass size={16} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search workspaces" className="w-full bg-transparent outline-none" />
          </label>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filter workspaces">
          {GROUPS.filter((g) => g.key === "all" || counts[g.key] > 0).map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={group === g.key} onClick={() => setGroup(g.key)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold",
                group === g.key ? "bg-pill text-white" : "bg-white text-ink-soft shadow-clay-sm hover:text-ink")}>
              {g.label} <span className={cn("text-xs", group === g.key ? "opacity-80" : "text-muted")}>{counts[g.key]}</span>
            </button>
          ))}
        </div>

        {ws.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[28px]" />)}</div>
        ) : ws.error ? (
          isApiError(ws.error) && ws.error.kind === "unavailable" ? (
            <div className="space-y-4">
              <EndpointUnavailable error={ws.error} feature="Workspace list" />
              <p className="text-center text-sm text-muted">You can still <Link className="font-semibold text-purple-deep underline" href="/workspaces/new">create a workspace</Link>.</p>
            </div>
          ) : (
            <ErrorState error={ws.error} title="Couldn't load workspaces" onRetry={() => void ws.refetch()} />
          )
        ) : list.length === 0 ? (
          <EmptyState title="No workspaces yet" body="Create one and upload a paper to start." action={<Button asChild variant="purple"><Link href="/workspaces/new"><Plus size={18} weight="bold" /> New workspace</Link></Button>} />
        ) : shown.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-muted">No workspaces match.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="workspace-grid">
            {shown.map((w) => <WorkspaceCard key={w.id} w={w} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkspaceCard({ w }: { w: WorkspaceSummary }) {
  const run = w.latest_run;
  const st = run ? runStatusMeta[run.status] : null;
  const live = run?.status === "running" || run?.status === "queued";
  const stage = run?.stage;
  const current = stage ? STEPS.filter((s) => s.reached.includes(stage)).length : 0;
  const canDelete = w.role === undefined || w.role === "owner";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[28px] bg-white shadow-clay transition duration-200 hover:-translate-y-1 hover:shadow-clay-lg" data-testid="workspace-card">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1.5", ACCENT[run?.status ?? "none"])} />
      {/* the whole card opens the workspace; inner links sit above this layer */}
      <Link href={`/workspaces/${w.id}`} className="absolute inset-0 z-0 rounded-[28px]" aria-label={`Open ${w.title}`} />

      <div className="pointer-events-none relative flex flex-1 flex-col p-5 pt-6">
        <div className="flex items-start gap-3 pr-9">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold shadow-clay-sm", tileFor(w.title))} aria-hidden>
            {w.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-lg font-bold leading-snug">{w.title}</h3>
            <p className="mt-0.5 text-xs text-muted">{budgetLabel(w.compute_budget)} budget, {ago(w.created_at)}</p>
          </div>
        </div>

        <div className="mt-4">
          {st ? (
            <Badge tone={st.tone} solid={!live}>{live && <StatusDot tone="sky" pulse />}{st.label}</Badge>
          ) : (
            <Badge tone="faint">Not started</Badge>
          )}
        </div>

        {run && (
          <div className="mt-3" aria-label={`Progress: ${current} of ${STEPS.length} steps`}>
            <div className="flex gap-1">
              {STEPS.map((s, i) => (
                <span key={s.label} title={s.label} className={cn("h-1.5 flex-1 rounded-full",
                  i < current ? (run.status === "failed" ? "bg-danger/70" : "bg-purple") : "bg-ink/10")} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] font-semibold text-muted">{current ? STEPS[current - 1]!.label : "Starting"}</p>
          </div>
        )}

        {w.note && <p className="mt-3 line-clamp-2 text-sm text-ink-soft">{w.note}</p>}

        <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-sm font-semibold">
          {w.repo_url ? (
            <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted"><GithubLogo size={14} />{w.repo_url.replace("https://github.com/", "")}</span>
          ) : <span />}
          <span className="flex items-center gap-2">
            {run && (
              <Link href={`/workspaces/${w.id}/run/${run.id}`} className="pointer-events-auto relative z-10 rounded-full bg-lavender-soft px-3 py-1 text-xs text-purple-deep hover:bg-lavender/60">
                Workflow
              </Link>
            )}
            <span className="flex items-center gap-1 text-purple-deep">Open <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" /></span>
          </span>
        </div>
      </div>
      {canDelete && <DeleteWorkspaceButton id={w.id} title={w.title} className="absolute right-3 top-4 z-10" />}
    </article>
  );
}
