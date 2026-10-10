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
  authLogout: e("authLogout", "POST", "/auth/logout", "proposed"),
  me: e("me", "GET", "/me", "documented"),
  myPushes: e("myPushes", "GET", "/me/pushes", "proposed"),

  // GitHub
  listRepos: e("listRepos", "GET", "/github/repos", "documented"),
  createRepo: e("createRepo", "POST", "/github/repos", "documented"),
  setDefaultRepo: e("setDefaultRepo", "PUT", "/github/default-repo", "documented"),
  disconnectGithub: e("disconnectGithub", "DELETE", "/github/connection", "documented"),

  // Workspaces
  listWorkspaces: e("listWorkspaces", "GET", "/workspaces", "proposed"),
  createWorkspace: e("createWorkspace", "POST", "/workspaces", "documented"),
  getWorkspace: e("getWorkspace", "GET", "/workspaces/{id}", "documented"),
  uploadToWorkspace: e("uploadToWorkspace", "POST", "/workspaces/{id}/uploads", "documented"),
  getNotes: e("getNotes", "GET", "/workspaces/{id}/notes", "documented"),
  putNotes: e("putNotes", "PUT", "/workspaces/{id}/notes", "documented"),
  shareWorkspace: e("shareWorkspace", "POST", "/workspaces/{id}/share", "documented"),
  paperFile: e("paperFile", "GET", "/papers/{id}/file", "proposed"),

  // Runs
  startRun: e("startRun", "POST", "/workspaces/{id}/runs", "documented"),
  getRun: e("getRun", "GET", "/runs/{id}", "proposed"),
  runStream: e("runStream", "GET", "/runs/{id}/stream", "documented"),
  runEvents: e("runEvents", "GET", "/runs/{id}/events", "documented"),
  checkpoint: e("checkpoint", "POST", "/runs/{id}/checkpoints/{name}", "documented"),
  agentAction: e("agentAction", "POST", "/runs/{id}/agents/{agent}/action", "documented"),
  scorecard: e("scorecard", "GET", "/runs/{id}/scorecard", "documented"),
  settings: e("settings", "GET", "/runs/{id}/settings", "documented"),
  createWhatIf: e("createWhatIf", "POST", "/runs/{id}/whatif", "documented"),
  listWhatIfs: e("listWhatIfs", "GET", "/runs/{id}/whatif", "proposed"),
  brief: e("brief", "GET", "/runs/{id}/brief", "proposed"),
  files: e("files", "GET", "/runs/{id}/files", "proposed"),
  fileContent: e("fileContent", "GET", "/runs/{id}/files/content", "proposed"),
  tests: e("tests", "GET", "/runs/{id}/tests", "proposed"),
  gaps: e("gaps", "GET", "/runs/{id}/gaps", "proposed"),
  map: e("map", "GET", "/runs/{id}/map", "proposed"),
  runMemory: e("runMemory", "GET", "/runs/{id}/memory", "proposed"),
  report: e("report", "GET", "/runs/{id}/report", "proposed"),
  briefing: e("briefing", "GET", "/runs/{id}/briefing", "proposed"),
  push: e("push", "POST", "/runs/{id}/push", "documented"),
  pushStatus: e("pushStatus", "GET", "/runs/{id}/push", "proposed"),

  // Team & memory
  agents: e("agents", "GET", "/agents", "documented"),
  agentHistory: e("agentHistory", "GET", "/agents/{id}/history", "documented"),
  memorySearch: e("memorySearch", "GET", "/memory/search", "documented"),

  // Read-only shared view
  sharedView: e("sharedView", "GET", "/share/{token}", "proposed"),
  sharedEvents: e("sharedEvents", "GET", "/share/{token}/events", "proposed"),
  sharedStream: e("sharedStream", "GET", "/share/{token}/stream", "proposed"),
  sharedScorecard: e("sharedScorecard", "GET", "/share/{token}/scorecard", "proposed"),
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
