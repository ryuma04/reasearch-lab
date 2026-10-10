# Local Runbook

Windows 11 commands (Git Bash). Ports: frontend 3000, Go API 8080, agents 8001, Postgres 5433 (compose) or Neon, Redis 6379.

## 1. One-time setup
```bash
cp .env.example .env            # fill TOKEN_ENCRYPTION_KEY, SESSION_SECRET, INTERNAL_TOKEN, AI keys
cp frontend/.env.example frontend/.env.local
python -m venv .venv && .venv/Scripts/pip install -r agents/requirements.txt
(cd frontend && npm ci)
docker build -t tapu-sena/sandbox-python:latest infra/sandbox-images/python   # ~3 GB, once
```
Sign-in options (both on by default):
- **Email + password**: `EMAIL_LOGIN_ENABLED=true` (backend), shown on `/login` unless `NEXT_PUBLIC_EMAIL_LOGIN=false`. Passwords are stored as salted PBKDF2-SHA256 hashes.
- **GitHub**: needs `GITHUB_CLIENT_ID/SECRET` (callback `http://localhost:8080/auth/github/callback`). Required only for pushing to GitHub.
- `DEV_LOGIN_ENABLED=true` additionally allows `POST /auth/dev-login {"name":"alice"}` for curl tests. Turn it off for any public demo.

## 2. Start infrastructure
Docker Desktop must be running (`docker info` works).
```bash
docker compose up -d redis              # always
docker compose up -d postgres           # only if you use the local DB instead of Neon
```
To keep test data off Neon, override the DB for one session: `export DATABASE_URL=postgres://lab:lab@localhost:5433/lab?sslmode=disable`.

## 3. Start services (three terminals)
```bash
cd backend && go run ./cmd/server                                   # applies migrations 001–005 on start
cd agents && ../.venv/Scripts/python -m uvicorn app:app --port 8001 # starts the job worker too
cd frontend && npm run dev                                          # http://localhost:3000
```
Without Docker for the sandbox (development only, no isolation): `SANDBOX_MODE=local` (refused unless `APP_ENV=development`).

## 4. Health
```bash
curl -s localhost:8080/healthz | python -m json.tool   # database, redis, agents_service, sandbox.image_present must be ok
```

## 5. End-to-end demo (API level)
```bash
B=http://localhost:8080; J='-H Content-Type:application/json'
TOKEN=$(curl -s $J -d '{"name":"demo"}' $B/auth/dev-login | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
A="-H Authorization:Bearer\ $TOKEN"
WS=$(curl -s $J -H "Authorization: Bearer $TOKEN" -d '{"title":"Distillation","compute_budget":"quick"}' $B/workspaces | python -c "import sys,json;print(json.load(sys.stdin)['workspace']['id'])")
curl -s $J -H "Authorization: Bearer $TOKEN" -d '{"kind":"paper","url":"arXiv:1503.02531"}' $B/workspaces/$WS/uploads
RUN=$(curl -s $J -H "Authorization: Bearer $TOKEN" -d '{"compute_budget":"quick"}' $B/workspaces/$WS/runs | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -N -H "Authorization: Bearer $TOKEN" $B/runs/$RUN/stream          # watch; wait for checkpoint_waiting (plan)
curl -s $J -H "Authorization: Bearer $TOKEN" -d '{"action":"approve"}' $B/runs/$RUN/checkpoints/plan
curl -s -H "Authorization: Bearer $TOKEN" $B/runs/$RUN/scorecard       # 'ours' values carry log hash + commit + log line
```
In the browser: sign up with email + password → New workspace → paper `arXiv:1503.02531` → Live board → approve the plan on the Map page → Results → Scorecard.

## 6. Tests
```bash
(cd backend && go vet ./... && go test ./...)
(cd agents && ../.venv/Scripts/python -m pytest -q)
(cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && npm run build)
```

## Troubleshooting
| Symptom | Fix |
|---|---|
| `docker info` fails; Docker Desktop shows "unexpected error … dockerInference / engine.sock: The file cannot be accessed by the system" | Stale Unix-socket files from an unclean shutdown. Quit Docker Desktop, rename `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` (Docker recreates them), start again. If it repeats, reboot Windows, or update Docker Desktop. Avoid "Reset to factory defaults" unless you accept losing images. |
| API exits with `connect redis` after 60 s | `docker compose up -d redis` |
| Browser POST fails with 403 "missing X-Requested-With" | Call the API through `services.ts` (it sends the header) or use a Bearer token for curl |
| `pytest` collection error about `psycopg` | Use `.venv/Scripts/python`, not the system Python |
| Push stuck "in progress" | Pushes without a callback are failed automatically after 20 minutes |
