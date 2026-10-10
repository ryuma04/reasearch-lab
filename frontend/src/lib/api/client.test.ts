import { afterEach, describe, expect, it, vi } from "vitest";
import { __setTransport, request, unwrapList } from "./client";
import { ENDPOINTS, buildPath } from "./endpoints";
import { isApiError, userMessage, type ApiError } from "./errors";
import { githubLoginUrl } from "./services";

afterEach(() => __setTransport(null));

const fail = (p: Promise<unknown>): Promise<ApiError> => p.then(() => { throw new Error("expected failure"); }, (e: ApiError) => e);

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("endpoints", () => {
  it("encodes path params and rejects missing ones", () => {
    expect(buildPath(ENDPOINTS.agentAction, { id: "r 1", agent: "coding.debugger" })).toBe("/runs/r%201/agents/coding.debugger/action");
    expect(() => buildPath(ENDPOINTS.getWorkspace, {})).toThrow();
  });
  it("never exposes internal or webhook routes", () => {
    const paths = Object.values(ENDPOINTS).map((e) => e.template);
    expect(paths.some((p) => p.startsWith("/internal") || p.includes("telegram"))).toBe(false);
  });
});

describe("request", () => {
  it("sends credentials, a JSON body and the CSRF header on mutations", async () => {
    const t = vi.fn(async (_url: string, _init: RequestInit) => jsonRes({ id: "w1" }, 201));
    __setTransport(t);
    await request(ENDPOINTS.createWorkspace, { body: { title: "x", compute_budget: "quick" } });
    const [url, init] = t.mock.calls[0]!;
    expect(url).toMatch(/\/workspaces$/);
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(init.body).toBe(JSON.stringify({ title: "x", compute_budget: "quick" }));
  });

  it("does not set Content-Type for multipart bodies", async () => {
    const t = vi.fn(async (_u: string, _i: RequestInit) => jsonRes({}));
    __setTransport(t);
    const form = new FormData();
    form.set("kind", "paper");
    await request(ENDPOINTS.uploadToWorkspace, { params: { id: "w1" }, form });
    expect((t.mock.calls[0]![1].headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("maps validation and auth errors and parses error envelopes", async () => {
    __setTransport(async () => jsonRes({ error: { message: "nope", fields: { title: "Required" } } }, 422));
    const err = await fail(request(ENDPOINTS.createWorkspace, { body: {} }));
    expect(isApiError(err) && err.kind).toBe("validation");
    expect(err.fields.title).toBe("Required");
    expect(userMessage(err)).toBe("nope");
    __setTransport(async () => jsonRes({ error: "x" }, 401));
    expect((await fail(request(ENDPOINTS.me))).kind).toBe("unauthorized");
  });

  it("treats a non-JSON 404 as a missing route and a JSON 404 as not_found", async () => {
    __setTransport(async () => new Response("404 page not found", { status: 404, headers: { "content-type": "text/plain" } }));
    expect((await fail(request(ENDPOINTS.brief, { params: { id: "r" } }))).kind).toBe("unavailable");
    __setTransport(async () => jsonRes({ error: "no run" }, 404));
    expect((await fail(request(ENDPOINTS.brief, { params: { id: "r" } }))).kind).toBe("not_found");
  });

  it("maps network failures and returns undefined for 204", async () => {
    __setTransport(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await fail(request(ENDPOINTS.me))).kind).toBe("network");
    __setTransport(async () => new Response(null, { status: 204 }));
    await expect(request(ENDPOINTS.disconnectGithub)).resolves.toBeUndefined();
  });

  it("returns an empty string (never undefined) for an empty text file such as an empty log", async () => {
    __setTransport(async () => new Response("", { status: 200, headers: { "content-type": "text/plain", "content-length": "0" } }));
    await expect(request<string>(ENDPOINTS.fileContent, { params: { id: "r" }, query: { path: "logs/install-71.log" }, responseType: "text" })).resolves.toBe("");
  });
});

describe("helpers", () => {
  it("unwraps list envelopes", () => {
    expect(unwrapList([1], "x")).toEqual([1]);
    expect(unwrapList({ entries: [2] }, "entries")).toEqual([2]);
    expect(unwrapList({ items: [3] })).toEqual([3]);
    expect(unwrapList(null)).toEqual([]);
  });
  it("only allows relative return paths in the login URL", () => {
    expect(githubLoginUrl("/workspaces/1")).toContain("return_to=%2Fworkspaces%2F1");
    expect(githubLoginUrl("https://evil.example")).toContain("return_to=%2Fdashboard");
    expect(githubLoginUrl("//evil.example")).toContain("return_to=%2Fdashboard");
  });
});
