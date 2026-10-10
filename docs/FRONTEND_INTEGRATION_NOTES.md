# Frontend Integration Notes

**For:** the Go backend teammate · **Frontend:** `apps/web` (Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn-style Radix components)
**Contract source:** `allaboutourproject.md` §20 (event schema), §22 (tables), §23 (routes). No separate OpenAPI/Swagger file existed in the repo when this was written.

This document is the integration checklist: **what the frontend has built, every API it calls, the exact shapes it expects, and what the backend still needs to add.** If you change a shape, update `apps/web/src/lib/api/types.ts` and the table below together.

---

## 1. Status at a glance

| | Count |
|---|---|
| Screens implemented | 18 routes (see §2) |
| Documented §23 endpoints wired in the UI | **20 / 20** browser-facing routes |
| Proposed endpoints (not in §23, needed by screens) | **21** (see §5) — UI shows "endpoint not available yet" until they exist |
| Backend verified live | **None yet** — no backend was available. All calls verified only against the dev mock + unit tests. |

**Legend for "Status":**
- ✅ **Wired** — frontend calls it; untested against a real backend (backend not available yet).
- 🟡 **Proposed** — the frontend needs it, it is NOT in §23. Please confirm/implement or tell me the real path.

---

## 2. Screens built (what is done)

| Route | Screen | Calls |
|---|---|---|
| `/` | Landing page (DESIGN.md §17.1 blueprint) | — (static) |
| `/login` | Split auth shell, "Continue with GitHub", handles `?reason=session|signed_out|cancelled|error` | navigates to `GET /auth/github/login` |
| `/auth/callback` | Confirms login with `GET /me`, then goes to `return_to` | `GET /me` |
| `/dashboard` | Workspaces list, stats, GitHub-not-connected banner | `GET /me`, 🟡 `GET /workspaces` |
| `/profile` | User details, GitHub status, choose / create repo, disconnect, published research | `GET /me`, `GET /github/repos`, `POST /github/repos`, `PUT /github/default-repo`, `DELETE /github/connection`, 🟡 `GET /me/pushes` |
| `/workspaces/new` | Title, papers (PDF / arXiv, max 2 → Paper vs Paper), dataset file/link, repo link, note, compute budget, upload progress + retry | `POST /workspaces`, `POST /workspaces/{id}/uploads`, `POST /workspaces/{id}/runs` |
| `/workspaces/[id]` | Overview: runs, uploads, start run, share link + QR | `GET /workspaces/{id}`, `POST /workspaces/{id}/runs`, `POST /workspaces/{id}/share` |
| `/workspaces/[id]/live` | **Live Agent Board**: stage bar, agent cards (task, why, status, cost, controls), checkpoint panel, event stream, live/reconnecting/stale indicator | `GET /runs/{id}/events`, `GET /runs/{id}/stream` (SSE), `POST /runs/{id}/agents/{agent}/action`, `POST /runs/{id}/checkpoints/{name}` |
| `/workspaces/[id]/map` | **Research Map** + plan rationale + Checkpoint 1 (Approve / Edit / Reject), export SVG | 🟡 `GET /runs/{id}/map`, 🟡 `GET /runs/{id}/brief`, checkpoint |
| `/workspaces/[id]/results/[tab]` | Results tabs: research, coding, testing, scorecard, whatifs, team, memory, notes + report export + audio briefing | see §4 |
| `/workspaces/[id]/replay` | **Run Replay** (play/pause, 1×/4×/16×, slider) | `GET /runs/{id}/events` |
| `/workspaces/[id]/publish` | **Checkpoint 2**: approve push, secret-scan result, progress, commit links | `GET /me`, `POST /runs/{id}/push`, 🟡 `GET /runs/{id}/push` |
| `/workspaces/[id]/agents/[agent]` | An agent's full work (opens in new tab from a card) | events + `GET /agents` |
| `/team` | Agent scores chart, stages, Team Evolution timeline per agent | `GET /agents`, `GET /agents/{id}/history` |
| `/memory` | Lab Memory semantic search with provenance | `GET /memory/search?q=` |
| `/share/[token]` | Read-only live view (QR) | 🟡 `GET /share/{token}`, 🟡 `/share/{token}/events`, 🟡 `/share/{token}/stream`, 🟡 `/share/{token}/scorecard` |

