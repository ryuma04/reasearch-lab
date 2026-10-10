# Database & Data-Integrity Audit

Engine: PostgreSQL 16 + pgvector (compose image `pgvector/pgvector:pg16`). `.env` now points to **Neon** (pooled endpoint); LangGraph uses the unpooled URL (`graph._unpooled`). Migrations run on API start. **Not applied or inspected live in this audit.**

## Schema vs spec §22

| Spec table | Present | Notes |
|---|---|---|
| users, github_connections, workspaces, workspace_members, uploads, papers, claims, settings, runs, run_events, metrics, scorecard_entries, whatif_branches, memory_items, notes, comments, pushes, share_links | ✓ all | extra useful columns (claims.metric_name/tolerance/quote, metrics.exec_id/log_line_text, runs.kind/stage) |
| — | + `sandbox_execs`, `gap_analyses`, `checkpoints`, `research_maps`, `schema_migrations` | provenance and checkpoint support |
| agents, agent_versions, agent_tasks, team_decisions, telegram_* | dropped (003/004) | consistent with the removed scope ✓ |

## Integrity review

| Check | Finding | Severity |
|---|---|---|
| Foreign keys | All child tables reference parents with sensible `ON DELETE` ✓ | — |
| Enums | CHECK constraints on status/kind/source ✓ | — |
| Uniqueness | `settings(run_id,name)`, `scorecard_entries(run_id,claim_id)`, one pending checkpoint per (run,name) ✓ | — |
| Indexes | runs(workspace), runs(parent), run_events(run_id,id), metrics(run_id,name), notes(workspace), memory(kind). **Missing:** `workspace_members(user_id)` (every access check), `uploads(workspace_id)`, `claims(paper_id)`, `papers(workspace_id)`, `pushes(run_id)`, `whatif_branches(run_id)`, **vector index on `memory_items.embedding`** | P3 (small data) |
| Migration concurrency | no `pg_advisory_lock`; parallel API starts can double-apply | P3 (DB-03) |
| Transactions | workspace + owner membership in one tx ✓; checkpoint resolve + job enqueue not atomic | P2 (REL-03) |
| Data isolation | every read goes through `workspace_members` ✓; share tokens scope to one workspace ✓ | — |
| Collaboration | roles exist but no API adds members | MISSING (P2) |
| Provenance (Hero 2) | metric → exec_id → log_path/log_hash → code_version (git sha) → log_line ✓ | strong design, UNVERIFIED |
| Persistence across restarts | Postgres + LangGraph checkpointer + DATA_DIR files ✓; Redis jobs/events in flight are lost | P1 (REL-01) |
| Duplicates | `POST /runs` not idempotent; event ingest inserts every popped message (no dedupe key) | P3 |
| Retention | `run_events` grows unbounded; no cleanup of DATA_DIR run folders | P3 |
| Backups | none (Neon has PITR on its side) | P3 |
| Dimension | `vector(384)` matches BGE-small and the hashing fallback ✓ | — |

## Completion
Schema 0.5 (exists, unapplied) · migrations 0.5 · pgvector 0.5 · indexes 0.5 · isolation 0.5 · members API 0 · migration lock 0 · retention 0 → **35.7 %** weighted (see scorecard). Verification 0 %.
