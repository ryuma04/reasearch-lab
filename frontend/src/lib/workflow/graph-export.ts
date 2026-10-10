/**
 * Graph export. The SVG is built from the graph DATA with plain SVG shapes (rects, paths, text), not copied from the
 * page: the on-screen cards are HTML inside <foreignObject>, which most SVG viewers render blank. PNG is rasterised
 * from that same SVG, and JSON keeps ids, relationships, URLs and metadata so the graph can be rebuilt.
 */
import type { ResearchMap } from "@/lib/api/types";
import { safeUrl } from "@/lib/sources";
import { CARD_H, CARD_W, STATUS, edgePath, layout } from "./graph-layout";

const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)
    // characters XML 1.0 cannot represent
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

/** Wrap a label into at most `lines` lines of about `max` characters. */
export function wrapLabel(text: string, max = 28, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1]!.slice(0, max - 1) + "…";
    return kept;
  }
  return out.length ? out : [""];
}

const PAD = 30;

export function buildSvg(map: ResearchMap): { svg: string; width: number; height: number } {
  const L = layout(map);
  const width = Math.ceil(L.width + PAD * 2);
  const height = Math.ceil(L.height + PAD * 2);
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`);
  parts.push(`<title>Research map of run ${xml(String(map.run_id))}</title>`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b6785"/></marker></defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#fbfaf6"/>`);
  parts.push(`<g transform="translate(${PAD},${PAD})">`);
  for (const f of L.frames) {
    parts.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="18" fill="${f.def.tint}" stroke="${f.def.border}" stroke-width="1.5"/>`);
    parts.push(`<text x="${f.x + 16}" y="${f.y + 23}" font-size="14" font-weight="700" fill="#26233a">${xml(f.def.title)} (${f.count})</text>`);
  }
  for (const e of L.edges) {
    const a = L.byId.get(e.from);
    const b = L.byId.get(e.to);
    if (!a || !b) continue;
    const p = edgePath(a, b);
    parts.push(`<g><path d="${p.d}" fill="none" stroke="#8f8aa8" stroke-width="1.5"${e.implied ? ' stroke-dasharray="3 5"' : ""} marker-end="url(#arrow)"/>`);
    if (e.label && !e.implied) parts.push(`<text x="${p.mx}" y="${p.my - 5}" text-anchor="middle" font-size="11" font-style="italic" fill="#6b6785" stroke="#fbfaf6" stroke-width="4" paint-order="stroke">${xml(e.label)}</text>`);
    parts.push(`</g>`);
  }
  for (const n of L.nodes) {
    const st = STATUS[n.status];
    const url = safeUrl((n as { url?: unknown }).url);
    const card =
      `<rect x="${n.x}" y="${n.y}" width="${CARD_W}" height="${CARD_H}" rx="14" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2"/>` +
      `<circle cx="${n.x + CARD_W - 14}" cy="${n.y + 14}" r="4" fill="${st.dot}"/>` +
      `<text x="${n.x + 12}" y="${n.y + 18}" font-size="10" font-weight="700" fill="#8a87a0" letter-spacing="0.6">${xml(n.kindRaw.toUpperCase())}</text>` +
      wrapLabel(n.label).map((t, i) => `<text x="${n.x + 12}" y="${n.y + 36 + i * 15}" font-size="13" font-weight="600" fill="#26233a">${xml(t)}</text>`).join("");
    parts.push(url ? `<a xlink:href="${xml(url)}" href="${xml(url)}"><title>${xml(n.label)}</title>${card}</a>` : `<g><title>${xml(n.label)}</title>${card}</g>`);
  }
  parts.push(`</g></svg>`);
  return { svg: parts.join("\n"), width, height };
}

export interface GraphJson {
  format: "research-lab-graph";
  version: 1;
  run_id: string;
  exported_at: string;
  nodes: { id: string; kind: string; label: string; status: string; detail: string | null; url: string | null; source_type: string | null; meta: Record<string, unknown> }[];
  edges: { id: string; from: string; to: string; label: string | null }[];
}

export function buildJson(map: ResearchMap, now = new Date()): GraphJson {
  const ids = new Set(map.nodes.map((n) => n.id));
  return {
    format: "research-lab-graph",
    version: 1,
    run_id: map.run_id,
    exported_at: now.toISOString(),
    nodes: map.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, status: n.status, detail: n.detail ?? null, url: safeUrl(n.url), source_type: n.source_type ?? null, meta: n.meta ?? {} })),
    edges: map.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label ?? null })),
  };
}

export type GraphFormat = "svg" | "png" | "json";

export async function buildPng(map: ResearchMap, scale = 2): Promise<Blob> {
  const { svg, width, height } = buildSvg(map);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("The graph image could not be rendered."));
      img.src = url;
    });
    // Browsers cap canvas size; scale down very large graphs instead of producing a blank image.
    const k = Math.min(scale, 16000 / Math.max(width, height), Math.sqrt(120_000_000 / (width * height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * k));
    canvas.height = Math.max(1, Math.floor(height * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the PNG.");
    ctx.fillStyle = "#fbfaf6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The PNG could not be created."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build the file for a format. Resolves only when the file really exists. */
export async function buildGraphFile(map: ResearchMap, format: GraphFormat): Promise<{ blob: Blob; name: string }> {
  if (!map.nodes.length) throw new Error("There is nothing to export yet: the graph is empty.");
  const base = `research-graph-run-${map.run_id}`;
  if (format === "svg") return { blob: new Blob([buildSvg(map).svg], { type: "image/svg+xml;charset=utf-8" }), name: `${base}.svg` };
  if (format === "json") return { blob: new Blob([JSON.stringify(buildJson(map), null, 2)], { type: "application/json;charset=utf-8" }), name: `${base}.json` };
  return { blob: await buildPng(map), name: `${base}.png` };
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
