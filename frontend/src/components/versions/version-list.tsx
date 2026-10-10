"use client";

import * as React from "react";
import Link from "next/link";
import { GitBranch } from "@phosphor-icons/react";
import { useVersions } from "@/lib/hooks/queries";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/states";
import { runStatusMeta } from "@/lib/status";

/** Every version of the workspace: its own status, the request that created it, and links to open or compare it. */
export function VersionList({ runId, workspaceId }: { runId: string; workspaceId: string }) {
  const q = useVersions(runId);
  const base = `/workspaces/${workspaceId}`;
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.error || !q.data) return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the versions.</p>;
  const versions = q.data;
  return (
    <ol className="space-y-2" aria-label="Versions">
      {versions.map((v) => {
        const id = String(v.run_id);
        const st = runStatusMeta[v.status as keyof typeof runStatusMeta];
        const here = id === runId;
        return (
          <li key={id}>
            <Card variant="bento" className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch size={16} className="text-purple-deep" />
                <span className="font-display font-bold">{v.label}</span>
                <span className="text-xs text-muted">run #{id}{v.parent_run_id ? ` · from run #${v.parent_run_id}` : ""}</span>
                <Badge tone={st?.tone ?? "faint"} solid>{st?.label ?? v.status}</Badge>
                {here && <Badge tone="lavender">Viewing</Badge>}
              </div>
              {v.change ? <p className="text-sm text-ink-soft">“{v.change}”</p> : <p className="text-sm text-muted">The original run.</p>}
              {v.status === "failed" && v.error && <p className="text-xs text-danger">{v.error}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="secondary"><Link href={`${base}/run/${id}`}>Open</Link></Button>
                <Button asChild size="sm" variant="secondary"><Link href={`${base}/results/research?run=${id}`}>Results</Link></Button>
                {!here && <Button asChild size="sm" variant="outline"><Link href={`${base}/compare?from=${runId}&to=${id}`}>Compare with the one I&apos;m viewing</Link></Button>}
                <Button asChild size="sm" variant="ghost"><Link href={`${base}/paper?run=${id}`}>Paper materials</Link></Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
