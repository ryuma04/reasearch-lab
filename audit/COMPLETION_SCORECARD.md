# Completion Scorecard

## Method
- Requirements come from `docs/allaboutourproject.md` (§7, §10, §11, §16–§26), the code, and the API contract. Manager/Team-evolution items (§2.3 rows 5–7, `/agents/{id}/history`, `/team`) are **NOT APPLICABLE** and are excluded.
- Weight: 1 small · 2 medium · 3 critical workflow/integration. Factor: VERIFIED 1.0 · IMPLEMENTED-UNVERIFIED 0.5 · PARTIAL = demonstrated fraction (≤0.5 here, because nothing ran live) · BROKEN 0 · MISSING 0 · BLOCKED excluded (conservative score counts it as 0) · N/A excluded.
- **Completion % = 100 × Σ(w·f) / Σ(w applicable).** **Verification %** = weighted share of applicable requirements with executed test or runtime evidence (unit-test evidence counts in proportion to what it covers).
- **Presence %** = code exists (1), partial (0.5), absent (0), independent of whether it works.

## Frontend (43 weight)
| Requirement | w | Status | f |
|---|---|---|---|
| Login screen | 1 | IU | .5 |
| Auth callback | 1 | BROKEN (never reached) | 0 |
| Dashboard | 2 | IU | .5 |
| Profile / GitHub | 2 | PARTIAL (shape) | .25 |
| New workspace + uploads | 3 | BROKEN | 0 |
| Workspace overview | 2 | BROKEN | 0 |
| Live Agent Board | 3 | PARTIAL | .25 |
| Checkpoint 1 approve/edit/reject | 3 | BROKEN | 0 |
| Research map | 2 | PARTIAL | .25 |
| Results tabs | 3 | PARTIAL | .25 |
| Claim Scorecard + proof | 3 | BROKEN | 0 |
| What-ifs tab | 2 | PARTIAL | .25 |
| Run Replay | 2 | IU | .5 |
| Publish / Checkpoint 2 | 3 | BROKEN | 0 |
| Memory search | 1 | PARTIAL | .25 |
| Shared live view + QR | 2 | BROKEN | 0 |
| Voice / typed commands UI | 2 | MISSING | 0 |
| Mobile layout | 2 | IU | .5 |
| Loading/error/401 states | 1 | IU (unit-tested client) | .5 |
| PDF highlight (Hero 1) | 2 | PARTIAL | .25 |
| Dark mode | 1 | MISSING | 0 |
| **Total** | 43 | | **7.75 → 18.0 %** · presence 88 % · verification 2 % |

## Go backend (50 weight; OAuth 3 BLOCKED → 47 applicable)
Config/startup 2×.5 · migrations 2×.5 · GitHub OAuth 3 BLOCKED · dev login 1×.5 · workspaces 2×.5 · uploads 2×.5 · notes 1×.5 · run start/queue 3×.5 · SSE/events 3×.5 · checkpoints 3×.5 · agent controls 2×.5 · results views 2×.5 · sandbox 3×.25 (SEC-01) · metrics provenance 3×.5 · proof checker 2×.75 · token crypto 1×1 · push pipeline 3×.5 · secret scan 2×.5 · rate limiter 1×.5 · voice 2×.5 · share 2×.5 · memory search 1×.5 · health 1×.5 · shutdown 1×.5 · CORS/CSRF 2×0
**Σ = 22.75 → 48.4 %** (conservative 22.75/50 = **45.5 %**) · presence ≈ 96 % · verification 8.5 %

## Python / AI (39 weight)
FastAPI 1×.5 · worker 2×.5 · LangGraph + interrupts + checkpointer 3×.5 · Paper Reader 3×.375 · Source Finder 2×.25 · Code Writer 3×.5 · Debugger + memory 3×.5 · Test Designer/Runner/Scorecard 3×.5 · Gap Detective 3×.5 · What-If + halving 3×.5 · Observer 2×.5 · Lab Memory 2×.5 · LLM router 2×.75 · Intent 1×.5 · Budget planner 2×.5 · Audio briefing 1×0 · Paper vs Paper 2×.25 · Kaggle offload 1×0
**Σ = 17.63 → 45.2 %** · verification 12.8 %

## Database (14) — **35.7 %**, verification 0 % (see DATABASE_DATA_AUDIT)

