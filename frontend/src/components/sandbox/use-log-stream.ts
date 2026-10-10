"use client";

import * as React from "react";
import { sandboxApi } from "@/lib/api/services";

const MAX_CHARS = 400_000; // keep the browser responsive; the full log stays on the backend

/**
 * Follows an execution's real log file by offset (GET /sandbox/executions/{id}/logs) until the
 * backend reports it complete. Nothing is generated client-side.
 */
export function useLogStream(execId: string | null, stream: "combined" | "stderr", intervalMs = 700) {
  const [text, setText] = React.useState("");
  const [complete, setComplete] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [truncated, setTruncated] = React.useState(false);

  React.useEffect(() => {
    setText("");
    setComplete(false);
    setError(null);
    setTruncated(false);
    if (!execId) return;
    const ctrl = new AbortController();
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      try {
        const chunk = await sandboxApi.logs(execId, stream, offset, ctrl.signal);
        if (stopped) return;
        if (chunk.content) {
          setText((prev) => {
            const next = prev + chunk.content;
            if (next.length > MAX_CHARS) {
              setTruncated(true);
              return next.slice(next.length - MAX_CHARS);
            }
            return next;
          });
        }
        offset = chunk.next_offset;
        setError(null);
        if (chunk.complete && chunk.next_offset >= chunk.size) {
          setComplete(true);
          return;
        }
        // More data already waiting: read it at once; otherwise poll.
        timer = setTimeout(tick, chunk.next_offset < chunk.size ? 0 : intervalMs);
      } catch (e) {
        if (stopped) return;
        setError(e);
        timer = setTimeout(tick, intervalMs * 3);
      }
    };
    void tick();
    return () => {
      stopped = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [execId, stream, intervalMs]);

  return { text, complete, error, truncated };
}
