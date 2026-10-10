"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { versionApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/states";
import { useVersions } from "@/lib/hooks/queries";

const num = (v: number | null) => (v == null ? "not measured" : String(+v.toFixed(4)));

function DiffBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-xl bg-[#14121f] p-3 font-mono text-[12px] leading-5" aria-label="Code differences">
      {lines.map((l, i) => (
        <div key={i} className={cn("whitespace-pre-wrap", l.startsWith("+ ") && "bg-[#1f3d2a] text-[#b5f5c8]", l.startsWith("- ") && "bg-[#4a1f28] text-[#ffb3bd]",
          l.startsWith("@@") && "text-[#8f8aa8]", !l.startsWith("+ ") && !l.startsWith("- ") && !l.startsWith("@@") && "text-[#cfcbe0]")}>{l}</div>
      ))}
    </pre>
  );
}

/** Old (left version) against new (right version): the real code differences, recorded metrics, scorecard and plan. */
export function CompareView({ workspaceId, from, to }: { workspaceId: string; from: string; to: string }) {
  const versions = useVersions(from);
  const label = (id: string) => versions.data?.find((v) => String(v.run_id) === id)?.label ?? `run #${id}`;
  const q = useQuery({ queryKey: ["compare", from, to], queryFn: ({ signal }) => versionApi.compare(from, to, signal), enabled: !!from && !!to && from !== to });
  if (from === to) return <p className="text-sm text-muted">Pick two different versions to compare.</p>;
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <p role="alert" className="text-sm text-danger">Couldn&apos;t compare these versions: {userMessage(q.error)}</p>;
  const c = q.data;
  const sc = (o: Record<string, number>) => ["match", "close", "different", "missing"].map((k) => `${o?.[k] ?? 0} ${k}`).join(" · ");
  return (
    <div className="space-y-5" data-workspace={workspaceId}>
      <Card variant="bento" className="space-y-2 p-4">
        <p className="font-display text-lg font-bold">{label(from)} (old) → {label(to)} (new)</p>
        {c.change && <p className="text-sm text-ink-soft">Change requested: “{c.change.request}”</p>}
        <p className="text-xs text-muted">{c.note}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="faint">{label(from)}: {c.old.status}</Badge><Badge tone="faint">{label(to)}: {c.new.status}</Badge>
          {c.new.error && <span className="text-danger">{c.new.error}</span>}
        </div>
      </Card>

      <section aria-label="Code changes" className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Code: old and new ({c.files.length} file{c.files.length === 1 ? "" : "s"} differ)</h2>
        {c.files.length === 0 && <p className="rounded-2xl bg-canvas p-3 text-sm text-muted">The two versions have identical code.</p>}
        {c.files.map((f) => (
          <details key={f.path} className="rounded-2xl border border-line-cool p-3" open={c.files.length <= 3}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold">
              <span className="font-mono">{f.path}</span>
              <Badge tone={f.status === "added" ? "mint" : f.status === "removed" ? "coral" : "sun"}>{f.status}</Badge>
              <span className="text-xs text-muted">+{f.added} −{f.removed}</span>
            </summary>
            <div className="mt-2">{f.diff ? <DiffBlock lines={f.diff} /> : <p className="text-sm text-muted">{f.note ?? "No inline diff available."}</p>}</div>
          </details>
        ))}
        {Object.keys(c.skipped).length > 0 && <p className="text-xs text-muted">Not compared: {Object.entries(c.skipped).map(([p, why]) => `${p} (${why})`).join(", ")}.</p>}
      </section>

      <section aria-label="Results" className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Recorded results</h2>
        {c.metrics.length ? (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th>Metric</th><th>{label(from)}</th><th>{label(to)}</th></tr></thead>
            <tbody>{c.metrics.map((m) => <tr key={m.name} className="border-t border-line-cool"><td className="py-1 font-mono">{m.name}</td><td>{num(m.old)}</td><td>{num(m.new)}</td></tr>)}</tbody></table>
        ) : <p className="text-sm text-muted">Neither version has recorded metrics.</p>}
        <p className="text-sm">Claims: {label(from)} {sc(c.scorecard.old)} · {label(to)} {sc(c.scorecard.new)}</p>
      </section>

      <section aria-label="Plan changes" className="space-y-1">
        <h2 className="font-display text-lg font-semibold">Plan</h2>
        {(c.plan.added ?? []).length === 0 && (c.plan.removed ?? []).length === 0 ? <p className="text-sm text-muted">No difference in the approved plans&apos; tasks was recorded.</p> : (
          <ul className="list-disc pl-5 text-sm">
            {(c.plan.added ?? []).map((t) => <li key={"a" + t}><b>Added:</b> {t}</li>)}
            {(c.plan.removed ?? []).map((t) => <li key={"r" + t}><b>Removed:</b> {t}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
