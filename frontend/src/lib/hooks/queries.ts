"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";
import { authApi, githubApi, memoryApi, runApi, shareApi, teamApi, workspaceApi } from "@/lib/api/services";

/** Centralised query keys so mutations can invalidate precisely. */
export const qk = {
  me: ["me"] as const,
  myPushes: ["me", "pushes"] as const,
  repos: ["github", "repos"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspace", id] as const,
  notes: (id: string) => ["workspace", id, "notes"] as const,
  run: (id: string) => ["run", id] as const,
  runEvents: (id: string) => ["run", id, "events"] as const,
  scorecard: (id: string) => ["run", id, "scorecard"] as const,
  settings: (id: string) => ["run", id, "settings"] as const,
  whatifs: (id: string) => ["run", id, "whatifs"] as const,
  brief: (id: string) => ["run", id, "brief"] as const,
  files: (id: string) => ["run", id, "files"] as const,
  file: (id: string, path: string) => ["run", id, "file", path] as const,
  tests: (id: string) => ["run", id, "tests"] as const,
  gaps: (id: string) => ["run", id, "gaps"] as const,
  map: (id: string) => ["run", id, "map"] as const,
  runMemory: (id: string) => ["run", id, "memory"] as const,
  briefing: (id: string) => ["run", id, "briefing"] as const,
  pushStatus: (id: string) => ["run", id, "push"] as const,
  agents: ["agents"] as const,
  memorySearch: (q: string) => ["memory", "search", q] as const,
  shared: (t: string) => ["share", t] as const,
  sharedEvents: (t: string) => ["share", t, "events"] as const,
  sharedScorecard: (t: string) => ["share", t, "scorecard"] as const,
};

/** Never retry client errors / missing endpoints; retry transient failures twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error)) {
    if (["unauthorized", "forbidden", "not_found", "unavailable", "validation", "conflict", "aborted"].includes(error.kind)) return false;
  }
  return failureCount < 2;
}

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export const useMe = (o?: Opts<Awaited<ReturnType<typeof authApi.me>>>) =>
  useQuery({ queryKey: qk.me, queryFn: ({ signal }) => authApi.me(signal), staleTime: 60_000, ...o });
export const useMyPushes = () => useQuery({ queryKey: qk.myPushes, queryFn: ({ signal }) => authApi.myPushes(signal) });
export const useRepos = (enabled = true) =>
  useQuery({ queryKey: qk.repos, queryFn: ({ signal }) => githubApi.listRepos(signal), enabled });

export const useWorkspaces = () => useQuery({ queryKey: qk.workspaces, queryFn: ({ signal }) => workspaceApi.list(signal) });
export const useWorkspace = (id: string) =>
  useQuery({ queryKey: qk.workspace(id), queryFn: ({ signal }) => workspaceApi.get(id, signal), enabled: !!id });
export const useNotes = (id: string) =>
  useQuery({ queryKey: qk.notes(id), queryFn: ({ signal }) => workspaceApi.notes(id, signal), enabled: !!id });

export const useRun = (id: string | null, refetchInterval?: number | false) =>
  useQuery({ queryKey: qk.run(id ?? ""), queryFn: ({ signal }) => runApi.get(id!, signal), enabled: !!id, refetchInterval });
export const useRunEvents = (id: string | null) =>
  useQuery({ queryKey: qk.runEvents(id ?? ""), queryFn: ({ signal }) => runApi.events(id!, signal), enabled: !!id });
export const useScorecard = (id: string | null) =>
  useQuery({ queryKey: qk.scorecard(id ?? ""), queryFn: ({ signal }) => runApi.scorecard(id!, signal), enabled: !!id });
export const useSettings = (id: string | null) =>
  useQuery({ queryKey: qk.settings(id ?? ""), queryFn: ({ signal }) => runApi.settings(id!, signal), enabled: !!id });
export const useWhatIfs = (id: string | null, refetchInterval?: number | false) =>
  useQuery({ queryKey: qk.whatifs(id ?? ""), queryFn: ({ signal }) => runApi.whatIfs(id!, signal), enabled: !!id, refetchInterval });
export const useBrief = (id: string | null) =>
  useQuery({ queryKey: qk.brief(id ?? ""), queryFn: ({ signal }) => runApi.brief(id!, signal), enabled: !!id });
export const useRunFiles = (id: string | null) =>
  useQuery({ queryKey: qk.files(id ?? ""), queryFn: ({ signal }) => runApi.files(id!, signal), enabled: !!id });
export const useFileContent = (id: string | null, path: string | null) =>
  useQuery({
    queryKey: qk.file(id ?? "", path ?? ""),
    queryFn: ({ signal }) => runApi.fileContent(id!, path!, signal),
    enabled: !!id && !!path,
  });
export const useTests = (id: string | null) =>
  useQuery({ queryKey: qk.tests(id ?? ""), queryFn: ({ signal }) => runApi.tests(id!, signal), enabled: !!id });
export const useGaps = (id: string | null) =>
  useQuery({ queryKey: qk.gaps(id ?? ""), queryFn: ({ signal }) => runApi.gaps(id!, signal), enabled: !!id });
export const useResearchMap = (id: string | null) =>
  useQuery({ queryKey: qk.map(id ?? ""), queryFn: ({ signal }) => runApi.map(id!, signal), enabled: !!id });
export const useRunMemory = (id: string | null) =>
  useQuery({ queryKey: qk.runMemory(id ?? ""), queryFn: ({ signal }) => runApi.memory(id!, signal), enabled: !!id });
export const useBriefing = (id: string | null) =>
  useQuery({ queryKey: qk.briefing(id ?? ""), queryFn: ({ signal }) => runApi.briefing(id!, signal), enabled: !!id });
export const usePushStatus = (
  id: string | null,
  refetchInterval?: number | false | ((q: { state: { data: Awaited<ReturnType<typeof runApi.pushStatus>> | undefined } }) => number | false),
) =>
  useQuery({ queryKey: qk.pushStatus(id ?? ""), queryFn: ({ signal }) => runApi.pushStatus(id!, signal), enabled: !!id, refetchInterval });

export const useAgents = () => useQuery({ queryKey: qk.agents, queryFn: ({ signal }) => teamApi.agents(signal) });
export const useMemorySearch = (q: string) =>
  useQuery({ queryKey: qk.memorySearch(q), queryFn: ({ signal }) => memoryApi.search(q, signal), enabled: q.trim().length > 1 });

export const useSharedView = (t: string) => useQuery({ queryKey: qk.shared(t), queryFn: ({ signal }) => shareApi.view(t, signal) });
export const useSharedScorecard = (t: string, runId: string | null) =>
  useQuery({ queryKey: [...qk.sharedScorecard(t), runId], queryFn: ({ signal }) => shareApi.scorecard(t, runId!, signal), enabled: !!runId });