## API integration FE↔BE (46 applicable operations, w=1 each)
15 matched-but-untested × .5 = 7.5; 22 mismatched, 5 BE-missing, 4 FE-missing, 1 broken = 0 → **16.3 %**, verification 0 %. (In direct mode, CORS makes even the matched mutations fail.)

## Inter-service pipelines (A–M)
A 0 (w3) · B .5 (2) · C .5 (2) · D .5 (3) · E .5 (3) · F .5 (2) · G .5 (3, Docker BLOCKED for runtime but code connected) · H .25 (3) · I .25 (3) · J .5 (3) · K .5 (2) · L BLOCKED (3) · M 0 (1)
**11.5 / 30 = 38.3 %** (conservative incl. L: 34.8 %) · verification 0 %

## Other components
| Component | Requirements (w·f) | % |
|---|---|---|
| End-to-end workflow verification | upload→run→approve→scorecard→gap→what-if→push: none executed | **0 %** |
| Testing readiness | unit per layer 3×(2×.5); integration 3×0; E2E 3×0; contract 2×0; CI 2×0 | **18.8 %** |
| Security & reliability | crypto 2×1; cookies 1×.5; authz 3×.5; sandbox isolation 3×0; secret scan 2×.5; internal auth 2×.5; CSRF 1×.25; API rate limit 1×0; upload validation 2×.5; secrets hygiene 1×.5 → 7.75/18 | **43.1 %** |
| Deployment / demo readiness | compose 2×.5; sandbox images 2×0; Docker running 2×0; Redis 2×0; FE build 2×1; CI 1×0; tunnel 1×0; pre-recorded run 2×0 → 3/14 | **21.4 %** |

## Scorecard

| Component | Applicable reqs | Verified complete | Partial / unverified | Broken / missing | Blocked | Weighted completion | Verification | Confidence |
|---|---|---|---|---|---|---|---|---|
| Frontend | 21 | 0 | 13 | 8 | 0 | **18 %** | 2 % | Medium-high |
| Go backend | 24 | 1 | 22 | 1 | 1 | **48 %** (45 %) | 9 % | Medium |
| Python / AI | 18 | 0 | 16 | 2 | 0 | **45 %** | 13 % | Medium |
| Database | 8 | 0 | 5 | 3 | 0 | **36 %** | 0 % | Medium |
| API integration | 46 | 0 | 15 | 31 | 0 | **16 %** | 0 % | High |
| Pipelines | 12 | 0 | 10 | 2 | 1 | **38 %** (35 %) | 0 % | Medium |
| End-to-end | 1 | 0 | 0 | 1 | 0 | **0 %** | 0 % | High |
| Testing | 5 | 0 | 1 | 4 | 0 | **19 %** | — | High |
| Security / reliability | 10 | 1 | 7 | 2 | 0 | **43 %** | — | Medium |
| Deployment / demo | 8 | 1 | 1 | 6 | 0 | **21 %** | — | High |

### Overall
Weights (sum 100, each requirement counted in one component only; E2E is reported separately because it re-tests the same features): FE 20 · BE 20 · Python 20 · DB 8 · API integration 12 · Pipelines 10 · Testing 4 · Security 3 · Deployment 3.
**Overall in-scope completion = 0.20·18 + 0.20·48.4 + 0.20·45.2 + 0.08·35.7 + 0.12·16.3 + 0.10·38.3 + 0.04·18.8 + 0.03·43.1 + 0.03·21.4 ≈ 33.6 % → ≈ 34 %.**
**Overall verified (executed evidence) ≈ 5 %.**

### Where the points were lost
1. Nothing ran live, so every "implemented" item is capped at 0.5. This is the largest single factor: the backend and agents would sit around 85–90 % if their code were verified.
2. The FE↔BE contract was designed separately (≈30 mismatches + CORS + SSE named events), so most of the frontend operational score is 0.
3. Missing features: voice UI, audio briefing (Kokoro), Paper vs Paper, Kaggle, dark mode, PDF highlight overlay, collaborator invites, CI.
4. Security: the P0 sandbox escape zeroes "sandbox isolation".

### Assumptions & limits
- Unit-test evidence is weighted by what it covers, not by pass count.
- Partial factors are auditor judgements from code reading. They could shift by ±10 points per component once things are run.
- Neon DB contents were not inspected.
