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

### System Component Breakdown

| Tier | Technology | Ports | Core Responsibilities |
|---|---|---|---|
| **Presentation** | Next.js 15, React 19, Tailwind CSS 4, Radix UI, Monaco Editor | `3000` | Research Map, live SSE execution board, Monaco code sandbox, claim scorecard, checkpoint modals, Hugging Face publishing |
| **API Gateway** | Go 1.26, Chi Router, pgx connection pool, go-redis | `8080` | Session auth, CSRF validation, workspace lifecycle, Docker sandbox process orchestration, cryptographic proof verification |
| **Event / Job Bus** | Redis 7 | `6379` | At-least-once queue (`lab:jobs`), live event stream (`lab:events`), pause/resume/kill signals (`lab:run:{id}:control`) |
| **Agent Intelligence** | Python 3.13, FastAPI, LangGraph, LangChain Core | `8001` | Multi-agent state machine, PDF/LaTeX analysis, code synthesis, self-healing debugger, gap hypotheses, what-if pruning |
| **Sandbox Execution** | Docker Engine, Hardened Python/PyTorch Image | — | Isolated experiment execution with strict cgroups: memory cap (6GB), CPU quota (4 cores), PID limit (256), `--network none` |
| **Persistence** | PostgreSQL 16 + `pgvector` | `5433` | Relational runs, workspaces, claim extraction schema (migrations 001–008), semantic experiment memory vector storage |

---

## 🔄 End-to-End Data Flow

### 1. Research & Reproduction Lifecycle Flow

```mermaid
sequenceDiagram
    autonumber
    actor Researcher as Researcher (UI)
    participant NextJS as Frontend (Next.js)
    participant GoAPI as Backend (Go API)
    participant Redis as Redis Bus
    participant Agents as LangGraph Agents
    participant Docker as Docker Sandbox
    participant HF as Hugging Face Hub

    Researcher->>NextJS: Paste arXiv link / upload PDF
    NextJS->>GoAPI: POST /workspaces/{id}/runs
    GoAPI->>Redis: Enqueue job to lab:jobs
    Redis->>Agents: Consume run_job
    
    rect rgb(240, 248, 255)
        Note over Agents: Stage 1: Research & Discovery
        Agents->>Agents: Extract claims & page numbers (Research Agent)
        Agents->>Agents: Audit & discover repos on GitHub / HF (Source Finder)
        Agents->>Agents: Generate reproduction plan & budget (Planner Agent)
        Agents->>Redis: Emit checkpoint:plan_ready
        Redis->>GoAPI: Event saved to DB & published via SSE
        GoAPI-->>NextJS: SSE: Checkpoint 1 Triggered
    end

    NextJS-->>Researcher: Display Plan Checkpoint Modal
    Researcher->>NextJS: Edit settings & click "Approve Plan"
    NextJS->>GoAPI: POST /runs/{id}/checkpoints/plan {action: approve}
    GoAPI->>Redis: Publish resume instruction to lab:run:{id}:control
    Redis->>Agents: Resume LangGraph execution

    rect rgb(255, 250, 240)
        Note over Agents,Docker: Stage 2: Sandboxed Execution & Self-Healing
        Agents->>Agents: Synthesize training & eval scripts (Code Writer)
        Agents->>GoAPI: POST /internal/sandbox/exec (scripts, limits)
        GoAPI->>Docker: docker run --network none -m 6g --cpus 4
        alt Runtime Error / Exception Occurs
            Docker-->>GoAPI: Exit code != 0 with traceback
            GoAPI-->>Agents: Execution failed
            Agents->>Agents: Diagnose & apply AST patch (Self-Healing Debugger)
            Agents->>GoAPI: POST /internal/sandbox/exec (re-run healed code)
            GoAPI->>Docker: docker run (re-execution)
        end
        Docker-->>GoAPI: Exit code 0, outputs & metrics.json
        GoAPI-->>Agents: Return execution log & metrics
    end

    rect rgb(240, 255, 240)
        Note over Agents,GoAPI: Stage 3: Verification & Cryptographic Proof
        Agents->>Agents: Compute metric scorecard (Claim Scorecard Agent)
        Agents->>GoAPI: POST /internal/proof/register (commit, log_hash, metrics)
        GoAPI->>GoAPI: Sign & persist proof records
    end

    opt Claims Discrepancy (Status = "different")
        Note over Agents: Stage 4: Autonomous Gap Detective
        Agents->>Agents: Formulate hypotheses (hyperparams, epochs, dataset)
        Agents->>Docker: Run ablation experiments
        Agents->>Agents: What-If exploration with successive halving
    end

    Agents->>Redis: Emit run_completed
    Redis->>GoAPI: Finalize run status
    GoAPI-->>NextJS: SSE: Run Completed + Scorecard Ready
    NextJS-->>Researcher: Display Claim Scorecard & Gap Detective Report

    Researcher->>NextJS: Click "Publish to Hugging Face"
    NextJS->>GoAPI: POST /runs/{id}/hf/publish
    GoAPI->>GoAPI: Pre-flight secret scan (Gitleaks patterns)
    GoAPI->>HF: Push Model Card, Weights, Code & Proof Report
    HF-->>NextJS: Repository URL (huggingface.co/username/repro-model)
```

