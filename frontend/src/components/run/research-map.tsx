"use client";

import * as React from "react";
import {
  ArrowsOut, Article, Brain, Code, Database, Flask, GitBranch, Graph, ListBullets, MagnifyingGlass,
  Minus, Plus, Quotes, Robot, Target, TestTube,
} from "@phosphor-icons/react";
import type { MapNode, ResearchMap } from "@/lib/api/types";
import {
  CARD_H, CARD_W, STATUS, edgePath, layout, type LNode,
} from "@/lib/workflow/graph-layout";
import { cn } from "@/lib/utils";
import { GraphExportMenu } from "./graph-export-menu";

/**
 * Research Map (Hero 7), drawn from the Observer's graph (GET /runs/{id}/map).
 *
 * Nodes are grouped into stage frames laid out left → right in pipeline order (Paper & claims →
 * Sources & data → Code → Tests → Results), with the agents in a frame underneath. Edges are
 * curved connectors between card sides. Edges the agents reported are solid; edges implied by
 * the fixed pipeline (e.g. the Paper Reader produced the claims) are dotted. Pan by dragging,
 * zoom with the wheel or the buttons, jump around with the minimap, click a card to focus its
 * connections.
 */

const KIND_ICON: Record<string, React.ElementType> = {
  paper: Article, related: Article, claim: Quotes, source: GitBranch, dataset: Database, code: Code, file: Code, note: Code, test: TestTube,
  result: Target, experiment: Flask, whatif: Flask, gap: MagnifyingGlass, agent: Robot,
};


