# Integration Plan

Goal: one genuine end-to-end run of the demo paper in the real UI, then widen it. Each phase ends with evidence (logs/screenshots) stored under `audit/evidence/`.

## Phase 0 — make the stack runnable (T02, T11)
1. Start Docker Desktop. Run `docker compose up -d redis`. Postgres is Neon via `.env`; alternatively run `docker compose up -d postgres` and point `DATABASE_URL` at `localhost:5433` to keep demo data off the shared DB.
2. Run `docker build -t tapu-sena/sandbox-python:latest infra/sandbox-images/python`.
3. Start the API: `cd backend && go run ./cmd/server`. Start the agents: `cd agents && ../.venv/Scripts/python -m uvicorn app:app --port 8001`.
4. **Exit check:** `GET /healthz` returns `ok:true` with sandbox `image_present:true`.

## Phase 1 — safe core loop (T01, T03, T04, T05)
1. Fix SEC-01 (git metadata outside the mount, hooks/fsmonitor disabled) with a unit test.
2. Fix CORS headers. Remove the `event:` line from SSE and add an `event: heartbeat`.
3. Add the adapter layer in `services.ts` (contract items 2, 3, 8, 10 of FRONTEND_INTEGRATION_NOTES) with vitest fixtures recorded from real BE responses.
4. **Exit check:** API-level smoke via curl: dev-login → JSON `POST /workspaces` → JSON `POST /uploads {kind:"paper",url:"arXiv:1503.02531"}` → `POST /runs` → watch `/runs/{id}/stream` → `POST /checkpoints/plan {action:"approve"}` → run completes → `GET /scorecard` has `ours` with `log_file_hash`.

## Phase 2 — UI end to end (T06, T07, T08, T10)
1. Dev-login button. Fix the workspace overview, live board controls (`run` agent), map/brief, and profile mapping.
2. Drive the same flow from the browser (desktop + 375 px mobile).
3. Publish: verify the blocked-scan case using a planted fake key in a test project; the success case needs T13 (OAuth app).
4. **Exit check:** screenshots of the live board, plan approval, scorecard with proof, and replay.

## Phase 3 — reliability & remaining heroes (T09, T12–T19)
Reliable queue → integration test in CI → what-if and gap runs → memory reuse across two runs → voice UI → share/QR on a phone.

## Phase 4 — demo hardening (P3)
CI, indexes, Playwright E2E, Cloudflare Tunnel, a pre-recorded run for Run Replay, removal of Manager leftovers, secret rotation before going public.

**Rule:** after each phase the end-to-end smoke from Phase 1 must still pass.
