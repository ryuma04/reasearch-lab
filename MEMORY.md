# MEMORY.md — Project Context Ledger

## Stack
- **Frontend**: Next.js 15 + React 19 + TailwindCSS 4 + Radix UI + Framer Motion (at `frontend/`, port 3000)
- **Backend API**: Go 1.26 + Chi router + pgx + go-redis (at `backend/`, port 8080)
- **AI Agents**: Python 3.13 + FastAPI + LangGraph + LangChain Core (at `agents/`, port 8001)
- **Infra**: PostgreSQL 16 (pgvector) on port 5433, Redis 7 on port 6379, Docker for sandboxing
- **Automation**: n8n for GitHub push webhook (optional, `n8n/github-push.json`)
- **Sandbox images**: `infra/sandbox-images/` (Python, R)
- **Docs**: `docs/` (DESIGN.md, allaboutourproject.md, FRONTEND_INTEGRATION_NOTES.md, plan.html)

## Folder Structure
```
tapu-sena/
├── frontend/           # Next.js 15 web app (port 3000)
├── backend/            # Go API server (port 8080)
├── agents/             # Python FastAPI + LangGraph agents (port 8001)
├── n8n/                # n8n workflow JSON (GitHub push automation)
├── infra/
│   └── sandbox-images/ # Docker images for sandboxed code execution
├── audit/              # Complete system audit, test reports, and API contract matrix
├── docs/               # Architecture docs, project plan, design spec
├── .env.example        # Environment variable template
├── docker-compose.yml  # Postgres, Redis, n8n, api, agents
├── README.md
└── MEMORY.md
```

## Architecture
```
Browser → Next.js (:3000) → Go API (:8080) → FastAPI Agents (:8001)
                                            → PostgreSQL + pgvector
                                            → Redis (jobs/events bus)
                                            → Docker sandbox containers
                                            → n8n → GitHub
```

## Communication Patterns
| From → To | Method |
|---|---|
| Go → Python (long) | Redis list `lab:jobs` |
| Python → Go (events) | Redis list `lab:events` → SSE |
| Go → Python (quick) | HTTP `/health`, `/memory/search`, `/intent` |
| Python → Go | HTTP `/internal/sandbox/exec`, `/internal/proof/check` |
| Run control | Redis keys `lab:run:{id}:control`, `lab:run:{id}:instructions` |

## Local Dev Setup
```bash
cp .env.example .env  
docker compose up -d postgres redis
# Go API:    cd backend && go run ./cmd/server
# Agents:    cd agents && ../.venv/Scripts/python -m uvicorn app:app --port 8001
# Frontend:  cd frontend && npm run dev
```

## Lessons
- Docker Desktop on Windows can be slow to start; the named pipe `dockerDesktopLinuxEngine` may not be ready for 60+ seconds after launch.
