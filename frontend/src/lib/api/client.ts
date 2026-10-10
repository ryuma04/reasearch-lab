import { API_BASE_URL, REQUEST_TIMEOUT_MS, USE_MOCKS } from "@/lib/config";
import { ApiError, kindFromStatus, parseErrorBody } from "./errors";
import { buildPath, buildQuery, type EndpointDef } from "./endpoints";

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: Record<string, string>;
  query?: Query;
  /** JSON body. */
  body?: unknown;
  /** Multipart body — Content-Type is left to the browser so it can set the boundary. */
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Return raw text instead of parsing JSON (file contents). */
  responseType?: "json" | "text";
}

/** A transport turns a resolved request into a Response. Swapped for the demo backend in dev. */
export type Transport = (url: string, init: RequestInit, def: EndpointDef, path: string) => Promise<Response>;

const fetchTransport: Transport = (url, init) => fetch(url, init);

let transport: Transport = fetchTransport;
let mockReady: Promise<void> | null = null;

async function ensureTransport() {
  if (!USE_MOCKS || typeof window === "undefined") return;
  if (!mockReady) {
    mockReady = import("./mock/transport").then((m) => {
      transport = m.mockTransport;
    });
  }
  await mockReady;
}

/** Test hook. */
export function __setTransport(t: Transport | null) {
  transport = t ?? fetchTransport;
}

export function apiUrl(def: EndpointDef, params?: Record<string, string>, query?: Query): string {
  return `${API_BASE_URL}${buildPath(def, params)}${buildQuery(query)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Typed request against a registered endpoint. Always sends cookies (backend session model),
 * maps every non-2xx / network failure to ApiError, and returns undefined for 204.
 */
export async function request<T>(def: EndpointDef, opts: RequestOptions = {}): Promise<T> {
  await ensureTransport();
  const path = buildPath(def, opts.params);
  const url = `${API_BASE_URL}${path}${buildQuery(opts.query)}`;

  const headers: Record<string, string> = { Accept: opts.responseType === "text" ? "text/plain, */*" : "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (def.method !== "GET") {
    // CSRF defence-in-depth (see integration notes): custom header forces a CORS preflight,
    // and a double-submit token is echoed when the backend sets a readable csrf cookie.
    headers["X-Requested-With"] = "XMLHttpRequest";
    const csrf = readCookie("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await transport(url, { method: def.method, headers, body, credentials: "include", signal: controller.signal }, def, path);
  } catch (err) {
    if (opts.signal?.aborted) throw new ApiError({ kind: "aborted", message: "aborted", endpoint: def });
    if (controller.signal.aborted) throw new ApiError({ kind: "timeout", message: "timeout", endpoint: def });
    if (process.env.NODE_ENV !== "production") console.warn(`[api] ${def.method} ${path} network error`, err);
    throw new ApiError({ kind: "network", message: "network", endpoint: def });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    let parsed: unknown = null;
    if (isJson) parsed = await res.json().catch(() => null);
    const { message, code, fields } = parseErrorBody(parsed);
    const kind = kindFromStatus(res.status, isJson);
    if (process.env.NODE_ENV !== "production") console.warn(`[api] ${def.method} ${path} → ${res.status}`, parsed);
    throw new ApiError({ kind, status: res.status, message: message ?? kind, code, fields, endpoint: def });
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  if (opts.responseType === "text") return (await res.text()) as T;
  if (!isJson) {
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError({ kind: "parse", status: res.status, message: "parse", endpoint: def });
    }
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError({ kind: "parse", status: res.status, message: "parse", endpoint: def });
  }
}

/** Accept either a bare array or an envelope like {items:[...]}/{entries:[...]} — shape is not fixed in §23. */
export function unwrapList<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const k of [...keys, "items", "data", "results"]) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Multipart upload with real progress (XHR exposes upload progress; fetch does not).
 * Resolves only when the backend confirms with 2xx.
 */
export async function uploadWithProgress<T>(
  def: EndpointDef,
  params: Record<string, string>,
  form: FormData,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<T> {
  await ensureTransport();
  if (USE_MOCKS) {
    // Demo transport: no real bytes leave the browser; progress is reported as complete only.
    const result = await request<T>(def, { params, form, signal });
    onProgress?.({ loaded: 1, total: 1 });
    return result;
  }
  const url = apiUrl(def, params);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(def.method, url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    const csrf = readCookie("csrf_token");
    if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress?.({ loaded: ev.loaded, total: ev.total });
    };
    xhr.onload = () => {
      const isJson = (xhr.getResponseHeader("content-type") ?? "").includes("application/json");
      let parsed: unknown = null;
      if (xhr.responseText) {
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      const { message, code, fields } = parseErrorBody(parsed);
      const kind = kindFromStatus(xhr.status, isJson);
      reject(new ApiError({ kind, status: xhr.status, message: message ?? kind, code, fields, endpoint: def }));
    };
    xhr.onerror = () => reject(new ApiError({ kind: "network", message: "network", endpoint: def }));
    xhr.onabort = () => reject(new ApiError({ kind: "aborted", message: "aborted", endpoint: def }));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