---

## ⚡ Internal Communication & Event Flow

```mermaid
graph TD
    subgraph Frontend["Frontend (Next.js 15)"]
        UI["User Interface Components"]
        SSEHook["useRunStream() / EventSource"]
        QueryCache["TanStack Query Cache"]
    end

    subgraph Backend["Go 1.26 API Server"]
        Router["Chi Router (:8080)"]
        EventHub["SSE Event Broadcaster"]
        ProofChecker["Proof Checker"]
        DockerEngine["Docker SDK Manager"]
    end

    subgraph MessageBus["Redis 7"]
        JobQueue[("List: lab:jobs<br/>At-least-once queue")]
        EventStream[("List: lab:events<br/>Telemetry stream")]
        ControlKeys[("Keys: lab:run:{id}:control<br/>pause / resume / stop")]
    end

    subgraph AgentWorker["Python FastAPI + LangGraph (:8001)"]
        Worker["Worker Loop (BLPOP lab:jobs)"]
        GraphState["LangGraph State Machine"]
        FastAPIEnd["FastAPI Quick Endpoints<br/>(/health, /memory, /intent)"]
    end

    subgraph Sandbox["Isolated Docker Runtime"]
        Container["Container: tapu-sena/sandbox-python<br/>Zero Network · CPU & Memory Quotas"]
    end

    subgraph Database["PostgreSQL 16 + pgvector"]
        Tables[("Relational Tables: runs, workspaces, metrics, proofs")]
        VectorStore[("pgvector: lab_memory embeddings")]
    end

    UI -->|REST Mutation| Router
    Router -->|Push Job| JobQueue
    JobQueue -->|BLPOP| Worker
    Worker --> GraphState
    GraphState -->|Emit Event| EventStream
    EventStream -->|Read Events| EventHub
    EventHub -->|SSE Stream /runs/{id}/stream| SSEHook
    SSEHook --> QueryCache
    QueryCache --> UI

    GraphState -->|Execute Code| DockerEngine
    DockerEngine -->|docker run| Container
    Container -->|metrics.json + logs| DockerEngine
    DockerEngine -->|Results| GraphState

    Router -->|CRUD| Tables
    GraphState -->|Semantic Search| VectorStore
    UI -->|Control Signal| Router
    Router -->|SET command| ControlKeys
    ControlKeys -->|Check signal| GraphState
```

---

## 🤖 Autonomous Multi-Agent Directory

The platform uses a coordinated multi-agent collective implemented using **LangGraph** where agents maintain shared, versioned state and communicate through typed message contracts:

| # | Agent Name | Implementation | Primary Role & Responsibilities | Inputs / Outputs |
|---|---|---|---|---|
| **1** | **Research Agent** | [`agents/lab/research.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/research.py) | Parses paper PDFs and LaTeX source; extracts quantitative targets, baseline figures, evaluation metrics, and exact page/table citations. | **In:** arXiv ID / PDF binary<br/>**Out:** Claims catalog with quotes & page numbers |
| **2** | **Source Finder** | [`agents/lab/sources.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/sources.py) | Audits author-provided code and discovers alternatives on GitHub and Hugging Face Hub. Scores candidates 0–100 across 5 objective criteria. | **In:** Paper metadata, user repo URL<br/>**Out:** Ranked candidates & rubric comparison |
| **3** | **Planner Agent** | [`agents/lab/plan.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/plan.py) | Synthesizes an executable reproduction plan, identifies dependencies, determines hardware allocations, and estimates compute runtime. | **In:** Extracted claims, discovered repo<br/>**Out:** Plan draft for Checkpoint 1 approval |
| **4** | **Code Writer** | [`agents/lab/coding.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/coding.py) | Generates reproducible training, evaluation, and data preparation Python/PyTorch scripts tailored for the isolated container. | **In:** Approved plan, recipe templates<br/>**Out:** `train.py`, `eval.py`, `requirements.txt` |
| **5** | **Code Reviewer** | [`agents/lab/coding.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/coding.py) | Performs static analysis on generated scripts to prevent illegal network calls, file path escapes, or missing dependency pins. | **In:** Generated code scripts<br/>**Out:** Approval or requested modifications |
| **6** | **Sandbox Controller** | [`backend/internal/sandbox/`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/backend/internal/sandbox/) | Spawns ephemeral Docker containers with strict security cgroups (6GB RAM, 4 CPUs, 256 PIDs, locked network) and streams stdout/stderr. | **In:** Code payload, resource limits<br/>**Out:** Exit code, stdout/stderr, `metrics.json` |
| **7** | **Self-Healing Debugger** | [`agents/lab/healer.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/healer.py) | Autonomous exception diagnosis engine. Analyzes stack traces, retrieves prior fixes from Lab Memory, generates surgical AST patches, and re-executes. | **In:** Traceback, source code, past logs<br/>**Out:** Surgical diff & verified green re-run |
| **8** | **Testing Agent** | [`agents/lab/testing.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/testing.py) | Executes verification suites, parses output logs, extracts empirical measurements, and verifies deterministic numerical properties. | **In:** Checkpoint weights, test dataset<br/>**Out:** Extracted measurements & test results |
| **9** | **Proof Engine** | [`backend/internal/proof/`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/backend/internal/proof/) | Enforces **"No Number Without Proof"** by cryptographically tying each measurement to a git commit SHA, container UUID, timestamp, and SHA256 log hash. | **In:** Metric value, run log, container metadata<br/>**Out:** Verifiable proof record with hash |
| **10** | **Claim Scorecard Agent** | [`agents/lab/scorecard.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/scorecard.py) | Compares reproduced metrics against extracted published claims. Labels status honestly: `match` (±5%), `close` (±15%), or `different` (>15%). | **In:** Extracted claims, verified proofs<br/>**Out:** Structured scorecard with status badges |
| **11** | **Gap Detective** | [`agents/lab/gap.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/gap.py) | Activated when claims show discrepancy. Formulates scientific hypotheses (e.g. learning rate, batch size, epochs) and runs automated ablation studies. | **In:** Discrepancy delta, training logs<br/>**Out:** Root-cause explanation & ablation results |
| **12** | **What-If Explorer** | [`agents/lab/whatif.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/whatif.py) | Explores counterfactual questions ("What if we alter distillation temperature?") using successive halving to prune unpromising branches early. | **In:** User prompt, parameter search space<br/>**Out:** Ranked counterfactual outcomes |
| **13** | **Lab Memory Agent** | [`agents/lab/memory.py`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/agents/lab/memory.py) | Embeds and queries past reproduction experiences, library quirks, and bug fixes using `pgvector` to ensure mistakes are never repeated. | **In:** Error signature / query string<br/>**Out:** Relevant past solutions and configurations |
| **14** | **HF Publisher Agent** | [`backend/internal/hfpublish/`](file:///c:/Users/yendh/OneDrive/Desktop/tapu-sena/backend/internal/hfpublish/) | Runs pre-flight secret scans with Gitleaks patterns, formats standard model cards with scorecard badges, and uploads code and weights to Hugging Face Hub. | **In:** Run ID, HF token, repo namespace<br/>**Out:** Published Hub URL & commit SHA |

---

## 🎯 Verification Criteria (Source Finder Rubric)

When evaluating candidate code repositories against the published paper, the **Source Finder Agent** evaluates candidates using an evidence-based rubric where vanity metrics carry zero weight:

```
Total Score: 100 Points
├── 📄 Relevance to Paper (30 pts)
│   ├── Cites arXiv ID directly: 30 pts
│   ├── Matches exact paper title: 20 pts
│   └── No paper reference: 0 pts
├── 📚 Documentation Quality (15 pts)
│   ├── Comprehensive README (>1500 chars): 8 pts
│   ├── Clear installation / quickstart instructions: 4 pts
│   └── Result tables / benchmark citations: 3 pts
├── 🧩 Completeness & Executability (25 pts)
│   ├── Declares dependencies (requirements.txt / pyproject.toml): 6 pts
│   ├── Complete training & execution scripts (train.py / main.py): 8 pts
│   ├── Unit / integration test suite included: 4 pts
│   ├── Valid OSI open-source license: 3 pts
│   └── Notebooks / demo examples provided: 4 pts
├── 🔧 Maintenance & Freshness (15 pts)
│   ├── Updated within last 12 months: 15 pts
│   ├── Updated within 1–2 years: 8 pts
│   ├── Updated within 2–3 years: 4 pts
│   └── Archived repository: 0 pts
└── ⚡ Sandbox Compatibility (15 pts)
    ├── Standard Python / PyTorch ecosystem: 15 pts
    ├── Other compiled language: 5 pts
    └── Unknown runtime: 0 pts
```

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

Copy the environment template:
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
