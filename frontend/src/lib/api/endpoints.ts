/**
 * Single source of truth for every backend route the frontend calls.
 *
 * status:
 *  - "documented": listed in allaboutourproject.md §23 (agreed contract).
 *  - "proposed":   needed by a screen but NOT in §23 yet. Proposed in
 *                  FRONTEND_INTEGRATION_NOTES.md; the UI shows an
 *                  "endpoint not available" state when the backend lacks it.
 *
 * Internal-only routes (POST /internal/sandbox/exec, POST /internal/push/callback)
 * and POST /telegram/webhook are intentionally absent: the browser must never call them.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type EndpointStatus = "documented" | "proposed";

export interface EndpointDef {
  key: string;
  method: HttpMethod;
  status: EndpointStatus;
  template: string;
}

const e = (key: string, method: HttpMethod, template: string, status: EndpointStatus): EndpointDef => ({
  key,
  method,
  template,
  status,
});

const seg = (v: string) => encodeURIComponent(v);

export const ENDPOINTS = {
  // Auth & profile
  authLogin: e("authLogin", "GET", "/auth/github/login", "documented"),
  authLogout: e("authLogout", "POST", "/auth/logout", "documented"),
  register: e("register", "POST", "/auth/register", "documented"),
  passwordLogin: e("passwordLogin", "POST", "/auth/login", "documented"),
  me: e("me", "GET", "/me", "documented"),

  // GitHub
  listRepos: e("listRepos", "GET", "/github/repos", "documented"),
  createRepo: e("createRepo", "POST", "/github/repos", "documented"),
  setDefaultRepo: e("setDefaultRepo", "PUT", "/github/default-repo", "documented"),
  disconnectGithub: e("disconnectGithub", "DELETE", "/github/connection", "documented"),

  // Workspaces
  listWorkspaces: e("listWorkspaces", "GET", "/workspaces", "documented"),
  createWorkspace: e("createWorkspace", "POST", "/workspaces", "documented"),
  getWorkspace: e("getWorkspace", "GET", "/workspaces/{id}", "documented"),
  deleteWorkspace: e("deleteWorkspace", "DELETE", "/workspaces/{id}", "documented"),
  uploadToWorkspace: e("uploadToWorkspace", "POST", "/workspaces/{id}/uploads", "documented"),
  getNotes: e("getNotes", "GET", "/workspaces/{id}/notes", "documented"),
  putNotes: e("putNotes", "PUT", "/workspaces/{id}/notes", "documented"),
  shareWorkspace: e("shareWorkspace", "POST", "/workspaces/{id}/share", "documented"),
  paperFile: e("paperFile", "GET", "/papers/{id}/pdf", "documented"),

  // Runs
  startRun: e("startRun", "POST", "/workspaces/{id}/runs", "documented"),
  getRun: e("getRun", "GET", "/runs/{id}", "documented"),
  workspaceRuns: e("workspaceRuns", "GET", "/workspaces/{id}/runs", "documented"),
  runStream: e("runStream", "GET", "/runs/{id}/stream", "documented"),
  runEvents: e("runEvents", "GET", "/runs/{id}/events", "documented"),
  checkpoints: e("checkpoints", "GET", "/runs/{id}/checkpoints", "documented"),
  // Research Gap Explorer (independent feature)
  explorer: e("explorer", "GET", "/runs/{id}/explorer", "documented"),
  explorerStart: e("explorerStart", "POST", "/runs/{id}/explorer", "documented"),
  explorerFeedback: e("explorerFeedback", "PUT", "/runs/{id}/explorer/feedback", "documented"),
  explorerFeedbackDelete: e("explorerFeedbackDelete", "DELETE", "/runs/{id}/explorer/feedback/{feedbackId}", "documented"),
  explorerIdea: e("explorerIdea", "POST", "/runs/{id}/explorer/ideas", "documented"),
  planDraft: e("planDraft", "PUT", "/runs/{id}/plan/draft", "documented"),
  planDraftDelete: e("planDraftDelete", "DELETE", "/runs/{id}/plan/draft", "documented"),
  checkpoint: e("checkpoint", "POST", "/runs/{id}/checkpoints/{name}", "documented"),
  agentAction: e("agentAction", "POST", "/runs/{id}/agents/{agent}/action", "documented"),
  scorecard: e("scorecard", "GET", "/runs/{id}/scorecard", "documented"),
  settings: e("settings", "GET", "/runs/{id}/settings", "documented"),
  createWhatIf: e("createWhatIf", "POST", "/runs/{id}/whatif", "documented"),
  listWhatIfs: e("listWhatIfs", "GET", "/runs/{id}/whatif", "documented"),
  brief: e("brief", "GET", "/runs/{id}/research", "documented"),
  resources: e("resources", "GET", "/runs/{id}/resources", "documented"),
  setResourceDecision: e("setResourceDecision", "PUT", "/runs/{id}/resources/{recId}", "documented"),
  clearResourceDecision: e("clearResourceDecision", "DELETE", "/runs/{id}/resources/{recId}", "documented"),
  files: e("files", "GET", "/runs/{id}/files", "documented"),
  fileContent: e("fileContent", "GET", "/runs/{id}/file", "documented"),
  tests: e("tests", "GET", "/runs/{id}/tests", "documented"),
  gaps: e("gaps", "GET", "/runs/{id}/gap", "documented"),
  map: e("map", "GET", "/runs/{id}/map", "documented"),
  runMemory: e("runMemory", "GET", "/runs/{id}/memory", "documented"),
  report: e("report", "GET", "/runs/{id}/report", "documented"),
  briefing: e("briefing", "GET", "/runs/{id}/briefing", "proposed"),
  metricProof: e("metricProof", "GET", "/metrics/{id}/proof", "documented"),
  voiceText: e("voiceText", "POST", "/voice/text", "documented"),
  voiceCommand: e("voiceCommand", "POST", "/voice/command", "documented"),

  // Code sandbox (Docker, controlled by the Go backend)
  sandboxStatus: e("sandboxStatus", "GET", "/sandbox/status", "documented"),
  saveFile: e("saveFile", "PUT", "/runs/{id}/file", "documented"),
  artifact: e("artifact", "GET", "/runs/{id}/artifact", "documented"),
  startExecution: e("startExecution", "POST", "/runs/{id}/sandbox/executions", "documented"),
  listExecutions: e("listExecutions", "GET", "/runs/{id}/sandbox/executions", "documented"),
  getExecution: e("getExecution", "GET", "/sandbox/executions/{id}", "documented"),
  executionLogs: e("executionLogs", "GET", "/sandbox/executions/{id}/logs", "documented"),
  cancelExecution: e("cancelExecution", "POST", "/sandbox/executions/{id}/cancel", "documented"),
  startHeal: e("startHeal", "POST", "/runs/{id}/sandbox/heal", "documented"),
  listHeal: e("listHeal", "GET", "/runs/{id}/sandbox/heal", "documented"),
  hfPreview: e("hfPreview", "GET", "/runs/{id}/huggingface/preview", "documented"),
  hfPublish: e("hfPublish", "POST", "/runs/{id}/huggingface", "documented"),
  hfList: e("hfList", "GET", "/runs/{id}/huggingface", "documented"),

  // Team & memory
  agents: e("agents", "GET", "/agents", "documented"),
  memorySearch: e("memorySearch", "GET", "/memory/search", "documented"),

  // Read-only shared view
  sharedView: e("sharedView", "GET", "/share/{token}", "documented"),
  sharedEvents: e("sharedEvents", "GET", "/share/{token}/runs/{runId}/events", "documented"),
  sharedStream: e("sharedStream", "GET", "/share/{token}/runs/{runId}/stream", "documented"),
  sharedScorecard: e("sharedScorecard", "GET", "/share/{token}/runs/{runId}/scorecard", "documented"),
} as const satisfies Record<string, EndpointDef>;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Fill `{param}` placeholders, URL-encoding every value. Throws on a missing param. */
export function buildPath(def: EndpointDef, params: Record<string, string> = {}): string {
  return def.template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v == null || v === "") throw new Error(`Missing path param "${name}" for ${def.key}`);
    return seg(v);
  });
}

export function buildQuery(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