export function ResearchMapView({ map, onSelect, selected }: { map: ResearchMap; onSelect?: (n: MapNode) => void; selected?: string | null }) {
  const L = React.useMemo(() => layout(map), [map]);
  const [view, setView] = React.useState<"graph" | "list">("graph");
  const [query, setQuery] = React.useState("");
  const [focus, setFocus] = React.useState<string | null>(null);
  const [tf, setTf] = React.useState({ x: 0, y: 0, k: 1 });
  const box = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const fit = React.useCallback(() => {
    const el = box.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const k = Math.min(1.1, Math.max(0.2, Math.min((w - 60) / L.width, (h - 60) / L.height)));
    setTf({ k, x: (w - L.width * k) / 2, y: (h - L.height * k) / 2 });
  }, [L.width, L.height]);
  // Fit on first render, when the layout changes, and whenever the canvas is resized.
  React.useEffect(() => {
    fit();
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, view]);

  // Wheel zoom around the cursor (non-passive so the page does not scroll).
  React.useEffect(() => {
    const el = box.current;
    if (!el || view !== "graph") return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      setTf((t) => {
        const k = Math.min(2.5, Math.max(0.15, t.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
        return { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view]);

  const zoomBy = (f: number) => {
    const el = box.current;
    if (!el) return;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setTf((t) => {
      const k = Math.min(2.5, Math.max(0.15, t.k * f));
      return { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k };
    });
  };

  const q = query.trim().toLowerCase();
  const matches = (n: LNode) => !q || n.label.toLowerCase().includes(q) || n.kindRaw.includes(q);
  const active = focus ?? selected ?? null;
  const near = React.useMemo(() => {
    if (!active) return null;
    const s = new Set([active]);
    for (const e of L.edges) {
      if (e.from === active) s.add(e.to);
      if (e.to === active) s.add(e.from);
    }
    return s;
  }, [active, L.edges]);
  const dim = (id: string) => (near ? !near.has(id) : false);

  const choose = (n: LNode) => {
    setFocus((f) => (f === n.id ? null : n.id));
    onSelect?.(n);
  };

  // Minimap geometry.
  const MM_W = 150;
  const mmK = MM_W / Math.max(L.width, 1);
  const MM_H = Math.max(60, L.height * mmK);
  const vp = box.current
    ? { x: -tf.x / tf.k, y: -tf.y / tf.k, w: box.current.clientWidth / tf.k, h: box.current.clientHeight / tf.k }
    : null;

  return (
    <div className="overflow-hidden rounded-[28px] border-2 border-ink bg-[#fbfaf6] shadow-pop-lg">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-cool bg-white/80 px-3 py-2">
        <div className="flex rounded-full bg-canvas p-1">
          {([["graph", "Graph", Graph], ["list", "List", ListBullets]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold", view === k ? "bg-ink text-white" : "text-ink-soft hover:bg-white")}>
              <Icon size={15} weight="bold" /> {label}
            </button>
          ))}
        </div>
        <label className="flex min-w-[160px] flex-1 items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm sm:max-w-xs">
          <MagnifyingGlass size={15} className="text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the map…" aria-label="Search the map" className="w-full bg-transparent outline-none" />
        </label>
        {focus && <button type="button" onClick={() => setFocus(null)} className="rounded-full bg-lavender-soft px-3 py-1.5 text-sm font-semibold text-purple-deep">Clear focus</button>}
        <span className="ml-auto text-xs text-muted">{L.nodes.length} items · {L.edges.filter((e) => !e.implied).length} links reported · {L.edges.filter((e) => e.implied).length} implied</span>
        <GraphExportMenu map={map} />
      </div>

      {view === "list" ? (
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {L.frames.map((f) => (
            <div key={f.def.key} className="rounded-2xl border p-3" style={{ background: f.def.tint, borderColor: f.def.border }}>
              <p className="text-sm font-bold">{f.def.title} <span className="font-normal text-muted">· {f.count}</span></p>
              <ul className="mt-2 space-y-1.5">
                {L.nodes.filter((n) => n.group === f.def.key && matches(n)).map((n) => {
                  const Icon = KIND_ICON[n.kindRaw] ?? Brain;
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => onSelect?.(n)} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm shadow-sm hover:ring-2 hover:ring-lavender">
                        <Icon size={16} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate font-medium">{n.label}</span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS[n.status].dot }} title={n.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div ref={box} className="relative h-[68vh] min-h-[420px] cursor-grab touch-none bg-dots-cool active:cursor-grabbing"
          onPointerDown={(e) => {
            if ((e.target as Element).closest("[data-card]")) return;
            drag.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setTf((t) => ({ ...t, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y }));
          }}
          onPointerUp={() => { drag.current = null; }}>
          <svg ref={svgRef} className="absolute inset-0 h-full w-full" role="img" aria-label="Research map: paper, claims, sources, code, tests, results and agents, grouped by stage">
            <defs>
              <marker id="rm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b6785" /></marker>
              <marker id="rm-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7b5cf0" /></marker>
            </defs>
            <g data-viewport transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
              {L.frames.map((f) => (
                <g key={f.def.key}>
                  <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={18} fill={f.def.tint} stroke={f.def.border} strokeWidth={1.5} />
                  <text x={f.x + 16} y={f.y + 23} fontSize={14} fontWeight={700} fill="#26233a">{f.def.title}</text>
                  <text x={f.x + 16 + f.def.title.length * 8.1 + 8} y={f.y + 23} fontSize={12} fill="#8a87a0">{f.count}</text>
                </g>
              ))}
              {L.edges.map((e) => {
                const a = L.byId.get(e.from)!;
                const b = L.byId.get(e.to)!;
                const p = edgePath(a, b);
                const hot = !!active && (e.from === active || e.to === active);
                const problem = b.status === "problem" || /different|missing/.test(e.label ?? "");
                const faded = !!near && !hot;
                return (
                  <g key={e.id} opacity={faded ? 0.12 : e.implied ? 0.55 : 0.9}>
                    <path d={p.d} fill="none" stroke={hot ? "#7b5cf0" : problem ? "#d06b66" : "#8f8aa8"} strokeWidth={hot ? 2.4 : 1.5}
                      strokeDasharray={e.implied ? "3 5" : undefined} markerEnd={`url(#${hot ? "rm-arrow-hot" : "rm-arrow"})`} />
                    {e.label && (hot || !e.implied) && tf.k > 0.45 && (
                      <text x={p.mx} y={p.my - 5} textAnchor="middle" fontSize={11} fontStyle="italic" fill={hot ? "#5b3fd1" : "#6b6785"}
                        paintOrder="stroke" stroke="#fbfaf6" strokeWidth={4}>{e.label}</text>
                    )}
                  </g>
                );
              })}
              {L.nodes.map((n) => {
                const st = STATUS[n.status];
                const hit = q && matches(n);
                const faded = dim(n.id) || (q && !matches(n));
                const isSel = active === n.id;
                return (
                  <foreignObject key={n.id} x={n.x} y={n.y} width={CARD_W} height={CARD_H} opacity={faded ? 0.25 : 1} data-card>
                    <button type="button" onClick={() => choose(n)} title={`${n.kindRaw}: ${n.label}${n.detail ? ` — ${n.detail}` : ""}`}
                      aria-label={`${n.kindRaw}: ${n.label} (${n.status})`}
                      className="flex h-full w-full flex-col justify-center rounded-2xl border-2 px-3 text-left shadow-[0_2px_0_rgba(38,35,58,0.08)] transition hover:-translate-y-0.5"
                      style={{ background: st.fill, borderColor: isSel ? "#7b5cf0" : hit ? "#f0b429" : st.stroke, boxShadow: isSel ? "0 0 0 3px #e4dcff" : undefined }}>
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                        {React.createElement(KIND_ICON[n.kindRaw] ?? Brain, { size: 12, weight: "bold" })}
                        {n.kindRaw}
                        <span className="ml-auto h-2 w-2 rounded-full" style={{ background: st.dot }} />
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-tight text-ink">{n.label}</span>
                    </button>
                  </foreignObject>
                );
              })}
            </g>
          </svg>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-4 flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-clay-sm">
            <button type="button" onClick={() => zoomBy(1.2)} className="p-2.5 hover:bg-canvas" aria-label="Zoom in"><Plus size={16} /></button>
            <button type="button" onClick={() => zoomBy(1 / 1.2)} className="border-y border-line p-2.5 hover:bg-canvas" aria-label="Zoom out"><Minus size={16} /></button>
            <button type="button" onClick={fit} className="p-2.5 hover:bg-canvas" aria-label="Fit the whole map"><ArrowsOut size={16} /></button>
          </div>

          {/* Minimap */}
          <svg width={MM_W + 12} height={MM_H + 12} className="absolute bottom-4 right-4 hidden rounded-2xl border-2 border-ink bg-white/95 shadow-clay-sm lg:block"
            onClick={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const mx = (e.clientX - r.left - 6) / mmK;
              const my = (e.clientY - r.top - 6) / mmK;
              const el = box.current;
              if (el) setTf((t) => ({ ...t, x: el.clientWidth / 2 - mx * t.k, y: el.clientHeight / 2 - my * t.k }));
            }} aria-label="Minimap: click to move the view">
            <g transform={`translate(6,6) scale(${mmK})`}>
              {L.frames.map((f) => <rect key={f.def.key} x={f.x} y={f.y} width={f.w} height={f.h} rx={14} fill={f.def.tint} stroke={f.def.border} strokeWidth={4} />)}
              {L.nodes.map((n) => <rect key={n.id} x={n.x} y={n.y} width={CARD_W} height={CARD_H} rx={10} fill={STATUS[n.status].dot} opacity={0.8} />)}
              {vp && <rect x={vp.x} y={vp.y} width={vp.w} height={vp.h} fill="none" stroke="#7b5cf0" strokeWidth={8} rx={10} />}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted">
      {(["waiting", "working", "done", "problem"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 bg-white" style={{ borderColor: STATUS[s].stroke }} />{STATUS[s].label}</span>
      ))}
      <span className="flex items-center gap-1.5"><svg width="26" height="8"><path d="M1,4 H25" stroke="#8f8aa8" strokeWidth="2" /></svg>reported link</span>
      <span className="flex items-center gap-1.5"><svg width="26" height="8"><path d="M1,4 H25" stroke="#8f8aa8" strokeWidth="2" strokeDasharray="3 4" /></svg>implied by the pipeline</span>
    </div>
  );
}
