/**
 * Typed service functions — the ONLY way UI code talks to the backend.
 * One function per endpoint in ./endpoints.ts.
 */
import { API_BASE_URL } from "@/lib/config";
import { safeReturnPath } from "@/lib/utils";
import { apiUrl, request, unwrapList, uploadWithProgress, type UploadProgress } from "./client";
import { ENDPOINTS } from "./endpoints";
import type * as T from "./types";

/* ── Auth ── */

/** Full-page navigation target for the backend OAuth entry (GET /auth/github/login). */
export function githubLoginUrl(returnTo?: string | null): string {
  const rt = safeReturnPath(returnTo ?? null, "/dashboard");
  return `${API_BASE_URL}${ENDPOINTS.authLogin.template}?return_to=${encodeURIComponent(rt)}`;
}

export const authApi = {
  me: (signal?: AbortSignal) => request<T.MeResponse>(ENDPOINTS.me, { signal }),
  logout: () => request<void>(ENDPOINTS.authLogout),
  myPushes: async (signal?: AbortSignal) => unwrapList<T.Push>(await request(ENDPOINTS.myPushes, { signal }), "pushes"),
};

/* ── GitHub ── */

export const githubApi = {
  listRepos: async (signal?: AbortSignal) => unwrapList<T.GithubRepo>(await request(ENDPOINTS.listRepos, { signal }), "repos"),
  createRepo: (body: T.CreateRepoRequest) => request<T.GithubRepo>(ENDPOINTS.createRepo, { body }),
  setDefaultRepo: (body: T.SetDefaultRepoRequest) => request<T.GithubConnection | undefined>(ENDPOINTS.setDefaultRepo, { body }),
  disconnect: () => request<void>(ENDPOINTS.disconnectGithub),
};

/* ── Workspaces ── */

export const workspaceApi = {
  list: async (signal?: AbortSignal) =>
    unwrapList<T.WorkspaceSummary>(await request(ENDPOINTS.listWorkspaces, { signal }), "workspaces"),
  create: (body: T.CreateWorkspaceRequest) => request<T.Workspace>(ENDPOINTS.createWorkspace, { body }),
  get: (id: string, signal?: AbortSignal) => request<T.WorkspaceDetail>(ENDPOINTS.getWorkspace, { params: { id }, signal }),
  upload: (id: string, req: T.UploadRequest, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.set("kind", req.kind);
    if (req.file) form.set("file", req.file, req.file.name);
    if (req.url) form.set("url", req.url);
    return uploadWithProgress<T.Upload>(ENDPOINTS.uploadToWorkspace, { id }, form, onProgress, signal);
  },
  notes: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.Note>(await request(ENDPOINTS.getNotes, { params: { id }, signal }), "notes"),
  saveNotes: (id: string, body: T.UpdateNotesRequest) =>
    request<T.Note | T.Note[] | undefined>(ENDPOINTS.putNotes, { params: { id }, body }),
  share: (id: string, body: T.ShareRequest = {}) => request<T.ShareLink>(ENDPOINTS.shareWorkspace, { params: { id }, body }),
  paperFileUrl: (paperId: string) => apiUrl(ENDPOINTS.paperFile, { id: paperId }),
};

/* ── Runs ── */

export const runApi = {
  start: (workspaceId: string, body: T.StartRunRequest) =>
    request<T.Run>(ENDPOINTS.startRun, { params: { id: workspaceId }, body }),
  get: (id: string, signal?: AbortSignal) => request<T.Run>(ENDPOINTS.getRun, { params: { id }, signal }),
  events: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.RunEvent>(await request(ENDPOINTS.runEvents, { params: { id }, signal }), "events"),
  checkpoint: (id: string, name: string, body: T.CheckpointRequest) =>
    request<T.CheckpointResult | undefined>(ENDPOINTS.checkpoint, { params: { id, name }, body }),
  agentAction: (id: string, agent: string, body: T.AgentActionRequest) =>
    request<T.AgentActionResult | undefined>(ENDPOINTS.agentAction, { params: { id, agent }, body }),
  scorecard: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.ScorecardEntry>(await request(ENDPOINTS.scorecard, { params: { id }, signal }), "entries", "scorecard"),
  settings: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.RunSetting>(await request(ENDPOINTS.settings, { params: { id }, signal }), "settings"),
  createWhatIf: async (id: string, body: T.WhatIfRequest) => {
    const data = await request<unknown>(ENDPOINTS.createWhatIf, { params: { id }, body });
    const list = unwrapList<T.WhatIfBranch>(data, "branches");
    if (list.length) return list;
    return data && typeof data === "object" && "id" in data ? [data as T.WhatIfBranch] : [];
  },
  whatIfs: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.WhatIfBranch>(await request(ENDPOINTS.listWhatIfs, { params: { id }, signal }), "branches"),
  brief: (id: string, signal?: AbortSignal) => request<T.ResearchBrief>(ENDPOINTS.brief, { params: { id }, signal }),
  files: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.RunFile>(await request(ENDPOINTS.files, { params: { id }, signal }), "files"),
  fileContent: (id: string, path: string, signal?: AbortSignal) =>
    request<string>(ENDPOINTS.fileContent, { params: { id }, query: { path }, signal, responseType: "text" }),
  fileDownloadUrl: (id: string, path: string) => apiUrl(ENDPOINTS.fileContent, { id }, { path, download: 1 }),
  tests: (id: string, signal?: AbortSignal) => request<T.TestReport>(ENDPOINTS.tests, { params: { id }, signal }),
  gaps: (id: string, signal?: AbortSignal) => request<T.GapAnalysis>(ENDPOINTS.gaps, { params: { id }, signal }),
  map: (id: string, signal?: AbortSignal) => request<T.ResearchMap>(ENDPOINTS.map, { params: { id }, signal }),
  memory: (id: string, signal?: AbortSignal) => request<T.RunMemory>(ENDPOINTS.runMemory, { params: { id }, signal }),
  reportUrl: (id: string, format: "md" | "pdf") => apiUrl(ENDPOINTS.report, { id }, { format }),
  briefing: (id: string, signal?: AbortSignal) => request<T.AudioBriefing>(ENDPOINTS.briefing, { params: { id }, signal }),
  push: (id: string, body: T.PushRequest) => request<T.Push>(ENDPOINTS.push, { params: { id }, body }),
  pushStatus: (id: string, signal?: AbortSignal) => request<T.Push>(ENDPOINTS.pushStatus, { params: { id }, signal }),
};

/* ── Team & memory ── */

export const teamApi = {
  agents: async (signal?: AbortSignal) => unwrapList<T.Agent>(await request(ENDPOINTS.agents, { signal }), "agents"),
  history: (id: string, signal?: AbortSignal) => request<T.AgentHistory>(ENDPOINTS.agentHistory, { params: { id }, signal }),
};

export const memoryApi = {
  search: async (q: string, signal?: AbortSignal) =>
    unwrapList<T.MemoryItem>(await request(ENDPOINTS.memorySearch, { query: { q }, signal }), "items", "results"),
};

/* ── Shared read-only view ── */

export const shareApi = {
  view: (token: string, signal?: AbortSignal) => request<T.SharedView>(ENDPOINTS.sharedView, { params: { token }, signal }),
  events: async (token: string, signal?: AbortSignal) =>
    unwrapList<T.RunEvent>(await request(ENDPOINTS.sharedEvents, { params: { token }, signal }), "events"),
  scorecard: async (token: string, signal?: AbortSignal) =>
    unwrapList<T.ScorecardEntry>(await request(ENDPOINTS.sharedScorecard, { params: { token }, signal }), "entries"),
};
