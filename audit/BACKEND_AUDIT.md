# Go Backend Audit (`backend/`)

**Build:** `go build ./...` ✓ · `go vet ./...` clean · `go test ./...` ✓ (auth, proof, workspace; 12 packages have no tests) · Go 1.27.1, chi v5, pgx v5, go-redis v9.
**Runtime:** NOT STARTED. `bus.New` requires Redis (not installed); the Docker daemon is not running; `DATABASE_URL` now points at Neon (reachability not tested).

## Startup & cross-cutting

| Area | Implementation | Status / defects |
|---|---|---|
| Config | `config.Load` reads `.env` (walks up 3 dirs); validates key length, session secret, internal token, sandbox mode | IMPLEMENTED. `GroqAPIKey` → first key only for health; `FastModel` default `llama-3.1-8b-instant` contradicts spec note (Llama unavailable) |
| Migrations | embedded, ordered, each in a tx, `schema_migrations` | IMPLEMENTED, UNVERIFIED. No advisory lock → two API instances can race (DB-03) |
| Middleware | RequestID, RealIP, Recoverer, CORS, session | **CORS headers incomplete (INT-01)**. No request logging, no body-size default on JSON (Decode caps 1 MB ✓), no global timeout |
| Auth | HMAC session token (cookie or Bearer), `Require`, `RequireInternal` | Internal token compared with `!=` (not constant-time, SEC-04). No CSRF check (SameSite=Lax mitigates, SEC-05) |
| Errors | `httpx.Fail` → JSON; unknown → 500 logged, not leaked | ✓ |
| Shutdown | `srv.Shutdown` 10 s on SIGINT/TERM | IMPLEMENTED. Background push goroutines and `RunIngest` are not awaited |
| Health | `/healthz` (db, redis, agents, docker, image, n8n, credentials), `/livez` | ✓ good diagnostic surface |

## Endpoints

Auth: P = public, U = logged-in, I = internal token, S = share token. Tests: none per route unless stated. FE = does the frontend call it (see API_CONTRACT_MATRIX).

