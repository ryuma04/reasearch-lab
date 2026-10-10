"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DownloadSimple, FileText, WarningCircle } from "@phosphor-icons/react";
import { versionApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { qk, usePaper } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/states";
import { CopyButton } from "@/components/ui/content";
import { toast } from "@/components/ui/overlays";

/** Markdown with Mermaid blocks shown as copyable diagram source (no diagram library is installed). */
function Doc({ markdown }: { markdown: string }) {
  return (
    <article className="prose-sm max-w-none space-y-2 text-sm [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_table]:w-full [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft">
      <ReactMarkdown
        components={{
          code({ className, children }) {
            const text = String(children).replace(/\n$/, "");
            if (className?.includes("language-mermaid")) {
              return <span className="block rounded-xl bg-canvas p-3"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Diagram source (Mermaid)</span><code className="block whitespace-pre font-mono text-xs">{text}</code></span>;
            }
            return <code className={cn("font-mono text-[12px]", className)}>{children}</code>;
          },
        }}
      >{markdown}</ReactMarkdown>
    </article>
  );
}

/** Research-paper materials for one version: generate, read section by section, copy and download. */
export function PaperWorkspace({ runId }: { runId: string }) {
  const q = usePaper(runId);
  const qc = useQueryClient();
  const [key, setKey] = React.useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => versionApi.generatePaper(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.paper(runId) }),
    onError: (e) => toast.error("Couldn't start the materials", userMessage(e)),
  });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error || !q.data) return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the paper materials: {userMessage(q.error)}</p>;
  const p = q.data;
  const busy = p.status === "queued" || p.status === "generating" || gen.isPending;
  const section = p.sections.find((s) => s.key === key) ?? p.sections[0];
  const missing = Object.entries(p.manifest?.missing ?? {});
  const download = () => {
    const blob = new Blob([p.sections.map((s) => s.markdown).join("\n\n---\n\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `research-paper-materials-run-${p.run_id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold">Research paper materials</p>
          <p className="text-sm text-ink-soft">Version run #{p.run_id}. An evidence pack assembled from this version&apos;s recorded artifacts to help you write your own paper.</p>
        </div>
        <Button variant="purple" loading={busy} onClick={() => gen.mutate()} disabled={busy}>
          <FileText size={16} /> {p.status === "none" ? "Prepare Research Paper Materials" : "Regenerate"}
        </Button>
        {p.sections.length > 0 && <Button variant="outline" onClick={download}><DownloadSimple size={16} /> Download (.md)</Button>}
      </div>

      {p.status === "none" && <p className="rounded-2xl bg-canvas p-4 text-sm text-muted">Nothing has been generated for this version yet. Generation uses only what was recorded for it and never invents results or citations.</p>}
      {busy && <p role="status" className="text-sm text-muted">Generating the materials…</p>}
      {p.status === "failed" && <p role="alert" className="text-sm font-semibold text-danger">Generation failed: {p.error || "unknown error"}</p>}
      {p.stale && <p role="alert" className="flex items-start gap-2 rounded-2xl bg-warning-soft p-3 text-sm"><WarningCircle size={18} className="mt-0.5 shrink-0 text-warning" /> This version changed after the materials were generated. Regenerate to refresh them.</p>}
      {p.status === "partial" && missing.length > 0 && (
        <div role="status" className="rounded-2xl bg-warning-soft p-3 text-sm"><p className="font-semibold">Partial package: some material is missing from this version&apos;s records.</p>
          <ul className="list-disc pl-5">{missing.map(([k, v]) => <li key={k}><b>{k}</b>: {v.join(", ")}</li>)}</ul></div>
      )}

      {p.sections.length > 0 && section && (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Sections" className="flex gap-2 overflow-x-auto lg:flex-col">
            {p.sections.map((s) => (
              <button key={s.key} type="button" onClick={() => setKey(s.key)} aria-current={section.key === s.key ? "page" : undefined}
                className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold", section.key === s.key ? "bg-pill text-white" : "bg-white text-ink-soft shadow-clay-sm")}>
                <span>{s.title}</span>
                {p.manifest?.completeness?.[s.key] === "partial" && <Badge tone="sun">partial</Badge>}
              </button>
            ))}
          </nav>
          <div className="rounded-2xl border border-line-cool bg-white p-5">
            <div className="mb-2 flex justify-end"><CopyButton text={section.markdown} /></div>
            <Doc markdown={section.markdown} />
            {p.manifest?.generated_at && <p className="mt-4 text-xs text-muted">Generated {p.manifest.generated_at} from run #{p.run_id}. {p.manifest.method}.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
