import { USE_MOCKS } from "@/lib/config";
import { apiUrl } from "./client";
import type { EndpointDef } from "./endpoints";
import type { RunEvent, RunEventType } from "./types";

export type StreamState = "connecting" | "open" | "reconnecting" | "closed" | "failed";

export interface StreamHandlers {
  onEvent: (event: RunEvent) => void;
  onState?: (state: StreamState) => void;
}

/** Minimal EventSource surface so the demo transport can provide its own source. */
export interface EventSourceLike {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
}

/** Named SSE events we also listen for, in case the backend sets `event: <type>` (see notes). */
const NAMED_EVENTS: RunEventType[] = [
  "run_started", "run_finished", "run_failed", "stage_changed", "agent_created", "task_started",
  "task_progress", "task_done", "task_failed", "error", "fix_attempt", "fix_applied", "needs_help",
  "agent_paused", "agent_resumed", "agent_stopped", "checkpoint_waiting", "checkpoint_resolved",
  "team_decision", "memory_reused", "sandbox_started", "sandbox_finished", "test_passed", "test_failed",
  "scorecard_updated", "whatif_branch_started", "whatif_branch_stopped", "whatif_branch_done",
  "map_updated", "push_started", "push_blocked", "push_succeeded", "push_failed", "heartbeat",
];

const MAX_RETRIES = 8;

/**
 * Open an SSE stream (GET /runs/{id}/stream or /share/{token}/stream).
 * - withCredentials so the session cookie is sent.
 * - Native EventSource auto-reconnects (sending Last-Event-ID); if the source is CLOSED
 *   (HTTP error), we retry with capped exponential backoff, passing `after=<lastId>`.
 * - Returns a disposer; always call it on unmount to avoid duplicate listeners.
 */
export function openEventStream(
  def: EndpointDef,
  params: Record<string, string>,
  handlers: StreamHandlers,
  opts: { lastEventId?: () => string | undefined } = {},
): () => void {
  let source: EventSourceLike | null = null;
  let disposed = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setState = (s: StreamState) => {
    if (!disposed) handlers.onState?.(s);
  };

  const handleMessage = (ev: MessageEvent) => {
    if (disposed || typeof ev.data !== "string" || !ev.data) return;
    try {
      const parsed = JSON.parse(ev.data) as RunEvent;
      if (!parsed.id && ev.lastEventId) parsed.id = ev.lastEventId;
      retries = 0;
      handlers.onEvent(parsed);
    } catch {
      if (process.env.NODE_ENV !== "production") console.warn("[sse] unparseable event", ev.data);
    }
  };

  const connect = async () => {
    if (disposed) return;
    setState(retries === 0 ? "connecting" : "reconnecting");
    const after = opts.lastEventId?.();
    if (USE_MOCKS) {
      const { createMockEventSource } = await import("./mock/transport");
      if (disposed) return;
      source = createMockEventSource(def, params);
    } else {
      source = new EventSource(apiUrl(def, params, after ? { after } : undefined), { withCredentials: true });
    }
    const s = source;
    s.onopen = () => {
      retries = 0;
      setState("open");
    };
    s.onerror = () => {
      if (disposed) return;
      // readyState 0 = CONNECTING → the browser is already retrying.
      if (s.readyState === 0) {
        setState("reconnecting");
        return;
      }
      s.close();
      if (retries >= MAX_RETRIES) {
        setState("failed");
        return;
      }
      retries += 1;
      setState("reconnecting");
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retries));
    };
    s.addEventListener("message", handleMessage);
    for (const name of NAMED_EVENTS) s.addEventListener(name, handleMessage);
  };

  void connect();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    source?.close();
    handlers.onState?.("closed");
  };
}
