"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAgentHistory, useAgents } from "@/lib/hooks/queries";
import { agentStageMeta } from "@/lib/status";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { QueryView, Skeleton, ErrorState } from "@/components/ui/states";
import { Sheet } from "@/components/ui/overlays";

function TeamInner() {
  const agents = useAgents();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get("agent");
  const history = useAgentHistory(sel);
  return (
    <div className="space-y-6">
      <SectionTitle kicker="Evolving team" title="Agents, scores & evolution" />
      <p className="max-w-2xl text-sm text-muted">The team is dynamic: the Team Manager creates specialists when a skill is missing, and refines, merges, replaces or retires agents. Score = 0.5·outcome + 0.2·feedback − 0.2·cost − 0.1·wasted tries.</p>
      <QueryView query={agents} feature="Agent team" isEmpty={(a) => !a.length}>
        {(list) => (
          <>
            <Card className="p-5">
              <p className="font-display font-bold">Average score by agent</p>
              <div className="mt-3 h-[220px]">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={list.filter((a) => a.avg_score != null).map((a) => ({ name: a.name, score: a.avg_score }))}>
                    <CartesianGrid stroke="#eef1f6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} height={50} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={30} />
                    <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e3e7ef", boxShadow: "0 8px 24px -12px rgba(28,27,43,.25)", fontSize: 12 }} cursor={{ fill: "#f5f1e8" }} />
                    <Bar dataKey="score" fill="#7b5cf0" radius={[8, 8, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <button key={a.id} className="text-left" onClick={() => router.replace(`/team?agent=${encodeURIComponent(a.id)}`)}>
                  <Card interactive className="h-full p-5">
                    <div className="flex items-center justify-between gap-2"><p className="font-bold">{a.name}</p><Badge tone={agentStageMeta[a.stage].tone} solid>{agentStageMeta[a.stage].label}</Badge></div>
                    <p className="mt-1 text-xs text-muted">{a.kind}{a.task_count != null ? ` · ${a.task_count} tasks` : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{a.current_version?.skill_tags.map((s) => <Badge key={s} tone="sky">{s}</Badge>)}</div>
                    {a.current_version?.created_reason && <p className="mt-2 text-xs text-ink-soft">Why: {a.current_version.created_reason}</p>}
                    <p className="tabular mt-3 font-display text-2xl font-bold">{a.avg_score != null ? a.avg_score.toFixed(2) : "—"}</p>
                  </Card>
                </button>
              ))}
            </div>
          </>
        )}
      </QueryView>
      <Sheet open={!!sel} onOpenChange={(o) => !o && router.replace("/team")} title={history.data?.agent.name ?? "Agent history"} description="Versions, tasks and team decisions">
        {history.isPending ? <Skeleton className="h-60" /> : history.error ? <ErrorState error={history.error} title="Agent history" onRetry={() => void history.refetch()} /> : history.data && (
          <div className="space-y-5 text-sm">
            <section><p className="font-bold">Team Evolution timeline</p>
              <ol className="mt-2 space-y-2 border-l-4 border-ink/10 pl-4">{history.data.decisions.length ? history.data.decisions.map((d) => (
                <li key={d.id}><Badge tone="lavender" solid>{d.decision}</Badge> <span className="text-xs text-muted">{formatDateTime(d.created_at)}</span><p className="mt-1">{d.reason}</p></li>
              )) : <li className="text-muted">No decisions recorded.</li>}</ol></section>
            <section><p className="font-bold">Versions</p>{history.data.versions.map((v) => <div key={v.id} className="mt-2 rounded-2xl bg-canvas p-3"><p className="font-mono text-xs">{v.id} · {v.model}</p><p className="mt-1">{v.instructions}</p>{v.created_reason && <p className="mt-1 text-xs text-muted">Reason: {v.created_reason}</p>}</div>)}</section>
            <section><p className="font-bold">Recent tasks</p>
              <table className="mt-2 w-full text-xs"><thead className="text-left text-muted"><tr><th className="py-1">Skill</th><th>Score</th><th>Tokens</th><th>Feedback</th></tr></thead>
                <tbody>{history.data.tasks.map((t) => <tr key={t.id} className="border-t border-line"><td className="py-1.5">{t.skill}</td><td className="tabular">{t.score?.toFixed(2) ?? "—"}</td><td className="tabular">{formatNumber(t.tokens)}</td><td>{t.feedback === 1 ? "👍" : t.feedback === -1 ? "👎" : "—"}</td></tr>)}</tbody></table></section>
          </div>
        )}
      </Sheet>
    </div>
  );
}

export default function TeamPage() {
  return <React.Suspense><TeamInner /></React.Suspense>;
}
