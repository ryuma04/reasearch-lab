"use client";

import * as React from "react";
import type { MapNode, ResearchMap } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Hand-drawn style research map rendered as SVG from GET /runs/{id}/map (Observer output).
 * Layout: paper centred, other node kinds in rings. Colours follow §26.
 */
const STATUS_FILL: Record<MapNode["status"], string> = { waiting: "#eef1f6", working: "#e3effc", done: "#e8f4dc", problem: "#fde4e2" };
const STATUS_STROKE: Record<MapNode["status"], string> = { waiting: "#9794ab", working: "#2f6fbf", done: "#3f8a2e", problem: "#c9544f" };
const W = 960;
const H = 620;

function layout(nodes: MapNode[]) {
  const pos = new Map<string, { x: number; y: number }>();
  const center = nodes.find((n) => n.kind === "paper");
  if (center) pos.set(center.id, { x: W / 2, y: H / 2 });
  const rest = nodes.filter((n) => n !== center);
  const order = ["claim", "test", "result", "code", "dataset", "source", "agent", "note"];
  rest.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  rest.forEach((n, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(rest.length, 1)) * Math.PI * 2;
    const rx = n.kind === "claim" ? 230 : 380;
    const ry = n.kind === "claim" ? 170 : 245;
    pos.set(n.id, { x: W / 2 + Math.cos(angle) * rx, y: H / 2 + Math.sin(angle) * ry });
  });
  return pos;
}

/** Deterministic wobble so lines look sketched but stable between renders. */
function wobble(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((h % 7) - 3) * 0.6;
}

export function ResearchMapView({ map, onSelect, selected }: { map: ResearchMap; onSelect?: (n: MapNode) => void; selected?: string | null }) {
  const pos = layout(map.nodes);
  return (
    <div className="overflow-hidden rounded-[28px] border-2 border-ink bg-[#fffdf8] shadow-pop-lg">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Research map of the paper, claims, sources, code and tests">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3a3850" /></marker>
        </defs>
        {map.edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2 + wobble(e.id) * 6;
          const my = (a.y + b.y) / 2 + wobble(e.id + "y") * 6;
          return (
            <g key={e.id}>
              <path d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke="#3a3850" strokeWidth={1.8} strokeLinecap="round" markerEnd="url(#arrow)" opacity={0.75} />
              {e.label && <text x={mx} y={my - 6} textAnchor="middle" className="fill-muted text-[13px] italic">{e.label}</text>}
            </g>
          );
        })}
        {map.nodes.map((n) => {
          const p = pos.get(n.id)!;
          const lines = n.label.split("\n");
          const w = Math.max(...lines.map((l) => l.length)) * 7.6 + 34;
          const h = lines.length * 18 + 22;
          return (
            <g key={n.id} transform={`translate(${p.x - w / 2},${p.y - h / 2}) rotate(${wobble(n.id)} ${w / 2} ${h / 2})`}
              className={cn(onSelect && "cursor-pointer")} onClick={() => onSelect?.(n)} tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(ev) => { if (ev.key === "Enter") onSelect?.(n); }} role={onSelect ? "button" : undefined} aria-label={`${n.kind}: ${n.label.replace("\n", " ")} (${n.status})`}>
              <rect width={w} height={h} rx={n.kind === "paper" ? 22 : 14} fill={STATUS_FILL[n.status]} stroke={selected === n.id ? "#7b5cf0" : STATUS_STROKE[n.status]} strokeWidth={selected === n.id ? 3.5 : 2.2} strokeDasharray={n.status === "waiting" ? "6 5" : undefined} />
              <text x={12} y={14} className="fill-muted text-[10px] font-bold uppercase tracking-wider">{n.kind}</text>
              {lines.map((l, i) => (
                <text key={i} x={12} y={32 + i * 18} className="fill-ink text-[14px] font-semibold">{l}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs font-semibold text-muted">
      {(["waiting", "working", "done", "problem"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2" style={{ background: STATUS_FILL[s], borderColor: STATUS_STROKE[s] }} />{s}</span>
      ))}
    </div>
  );
}
