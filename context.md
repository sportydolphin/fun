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
3. **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)** — the WPBL plan. Start here if you're touching
   `/wpbl`: it opens with the season clock (the feed stops Sep 6, 2026), then the
   prioritized next list, with a dated realignment log at the end for what shipped when.
   **[ROADMAP.md](ROADMAP.md)** is the MLB section's own plan. The two were one file until
   Aug 16, 2026.
4. **[docs/](docs/)** — `DISCORD.md` (the fan-server board, the box score posted when a
   game goes final, the YouTube highlight reels, the `/player` slash-command bot, and which
   of the secret stores each writer reads),
   `PUSH_NOTIFICATIONS.md`, `GOOGLE_TASKS.md`, `feature-requests.md`, and
   `ADMIN_ANALYTICS.md` (the owner dashboard at `/admin` — read it before touching the
   `events` table or the `admin_*` RPCs; its security section is the only thing keeping
   site analytics from being readable by every signed-in user).

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
- **Schema changes go through the migration runner.** New schema lives in
  [`scripts/migrations/`](scripts/migrations/) and is applied with `npm run migrate` (see
  [scripts/migrations/README.md](scripts/migrations/README.md)). Scaffold one with
  `npm run migrate -- new "add foo table"`. The 33 legacy `scripts/*.sql` files are the
  pre-runner **baseline** — already applied by hand, left in place, not re-run. The runner
  needs a `SUPABASE_DB_URL` (direct Postgres connection string) in `.env`.
- **Modules shared with Deno carry `.ts` on their imports.** The WPBL recap engine
  ([`src/wpbl/derive/recap.ts`](src/wpbl/derive/recap.ts) and
  [`discordRecap.ts`](src/wpbl/derive/discordRecap.ts)) is loaded by three different
  builds: Vite, the esbuild bundle behind `npm run discord-recaps`, and **Deno** inside
  `wpbl-ingest`. Deno resolves local specifiers literally, so any *runtime* import those
  files add needs an explicit `.ts` extension (type-only imports are erased and stay
  extensionless; `allowImportingTsExtensions` in tsconfig is what lets `tsc` accept them).
  For the same reason they must never import [`constants.ts`](src/wpbl/constants.ts) — it
  pulls the team logos in as Vite assets, which is why `outsToIp` lives in
  [`innings.ts`](src/wpbl/innings.ts).
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
- [`supabase/functions/`](supabase/functions/) — Supabase (Deno) edge functions:
  `wpbl-ingest`, `delete-account`, `send-test-push`.
- [`functions/`](functions/) — **Cloudflare Pages** Functions, a different thing in a
  confusingly similar place: `wpbl/index.ts` rewrites Open Graph tags at the edge so a
  shared `/wpbl?player=<id>` link unfurls as that player.
- `projects/`, `public/projects/`, and routes like `/cups`, `/stopwatch`, `/poop` — small
  standalone tools/games bolted onto the same shell.

## SEO / hosting facts

- Hosted as a Vite SPA on **Cloudflare Pages** at `sportydolphin.fun`.
- SEO plumbing exists: `robots.txt`, `sitemap.xml`, per-route meta + JSON-LD via
  [`src/seo.ts`](src/seo.ts). Note `seo.ts` runs *after* React mounts, so social unfurlers
  never see it — a shared player link gets its card from the Cloudflare Pages Function in
  [`functions/wpbl/`](functions/wpbl/), which rewrites the tags before the HTML leaves the
  edge. Headshots are republished at a stable `/portraits/<slug>.webp` for it by a Vite
  plugin, since the edge has no copy of the build's hashed-asset map. (Google Search Console verification was still a TODO as of
  the last update — check whether it's done before assuming.)
