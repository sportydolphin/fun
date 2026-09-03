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
  column. **`is_scoring_play` is not a second opinion on this, it is the same number**: across
  every stored play it is exactly `runs_scored > 0`, so "a home run the feed forgot to flag"
  only ever means "a solo home run". A validator check spent two rewrites finding that out and
  put ten of them in the accepted baseline as real league errors.
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

- **A player's feed id is not the player, and a player's team is a fact about a DATE.** The
  league mints a NEW `player_id` when someone changes club (Diana Ibarra is `moizfkn9…` on New
  York and `27svefz4…` on Los Angeles, both ACTIVE, `career_id` empty on both), so nothing in
  the payload says they are one person. Left alone, the ingest inserted a second Diana Ibarra
  and split her season 8 games to 1, which is not merely a duplicate: the slug rules in
  [`routes.ts`](src/wpbl/routes.ts) correctly decide a shared name is ambiguous, so her
  canonical `/wpbl/players/diana-ibarra` started answering 404 and the Discord bot started
  offering a "did you mean" for someone who exists once. `wpbl_players.api_ids` now holds every
  id a person has held and the resolver matches on any of them. Two consequences to keep:
  **`team_id` on a roster row means "now", never "then"** — a game log, a team page, or a Hall
  of Firsts badge must take the club off the box-score line or the play, both of which carry
  the team that game was played for, or a traded player's July reads as if she spent it
  somewhere she had not arrived yet. And **the ingest only ever moves a player forward in
  time**, guarded by `team_as_of`: it re-reads old box scores constantly (`force`, the
  TrackMan backfill, mode `all`), every one of those is honest evidence of where she was
  *then*, and without the guard her club is whichever game the loop happened to touch last.
  `wpbl_merge_players(keep, dupe)` is the tool for the duplicates no rule can catch.
- **The league feed's `/games` list caps at 50 and says nothing about it.** `GET /v1/games`
  returns a short array beside a `count` field holding the real total, exactly like the
  PostgREST cap above and just as quietly. The season crossed 50 on Aug 30, 2026 (56 records:
  the timezone twins mean rows grow at roughly twice the schedule) and the six it withheld
  included **the only copy of that night's game the league ever finished**, SF 11-9 NY with a
  full line score. `wpbl-ingest` logged `ok: true`, `error_count: 0` every two minutes right
  through it, because a truncated list is a perfectly valid list and every row in it ingested
  cleanly. The game simply did not exist to us, and the site told readers the league had gone
  quiet. **Always pass `?limit=`, and compare the row count against `count` before proceeding.**
  A short read must ERROR rather than degrade: the phantom-suppression pass reasons about which
  copies of a matchup exist, so a missing real copy makes a played game look like an unplayed
  phantom next to nothing, and phantoms get their rows DELETED.

- **A game goes read-only once it is stored final, and the league keeps editing it.** The
  every-two-minutes pass is `mode: "active"` with no `force`, so it never re-reads a final; the
  only gate that reopens one is the late-TrackMan backfill, which covers finals under 21 days old
  that still have zero tracking rows. Every correction that has reached us therefore arrived as a
  SIDE EFFECT of the league's pitch tracking being stalled, and stops the day it resumes. The
  league revises box scores long after the fact (an Aug 3 game last revised Aug 21, an Aug 8 game
  Aug 24), and **the `/games` list will not tell you**: its `updated_at` freezes at `completed_at`
  on a completed game while the boxscore's own `source_updated_at` marches on, so the only way to
  learn a game changed is to fetch the boxscore and compare. Worse, a pure SCORE correction does
  propagate on its own, because the list carries `presto_data.score` and the ingest folds it onto
  the row every pass: the scoreboard moves and the box score under it does not, so the game page
  contradicts itself rather than simply going stale.
  [`scripts/check-wpbl-drift.mjs`](scripts/check-wpbl-drift.mjs) is what closes this, nightly.
- **The live poll reads a hand-listed half of `wpbl_games`, and the two halves must
  partition the table.** `LIVE_GAME_COLUMNS` in [`src/wpbl/api.ts`](src/wpbl/api.ts) names
  every column that can change mid-game; the poll merges those over the row it already holds,
  so everything omitted is assumed immutable. Add a volatile column to `wpbl_games` and forget
  this list and nothing breaks: the value simply freezes on screen at whatever it was on first
  paint, for the whole game, with no error. The bulk line reads have the same shape
  (`BATTING_LINE_COLUMNS`, `PITCHING_LINE_COLUMNS`, which are "the type, minus `created_at`"),
  where a missed column means the season aggregates silently cannot see it. `tsc` catches
  none of this.

