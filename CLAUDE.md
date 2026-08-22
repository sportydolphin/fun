# sportydolphin.fun

Loaded at the start of every session. It does not repeat the architecture; it carries the
rules and the traps that the code does not state out loud. Was `context.md` until
Aug 18, 2026.

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
- **Never use the Yankees or their players as examples.** Not in comments, sample data,
  docs, or explanations. Pick any other club.
- **`main` is the deploy branch.** Cloudflare Pages deploys on every push to it. Work on a
  feature branch and push that to main: `git push origin <branch>:main`. Commit and push
  only when asked.
- **Comments and commit messages explain why, not what.** The diff already says what
  changed. Say what forced it, and what breaks if someone undoes it.
- **Schema changes go through the migration runner.** New schema in
  [`scripts/migrations/`](scripts/migrations/), applied with `npm run migrate`; scaffold
  with `npm run migrate -- new "add foo table"`. Needs `SUPABASE_DB_URL` in `.env`. The 33
  legacy `scripts/*.sql` files are the pre-runner baseline: applied by hand, left alone,
  never re-run.
- **Never commit secrets.** Client build vars live in Cloudflare Pages env plus `.env`;
  edge-function and cron secrets live in Supabase and GitHub Actions (table in
  ARCHITECTURE §9).

## Traps

Each of these has already cost someone a debugging session, and none of them fail loudly.

- **`wpbl_game_plays` is a mirror. Never fix a scoring error by editing it.** `wpbl-ingest`
  deletes and reinserts every play for a game on each pass, so an edit survives two minutes
  and then vanishes with no trace it existed. Corrections go in `wpbl_play_corrections` and
  are applied as a read-time overlay keyed on `(game_id, sequence)`, never the play's uuid,
  which is regenerated on every reinsert. Same reasoning for every other mirrored WPBL
  table. See [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md).
- **The feed's `runs_scored` does not count the batter.** It counts the runners who
  crossed, so a solo home run reads 0, a two-run homer 1, a grand slam 3. This has caught
  every reader of the field so far, including a validator, a Game Center badge and the Hall
  of Firsts. Call `runsOnPlay()` in
  [`src/wpbl/derive/playByPlay.ts`](src/wpbl/derive/playByPlay.ts) instead of reading the
  column.
- **"Read every row" needs explicit paging.** PostgREST silently caps a bare `.select()` at
  1000 rows: no error, just a short array. Any fetch that means "all of them" must page
  with `.range()` *and* carry a deterministic `.order()`, or Postgres can return the same
  row twice and skip another. Getting this wrong quietly makes league-wide aggregates wrong
  by a silent prefix (OPS+ and ERA+ take their baseline from `fetchWpblAllLines`). Use
  `fetchAllPaged` in [`src/wpbl/api.ts`](src/wpbl/api.ts).
- **Postseason games must never reach the standings *or any season total*, and the filter
  fails OPEN.** `countsInStandings()` now lives in [`src/wpbl/season.ts`](src/wpbl/season.ts)
  (types-only imports, so the Pages Functions can use it without pulling in the supabase
  client; `api.ts` re-exports it). It is the one definition of "counts toward the regular
  season", used by `computeStandings`, by Home's season-series line, and by
  `regularSeasonLines()`, which every aggregate in [`stats.ts`](src/wpbl/stats.ts) runs its
  input through. **`sumBatting` / `sumPitching` / `aggregateBatting` / `aggregatePitching`
  take the schedule as a REQUIRED argument** for that reason: a box-score line carries only a
  `game_id`, so it cannot say for itself whether it belongs in a season total, and an optional
  parameter would make forgetting it silent. Filtering is by the EXCLUDED game ids, never the
  included ones, so a caller holding a partial schedule over-counts instead of rendering an
  empty season. It excludes a game only on positive evidence (`counts_in_standings === false`, or a
  postseason-looking `game_type`) and counts everything it does not recognise. Do not invert it
  into "count only what looks regular": the day the feed renames its game types, that version
  drops every game and renders four clubs at 0-0, which reads as an outage rather than as a
  bug. Wrong by a couple of games is visible and recoverable. Blank is neither.

