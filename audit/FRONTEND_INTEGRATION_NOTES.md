# Frontend ↔ Backend Integration Notes (decisions needed)

Supersedes `docs/FRONTEND_INTEGRATION_NOTES.md`, which was written against a proposed contract before the Go backend existed and still references `apps/web`, Telegram and the Team Manager.

## Recommendation
**Treat the Go backend as the source of truth and add a thin adapter in `frontend/src/lib/api/services.ts`.** The backend shapes are richer (proof fields, checkpoints, child runs) and are already consumed by the Python side. Change the backend only where a frontend need is genuine and small. No mock fallbacks: missing endpoints keep showing "not available".

## Agreed-contract proposals (per item: who changes what)

| # | Topic | Proposal | Owner |
|---|---|---|---|
| 1 | CORS | BE `Access-Control-Allow-Headers: Content-Type, Authorization, Last-Event-ID, X-Requested-With, X-CSRF-Token` (or run FE in proxy mode `NEXT_PUBLIC_API_BASE_URL=/api`) | BE |
| 2 | Create workspace | FE unwraps `res.workspace`. Optionally FE uses the single multipart `POST /workspaces` (`papers`, `arxiv`, `dataset`, `dataset_url`, `repo_url`, `note`, `compute_budget`) which already validates and saves everything in one call | FE |
| 3 | Link uploads | FE sends JSON `{kind, url}` for arXiv/dataset/repo links; multipart only for files | FE |
| 4 | Workspace detail | FE composes `GET /workspaces/{id}` + `GET /workspaces/{id}/runs` | FE |
| 5 | Run detail | FE reads `res.run`, `res.pending_checkpoint`, `res.children` | FE |
| 6 | SSE | BE writes **no `event:` line** (default `message`), keeps `id:`; adds `event: heartbeat` every 20 s. FE keeps the `message` listener | BE (2 lines) |
| 7 | Event vocabulary | FE maps BE types: `agent_started→task_started`, `agent_finished→task_done`, `agent_failed→task_failed`, `stage→stage_changed`, `paused/resumed/stop_requested→agent_*`, `run_completed→run_finished`, `claim_scored/results_ready→scorecard_updated`, `whatif_branch/whatif_stopped/whatif_finished→whatif_branch_*`, `push_done→push_succeeded`, `fix_applied` same | FE |
| 8 | Checkpoint | FE sends `{action, instruction, option?}` | FE |
| 9 | Agent controls | Card-level controls use agent `run`; FE sends `{action, text}`; drop `thumbs_up/down` (scoring removed) | FE |
| 10 | Scorecard | FE maps `ours → metric`, `status:"missing" → null` | FE |
| 11 | Brief / map / gaps / files | FE: `/runs/{id}/research` (papers+claims+brief_markdown), map `res.graph`, `/runs/{id}/gap`, file text `/runs/{id}/file?path=`, `size → size_bytes` | FE |
| 12 | `/me` | FE maps `status: never\|disconnected → not_connected`, `scopes.split(",")`, `"" → null`; pushes from `/me.pushes` | FE |
| 13 | Login | BE accepts `return_to` (relative path only) and redirects to `${FRONTEND_URL}/auth/callback?status=success&return_to=…`; errors → `status=error` | BE |
| 14 | Dev login | FE adds a "Dev login" button when `NEXT_PUBLIC_DEV_LOGIN=true` → `POST /auth/dev-login` | FE |
| 15 | Push | FE sends `{repo}`; polls `GET /runs/{id}/pushes` (first item); maps `done → succeeded`; renders `secret_scan_result.findings` | FE |
| 16 | Share | FE gets `runs` from `GET /share/{token}`, then uses `/share/{token}/runs/{runId}/{events,stream,scorecard,map,whatif,settings}` | FE |
| 17 | Agents list | BE returns `[{id:"coding.writer", name, description, parent:"coding"}]` from `steps.AGENTS` (exposed via agent service or a static Go list) | BE |
| 18 | Paper PDF | FE uses `/papers/{id}/pdf#page=N` | FE |
| 19 | New BE endpoints (data already exists) | `GET /runs/{id}/tests` (parse the JUnit file that `testing._junit` reads), `GET /runs/{id}/memory` (memory items with `source_run_id=id` + reuse events) | BE |
| 20 | Voice | FE adds mic + text box → `POST /voice/command`/`/voice/text` → show intent → on "Yes" call the normal route (checkpoint / whatif / action) | FE |
| 21 | Proof card | FE hover on any number → `GET /metrics/{id}/proof` | FE |
| 22 | Remove | `/team`, `agentHistory`, `team_decision`, Team results tab | FE |
| 23 | IDs | FE normalises numeric ids to strings in the adapter | FE |

Internal routes (`/internal/*`) must stay unreachable from the browser. When exposed through Cloudflare Tunnel, route only the public paths.
