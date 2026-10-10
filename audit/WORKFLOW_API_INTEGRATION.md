# Workflow and API Integration

## Plan approval to coding (no duplicate jobs)
1. `POST /runs/{id}/checkpoints/plan` with `approve|edit|reject` and optional `changes`.
2. `store.ResolveCheckpoint` moves `pending` to `approved/edited` atomically. A second call finds no pending checkpoint and returns **409**, so only one `resume` job is enqueued. If enqueueing fails the checkpoint is reopened.
3. Worker `resume` runs LangGraph `wait_plan` (applies `changes` via `apply_setting_changes`), then `code`, `budget`, `execute`, `test`, `gap`, `finalize`.
4. Coding emits `sandbox_started` / `sandbox_finished` events; the workflow UI (`lib/workflow/state.ts`, `activity.ts`) derives the Coding stage from them. No frontend-only state decides progress.

## Remote sandbox endpoints (via `sbx.Routes`)
`GET /sandbox/status`, `PUT /runs/{id}/file`, `GET /runs/{id}/artifact`, `POST|GET /runs/{id}/sandbox/executions`, `GET /sandbox/executions/{execId}[/logs]`, `POST /sandbox/executions/{execId}/cancel`, `POST|GET /runs/{id}/sandbox/heal`. No route collides with an existing one (checked).

## Two repair paths (distinct, not duplicated)
- Automatic: the `after_execute` to `ask_help`/`code` loop in `graph.py`, bounded by `max_repair_attempts` (3).
- Manual session: the user starts a heal on a failed execution, which queues a `heal` job and runs `healer.run_session` (memory, pattern, cache, Arina, fallback AI). It takes the same per-run lock as other jobs.

## Frontend
The remote Code sandbox page is its own tab (`/workspaces/[id]/sandbox`) next to Workflow. It was not folded into the two-stage Workflow shell. Sandbox types/adapters live in `lib/api/{types,adapters,services,endpoints}.ts` and `lib/hooks/queries.ts` with no duplicate definitions (`tsc` clean).
