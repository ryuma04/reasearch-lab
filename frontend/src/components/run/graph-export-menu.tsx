"use client";

import * as React from "react";
import { BracketsCurly, CaretDown, DownloadSimple, FileImage, FileSvg } from "@phosphor-icons/react";
import type { ResearchMap } from "@/lib/api/types";
import { buildGraphFile, downloadBlob, type GraphFormat } from "@/lib/workflow/graph-export";
import { toast } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const OPTIONS: { f: GraphFormat; label: string; hint: string; Icon: React.ElementType }[] = [
  { f: "svg", label: "SVG (vector image)", hint: "Opens in any browser or editor; source cards link to their papers", Icon: FileSvg },
  { f: "png", label: "PNG (image)", hint: "High-resolution picture of the whole graph", Icon: FileImage },
  { f: "json", label: "JSON (data)", hint: "Nodes, relationships, source URLs and metadata", Icon: BracketsCurly },
];

/** Exports the WHOLE current graph (not only the visible viewport). Reports success only after the file exists. */
export function GraphExportMenu({ map }: { map: ResearchMap }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<GraphFormat | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const run = async (f: GraphFormat) => {
    if (busy) return;
    setBusy(f);
    try {
      const { blob, name } = await buildGraphFile(map, f);
      downloadBlob(blob, name);
      toast.success("Graph exported", `${name} · ${map.nodes.length} nodes, ${map.edges.length} links`);
      setOpen(false);
    } catch (e) {
      toast.error("Graph export failed", e instanceof Error ? e.message : "Something went wrong while building the file.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!map.nodes.length}
        className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-canvas disabled:opacity-50">
        <DownloadSimple size={15} /> Export <CaretDown size={11} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" aria-label="Export the graph" className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-line bg-white p-1.5 shadow-clay">
          {OPTIONS.map(({ f, label, hint, Icon }) => (
            <button key={f} role="menuitem" type="button" disabled={busy !== null} onClick={() => void run(f)}
              className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-lavender-soft disabled:opacity-60">
              {busy === f ? <span className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-purple border-r-transparent" aria-label="Preparing" /> : <Icon size={18} className="mt-0.5 text-purple-deep" />}
              <span><span className="block text-sm font-semibold">{busy === f ? "Preparing…" : label}</span><span className="block text-[11px] text-muted">{hint}</span></span>
            </button>
          ))}
          <p className="px-3 pb-1.5 pt-1 text-[11px] text-muted">Exports all {map.nodes.length} nodes, not just the visible area.</p>
        </div>
      )}
    </div>
  );
}
