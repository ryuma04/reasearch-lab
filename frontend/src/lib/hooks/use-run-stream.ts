"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { openEventStream, type StreamState } from "@/lib/api/sse";
import { runApi, shareApi } from "@/lib/api/services";
import type { RunEvent } from "@/lib/api/types";
import { deriveBoard, mergeEvents } from "@/lib/run-state";
import { qk } from "./queries";

const STALE_AFTER_MS = 45_000;

/** Event types that should refresh a cached REST resource. */
const INVALIDATE: Record<string, (runId: string) => readonly unknown[][]> = {
  scorecard_updated: (r) => [[...qk.scorecard(r)], [...qk.gaps(r)]],
  test_passed: (r) => [[...qk.tests(r)]],
  test_failed: (r) => [[...qk.tests(r)]],
  map_updated: (r) => [[...qk.map(r)]],
  whatif_branch_started: (r) => [[...qk.whatifs(r)]],
  whatif_branch_stopped: (r) => [[...qk.whatifs(r)]],
  whatif_branch_done: (r) => [[...qk.whatifs(r)]],
  push_started: (r) => [[...qk.pushStatus(r)]],
  push_blocked: (r) => [[...qk.pushStatus(r)]],
  push_succeeded: (r) => [[...qk.pushStatus(r)], [...qk.myPushes]],
  push_failed: (r) => [[...qk.pushStatus(r)]],
  run_finished: (r) => [[...qk.run(r)]],
  run_failed: (r) => [[...qk.run(r)]],
  stage_changed: (r) => [[...qk.run(r)]],
  checkpoint_resolved: (r) => [[...qk.run(r)]],
  team_decision: () => [[...qk.agents]],
};

export interface RunStreamResult {
  events: RunEvent[];
  board: ReturnType<typeof deriveBoard>;
  state: StreamState;
  /** No event (incl. heartbeat) for STALE_AFTER_MS while the stream is "open". */
  stale: boolean;
  historyError: unknown;
  historyLoading: boolean;
}

/**
 * Loads saved events (GET /runs/{id}/events) then follows the SSE stream.
 * Events are de-duplicated by id, so reconnects / overlap never double-count.
 * Pass `{ share: token }` for the read-only shared view.
 */
export function useRunStream(target: { runId: string } | { share: string } | null, live = true): RunStreamResult {
  const qc = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [lastSeen, setLastSeen] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const eventsRef = useRef<RunEvent[]>([]);

  const key = target ? ("runId" in target ? `run:${target.runId}` : `share:${target.share}`) : null;

  useEffect(() => {
    if (!target) return;
    const ac = new AbortController();
    let dispose: (() => void) | null = null;
    eventsRef.current = [];
    setEvents([]);
    setHistoryError(null);
    setHistoryLoading(true);

    const apply = (incoming: RunEvent[]) => {
      const merged = mergeEvents(eventsRef.current, incoming);
      setLastSeen(Date.now());
      if (merged === eventsRef.current) return;
      eventsRef.current = merged;
      setEvents(merged);
    };

    const runId = "runId" in target ? target.runId : null;
    const history = runId ? runApi.events(runId, ac.signal) : shareApi.events((target as { share: string }).share, ac.signal);

    history
      .then((list) => apply(list))
      .catch((err) => {
        if (!ac.signal.aborted) setHistoryError(err);
      })
      .finally(() => {
        if (!ac.signal.aborted) setHistoryLoading(false);
      });

    if (live) {
      const def = runId ? ENDPOINTS.runStream : ENDPOINTS.sharedStream;
      const params: Record<string, string> = runId ? { id: runId } : { token: (target as { share: string }).share };
      dispose = openEventStream(
        def,
        params,
        {
          onEvent: (e) => {
            if (e.type === "heartbeat") {
              setLastSeen(Date.now());
              return;
            }
            apply([e]);
            const inv = runId ? INVALIDATE[e.type]?.(runId) : null;
            inv?.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
          },
          onState: setState,
        },
        { lastEventId: () => eventsRef.current.at(-1)?.id },
      );
    } else {
      setState("closed");
    }

    return () => {
      ac.abort();
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [live]);

  const board = useMemo(() => deriveBoard(events), [events]);
  const stale = live && state === "open" && !board.finished && now - lastSeen > STALE_AFTER_MS;

  return { events, board, state, stale, historyError, historyLoading };
}
