# sportydolphin.fun

A baseball web app with **two independent league sections**, switchable from the toolbar:

- **WPBL** (`/wpbl`) — Women's Pro Baseball League coverage (the default section): live scoreboard, schedule, standings, a full sortable stats table, team & player pages, a TrackMan **Tracking** tab (velocity / spin / exit-velo leaders + pitch-location maps), a **Game Center** (line score, box score, play-by-play, pitch data), **Hall of Firsts**, and opt-in **pre-game push reminders**. Data comes from the league's public feed, mirrored into Supabase by the `wpbl-ingest` Edge Function.
- **MLB** (`/mlb`) — a deeper, StatsAPI-driven app: live Game Center with scrubbable win-probability, a personalized home feed, a predictions game with a Wilson-ranked leaderboard and bot rivals, playoff odds, milestone watch, streak report cards, Streak Survivor, and more.

Both sections share one shell: auth, header search, notifications/Web Push, units, theme, and back-button history.

**Stack:** React 18 + TypeScript + Vite + MUI, Supabase (Postgres + Auth + Edge Functions) for data and accounts, and GitHub Actions for the nightly/periodic precompute and push-sender jobs. Installable PWA.

📐 **[ARCHITECTURE.md](ARCHITECTURE.md)** — full system diagram: frontend routes, database tables, edge functions, the WPBL ingest pipeline, every cron job, and external integrations.

## Quick start

```bash
npm install
npm run dev
```

Open the site at http://localhost:5173 (it redirects to `/wpbl`; MLB is one tap away via the MLB | WPBL toggle).

Client env vars (a `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and — for push — `VITE_VAPID_PUBLIC_KEY`) are needed for live data and accounts; without them the app renders its empty states.

## Scripts

```bash
npm run dev      # Vite dev server
npm run build    # production build (vite build)
npm run preview  # serve the production build locally
npm run test     # Vitest (jsdom pinned to 26.x — see note below)
npm run migrate  # apply pending DB migrations (scripts/migrations/; needs SUPABASE_DB_URL)
```

**jsdom is pinned to `^26.1.0` on purpose.** jsdom 27 pulls in `html-encoding-sniffer@6`,
which is CommonJS but `require()`s the ESM-only `@exodus/bytes` — that only works on a Node
with `require(esm)` support (**22.12+**, or **20.19+**), and throws `ERR_REQUIRE_ESM`
everywhere else. jsdom 26 avoids that chain entirely and runs on any Node. Safe to un-pin
once every environment is on a supported Node (check `node -p process.features.require_module`).

Schema changes go through the migration runner — see
[scripts/migrations/README.md](scripts/migrations/README.md). The legacy `scripts/*.sql`
files are the already-applied baseline.

`package.json` also holds the Node jobs that GitHub Actions runs on a schedule (predictions bots, payroll updates, streak/milestone/playoff-odds precompute, survivor resolver, and the Web Push senders — MLB `send-game-start.mjs` and WPBL `send-wpbl-game-start.mjs`).

## Layout

- [index.html](index.html) → [src/main.tsx](src/main.tsx) — entry point (registers the service worker)
- [src/App.tsx](src/App.tsx) — shell: routing between `/mlb` and `/wpbl`, toolbar, auth, search bridge
- [src/mlb/](src/mlb/) — the MLB section (views, components, state, notifications)
- [src/wpbl/](src/wpbl/) — the WPBL section (self-contained, WPBL-native components; no MLB coupling)
- [src/lib/](src/lib/) — shared: Supabase client, analytics, push, notifications, units
- [shared/notifications.js](shared/notifications.js) — one notification catalog shared by the in-site bell and the push senders
- [scripts/](scripts/) — SQL migrations (`create_*`, `add_*`, seeds) and the Node cron jobs
- [supabase/functions/](supabase/functions/) — Edge Functions (incl. `wpbl-ingest`, the WPBL feed mirror)

## Docs

- [ROADMAP.md](ROADMAP.md) — living plan for both leagues (dated realignment log at the end of the WPBL section)
- [docs/PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md) — Web Push setup + the MLB and WPBL reminder senders
- [docs/GOOGLE_TASKS.md](docs/GOOGLE_TASKS.md), [docs/feature-requests.md](docs/feature-requests.md)
