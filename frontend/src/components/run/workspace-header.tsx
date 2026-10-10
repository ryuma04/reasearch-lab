"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { GithubLogo } from "@phosphor-icons/react";
import { useWorkspace } from "@/lib/hooks/queries";
import { budgetLabel, runStatusMeta } from "@/lib/status";
import { cn, formatDateTime, shortId } from "@/lib/utils";
import { Badge, Select } from "@/components/ui/primitives";
import { ErrorState, Skeleton } from "@/components/ui/states";

/** Resolve the run this page is about: ?run=… or the workspace's latest run. */
export function useSelectedRun(workspaceId: string) {
  const sp = useSearchParams();
  const ws = useWorkspace(workspaceId);
  const runs = ws.data?.runs ?? [];
  const explicit = sp.get("run");
  const runId = explicit ?? runs.at(-1)?.id ?? null;
  const run = runs.find((r) => r.id === runId) ?? null;
  return { ws, runId, run, runs };
}

const TABS = [
  { seg: "", label: "Overview" },
  { seg: "/run/:run", label: "Workflow" },
  { seg: "/live", label: "Live board" },
  { seg: "/map", label: "Research map" },
  { seg: "/explorer", label: "Gap Explorer" },
  { seg: "/sandbox", label: "Code sandbox" },
  { seg: "/results/research", label: "Results", match: "/results" },
  { seg: "/replay", label: "Replay" },
  { seg: "/publish", label: "Publish" },
];

export function WorkspaceHeader({ id }: { id: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { ws, runId, runs } = useSelectedRun(id);
  const base = `/workspaces/${id}`;
  const q = runId ? `?run=${encodeURIComponent(runId)}` : "";

  if (ws.isPending) return <Skeleton className="h-28" />;
  if (ws.error) return <ErrorState error={ws.error} title="Couldn't open this workspace" onRetry={() => void ws.refetch()} />;
  const w = ws.data!;
  const latestRun = runs.find((r) => r.id === runId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Workspace · {budgetLabel(w.compute_budget)} budget</p>
          <h1 className="mt-1 truncate text-2xl font-semibold sm:text-3xl">{w.title}</h1>
          <p className="mt-1 text-xs text-muted">Created {formatDateTime(w.created_at)}{w.role && w.role !== "owner" ? ` · You are a ${w.role}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {w.latest_push?.repo_url && w.latest_push.status === "succeeded" && (
            <a href={w.latest_push.repo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold shadow-clay-sm hover:-translate-y-0.5">
              <GithubLogo size={14} /> {w.latest_push.repo_url.replace("https://github.com/", "")}
            </a>
          )}
          {latestRun && <Badge tone={runStatusMeta[latestRun.status].tone} solid>{runStatusMeta[latestRun.status].label}</Badge>}
          {runs.length > 1 && (
            <Select
              aria-label="Select run"
              className="h-9 w-auto min-w-40 text-xs"
              value={runId ?? ""}
              onChange={(e) => {
                const usp = new URLSearchParams(sp.toString());
                usp.set("run", e.target.value);
                window.history.replaceState(null, "", `${pathname}?${usp.toString()}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              {runs.map((r, i) => <option key={r.id} value={r.id}>Run #{i + 1} · {shortId(r.id)}{r.parent_run_id ? " (branch)" : ""}</option>)}
            </Select>
          )}
        </div>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-clay-sm" aria-label="Workspace sections">
        {TABS.filter((t) => !t.seg.includes(":run") || runId).map((t) => {
          const isFlow = t.seg.includes(":run");
          const href = `${base}${isFlow ? t.seg.replace(":run", encodeURIComponent(runId ?? "")) : t.seg}`;
          const on = t.match ? pathname.startsWith(`${base}${t.match}`) : pathname === href;
          return (
            <Link key={t.seg} href={isFlow ? href : `${href}${q}`} aria-current={on ? "page" : undefined}
              className={cn("relative inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold", on ? "text-white" : "text-ink-soft hover:text-ink")}>
              {on && <motion.span layoutId="ws-tab" className="absolute inset-0 rounded-full bg-pill" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className="relative">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
