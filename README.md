# 🔬 Research Lab — Autonomous ML Reproduction & Verification Platform

[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2015%20%7C%20React%2019-black?logo=next.js)](frontend/)
[![Go](https://img.shields.io/badge/Backend-Go%201.26%20%7C%20Chi-00ADD8?logo=go)](backend/)
[![Python](https://img.shields.io/badge/Agents-Python%203.13%20%7C%20LangGraph-3776AB?logo=python)](agents/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016%20%2B%20pgvector-336791?logo=postgresql)](infra/)
[![Redis](https://img.shields.io/badge/Bus-Redis%207-DC382D?logo=redis)](infra/)
[![Docker](https://img.shields.io/badge/Sandbox-Docker%20Hardened-2496ED?logo=docker)](infra/sandbox-images/)
[![Hugging Face](https://img.shields.io/badge/Publish-Hugging%20Face%20Hub-FFD21E?logo=huggingface)](frontend/src/components/publish/)

> **Autonomous Multi-Agent Machine Learning Reproduction & Verification Engine.**  
> Takes an ML research paper, extracts empirical claims with page-level citations, plans and executes experiments in isolated Docker containers, checks findings against the paper with cryptographic proof, investigates discrepancies via autonomous Gap Detective experiments, and publishes verified artifacts to **Hugging Face Hub**.

---

## 🏛️ System Architecture

```
                  ┌──────────────────── Next.js 15 Frontend (:3000) ────────────────────┐
                  │  Research Map · Plan Checkpoint · Live SSE Board · Gap Explorer     │
                  │  Code Sandbox (Monaco) · Claim Scorecard · Hugging Face Publisher   │
                  └───────────────────────────────────┬─────────────────────────────────┘
                                                      │ REST / SSE
                                                      ▼
                  ┌────────────────────── Go 1.26 API Server (:8080) ───────────────────┐
                  │  Auth (Email/Session) · Workspaces · Uploads · Checkpoint Manager   │
                  │  Proof Verifier · Rate Limiter · Docker Sandbox Controller          │
                  └───────┬───────────────────────────┬─────────────────────────▲───────┘
          Redis (lab:jobs)│                           │ Redis (lab:events)      │ HTTP /internal/*
                          ▼                           │                         │ (sandbox, proof)
                  ┌───────────────────────────────────┴─────────────────────────┴───────┐
                  │               FastAPI + LangGraph Agent Worker (:8001)              │
                  │  Research Agent ──▶ Source Finder ──▶ Planner ──▶ Code Writer       │
                  │  Tester ──▶ Claim Scorecard ──▶ Gap Detective ──▶ What-If Explorer  │
                  │  Self-Healing Debugger (Monaco / Arina AI) · Lab Memory (pgvector)  │
                  └───────┬─────────────────────────────────────────────┬───────────────┘
                          │ docker run (locked network)                 │ Vector embeddings
                          ▼                                             ▼
        ┌──────────────────────────────────┐          ┌──────────────────────────────────┐
        │  Isolated Docker Sandbox Image   │          │      PostgreSQL 16 + pgvector    │
        │  (CPU/RAM limits, no host mount) │          │  (Workspaces, Runs, Checkpoints) │
        └──────────────────────────────────┘          └──────────────────────────────────┘
```

---

## ✨ Key Capabilities

### 1. Two-Stage Research & Planning
- **Automated Paper Intake**: Ingests arXiv papers (PDF parsing + LaTeX source extraction) or custom PDF uploads.
- **Claim Extraction**: Extracts quantitative claims, baseline figures, evaluation metrics, and citations linked to exact paper pages.
- **Source Finder**: Audits the author repository and discovers alternative implementations across GitHub and Hugging Face Hub using a 5-dimension rubric (relevance, documentation, completeness, maintenance, sandbox compatibility).
- **Researcher Checkpoints**: Checkpoint 1 lets researchers review, edit, and approve the generated experiment plan before compute is consumed.

### 2. Isolated Sandboxed Execution
- **Zero-Network Runtime**: Code executes inside hardened Docker containers (`tapu-sena/sandbox-python`) with CPU, memory, and PID limits enforced.
- **Self-Healing Debugger**: Interactive Monaco Code Editor with automated syntax/runtime error diagnosis and multi-turn healing (powered by Arina AI / Groq / Gemini).

### 3. Claim Verification & Proof Engine
- **No Number Without Proof**: Every reproduced metric is tied to a verifiable proof packet: git commit SHA, container execution ID, execution log file, timestamp, and SHA256 log hash.
- **Claim Scorecard**: Compares paper claims against measured outcomes with three transparent verdicts: `match`, `close`, or `different`.

### 4. Gap Detective & What-If Counterfactuals
- **Autonomous Follow-up Experiments**: When reproduced results diverge from published claims, the Gap Detective automatically designs targeted ablations (e.g., hyperparameter sweeps, architecture nuances).
- **What-If Exploration**: Test-drives hypotheses with successive halving pruning to maximize research insights on minimal compute budget.

### 5. Hugging Face Hub Publishing
- **Secret Scanning**: Runs pre-publish Gitleaks pattern audits before any artifact leaves the workstation.
- **One-Click Push**: Packages reproduced code, generated model cards, proof summaries, and evaluation reports directly to the researcher's Hugging Face account.

---

## 📂 Project Structure

```
tapu-sena/
├── frontend/               # Next.js 15 + React 19 + Tailwind CSS 4 Web App (port 3000)
│   ├── src/app/            # App router (workspaces, workflow, sandbox, explorer, publish)
│   ├── src/components/     # UI primitives, workflow stages, Monaco sandbox, HF publish
│   └── src/lib/            # API clients, TanStack Query hooks, graph adapters
├── backend/                # Go 1.26 API Server (port 8080)
│   ├── cmd/server/         # Server entrypoint and route declarations
│   ├── internal/auth/      # Password hashing (PBKDF2), session management
│   ├── internal/sandbox/   # Docker execution engine, resource isolation, metrics
│   ├── internal/proof/     # Cryptographic execution proof verification
│   ├── internal/store/     # PostgreSQL migrations (001–008) and queries
│   └── internal/hfpublish/ # Hugging Face Hub publishing integration
├── agents/                 # Python 3.13 FastAPI + LangGraph Service (port 8001)
│   ├── app.py              # FastAPI server entrypoint
│   ├── lab/                # Multi-agent graph (research, coding, testing, gap, whatif)
│   │   ├── sources.py      # Source Finder & repository auditor
│   │   ├── healer.py       # Self-healing code repair engine
│   │   └── memory.py       # pgvector semantic retrieval for past experiment fixes
│   └── tests/              # Pytest test suite (53 passing tests)
├── infra/                  # Infrastructure configurations & container definitions
│   └── sandbox-images/     # Hardened Python/PyTorch sandbox Dockerfiles
├── audit/                  # System audits, API contracts, verification reports
├── docs/                   # System design, workflow specifications, architecture docs
├── docker-compose.yml      # Local development dependencies (Postgres, Redis)
├── .env.example            # Environment variables configuration template
└── README.md               # Project documentation
```

---

## 🚀 Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- [Go 1.25+](https://go.dev/dl/)
- [Node.js 20+ & npm](https://nodejs.org/)
- [Python 3.11+](https://www.python.org/)

### 1. Environment Setup

Copy the environment template and generate security secrets:
```bash
cp .env.example .env
```

Key environment configurations in `.env`:
```env
APP_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/lab?sslmode=disable
REDIS_URL=redis://localhost:6379/0
TOKEN_ENCRYPTION_KEY=977d0e720a70f3f6c1476f0a0017b0b61f43dd3b21dbca64e51fb3499f68d4ca
SESSION_SECRET=a6b39ca8f84ef0bd76c29b4ad5beb045a984f4798fc255aa
INTERNAL_TOKEN=8608a4b93f275180da36b0bc35fbd9ce
```

*(Optional: Add `GROQ_API_KEYS` and `GEMINI_API_KEYS` for dynamic LLM paper extraction; built-in recipes run out of the box without keys).*

### 2. Start Core Infrastructure

Start PostgreSQL (with `pgvector`) and Redis:
```bash
docker compose up -d postgres redis
```

Build the hardened sandbox container:
```bash
docker build -t tapu-sena/sandbox-python:latest infra/sandbox-images/python
```

### 3. Launch Services

#### Terminal 1 — Go API Server (Port 8080)
```bash
cd backend
go run ./cmd/server
```

#### Terminal 2 — AI Agent Worker (Port 8001)
```bash
# Setup Python virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r agents/requirements.txt
cd agents && ..\.venv\Scripts\python -m uvicorn app:app --port 8001
# macOS/Linux:
# source .venv/bin/activate && pip install -r agents/requirements.txt
# cd agents && uvicorn app:app --port 8001
```

#### Terminal 3 — Next.js Frontend (Port 3000)
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Verification & Test Suite

The platform includes comprehensive automated tests across all three tiers:

```bash
# 1. Backend Go unit & integration tests
cd backend && go test -count=1 ./...
# Result: PASS (internal/auth, internal/hfpublish, internal/proof, internal/runs, internal/sandbox, internal/workspace)

# 2. Agent Worker Python tests
cd agents && ..\.venv\Scripts\python -m pytest -q
# Result: 53 passed

# 3. Frontend React/Next.js tests
cd frontend && npx vitest run
# Result: 76 passed (10 test files)
```

---

## 📡 API Endpoints Overview

| Method & Route | Description |
|---|---|
| `POST /auth/dev-login` · `POST /auth/login` | Session authentication & JWT issuance |
| `GET /me` | Researcher profile & active workspace state |
| `POST /workspaces` · `GET /workspaces` | Workspace creation & listing |
| `DELETE /workspaces/{id}` | Permanently delete workspace and associated runs |
| `POST /workspaces/{id}/runs` | Dispatch autonomous reproduction run |
| `GET /runs/{id}/stream` (SSE) | Live event streaming & activity log replay |
| `POST /runs/{id}/checkpoints/{type}` | Approve/edit research plan (`plan`, `long_run`) |
| `GET /runs/{id}/scorecard` | Verified claim scorecard with target vs measured results |
| `GET /metrics/{id}/proof` | Cryptographic execution proof for a measured number |
| `POST /runs/{id}/sandbox/executions` | Execute user code in isolated Docker sandbox |
| `POST /runs/{id}/sandbox/heal` | Self-healing code repair via AI |
| `POST /runs/{id}/hf/publish` | Publish verified code and model card to Hugging Face Hub |
| `GET /healthz` | Health check for DB, Redis, Agents, Docker, and Sandbox image |

---

## 🛡️ Security & Sandboxing Principles

1. **Host Isolation**: Experiment code NEVER executes on the host OS. All runs execute inside ephemeral containers without access to the host filesystem.
2. **Network Quarantine**: Sandboxes operate with `--network none` during model training to guarantee deterministic reproduction and prevent data exfiltration.
3. **Secret Protection**: All outgoing publications to Hugging Face Hub pass through an automated Gitleaks scan filter to prevent accidental leakage of API keys or credentials.
4. **CSRF & Rate Limiting**: All state-modifying requests require valid CSRF headers (`X-Requested-With`) and are bound by configurable token bucket rate limiters.

---

## 📄 License

Distributed under the Apache 2.0 License. See `LICENSE` for more information.