- **The live poll reads a hand-listed half of `wpbl_games`, and the two halves must
  partition the table.** `LIVE_GAME_COLUMNS` in [`src/wpbl/api.ts`](src/wpbl/api.ts) names
  every column that can change mid-game; the poll merges those over the row it already holds,
  so everything omitted is assumed immutable. Add a volatile column to `wpbl_games` and forget
  this list and nothing breaks: the value simply freezes on screen at whatever it was on first
  paint, for the whole game, with no error. The bulk line reads have the same shape
  (`BATTING_LINE_COLUMNS`, `PITCHING_LINE_COLUMNS`, which are "the type, minus `created_at`"),
  where a missed column means the season aggregates silently cannot see it. `tsc` catches
  none of this.

- **Modules shared with Deno carry `.ts` on their imports.** The recap engine
  ([`recap.ts`](src/wpbl/derive/recap.ts), [`discordRecap.ts`](src/wpbl/derive/discordRecap.ts))
  is loaded by three builds: Vite, the esbuild bundle behind `npm run discord-recaps`, and
  Deno inside `wpbl-ingest`. Deno resolves local specifiers literally, so any *runtime*
  import they add needs the extension (type-only imports are erased and stay
  extensionless). For the same reason they must never import
  [`constants.ts`](src/wpbl/constants.ts), which pulls the team logos in as Vite assets:
  that is why `outsToIp` lives in [`innings.ts`](src/wpbl/innings.ts).
- **Three write paths to the DB, and only three.** The browser writes user rows through RLS
  (events, feedback, picks); everything ingested or derived is written by service-role
  actors, the `wpbl-ingest` edge function and the GitHub Actions `scripts/*.mjs` jobs. The
  browser only reads those. The third is the **Discord bot**
  ([`functions/discord/wpbl.ts`](functions/discord/wpbl.ts)), which holds a service-role key
  for the `/predict` game alone: recording a pick is a write, the predictions tables are
  RLS-on with no policies, and the anon key ships in the client bundle so a pick recorded
  under it could be forged for any Discord user by anyone who opened dev tools. That is the
  whole of the exception. Do not add a fourth, and do not let the bot's key reach anything
  outside `wpbl_predict_*`.
- **`manifest.webmanifest`'s `id` is `/mlb` while `start_url` is `/wpbl`, and that is not a
  bug to fix.** `id` is the installed app's IDENTITY, not a route. Chrome keys an installed
  PWA on it, so "correcting" it does not rename the app, it creates a second unrelated one
  and orphans every existing install, plus (once the Android app ships) the Digital Asset
  Links association built against it. The mismatch is cosmetic and costs nothing; the fix
  costs the installed base. Pinned in `src/__tests__/pwaShell.test.ts`.
- **`public/sw.js` must never cache the app shell.** It caches `offline.html` and three
  images, and serves them only for a navigation that could not reach the network. Widen it
  into a shell cache and the failure is invisible by construction: the app renders fine, it
  is just an old build, for anyone who does not close every tab. Navigations stay
  network-first with nothing written back.
- **`public/icon.svg` is generated**, along with every other published icon, by
  [`scripts/make-brand-icons.py`](scripts/make-brand-icons.py) from `public/logo.png`. A
  hand-edit is lost on the next run. Change the art, rerun the script, commit the lot.
- **`functions/` and `supabase/functions/` are different platforms.** The first is
  Cloudflare Pages Functions, the second is Supabase Deno edge functions.
- **A new Cloudflare Pages Function also needs a route in `public/_routes.json`.** That
  file is an allow-list. Without an entry the function compiles, uploads, deploys, and is
  never called. **It can only narrow, never widen.** Function routing is by file path, so
  `functions/wpbl/index.ts` serves exactly `/wpbl`; adding `/wpbl/*` to `_routes.json` does
  not make it run on `/wpbl/stats`. Covering a subtree takes a catch-all file
  ([`functions/wpbl/[[tab]].ts`](functions/wpbl/%5B%5Btab%5D%5D.ts), which re-exports the
  handler rather than copying it). This is how the player share-card rewrite quietly stopped
  running the day the WPBL tabs became real paths: the page was fine, only the unfurl was
  wrong.
