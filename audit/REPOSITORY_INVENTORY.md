# Repository Inventory

Root: `tapu-sena/` · 141 tracked files · three apps + infra. Status labels follow the audit brief.

| Module | Lang | Location | Responsibility | Depends on | Called by | Verification | Status |
|---|---|---|---|---|---|---|---|
| Web app | TS/React (Next 15, React 19, Tailwind 4) | `frontend/src/app/**` (18 routes) | All screens | Go API (HTTP+SSE), mock transport | Browser | tsc ✓, eslint ✓, vitest 14/14 ✓, `next build` ✓ | IMPLEMENTED, UNVERIFIED (vs real API) |
| API client | TS | `frontend/src/lib/api/{client,services,endpoints,sse,types}.ts` | Typed calls, CSRF header, 401 redirect, SSE | Go API | All pages | 9 unit tests | PARTIALLY COMPLETE (contract mismatch) |
| Mock backend | TS | `frontend/src/lib/api/mock/*` | In-browser demo data (dev only, `NEXT_PUBLIC_USE_MOCKS`) | — | client.ts | force-off in prod build | IMPLEMENTED |
| Go API entry | Go 1.27 | `backend/cmd/server/main.go` | Router, middleware, health, shutdown | store, bus, all services | — | `go build` ✓ | IMPLEMENTED, UNVERIFIED |
| auth | Go | `backend/internal/auth` | GitHub OAuth, HMAC sessions, AES-GCM token crypto, dev login | ghapi, store | router | crypto_test ✓ | crypto VERIFIED; OAuth BLOCKED (no client id) |
| workspace | Go | `backend/internal/workspace` | Workspaces, uploads, notes, path safety | store | router, runs | workspace_test ✓ (path/arXiv helpers) | IMPLEMENTED, UNVERIFIED |
| runs | Go | `backend/internal/runs` | Run lifecycle, SSE, replay, checkpoints, controls, results, share | bus, store, agentsclient | router, voice | none | IMPLEMENTED, UNVERIFIED |
| sandbox | Go | `backend/internal/sandbox` | Docker exec with limits, metrics ingest with proof | docker CLI, git CLI, store | `/internal/sandbox/exec` (Python) | none | PARTIALLY COMPLETE (SEC-01) |
| proof | Go | `backend/internal/proof` | Strip AI sentences with unproven numbers | store | `/internal/proof/check` (Python gap.py) | proof_test ✓ | IMPLEMENTED, partly verified |
| githubpush | Go | `backend/internal/githubpush` | Bundle, secret scan (gitleaks/builtin), n8n or direct push | ghapi, store, n8n | `POST /runs/{id}/push` | none | IMPLEMENTED, UNVERIFIED |
| ghapi | Go | `backend/internal/ghapi` | Minimal GitHub REST + git data API | GitHub | auth, githubpush | none | IMPLEMENTED, UNVERIFIED |
| bus | Go | `backend/internal/bus` | Redis jobs/events, SSE fan-out | Redis, store | runs, sandbox, push | none | IMPLEMENTED, UNVERIFIED |
| ratelimit | Go | `backend/internal/ratelimit` | Per-model/key counters | Redis | Python llm.py | none | IMPLEMENTED, UNVERIFIED |
| voice | Go | `backend/internal/voice` | Whisper transcription + intent | Groq, agents `/intent` | router | none | IMPLEMENTED, UNVERIFIED (no FE caller) |
| store | Go/SQL | `backend/internal/store` + `migrations/001–004` | Schema, queries, migrations | Postgres + pgvector | all | none | IMPLEMENTED, UNVERIFIED |
| agentsclient | Go | `backend/internal/agentsclient` | HTTP to FastAPI (`/health`, `/memory/search`, `/intent`, `/runs/{id}/summary`) | agents | runs, voice, health | none | IMPLEMENTED, UNVERIFIED |
| Agent service | Python 3.13 | `agents/app.py`, `lab/api.py` | FastAPI + worker thread | Redis, Postgres, Go internal API | Go | none | IMPLEMENTED, UNVERIFIED |
| Pipeline | Python/LangGraph | `agents/lab/graph.py`, `steps.py`, `worker.py` | Fixed pipeline with interrupts | all lab modules | worker | none | IMPLEMENTED, UNVERIFIED |
| Agents | Python | `lab/research.py`, `coding.py`, `testing.py`, `gap.py`, `whatif.py`, `observer.py`, `memory.py`, `intent.py` | See PYTHON_AI_AUDIT | llm, api, db, bus | graph | test_logic ✓ (13 incl. rotation) | IMPLEMENTED, UNVERIFIED |
| Distillation recipe | Python | `lab/recipes/distillation*.py` | Pre-written project, claims, ablations for arXiv 1503.02531 | — | research, coding, gap | its own pytest needs generated config | IMPLEMENTED (fixed demo sequence) |
| LLM router | Python | `lab/llm.py` | Groq/Gemini/OpenRouter chain, key rotation | providers, Go ratelimit | all agents | test_key_rotation ✓ | VERIFIED (unit) |
| Sandbox images | Docker | `infra/sandbox-images/{python,r}` | Pre-baked libs | Docker | sandbox | not built (Docker down) | BLOCKED |
| n8n workflow | JSON/JS | `n8n/github-push.json` | Webhook → commits → callback | GitHub, Go callback | githubpush | none | IMPLEMENTED, UNVERIFIED |
| Compose | YAML | `docker-compose.yml` | Postgres, Redis, n8n, api, agents | Docker | dev | not run | BLOCKED |
| CI/CD | — | none (`.github/` absent) | — | — | — | — | MISSING |
| MCP / browser extension | — | none | not in scope | — | — | — | NOT APPLICABLE |

## Dead code, duplicates, stale artefacts

| Item | Evidence | Note |
|---|---|---|
| `frontend/src/app/(app)/team/page.tsx`, `agentHistory` endpoint, `team_decision` event, Team tab | `endpoints.ts:84`, `types.ts:217,420` | Remnant of the removed Manager feature: remove (DOC-03) |
| `agents/lab/__pycache__/team.cpython-313.pyc` | file present, `team.py` deleted | Stale bytecode (untracked) |
| `.claude/launch.json` runs `npm --prefix apps/web` | folder is `frontend/` | Broken dev launcher (DOC-05) |
| `docs/FRONTEND_INTEGRATION_NOTES.md` paths `apps/web/...`, Telegram, Team Manager | lines 3, 99, 119, 131 | Outdated (now superseded by audit/FRONTEND_INTEGRATION_NOTES.md) |
| Unused tables after Telegram/Manager removal | dropped by migrations 003/004 | OK |
| `comments`, `workspace_members` editor/viewer roles | no routes create them | Schema-only features |
| `gofmt -l` lists every Go file | all files have CRLF (`core.autocrlf=true`) | Not a code defect; add `.gitattributes` `*.go text eol=lf` |
| TODO/FIXME | `grep` found none in source | — |
