# API Contract Matrix — frontend client vs Go backend

Sources: frontend `src/lib/api/{endpoints,services,types,client,sse}.ts`; backend `cmd/server/main.go` and handlers; spec `docs/allaboutourproject.md` §23.
Nothing has been exercised against a live backend, so the best possible status here is **MATCHED BUT UNTESTED**.

Base URL: FE `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080`, no prefix) = BE root. ✓
Auth: cookie `lab_session` HttpOnly, SameSite=Lax, `credentials: include`. ✓ Backend returns JSON 401. ✓
Error body: BE `{"error":"msg"}`, which the FE parser accepts. ✓ No `fields` → no per-field form errors.
**CORS: BROKEN.** The FE sends `X-Requested-With` on every mutation (`client.ts:73,167`). BE allows only `Content-Type, Authorization, Last-Event-ID` (`httpx.go:91`), so the preflight fails. Proxy mode (`/api` rewrite) avoids this.

| # | Operation | FE calls | BE route | Status | Detail |
|---|---|---|---|---|---|
| 1 | Start GitHub login | `GET /auth/github/login?return_to=/x` | same, reads `?redirect=<full frontend URL>` | REQUEST SCHEMA MISMATCH | `return_to` is ignored → always lands on `/profile`; FE `/auth/callback` page never reached |
| 2 | OAuth callback | expects 302 → `/auth/callback?status=…` | 302 → `redirect` or `/profile`; errors → `/login?error=` | RESPONSE SCHEMA MISMATCH | callback page unused |
| 3 | Dev login | — (no FE caller) | `POST /auth/dev-login` | FRONTEND CALL MISSING | needed for local integration without GitHub |
| 4 | Logout | `POST /auth/logout` | ✓ 204 | MATCHED BUT UNTESTED (CORS) | |
| 5 | Profile | `GET /me` → `{user, github:{status:"connected"\|"not_connected"…, scopes:string[], default_repo\|null}}` | `{user, github:{connected, status:"connected"\|"disconnected"\|"never", scopes:"a,b", default_repo:""}, pushes}` | RESPONSE SCHEMA MISMATCH | enum + `scopes` type + `""` vs null |
| 6 | My pushes | `GET /me/pushes` | none (embedded in `/me.pushes`) | BACKEND ENDPOINT MISSING | use `/me.pushes` |
| 7 | List repos | `GET /github/repos` | ✓ | MATCHED BUT UNTESTED | BLOCKED on OAuth creds |
| 8 | Create repo | `POST /github/repos {name, private, description}` | ✓ (+`set_default`) | MATCHED BUT UNTESTED | BE returns 400, not 422, on bad name |
| 9 | Default repo | `PUT /github/default-repo {full_name}` | ✓ | MATCHED BUT UNTESTED | |
| 10 | Disconnect | `DELETE /github/connection` | ✓ (200 JSON) | MATCHED BUT UNTESTED | |
| 11 | List workspaces | `GET /workspaces` | ✓ `Workspace[]` | MATCHED BUT UNTESTED | no `latest_run`/`paper_count` |
| 12 | Create workspace | `POST /workspaces {title, compute_budget, note}` → expects `Workspace` | returns `{workspace, uploads}` | RESPONSE SCHEMA MISMATCH | FE reads `res.id` → `undefined` → every next call fails |
| 13 | Get workspace | expects `Workspace + runs[] + papers[] + role + latest_push` | `{workspace, uploads}` (runs at `GET /workspaces/{id}/runs`) | RESPONSE SCHEMA MISMATCH | |
| 14 | Upload file | multipart `kind`, `file` | ✓ | MATCHED BUT UNTESTED (CORS) | BE dataset limit 1 GB vs FE 500 MB |
| 15 | Upload arXiv / link | **multipart** `kind`, `url` | multipart requires exactly one `file`; links accepted only as **JSON** `{kind,url}` | REQUEST SCHEMA MISMATCH | arXiv link → 400 |
| 16 | Notes | `GET/PUT /workspaces/{id}/notes {markdown}` | ✓ | MATCHED BUT UNTESTED | `author` is a string + `author_type` |
| 17 | Share | `POST /workspaces/{id}/share {expires_in_hours}` | ✓ reads `hours` | REQUEST SCHEMA MISMATCH (minor) | default 72 h is used; response has `url` + `qr_png_base64` |
| 18 | Start run | `POST /workspaces/{id}/runs {compute_budget}` | ✓ 201 `Run` | MATCHED BUT UNTESTED | BE 400 (not 422) when no paper |
| 19 | Get run | `GET /runs/{id}` → `Run` | `{run, workspace, checkpoints, pending_checkpoint, children, stages}` | RESPONSE SCHEMA MISMATCH | |
| 20 | Event stream | `EventSource /runs/{id}/stream` | ✓ `id:`, **`event: <type>`**, `data:` | BROKEN | browser only fires listeners for named types; FE registers 34 names from the proposed list, BE emits ~46 types and only ~8 overlap. Heartbeat is a comment `: ping`, not `event: heartbeat` → false "stale" warning |
| 21 | Events (replay) | `GET /runs/{id}/events` | ✓ array | MATCHED BUT UNTESTED | event `type` vocabulary differs (see 20) |
| 22 | Checkpoint | `POST /runs/{id}/checkpoints/{name} {decision, instructions}` | expects `{action, instruction, option}` | REQUEST SCHEMA MISMATCH | → 400 "action must be approve, edit or reject" |
| 23 | Agent action | `POST /runs/{id}/agents/{coding}/action {action, instruction}` | agent must be `run` or a full slug (`coding.writer`…); field `text`; `thumbs_up/down` unsupported | PATH + REQUEST MISMATCH | → 404 "unknown agent coding" |
| 24 | Scorecard | expects `{claim, metric, status:null\|…}` | `{claim, ours, status:"match"\|"close"\|"different"\|"missing", relative_difference}` | RESPONSE SCHEMA MISMATCH | FE shows every row "Unverified" |
| 25 | Settings | `GET /runs/{id}/settings` | ✓ (+`paper_value`; source may be `researcher`) | MATCHED BUT UNTESTED | add `researcher` to FE enum |
| 26 | Ask what-if | `POST /runs/{id}/whatif {question}` → branches | `202 {question_id, status:"queued"}`; 409 until metrics exist | RESPONSE SCHEMA MISMATCH (tolerable) | FE should refetch list |
| 27 | List what-ifs | `GET /runs/{id}/whatif` | ✓ | MATCHED BUT UNTESTED | field names: `result` vs `result_metric`, `reason` vs `stop_reason` |
| 28 | Research brief | `GET /runs/{id}/brief` | `GET /runs/{id}/research` → `{papers[{claims}], brief_markdown}` | PATH/METHOD MISMATCH | |
| 29 | Map | `GET /runs/{id}/map` → `{nodes, edges}` | ✓ path, returns `{run_id, graph:{nodes,edges}, version}` | RESPONSE SCHEMA MISMATCH | |
| 30 | Gaps | `GET /runs/{id}/gaps` | `GET /runs/{id}/gap` (array of analyses) | PATH/METHOD MISMATCH | |
| 31 | Files | `GET /runs/{id}/files` → `{path, kind, size_bytes}` | ✓ `{path, size}` | RESPONSE SCHEMA MISMATCH (minor) | |
| 32 | File content | `GET /runs/{id}/files/content?path=` | `GET /runs/{id}/file?path=` | PATH/METHOD MISMATCH | |
| 33 | Tests | `GET /runs/{id}/tests` | none (JUnit parsed in Python, not exposed) | BACKEND ENDPOINT MISSING | |
| 34 | Run memory | `GET /runs/{id}/memory` | none | BACKEND ENDPOINT MISSING | |
| 35 | Report export | `GET /runs/{id}/report` | none (`/push/preview` has README) | BACKEND ENDPOINT MISSING | |
| 36 | Audio briefing | `GET /runs/{id}/briefing` | none (`/runs/{id}/summary` is internal text only, no TTS) | BACKEND ENDPOINT MISSING | |
| 37 | Paper PDF | `GET /papers/{id}/file` | `GET /papers/{id}/pdf` | PATH/METHOD MISMATCH | |
| 38 | Metric proof | — | `GET /metrics/{id}/proof` | FRONTEND CALL MISSING | Hero 2 hover card |
| 39 | Push | `POST /runs/{id}/push {approved, repo_full_name}` → `Push` | reads `repo`; returns `202 {push_id, status}` | REQUEST + RESPONSE MISMATCH | repo choice ignored |
| 40 | Push status | `GET /runs/{id}/push` | `GET /runs/{id}/pushes` (list); status `done` (FE expects `succeeded`), no `scanning` | PATH/METHOD MISMATCH | publish page never sees success |
| 41 | Push preview | — | `GET /runs/{id}/push/preview` | FRONTEND CALL MISSING | |
| 42 | Agents | `GET /agents` → `Agent[]` | `{ "coding.writer": true, … }` map | RESPONSE SCHEMA MISMATCH | FE agent page/team tab break |
| 43 | Agent history | `GET /agents/{id}/history` | none | NOT APPLICABLE | Manager feature removed → delete FE call |
| 44 | Memory search | `GET /memory/search?q=` | ✓ `{mode, results}` (FE unwraps `results`) | MATCHED BUT UNTESTED | |
| 45 | Shared view | `/share/{token}`, `/share/{token}/events\|stream\|scorecard` | `/share/{token}` ✓; others are `/share/{token}/runs/{runId}/…` | PATH/METHOD MISMATCH | |
| 46 | Voice | — | `POST /voice/command` (multipart `audio`), `POST /voice/text` | FRONTEND CALL MISSING | Must-build #12 / Hero 9 |
| 47 | Internal routes | never called by browser (unit test asserts) | `/internal/*` with `X-Internal-Token` | MATCHED | CORS applies to them too; token compare is not constant-time |

**Totals (46 applicable, #43 N/A):** matched-but-untested 15 · mismatched 22 · backend missing 5 · frontend missing 4 · broken 1 (SSE) · CORS blocks every mutation in direct mode.
IDs: BE uses int64, FE types say string. This works in JS because ids are interpolated into paths, but strict equality on events (`id`) mixes numbers and strings. Normalise in the adapter.
