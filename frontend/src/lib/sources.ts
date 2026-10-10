/** Safe handling of external source links (papers, datasets, repositories, citations). */

/** Only plain http(s) URLs without embedded credentials are allowed. Anything else is not a link. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 2048) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null; // never expose credentials in a clickable link
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type SourceKind = "paper" | "dataset" | "repository" | "documentation" | "source";

export function sourceKindOf(sourceType: unknown, nodeKind?: string): SourceKind {
  if (sourceType === "dataset" || sourceType === "repository" || sourceType === "documentation") return sourceType;
  if (sourceType === "paper" || nodeKind === "paper" || nodeKind === "related") return "paper";
  return "source";
}

const VERB: Record<SourceKind, string> = { paper: "Open paper", dataset: "Open dataset", repository: "Open repository", documentation: "Open documentation", source: "View source" };

/** "Open paper ↗" etc. */
export const sourceActionLabel = (k: SourceKind) => `${VERB[k]} ↗`;

export interface SourceRef {
  title: string;
  url: string | null;
  kind: SourceKind;
  /** Extra facts the backend really reported (licence, year, stars…). Never guessed. */
  facts: string[];
}

/** One readable line per fact that exists in the backend metadata. */
export function metaFacts(meta: Record<string, unknown> | undefined): string[] {
  if (!meta) return [];
  const out: string[] = [];
  if (meta.year) out.push(String(meta.year));
  if (typeof meta.citations === "number") out.push(`${meta.citations.toLocaleString()} citations`);
  if (meta.arxiv) out.push(`arXiv:${String(meta.arxiv).replace(/v\d+$/, "")}`);
  if (meta.licence) out.push(`licence ${String(meta.licence)}`);
  if (meta.size) out.push(String(meta.size));
  if (typeof meta.stars === "number") out.push(`${meta.stars.toLocaleString()} stars`);
  if (meta.language) out.push(String(meta.language));
  if (meta.user_provided) out.push("provided by you");
  else if (meta.official === true) out.push("official");
  return out;
}
