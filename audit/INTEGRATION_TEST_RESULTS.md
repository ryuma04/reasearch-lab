# Integration Test Results

**Test suites and live journeys were NOT run.** The user instructed repeatedly not to run tests ("dont do testing i will do that", "stop"), so only compile, type and lint checks were run on the merged tree.

| Check | Result |
|---|---|
| `go build ./...` (backend) | pass |
| `go vet ./...` | pass |
| Python `compileall` + import of `lab.worker, healer, report, explorer.run, llm, coding, graph, app` | pass |
| `npm install` (adds `@monaco-editor/react`) | ok (7 packages) |
| `tsc --noEmit` (frontend) | pass. Before installing the new dependency there were 4 errors, all from the missing module |
| `eslint src --max-warnings=0` | pass |
| Duplicate route / definition scan | none found |

## Not run (needs the user)
- `go test ./...`, `pytest agents/tests` (including `test_healer.py`, `test_sandbox_agents.py`), frontend `vitest`.
- Docker sandbox integration tests, migrations 006-008 against a real database, plan approval to coding to heal in the browser.
- A live Arina call (no `ARINA_API_KEY`).

A passing build does not prove the merged behaviour. Treat the integration as compiled, not tested.
