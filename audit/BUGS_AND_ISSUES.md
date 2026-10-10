# Bugs and Issues

Severity: P0 critical blocker / security · P1 core integration · P2 in-scope feature or robustness · P3 hardening.
All items are **Open**. Evidence is static (file:line) unless stated. Credentials are never reproduced here.

## Security

| ID | Sev | Location | Issue | Repro / evidence | Expected | Fix | Regression test |
|---|---|---|---|---|---|---|---|
| SEC-01 | **P0** | `backend/internal/sandbox/sandbox.go` `codeVersion()` (L329–355), mount `-v hostProject:/work` (L271) | Sandbox escape. The project dir (including `.git/`) is writable from the container, and the host then runs `git add -A` / `git commit` there with `safe.directory=*`. Code in the sandbox can write `.git/config` `core.fsmonitor=<cmd>` or `.git/hooks/pre-commit`, which executes **on the host** at the next exec. | static: exec 1 writes `/work/.git/hooks/pre-commit`; exec 2 → host runs it | AI-written code can never execute outside the container | Keep the git repo outside the mounted dir (`--git-dir` under DATA_DIR/.meta, `--work-tree` = project), run git with `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, or hash content only (`contentHash`) | Test: create `.git/hooks/pre-commit` that touches a sentinel file in the project → call `codeVersion` → sentinel must not exist |
| SEC-02 | P1 | `SANDBOX_MODE=local` | No isolation at all (documented as dev-only), but `.env` has no guard against using it in a demo | config | Refuse `local` when `APP_ENV != development` | add check in `config.Load` | unit test on config |
| SEC-03 | P2 | `docker-compose.yml` api service | Mounts `/var/run/docker.sock` (root-equivalent on the host) | file | Accept for a laptop demo, document it | document; or a rootless docker socket proxy | — |
| SEC-04 | P2 | `auth.RequireInternal`, `agents/app.py:internal` | Internal token compared with `!=`; the same master token is sent to n8n (`push.go:213`) and can call `/internal/sandbox/exec` | code | Constant-time compare; separate scoped callback token | `subtle.ConstantTimeCompare`; per-push HMAC callback token | unit test |
| SEC-05 | P2 | API mutations | No CSRF verification (FE sends `X-Requested-With`; BE ignores it). SameSite=Lax limits cross-site POSTs | code | Reject mutating requests without the header from browsers | middleware check for non-GET + cookie auth | handler test |
| SEC-06 | P2 | `.env` (local, git-ignored) | Real provider keys, DB password and session/encryption secrets were pasted into a chat session on 2026-10-10 | conversation | Secrets known only to the team | rotate Groq/Gemini keys, Neon password, `SESSION_SECRET`, `INTERNAL_TOKEN`; keep `TOKEN_ENCRYPTION_KEY` unless re-encrypting | — |
| SEC-07 | P2 | `DEV_LOGIN_ENABLED=true` in `.env` | Anyone reaching the API can log in as any name | `.env` | false for the demo/tunnel | set false + startup warning when PUBLIC_API_URL is https | config test |
| SEC-08 | P3 | sandbox logs under `/work/logs` (rw) | Container can rewrite its own log before the hash is taken, weakening the log-line proof | code | Logs outside the mounted dir | write logs to DATA_DIR/.../execlogs | — |
| SEC-09 | P3 | public API | No request rate limiting on login/upload/voice | code | basic per-IP limit | chi `httprate` | — |

## Integration (frontend ↔ backend)

| ID | Sev | Location | Issue | Expected | Fix |
|---|---|---|---|---|---|
| INT-01 | **P0** | `httpx.go:91` vs `client.ts:73` | CORS preflight rejects `X-Requested-With` (and `X-CSRF-Token`) → every POST/PUT/DELETE from `localhost:3000` fails | mutations succeed | add headers to `Access-Control-Allow-Headers`, or use proxy mode |
| INT-02 | **P0** | `workspace.go` Create vs `services.ts:39` | `POST /workspaces` returns `{workspace,uploads}`; FE reads `.id` | workspace id available | adapter unwrap (or BE return the bare workspace) |
| INT-03 | **P0** | `CreateUpload` multipart branch | arXiv/link uploads sent as multipart `url` → 400 | link saved | BE accept `url` in multipart, or FE send JSON for links |
| INT-04 | P1 | `GET /workspaces/{id}` | missing nested runs/papers/role | overview renders runs | FE also call `GET /workspaces/{id}/runs` + `/runs/{id}/research` |
| INT-05 | **P0** | `ResolveCheckpoint` | FE `{decision, instructions}` vs BE `{action, instruction}` → 400 | plan approval works | align names |
| INT-06 | P1 | `Act` + `runs.Agents` | FE posts agent `coding`, field `instruction`; BE needs `run` or a full slug and `text` → 404/400 | controls work | FE send `run` for card-level controls; map field |
| INT-07 | **P0** | `runs.go:229` `event: %s` vs `sse.ts:23` | Named SSE events only reach registered listeners; ~38 of ~46 backend types are never delivered live | live board updates | BE omit `event:` (use default `message`), or FE register all BE types |
| INT-08 | P1 | `/runs/{id}/map`, `/research` | map wrapped in `graph`; brief at `/research` | map + brief render | adapter |
| INT-09 | P1 | `/me` | status `never/disconnected` vs `not_connected`; scopes string; `""` vs null | correct GitHub banner | adapter |
| INT-10 | P1 | login | `return_to` vs `redirect`; BE never redirects to `/auth/callback` | returns to page | BE accept `return_to` (relative) → `${FRONTEND}/auth/callback?status=success&return_to=` |
| INT-11 | **P0** | scorecard | FE `metric` vs BE `ours`; status `missing` | proven values shown | adapter |
| INT-12 | P1 | push | `repo_full_name`/`repo`; `/push` vs `/pushes`; `done` vs `succeeded` | publish completes | adapter + use `/pushes[0]` |
| INT-13 | P2 | share | FE `/share/{t}/events…` vs BE `/share/{t}/runs/{runId}/…` | QR live view works | FE use run id from `/share/{t}` |
| INT-14 | P2 | `GET /agents` | object map, not list | agent page | BE return list `{id,name,description}` from `steps.AGENTS` |
| INT-15 | P2 | missing BE: `/runs/{id}/tests`, `/runs/{id}/memory`, `/runs/{id}/report`, `/runs/{id}/briefing` | tabs show "not available" | add routes (data exists for tests/memory) |
| INT-16 | P2 | missing FE: dev-login, `/voice/*`, `/metrics/{id}/proof`, `/push/preview` | features unreachable | add UI |
| INT-17 | P3 | SSE heartbeat is a comment | FE shows a stale warning after 45 s of quiet | send `event: heartbeat` |

## Reliability

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| REL-01 | P1 | `bus.go` Enqueue/RunIngest, `worker.py` BRPOP | At-most-once delivery: a job or event popped and then lost (crash, DB error) is gone; no retry/DLQ | `BLMOVE` to a processing list + ack, or Redis Streams with consumer groups |
| REL-02 | P2 | `githubpush` | push stays `pushing` if n8n never calls back → "already in progress" forever | deadline; mark failed after N minutes |
| REL-03 | P2 | `Resolve` | checkpoint marked resolved before the `resume` job is enqueued; an enqueue failure leaves the run stuck | enqueue first or compensate |
| REL-04 | P2 | `Act` | status updates ignore errors | handle errors |
| REL-05 | P3 | `stream()` | DB error during backlog closes the stream silently | log + error event |
| ENV-01 | **P1** | this machine | Redis not installed, Docker daemon stopped, sandbox images not built, gitleaks absent (builtin scanner used) | `docker compose up -d redis` (Postgres = Neon); start Docker Desktop; build images |

## Correctness / Hero 2

| ID | Sev | Issue |
|---|---|---|
| HERO2-01 | P2 | Proof checker only runs on Gap Detective text; other AI prose (brief summary, README text, intent replies) is not checked. `isAllowed` lets any integer ≤ 10 through. |
| CFG-01 | P3 | `config.go:82` default fast model `llama-3.1-8b-instant` is unavailable per spec §15 (the `.env` overrides it) |
| TEST-01 | P3 | `pytest` from `agents/` collects the recipe template test and errors; add `testpaths` |

## Outdated documentation / removed-feature leftovers (cleanup only, not missing work)

| ID | Location |
|---|---|
| DOC-01 | `backend/internal/runs/runs.go:114` ("the Team Manager will plan the work"), `store/results.go` CreateWhatIfQuestion reason text, `voice/voice.go:2` comment |
| DOC-02 | `agents/lab/intent.py:1`, `agents/lab/llm.py:50`, `agents/lab/recipes/distillation.py:104` |
| DOC-03 | `frontend/src/app/(app)/team/page.tsx`, `endpoints.ts` `agentHistory`, `types.ts` `team_decision`/§22 team types, results `team` tab, mock data |
| DOC-04 | `docs/FRONTEND_INTEGRATION_NOTES.md` (apps/web paths, Telegram, Team Manager suggestions) — superseded by `audit/FRONTEND_INTEGRATION_NOTES.md`; `docs/allaboutourproject.md:94` still says "a manager decides"; `docs/plan.html` §9 "how the agent team evolves" |
| DOC-05 | `.claude/launch.json` → `apps/web` (should be `frontend`) |
| DOC-06 | `README.md` mentions `GROQ_API_KEY`/`GEMINI_API_KEY` (now `_KEYS`); stale `agents/lab/__pycache__/team.cpython-313.pyc` |
