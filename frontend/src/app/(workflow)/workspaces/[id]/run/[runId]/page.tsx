"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { WorkflowShell } from "@/components/workflow/workflow-shell";
import { Skeleton } from "@/components/ui/states";

/** The dedicated workflow tab. All state is loaded from the backend by workspace + run id, so a refresh restores it. */
export default function RunWorkflowPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}>
      <WorkflowShell workspaceId={id} runId={runId} />
    </Suspense>
  );
}
