# Feature Traceability (spec → code → status)

| Spec item | Backend | Agents | Frontend | Status |
|---|---|---|---|---|
| M1 GitHub login, profile, connect/disconnect | `auth/*`, `ghapi` | — | `/login`, `/profile` | BLOCKED (no OAuth app); FE partial |
| M2 Workspace with uploads + budget | `workspace/*` | — | `/workspaces/new` | BE IU; FE BROKEN (INT-02/03) |
| M3 Research/Coding/Testing agents with sub-agents | — | `research.py`, `coding.py`, `testing.py` | board cards | IU (demo path uses recipe) |
| M4 Safe sandbox | `sandbox/*`, images | `api.py` | — | PARTIAL (SEC-01, Docker not running) |
| M5 Automatic error repair | — | `coding.py` repair loop + memory | events | IU |
| M6 Claim Scorecard | `/scorecard` | `testing.compute_scorecard` | scorecard tab | BE/agents IU; FE BROKEN (INT-11) |
| M7 Gap Detective | `/gap`, proof check | `gap.py` | gap section (`/gaps` path) | IU / FE path mismatch |
| M8 What-if extension | `/whatif` | `whatif.py` (successive halving) | what-ifs tab | IU / FE partial |
| M9 Lab Memory | `/memory/search` | `memory.py` | `/memory`, memory tab | IU / FE partial |
| M10 Live Agent Board | SSE, events | `steps.py`, `bus.py` | `/live` | PARTIAL (INT-06/07) |
| M11 Approval checkpoints (plan, long run, push) | checkpoints, push | `graph.py` interrupts | map panel, publish | BE/agents IU; FE BROKEN (INT-05/12) |
| M12 Mobile control with voice + typed commands | `/voice/*` | `intent.py` | **none** | PARTIAL (no UI) |
| M13 Push to GitHub via n8n + secret scan | `githubpush`, `n8n/github-push.json` | — | `/publish` | BLOCKED / FE BROKEN |
| M14 Markdown notes (researcher + agents) | `/notes` | agents insert notes | notes tab | IU |
| H1 Scorecard with PDF highlight | `position_on_page`, `/papers/{id}/pdf` | `research.locate` | page jump only | PARTIAL |
| H2 No number without proof | `sandbox.ingestMetrics`, `proof`, `/metrics/{id}/proof` | gap uses proof check | proof card not wired | BE strong, IU; FE PARTIAL |
| H3 Gap Detective experiments | child runs | `gap.investigate` | — | IU |
| H4 Missing Details Log | `/settings` (source labels) | `project.record_settings` | coding tab | IU |
| H5 What-If branches + early stopping | — | `whatif.py` | tree | IU |
| H6 Lab Memory proof of learning | — | `find_fix`/`mark_used` | memory tab (`/runs/{id}/memory` missing) | PARTIAL |
| H7 Live Research Map (Excalidraw) | `/map` | `observer.py` | SVG map | PARTIAL (not Excalidraw, no drawing) |
| H8 Compute Budget Planner | — | `test_drive`, `n_budget`, long-run checkpoint | — | IU (no Kaggle option) |
| H9 Voice + audio briefing (Kokoro) | Whisper ✓ | intent ✓; TTS none | none | PARTIAL / TTS MISSING |
| H10 Paper vs Paper | `workspaces.mode` column | not used | 2-paper upload limit only | MISSING |
| H11 Live share + QR, Run Replay | share routes, QR | — | `/share/[token]`, `/replay` | Replay IU; share FE BROKEN |
| Extras (Colab notebook, badge, cost meter, report export) | bundle adds `notebook.ipynb` + badge; cost in events | — | report button (no BE) | PARTIAL |
| Manager / reward loop / agent evolution | removed (migration 004) | removed | `/team` leftover | NOT APPLICABLE |