- **`_redirects` may only use 200/301/302/303/307/308, and `wrangler pages dev` will not
  tell you.** Cloudflare validates the file at UPLOAD time and rejects the whole thing for
  anything else, which **fails the build and leaves the previous deploy serving**: the site
  does not break, it silently stops updating, which is the worst shape a failure can take.
  `/*  /404.html  404` did this on Aug 21, 2026 after months of working. No rule is needed
  for 404s anyway: once `public/404.html` exists the platform serves it with a 404 status for
  any unmatched path, and the reason unknown URLs used to answer 200 was only that the file
  did not exist. `src/wpbl/__tests__/routes.test.ts` now pins the allowed statuses.
- **`npx wrangler pages dev dist` is NOT the production runtime.** Production deploys as a
  Worker (the build log says `workers/scripts/fun/versions`). It is still the best local
  check for routing and status codes, but it accepts input the real deploy refuses, so a
  green local run is evidence and not proof. Watch the actual Cloudflare build after a push
  that touches `_redirects`, `_routes.json` or `functions/`.
- **`public/sitemap.xml` is generated.** `npm run sitemap` rebuilds it from the roster (one
  URL per player). A hand-edit is lost on the next run.
- **The one wildcard in `_redirects` is `/wpbl/players/*`,** because the valid slugs live in
  the database. What keeps it from being a soft-404 hole is
  [`functions/wpbl/index.ts`](functions/wpbl/index.ts), which resolves the slug against the
  roster and answers a real 404 for anything that names nobody, *before* the rewrite is
  reached. Cloudflare's `*` matches across slashes, so the same check has to reject
  `/wpbl/players/a/b` too. Remove either and every typo under that directory is an indexable
  page again.
- **A new app route also needs two lines in `public/_redirects`,** and a WPBL tab needs an
  entry in [`src/wpbl/routes.ts`](src/wpbl/routes.ts) and
  [`src/seo.ts`](src/seo.ts) besides. `src/wpbl/__tests__/routes.test.ts` pins all four
  together, because three of the four failures are invisible locally. Otherwise it 404s in
  production while working perfectly in dev. Pages used to serve the SPA shell with a 200 for *any*
  unmatched path, which made every typo on the domain an indexable page: Google found
  `/wpbl),and` from a mangled pasted link and indexed it as a real page of the site. So the
  fallback is inverted. `_redirects` lists the app's routes explicitly (a `200` rewrite plus
  a `301` folding the trailing-slash spelling), and `/*` falls through to a real `404.html`.
  Vite serves the shell for everything, so `npm run dev` will never show you the omission.
  Verify with `npx wrangler pages dev dist` after `npm run build`. Rewrite to `/`, never to
  `/index.html`: Pages canonicalizes the latter with a 308, which silently turns every app
  route into a redirect to the home page.
- **Internal links must be real `<a href>`, never a `Box` with only an `onClick`.** Googlebot
  does not fire click handlers, so an onClick-only control is invisible to it. `/mlb` sat
  undiscovered by Google for months for exactly this reason while `/privacy` and `/terms`,
  which the footer links properly, were found. Use `linkTo()` in
  [`src/App.tsx`](src/App.tsx), which supplies the href and preventDefaults so the SPA still
  handles the navigation, and lets modified clicks through so open-in-new-tab works.

## What it is

Two independent league sections sharing one shell (auth, search, notifications, theme,
units):

- **WPBL** (`/wpbl`, the default): Women's Pro Baseball League. Scoreboard, schedule,
  standings, stats, TrackMan, Game Center, auto recaps, Hall of Firsts, push reminders.
  Mirrored from the league feed into Supabase by the `wpbl-ingest` edge function. The feed
  stops Sep 22, 2026 (regular season ends Sep 6; the postseason runs Sep 9 to Sep 22).
