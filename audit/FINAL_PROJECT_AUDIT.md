# Final Project Audit — Research Lab (Problem Statement 03)

**Audited:** branch `main` @ `0a941b6` (== `origin/main`; the user has since merged and pushed the integration branch)  
**Date:** 2026-10-10 · **Mode:** audit only, no source files changed (only this report was added)  
**Spec used:** `docs/allaboutourproject.md` (987 lines, read completely). The path named in the brief, `docs/All About My Project.md`, does not exist; this file is the match. `docs/DESIGN.md` and `docs/FRONTEND_INTEGRATION_NOTES.md` were used as secondary context.

## 1. Executive verdict

**FUNCTIONAL WITH KNOWN GAPS.**
The core pipeline genuinely runs end to end: a real arXiv paper was fetched, claims were extracted with page numbers, the plan was approved, code ran in a real Docker sandbox, numbers were recorded with proof, tests ran, the scorecard was filled and the Gap Detective ran experiments. It is **not "demo ready"** because the GitHub login/push path, the browser UI journey, voice-from-audio, the audio briefing and the sponsor API could not be verified or are absent, and on the Quick budget every claim comes out "different" from the paper.

| Dimension | Score |
|---|---|
| Implementation completeness (weighted, 22 spec features) | **77 / 100** |
| Verification confidence (what was actually proven) | **54 / 100** |
| Overall functional completion | **77 / 100** |
| End-to-end integration completion | **65 / 100** |
| Release / demo readiness | **55 / 100** |

## 2. What was executed (evidence)

| Command | Executed | Result |
|---|---|---|
| `go build ./...`, `go vet ./...` (backend) | yes | pass, exit 0 |
| `go test -count=1 ./...` | yes | **pass**: 36 PASS, 6 SKIP (skips are integration tests needing a disposable DB) |
| `go test -v ./internal/sandbox/` with `TEST_DATABASE_URL` (throwaway DB `lab_audit`) + real Docker | yes | **pass**, 71 s: all 8 Docker tests (timeout kill, cancel, no-network, locked-down host config, metrics validation) and all API integration tests (ownership/isolation, invalid paths, real-Docker end to end) |
| `go test -race ...` | attempted | **BLOCKED**: no 64-bit C compiler for cgo (`cc1.exe: 64-bit mode not compiled in`) |
| `gofmt -l .` | yes | flags 22 files; the diff is whole-file CRLF line endings (Windows), not code style |
| `pytest` in `agents/` | yes | **43 passed**, 1 warning (`asyncio_default_fixture_loop_scope` unknown option) |
| `npx tsc --noEmit`, `eslint src --max-warnings=0` | yes (earlier today, same tree) | pass, exit 0 |
| `vitest run` | yes | **71 passed** in 9 files |
| `next build` (Next 15.5.27) | yes | pass; 20 routes. Warning only: multiple lockfiles / `outputFileTracingRoot` |
| Live stack (API :8181, agents :8182, throwaway DB, Redis db 14) | yes | see §4 |
| Docker image builds, compose validation, CI | not run | no `.github/workflows` exists; compose only provides dependencies |
| Browser/UI journeys, mobile layout | **not run** | no browser session this audit |
| Live GitHub OAuth, n8n push, Arina AI, Kaggle, Whisper | **BLOCKED** | credentials not configured (`GITHUB_CLIENT_ID/SECRET`, `N8N_WEBHOOK_URL`, `ARINA_API_KEY` empty) |

Real data was never touched: the audit used a disposable database and Redis index, both removed afterwards, plus ports 8181/8182. The earlier "no tests were run / nothing pushed" statements in `audit/INTEGRATION_*.md` are superseded by this report.

## 3. Architecture inventory

