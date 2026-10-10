"use client";

import * as React from "react";
import { useChangeOfRun } from "@/lib/hooks/queries";

const List = ({ title, items }: { title: string; items?: string[] }) =>
  items && items.length ? <div><p className="text-xs font-bold uppercase tracking-wider text-muted">{title}</p><ul className="list-disc pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul></div> : null;

/** For a version created from a change request: the request and what the analysis decided. Renders nothing for an original run. */
export function ChangeBanner({ runId }: { runId: string }) {
  const q = useChangeOfRun(runId);
  const ch = q.data;
  if (!ch) return null;
  const a = ch.analysis ?? {};
  return (
    <section className="space-y-3 rounded-2xl bg-lavender-soft p-4" aria-label="Change request">
      <p className="font-display text-lg font-bold">This is a new version of run #{ch.source_run_id}</p>
      <p className="text-sm">Your request: “{ch.request}”</p>
      {ch.status === "analyzing" ? <p className="text-sm text-muted">The analysis is still running…</p> : (
        <>
          {a.intent && <p className="text-sm"><b>Understood as:</b> {a.intent}</p>}
          {a.source === "fallback" && <p role="alert" className="text-sm font-semibold text-warning">No AI model answered, so this analysis is a placeholder. Read the plan carefully before approving.</p>}
          {a.ambiguity && <p role="alert" className="rounded-xl bg-warning-soft p-2 text-sm font-semibold">Your request is ambiguous: {a.ambiguity}{a.clarifying_question ? ` ${a.clarifying_question}` : ""} Reject the plan and submit a clearer request if this is not what you meant.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <List title="Stays the same" items={a.unchanged} /><List title="Modified" items={a.modified} />
            <List title="Added" items={a.added} /><List title="Removed" items={a.removed} />
            <List title="Research still valid" items={a.research?.still_valid} /><List title="Research to verify or redo" items={[...(a.research?.needs_verification ?? []), ...(a.research?.superseded ?? [])]} />
            <List title="Tests to add or re-run" items={a.tests_to_add_or_rerun} /><List title="Risks" items={a.risks} />
          </div>
          {a.isolation && <p className="text-xs text-muted">This version has its own copy of the code ({a.isolation.files_copied} files). The original version is {a.isolation.source_unchanged ? "unchanged (verified by a fingerprint taken before and after the copy)" : "NOT confirmed unchanged"}.</p>}
        </>
      )}
    </section>
  );
}
