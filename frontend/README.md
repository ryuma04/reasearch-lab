# Research Lab — web frontend

Next.js 15 (App Router) + TypeScript + Tailwind v4 + Radix/shadcn-style components, following `../../DESIGN.md`.
Talks only to the Go backend described in `../../allaboutourproject.md` §23.

**Integration contract, endpoint status and proposed endpoints:** see [`../../FRONTEND_INTEGRATION_NOTES.md`](../../FRONTEND_INTEGRATION_NOTES.md).

```bash
cp .env.example .env.local   # point NEXT_PUBLIC_API_BASE_URL at the Go server
npm install
npm run dev                  # http://localhost:3000
npm run typecheck && npm run lint && npm test && npm run build
```

Set `NEXT_PUBLIC_USE_MOCKS=true` in `.env.local` to use the in-browser demo backend during development (always labelled "DEMO DATA"; disabled in production builds).

## Layout

```
src/app/                    routes (landing, login, auth/callback, (app)/…, share/[token])
src/components/ui/          design-system primitives (button, cards, forms, sheet, toast, states)
src/components/shell/       app shell, providers, logo
src/components/run/         live board, checkpoint panel, event feed, research map
src/components/results/     result tabs (research, coding, testing, scorecard, what-ifs, team, memory, notes)
src/lib/api/                endpoints registry, typed client, services, SSE, types, dev mock
src/lib/hooks/              React Query hooks + useRunStream (events + SSE)
src/lib/run-state.ts        event-sourced board state (unit tested)
```
