/**
 * Typed service functions — the ONLY way UI code talks to the backend.
 * One function per endpoint in ./endpoints.ts. Request bodies are built in the Go backend's
 * format and every response goes through ./adapters.ts into the UI's domain types.
 */
import { API_BASE_URL } from "@/lib/config";
import { safeReturnPath } from "@/lib/utils";
import * as A from "./adapters";
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
  me: async (signal?: AbortSignal): Promise<T.MeResponse> => A.toMe(await request(ENDPOINTS.me, { signal })),
  logout: () => request<void>(ENDPOINTS.authLogout),
  /** Email + password account (alongside GitHub). Sets the session cookie. */
  register: (email: string, password: string, name?: string) =>
    request<unknown>(ENDPOINTS.register, { body: { email, password, name } }),
  passwordLogin: (email: string, password: string) => request<unknown>(ENDPOINTS.passwordLogin, { body: { email, password } }),
  /** Bearer token for MCP clients (Gemini CLI) acting as the logged-in user. */
  mcpToken: () => request<{ token: string; expires_at: string; mcp_url: string }>(ENDPOINTS.mcpToken),
  /** Pushes are part of GET /me. */
  myPushes: async (signal?: AbortSignal): Promise<T.Push[]> => A.toMe(await request(ENDPOINTS.me, { signal })).pushes,
};

/* ── GitHub ── */

export const githubApi = {
  listRepos: async (signal?: AbortSignal) => unwrapList<T.GithubRepo>(await request(ENDPOINTS.listRepos, { signal }), "repos"),
  createRepo: (body: T.CreateRepoRequest) => request<T.GithubRepo>(ENDPOINTS.createRepo, { body }),
  setDefaultRepo: (body: T.SetDefaultRepoRequest) => request<unknown>(ENDPOINTS.setDefaultRepo, { body }),
  disconnect: () => request<unknown>(ENDPOINTS.disconnectGithub),
};

/* ── Better-resource recommendations ── */

export const resourceApi = {
  get: async (runId: string, signal?: AbortSignal): Promise<T.ResourcesResponse> => {
    const r = (await request(ENDPOINTS.resources, { params: { id: runId }, signal })) as Partial<T.ResourcesResponse> | undefined;
    return {
      discovery: { status: r?.discovery?.status ?? "not_run", note: r?.discovery?.note ?? "", providers: r?.discovery?.providers ?? [] },
      recommendations: (r?.recommendations ?? []).map((x) => ({ ...x, advantages: x.advantages ?? [], limitations: x.limitations ?? [], evidence: x.evidence ?? [], decision: x.decision ?? null })),
      originals: { datasets: r?.originals?.datasets ?? [], repositories: r?.originals?.repositories ?? [] },
    };
  },
  decide: async (runId: string, recId: string, decision: T.ResourceDecisionKind): Promise<void> => {
    await request<unknown>(ENDPOINTS.setResourceDecision, { params: { id: runId, recId }, body: { decision } });
  },
  clear: async (runId: string, recId: string): Promise<void> => {
    await request<void>(ENDPOINTS.clearResourceDecision, { params: { id: runId, recId } });
  },
};

/* ── Versions, comparison and research-paper materials ── */

export const versionApi = {
  requestChange: async (runId: string, text: string): Promise<{ new_run_id: number; created: boolean; change: T.ChangeRequestInfo }> =>
    (await request(ENDPOINTS.requestChange, { params: { id: runId }, body: { request: text } })) as { new_run_id: number; created: boolean; change: T.ChangeRequestInfo },
  changeOfRun: async (runId: string, signal?: AbortSignal): Promise<T.ChangeRequestInfo | null> =>
    ((await request(ENDPOINTS.changeOfRun, { params: { id: runId }, signal })) as { change: T.ChangeRequestInfo | null } | undefined)?.change ?? null,
  versions: async (runId: string, signal?: AbortSignal): Promise<T.VersionInfo[]> =>
    ((await request(ENDPOINTS.versions, { params: { id: runId }, signal })) as { versions: T.VersionInfo[] } | undefined)?.versions ?? [],
  compare: async (oldRunId: string, newRunId: string, signal?: AbortSignal): Promise<T.CompareResult> => {
    const c = (await request(ENDPOINTS.compare, { params: { id: oldRunId }, query: { with: newRunId }, signal })) as T.CompareResult;
    // Go encodes empty lists and maps as null (e.g. two versions with no file changes): normalise once here.
    return {
      ...c,
      files: c.files ?? [],
      skipped: c.skipped ?? {},
      metrics: c.metrics ?? [],
      scorecard: { old: c.scorecard?.old ?? {}, new: c.scorecard?.new ?? {} },
      plan: { added: c.plan?.added ?? [], removed: c.plan?.removed ?? [] },
      note: c.note ?? "",
    };
  },
  paper: async (runId: string, signal?: AbortSignal): Promise<T.PaperState> => {
    const r = (await request(ENDPOINTS.paper, { params: { id: runId }, signal })) as Partial<T.PaperState> | undefined;
    return { status: r?.status ?? "none", run_id: r?.run_id ?? Number(runId), error: r?.error, stale: r?.stale, sections: r?.sections ?? [], manifest: r?.manifest ?? null };
  },
  generatePaper: async (runId: string): Promise<void> => {
    await request<unknown>(ENDPOINTS.generatePaper, { params: { id: runId } });
  },
};