- **MLB** (`/mlb`): deeper and StatsAPI-driven. Game Center, personalized home feed, a
  predictions game with a Wilson-ranked leaderboard and bot rivals, playoff odds, milestone
  watch, streak report cards, Streak Survivor.

Also `/admin` (owner analytics) and small bolted-on tools at `/cups`, `/stopwatch`,
`/poop`, backed by `projects/` and `public/projects/`.

**Stack:** React 18 + TypeScript + Vite + MUI · Supabase (Postgres, Auth, Edge Functions,
pg_cron) · GitHub Actions for cron · installable PWA · Cloudflare Pages at
`sportydolphin.fun`.

## Where to look

- [ARCHITECTURE.md](ARCHITECTURE.md) is the real map: system diagram, routes, DB tables,
  the ingest pipeline, every cron job, edge functions, integrations, config and secrets.
  Its source-of-truth index is at the bottom. **Keep it current** when you add a table,
  workflow, or integration.
- [ROADMAP-WPBL.md](ROADMAP-WPBL.md) for anything under `/wpbl`: season clock, prioritized
  next list, dated log of what shipped. [ROADMAP.md](ROADMAP.md) is the MLB equivalent.
- [README.md](README.md) for quick start and scripts.
- [docs/](docs/): `DISCORD.md` (fan-server board, final-score box scores, highlight reels,
  the `/player` slash command, and which secret store each writer reads),
  `ADMIN_ANALYTICS.md` (**read before touching the `events` table or the `admin_*` RPCs**;
  its security section is the only thing keeping site analytics from being readable by
  every signed-in user), `PLAY_VALIDATION.md`, `COMMONS_PHOTOS.md` (**read before approving an archive
  photo**: what the sync will not do, and why the approval gate is in RLS rather than in the
  query), `PUSH_NOTIFICATIONS.md`, `GOOGLE_TASKS.md`, `feature-requests.md`,
  `BACKLINKS.md` (the SEO work that is not code: who to contact and the drafts to send;
  the site's own markup is done, links are the remaining constraint),
  `ANDROID.md` (the plan of record for shipping this on Google Play as a Trusted Web
  Activity: what is done, what is blocked on a signing key, and the two things that are
  frozen forever the moment the first build reaches Play).

Code: [`src/App.tsx`](src/App.tsx) is the shell, with hand-rolled path routing and no
router lib. [`src/wpbl/`](src/wpbl/) is self-contained with no MLB coupling
(`WpblApp.tsx`, `api.ts`, `SwipeableViews.tsx` are its spine);
[`src/mlb/`](src/mlb/) plus [`src/MlbStats.tsx`](src/MlbStats.tsx) is the other section;
[`src/lib/`](src/lib/) holds the shared client libs;
[`shared/notifications.js`](shared/notifications.js) is one catalog serving both the
in-site bell and the push senders.

## Environment

- **Windows.** PowerShell 5.1 is the primary shell; a Bash tool is also available. Mind the
  syntax differences.
- **Dev:** `npm install && npm run dev` → http://localhost:5173, redirects to `/wpbl`.
  Needs `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`
  for push. Without them the app renders empty states.
- **Tests:** `npm run test` (Vitest), in `src/__tests__/` and `src/**/__tests__`.
- **Cron:** `scripts/*.mjs` are Node jobs on GitHub Actions schedules (table in
  ARCHITECTURE §5), using the service-role key from repo secrets.
- **Edge functions** deploy by hand: `supabase functions deploy <name>`.
- **SEO:** `robots.txt`, `sitemap.xml`, and per-route meta plus JSON-LD via
  [`src/seo.ts`](src/seo.ts), which runs after React mounts and so never reaches an
  unfurler. Shared player links get their card from [`functions/wpbl/`](functions/wpbl/)
  instead, rewriting the tags at the edge; headshots are republished at a stable
  `/portraits/<slug>.webp` by a Vite plugin, since the edge has no copy of the build's
  hashed-asset map. Google Search Console verification was still open as of Aug 18, 2026;
  check before assuming.