- **The rate-title bar is PLATE APPEARANCES, and a new leaderboard that gates on `ab`
  will look completely right.** `wpblQualifiers` returns `minPa` (MLB's 3.1 per team game
  scaled to seven innings, so 2.4, floor 6) alongside `minOuts`, and every gate runs through
  `plateAppearances()` in [`stats.ts`](src/wpbl/stats.ts), which is also the only correct PA
  sum: `sh` is on the feed's line and is deliberately NOT in OBP's denominator, so anything
  copied from that denominator drops it. The bar was at-bats until Aug 27, 2026, which gated
  a stat half made of OBP on a count that throws away every walk, and quietly kept the
  league's most patient hitters off the OPS board. `__tests__/qualifiers.test.ts` pins the
  constants; nothing can pin a NEW call site that reaches for `t.ab` instead.

- **`era` and `k9` are stored on whatever basis the LEAGUE publishes, and that changed once.**
  It is per SEVEN as of Sep 3, 2026; it was per 9 before, and this file said so for months. The
  one definition is `ERA_BASIS_CANONICAL` in [`src/wpbl/stats.ts`](src/wpbl/stats.ts), and it
  feeds both the computation and the rescale, which is why the switch was a single line. A reader
  who prefers the other convention flips a setting and the app rescales at DISPLAY time
  (`scaleToBasis`), which is safe only because both stats are linear in the multiplier, so no
  sort, rank or comparison moves. **Do not put a literal 7 or 9 into an aggregate.** The OG share
  cards and the Discord `/player` card read the stored number and deliberately have no parameter
  to opt in, so a hardcoded denominator silently republishes figures that disagree with the
  league, to people who never opened the site. Two functions each holding their own basis is the
  other failure, where a leaderboard and the player page it opens disagree and neither is wrong.
  `__tests__/eraBasis.test.ts` pins both. **Nothing here can detect another switch**: the drift
  checker compares plays against the feed, and the feed publishes WHIP but no ERA at all, so the
  Sep 2026 change surfaced only because a reader mentioned it. If the numbers are ever disputed,
  check the league's own stat page against a pitcher with a lot of innings, where the two bases
  are far apart.

- **`/wpbl` renders at a DESKTOP SCALE in CSS, not under a `zoom`, and there are two scales.**
  Until Aug 31, 2026 the whole app sat inside `zoom: 1.4` at `md`, which split it into two
  pixel units nothing in the type system tells apart and cost five shipped bugs. `/wpbl` is
  out (`/mlb` is not yet: it still runs `DESKTOP_ZOOM`, which is why the scale is keyed on
  `:root[data-app-scale='wpbl']`, set per route in App.tsx). **Never put both on one element**,
  a root font-size ramp on top of a zoom compounds. The two scales, in `styles.css`:
  **`--app-type`** is spent on the root font size, so it moves every `rem` (the type, and the
  boxes that reserve room for type) and it MULTIPLIES with `--sd-text-scale`, the reader's
  Large text setting. **`--app-chrome`** is spent on px that is not type: MUI's whole `spacing`
  scale, `TeamBadge` / `PlayerPortrait`, the toolbar logo, and every structural length via
  `chromePx()` in [`ui.tsx`](src/wpbl/ui.tsx). It deliberately EXCLUDES the text scale, because
  a tap target that grows with the reader's text size is a worse tap target. `AccessibilityContext`
  must keep PUBLISHING `--sd-text-scale` rather than setting `font-size` itself: an inline style
  beats the stylesheet, so setting it there gives a Large-text reader the MOBILE type size on a
  desktop. See item 0 in [ROADMAP-WPBL.md](ROADMAP-WPBL.md).

- **The shared toolbar has its OWN scale, and it is a `zoom`, deliberately.** The bar is shared
  by `/wpbl` and `/mlb`, and those two are scaled by different means, so neither section's
  mechanism can reach it without reaching the other section too. Everything above lives on
  `:root`, and `/mlb` has 212 raw px dimensions that read no variable, so scaling the root to
  fix the bar would leave all of those adrift. `--app-shell` in `styles.css` therefore scales
  the `AppBar` on its own, and applies **only where the root is not already scaling it**
  (`:root[data-shell-scale]:not([data-app-scale])`); applied on both, the bar scaled twice and
  the wordmark came out half again too big. `zoom` is right here for the reasons it was wrong
  in a section: what made it harmful there was 51 rect and scroll call sites and 37 breakpoints
  reading a viewport the layout no longer matched, and a chrome bar has neither. It has three
  lengths that can tell: the `70vh` caps on the panels hanging off it, which divide it back out.
  `--app-header-h` needs nothing, since it publishes a rect (on-screen pixels) and is spent
  outside the bar where those are the same pixels. The point of all of it is that the bar
  measures the same on both sections, so switching moves nothing above the content.