Every screen has loading (skeleton), empty, error (with retry), permission-denied, and "endpoint not available" states. Mobile: bottom dock nav, bottom-sheet dialogs, approve/reject buttons pinned to the bottom of the screen.

---

## 3. Conventions the frontend assumes (please confirm)

| Topic | Frontend behaviour | Ask for backend |
|---|---|---|
| **Base URL** | `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080`). Paths are exactly as in §23 — **no `/api` prefix**. | Confirm no prefix. |
| **Auth** | Session cookie set by Go. Every request uses `credentials: "include"`. The browser never sees the GitHub token. | Cookie `HttpOnly; Secure; SameSite=Lax`. |
| **CORS (direct mode)** | Browser at `http://localhost:3000` calls `:8080`. | `Access-Control-Allow-Origin: <frontend origin>` (not `*`), `Allow-Credentials: true`, allow headers `Content-Type, X-Requested-With, X-CSRF-Token`, methods `GET,POST,PUT,DELETE`. Or use **proxy mode**: `NEXT_PUBLIC_API_BASE_URL=/api` + `API_PROXY_TARGET=http://localhost:8080` (Next rewrites `/api/*` → Go; no CORS needed). |
| **CSRF** | Mutations send `X-Requested-With: XMLHttpRequest`; if a readable `csrf_token` cookie exists, also `X-CSRF-Token: <value>`. | Reject state-changing requests without the header (or verify double-submit token). |
| **401** | Any 401 → redirect to `/login?return_to=<current path>&reason=session`. | Return **401** (not 302) for API calls without a session. |
| **Error body** | Parses `{"error":{"code","message","fields":{name:msg}}}`; also accepts `{"error":"msg"}` and `{"message":"msg"}`. `fields` are shown next to form inputs. | Use the envelope above for 400/409/422. |
| **Status codes** | 400/422 validation · 401 unauth · 403 forbidden · 404 **JSON** = resource missing · 404 **non-JSON**/405/501 = route not implemented ("endpoint not available") · 409 conflict · 413 too large · 429 rate limited · 5xx server. | Return JSON for real 404s so we can tell them apart from missing routes. |
| **Lists** | Accepts a bare array **or** an envelope (`{items}`, `{entries}`, `{events}`, `{repos}`, `{workspaces}`, `{branches}`, `{notes}`, `{agents}`, `{pushes}`, `{files}`, `{settings}`). | Either is fine; a bare array is simplest. |
| **Dates** | ISO-8601 UTC strings. | — |
| **IDs** | Strings. | — |

---

## 4. Documented endpoints (§23) — request/response the frontend sends/expects

All types are in `apps/web/src/lib/api/types.ts`; all calls in `apps/web/src/lib/api/services.ts`.

