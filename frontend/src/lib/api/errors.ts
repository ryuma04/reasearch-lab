import type { ApiErrorBody } from "./types";
import type { EndpointDef } from "./endpoints";

export type ApiErrorKind =
  | "network" // backend unreachable / CORS / offline
  | "timeout"
  | "aborted"
  | "unauthorized" // 401 — session missing or expired
  | "forbidden" // 403 — no permission (e.g. GitHub scope, workspace role)
  | "not_found" // 404 with a JSON body — the resource does not exist
  | "unavailable" // route not implemented on the backend (404 non-JSON, 405, 501)
  | "validation" // 400 / 422
  | "conflict" // 409 (e.g. GitHub not connected, checkpoint already resolved)
  | "too_large" // 413
  | "rate_limited" // 429
  | "server" // 5xx
  | "parse"; // malformed JSON

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly fields: Record<string, string>;
  readonly endpoint: EndpointDef | null;

  constructor(opts: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    code?: string | null;
    fields?: Record<string, string>;
    endpoint?: EndpointDef | null;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.kind = opts.kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.fields = opts.fields ?? {};
    this.endpoint = opts.endpoint ?? null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function kindFromStatus(status: number, jsonBody: boolean): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return jsonBody ? "not_found" : "unavailable";
  if (status === 405 || status === 501) return "unavailable";
  if (status === 400 || status === 422) return "validation";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "server";
}

export function parseErrorBody(body: unknown): { message: string | null; code: string | null; fields: Record<string, string> } {
  if (!body || typeof body !== "object") return { message: null, code: null, fields: {} };
  const b = body as ApiErrorBody;
  if (typeof b.error === "string") return { message: b.error, code: b.code ?? null, fields: b.fields ?? {} };
  if (b.error && typeof b.error === "object") {
    return { message: b.error.message ?? null, code: b.error.code ?? null, fields: b.error.fields ?? {} };
  }
  return { message: b.message ?? null, code: b.code ?? null, fields: b.fields ?? {} };
}

const FRIENDLY: Record<ApiErrorKind, string> = {
  network: "Can't reach the research backend. Check that it is running and reachable.",
  timeout: "The backend took too long to respond. Please try again.",
  aborted: "The request was cancelled.",
  unauthorized: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find that item. It may have been removed.",
  unavailable: "This backend endpoint isn't available yet.",
  validation: "Some details need fixing before we can continue.",
  conflict: "That action conflicts with the current state. Refresh and try again.",
  too_large: "That file is larger than the backend allows.",
  rate_limited: "Too many requests right now. Wait a moment and retry.",
  server: "The backend hit an error. Please retry in a moment.",
  parse: "The backend sent a response we couldn't read.",
};

/** Human message for the UI. Server-provided messages win for validation/conflict/forbidden. */
export function userMessage(err: unknown): string {
  if (isApiError(err)) {
    const serverMsg = err.message && err.message !== err.kind ? err.message : null;
    if (serverMsg && ["validation", "conflict", "forbidden", "not_found", "too_large"].includes(err.kind)) {
      return serverMsg;
    }
    return FRIENDLY[err.kind];
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
