# Evolving AI Research Environment — backend

A fixed pipeline of AI agents (Research → Coding → Testing → Gap Detective, plus What-If) reproduces an ML paper's key result on a laptop, checks every claim
against the paper with proof, explains differences with experiments, runs what-if branches
and pushes everything to the researcher's GitHub. See `docs/allaboutourproject.md` for the full plan.

```
                 ┌──────────────── Go API (backend/, :8080) ──────────────────┐
 browser/phone ─▶│ auth · workspaces · uploads · runs · SSE · checkpoints ·      │──▶ GitHub (OAuth, push)
 phone (web) ───▶│ scorecard · sandbox · proof checker · rate limiter · push ·   │──▶ n8n webhook ─▶ GitHub
                 │ voice commands · share links                                  │
                 └──┬───────────────┬─────────────────────┬─────────────────▲────┘
       HTTP (sync)  │   Redis       │ lab:jobs ▼          │ docker run      │ /internal/* (sandbox,
  health, memory,   │   lab:events ▲│                     ▼                 │  proof, rate limit)
  intent, summary   ▼               │               sandbox container       │
                 ┌──────────── FastAPI agents (agents/, :8001) ───────────────┴───┐
                 │ worker (LangGraph): Research · Coding · Testing · Observer     │──▶ Groq / Gemini
                 │ Gap Detective · What-If · Lab Memory                           │──▶ arXiv, Semantic Scholar, GitHub
                 └──────────────────────────── PostgreSQL + pgvector ─────────────┘
```

| Connection | How |
|---|---|
| Go → Python (long work) | Redis list `lab:jobs`: `start_run`, `resume`, `retry`, `whatif` |
| Python → Go (live events) | Redis list `lab:events` → Go saves to `run_events` (Run Replay) and streams SSE |
| Go → Python (quick calls) | HTTP to FastAPI: `/health`, `/memory/search`, `/intent`, `/runs/{id}/summary` |
| Python → Go | HTTP `/internal/sandbox/exec`, `/internal/proof/check`, `/internal/ratelimit/acquire` |
| Run controls | Redis keys `lab:run:{id}:control` (pause/stop) and `lab:run:{id}:instructions` |
| Shared data | PostgreSQL (schema owned by Go migrations; LangGraph checkpoints in schema `langgraph`) and `DATA_DIR` |

## Run it locally

Prerequisites: Docker Desktop, Go 1.25+, Python 3.11+.

```bash
cp .env.example .env              # then set TOKEN_ENCRYPTION_KEY, SESSION_SECRET, INTERNAL_TOKEN
docker compose up -d postgres redis
docker build -t tapu-sena/sandbox-python:latest infra/sandbox-images/python   # once, ~3 GB (PyTorch CPU)

# Go API
cd backend && go run ./cmd/server

# Agent service (new terminal)
python -m venv .venv && .venv/Scripts/pip install -r agents/requirements.txt   # (bin/ on macOS/Linux)
cd agents && ../.venv/Scripts/python -m uvicorn app:app --port 8001

curl localhost:8080/healthz       # every connection: db, redis, agents, docker, sandbox image, n8n, credentials
```

Without any keys the system still runs end to end: dev login replaces GitHub login, the
built-in recipe replaces the AI Code Writer for the demo paper (arXiv 1503.02531), and rules
replace AI decisions. Add `GROQ_API_KEY` / `GEMINI_API_KEY` for any paper.

Full stack in Docker: `HOST_DATA_DIR=$PWD/data docker compose --profile full up -d --build`
(import `n8n/github-push.json` into n8n once and activate it).

## Credentials (placeholders in `.env`)

| Variable | Needed for |
|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub login + push. Callback: `{PUBLIC_API_URL}/auth/github/callback` |
| `GROQ_API_KEY`, `GEMINI_API_KEY` (optional `OPENROUTER_API_KEY`) | AI agents, Whisper voice commands |
| `N8N_WEBHOOK_URL` | Push through n8n (otherwise direct GitHub API push) |

## API

Auth: session cookie or `Authorization: Bearer <token>` (from `/auth/dev-login` in development).

| Method and path | What it does |
|---|---|
| `GET /auth/github/login` · `GET /auth/github/callback` · `POST /auth/dev-login` · `POST /auth/logout` | Login |
| `GET /me` | Profile, GitHub status, default repo, pushes |
| `GET/POST /github/repos` · `PUT /github/default-repo` · `DELETE /github/connection` | Repos, choose, disconnect + revoke |
| `POST /workspaces` (JSON or multipart: `papers`, `arxiv`, `dataset`, `dataset_url`, `repo_url`, `note`, `compute_budget`) · `GET /workspaces` · `GET/PATCH /workspaces/{id}` | Workspaces |
| `POST/GET /workspaces/{id}/uploads` · `GET /workspaces/{id}/uploads/{uploadId}/file` · `DELETE …` | Uploads |
| `GET/PUT /workspaces/{id}/notes` | Markdown notes (researcher + agents) |
| `POST /workspaces/{id}/runs` · `GET /workspaces/{id}/runs` · `GET /runs/{id}` | Runs |
| `GET /runs/{id}/stream` (SSE, `Last-Event-ID`) · `GET /runs/{id}/events?after=` | Live board / Run Replay |
| `GET /runs/{id}/checkpoints` · `POST /runs/{id}/checkpoints/{plan\|long_run\|help}` `{action: approve\|edit\|reject, instruction, option}` | Approvals |
| `POST /runs/{id}/agents/{agent\|run}/action` `{action: pause\|resume\|stop\|retry\|instruct, text}` | Agent controls |
| `GET /runs/{id}/scorecard` · `/settings` · `/metrics` · `/research` · `/map` · `/gap` · `/files` · `/file?path=` | Results tabs |
| `GET /metrics/{id}/proof` · `GET /papers/{id}/pdf` | Proof card, PDF for highlights |
| `POST/GET /runs/{id}/whatif` | What-if branches (successive halving) |
| `POST /runs/{id}/push` · `GET /runs/{id}/pushes` · `GET /runs/{id}/push/preview` | GitHub push (secret scan, n8n / direct) |
| `GET /agents` · `GET /memory/search?q=` | The fixed agents of the pipeline, Lab Memory search |
| `POST /workspaces/{id}/share` → `GET /share/{token}` · `/share/{token}/runs/{runId}[/stream\|/events\|/scorecard\|/map\|/whatif\|/settings]` | Read-only live link + QR |
| `POST /voice/command` (multipart `audio`) · `POST /voice/text` `{text}` | Mobile control: understand a spoken/typed command, returns `{text, intent}` |
| `POST /internal/sandbox/exec` · `/internal/proof/check` · `/internal/ratelimit/acquire` · `GET /internal/ratelimit/usage` · `POST /internal/push/callback` | Internal (`X-Internal-Token`) |
| `GET /healthz` · `GET /livez` | Health |

SSE event (also the Run Replay format):

```json
{"id": 42, "run_id": 7, "time": "…", "agent": "coding.reviewer", "type": "fix_applied",
 "message": "Fixed from memory: pin numpy<2", "why": "Same error seen in run #3; that fix worked",
 "links": {"memory_item": 17, "map_nodes": [], "map_edges": []}, "cost": {"tokens": 812, "sandbox_seconds": 0}}
```

## Tests

```bash
cd backend && go test ./...
cd agents && ../.venv/Scripts/python -m pytest -q
```
