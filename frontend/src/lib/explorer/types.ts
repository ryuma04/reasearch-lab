/** Research Gap Explorer data, as stored by the backend (agents/lab/explorer). */

export type Relation = "seed" | "builds_on" | "cited_by" | "related";

/** A quoted fact. Only facts whose quote was verified against the paper's text are ever present. */
export interface XFact {
  text?: string;
  name?: string;
  value?: string;
  quote: string;
  verified: boolean;
}

export interface XPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  doi: string | null;
  arxiv_id: string | null;
  citations: number | null;
  relation: Relation;
  sources: string[];
  is_seed: boolean;
  has_abstract: boolean;
  abstract: string | null;
  category: string | null;
  category_source: string | null;
  methodology: string[];
  contribution: string | null;
  limitations: XFact[];
  future_work: XFact[];
  datasets: XFact[];
  metrics: XFact[];
  facts_by: string | null;
}

export interface XEdge {
  from: string;
  to: string;
  kind: "cites";
  evidence: string;
}

export type CapabilityStatus = "implemented_verified" | "explicitly_not_implemented" | "not_reported" | "proposed_not_validated";

export interface XCell {
  status: CapabilityStatus | "reported" | "not_reported";
  text: string;
  evidence: { paper_id: string; quote: string }[];
}

export type DescriptiveColumn = "models" | "datasets" | "metrics" | "strengths" | "limitations";

export interface XComparison {
  systems: { id: string; name: string; year: number | null; url: string | null; is_uploaded: boolean }[];
  descriptive: Record<DescriptiveColumn, Record<string, XCell>>;
  capabilities: { name: string; description: string; cells: Record<string, XCell> }[];
  underexplored: { capability: string; implemented_in: string[]; explicitly_missing_in: string[]; note: string }[];
  ai: boolean;
}

export interface XGap {
  id: string;
  title: string;
  category: string;
  explanation: string;
  kind: "evidence_backed" | "hypothesis";
  confidence: "low" | "medium" | "high";
  confidence_basis: string;
  evidence: { paper_id: string; title: string; year: number | null; url: string | null; quote: string }[];
  supporting_papers: string[];
  impact: "low" | "medium" | "high";
  impact_reason: string;
  why_investigate: string;
  novelty: string;
}

export interface XRecommendation {
  id: string;
  title: string;
  gap_ids: string[];
  limitation: string;
  improvement: string;
  benefit: string;
  complexity: "low" | "medium" | "high";
  resources: string;
  dependencies: string[];
  evaluation: string;
  category: "essential" | "high_value" | "experimental";
  references: string[];
  evidence_backed: boolean;
  priority: number;
}

export interface XData {
  seed_id: string;
  papers: XPaper[];
  edges: XEdge[];
  comparison: XComparison;
  gaps: XGap[];
  recommendations: XRecommendation[];
  warnings: string[];
  generated_at: string;
  limits: { papers_found: number; with_abstract: number; basis: string; sources: string[] };
}

export interface XAnalysis {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  error: string;
  data: Partial<XData>;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export type FeedbackDecision = "accepted" | "rejected" | "edited" | "investigate" | "added";

export interface XFeedback {
  id: string;
  item_type: "recommendation" | "gap" | "idea";
  item_id: string;
  decision: FeedbackDecision;
  reason: string;
  edited: Record<string, string>;
  user_id: string | null;
  mine: boolean;
  updated_at: string;
}

export interface ExplorerResponse {
  analysis: XAnalysis | null;
  feedback: XFeedback[];
  /** The Research Agent has finished analysing the uploaded paper. */
  ready: boolean;
  can_edit: boolean;
  run_id: string;
  workspace_id: string;
}