- **A fixed px size in `/wpbl` is one of three things, and only two of them scale.** Ordinary
  CSS has no equivalent of `zoom`, so every length now says what it is. A box **reserving room
  for a string or a number** goes in `rem` (a rank column, a club-name column, the scoreboard
  chip): it must grow with the type or it clips, and this is the one that bites, because a box
  sized in px around a font sized in rem looks perfectly right until someone enlarges the text.
  **Structure** goes through `chromePx()` (rail widths, a dialog's cap, a card's flex basis):
  left raw it silently shrinks 40% against the type inside it, which is how the player dialog
  started wrapping a name onto two lines. **Ornament** stays raw px: hairline borders, the 6px
  live dot, a 4px scrollbar. The failure is silent in every direction, and `tsc` sees none of
  it: the only check that works is opening the page and looking for a box whose content is
  wider than it is, at more than one text scale. **Which is why anything behind the experiments
  flag is exempt from that check by construction, and has to be swept separately.** The seeding
  race sat out the whole rebuild for exactly this reason and carried four of these bugs into
  September; turning the flag on and looking is the only way to find the next one.

- **`--app-header-h` / `--wpbl-nav-h` are the pinned chrome's height, in plain screen pixels.**
  Both are spent as a sticky `top`. Use the **rect**, never `offsetHeight`: it rounds to a whole
  pixel, and a bar 43.67px tall publishing itself as 44 leaves a sub-pixel crack under it that
  the page scrolls through, one device pixel of a stats row at a time. Consumers add them and
  spend the sum (`PINNED_CHROME` in [`StatsView.tsx`](src/wpbl/StatsView.tsx)); exactly one is
  non-zero at a time, since the toolbar is sticky only on desktop and the section nav only on
  mobile. This has regressed three times, once in each direction, every time by a scale being
  applied at one end of the sum and not the other.

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
  that touches `_redirects`, `_routes.json` or `functions/`, **and watch the one on `main`**:
  the `Workers Builds: fun` check on a branch PR has been red on every PR observed (a
  docs-only one in July, another on Aug 27), completing in the same second it starts, against
  the *production* Worker service, while `Cloudflare Pages` passes on the same commit and
  deploys a preview. A red Workers check on a PR is therefore evidence of nothing, which is
  the more expensive half: it trains you to ignore the one signal this rule is asking you to
  read.
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
  Run value (the league's own run-expectancy table, built from our own plays).
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
  `ANDROID.md` (shipping this on Google Play as a Trusted Web Activity. A signed build
  exists and works on a device; what is left is Play process. **Read before touching
  `manifest.webmanifest`, `sw.js` or `assetlinks.json`**: it carries the Windows build traps,
  why `manifest.id` must not be corrected, and the things frozen forever once the first build
  reaches Play),
  `IOS.md` (the App Store equivalent, and a much larger project rather than a second export
  target: iOS has no TWA, so Capacitor means rebuilding Google sign-in, adding Sign in with
  Apple, adding APNs alongside Web Push, and building something native enough to survive
  review guideline 4.2. **Read before touching
  `public/.well-known/apple-app-site-association` or its `_headers` rule**, which is live
  ahead of the app with a placeholder Team ID).

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
  instead, rewriting the tags at the edge; the per-player 1200x630 art it points at is
  generated by [`scripts/make-wpbl-share-cards.py`](scripts/make-wpbl-share-cards.py) and
  republished at a stable `/cards/<slug>.webp` by a Vite plugin, since the edge has no copy
  of the build's hashed-asset map. **og:image must stay 1200x630**: Bluesky reads `og:`
  only, ignores the `twitter:card` hint asking for a square thumbnail, and centre-crops
  whatever it gets to one 1.91:1 band. **Search Console is verified**, and Googlebot renders the JS completely,
  so pre-rendering is settled as not needed. The remaining constraint is not code: near-zero
  inbound links, worked from [`docs/BACKLINKS.md`](docs/BACKLINKS.md).