- **Frontend:** Next.js 15 / React 19 / Tailwind 4 / TanStack Query; 20 routes (live, run workflow, map, explorer, sandbox, results tabs, replay, publish, share, profile, memory).
- **Go API (chi):** 85 routes in `backend/cmd/server/main.go` plus `internal/runs`, `sandbox`, `explorer`, `githubpush`, `voice`, `ratelimit`, `proof`, `store` (8 migrations, 001–008).
- **Python:** FastAPI + LangGraph worker (`agents/lab`): research, coding, testing, gap, whatif, observer, memory, healer, report, explorer; one tested recipe (`distillation`).
- **Infra:** Postgres+pgvector (Neon in `.env`, Docker locally), Redis (jobs `lab:jobs`, events `lab:events`, at-least-once via processing lists), Docker sandbox image `tapu-sena/sandbox-python`.
- **Git:** `main` clean except untracked `backend/err.log`, `out.log`, `out.txt` (stray logs). No committed secrets were looked for in history beyond `.env` being gitignored.

## 4. Live end-to-end results (run #7, Distillation paper, Quick budget)

| Step | Observed | Status |
|---|---|---|
| Unauthenticated `/me` | 401 | VERIFIED |
| Register ×2, login, wrong password | 201 / 401 | VERIFIED |
| `dev-login` when disabled | 404 | VERIFIED |
| State-changing call without `X-Requested-With` | 403 CSRF | VERIFIED |
| Workspace create; other user GET/list/start run/uploads | 404 / empty list (no cross-user access) | VERIFIED |
| Start run with no paper | 400 | VERIFIED |
| `file:///etc/passwd` as paper | 400 | VERIFIED |
| arXiv upload + run start | run queued, 26 events in ~20 s | VERIFIED |
| Claims extracted | 3 claims (67, 146, 74 test errors), page 4, quotes — match the paper | VERIFIED |
| Research map | 14 nodes, 10 edges (agent, claim, paper, related, source) | VERIFIED |
| Settings with source labels | 15 settings (paper / assumption / compute_change) | VERIFIED |
| Plan checkpoint approve ×2 concurrently | one 200, one 409 — exactly one `resume` | VERIFIED |
| Code from tested recipe, review, Docker install (52 s) + test-drive (budget estimate 2.9 min) + train (127 s) | 6 validated metrics from `metrics.json` | VERIFIED |
| Proof for a number | run, code commit `5ab2070b5c2f`, log file, sha256, line 21 | VERIFIED |
| Tests | 8 passed, 3 failed (claim tests, honestly failing) | VERIFIED |
| Scorecard | 0 of 3 match (e.g. paper 67, ours 309); status `different`, page + position stored | VERIFIED |
| Gap Detective | found 3 differences; "train longer" experiment ran (357 s) → 261 errors; further experiments were still running when I stopped | PARTIAL |
| Typed voice command ("how is the run going") | correct status reply with scorecard summary | VERIFIED (audio/Whisper path BLOCKED) |
| What-if question | accepted; 2+ child runs (temp5, temp5_alpha07, …) started; completion not observed | PARTIAL |
| Notes PUT/GET, share link + QR PNG, push preview (commit plan) | OK | VERIFIED |
| SSE stream | events delivered with ids | VERIFIED |
| Push without GitHub | not testable (run was flipped to `running` by the what-if) | BLOCKED |
| Duplicate "Start run" | second run #8 created | **BUG** (§7) |

Honest result note: the pipeline reports its own failure to match the paper rather than inventing numbers — consistent with the project's USP.

## 5. Integration matrix

