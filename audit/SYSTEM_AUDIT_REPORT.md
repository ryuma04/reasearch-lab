# System Audit Report — Elevate 1.0 · PS03 "An Evolving AI Research Environment"

**Audit date:** 2026-10-10 · **Commit audited:** `b09e93c` (main) · **Method:** static source review of every module + execution of all existing build/test commands. No source files were modified.

**Scope rule:** the Manager / Team Manager feature (agent scoring, team evolution, `team_decisions`, `agent_versions`) is **out of scope** and is not counted as missing work. Leftover references to it are listed as cleanup items (see [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) → `DOC-*`).

## Reports

| Report | Contents |
|---|---|
| [REPOSITORY_INVENTORY.md](REPOSITORY_INVENTORY.md) | Every module, its location, responsibility, status, evidence |
| [FRONTEND_AUDIT.md](FRONTEND_AUDIT.md) | Page-by-page status of the Next.js app |
| [BACKEND_AUDIT.md](BACKEND_AUDIT.md) | Every Go route, handler, dependency, defect |
| [PYTHON_AI_AUDIT.md](PYTHON_AI_AUDIT.md) | Each agent: real / recipe / LLM / heuristic, invocation, tests |
| [PIPELINE_INTEGRATION_AUDIT.md](PIPELINE_INTEGRATION_AUDIT.md) | Pipelines A–M with stage-by-stage connection status + Mermaid diagram |
| [API_CONTRACT_MATRIX.md](API_CONTRACT_MATRIX.md) | Frontend call vs backend route, operation by operation |
| [DATABASE_DATA_AUDIT.md](DATABASE_DATA_AUDIT.md) | Schema, migrations, integrity, provenance |
| [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) | All findings with ID, severity, evidence, fix, regression test |
| [TEST_AUDIT_REPORT.md](TEST_AUDIT_REPORT.md) | Commands executed and their exact outcomes |
| [COMPLETION_SCORECARD.md](COMPLETION_SCORECARD.md) | Weighted requirement inventory and percentages |
| [FEATURE_TRACEABILITY.md](FEATURE_TRACEABILITY.md) | Spec §10/§11 features → code → status |
| [FRONTEND_INTEGRATION_NOTES.md](FRONTEND_INTEGRATION_NOTES.md) | Contract decisions needed between frontend and backend owners |
| [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) | Ordered plan to reach a working end-to-end run |
| [REMAINING_WORK.md](REMAINING_WORK.md) | Prioritised P0–P3 backlog with acceptance criteria |

## Executive summary

**The three codebases are individually substantial and all compile and pass their own unit tests. They have never run together, and the frontend cannot talk to the backend as written.**

- **Go backend (≈4,900 lines):** all routes from spec §23 exist, plus many extras. Real implementations exist for the Docker sandbox, `metrics.json` → proof-linked metrics, the proof checker, the secret scan, the n8n push with a direct-push fallback, SSE with replay, share links with QR codes, and voice-command understanding. Builds clean; `go vet` is clean; 3 of 15 packages have tests, and all pass. **Never started in this audit:** Redis is not installed and Docker Desktop is not running, so `bus.New` would fail after 60 s.
- **Python agents (≈3,700 lines):** a real LangGraph pipeline (Research → plan checkpoint → Coding with test-drive/long-run/help checkpoints → Testing → Gap → Finalize) with a Postgres checkpointer, a Redis job consumer, a repair loop that consults Lab Memory, what-ifs with successive halving, and the Gap Detective. For the demo paper (Hinton 2015) the code, claims and ablations come from a **hand-written recipe**, not from the LLM. The generic LLM path exists but has never been exercised. 13/13 unit tests pass in `.venv`.
- **Frontend (≈5,900 lines):** 18 routes; typecheck, lint, 14/14 tests and the production build all pass. It was built against an in-browser **mock** using the *proposed* contract in `docs/FRONTEND_INTEGRATION_NOTES.md`. That contract differs from what the Go backend actually serves in **~30 places** (paths, request field names, response envelopes, enum values). The CORS preflight also rejects the `X-Requested-With` header the client sends on every mutation.
- **End-to-end verification: 0%.** No run has been executed in this environment.

### Headline percentages (details in [COMPLETION_SCORECARD.md](COMPLETION_SCORECARD.md))

| Area | Weighted completion | Verified by execution |
|---|---|---|
| Frontend | **18 %** (code present 88 %) | 2 % |
| Go backend | **48 %** (45 % conservative) | 9 % |
| Python / AI agents | **45 %** | 13 % |
| Database | **36 %** | 0 % |
| API integration (FE↔BE) | **16 %** | 0 % |
| Inter-service pipelines | **38 %** (35 % conservative) | 0 % |
| End-to-end workflow | **0 %** | 0 % |
| Testing readiness | **19 %** | — |
| Security & reliability | **43 %** | — |
| Deployment / demo readiness | **21 %** | — |
| **Overall in-scope** | **≈ 34 %** | **≈ 5 %** |

Unverified code counts at most 0.5. That rule, and the broken FE↔BE contract, are the main reasons the numbers are low despite the volume of code.

### Most important findings

1. **P0 SEC-01 — Sandbox escape via host-side `git`.** `sandbox.codeVersion()` runs `git add/commit` on the host inside the project folder. That folder is mounted read-write into the container, so sandboxed code can plant `.git/config` (`core.fsmonitor`) or `.git/hooks/*`, and the next exec then runs arbitrary commands **on the host**.
2. **P0 INT-01 — CORS blocks every browser mutation.** The client always sends `X-Requested-With`, but `httpx.CORS` only allows `Content-Type, Authorization, Last-Event-ID`.
3. **P0 INT-02…INT-12 — Contract mismatches break the core flow.** Affected: create workspace (`{workspace,…}` envelope), arXiv upload (multipart `url` rejected), checkpoint (`decision` vs `action`), agent action (`coding` vs `coding.writer`; `instruction` vs `text`), scorecard (`metric` vs `ours`), push status, share view and login redirect.
4. **P1 ENV-01 — The stack cannot start on this machine.** Redis is missing, Docker is stopped, and no sandbox image is built.
5. **P1 REL-01 — Fragile queues.** Jobs and events use Redis `BRPOP`, which delivers at most once. A crash mid-job loses the job, and a push stuck in `pushing` blocks all future pushes for that run.

### Smallest safe next step

Fix INT-01 (CORS headers) and align the 6 core-flow contracts in **one place** (the frontend service/adapter layer — recommended, because the backend shapes are richer and already feed the Python side). Then bring up Postgres + Redis + agents + API with `SANDBOX_MODE=local`, and drive one dev-login → workspace → arXiv 1503.02531 → run → plan approval → scorecard flow. See [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) §Phase 1.
