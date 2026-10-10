/**
 * DEVELOPMENT-ONLY demo backend (NEXT_PUBLIC_USE_MOCKS=true). Never bundled into production
 * code paths (USE_MOCKS is false when NODE_ENV=production). Emulates the documented contract
 * so screens can be exercised before the Go backend is ready.
 */
import type { EndpointDef } from "../endpoints";
import type { EventSourceLike } from "../sse";
import type * as T from "../types";
import * as D from "./data";

const now = () => new Date().toISOString();
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, message: string) => json({ error: { message } }, status);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunSim {
  run: T.Run;
  events: T.RunEvent[];
  step: number;
  paused: boolean;
  listeners: Set<(e: T.RunEvent) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  push: T.Push | null;
}

const LOGGED_OUT_KEY = "demo_logged_out";
const loggedOut = () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(LOGGED_OUT_KEY) === "1";

const state = {
  github: { status: "connected", scopes: ["read:user", "user:email", "repo"], default_repo: "demo-researcher/distillation-repro", connected_at: "2026-10-01T09:00:00Z" } as T.GithubConnection,
  repos: [...D.DEMO_REPOS],
  workspaces: new Map<string, T.WorkspaceDetail>(),
  runs: new Map<string, RunSim>(),
  notes: new Map<string, T.Note[]>(),
  pushes: [] as T.Push[],
  seq: 100,
};

function id(prefix: string) {
  state.seq += 1;
  return `${prefix}_${state.seq}`;
}

function emit(sim: RunSim, step: (typeof D.SCRIPT)[number]) {
  const { pause: _p, ...rest } = step;
  const e: T.RunEvent = { ...rest, id: id("ev"), run_id: sim.run.id, time: now() };
  sim.events.push(e);
  if (e.type === "stage_changed" && typeof e.data?.stage === "string") sim.run.stage = e.data.stage as T.RunStage;
  if (e.type === "checkpoint_waiting") sim.run.status = "waiting_approval";
  if (e.type === "checkpoint_resolved") sim.run.status = "running";
  if (e.type === "run_finished") {
    sim.run.status = "succeeded";
    sim.run.finished_at = e.time;
    sim.run.git_commit = "a1b2c3d";
  }
  sim.listeners.forEach((l) => l(e));
}

function advance(sim: RunSim) {
  if (sim.paused || sim.step >= D.SCRIPT.length) return;
  const step = D.SCRIPT[sim.step]!;
  emit(sim, step);
  sim.step += 1;
  if (step.pause) {
    sim.paused = true;
    return;
  }
  sim.timer = setTimeout(() => advance(sim), 1400);
}

function seed() {
  if (state.workspaces.size) return;
  const ws: T.WorkspaceDetail = {
    id: "w_demo1", owner_id: D.DEMO_USER.id, title: "[DEMO] Distillation — Hinton 2015", compute_budget: "quick",
    note: "I only have a laptop, keep it under 15 minutes.", created_at: "2026-10-09T10:00:00Z", role: "owner",
    uploads: [{ id: "up1", workspace_id: "w_demo1", kind: "paper", path_or_url: "https://arxiv.org/abs/1503.02531", filename: "1503.02531", created_at: "2026-10-09T10:00:05Z" }],
    papers: [D.PAPER], runs: [], latest_push: null,
  };
  const run: T.Run = { id: "r_demo1", workspace_id: ws.id, parent_run_id: null, branch_name: "main", status: "succeeded", started_at: "2026-10-09T10:01:00Z", finished_at: "2026-10-09T10:12:40Z", git_commit: "a1b2c3d", stage: "done", compute_budget: "quick" };
  const sim: RunSim = { run, events: [], step: 0, paused: false, listeners: new Set(), timer: null, push: null };
  const base = Date.parse("2026-10-09T10:01:00Z");
  D.SCRIPT.forEach((s, i) => {
    const { pause: _p, ...rest } = s;
    const e: T.RunEvent = { ...rest, id: `ev_seed_${i}`, run_id: run.id, time: new Date(base + i * 23_000).toISOString() };
    sim.events.push(e);
  });
  sim.step = D.SCRIPT.length;
  state.runs.set(run.id, sim);
  ws.runs = [run];
  state.workspaces.set(ws.id, ws);
  state.notes.set(ws.id, [
    { id: "n1", workspace_id: ws.id, author: { type: "user", id: D.DEMO_USER.id, name: "Demo Researcher" }, markdown: "# Lab notes\n\n- Focus on the MNIST distillation result (§3).\n- Keep runs under 15 minutes.", updated_at: "2026-10-09T10:00:00Z" },
    { id: "n2", workspace_id: ws.id, author: { type: "agent", id: "a_coding", name: "Coding Agent" }, markdown: "Pinned `numpy<2` — fix reused from Lab Memory (m_17).", updated_at: "2026-10-09T10:06:00Z" },
  ]);
}