| Workflow | Frontend | Go API | Python/AI | DB | External | End-to-end |
|---|---|---|---|---|---|---|
| Email login / sessions / CSRF | built, 71 unit tests | yes | n/a | yes | n/a | VERIFIED (API) |
| GitHub OAuth login, profile, repos | built | code present | n/a | yes | GitHub | BLOCKED — no credentials |
| Workspace, uploads (arXiv link) | built | yes | n/a | yes | arXiv | VERIFIED (API) |
| File upload (multipart PDF) | built | code present | — | — | — | NOT TESTED |
| Research → brief → claims → map | built | yes | yes | yes | arXiv, Gemini/Groq | VERIFIED |
| Plan edit / approve | built | yes (`changes`, drafts) | yes | yes | — | VERIFIED (approve); edit covered by unit tests only |
| Coding in Docker + repair loop | built | yes | yes | yes | Docker | VERIFIED (first-try success); live repair not exercised |
| Testing + scorecard + proof | built | yes | yes | yes | Docker | VERIFIED |
| Gap Detective | built | yes | yes | yes | Docker | PARTIAL |
| What-if branches | built | yes | yes | yes | Docker | PARTIAL |
| Self-healing debugger (manual heal) | built | yes | code + unit tests | yes | **Arina AI** | MOCKED/unit only — no key |
| Push to GitHub (n8n / direct) | built | yes (preview OK) | — | yes | GitHub, n8n, Gitleaks | BLOCKED |
| Voice (typed) / voice (audio) | built | typed OK | — | — | Groq Whisper | typed VERIFIED; audio BLOCKED |
| Share link / QR / replay | built | link + QR OK | — | yes | — | API VERIFIED; UI NOT TESTED |
| Audio briefing | page calls `/runs/{id}/briefing` | **no route** | no Kokoro | — | — | NOT IMPLEMENTED |
| Kaggle run | — | — | none | — | Kaggle | NOT IMPLEMENTED |
| Paper vs Paper | `mode` toggle on new-workspace form | stores `mode` | no comparison logic | column exists | — | NOT IMPLEMENTED (shell only) |

Contract check (script over `frontend/src/lib/api/endpoints.ts` vs Go routes): 66 frontend endpoints, 85 backend routes; **one** frontend endpoint without a backend route (`briefing`, flagged "proposed"); 20 backend routes without a frontend entry are internal/health/share/OAuth/upload-management routes.

## 6. Spec compliance (summary of requirements traceability)

Weights (3 = core, 2 = hero, 1 = minor), scores are *implementation % / verified %*. Weighted sums: implementation = Σ(w·impl)/Σw, verified = Σ(w·ver)/Σw, Σw = 60.

| ID | Requirement (spec §) | Evidence / location | Impl % | Verified % |
|---|---|---|---|---|
| M1 | GitHub login, profile, connection (§10.1, §17.1) | `internal/auth`, `/profile`; email login works; OAuth creds empty | 80 | 40 |
| M2 | Workspace + uploads (§10.2) | `workspace.go`; arXiv link live; multipart untested | 95 | 85 |
| M3 | Research/Coding/Testing agents + sub-agents (§8) | `agents/lab/{research,coding,testing}.py`; only the Distillation recipe is proven; general papers rely on LLM-written code (unverified) | 85 | 70 |
| M4 | Docker sandbox with limits (§16) | `sandbox/engine.go`; 8 Docker tests pass; network none at run | 95 | 95 |
| M5 | Auto error repair (§8.3) | `graph.py` loop, `healer.py`, unit tests; live repair not triggered | 85 | 55 |
| M6 | Claim Scorecard (§11 Hero 1) | `/runs/{id}/scorecard`, live | 90 | 85 |
| M7 | Gap Detective (§11 Hero 3) | `gap.py`, live experiments | 85 | 60 |
| M8 | What-if with successive halving (§11 Hero 5) | `whatif.py`, branches started, outcome not seen | 80 | 35 |
| M9 | Lab Memory (§11 Hero 6) | `memory.py`; embeddings fell back to `hashing-384` (fastembed/BGE not loaded) | 70 | 40 |
| M10 | Live Agent Board (§25.4) | frontend + SSE; no browser run | 85 | 40 |
| M11 | Approval checkpoints (§9.1, §10.11) | plan checkpoint live; long-run/push implemented | 90 | 70 |
| M12 | Mobile + voice control (§10.12) | typed OK; audio and mobile layout untested | 60 | 30 |
| M13 | Push via n8n + Gitleaks (§17) | `githubpush`, preview OK; no n8n URL / GitHub token | 80 | 20 |
| M14 | Markdown notes (§10.14) | live | 90 | 80 |
| H1 | PDF viewer with highlighted number | only `#page=N` link; position is stored but no PDF.js overlay | 40 | 20 |
| H2 | No number without proof (§11 Hero 2) | proof endpoint with hash+line; `internal/proof` tests | 90 | 85 |
| H4 | Missing Details Log | settings carry source; paper "missing details" list was empty for this paper | 85 | 70 |
| H7 | Live Research Map | custom graph, not Excalidraw/React Flow | 70 | 40 |
| H8 | Compute Budget Planner | test-drive estimate observed (2.9 min vs 5) | 85 | 80 |
| H9 | Audio briefing (Kokoro) | absent; UI shows "not available yet" | 10 | 0 |
| H10 | Paper vs Paper | form toggle + column only | 15 | 0 |
| H11 | Share link/QR + Replay | link/QR/events OK; UI untested | 80 | 45 |

