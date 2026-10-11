# Using the Research Lab from the Gemini CLI (MCP)

The Go API serves an MCP server at `http://localhost:8080/mcp` (Streamable HTTP) with 42 tools. A token from the
**Profile** page makes the Gemini CLI act as **you**: it sees only your workspaces, and everything it starts appears
live in the web app.

## One-time setup

1. Start the lab: Postgres/Redis (`docker compose up -d postgres redis`), the API, the agent worker and the web app
   (see README; `run-demo.bat` starts API and web).
2. Sign in to the web app → **Profile** → **Connect Gemini CLI** → **Create a CLI token**.
3. Copy the command shown there and run it in a terminal. It looks like:

   ```bash
   gemini mcp add --scope user --transport http --timeout 600000 research-lab http://localhost:8080/mcp -H "Authorization: Bearer <your token>"
   ```

   `--scope user` matters: Gemini CLI ignores project-level MCP servers in folders you have not trusted.
4. Check: `gemini mcp list` must show `research-lab … Connected`.
5. Sign the Gemini CLI in with your Google account (run `gemini`, choose "Login with Google"). That free quota is
   much larger than an API key's free tier (about 20 requests a day per model) and does not use the agents' keys.

## Demo flow

Run `gemini` and ask, for example:

> My research paper is at `C:\Users\me\Downloads\distillation.pdf`. Upload it to the Research Lab as a new workspace and start a run.

What happens (verified):

1. `paper_upload_or_link` copies the PDF into a **new workspace owned by you** (only `.pdf` files that start with
   `%PDF-`, at most 50 MB). An arXiv link works too.
2. `lab_start_run` starts the real agent team, exactly like the **Start run** button.
3. Open the link it prints (`http://localhost:3000/workspaces/{id}/run/{run}`): the Live board shows the Paper Reader,
   Source Finder, … and stops at **Checkpoint 1**. Approve the plan **in the web app**.

Then ask, for example:

* "List my workspaces and runs." (`lab_list_workspaces`)
* "What claims did the Paper Reader extract for run 51, with numbers and pages?" (`paper_get_claims`)
* "Show me page 2 of the paper." (`paper_get_pages`)
* "Compare the measured metrics with the paper's claims." (`experiment_compare_claims`)
* "Search Lab Memory for previous fixes about CUDA." (`memory_search`)

## Tools

`lab_list_workspaces`, `lab_start_run`, `paper_*` (upload, content, pages, claims, citations), `workspace_*` (list,
read, write, search, diff, static checks, structure), `sandbox_*` (execute in Docker, status, logs, artifacts, tests,
cancel), `debugger_*` (inspect error, propose/apply patch, bounded re-runs), `experiment_*` (config/history, launch,
metrics, compare runs and claims, evidence), `memory_*` (search, get, store), `publish_*` (validate, model card,
Hugging Face, GitHub; approval required), `task_*`.

## Security

* Every tool call is checked against your role in the workspace it touches (`backend/internal/mcp/authz.go`): viewer
  for reads, editor for writing files, running code, starting runs and publishing. Other users' runs and workspaces
  answer "not found".
* The token expires after 7 days; create a new one on the Profile page. Keep it private.
* Code only runs in the Docker sandbox. Publishing still requires approval.
* `DEV_LOGIN_ENABLED=true` lets unauthenticated local requests act as the development user; set it to `false` for a
  deployed demo.
