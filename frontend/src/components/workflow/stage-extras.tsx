"use client";

import * as React from "react";
import type { RunStatus } from "@/lib/api/types";
import { useHealSessions } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { CodeSandbox } from "@/components/sandbox/code-sandbox";
import { HealPanel } from "@/components/sandbox/heal-panel";
import { ExplorerPage } from "@/components/explorer/explorer-page";
import { Card, SectionTitle } from "@/components/ui/primitives";
import MapPage from "@/app/(app)/workspaces/[id]/map/page";
import ReplayPage from "@/app/(app)/workspaces/[id]/replay/page";
import PublishPage from "@/app/(app)/workspaces/[id]/publish/page";

/* Existing workspace features shown inside the run's workflow steps. Nothing is rebuilt here:
   each section renders the same component the workspace tab uses, for this run. */

/** Coding step: the code sandbox (files, editor, Run Experiment, output). */
export function CodingExtras({ runId, runStatus }: { runId: string; runStatus: RunStatus | null }) {
  return (
    <section className="mt-6 space-y-3">
      <SectionTitle title="Code sandbox" />
      <CodeSandbox runId={runId} runStatus={runStatus} />
    </section>
  );
}

/** Debugging step: every Self-Healing Debugger session with its error, explanation, diff and tests. */
export function DebuggingExtras({ runId }: { runId: string }) {
  const heal = useHealSessions(runId);
  return (
    <section className="mt-6 space-y-3">
      <SectionTitle title="Fixes" />
      <Card variant="bento" className="overflow-hidden">
        <HealPanel sessions={heal.data ?? []} loading={heal.isPending} error={heal.error} />
      </Card>
    </section>
  );
}

const RESULT_VIEWS = [
  { key: "explorer", label: "Gap Explorer" },
  { key: "map", label: "Research map" },
  { key: "replay", label: "Replay" },
  { key: "publish", label: "Publish" },
] as const;

/** Results step: Gap Explorer, Research map, Replay and Publish for this run. */
export function ResultsExtras({ workspaceId }: { workspaceId: string }) {
  const [view, setView] = React.useState<(typeof RESULT_VIEWS)[number]["key"]>("explorer");
  return (
    <section className="mt-6 space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-clay-sm" role="tablist" aria-label="More results">
        {RESULT_VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={cn("inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold", view === v.key ? "bg-pill text-white" : "text-ink-soft hover:text-ink")}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "explorer" && <ExplorerPage workspaceId={workspaceId} />}
      {view === "map" && <MapPage />}
      {view === "replay" && <ReplayPage />}
      {view === "publish" && <PublishPage />}
    </section>
  );
}
