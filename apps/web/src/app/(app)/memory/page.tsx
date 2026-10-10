"use client";

import * as React from "react";
import { MagnifyingGlass, Brain } from "@phosphor-icons/react";
import { useMemorySearch } from "@/lib/hooks/queries";
import { Badge, Card, Input, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, QueryView } from "@/components/ui/states";

export default function MemoryPage() {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const res = useMemorySearch(q);
  return (
    <div className="space-y-6">
      <SectionTitle kicker="Lab Memory" title="What the lab has learned" />
      <div className="relative max-w-2xl">
        <MagnifyingGlass size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <Input className="rounded-full pl-11" placeholder="Search by meaning — e.g. “numpy import error”, “quick budget MNIST”" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search Lab Memory" />
      </div>
      {q.length < 2 ? (
        <EmptyState title="Search the Lab Memory" body="Errors and their fixes, settings that worked, agent skills, and every past experiment." icon={<Brain size={34} weight="duotone" className="text-purple-deep" />} />
      ) : (
        <QueryView query={res} feature="Memory search" isEmpty={(r) => !r.length} empty={<EmptyState title="No matching memories" />}>
          {(items) => (
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((m) => (
                <Card key={m.id} variant="bento" className="p-4">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone="lavender" solid>{m.kind.replace("_", " ")}</Badge>{m.similarity != null && <Badge>{Math.round(m.similarity * 100)}% match</Badge>}<Badge tone="sky">used {m.times_used}×</Badge>{m.success_rate != null && <Badge tone="mint">{Math.round(m.success_rate * 100)}% success</Badge>}</div>
                  <p className="mt-2 font-semibold">{m.text}</p>
                  <p className="mt-1 text-xs text-muted">Provenance: {m.source_run_id ? `learned in run ${m.source_run_id}` : "unknown run"} — retrieved memory, not a measurement from the current run.</p>
                </Card>
              ))}
            </div>
          )}
        </QueryView>
      )}
    </div>
  );
}