/* ── Paper-to-Video Explainer ── */

export const explainerApi = {
  voices: async (signal?: AbortSignal) =>
    (await request(ENDPOINTS.explainerVoices, { signal })) as { voices: T.ExplainerVoice[]; default: string; configured: boolean },
  list: async (workspaceId: string, signal?: AbortSignal): Promise<T.ExplainerVideo[]> =>
    unwrapList<T.ExplainerVideo>(await request(ENDPOINTS.explainerList, { params: { id: workspaceId }, signal }), "videos"),
  get: async (videoId: number, signal?: AbortSignal): Promise<T.ExplainerVideo> =>
    (await request(ENDPOINTS.explainerGet, { params: { videoId: String(videoId) }, signal })) as T.ExplainerVideo,
  create: async (workspaceId: string, body: { upload_id: number; voice_id?: string; fresh_script?: boolean }) =>
    (await request(ENDPOINTS.explainerCreate, { params: { id: workspaceId }, body })) as { id: number; queued: boolean },
  remove: (videoId: number) => request<void>(ENDPOINTS.explainerDelete, { params: { videoId: String(videoId) } }),
  videoUrl: (videoId: number, download = false) => apiUrl(ENDPOINTS.explainerVideo, { videoId: String(videoId) }, download ? { download: 1 } : undefined),
  assetUrl: (videoId: number, path: string) => apiUrl(ENDPOINTS.explainerAsset, { videoId: String(videoId) }, { path }),
};

/* ── Workspaces ── */

