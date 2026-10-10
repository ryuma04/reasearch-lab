"use client";

import { useParams } from "next/navigation";
import { Code } from "@phosphor-icons/react";
import { useSelectedRun } from "@/components/run/workspace-header";
import { CodeSandbox } from "@/components/sandbox/code-sandbox";
import { EmptyState, Skeleton } from "@/components/ui/states";

export default function SandboxPage() {
  const { id } = useParams<{ id: string }>();
  const { ws, runId, run } = useSelectedRun(id);
  if (ws.isPending) return <Skeleton className="h-[60vh]" />;
  if (!runId) {
    return (
      <EmptyState
        icon={<Code size={34} weight="duotone" className="text-purple-deep" />}
        title="No run yet"
        body="Start a run from the Overview tab."
      />
    );
  }
  return <CodeSandbox key={runId} runId={runId} runStatus={run?.status ?? null} />;
}
