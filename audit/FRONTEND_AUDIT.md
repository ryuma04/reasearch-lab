# Frontend Audit (`frontend/`)

Next.js 15.x App Router, React 19, TypeScript strict, Tailwind 4, Radix, Phosphor icons, TanStack Query.
**Executed:** `tsc --noEmit` ✓ · `eslint .` ✓ (0 problems) · `vitest run` 14/14 ✓ · `next build` ✓ (18 routes).
**Not executed:** the browser against a real backend (none could start); no Playwright/E2E suite exists.

Data source for every page: **real API calls through `services.ts`**. A mock transport is used only when `NEXT_PUBLIC_USE_MOCKS=true` in dev, and is force-disabled in production builds. No hard-coded results were found in pages. Pages render "endpoint not available" for 404/405/501.

| Route | Implementation | Integration (vs real Go API) | Defects | Status |
|---|---|---|---|---|
| `/` landing | static | — | — | IMPLEMENTED |
| `/login` | GitHub button → `/auth/github/login?return_to=` | param ignored by BE; no dev-login button | INT-10 | PARTIALLY COMPLETE |
| `/auth/callback` | confirms `/me`, follows `return_to` | BE never redirects here | INT-10 | BROKEN (unreachable) |
| `/dashboard` | list, stats, GitHub banner | `GET /workspaces` ✓; `/me` status enum mismatch → banner logic wrong | INT-09 | PARTIALLY COMPLETE |
| `/profile` | repos, default repo, disconnect, pushes | `/me/pushes` missing (data is in `/me`) | INT-09 | PARTIALLY COMPLETE (OAuth BLOCKED) |
| `/workspaces/new` | create → per-item uploads → start run | create returns envelope → `id` undefined; arXiv via multipart rejected; CORS | INT-01/02/03 | BROKEN |
| `/workspaces/[id]` | overview, runs, share + QR | expects nested `runs`/`papers` | INT-04 | BROKEN |
| `/workspaces/[id]/live` | board, cards, controls, checkpoint panel | SSE named events dropped; card keys vs agent slugs; event types differ | INT-05/06/07 | BROKEN |
| `/workspaces/[id]/map` | SVG hand-drawn map + Checkpoint 1 | map shape `graph.nodes`; `/brief` path; checkpoint body | INT-05/08 | BROKEN |
| `/workspaces/[id]/results/[tab]` | research, coding, testing, scorecard, whatifs, team, memory, notes | scorecard `ours` vs `metric`; `/tests`, `/runs/{id}/memory`, `/report`, `/briefing` missing; team tab = removed feature | INT-11, DOC-03 | PARTIALLY COMPLETE (notes, settings, what-if list work) |
| `/workspaces/[id]/replay` | player 1×/4×/16× from `/events` | ✓ path/shape | event vocabulary only | IMPLEMENTED, UNVERIFIED |
| `/workspaces/[id]/publish` | approve, scan, progress, commits | body `repo_full_name` vs `repo`; status path `/push` vs `/pushes`; `done` vs `succeeded` | INT-12 | BROKEN |
| `/workspaces/[id]/agents/[agent]` | an agent's events | `/agents` returns map | INT-14 | PARTIALLY COMPLETE |
| `/team` | agent scores / evolution | backend feature removed | — | NOT APPLICABLE (delete) |
| `/memory` | semantic search | ✓ (`results` unwrapped) | — | IMPLEMENTED, UNVERIFIED |
| `/share/[token]` | read-only live view | paths need `/runs/{runId}/…` | INT-13 | BROKEN |

## Cross-cutting
| Concern | Finding |
|---|---|
| Error/loading/empty states | Present on all pages (`components/ui/states.tsx`); client maps 401 → login redirect (unit-tested) |
| Unhandled promises / console errors | none at build; runtime not observed |
| Responsive / mobile | bottom dock + bottom sheets implemented; not visually verified in this audit |
| Accessibility | Radix primitives; no axe run |
| Dark mode | MISSING (spec §26) |
| Voice / typed commands (Must-build #12) | MISSING. No UI calls `/voice/*` |
| Metric proof hover (Hero 2) | MISSING. `/metrics/{id}/proof` not called; the scorecard drawer uses inline fields |
| PDF highlight (Hero 1) | PARTIAL: opens `#page=N`, no highlight overlay |
| Research map (Hero 7) | PARTIAL: SVG, not Excalidraw; no drawing/annotation |
| Dead components | `/team` page, `agentHistory` service, `team_decision` handling |
| `.claude/launch.json` | points to `apps/web`, so the preview launcher is broken |
