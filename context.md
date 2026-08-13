# Project Context — start here

Orientation for anyone (human or LLM) picking up this repo cold. It won't repeat the
architecture — it points you at the deep docs and captures the conventions and gotchas
that aren't obvious from the code.

## What this is

**sportydolphin.fun** — a baseball web app with two independent league sections that share
one shell (auth, search, notifications, theme, units):

- **WPBL** (`/wpbl`, the default) — Women's Pro Baseball League coverage: live scoreboard,
  schedule, standings, stats, TrackMan tracking, Game Center, auto game recaps, Hall of
  Firsts, push reminders. Data is mirrored from the league's public feed into Supabase by
  the `wpbl-ingest` edge function.
- **MLB** (`/mlb`) — a deeper StatsAPI-driven app: live Game Center, personalized home feed,
  a predictions game with a Wilson-ranked leaderboard + bot rivals, playoff odds, milestone
  watch, streak report cards, Streak Survivor.

**Stack:** React 18 + TypeScript + Vite + MUI · Supabase (Postgres + Auth + Edge Functions
+ pg_cron) · GitHub Actions for cron jobs · installable PWA · hosted on **Cloudflare Pages**.

## Read these, in order

1. **[README.md](README.md)** — quick start, scripts, top-level layout.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the real map: system diagram, routes, DB tables,
   the WPBL ingest pipeline, every cron job, edge functions, external integrations, and the
   config/secrets reference. Keep it current when you add a table, workflow, or integration.
3. **[ROADMAP.md](ROADMAP.md)** — living plan for both leagues; dated realignment log at the
   end of the WPBL section tells you what shipped recently and what's next.
4. **[docs/](docs/)** — `PUSH_NOTIFICATIONS.md`, `GOOGLE_TASKS.md`, `feature-requests.md`.

Source-of-truth index is at the bottom of ARCHITECTURE.md.

## Conventions that aren't in the code (important)

These are project rules. Violating them creates real problems, so treat them as hard
constraints:

- **WPBL is baseball, not softball.** Use ⚾ (never 🥎). It's the *Women's Pro Baseball
  League* — a full pro baseball league. Never introduce gender stereotypes or softball
  framing in copy, UI, or examples.
- **Never use the Yankees (or their players) as examples.** No Aaron Judge, no NYY, in code
  comments, sample data, docs, or explanations. Pick any other team/player.
- **`main` is the deploy branch.** Cloudflare Pages deploys on every push to `main`. Work on
  a feature branch, then push it to `main` — e.g. `git push origin <branch>:main`. Only
  commit/push when asked.
- **No DB migration runner.** Schema lives in [`scripts/*.sql`](scripts/) and is applied
  **by hand** in the Supabase SQL editor. Adding a table = write a `create_*`/`add_*` SQL
  file *and* run it manually; there's no automation that picks it up.
- **Two write paths to the DB, and only two:** (1) the browser writes user rows through RLS
  (events, feedback, picks); (2) everything ingested or derived is written by service-role
  actors — the `wpbl-ingest` edge function and the GitHub Actions `scripts/*.mjs` jobs. The
  browser only *reads* those. Don't add a third path.

## Environment / workflow notes

- **Dev is on Windows** — primary shell is PowerShell 5.1 (a Bash tool is also available for
  POSIX scripts). Watch for shell-syntax differences.
- **Local dev:** `npm install && npm run dev` → http://localhost:5173 (redirects to `/wpbl`).
  Needs a `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and (for push)
  `VITE_VAPID_PUBLIC_KEY`; without them the app renders empty states.
- **Tests:** `npm run test` (Vitest). Tests live in `src/__tests__/` and `src/**/__tests__`.
- **Cron scripts** (`scripts/*.mjs`) are Node jobs run by GitHub Actions on a schedule (see
  the table in ARCHITECTURE §5); they use the service-role key from repo Actions secrets.
- **Edge functions** deploy manually: `supabase functions deploy <name>`.
- **Secrets:** never commit them. Client build vars live in Cloudflare Pages env + `.env`;
  edge-function and cron secrets live in Supabase and GitHub Actions secrets respectively
  (full table in ARCHITECTURE §9).

## Code layout at a glance

- [`src/App.tsx`](src/App.tsx) — the shell: hand-rolled path-based routing (no router lib),
  toolbar, auth, search bridge, MLB⇆WPBL switch. Heavy sections are `lazy()` chunks.
- [`src/wpbl/`](src/wpbl/) — the WPBL section, fully self-contained (WPBL-native components,
  no MLB coupling). `WpblApp.tsx`, `api.ts`, `SwipeableViews.tsx` are the spine.
- [`src/mlb/`](src/mlb/) + [`src/MlbStats.tsx`](src/MlbStats.tsx) — the MLB section.
- [`src/lib/`](src/lib/) — shared client libs: Supabase anon client, analytics, push,
  notifications, units.
- [`shared/notifications.js`](shared/notifications.js) — one notification catalog shared by
  the in-site bell and the push senders.
- [`scripts/`](scripts/) — SQL schema files + the Node cron jobs.
- [`supabase/functions/`](supabase/functions/) — `wpbl-ingest`, `delete-account`,
  `send-test-push`.
- `projects/`, `public/projects/`, and routes like `/cups`, `/stopwatch`, `/poop` — small
  standalone tools/games bolted onto the same shell.

## SEO / hosting facts

- Hosted as a Vite SPA on **Cloudflare Pages** at `sportydolphin.fun`.
- SEO plumbing exists: `robots.txt`, `sitemap.xml`, per-route meta + JSON-LD via
  [`src/seo.ts`](src/seo.ts). (Google Search Console verification was still a TODO as of
  the last update — check whether it's done before assuming.)