| # | Method & path | Request | Response the UI reads | Caller | Status |
|---|---|---|---|---|---|
| 1 | `GET /auth/github/login?return_to=/path` | Full-page navigation (not fetch). `return_to` is always a relative path. | 302 to GitHub | `/login` | ✅ |
| 2 | `GET /auth/github/callback` | (GitHub → Go) | **Proposed:** 302 to `${FRONTEND}/auth/callback?status=success&return_to=/path` (or `status=error&error=…`, `status=cancelled`). Backend must validate `return_to` is relative. | `/auth/callback` | ✅ |
| 3 | `GET /me` | — | `{ user: {id,name,email,github_username,avatar_url,created_at}, github: {status:"connected"\|"not_connected"\|"revoked"\|"error", scopes:string[], default_repo:"owner/name"\|null, connected_at} }` | shell, profile, publish | ✅ |
| 4 | `GET /github/repos` | — | `GithubRepo[]` `{id,name,full_name,private,html_url,description,default_branch?,updated_at?,can_push?}`. 409 if GitHub not connected, 403 if scope missing. | profile | ✅ |
| 5 | `POST /github/repos` | `{name, private, description?}` | `GithubRepo` (201). 422 with `fields.name` on name clash. | profile | ✅ |
| 6 | `PUT /github/default-repo` | `{full_name:"owner/name"}` | `GithubConnection` or 204 (UI re-fetches `/me` either way) | profile | ✅ |
| 7 | `DELETE /github/connection` | — | 204. Must delete the token **and** revoke on GitHub. | profile | ✅ |
| 8 | `POST /workspaces` | `{title, compute_budget:"quick"\|"standard"\|"deep", note?}` | `Workspace {id,owner_id,title,compute_budget,note,created_at}` (201) | new workspace | ✅ |
| 9 | `GET /workspaces/{id}` | — | `Workspace` **plus (proposed) nested** `uploads: Upload[]`, `papers: Paper[]`, `runs: Run[]` (oldest→newest), `role:"owner"\|"editor"\|"viewer"`, `latest_push: Push\|null`. The UI picks the latest run from `runs`. | every workspace page | ✅ (nested fields 🟡) |
| 10 | `POST /workspaces/{id}/uploads` | **multipart/form-data**: `kind` = `paper`\|`dataset`\|`repo_link`, plus **either** `file` (binary) **or** `url` (arXiv / dataset link / GitHub URL). One item per request. | `Upload {id,workspace_id,kind,path_or_url,filename?,size_bytes?}` (201). 413 if too big, 422 on bad type. | new workspace | ✅ |
| 11 | `POST /workspaces/{id}/runs` | `{compute_budget, parent_run_id?}` | `Run {id,workspace_id,parent_run_id,branch_name,status,started_at,finished_at,git_commit,stage?}` (201). 422 if no paper uploaded. | new workspace, overview | ✅ |
| 12 | `GET /runs/{id}/stream` (SSE) | `EventSource(url, {withCredentials:true})`; on manual reconnect adds `?after=<last event id>` (proposed, optional) | Each message `data:` = one `RunEvent` JSON (see §6). Please set SSE `id:` = event id (enables Last-Event-ID resume). Unnamed events preferred; named `event: <type>` also handled. Send `event: heartbeat` every ~15s (UI shows "No updates for a while" after 45s of silence). | live, map, results, agent page | ✅ |
| 13 | `GET /runs/{id}/events` | — | `RunEvent[]` (all saved events). Used first, then SSE; de-duplicated by `id`. | live, replay, results | ✅ |
| 14 | `POST /runs/{id}/checkpoints/{name}` | `{decision:"approve"\|"edit"\|"reject", instructions?}` — `instructions` required for `edit` | `{name, decision, run?}` or 204. 409 if nothing is waiting. **`name` comes from the event** (`data.checkpoint` or `links.checkpoint`, e.g. `plan`). | live, map | ✅ |
| 15 | `POST /runs/{id}/agents/{agent}/action` | `{action:"pause"\|"resume"\|"stop"\|"retry"\|"instruct"\|"thumbs_up"\|"thumbs_down", instruction?}`. `{agent}` = top-level event key (e.g. `coding`, `research`, `dataset_subset_planner`). | `{agent, action, accepted, message?}` or 204. UI waits for the confirming event. **`resume` is a proposed addition** (§9.4 lists Pause but no way to un-pause). | agent cards | ✅ |
| 16 | `GET /runs/{id}/scorecard` | — | `ScorecardEntry[]`: `{id, run_id, claim:{id,paper_id,description,value,unit,page,table_ref,position_on_page:{x,y,width,height}(0–1),condition}, metric:{id,run_id,name,value,log_file_hash,log_line,log_file?,git_commit?,recorded_at?,log_excerpt?}\|null, difference, status:"match"\|"close"\|"different"\|null, explanation, tolerance?}`. **`metric:null` + `status:null` = not measured yet** (UI shows "Unverified"; it never invents a number). | scorecard, share | ✅ |
| 17 | `GET /runs/{id}/settings` | — | `RunSetting[]` `{id,run_id,name,value,source:"paper"\|"official_code"\|"assumption"\|"compute_change",source_ref,reason}` | coding tab (Missing Details Log) | ✅ |
| 18 | `POST /runs/{id}/whatif` | `{question}` | `{branches: WhatIfBranch[]}`, a bare array, or one branch | what-ifs tab | ✅ |
| 19 | `GET /agents` | — | `Agent[]` `{id,name,kind:"core"\|"specialist",stage:"trial"\|"active"\|"refined"\|"merged"\|"replaced"\|"retired",current_version_id, current_version?:{…AgentVersion}, avg_score?, task_count?, event_key?}`. **`event_key`** = the agent string used in events, so cards can link to the registry. | team, results team tab | ✅ |
| 20 | `GET /agents/{id}/history` | — | `{agent, versions: AgentVersion[], tasks: AgentTask[], decisions: TeamDecision[]}` (§22 fields) | team page | ✅ |
| 21 | `GET /memory/search?q=` | — | `MemoryItem[]` `{id,kind,text,details,times_used,success_rate,source_run_id?,similarity?}` | memory page | ✅ |
| 22 | `GET /workspaces/{id}/notes` | — | `Note[]` `{id,workspace_id,author: string \| {type:"user"\|"agent",id,name}, markdown, updated_at}` — researcher's note + agent notes | notes tab | ✅ |
| 23 | `PUT /workspaces/{id}/notes` | `{markdown}` (the researcher's own note) | `Note` (or list / 204 — UI re-fetches) | notes tab | ✅ |
| 24 | `POST /runs/{id}/push` | `{approved:true, repo_full_name?}` — only sent after the researcher ticks the approval box and clicks "Approve push" | `Push {id,run_id,repo_url,commit_urls:[{message,url,branch?}],status:"pending"\|"scanning"\|"blocked"\|"pushing"\|"succeeded"\|"failed",secret_scan_result:{passed,findings:[{file,line,rule,description?}]}\|null,error?}` (202). 409 if GitHub not connected. | publish | ✅ |
| 25 | `POST /workspaces/{id}/share` | `{expires_in_hours?}` | `{token, expires_at, url?}` — UI builds `${NEXT_PUBLIC_APP_ORIGIN}/share/{token}` when `url` is absent and renders the QR. | overview | ✅ |

**Never called by the browser (by design):** `POST /internal/sandbox/exec`, `POST /internal/push/callback`, `POST /telegram/webhook`. A unit test asserts no `/internal` or Telegram route exists in the frontend endpoint registry. The n8n webhook URL is never known to the frontend.

---

## 5. Proposed endpoints (🟡 not in §23 — please confirm or give me the real path)

Each one already has a typed service function and a UI. Until it exists, the UI shows "backend endpoint not available yet" (it never falls back to fake data).

| Method & path | Why the UI needs it | Sample response |
|---|---|---|
| `POST /auth/logout` | Sign-out button | 204, clears session cookie |
| `GET /me/pushes` | Profile → "Published research" list | `[{ "id":"push_1","run_id":"r_42","repo_url":"https://github.com/u/repo","status":"succeeded","commit_urls":[],"secret_scan_result":{"passed":true,"findings":[]},"workspace_id":"w_1","workspace_title":"Distillation","created_at":"2026-10-10T14:40:00Z" }]` |
| `GET /workspaces` | Dashboard list / history | `[{ ...Workspace, "latest_run": Run\|null, "repo_url": "…"\|null, "paper_count": 1 }]` |
| `GET /runs/{id}` | Run status, stage, commit for the summary header | `Run` (+ `"stage":"coding"`) |
| `GET /runs/{id}/brief` | Research tab, plan rationale at Checkpoint 1 | `{ "run_id":"r_42","summary":"…","method":["…"],"claims":[Claim],"missing_details":[{"name":"learning_rate","note":"Not stated","assumed_value":"0.01"}],"sources":[{"id":"s1","kind":"dataset","title":"MNIST","url":"…","official":true,"license":"…","size":"11 MB","fits_budget":true,"used":true,"notes":null}],"recommendation":"…","skills":["load MNIST"],"plan":["…"] }` |
| `GET /runs/{id}/map` | Research Map (Observer output) | `{ "run_id":"r_42","updated_at":"…","nodes":[{"id":"paper","kind":"paper\|claim\|source\|dataset\|code\|test\|result\|agent\|note","label":"Hinton 2015","status":"waiting\|working\|done\|problem","detail":null}],"edges":[{"id":"e1","from":"paper","to":"c1","label":"claims"}] }` — UI re-fetches on `map_updated` events |
| `GET /runs/{id}/files` | Coding tab file tree | `[{ "path":"src/train.py","kind":"code\|config\|test\|log\|metrics\|model\|notebook\|other","size_bytes":4210 }]` |
| `GET /runs/{id}/files/content?path=…[&download=1]` | Code / log viewer, download | `text/plain` body; with `download=1` add `Content-Disposition: attachment`. Please cap size (e.g. 2 MB) and reject `..` paths. |
| `GET /runs/{id}/tests` | Testing tab | `{ "run_id":"r_42","tests":[{"id":"t1","name":"softmax sums to 1","kind":"correctness\|claim","status":"passed\|failed\|skipped\|error","duration_ms":12,"message":null,"claim_id":null,"file":"tests/test_x.py"}] }` |
| `GET /runs/{id}/gaps` | Gap Detective | `{ "run_id":"r_42","claim_id":"c3","differences":[{"id":"g1","setting":"epochs","ours":"5","paper":"long","rank":1,"experiment":{"status":"done","run_id":"r_43","metric":Metric,"gap_closed":4}\|null}],"explanation":"…","seed_runs":[Metric] }` — `experiment:null` is shown as **Hypothesis**, never as a measured fact |
| `GET /runs/{id}/whatif` | What-if branch tree (POST only creates) | `WhatIfBranch[]` incl. `result_metric`, `branch_name`, `round`, `stop_reason`, `suggested_by:"researcher"\|"manager"`, `status:"proposed"` for Team-Manager suggestions awaiting approval |
| `GET /runs/{id}/memory` | Memory tab: learned vs reused this run | `{ "learned":[MemoryItem], "reused":[{"item":MemoryItem,"used_at":"…","agent":"coding.debugger"}] }` |
| `GET /runs/{id}/push` | Push progress polling (every 2 s while in flight) | latest `Push` for the run, 404 JSON if none |
| `GET /runs/{id}/report?format=md\|pdf` | Report export buttons | file download |
| `GET /runs/{id}/briefing` | Audio briefing player (Hero 9) | `{ "script":"…","audio_url":"…"\|null,"duration_seconds":90 }` |
| `GET /papers/{id}/file` | "Open paper at page N" from the scorecard evidence drawer | `application/pdf` (UI appends `#page=N`) |
| `GET /share/{token}` | Shared read-only view | `{ "workspace":Workspace,"run":Run\|null,"expires_at":"…" }`, 404 JSON when expired |
| `GET /share/{token}/events` | Shared view history | `RunEvent[]` |
| `GET /share/{token}/stream` | Shared view SSE (no session cookie; token-authorised) | same as `/runs/{id}/stream` |
| `GET /share/{token}/scorecard` | Shared scorecard | `ScorecardEntry[]` |
| *(optional)* `?after=<event id>` on `/runs/{id}/stream` | Resume after a manual reconnect | — (UI de-duplicates either way) |

**Also proposed:** `agent action = "resume"`, and a voice endpoint (e.g. `POST /runs/{id}/voice`, multipart audio → transcript → what-if/instruction). Voice is **not** built in the web UI until that endpoint exists (Telegram voice is backend-only).

---

## 6. Live event contract (SSE + `/events`)

The UI renders straight from events; it has **no timers or fake progress**.

```json
{
  "id": "ev_1001",
  "run_id": "r_42",
  "time": "2026-10-10T14:32:05Z",
  "agent": "coding.debugger",
  "type": "fix_applied",
  "message": "Fixed import error: pinned numpy<2 (known fix from memory)",
  "why": "Same error seen in run #3; that fix worked",
  "links": { "memory_item": "m_17", "file": "src/train.py", "checkpoint": "plan" },
  "cost": { "tokens": 812, "sandbox_seconds": 0 },
  "data": { "stage": "coding", "status": "working", "progress": 0.55, "checkpoint": "plan" }
}
```

- `id` (from `run_events.id`) is **required** for de-duplication. `data` is a **proposed** optional field.
- `agent` is dotted: card = text before the first `.`, sub-agent = the rest. New specialists appear as new cards automatically.
- `data.progress` (0–1) is shown only if sent. The UI never fabricates a percentage.
- **Event types the UI understands** (only `fix_applied` is in the spec; the rest are proposed, and unknown types still render in the feed):
  `run_started, run_finished, run_failed, stage_changed (data.stage ∈ research|plan_approval|coding|testing|whatifs|push|done), agent_created, task_started, task_progress, task_done, task_failed, error, fix_attempt, fix_applied, needs_help, agent_paused, agent_resumed, agent_stopped, checkpoint_waiting, checkpoint_resolved (data.checkpoint or links.checkpoint), team_decision, memory_reused, sandbox_started, sandbox_finished, test_passed, test_failed, scorecard_updated, whatif_branch_started|stopped|done, map_updated, push_started|blocked|succeeded|failed, heartbeat`.
- Events that refresh cached REST data: `scorecard_updated` → scorecard + gaps; `test_*` → tests; `map_updated` → map; `whatif_*` → branches; `push_*` → push status; `run_finished|run_failed|stage_changed|checkpoint_resolved` → run; `team_decision` → agents.

---

## 7. Decisions, conflicts & assumptions

| Item | Decision |
|---|---|
| **Display font** | DESIGN.md says *Unbounded*; per the project owner's explicit request (reference screenshot) headings use **Fraunces** (soft serif) with a **pink** marker highlight. Body stays Poppins. |
| Icons | DESIGN.md (UI authority) specifies Phosphor → used Phosphor, not Lucide. |
| Research Map | Spec says Excalidraw; to ship on time it is a **hand-drawn-style SVG** rendered from `GET /runs/{id}/map` (the doc's §31 risk plan allows a simpler graph first). Selectable nodes + SVG export. Swapping to Excalidraw later only changes `components/run/research-map.tsx`. |
| PDF highlight (Hero 1) | Evidence drawer shows page/table + measured value + log line, and opens the paper PDF at the page (`#page=N`). In-page highlight overlay (react-pdf + `position_on_page`) is **not built yet**. |
| Dark mode | §26 mentions it; DESIGN.md defines no dark palette → not implemented. |
| Upload limits | Client-side: PDF ≤ 50 MB, dataset ≤ 500 MB, ≤ 2 papers. **Backend limits are authoritative** — tell me the real ones. |
| Voice / Telegram | No public API in §23 → no fake voice button; noted as proposed. |
| Demo mode | `NEXT_PUBLIC_USE_MOCKS=true` (dev only, **force-disabled in production builds**) swaps in an in-browser demo backend (`src/lib/api/mock/`). A yellow "DEMO DATA" banner is always shown. Delete `.env.local` or set it to `false` to hit the real backend. |

---

## 8. How to run & test integration

```bash
cd apps/web
cp .env.example .env.local     # set NEXT_PUBLIC_API_BASE_URL to the Go server
npm install
npm run dev                    # http://localhost:3000
npm run typecheck && npm run lint && npm test && npm run build
```

**Integration checklist for the first real run:**
1. `GET /me` with no cookie → **401** → app redirects to `/login`.
2. Login → callback lands on `/auth/callback?status=success&return_to=…` → dashboard.
3. Create workspace + upload PDF → upload progress → `POST /runs` → Live board receives events via SSE.
4. `checkpoint_waiting` (name `plan`) → Approve on `/map` → `checkpoint_resolved`.
5. `scorecard_updated` → Scorecard shows measured values with proof popovers.
6. Publish: secret scan blocked case (`status:"blocked"` + findings) and success case (`repo_url`, `commit_urls`).

**Verified so far:** `tsc --noEmit` ✅ · `eslint` ✅ · `vitest` 14/14 ✅ (API client error mapping, multipart, CSRF header, credentials, internal routes excluded, open-redirect guard, event de-dup, board derivation, checkpoints) · `next build` ✅ · UI walkthrough against the dev mock. **Not verified:** anything against the real Go backend (not available yet).
