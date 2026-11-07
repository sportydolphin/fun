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
  symbol rather than punctuation. `src/__tests__/houseRules.test.ts` fails on any other.
- **American English, never British:** color, center, favorite, recognize, canceled, labeled,
  license (the noun too), behavior. In UI copy, comments, commit messages, docs and the changelog.
  Identifiers and data values stay as they are: MLB's `'Cancelled'` status, `aria-labelledby`.
  The same test fails on British spelling in prose.
- **Copy is matter of fact: labels, not narration.** Name a stat, chart or filter the way a stat
  table does ("Qualified", "OBP vs SLG", "No data"); never describe it in prose ("Regulars only",
  "Everyone who played", "On base and power"). No subtitles or intro sentences explaining a page,
  board or chart. A definition, when needed, goes in an `InfoDot` (`SectionHeading`'s `info` on a
  WPBL page) and reads as a definition. UI copy, empty states, tooltips and the changelog (Oct 21, 2026).
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
  eyeballed (`npm run sweep -- --shift`); every outline is at least 3:1 in both themes, never an alpha-faded color; and
  accessibility is checked by the lint and by axe in the sweep, never fading text with `opacity`.
- **A lockfile written on Windows can fail `npm ci` on Linux.** npm on Windows left
  `@napi-rs/wasm-runtime`'s optional `@emnapi/*` peers out of the lockfile's top level, CI's Linux
  npm required them, and every check failed in seconds (Oct 14, 2026). Both are now plain
  devDependencies so every platform writes them; do not remove them as unused (knip ignores them).
  A new `Missing: X from lock file` in CI is the same thing: add X the same way. Node 24 and npm 11
  everywhere, enforced by `devEngines`.
- **Every text file is LF, in the working tree too.** Git for Windows ships `core.autocrlf=true`,
  so before [`.gitattributes`](.gitattributes) every checkout here was CRLF while the repo held LF,
  and a script matching `<<<<<<<` line by line missed the markers and committed them mid-rebase
  (Nov 6, 2026). `* text=auto eol=lf` overrides that; do not remove it. A script that reads files
  should still split on `/\r?\n/`, since an older checkout keeps its CRLF until each file is
  rewritten.
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
- A video's path (`/wpbl/watch/<id>`) is case-sensitive; `readPath` skips its lowercasing.
- Modules shared with Deno carry `.ts` on runtime imports and never import `constants.ts`.
- The fan-awards ballot has no audience gate, and nothing may add one.

[`supabase/functions/wpbl-ingest/CLAUDE.md`](supabase/functions/wpbl-ingest/CLAUDE.md), the feed and the ingest:
- `wpbl_game_plays` is a mirror: corrections go in `wpbl_play_corrections`. `wpbl_game_revisions` is the opposite, append-only and irreplaceable.
- A club's feed id is not the club (`api_ids`, adoption by exact name); any `summary.errors` entry is a failed run (`ok: false`).
- `feed-contract.ts` checks every `/games` and box score read; a break is reported, not skipped, and `deno.json` pins valibot to `package.json`.
- The postseason is a separate presto season with no timezone twins; the league's own calendar outranks the feed's start times.
- A game's status goes backwards; `completed_at` outranks the status string.
- `/games` caps at 50 in silence: always pass `?limit=` and compare against `count`.
- TrackMan's `/activity` wants an API key since Nov 2026, and the ingest only warns; `npm run rehearse` reports it.
- A final is read-only to the ingest while the league keeps editing it; `check-wpbl-drift.mjs` closes that.

[`src/CLAUDE.md`](src/CLAUDE.md), UI in both sections:
- Loading states, borders and accessibility in full (the three rules above).
- Two desktop scales in CSS, no `zoom`: `--app-type` for type, `--app-chrome` for structure.
- A fixed px length is type (`rem`), structure (`chromePx()`) or ornament (raw px); letter spacing is `typePx()`.
- `--app-header-h` is the pinned chrome's height from the rect; 0 on a phone.
- Inside the desktop side panel the viewport lies: ask `usePhoneLayout()`.
- No `passive: false` touch listener inside a sheet.
- `staleBuild.ts` patches `history.pushState` after a deploy, on purpose; a canceled `vite:preloadError` resolves the import to `undefined`.
- Internal links are real `<a href>` through `linkTo()`.

[`scripts/migrations/CLAUDE.md`](scripts/migrations/CLAUDE.md), the database:
- A browser `.upsert()` needs a SELECT policy; a table the browser must not read gets a writer function.
- Three write paths to the database, and only three.
- A new function in `public` is callable by `anon` by default: a `security definer` one checks the caller or revokes.

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

