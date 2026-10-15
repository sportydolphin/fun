# sportydolphin.fun

Loaded at the start of every session, so it is kept short: the rules that apply everywhere,
and an index of the traps. Each trap's full story lives in a scoped `CLAUDE.md` beside the code it
concerns, which Claude Code loads on its own when it reads a file in that directory. Add a new trap
there, with one line in the index below. Was `context.md` until Aug 18, 2026.

## Be concise

**This outranks everything else here.** Answer the question and stop. No preamble, no
restating the request, no summary of a summary, no listing files that are already in the
diff, no caveats that don't change what to do next. If one line is the answer, give one
line. Length is not thoroughness.

Detail belongs in two places only: code comments and commit messages, which explain *why*
(see [House rules](#house-rules)), and one plain sentence for a real risk or an assumption
that changes the work.

## House rules

Violating these creates real problems. Treat them as hard constraints.

- **No em dashes.** UI copy, comments, commit messages, docs, changelog. Rewrite the
  sentence rather than swapping the character; a colon, a full stop or a comma pair almost
  always reads better. En dashes stay where they are correct: ranges and scores, `5–2`.
  The one allowed `—` is the glyph meaning "no value" in tables and stat lines, which is a
  symbol rather than punctuation.
- **WPBL is baseball, not softball.** ⚾ never 🥎. It is the *Women's Pro Baseball League*,
  a full pro league. No gender stereotypes, no softball framing, anywhere.
- **A name that does not fit shortens to "F. Last"; it is never cut off mid-name.** "K. Whitmore",
  not "Kelsie Whit…", anywhere on the site. The stages and the measured fits live in
  [`src/ui/names.ts`](src/ui/names.ts) (`nameStages`, `useLineNameFit` for a line of several names),
  [`src/ui/NameText.tsx`](src/ui/NameText.tsx) for one name in a list row (it measures, so it works
  inside a `.map()`) and WPBL's `FittedName`; a CSS ellipsis is only the net under the last stage.
  **Never shorten by character count** (the deleted `useWpblName`): a count cannot know the room, so it leaves a
  name whole on a phone that then gets cut, and abbreviates one that fits on a desktop.
  `npm run sweep -- --ellipsis` lists every truncation on every page; a full name in that list is a bug.
- **Never use the Yankees or their players as examples.** Not in comments, sample data,
  docs, or explanations. Pick any other club.
- **`main` is the deploy branch, and it only takes pull requests.** Cloudflare Pages deploys
  every commit that lands on it. Work on a feature branch, push the branch, and open a pull request
  that merges itself once CI passes: `gh pr create --fill && gh pr merge --auto --squash`. A plain
  push to `main` is refused (the ruleset in [`.github/rulesets/`](.github/rulesets/)); only the
  scheduled jobs that commit generated files may push there. The pull request's title and body
  become the commit, so they follow the commit-message rule below. Commit and push only when asked.
- **Comments and commit messages explain why, not what.** The diff already says what
  changed. Say what forced it, and what breaks if someone undoes it.
- **Schema changes go through the migration runner.** New schema in
  [`scripts/migrations/`](scripts/migrations/), applied with `npm run migrate`; scaffold
  with `npm run migrate -- new "add foo table"`. Needs `SUPABASE_DB_URL` in `.env`. The 33
  legacy `scripts/*.sql` files are the pre-runner baseline: applied by hand, left alone,
  never re-run.
- **UI work has three more hard rules**, each in full in [`src/CLAUDE.md`](src/CLAUDE.md): a
  loading state is the loaded page drawn empty, measured rather than
  eyeballed (`npm run sweep -- --shift`); every outline is at least 3:1 in both themes, never an alpha-faded colour; and
  accessibility is checked by the lint and by axe in the sweep, never fading text with `opacity`.
- **A lockfile written on Windows can fail `npm ci` on Linux.** npm on Windows left
  `@napi-rs/wasm-runtime`'s optional `@emnapi/*` peers out of the lockfile's top level, CI's Linux
  npm required them, and every check failed in seconds (Oct 14, 2026). Both are now plain
  devDependencies so every platform writes them; do not remove them as unused (knip ignores them).
  A new `Missing: X from lock file` in CI is the same thing: add X the same way. Node 24 and npm 11
  everywhere, enforced by `devEngines`.
- **Read the open pull requests, not just `main`.** Everything lands through pull requests that
  merge themselves, so work in flight (a roadmap section, a fix) lives on their branches until
  then. A SessionStart hook ([`scripts/open-prs.mjs`](scripts/open-prs.mjs)) lists them with their
  checks; a red one is usually waiting on nobody.
- **Never commit secrets.** Client build vars live in Cloudflare Pages env plus `.env`;
  edge-function and cron secrets live in Supabase and GitHub Actions (table in
  ARCHITECTURE §9).
- **`functions/` and `supabase/functions/` are different platforms.** The first is
  Cloudflare Pages Functions, the second is Supabase Deno edge functions.

## Traps: where they live

None of these fail loudly, and each has already cost a debugging session. One line each here; the
file named holds the full story and loads by itself when you read code in its directory. Read it
first when you are working on what the line describes, even from somewhere else (a script, a test).

[`src/wpbl/CLAUDE.md`](src/wpbl/CLAUDE.md), the WPBL client:
- The feed's `runs_scored` does not count the batter: call `runsOnPlay()`.
- "Every row" needs `.range()` paging and an `.order()` (`fetchAllPaged`); PostgREST caps at 1000 in silence.
- Postseason games never reach standings or season totals; `countsInStandings()` fails OPEN, and every aggregate takes the schedule as a required argument.
- A player's feed id is not the player, and a player's club is a fact about a date: names come from `fetchWpblAllPlayers`, clubs from the line.
- A series being played is not "upcoming" (the pick'em lock).
- `live_state` is the feed's last word: clamp the count, detect the break between halves.
- Every bulk read is every season: `cut` before summing; the play log is the one per-season read.
- `LIVE_GAME_COLUMNS` must list every column that can change mid-game.
- Rate-title gates are plate appearances (`plateAppearances()`), never `ab`.
- `era` / `k9` follow `ERA_BASIS_CANONICAL`; never a literal 7 or 9.
- Missing videos may be region-blocked on purpose (`playableIn`).
- Modules shared with Deno carry `.ts` on runtime imports and never import `constants.ts`.
- The fan-awards ballot has no audience gate, and nothing may add one.

[`supabase/functions/wpbl-ingest/CLAUDE.md`](supabase/functions/wpbl-ingest/CLAUDE.md), the feed and the ingest:
- `wpbl_game_plays` is a mirror: corrections go in `wpbl_play_corrections`. `wpbl_game_revisions` is the opposite, append-only and irreplaceable.
- A club's feed id is not the club (`api_ids`, adoption by exact name); `summary.errors` does not set `ok: false`.
- The postseason is a separate presto season with no timezone twins; the league's own calendar outranks the feed's start times.
- A game's status goes backwards; `completed_at` outranks the status string.
- `/games` caps at 50 in silence: always pass `?limit=` and compare against `count`.
- A final is read-only to the ingest while the league keeps editing it; `check-wpbl-drift.mjs` closes that.

[`src/CLAUDE.md`](src/CLAUDE.md), UI in both sections:
- Loading states, borders and accessibility in full (the three rules above).
- Two desktop scales in CSS, no `zoom`: `--app-type` for type, `--app-chrome` for structure.
- A fixed px length is type (`rem`), structure (`chromePx()`) or ornament (raw px); letter spacing is `typePx()`.
- `--app-header-h` is the pinned chrome's height from the rect; 0 on a phone.
- Inside the desktop side panel the viewport lies: ask `usePhoneLayout()`.
- No `passive: false` touch listener inside a sheet.
- `staleBuild.ts` patches `history.pushState` after a deploy, on purpose.
- Internal links are real `<a href>` through `linkTo()`.

[`scripts/migrations/CLAUDE.md`](scripts/migrations/CLAUDE.md), the database:
- A browser `.upsert()` needs a SELECT policy; a table the browser must not read gets a writer function.
- Three write paths to the database, and only three.

[`functions/CLAUDE.md`](functions/CLAUDE.md), deploy and routing (covers `public/` too):
- Signed-out Supabase reads come from Cloudflare's cache; only tables every reader sees alike go on that list.
- A new Pages Function needs a `public/_routes.json` entry, which can only narrow.
- `_redirects` allows only 200/301/302/303/307/308; anything else silently stops deploys.
- `wrangler pages dev` is not production; watch the `main` build.
- Each `_redirects` wildcard has a function answering a real 404 in front of it.
- A new app route needs two `_redirects` lines (and a WPBL tab, `routes.ts` and `seo.ts`).
- `manifest.webmanifest`'s `id` stays `/mlb`; `sw.js` never caches the shell.
- `public/icon.svg` and `public/sitemap.xml` are generated.
- SEO: meta, JSON-LD, the edge-rewritten share cards, and why `og:image` stays 1200x630.

## What it is

Two independent league sections sharing one shell (auth, search, notifications, theme,
units):

- **WPBL** (`/wpbl`, the default): Women's Pro Baseball League. Scoreboard, schedule,
  standings, stats, TrackMan, Game Center, auto recaps, push reminders.
  Run value (the league's own run-expectancy table, built from our own plays).
  Offseason surfaces: the season recap, Reading (two outside writers, linked out, see
  `docs/READING.md`), Watch (every video, the league's Shorts tagged to the plays they show) and a
  fan-photo gallery.
  Mirrored from the league feed into Supabase by the `wpbl-ingest` edge function. The feed
  went quiet on Sep 22, 2026 when the season ended, and returns in spring 2027.
- **MLB** (`/mlb`): deeper and StatsAPI-driven. Game Center, personalized home feed, a
  predictions game with a Wilson-ranked leaderboard and bot rivals, playoff odds, milestone
  watch, streak report cards, Streak Survivor.

Also `/admin` (owner analytics). **Nothing else.** The five bolted-on toys that used to live
here (`/cups`, `/stopwatch`, `/weights`, `/poop`, `/testgame`, plus the `projects/` and
`public/projects/` trees behind them) were deleted on Sep 10, 2026: the site is the two
leagues, and a games drawer nobody visited was still costing routes, redirects, CSS,
a password-lock dialog and a tile grid on the admin page.

**Stack:** React 19 + TypeScript + Vite + MUI · Supabase (Postgres, Auth, Edge Functions,
pg_cron) · GitHub Actions for cron · installable PWA · Cloudflare Pages at
`sportydolphin.fun`.

## Where to look

- [ARCHITECTURE.md](ARCHITECTURE.md) is the real map: routes, DB tables, the ingest, every cron
  job, edge functions, integrations, config and secrets. **Keep it current** when you add a table,
  workflow, or integration. It is large: find the section with Grep, then read that part.
- [ROADMAP-WPBL.md](ROADMAP-WPBL.md) for anything under `/wpbl` (the clock and the priority list);
  its dated shipped log is under [`docs/roadmap-log/`](docs/roadmap-log/), one file per month.
  [ROADMAP.md](ROADMAP.md) is the MLB equivalent. [README.md](README.md) for scripts.
- [docs/](docs/). Read the named one BEFORE touching what it guards: `CI.md` (`ci.yml`, test
  config, lint rules, the layout sweep), `ADMIN_ANALYTICS.md` (the `events` table, `admin_*` RPCs;
  its security section is what keeps analytics private), `WAR.md` (`derive/war.ts`,
  `derive/fielding.ts`), `COMMONS_PHOTOS.md` (approving an archive photo), `ANDROID.md`
  (`manifest.webmanifest`, `sw.js`, `assetlinks.json`), `IOS.md`
  (`public/.well-known/apple-app-site-association` and its `_headers` rule), `PLAY_VALIDATION.md`.
  The rest are reference: `DISCORD.md`, `PUSH_NOTIFICATIONS.md`, `READING.md`, `RECAPS.md`,
  `FAN_PHOTOS.md`, `GOOGLE_TASKS.md` (paused), `BACKLINKS.md`.
- The changelog is [`src/changelog.ts`](src/changelog.ts) (newest releases only; older ones are
  archived under `src/changelog/`). Add new entries at its top.

  `public/.well-known/apple-app-site-association` or its `_headers` rule**, which is live
  ahead of the app with a placeholder Team ID).

Code: [`src/App.tsx`](src/App.tsx) is the shell, with hand-rolled path routing and no
router lib. [`src/wpbl/`](src/wpbl/) is self-contained with no MLB coupling
(`WpblApp.tsx` with its tabs and search in `app/`, `api.ts` with its reads in `api/`, `SwipeableViews.tsx` are its spine);
[`src/mlb/`](src/mlb/) plus [`src/MlbStats.tsx`](src/MlbStats.tsx) is the other section;
[`src/ui/`](src/ui/) holds the UI both sections share (the bottom bar, the tab pager,
`ModalShell`, the tap helpers), which WPBL built and re-exports from its old paths: neither
section imports the other, both import this;
[`src/league/`](src/league/) holds the league-neutral engines (single-game bests, the finder,
the pitch-code boards, run expectancy) on neutral line and play types, each fed a `League` from
the section's own `league.ts` for anything that differs (innings, pitch letters, how a play's runs
are counted); WPBL's `derive/` files of the same names bind it and keep their old exports;
[`src/lib/`](src/lib/) holds the shared client libs;
[`shared/notifications.js`](shared/notifications.js) is one catalog serving both the
in-site bell and the push senders.

## Environment

- **Windows.** PowerShell 5.1 is the primary shell; a Bash tool is also available. Mind the
  syntax differences.
- **Dev:** `npm install && npm run dev` → http://localhost:5173, redirects to `/wpbl`.
  Needs `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`
  for push. Without them the app renders empty states.
- **Symbols:** the `serena` MCP ([`.mcp.json`](.mcp.json), TypeScript's language server) answers
  "who calls X" and "what is in this file" with symbols, not whole files: prefer
  `find_referencing_symbols`, `find_symbol` and `get_symbols_overview` to reading files to find a use.
  Its first call after startup waits about 90s while TypeScript indexes the project. It runs on
  `uvx --python 3.11` with `UV_PYTHON_DOWNLOADS=never`, because uv 0.13.1 fails its own Python link
  check on this machine.
- **Tests:** `npm run test` (Vitest, about 22s), in `src/__tests__/` and `src/**/__tests__`.
  `.tsx` tests run in jsdom and `.ts` tests in plain Node: a `.ts` test that touches `window`
  starts with `// @vitest-environment jsdom`. Never sleep for a history move; use `traverse()`
  from `src/test/history.ts`. Both, and the flake hunt, are in [docs/CI.md](docs/CI.md).
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm run typecheck`, `npm run lint`,
  the tests and the build on every push and pull request. `npm run lint -- --fix` removes unused
  imports; an unused variable is an error left for a person. The tests run against placeholder
  Supabase settings (`test.env` in `vite.config.js`), never the real project, so no test may need
  `.env`. Its `check` and `layout` checks are required on every pull request into `main`.
  Lint must print nothing: `react-hooks/exhaustive-deps` is an error, and a dependency left out
  on purpose carries a disable comment with the reason above it.
- **Cron:** `scripts/*.mjs` are Node jobs on GitHub Actions schedules (table in
  ARCHITECTURE §5), using the service-role key from repo secrets.
- **Edge functions** deploy by hand: `supabase functions deploy <name>`.