| Method & path | Handler | Auth | Deps | FE | Status / notes |
|---|---|---|---|---|---|
| GET /healthz, /livez | main.health | P | DB, Redis, agents, docker | no | IMPLEMENTED, UNVERIFIED |
| GET /auth/github/login | auth.Login | P | GitHub | yes (param mismatch) | BLOCKED (no OAuth app) |
| GET /auth/github/callback | auth.Callback | P | GitHub, DB | indirect | BLOCKED. State cookie ✓, redirect restricted to FRONTEND_URL ✓, token encrypted ✓ |
| POST /auth/dev-login | auth.DevLogin | P (flag) | DB | no | IMPLEMENTED; returns bearer token in body (dev only) |
| POST /auth/logout | auth.Logout | P | — | yes | IMPLEMENTED |
| GET /me | auth.Me | U | DB | yes (shape) | IMPLEMENTED |
| GET/POST /github/repos | ListRepos/CreateRepo | U | GitHub | yes | BLOCKED |
| PUT /github/default-repo | SetDefaultRepo | U | GitHub (checks push permission ✓) | yes | BLOCKED |
| DELETE /github/connection | Disconnect | U | GitHub revoke + DB wipe | yes | BLOCKED (local wipe works without creds) |
| POST /workspaces | wsSvc.Create | U | DB, disk | yes (envelope) | IMPLEMENTED; multipart one-shot variant also exists |
| GET /workspaces · GET/PATCH /workspaces/{id} | List/Get/Update | U+role | DB | yes | IMPLEMENTED; non-members get 404 ✓ |
| POST/GET /workspaces/{id}/uploads | CreateUpload/ListUploads | U editor/viewer | disk, DB | yes (link via multipart rejected) | IMPLEMENTED; PDF magic-byte check ✓, sanitised names ✓, size limits ✓ |
| GET/DELETE /workspaces/{id}/uploads/{uploadId}[/file] | Download/Delete | U | disk | no | IMPLEMENTED; `DataPath` traversal guard ✓ (tested) |
| GET/PUT /workspaces/{id}/notes | GetNotes/PutNotes | U | DB | yes | IMPLEMENTED; agent notes are inserted by Python (`research.py:467`, `graph.py:284`) |
| POST /workspaces/{id}/share | runs.CreateShare | U owner | DB, QR | yes | IMPLEMENTED |
| POST/GET /workspaces/{id}/runs | runs.Start/ListForWorkspace | U | DB, Redis | yes | IMPLEMENTED; enqueue failure marks the run failed ✓. Emits stale "Team Manager" text (DOC-01) |
| GET /runs/{id} | runs.Get | U | DB | yes (shape) | IMPLEMENTED |
| GET /runs/{id}/stream | runs.Stream | U | bus | yes (named events) | IMPLEMENTED; subscribe-then-backlog ✓, Last-Event-ID ✓, 20 s comment ping; slow subscribers silently dropped |
| GET /runs/{id}/events | runs.Events | U | DB | yes | IMPLEMENTED (`after`, `limit`) |
| GET /runs/{id}/checkpoints · POST …/{name} | Checkpoints/ResolveCheckpoint | U editor | DB, Redis | yes (body) | IMPLEMENTED; DB update + `resume` job not atomic (REL-03) |
| POST /runs/{id}/agents/{agent}/action | AgentAction | U editor | Redis | yes (keys) | IMPLEMENTED; pause/stop are cooperative (checked between steps) |
| GET /runs/{id}/{scorecard,settings,metrics,map,gap,research,files,file} | jsonView etc. | U viewer | DB, disk | partly | IMPLEMENTED; `/file` path guarded ✓, 2 MB cap ✓ |
| POST/GET /runs/{id}/whatif | AskWhatIf/ListWhatIf | U | DB, Redis | yes | IMPLEMENTED; requires metrics first ✓ |
| POST /runs/{id}/push · GET /pushes · GET /push/preview | githubpush | U | GitHub, n8n, gitleaks | partly | IMPLEMENTED; push stuck in `pushing` if n8n never calls back (REL-02); `repo` field name |
| GET /metrics/{id}/proof | MetricProof | U | DB | no | IMPLEMENTED |
| GET /papers/{id}/pdf | PaperPDF | U | disk | no (path) | IMPLEMENTED |
| GET /agents | inline | U | — | yes (shape) | IMPLEMENTED as a bool map, not a list |
| GET /memory/search | MemorySearch | U | agents → fallback SQL ILIKE | yes | IMPLEMENTED; fallback silently degrades (reports `mode`) ✓ |
| POST /voice/command · /voice/text | voice | U | Groq Whisper, agents /intent | **no** | IMPLEMENTED; returns intent only, the client must confirm and execute |
| GET /share/{token}[/runs/{runId}[/stream\|events\|scorecard\|map\|whatif\|settings]] | share.go | S | DB | partly (paths) | IMPLEMENTED; token 18 random bytes, expiry ✓, no revoke endpoint |
| POST /internal/sandbox/exec | sandbox.HandleExec | I | docker, git | Python | **SEC-01** |
| POST /internal/proof/check | proof.Handle | I | DB | Python gap.py | IMPLEMENTED, unit-tested |
| POST /internal/ratelimit/acquire · GET /usage | ratelimit | I | Redis | Python llm.py | IMPLEMENTED |
| POST /internal/push/callback | githubpush.Callback | I | DB | n8n | IMPLEMENTED |

## Business-logic checks
- **Placeholder / always-success routes:** none found. Handlers validate input and return real errors.
- **Swallowed errors:** `Act()` ignores `SetRunStatus` errors (`_ =`); push `UPDATE`s ignore errors; `stream()` returns nil on a DB error mid-backlog (the client sees a silent close).
- **Authorization:** every run route goes through `loadRun` → `workspace.Access` with a minimum role ✓. `MetricProof` and `PaperPDF` check the workspace ✓. **Gap:** nothing ever adds editors/viewers (collaboration MISSING).
- **Persistence:** all state is in Postgres; events in `run_events`; files under `DATA_DIR/workspaces/{ws}/runs/{run}/project`.
- **Duplicate submissions:** `POST /runs` has no idempotency key, so a double click creates two runs. Push has an "active push" guard ✓.