function sharedWorkspace(token: string) {
  return token.startsWith("demo") ? state.workspaces.get("w_demo1") ?? null : null;
}

function mapProgress(sim: RunSim) {
  const stage = sim.run.stage ?? "research";
  return { research: 0.5, plan_approval: 1, coding: 2, testing: 3, whatifs: 4, push: 4, done: 4 }[stage];
}

const match = (path: string, def: EndpointDef) => {
  const names: string[] = [];
  const re = new RegExp("^" + def.template.replace(/\{(\w+)\}/g, (_, n: string) => (names.push(n), "([^/]+)")) + "$");
  const m = path.match(re);
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m?.[i + 1] ?? "")]));
};

export async function mockTransport(url: string, init: RequestInit, def: EndpointDef, path: string): Promise<Response> {
  seed();
  await delay(250);
  const p = match(path, def);
  const q = new URL(url, "http://demo").searchParams;
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  const sim = p.id ? state.runs.get(p.id) : undefined;
  const authed = !loggedOut();

  if (def.key !== "sharedView" && !def.key.startsWith("shared") && !authed) return err(401, "Not signed in (demo)");

  switch (def.key) {
    case "me":
      return json({ user: D.DEMO_USER, github: state.github });
    case "authLogout":
      sessionStorage.setItem(LOGGED_OUT_KEY, "1");
      return new Response(null, { status: 204 });
    case "myPushes":
      return json(state.pushes);
    case "listRepos":
      return state.github.status === "connected" ? json(state.repos) : err(409, "GitHub is not connected");
    case "createRepo": {
      const b = body as T.CreateRepoRequest;
      if (state.repos.some((r) => r.name === b.name)) return err(422, `A repository named "${b.name}" already exists`);
      const repo: T.GithubRepo = { id: id("repo"), name: b.name, full_name: `demo-researcher/${b.name}`, private: b.private, html_url: `https://github.com/demo-researcher/${b.name}`, description: b.description ?? null, can_push: true };
      state.repos.unshift(repo);
      return json(repo, 201);
    }
    case "setDefaultRepo":
      state.github = { ...state.github, default_repo: (body as T.SetDefaultRepoRequest).full_name };
      return json(state.github);
    case "disconnectGithub":
      state.github = { status: "not_connected", scopes: [], default_repo: null, connected_at: null };
      return new Response(null, { status: 204 });
    case "listWorkspaces":
      return json([...state.workspaces.values()].map((w) => ({ ...w, latest_run: w.runs?.at(-1) ?? null, paper_count: w.papers?.length ?? 0, repo_url: w.latest_push?.repo_url ?? null })));
    case "createWorkspace": {
      const b = body as T.CreateWorkspaceRequest;
      if (!b.title?.trim()) return json({ error: { message: "Title is required", fields: { title: "Required" } } }, 422);
      const ws: T.WorkspaceDetail = { id: id("w"), owner_id: D.DEMO_USER.id, title: b.title, compute_budget: b.compute_budget, note: b.note ?? null, created_at: now(), role: "owner", uploads: [], papers: [], runs: [], latest_push: null };
      state.workspaces.set(ws.id, ws);
      return json(ws, 201);
    }
    case "getWorkspace": {
      const ws = state.workspaces.get(p.id!);
      return ws ? json(ws) : err(404, "Workspace not found");
    }
    case "uploadToWorkspace": {
      const ws = state.workspaces.get(p.id!);
      if (!ws) return err(404, "Workspace not found");
      const f = init.body as FormData;
      const file = f.get("file") as File | null;
      const kind = f.get("kind") as T.UploadKind;
      const up: T.Upload = { id: id("up"), workspace_id: ws.id, kind, path_or_url: (f.get("url") as string) || `uploads/${file?.name}`, filename: file?.name ?? null, size_bytes: file?.size ?? null, created_at: now() };
      ws.uploads = [...(ws.uploads ?? []), up];
      if (kind === "paper") ws.papers = [...(ws.papers ?? []), { id: id("p"), workspace_id: ws.id, title: file?.name ?? up.path_or_url, arxiv_id: null, summary: null }];
      return json(up, 201);
    }
    case "getNotes":
      return json(state.notes.get(p.id!) ?? []);
    case "putNotes": {
      const list = state.notes.get(p.id!) ?? [];
      const mine = list.find((n) => typeof n.author === "object" && n.author.type === "user");
      const note: T.Note = { id: mine?.id ?? id("n"), workspace_id: p.id!, author: { type: "user", id: D.DEMO_USER.id, name: "Demo Researcher" }, markdown: (body as T.UpdateNotesRequest).markdown, updated_at: now() };
      state.notes.set(p.id!, [note, ...list.filter((n) => n.id !== note.id)]);
      return json(note);
    }
    case "shareWorkspace":
      return json({ token: `demo-${p.id}`, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    case "startRun": {
      const ws = state.workspaces.get(p.id!);
      if (!ws) return err(404, "Workspace not found");
      if (!ws.papers?.length) return err(422, "Upload at least one paper before starting a run");
      const run: T.Run = { id: id("r"), workspace_id: ws.id, parent_run_id: null, branch_name: "main", status: "running", started_at: now(), finished_at: null, git_commit: null, stage: "research", compute_budget: (body as T.StartRunRequest).compute_budget };
      const s: RunSim = { run, events: [], step: 0, paused: false, listeners: new Set(), timer: null, push: null };
      state.runs.set(run.id, s);
      ws.runs = [...(ws.runs ?? []), run];
      s.timer = setTimeout(() => advance(s), 800);
      return json(run, 201);
    }
    case "getRun":
      return sim ? json(sim.run) : err(404, "Run not found");
    case "runEvents":
      return sim ? json(sim.events) : err(404, "Run not found");
    case "checkpoint": {
      if (!sim) return err(404, "Run not found");
      const b = body as T.CheckpointRequest;
      if (!sim.paused) return err(409, "No checkpoint is waiting");
      if (b.decision === "reject") {
        sim.run.status = "stopped";
        emit(sim, { agent: "manager", type: "checkpoint_resolved", message: `Plan rejected${b.instructions ? `: ${b.instructions}` : ""}`, data: { checkpoint: p.name } });
        emit(sim, { agent: "manager", type: "run_failed", message: "Run stopped by researcher at Checkpoint 1" });
        sim.paused = false;
        sim.step = D.SCRIPT.length;
        return json({ name: p.name, decision: b.decision, run: sim.run });
      }
      sim.paused = false;
      if (b.decision === "edit") {
        D.SCRIPT[sim.step] = { ...D.SCRIPT[sim.step]!, message: `Plan approved with edits: ${b.instructions}` };
      }
      sim.timer = setTimeout(() => advance(sim), 300);
      return json({ name: p.name, decision: b.decision, run: sim.run });
    }
    case "agentAction": {
      if (!sim) return err(404, "Run not found");
      const b = body as T.AgentActionRequest;
      const map: Record<string, string> = { pause: "agent_paused", resume: "agent_resumed", stop: "agent_stopped", retry: "task_started", instruct: "task_progress", thumbs_up: "task_progress", thumbs_down: "task_progress" };
      const msg = b.action === "instruct" ? `Instruction received: ${b.instruction}` : `Researcher action: ${b.action}`;
      emit(sim, { agent: p.agent!, type: map[b.action] ?? "task_progress", message: msg, why: "Researcher control (demo)" });
      return json({ agent: p.agent, action: b.action, accepted: true });
    }
    case "scorecard":
      if (!sim) return err(404, "Run not found");
      return json(sim.step > 24 ? D.demoScorecard(sim.run.id) : D.demoScorecard(sim.run.id).map((e) => ({ ...e, metric: null, difference: null, status: null })));
    case "settings":
      return sim ? json(D.demoSettings(sim.run.id)) : err(404, "Run not found");
    case "brief":
      return sim && sim.step >= 10 ? json(D.demoBrief(sim.run.id)) : err(404, "Research Brief not ready yet");
    case "files":
      return sim && sim.step >= 16 ? json(D.DEMO_FILES) : json([]);
    case "fileContent":
      return new Response(D.DEMO_FILE_CONTENT[q.get("path") ?? ""] ?? "", { headers: { "content-type": "text/plain" } });
    case "tests":
      return sim && sim.step >= 24 ? json(D.demoTests(sim.run.id)) : json({ run_id: p.id, tests: [] });
    case "gaps":
      return sim && sim.step >= 25 ? json(D.demoGaps(sim.run.id)) : err(404, "No gap analysis yet");
    case "map":
      return sim ? json(D.demoMap(sim.run.id, mapProgress(sim))) : err(404, "Run not found");
    case "runMemory":
      return json({ learned: [D.DEMO_MEMORY[1], D.DEMO_MEMORY[2]], reused: [{ item: D.DEMO_MEMORY[0], used_at: "2026-10-09T10:06:00Z", agent: "coding.debugger" }] });
    case "listWhatIfs":
      return sim && sim.step >= 28 ? json(D.demoWhatIfs(sim.run.id)) : json([]);
    case "createWhatIf": {
      const b = body as T.WhatIfRequest;
      if (!b.question?.trim()) return err(422, "Ask a question");
      return json({ branches: [{ id: id("wf"), run_id: p.id, question: b.question, settings_change: {}, status: "queued", result_metric: null, suggested_by: "researcher" }] }, 201);
    }
    case "push": {
      if (!sim) return err(404, "Run not found");
      if (state.github.status !== "connected") return err(409, "Connect GitHub before pushing");
      const b = body as T.PushRequest;
      const repo = b.repo_full_name ?? state.github.default_repo;
      if (!repo) return err(422, "Choose a repository first");
      const push: T.Push = { id: id("push"), run_id: sim.run.id, repo_url: null, commit_urls: [], status: "scanning", secret_scan_result: null, created_at: now() };
      sim.push = push;
      setTimeout(() => {
        push.secret_scan_result = { passed: true, findings: [] };
        push.status = "pushing";
      }, 1500);
      setTimeout(() => {
        const base = `https://github.com/${repo}`;
        push.status = "succeeded";
        push.repo_url = base;
        push.commit_urls = ["Add research brief and claims", "Add implementation", "Add tests and results", "Add what-if: temperature sweep"].map((m, i) => ({ message: m, url: `${base}/commit/demo${i}`, branch: i === 3 ? "whatif/temp-10" : "main" }));
        const ws = state.workspaces.get(sim.run.workspace_id);
        state.pushes.unshift({ ...push, workspace_id: ws?.id, workspace_title: ws?.title });
        if (ws) ws.latest_push = push;
      }, 4000);
      return json(push, 202);
    }
    case "pushStatus":
      return sim?.push ? json(sim.push) : err(404, "No push for this run");
    case "agents":
      return json(D.DEMO_AGENTS);
    case "agentHistory": {
      const a = D.DEMO_AGENTS.find((x) => x.id === p.id);
      if (!a) return err(404, "Agent not found");
      return json({
        agent: a,
        versions: a.current_version ? [a.current_version] : [],
        tasks: [0.62, 0.71, 0.8, a.avg_score ?? 0.5].map((s, i) => ({ id: `${a.id}_t${i}`, run_id: `r_demo${i}`, agent_id: a.id, skill: a.current_version?.skill_tags[0] ?? "task", outcome: s, feedback: i % 2 ? 1 : 0, tokens: 1200 + i * 300, sandbox_seconds: 30 * i, wasted_tries: i % 3 === 0 ? 1 : 0, score: s, created_at: new Date(Date.parse("2026-10-01") + i * 86_400_000).toISOString() })),
        decisions: D.DEMO_DECISIONS.filter((d) => d.agent_ids.includes(a.id)),
      });
    }
    case "memorySearch": {
      const term = (q.get("q") ?? "").toLowerCase();
      return json(D.DEMO_MEMORY.filter((m) => !term || m.text.toLowerCase().includes(term) || m.kind.includes(term)).map((m) => ({ ...m, similarity: 0.82 })));
    }
    case "sharedView": {
      const ws = sharedWorkspace(p.token!);
      return ws ? json({ workspace: ws, run: ws.runs?.at(-1) ?? null, expires_at: null }) : err(404, "Share link expired or invalid");
    }
    case "sharedEvents": {
      const ws = sharedWorkspace(p.token!);
      const r = ws?.runs?.at(-1);
      return r ? json(state.runs.get(r.id)?.events ?? []) : err(404, "Share link expired or invalid");
    }
    case "sharedScorecard":
      return json(D.demoScorecard("r_demo1"));
    default:
      return err(404, "Not implemented in demo backend");
  }
}

/** Demo EventSource: replays nothing (history comes from /events) and forwards new events. */
export function createMockEventSource(def: EndpointDef, params: Record<string, string>): EventSourceLike {
  seed();
  let runId = params.id;
  if (def.key === "sharedStream") runId = sharedWorkspace(params.token ?? "")?.runs?.at(-1)?.id;
  const sim = runId ? state.runs.get(runId) : undefined;
  const listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
  const src: EventSourceLike = {
    readyState: 0,
    onopen: null,
    onerror: null,
    addEventListener(type, l) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
    },
    close() {
      src.readyState = 2;
      if (sim) sim.listeners.delete(forward);
    },
  };
  const forward = (e: T.RunEvent) => {
    listeners.get("message")?.forEach((l) => l(new MessageEvent("message", { data: JSON.stringify(e), lastEventId: e.id })));
  };
  setTimeout(() => {
    if (src.readyState === 2) return;
    if (!sim) {
      src.readyState = 2;
      src.onerror?.(new Event("error"));
      return;
    }
    src.readyState = 1;
    src.onopen?.(new Event("open"));
    sim.listeners.add(forward);
  }, 200);
  return src;
}
