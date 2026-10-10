"use client";

import { useParams } from "next/navigation";
import { useSelectedRun } from "@/components/run/workspace-header";
import { EmptyState } from "@/components/ui/states";
import { HuggingFacePublish } from "@/components/publish/huggingface-publish";

/** Checkpoint 2: the researcher confirms before anything is uploaded to the Hugging Face Hub. */
export default function PublishPage() {
  const { id } = useParams<{ id: string }>();
  const { runId } = useSelectedRun(id);
  if (!runId) return <EmptyState title="No run to publish" />;
  return <div className="mx-auto max-w-3xl space-y-5"><HuggingFacePublish runId={runId} /></div>;
}