export const workspaceApi = {
  list: async (signal?: AbortSignal): Promise<T.WorkspaceSummary[]> =>
    unwrapList<unknown>(await request(ENDPOINTS.listWorkspaces, { signal }), "workspaces").map(A.toWorkspace),
  create: async (body: T.CreateWorkspaceRequest): Promise<T.Workspace> =>
    A.toWorkspace(await request(ENDPOINTS.createWorkspace, { body })),
  get: async (id: string, signal?: AbortSignal): Promise<T.WorkspaceDetail> =>
    A.toWorkspaceDetail(await request(ENDPOINTS.getWorkspace, { params: { id }, signal })),
  /** Owner only; the server refuses (409) while a run is executing. */
  remove: async (id: string): Promise<void> => {
    await request<void>(ENDPOINTS.deleteWorkspace, { params: { id } });
  },
  /** Files go as multipart (with progress); links (arXiv, dataset URL, repository) as JSON. */
  upload: async (id: string, req: T.UploadRequest, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<T.Upload> => {
    if (req.file) {
      const form = new FormData();
      form.set("kind", req.kind);
      form.set("file", req.file, req.file.name);
      return A.toUpload(await uploadWithProgress<unknown>(ENDPOINTS.uploadToWorkspace, { id }, form, onProgress, signal));
    }
    return A.toUpload(await request(ENDPOINTS.uploadToWorkspace, { params: { id }, body: { kind: req.kind, url: req.url }, signal }));
  },
  notes: async (id: string, signal?: AbortSignal) =>
    unwrapList<T.Note>(await request(ENDPOINTS.getNotes, { params: { id }, signal }), "notes"),
  saveNotes: (id: string, body: T.UpdateNotesRequest) =>
    request<T.Note | T.Note[] | undefined>(ENDPOINTS.putNotes, { params: { id }, body }),
  share: async (id: string, body: T.ShareRequest = {}) =>
    A.toShareLink(await request(ENDPOINTS.shareWorkspace, { params: { id }, body: { hours: body.expires_in_hours } })),
  paperFileUrl: (paperId: string) => apiUrl(ENDPOINTS.paperFile, { id: paperId }),
};

/* ── Runs ── */

export const runApi = {
  start: async (workspaceId: string, body: T.StartRunRequest): Promise<T.Run> =>
    A.toRun(await request(ENDPOINTS.startRun, { params: { id: workspaceId }, body })),
  get: async (id: string, signal?: AbortSignal): Promise<T.Run> => A.toRun(await request(ENDPOINTS.getRun, { params: { id }, signal })),
  events: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.runEvents, { params: { id }, signal }), "events").map(A.toEvent),
  checkpoint: (id: string, name: string, body: T.CheckpointRequest) =>
    request<unknown>(ENDPOINTS.checkpoint, {
      params: { id, name },
      body: { action: body.decision, instruction: body.instructions, option: body.option, changes: body.changes },
    }) as Promise<T.CheckpointResult | undefined>,
  checkpoints: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.checkpoints, { params: { id }, signal }), "checkpoints").map(A.toCheckpoint),
  /** Saves unapproved plan edits on the server (survives refresh / another browser). Nothing runs until approval. */
  savePlanDraft: (id: string, body: { changes: Record<string, string | number | boolean>; note: string }) =>
    request<unknown>(ENDPOINTS.planDraft, { params: { id }, body }),
  discardPlanDraft: (id: string) => request<unknown>(ENDPOINTS.planDraftDelete, { params: { id } }),
  /** `agent` is a board card ("coding") or a full agent id ("coding.writer"); "run" controls the whole run. */
  agentAction: (id: string, agent: string, body: T.AgentActionRequest) =>
    request<unknown>(ENDPOINTS.agentAction, {
      params: { id, agent },
      body: { action: body.action, text: body.instruction },
    }) as Promise<T.AgentActionResult | undefined>,
  scorecard: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.scorecard, { params: { id }, signal }), "entries").map((r) => A.toScorecardEntry(r, id)),
  settings: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.settings, { params: { id }, signal }), "settings").map((r) => A.toSetting(r, id)),
  /** Queues the question; branches appear in GET /runs/{id}/whatif as the planner creates them. */
  createWhatIf: async (id: string, body: T.WhatIfRequest): Promise<T.WhatIfBranch[]> => {
    await request<unknown>(ENDPOINTS.createWhatIf, { params: { id }, body });
    return runApi.whatIfs(id);
  },
  whatIfs: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.listWhatIfs, { params: { id }, signal }), "branches").map((b) => A.toWhatIf(b, id)),
  brief: async (id: string, signal?: AbortSignal) => A.toBrief(await request(ENDPOINTS.brief, { params: { id }, signal }), id),
  files: async (id: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.files, { params: { id }, signal }), "files").map(A.toFile),
  fileContent: (id: string, path: string, signal?: AbortSignal) =>
    request<string>(ENDPOINTS.fileContent, { params: { id }, query: { path }, signal, responseType: "text" }),
  fileDownloadUrl: (id: string, path: string) => apiUrl(ENDPOINTS.fileContent, { id }, { path }),
  tests: async (id: string, signal?: AbortSignal) => A.toTests(await request(ENDPOINTS.tests, { params: { id }, signal }), id),
  gaps: async (id: string, signal?: AbortSignal) => A.toGap(await request(ENDPOINTS.gaps, { params: { id }, signal }), id),
  map: async (id: string, signal?: AbortSignal) => A.toMap(await request(ENDPOINTS.map, { params: { id }, signal }), id),
  memory: async (id: string, signal?: AbortSignal) => A.toRunMemory(await request(ENDPOINTS.runMemory, { params: { id }, signal })),
  reportUrl: (id: string, format: "md" | "json" | "pdf") => apiUrl(ENDPOINTS.report, { id }, { format }),
  briefing: (id: string, signal?: AbortSignal) => request<T.AudioBriefing>(ENDPOINTS.briefing, { params: { id }, signal }),
  metricProof: async (metricId: string, signal?: AbortSignal) =>
    A.toMetric(await request(ENDPOINTS.metricProof, { params: { id: metricId }, signal })),
  /** Approval is explicit: the UI only calls this after the researcher ticks and confirms. */
};

/* ── Code sandbox ── */