Two independent league sections in one shell (auth, search, notifications, theme, units), plus
`/admin` (owner analytics). **Nothing else**: the bolted-on toys (`/cups`, `/stopwatch` and the
rest) were deleted on Sep 10, 2026.

- **WPBL** (`/wpbl`, the default): Women's Pro Baseball League, mirrored from the league feed into
  Supabase by the `wpbl-ingest` edge function. The feed went quiet on Sep 22, 2026 and returns in
  spring 2027.
- **MLB** (`/mlb`): StatsAPI-driven, with the predictions game, playoff odds and Streak Survivor.

**Stack:** React 19 + TypeScript + Vite + MUI · Supabase (Postgres, Auth, Edge Functions,
pg_cron) · GitHub Actions for cron · installable PWA · Cloudflare at `sportydolphin.fun`.

## Where to look

- [ARCHITECTURE.md](ARCHITECTURE.md) is the map: routes, tables, the ingest, every cron job, edge
  functions, integrations, secrets. **Keep it current** when you add a table, workflow or
  integration. It is large: Grep for the section, then read that part.
- [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md) orders every roadmap: start there when picking
  work. The others are `ROADMAP-WPBL.md` (shipped log in `docs/roadmap-log/`), `ROADMAP.md` (MLB),
  `ROADMAP-UI.md` (the redesign) and `ROADMAP-WOMENS-BASEBALL.md`.
- [docs/](docs/): read the one that guards what you touch BEFORE touching it. `CI.md` (`ci.yml`,
  test config, lint, the sweep), `ADMIN_ANALYTICS.md` (`events`, `admin_*` RPCs, its security
  section), `WAR.md` (`derive/war.ts`, `derive/fielding.ts`), `COMMONS_PHOTOS.md`, `WBSC_INGEST.md`
  (`scripts/import-wbsc.ts`, `src/intl/`), `ANDROID.md` (`manifest.webmanifest`, `sw.js`,
  `assetlinks.json`), `IOS.md` (`apple-app-site-association` and its `_headers` rule, live with a
  placeholder Team ID), `PLAY_VALIDATION.md`. The rest are reference.
- The changelog is [`src/changelog.ts`](src/changelog.ts); new entries go at its top.

**Code:** [`src/App.tsx`](src/App.tsx) is the shell (hand-rolled path routing, no router lib).
[`src/wpbl/`](src/wpbl/) and [`src/mlb/`](src/mlb/) never import each other; both import
[`src/ui/`](src/ui/) (shared UI), [`src/league/`](src/league/) (league-neutral engines, each fed a
`League` from the section's `league.ts`) and [`src/lib/`](src/lib/).
[`shared/notifications.js`](shared/notifications.js) is one catalog for the bell and push.

## Environment

- **Windows.** PowerShell 5.1 is the primary shell; a Bash tool is also available.
- **Dev:** `npm install && npm run dev` → http://localhost:5173. Needs `.env` with
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY`; without them the app
  renders empty states.
- **Symbols:** the `serena` MCP ([`.mcp.json`](.mcp.json)) answers "who calls X" and "what is in
  this file": prefer `find_referencing_symbols`, `find_symbol` and `get_symbols_overview` to reading
  files. Its first call waits about 90s while TypeScript indexes. It runs on `uvx --python 3.11`
  with `UV_PYTHON_DOWNLOADS=never`, because uv 0.13.1 fails its own Python link check here.
- **Tests:** `npm run test` (Vitest, about 22s). `.tsx` tests run in jsdom, `.ts` in plain Node (a
  `.ts` test touching `window` starts with `// @vitest-environment jsdom`). Never sleep for a
  history move; use `traverse()` from `src/test/history.ts`. More in [docs/CI.md](docs/CI.md).
- **CI:** [`ci.yml`](.github/workflows/ci.yml) runs typecheck, lint, tests and build; `check` and
  `layout` are required on every pull request. Tests use placeholder Supabase settings, so no test
  may need `.env`. Lint must print nothing: `react-hooks/exhaustive-deps` is an error, and a
  dependency left out on purpose carries a disable comment with the reason.
- **Local gates** ([`.githooks/`](.githooks/), installed by `npm install`): the house rules run on
  every Edit/Write (a Claude Code hook) and on staged files at commit; `pre-push` runs the typecheck
  and `vitest related`. All skip under `CI`; `SKIP_PREPUSH=1` skips the push one.
- **Scripts:** a TypeScript script runs through `node scripts/run-ts.mjs [--env] scripts/x.ts`
  (bundle, then run); add a `package.json` entry in that form. `scripts/*.mjs` are the cron jobs
  (ARCHITECTURE §5), on the service-role key from repo secrets.
- **Edge functions** deploy by hand: `supabase functions deploy <name>`.
