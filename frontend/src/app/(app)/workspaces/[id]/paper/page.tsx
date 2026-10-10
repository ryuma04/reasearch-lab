"use client";

import { useParams } from "next/navigation";
import { useSelectedRun } from "@/components/run/workspace-header";
import { PaperWorkspace } from "@/components/versions/paper-workspace";
import { EmptyState } from "@/components/ui/states";

/** Research-paper materials for the selected version (?run=). */
export default function PaperPage() {
  const { id } = useParams<{ id: string }>();
  const { runId } = useSelectedRun(id);
  if (!runId) return <EmptyState title="No version selected" body="Open a finished version to prepare its research-paper materials." />;
  return <div className="mx-auto max-w-6xl"><PaperWorkspace runId={runId} /></div>;
}
