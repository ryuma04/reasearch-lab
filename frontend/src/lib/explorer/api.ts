"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userMessage } from "@/lib/api/errors";
import { request } from "@/lib/api/client";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { toast } from "@/components/ui/overlays";
import { safeUrl } from "@/lib/sources";
import type { ExplorerResponse, XAnalysis, XFeedback, XPaper } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sid = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function toFeedback(raw: unknown): XFeedback {
  const f = isObj(raw) ? raw : {};
  const edited: Record<string, string> = {};
  if (isObj(f.edited)) for (const [k, v] of Object.entries(f.edited)) if (typeof v === "string") edited[k] = v;
  return {
    id: sid(f.id), item_type: f.item_type as XFeedback["item_type"], item_id: sid(f.item_id), decision: f.decision as XFeedback["decision"],
    reason: String(f.reason ?? ""), edited, user_id: f.user_id == null ? null : sid(f.user_id), mine: f.mine === true, updated_at: String(f.updated_at ?? ""),
  };
}

/** Links are only kept when they are valid http(s) URLs. */
function cleanPaper(p: XPaper): XPaper {
  return { ...p, url: safeUrl(p.url), authors: Array.isArray(p.authors) ? p.authors : [], methodology: p.methodology ?? [], limitations: p.limitations ?? [], future_work: p.future_work ?? [], datasets: p.datasets ?? [], metrics: p.metrics ?? [] };
}

export function toExplorer(raw: unknown): ExplorerResponse {
  const r = isObj(raw) ? raw : {};
  let analysis: XAnalysis | null = null;
  if (isObj(r.analysis)) {
    const a = r.analysis;
    const data = isObj(a.data) ? (a.data as XAnalysis["data"]) : {};
    analysis = {
      id: sid(a.id), status: a.status as XAnalysis["status"], stage: String(a.stage ?? ""), error: String(a.error ?? ""),
      data: { ...data, papers: Array.isArray(data.papers) ? data.papers.map(cleanPaper) : undefined },
      created_at: String(a.created_at ?? ""), updated_at: String(a.updated_at ?? ""), finished_at: a.finished_at ? String(a.finished_at) : null,
    };
  }
  return {
    analysis, feedback: Array.isArray(r.feedback) ? r.feedback.map(toFeedback) : [], ready: r.ready === true, can_edit: r.can_edit === true,
    run_id: sid(r.run_id), workspace_id: sid(r.workspace_id),
  };
}

const key = (runId: string) => ["explorer", runId] as const;

/** Polls every 3 s only while the analysis is queued or running. */
export function useExplorer(runId: string | null) {
  return useQuery({
    queryKey: key(runId ?? ""),
    enabled: !!runId,
    queryFn: async ({ signal }) => toExplorer(await request(ENDPOINTS.explorer, { params: { id: runId! }, signal })),
    refetchInterval: (q) => {
      const s = q.state.data?.analysis?.status;
      return s === "queued" || s === "running" ? 3000 : false;
    },
  });
}

export function useExplorerActions(runId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: key(runId) });
  const fail = (title: string) => (e: unknown) => toast.error(title, userMessage(e));
  const start = useMutation({
    mutationFn: () => request<unknown>(ENDPOINTS.explorerStart, { params: { id: runId } }),
    onSuccess: refresh, onError: fail("Couldn't start the analysis"),
  });
  const feedback = useMutation({
    mutationFn: (b: { item_type: "recommendation" | "gap"; item_id: string; decision: Exclude<XFeedback["decision"], "added">; reason?: string; edited?: Record<string, string> }) =>
      request<unknown>(ENDPOINTS.explorerFeedback, { params: { id: runId }, body: b }),
    onSuccess: refresh, onError: fail("Couldn't save your feedback"),
  });
  const clear = useMutation({
    mutationFn: (feedbackId: string) => request<unknown>(ENDPOINTS.explorerFeedbackDelete, { params: { id: runId, feedbackId } }),
    onSuccess: refresh, onError: fail("Couldn't remove it"),
  });
  const idea = useMutation({
    mutationFn: (b: { title: string; text: string }) => request<unknown>(ENDPOINTS.explorerIdea, { params: { id: runId }, body: b }),
    onSuccess: async () => { await refresh(); toast.success("Idea saved"); }, onError: fail("Couldn't save your idea"),
  });
  return { start, feedback, clear, idea };
}
