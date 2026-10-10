# Git Integration Plan

## Branches
| Branch | Commit | Purpose |
|---|---|---|
| `main` | 4071903 | Untouched. |
| `checkpoint/research-workflow-and-explorer` | d200795 | Snapshot of all local work (86 files) taken before touching the remote. |
| `origin/main` | feca686 | Teammate work: sandbox engine, Self-Healing Debugger, Arina AI. |
| `integration/remote-sandbox-arina` | e7639ea | Merge of the two (`--no-ff`). Not yet merged into `main`. |

No blind pull, no force push, no history rewrite. Fast rollback: `git reset --hard d200795` on the integration branch, or delete it.

## Remote features imported
- Docker-only sandbox engine + API (`backend/internal/sandbox/{api,engine,heal,metrics,paths}.go`), executions table (migration 006).
- Self-Healing Debugger worker (`agents/lab/healer.py`), sessions table (migration 007).
- Arina AI client (`llm.arina`, `ARINA_*` settings).
- Code sandbox UI (`components/sandbox/*`, `/workspaces/[id]/sandbox`) and the new dependency `@monaco-editor/react`.
- Remote tests: `test_healer.py`, `test_sandbox_agents.py`, Go sandbox unit/integration tests.

## Local features preserved
Two-stage Research & Planning workflow, research graph with source links, report and exports, plan draft editing/approval (`changes`), Research Gap Explorer (migration 008), at-least-once job queue, sandbox git hardening (`GitDir`, `hooksPath`, `core.fsmonitor=false`).

## Conflicts (6) and resolution
| File | Resolution |
|---|---|
| `agents/lab/worker.py` | Both: `explorer` job + remote `heal` job + my BLMOVE/ack recovery. |
| `backend/cmd/server/main.go` | Both route sets (plan draft/report/explorer + `sbx.Routes`). |
| `frontend/src/components/run/workspace-header.tsx` | Both tab sets (Gap Explorer and Code sandbox). |
| `frontend/src/lib/api/adapters.ts`, `types.ts` | Local side (superset); the remote hunk only repeated `metric_name`. |
| `.claude/launch.json` | api 8080, agents 8001, web 3000, web-alt 3100. |

## Migrations
The remote took 006/007, so mine was renumbered to **008_gap_explorer.sql**. Order 001..008 is contiguous and nothing is destructive.

## Not done / left alone
Untracked `backend/err.log`, `out.log`, `out.txt` (stray logs, not committed). Branch not pushed.
