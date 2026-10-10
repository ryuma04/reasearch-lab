# Test & Build Audit

Environment: Windows 11, Git Bash, Go 1.27.1, Python 3.13.1 (system) + project `.venv`, Node (frontend `node_modules` present). Date 2026-10-10.

## Executed

| # | Command (cwd) | Exit | Result |
|---|---|---|---|
| 1 | `gofmt -l .` (backend) | 0 | lists every file. Cause: CRLF checkout (`core.autocrlf=true`), not formatting. Not a defect; add `.gitattributes` |
| 2 | `go vet ./...` (backend) | 0 | no findings |
| 3 | `go build ./...` (backend) | 0 | ✓ |
| 4 | `go test ./...` (backend) | 0 | ✓ `auth` (crypto round-trip), ✓ `proof`, ✓ `workspace`; 12 packages have **no tests** |
| 5 | `python -m compileall -q .` (agents) | 0 | ✓ |
| 6 | `python -m pytest -q` (agents, **system** Python) | 2 collection errors | `ModuleNotFoundError: psycopg` (wrong interpreter); recipe template test needs generated `configs/config.yaml` |
| 7 | `../.venv/Scripts/python -m pytest -q tests` (agents) | 0 | **13 passed** in 1.18 s |
| 8 | `npx tsc --noEmit` (frontend) | 0 | ✓ |
| 9 | `npm run lint` (frontend) | 0 | ✓ no problems |
| 10 | `npx vitest run` (frontend) | 0 | **14 passed** (2 files) |
| 11 | `npm run build` (frontend) | 0 | ✓ 18 routes generated |
| 12 | `docker version` | error | daemon not running (`dockerDesktopLinuxEngine` pipe missing) |
| 13 | `redis-cli ping` / `gitleaks version` | not found | not installed |

## Not executed

| Check | Reason |
|---|---|
| Go API startup / `/healthz` | **BLOCKED**: Redis unavailable (`bus.New` waits 60 s, then fails) |
| Migrations against Neon | BLOCKED by the above (API never started); not run separately to avoid touching the shared DB without approval |
| Agent service startup | BLOCKED: needs Redis + Postgres |
| Sandbox images build / sandbox exec | BLOCKED: Docker daemon not running |
| GitHub OAuth / push | BLOCKED: no `GITHUB_CLIENT_ID/SECRET` |
| n8n workflow | BLOCKED: n8n not running |
| Frontend in a browser against the backend | BLOCKED (no backend) |
| Dependency vulnerability scans (`govulncheck`, `npm audit`, `pip-audit`) | not installed / not run (time-boxed); recommended |

## Tests that do not exist
- Go: handlers (`runs`, `workspace` handlers, `auth` OAuth flow, `githubpush`, `sandbox`, `bus`, `ratelimit`, `voice`, `store`).
- API contract tests (FE types ↔ BE responses).
- Integration tests with Postgres + Redis (e.g. testcontainers).
- End-to-end (Playwright) for upload → run → approve → scorecard.
- CI pipeline (no `.github/workflows`).

**Nothing was changed to make tests pass. No unexecuted test is reported as passing.**
