"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSelectedRun } from "@/components/run/workspace-header";
import { useVersions } from "@/lib/hooks/queries";
import { CompareView } from "@/components/versions/compare-view";
import { VersionList } from "@/components/versions/version-list";
import { EmptyState, Skeleton } from "@/components/ui/states";

/** Versions of the workspace and an old-versus-new comparison of their real code and results (?from=&to=). */
export default function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const { runId } = useSelectedRun(id);
  const versions = useVersions(runId);
  const list = versions.data ?? [];
  const from = sp.get("from") ?? (list.length > 1 ? String(list[0]!.run_id) : "");
  const to = sp.get("to") ?? (list.length > 1 ? String(list[list.length - 1]!.run_id) : "");
  const set = (k: "from" | "to", v: string) => {
    const q = new URLSearchParams({ from, to, [k]: v });
    router.replace(`/workspaces/${id}/compare?${q.toString()}`);
  };
  if (!runId) return <EmptyState title="No version to show" />;
  if (versions.isPending) return <Skeleton className="h-64" />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="space-y-2"><h2 className="font-display text-xl font-bold">Versions</h2><VersionList runId={runId} workspaceId={id} /></section>
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Compare old and new</h2>
        {list.length < 2 ? <p className="rounded-2xl bg-canvas p-4 text-sm text-muted">There is only one version so far. Use Request Changes on a finished version to create another.</p> : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {([["Old", "from"], ["New", "to"]] as const).map(([label, k]) => (
                <label key={k} className="flex items-center gap-2 font-semibold">{label}
                  <select className="rounded-xl border border-line bg-white px-3 py-2 font-normal" value={k === "from" ? from : to} onChange={(e) => set(k, e.target.value)}>
                    {list.map((v) => <option key={v.run_id} value={String(v.run_id)}>{v.label} (run #{v.run_id})</option>)}
                  </select>
                </label>
              ))}
            </div>
            {from && to && <CompareView workspaceId={id} from={from} to={to} />}
          </>
        )}
      </section>
    </div>
  );
}