Result: **implementation 77.3 %, verified 54.2 %**; must-build items alone 83.6 % / 57.9 %. Rows covering the spec's deliberately omitted items (meta-controller, reward loop, agent retirement — spec §9) are excluded as "not applicable by decision".

Spec technologies not present in code: **Docling, Kokoro, Kaggle API, Hugging Face integration, Excalidraw, React Flow, react-pdf/PDF.js** (PyMuPDF and a custom graph are used instead). Semantic Scholar, OpenAlex, arXiv source and Gemini are used.

## 7. Bug and gap register

| ID | Sev | Component | Finding | Evidence | Recommended fix |
|---|---|---|---|---|---|
| B1 | **HIGH** | Reliability | Quick-budget results differ from the paper on all 3 claims (309 / 294 / 334 vs 67 / 146 / 74); the spec's demo story expects ~81 vs 74 | Live scorecard, run #7 | Tune Quick (epochs/subset) or demo with Standard; pre-run and keep a recorded run |
| B2 | **MEDIUM** | Runs API | Pressing Start twice creates a second run (#8) on the same workspace; no active-run guard | `POST /workspaces/7/runs` twice → 201, 201 | Reject or return the existing active run (idempotency) |
| B3 | **MEDIUM** | Agents/DB | Run #8 failed with `duplicate key ... pg_namespace_nspname_index` — concurrent first LangGraph checkpoint setup race on a fresh DB | `audit-agents.log`, run #8 event `run_failed` | Serialise checkpoint `setup()` at startup (once, before the worker starts) |
| B4 | MEDIUM | Runs state | Run status moved `completed` → `running` again while the Gap Detective / what-if work continued; confuses the push guard ("run must be completed") | status polls, push response | Keep gap/what-if as sub-state or separate status; document |
| B5 | MEDIUM | Frontend/API | `GET /runs/{id}/briefing` is called but does not exist; audio briefing/Kokoro not built | contract script | Build it or hide the control |
| B6 | MEDIUM | Spec drift | No PDF highlight, Excalidraw, React Flow, Docling, Kaggle, HF, Paper-vs-Paper logic | §6 | Decide scope; update spec or implement top items (PDF highlight first) |
| B7 | MEDIUM | Memory | Embeddings fell back to `hashing-384`; semantic search quality below the spec's BGE | `/healthz` of agents: `embedder: hashing-384` | Install/verify fastembed model on the demo machine |
| B8 | MEDIUM | Testing | No CI workflow; no tests for `store`, `explorer`, `githubpush`, `voice`, `ratelimit`, `config`, `agentsclient`; no browser E2E; no coverage measurement | `go test` output | Add CI and a Playwright smoke path |
| B9 | LOW | Agents | "Missing details" list empty for the Distillation paper (spec lists it as an output) | `/runs/7/research` | Check extraction prompt |
| B10 | LOW | Tooling | `-race` cannot run (no cgo compiler); gofmt reports CRLF on 22 files; pytest warns about an unknown ini option | commands above | Add `.gitattributes`/`.editorconfig`; install MinGW or run race tests in CI |
| B11 | INFO | Data | Seeded workspaces are hand-authored "SAMPLE DATA", not real runs — don't present them as pipeline output | `cmd/seed/*.go` | Label in UI/demo |
| B12 | INFO | Secrets | Real provider keys and a DB password live in the local `.env` (gitignored) and were shared in chat earlier | `.env` | Rotate before any public demo; keep dev login off |

No critical (data-loss/auth-bypass) findings: access control, CSRF and sandbox isolation tests passed.

## 8. External / sponsor integrations

| Integration | Status |
|---|---|
| Groq / Gemini | VERIFIED live (key rotation configured: 4 Groq, 3 Gemini keys; run used them) |
| arXiv (PDF + LaTeX) | VERIFIED live |
| Semantic Scholar / OpenAlex | implemented; not isolated in this run |
| Docker sandbox | VERIFIED |
| **Arina AI (Elevate gateway; called "Arena AI" in the brief)** | implemented in `agents/lab/llm.py` and used only by `healer.py`; **BLOCKED — `ARINA_API_KEY` empty**; falls back to Groq/Gemini; never called live |
| GitHub OAuth, repo push, n8n, Gitleaks | implemented; **BLOCKED** (no credentials; Gitleaks binary not exercised) |
| Whisper (audio), Kokoro, Kaggle, Hugging Face | Whisper BLOCKED; others absent |

## 9. Category scores

| Category | Score | Basis |
|---|---|---|
| Frontend | 80 | builds, types, lint, 71 tests; no browser journey |
| Go backend | 85 | build/vet/tests; live auth, isolation, CSRF, checkpoints |
| Python / AI agents | 80 | live pipeline; one proven recipe; healer unit-tested |
| Database & persistence | 85 | migrations 001–008 apply on a fresh DB; run data persisted and re-read; Neon not exercised here |
| API / service integration | 85 | Go↔Python both directions live; 1 phantom endpoint |
| External integrations | 35 | Groq/Gemini/arXiv live; GitHub/n8n/Arina blocked; several spec items absent |
| Core workflow | 80 | research → plan → code → test → scorecard → gap observed |
| Automated testing | 60 | 150+ passing tests, no coverage numbers, no E2E, no CI |
| Security / reliability | 70 | strong isolation and access control; B2/B3/B4 open |
| Deployment readiness | 45 | compose for dependencies only, no CI, no tunnel/hosting verified |

Tests actually executed: Go 36 pass / 0 fail / 6 skipped (default), all pass with a disposable DB + Docker; Python 43/43; frontend 71/71 → **100 % of executed tests passed**, but that proves unit/integration behaviour only.

## 10. Remaining work

**P0 — none blocking startup.**

**P1 — before demo/submission**
1. Make the demo result credible: tune the Quick budget (or demo Standard) and keep a pre-run recording (B1). *Accept:* ≥ 2 of 3 claims Match/Close on the demo laptop.
2. Verify GitHub login + push: set OAuth credentials, test Gitleaks and direct push/n8n. *Accept:* repo with the per-stage commits from `push/preview`.
3. Run the UI journey in a browser (new workspace → board → plan approve → results → scorecard → share/replay), desktop and phone.
4. Guard duplicate starts and the first-start checkpoint race (B2, B3).
5. Resolve run-status flapping (B4) or explain it in the UI.
6. Set `ARINA_API_KEY` and run one heal session if the sponsor API is claimed; otherwise don't claim it.

**P2**
7. PDF viewer with highlighted claim position (Hero 1); 8. fix or remove the briefing control (B5); 9. confirm BGE embeddings (B7); 10. CI workflow plus Playwright smoke test (B8); 11. complete a what-if and Gap Detective run and check final explanation text; 12. test multipart PDF upload and a non-Distillation paper.

**P3**
13. Paper-vs-Paper, Kaggle, Docling, Excalidraw (spec drift, B6); 14. CRLF / gofmt / pytest ini cleanups (B10); 15. rotate exposed keys (B12).

## 11. Limitations of this audit

No browser/mobile testing; GitHub, n8n, Arina, Whisper not exercised; the Gap Detective and what-if branches were still running when I stopped the stack, so their final outputs were not observed; only the Distillation paper path was run live; Neon (the `.env` database) was deliberately not used; code coverage was not measured.
