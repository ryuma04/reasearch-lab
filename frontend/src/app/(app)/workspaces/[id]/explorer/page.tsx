"use client";

import { useParams } from "next/navigation";
import { ExplorerPage } from "@/components/explorer/explorer-page";

/** Research Gap Explorer for a workspace's analysed paper. Independent of the research workflow. */
export default function WorkspaceExplorerPage() {
  const { id } = useParams<{ id: string }>();
  return <ExplorerPage workspaceId={id} />;
}
