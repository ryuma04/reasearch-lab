"use client";

import { useParams } from "next/navigation";
import { ExplainerStudio } from "@/components/explainer/explainer-studio";

/** Paper-to-Video Explainer for the workspace's papers (independent of runs). */
export default function ExplainerVideoPage() {
  const { id } = useParams<{ id: string }>();
  return <ExplainerStudio workspaceId={id} />;
}