export const sandboxApi = {
  status: async (signal?: AbortSignal) => A.toSandboxHealth(await request(ENDPOINTS.sandboxStatus, { signal })),
  saveFile: (runId: string, path: string, content: string) =>
    request<{ path: string; size: number; saved_at: string }>(ENDPOINTS.saveFile, { params: { id: runId }, body: { path, content } }),
  /** Returns at once (202); the container keeps running on the backend. */
  start: async (runId: string, entrypoint: string, timeoutSec?: number) =>
    A.toSandboxExecution(await request(ENDPOINTS.startExecution, { params: { id: runId }, body: { entrypoint, timeout_sec: timeoutSec } })),
  list: async (runId: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.listExecutions, { params: { id: runId }, signal }), "executions").map(A.toSandboxExecution),
  get: async (execId: string, signal?: AbortSignal) => A.toSandboxExecution(await request(ENDPOINTS.getExecution, { params: { id: execId }, signal })),
  logs: async (execId: string, stream: "combined" | "stderr", offset: number, signal?: AbortSignal) =>
    A.toLogChunk(await request(ENDPOINTS.executionLogs, { params: { id: execId }, query: { stream, offset }, signal })),
  cancel: (execId: string) => request<unknown>(ENDPOINTS.cancelExecution, { params: { id: execId } }),
  artifactUrl: (runId: string, path: string) => apiUrl(ENDPOINTS.artifact, { id: runId }, { path }),
  /** Self-Healing Debugger: queued on the backend; at most 3 attempts, each re-run in a fresh container. */
  heal: async (runId: string, execId: string) =>
    A.toHealSession(await request(ENDPOINTS.startHeal, { params: { id: runId }, body: { exec_id: Number(execId) } })),
  healSessions: async (runId: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.listHeal, { params: { id: runId }, signal }), "sessions").map(A.toHealSession),
};

/* ── Hugging Face Hub publishing (uploads happen on the server; the token never reaches the browser) ── */

export const hfApi = {
  preview: async (runId: string, repo: string, includeCode: boolean, signal?: AbortSignal) =>
    A.toHfPlan(await request(ENDPOINTS.hfPreview, { params: { id: runId }, query: { repo, include_code: includeCode ? 1 : undefined }, signal })),
  publish: async (runId: string, body: { repo: string; private: boolean; include_code: boolean }) =>
    A.toHfPublication(await request(ENDPOINTS.hfPublish, { params: { id: runId }, body: { ...body, confirm: true } })),
  list: async (runId: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.hfList, { params: { id: runId }, signal }), "publications").map(A.toHfPublication),
};

/* ── Agents & memory ── */

export const teamApi = {
  agents: async (signal?: AbortSignal) => A.toAgents(await request(ENDPOINTS.agents, { signal })),
};

export const memoryApi = {
  search: async (q: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.memorySearch, { query: { q }, signal }), "items", "results").map(A.toMemoryItem),
};

/* ── Voice / typed commands (mobile control) ── */

export interface VoiceIntent {
  action: string;
  run_id?: number;
  reply?: string;
  question?: string;
  checkpoint?: string;
  decision?: string;
  agent?: string;
  text?: string;
  [k: string]: unknown;
}

export const voiceApi = {
  text: (text: string) => request<{ text: string; intent: VoiceIntent }>(ENDPOINTS.voiceText, { body: { text } }),
  command: (audio: Blob) => {
    const form = new FormData();
    form.set("audio", audio, "command.webm");
    return uploadWithProgress<{ text: string; intent: VoiceIntent }>(ENDPOINTS.voiceCommand, {}, form);
  },
};

/* ── Shared read-only view ── */

export const shareApi = {
  view: async (token: string, signal?: AbortSignal) => A.toSharedView(await request(ENDPOINTS.sharedView, { params: { token }, signal })),
  events: async (token: string, runId: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.sharedEvents, { params: { token, runId }, signal }), "events").map(A.toEvent),
  scorecard: async (token: string, runId: string, signal?: AbortSignal) =>
    unwrapList<unknown>(await request(ENDPOINTS.sharedScorecard, { params: { token, runId }, signal }), "entries").map((r) =>
      A.toScorecardEntry(r, runId),
    ),
};

/* ── Model Context Protocol (MCP) & Assistant ── */

export const assistantApi = {
  listTools: async (signal?: AbortSignal) =>
    (await request<{ tools: T.MCPToolDef[] }>(ENDPOINTS.assistantTools, { signal })).tools,
  createTask: async (runId: string, prompt: string, modelProvider = "claude") =>
    (await request<{ task: T.MCPTask }>(ENDPOINTS.createAssistantTask, {
      params: { id: runId },
      body: { prompt, model_provider: modelProvider },
    })).task,
  listTasks: async (runId: string, signal?: AbortSignal) =>
    (await request<{ tasks: T.MCPTask[] }>(ENDPOINTS.listAssistantTasks, { params: { id: runId }, signal })).tasks,
  getTask: async (taskId: string, signal?: AbortSignal) =>
    (await request<{ task: T.MCPTask }>(ENDPOINTS.getAssistantTask, { params: { taskId }, signal })).task,
  approveTask: async (taskId: string, approved: boolean, reason?: string) =>
    (await request<{ task: T.MCPTask }>(ENDPOINTS.approveAssistantTask, {
      params: { taskId },
      body: { approved, reason },
    })).task,
  cancelTask: async (taskId: string) =>
    (await request<{ task: T.MCPTask }>(ENDPOINTS.cancelAssistantTask, { params: { taskId } })).task,
};

