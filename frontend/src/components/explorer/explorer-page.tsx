"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowsClockwise, Lightbulb, ListChecks, Scales, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { useExplorer, useExplorerActions } from "@/lib/explorer/api";
import type { XData } from "@/lib/explorer/types";
import { useSelectedRun } from "@/components/run/workspace-header";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Spinner } from "@/components/workflow/spinner";
import { ComparisonView } from "./comparison-view";
import { GapsView } from "./gaps-view";
import { RecommendationsView } from "./recommendations-view";
import { TimelineView } from "./timeline-view";

const VIEWS = [
  { key: "timeline", label: "Research Evolution Timeline", short: "Timeline", Icon: TreeStructure },
  { key: "comparison", label: "System Comparison", short: "Comparison", Icon: Scales },
  { key: "gaps", label: "Research Gap Analysis", short: "Gaps", Icon: Lightbulb },
  { key: "recommendations", label: "Improvement Recommendations", short: "Improvements", Icon: ListChecks },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export function ExplorerPage({ workspaceId }: { workspaceId: string }) {
  const { runId, ws } = useSelectedRun(workspaceId);
  const q = useExplorer(runId);
  const actions = useExplorerActions(runId ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const asked = sp.get("view") as ViewKey | null;
  const view: ViewKey = VIEWS.some((v) => v.key === asked) ? (asked as ViewKey) : "timeline";
  const setView = (k: ViewKey) => {
    const usp = new URLSearchParams(sp.toString());
    usp.set("view", k);
    router.replace(`${pathname}?${usp}`, { scroll: false });
  };

  if (ws.isPending) return <Skeleton className="h-64" />;
  if (!runId) return <EmptyState title="Start a research run first" body="Upload a paper and start a run first." action={<Button asChild><Link href={`/workspaces/${workspaceId}`}>Open the workspace</Link></Button>} />;
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (q.error) return <ErrorState error={q.error} title="Research Gap Explorer" onRetry={() => void q.refetch()} />;

  const { analysis, feedback, ready, can_edit: canEdit } = q.data;
  const running = analysis?.status === "queued" || analysis?.status === "running";
  const data = analysis?.status === "done" || (analysis?.data && Object.keys(analysis.data).length) ? (analysis!.data as XData) : null;
  const start = () => actions.start.mutate();

  const Header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h2 className="font-display text-2xl font-semibold">Research Gap Explorer</h2>
        <p className="mt-1 text-sm text-ink-soft">Related work, comparison, gaps and ideas for your paper.</p>
      </div>
      {ready && canEdit && analysis && !running && (
        <Button variant="secondary" loading={actions.start.isPending} onClick={start}><ArrowsClockwise size={16} /> Refresh analysis</Button>
      )}
    </div>
  );

  if (!ready) {
    return (
      <div className="space-y-5">{Header}
        <EmptyState title="Paper not analysed yet" body="Let the research step finish first."
          action={<Button asChild variant="purple"><Link href={`/workspaces/${workspaceId}/run/${runId}`}>Open the workflow</Link></Button>} />
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="space-y-5">{Header}
        <Card variant="bento" className="space-y-3 p-6">
          <p className="font-display text-lg font-semibold">Ready to explore “{ws.data?.title}”</p>
          <p className="text-sm text-ink-soft">Searches Semantic Scholar, OpenAlex, Crossref and arXiv. Takes 1 to 3 minutes.</p>
          {canEdit ? <Button variant="purple" size="lg" loading={actions.start.isPending} onClick={start}>Start analysis</Button> : <p className="text-sm font-semibold text-muted">View only.</p>}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {Header}
      {running && (
        <Card variant="bento" className="flex items-center gap-3 p-4" role="status" aria-live="polite">
          <Spinner className="h-5 w-5" />
          <div><p className="font-semibold">Analysing</p><p className="text-sm text-ink-soft">{analysis.stage || "Working"}</p></div>
        </Card>
      )}
      {analysis.status === "failed" && (
        <Card variant="bento" className="space-y-2 border-danger/40 p-4" role="alert">
          <p className="flex items-center gap-2 font-semibold text-danger"><WarningCircle size={18} weight="fill" /> Analysis failed</p>
          <p className="text-sm text-ink-soft">{analysis.error || "Something went wrong."}</p>
          {canEdit && <Button variant="purple" size="sm" loading={actions.start.isPending} onClick={start}>Try again</Button>}
        </Card>
      )}

      {data?.papers?.length ? (
        <>
          {!!data.warnings?.length && (
            <details className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-warning">{data.warnings.length} note{data.warnings.length === 1 ? "" : "s"}</summary>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink-soft">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}
          <p className="text-xs text-muted">{data.limits.papers_found} papers from {data.limits.sources.join(", ")}{analysis.finished_at ? `, updated ${formatDateTime(analysis.finished_at)}` : ""}</p>

          <div role="tablist" aria-label="Explorer views" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-clay-sm">
            {VIEWS.map(({ key, label, short, Icon }) => (
              <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)} title={label}
                className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold", view === key ? "bg-pill text-white" : "text-ink-soft hover:text-ink")}>
                <Icon size={16} weight={view === key ? "fill" : "regular"} /> <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span>
                {key === "gaps" && <span className="text-xs opacity-70">{data.gaps?.length ?? 0}</span>}
                {key === "recommendations" && <span className="text-xs opacity-70">{data.recommendations?.length ?? 0}</span>}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-label={VIEWS.find((v) => v.key === view)?.label}>
            {view === "timeline" && <TimelineView data={data} />}
            {view === "comparison" && <ComparisonView comparison={data.comparison} papers={data.papers} />}
            {view === "gaps" && <GapsView data={data} feedback={feedback} canEdit={canEdit} actions={actions} />}
            {view === "recommendations" && <RecommendationsView data={data} feedback={feedback} canEdit={canEdit} actions={actions} />}
          </div>
        </>
      ) : !running && analysis.status === "done" ? (
        <EmptyState title="Nothing to show" body="No related research found." />
      ) : null}
    </div>
  );
}
