# Python / AI Agent Audit (`agents/`)

**Env:** project venv `.venv` (Python 3.13). The system Python lacks `psycopg`, so tests only run in the venv. `compileall` ✓. `pytest tests` → **13 passed**. Running `pytest` from `agents/` also collects `lab/recipes/distillation_files/tests/test_correctness.py`, which errors (it is a sandbox template needing a generated `configs/config.yaml`). Add `testpaths = tests`.
**Runtime:** not started (needs Redis + Postgres + Go API).

## Service & orchestration

| Component | Location | Actual behaviour | Status |
|---|---|---|---|
| FastAPI app | `app.py` | `/health` (P), `/memory/search`, `/intent`, `/runs/{id}/summary`, `/agents` (internal token); starts the worker in lifespan | IMPLEMENTED, UNVERIFIED |
| Job worker | `lab/worker.py` | `BRPOP lab:jobs`, `ThreadPoolExecutor(WORKER_CONCURRENCY)`, per-run lock; job types `start_run`, `resume`, `retry`, `whatif` | IMPLEMENTED, UNVERIFIED. At-most-once: a job popped then lost on crash is gone (REL-01). Unknown type only logged |
| Graph | `lab/graph.py` | LangGraph `StateGraph`: start → research → settings → ask_plan/wait_plan (`interrupt`) → code → budget (test drive) → [ask/wait long_run] → execute (repair loop) → [ask/wait help] → test → gap → finalize. `PostgresSaver` in schema `langgraph`, unpooled URL for Neon | IMPLEMENTED, UNVERIFIED. Real orchestration, no dependency on the removed Manager ✓ |
| Step wrapper | `lab/steps.py` | Checks pause/stop, emits `agent_started/finished/failed` with token + sandbox cost | IMPLEMENTED |
| Event bus | `lab/bus.py` | `LPUSH lab:events`; control key polling; `RunStopped` | IMPLEMENTED |
| Go client | `lab/api.py` | `/internal/sandbox/exec`, `/internal/proof/check` with `X-Internal-Token` | IMPLEMENTED |

## Agents

| Agent | Source | Inputs → outputs | Real vs demo | Invoked in workflow? | Output validation | Tests | Status |
|---|---|---|---|---|---|---|---|
| Paper Reader | `research.py` (`acquire_papers`, `extract`, `locate`) | arXiv LaTeX → PDF (PyMuPDF; Docling optional) → summary, claims with page/position, missing details, settings | **Demo paper: claims hard-coded in recipe**, then located in the PDF. Other papers: LLM (`_extract_llm`, Gemini long-context if key), else regex heuristic | Yes (`n_research`) | claims must be located in the source text (`in_source`) ✓ | none | PARTIALLY COMPLETE. No OCR, no Gemini vision for figures |
| Source Finder | `research.py:find_sources` | uploaded repo info, GitHub API, Semantic Scholar citations | Recipe adds MNIST loader; no Hugging Face / OpenAlex / Kaggle search | Yes | — | none | PARTIALLY COMPLETE |
| Code Writer | `coding.py:write_code` | brief → project files, `config.yaml` with labelled settings | **Demo: copies pre-written recipe files.** Other papers: LLM writes files (`_llm_write`) | Yes (`n_code`) | file ops applied with path checks (`project.write_files`) | none | IMPLEMENTED, UNVERIFIED (generic path never run) |
| Reviewer / Debugger | `coding.py:review`, repair loop ~L360–450 | log tail → memory lookup (`find_fix`) → heuristic fix → LLM fix; saves new fixes; pin relaxation | Real loop | Yes (`n_execute`) | ops validated | `test_logic` covers `heuristic_fix`/unpin | IMPLEMENTED, partly unit-tested |
| Compute Budget Planner | `coding.py:test_drive`, `graph.n_budget` | 40-step run, timing → estimate → long-run checkpoint | Real | Yes | — | none | IMPLEMENTED, UNVERIFIED. No Kaggle offload |
| Test Designer / Runner | `testing.py` | claim tests + correctness tests (template or LLM), pytest in sandbox, JUnit parse, `compute_scorecard` | Real | Yes (`n_test`) | statuses computed from DB metrics only ✓ | none | IMPLEMENTED, UNVERIFIED |
| Gap Detective | `gap.py` | ranked differences (recipe ablations or LLM), up to 2–3 one-change child runs, explanation passed through Go proof checker | Real mechanism; differences for the demo come from the recipe | Yes (`n_gap`, when a claim is "different") | `api.proof_check` ✓ | none | IMPLEMENTED, UNVERIFIED |
| What-If Planner | `whatif.py` | question → ≤4 branches (LLM or number parsing) → child runs → successive halving | Real | Via `whatif` job | — | `test_logic` covers `parse` | IMPLEMENTED, partly unit-tested. Branches are **not** pushed as git branches unless included in the bundle (bundle has `WhatIfs`) |
| Observer | `observer.py` | events → map nodes/edges in `research_maps` | Real, rule-based (not an LLM) | Hooked on emit | — | none | IMPLEMENTED, UNVERIFIED. Excalidraw rendering is a FE concern (FE uses SVG) |
| Lab Memory | `memory.py` | FastEmbed BGE (optional) else 384-d hashing embedding → pgvector cosine search; error-fix reuse with success counters | Real | Debugger + finalize | — | `test_logic` covers signatures | IMPLEMENTED, UNVERIFIED. `requirements-extra.txt` (fastembed, docling) not installed by default |
| LLM router | `llm.py` | role → Groq models → Gemini list → OpenRouter; multi-key rotation; Go rate limiter | Real | Everywhere | `parse_json` tolerant | `test_key_rotation` ✓ | VERIFIED (unit) |
| Intent | `intent.py` | typed/voice text → `{action, run_id, reply}` (LLM or rules) | Real | Go `/voice/*` | action whitelist | `test_logic` | IMPLEMENTED |
| Audio briefing (Kokoro TTS) | — | — | — | — | — | — | MISSING |
| Paper vs Paper | `workspaces.mode='compare'` column only | — | — | Not used in graph | — | — | MISSING |

## Key judgements
- **Demo-path honesty:** for arXiv 1503.02531 the claims, code, settings and gap ablations are **pre-written** (`lab/recipes/distillation*.py`). The *numbers* still come only from sandbox `metrics.json`, so Hero 2 holds. But "the agent reads the paper and writes the code" is not what happens for the demo paper. The event text says this openly ("starting from a tested recipe in Lab Memory"). The recipe is a code file, not a `memory_items` row, so that wording overstates it slightly.
- **No Manager dependency:** the graph has no manager node; migration 004 drops the manager tables. Leftovers are text only: `intent.py:1`, `llm.py:50`, `recipes/distillation.py:104` (DOC-02).
- **Invalid AI output:** JSON parsing is tolerant with fallbacks; the proof checker guards gap explanations. Other AI text (brief summary, review notes) is **not** proof-checked (P2, HERO2-01).
