# Remaining Work (prioritised by dependency)

Owner codes: FE frontend · BE Go backend · PY Python/AI · DB database · INF infrastructure · SH shared. Size S/M/L. All tasks are **Open**.

## P0 — critical blockers

| ID | Component | Issue (evidence) | Files | Depends | Owner | Size | Acceptance criteria | Test |
|---|---|---|---|---|---|---|---|---|
| T01 | Sandbox | SEC-01 host-side git in a mounted dir | `sandbox/sandbox.go` | — | BE | S | sandbox code cannot cause host execution through `.git` | Go unit test with planted hook/fsmonitor → sentinel absent |
| T02 | Infra | ENV-01: no Redis, Docker stopped, no images | compose, `infra/sandbox-images` | — | INF | S | `curl /healthz` shows db, redis, agents, docker, image all ok | healthz smoke script |
| T03 | API | INT-01 CORS headers | `httpx/httpx.go` | — | BE | S | preflight with `X-Requested-With` → 204 with allow headers | Go handler test |
| T04 | SSE | INT-07 named events dropped | `runs/runs.go` stream, `frontend/src/lib/api/sse.ts` | — | BE+FE | S | every saved event appears live in the browser | Go test reads stream; FE unit test |
| T05 | Core contracts | INT-02/03/05/11 create, link upload, checkpoint, scorecard | `services.ts`, `types.ts` (adapter) | T03 | FE | M | new workspace with an arXiv link → run → plan approval → scorecard shows `ours` values | vitest adapter tests from recorded BE JSON |

## P1 — minimum complete workflow

| ID | Component | Issue | Depends | Owner | Size | Acceptance |
|---|---|---|---|---|---|---|
| T06 | FE | INT-04/06/08/09: workspace detail, agent controls, map/brief, `/me` mapping | T05 | FE | M | overview, live board controls, map and profile render from the real API |
| T07 | FE/BE | Dev login button + INT-10 login redirect | T03 | FE+BE | S | dev login works locally; GitHub login returns to the original page |
| T08 | SH | First real end-to-end run on arXiv 1503.02531 (quick budget, `SANDBOX_MODE=docker`) | T01,T02,T04,T05 | SH | M | run reaches `completed`; metrics have exec/log hash/commit; scorecard filled; events replay |
| T09 | Queue | REL-01 reliable jobs/events (processing list + ack or Streams) | T02 | BE+PY | M | killing the worker mid-job re-delivers it; no lost events |
| T10 | Publish | INT-12 push FE mapping + REL-02 callback timeout | T08 | FE+BE | S | blocked-scan and success cases both shown; stuck push fails after timeout |
| T11 | Security | SEC-06 rotate the shared secrets; SEC-07 dev login off for demo; SEC-02 guard local sandbox | — | SH | S | new keys in `.env`; tunnel URL refuses dev-login |
| T12 | Tests | integration test (Postgres+Redis) for start run → resume checkpoint | T08 | BE+PY | M | CI-runnable test passes |

## P2 — remaining in-scope features

| ID | Item | Owner | Size |
|---|---|---|---|
| T13 | GitHub OAuth app + verify login/repos/push via n8n and direct fallback | SH | M |
| T14 | Voice / typed command UI in the mobile web app (Must-build #12) | FE | M |
| T15 | `/runs/{id}/tests` and `/runs/{id}/memory` endpoints + tabs; memory-reuse demo across two runs (Hero 6) | BE+FE | M |
| T16 | Share view paths (INT-13), `/agents` list (INT-14), proof hover card (`/metrics/{id}/proof`) | FE+BE | S |
| T17 | What-if end-to-end run with successive halving visible in the tree | SH | M |
| T18 | Gap Detective run with a "Different" claim; explanation passes the proof check | SH | M |
| T19 | Proof-check all AI prose shown to users (HERO2-01) | PY+BE | S |
| T20 | Generic (non-recipe) paper path: run one backup paper (e.g. PINN/KAN) via LLM writer | PY | L |
| T21 | PDF highlight overlay (react-pdf + `position_on_page`) | FE | M |
| T22 | Collaborators: invite editor/viewer to a workspace | BE+FE | M |
| T23 | SEC-04/05 constant-time internal token, scoped n8n callback token, CSRF header check | BE | S |
| T24 | Paper vs Paper mode (Hero 10) | PY+FE | L |
| T25 | Audio briefing (Kokoro TTS or browser speech fallback) | PY+FE | M |

## P3 — hardening and polish
T26 CI (GitHub Actions: go vet/test, pytest in venv, tsc/lint/vitest/build) · T27 DB indexes + migration advisory lock + vector index · T28 Playwright E2E · T29 dark mode · T30 Excalidraw map · T31 Cloudflare Tunnel + pre-recorded demo run · T32 remove Manager leftovers & stale docs (DOC-01…06) · T33 `.gitattributes` LF for Go, pytest `testpaths` · T34 govulncheck / npm audit / pip-audit · T35 retention of `run_events` and run folders · T36 Kaggle offload (optional).

## First five tasks, and why
1. **T02 Infra up**: nothing can be verified until Redis and Docker run. This takes minutes.
2. **T01 Sandbox git fix**: must land before any AI-written code executes on the demo laptop.
3. **T03 CORS**: a one-line change that unblocks every browser mutation.
4. **T04 SSE named events**: a two-line backend change that makes the Live Board actually live.
5. **T05 Core contract adapter**: the shortest path to a researcher completing create → upload → run → approve → scorecard in the real UI. That unlocks T08, the first genuine end-to-end evidence.
