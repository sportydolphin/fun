# WPBL Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> **The order across every roadmap is [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md)** (Oct 16, 2026).
> This file is the detail and the reasoning behind its items.
> Companion doc: **[ROADMAP.md](ROADMAP.md)**: the MLB section, which runs on its own
> calendar and its own priorities. Nothing here blocks anything there.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last updated: **Oct 10, 2026**, with the audit (CI, crons, dependencies, the database and two
> weeks of `events`): a site-wide ops list, and three items added to the winter order.
> Last reviewed for handoff: **Oct 2, 2026** (doc accuracy only; priorities unchanged since Sep 27).
> Last checked against production: **Sep 24, 2026**. The season is over (40 finals, the last on
> Sep 22), the feed has gone quiet, and every surface below is in its offseason shape.
> Last realigned: **Sep 24, 2026**, for the offseason (see the realignment log). The experiments
> flag now hides exactly one thing, the steal card on Run value; the mobile bottom nav shipped to
> every phone on Sep 14, so the flag notes that follow are history.
> Before that **Sep 1, 2026**, when the desktop rebuild (#0) finished and shipped as v1.58.0,
> which empties the top of the list five days before the regular season ends. Before that
> **Aug 20, 2026**, against traffic data for the first time (see "What the traffic says"), revised
> again later the same day when 1b turned out not to be blocked (see its entry). The bracket and
> the seeding race are both out from behind the experiments flag now and live for everyone (the
> race came off on Sep 1, v1.59.0), which leaves the flag holding two things: the steal card on
> Run value, and the mobile bottom nav (the Findings board was folded into Run value on Sep 10,
> v1.80.0, and the steal card went with it).
> Before that Aug 17, 2026. Teams tab, Settings and an accessibility pass shipped
> as v1.45.0 (see the shipped log); favorite-team + theming remains built and parked (see
> "Parked, with reasons"); before that, split out of `ROADMAP.md` and reprioritized around
> the season clock (see the realignment log at the end).

---

## The clock: read this before prioritizing anything

**The 2026 season is over.** The regular season ended Sep 6, the final on Sep 22, and the league's
feed has nothing new until spring 2027 (no date announced). The ingest has dropped to its
off-season cadence and turns itself back on as a published 2027 schedule approaches
(`wpbl_ingest_due()`), so nobody has to remember to reschedule it. The whole season is exported
to the archive in git as of the final game (40 finals, 6,983 rows).

That changes how every item is graded. The September test was **season-locked vs durable**;
season-locked work has now missed its window and waits for 2027, and it should be built in the
spring against the new feed rather than now against a guess of it. **Everything built this winter
is durable or it is nothing**: the question for each item is whether it is a reason to open
`/wpbl` in November.

Dated things left:

- ~~**Oct 1, 2026**: the fan-award results come off Home and the season card goes full width.~~ ✅
  *Happens on its own at `AWARDS_RESULTS_UNTIL` in `awards.ts`; nothing to do.*
- **Spring 2027, before the first game: rethink the Bluesky integrations.** What runs today is
  two posters (a recap with a box-score image for every final, a "starting soon" reminder before
  each first pitch) and the mention watcher's search, which since Sep 27, 2026 reports only posts
  naming sportydolphin (`LEAGUE_LEADS` in `scripts/watch-wpbl-mentions.mjs`). Decide what the
  account is for before the posters wake up with the season: whether league talk should come
  back into the watcher, and what beyond recaps and reminders is worth posting (the offseason
  visuals, player share cards, milestone posts, a custom feed of WPBL posts, replying by hand to
  what the watcher finds). Nothing measures the account yet, so start by reading what the season's
  posts actually drew.
- **Spring 2027, before the first game**: re-verify every feed assumption in CLAUDE.md's Traps
  before trusting a season total. The league minted new team and player ids for the postseason,
  changed the ERA basis mid-season and caps `/games` silently; any of those can change again over
  a winter. `wpbl-postseason-check` still only warns when its secrets are missing, and should fail
  the way the archive and sitemap jobs now do before it is relied on again.

*(The September clock, which counted down to Sep 6 and Sep 22 and graded the list through the
season, is retired; it is in git history.)*

---

## Where the section stands

**Live surfaces, in their offseason shape (Sep 24, 2026):** Home (the champion banner, the season
card, fan-award results until Oct 1, a fan-photo gallery card, the latest post from either writer,
the bracket without its odds, leaders, standings) · Schedule · Standings · Stats, one row of board
tabs (Leaders, Players, Teams, Bests, Find, Analysis, the last holding Run value, Pitch by pitch,
Draft and Tracked) over one Hitting / Pitching / Fielding switch · Teams and team pages · Game
Center (recap with a win probability graph, box score, play-by-play with the situation after every
play with a Clip button on the plays the league filmed, pitch data, story and recap links from
outside writers, the game's videos and clips) · Player pages at
`/wpbl/players/<slug>` with a regular / playoffs / both scope, a fan-photo strip and the player's
clips, opening as an
overlay over whatever page they were tapped on · standalone pages off the More menu and the footer
(one list, [`morePages.ts`](src/wpbl/morePages.ts)): `/wpbl/season` (the recap: final standings,
the standings race, runs by inning, the postseason and its best performances, a Watch card),
`/wpbl/reading` (both writers' posts, see [docs/READING.md](docs/READING.md)), `/wpbl/watch`
(every game's highlights, condensed game and broadcast, the league's Shorts, the podcast),
`/wpbl/photos`
(fans' photos and the Commons archive), `/wpbl/league` (the primer only), Scorigami, Compare, the
players index, the glossary, and Data sources · search · short share links (`/p`, `/g`) · push
reminders · a fan Discord integration (board, final-score box scores, highlight reels and Shorts,
`/player` with postseason stats) · Bluesky recaps and game-start posts.

**Data:** the `wpbl-ingest` edge function mirrors the league's public feed
(`stats.womensprobaseballleague.com/v1`) into Supabase on a 2-minute cron: games,
box-score lines, play-by-play, TrackMan pitch tracking, ingest-health rows. Public-read
RLS, service-role writes. Birth dates come from a community sheet
(`scripts/ingest-wpbl-birthdays.mjs`), not the feed. The league's scoring has errors in it and
the league is not reachable to fix them at source, so a nightly job checks the play-by-play
against the rules of baseball and our own corrections are applied as a read-time overlay
(`wpbl_play_corrections`), never written into the mirror.

**What it does NOT have:** baserunning or wins added on the player card (both are on Run value
since Oct 11, and the MVP race deliberately still prices only the plate and the mound), and a
reason to come back more than once a month
between now and spring. Reading and the photo gallery are the only surfaces that still change in
the offseason, and both change only when somebody else publishes.

---

## What the traffic says (Aug 20, 2026)

Read from `events` over the 14 days to Aug 19, which is the first time this list has been
prioritized against measurement rather than judgment. Counting rules in
[`docs/ADMIN_ANALYTICS.md`](docs/ADMIN_ANALYTICS.md): "browsers" are localStorage ids, not people.

- **The section is the site.** 18,213 WPBL events across 2,036 browsers, against 768 MLB
  events across 33. Whatever the next three weeks are spent on, it is not `/mlb`.
- **Growth is real and accelerating.** Aug 19 was the biggest day on record at 548 browsers,
  against 55 to 76 a day in the first week of measurement.
- **Opening a player page is the retention event.** Return rate by what a browser did on
  its first day: neither Game Center nor a player page, 7.8% (n=1,354) · Game Center only,
  35.7% (n=476) · **both, 76.5% (n=162)**. Correlation, not proof of cause, but a tenfold
  gradient is not noise, and nothing on the list was aimed at it.
- **Home is where they are lost.** 670 of 2,037 browsers fired exactly one event, and for
  554 of them that event was the Discord card's own impression. They landed, the card
  rendered, they left. Note the card was retired on Aug 19, so that bounce is now
  **unmeasured**: anything new on Home should carry its own impression event.
- **Retention is falling as reach grows.** Aug 5-9 cohorts returned at 41-54%; Aug 13-18
  cohorts at 12-20%. Acquisition is outrunning conversion, which is what strangers off a
  search result look like.
- **They come for the numbers.** First tab a session opens: stats 206, schedule 196,
  standings 122, teams 62. Stats is the most-used surface in the section.
- **Swipe earned its keep.** 3,020 pill taps to 1,141 swipes: 27% of all tab changes.
- **Teams landed.** 703 browsers saw the "new" dot, 139 tapped it, a 20% click-through, and
  the tab now runs 588 views from a standing start.
- **Discord is the durable channel; push is not.** 137 of 1,780 browsers who saw the invite
  joined (7.7%). Against that: 12 push subscriptions across 11 users, and one per-game
  reminder row in the whole table.
- **The media shelf is seen and not used.** 575 browsers saw Reading, 39 clicked through, 3
  opened a photo. Whatever it is, it is not the retention lever.

**What this reorders.** Daily standouts (#5) and the seeding race (#1c) move up, not because
they are cheap but because they are the only two items that put a player-page entry point on
the screen where the audience is currently lost. Anything that makes a name tappable is worth
more than it looks. *(#5 was dropped on Sep 1 as a card the section already has. The reasoning
in this paragraph survived it and became #5b, which is the same aim at a fraction of the cost:
Home's one player name currently opens a box score.)* The primer (#4) and SEO (#3) hold, aimed at a cold audience returning at
12 to 20%.

---

## The Oct 10, 2026 audit ⚙️

Read from CI, the cron runs, `npm outdated`, the database and the `events` table over the 14 days to
Oct 10. The ops list is site-wide: it lives here because neither roadmap owns the shell, and
[ROADMAP.md](ROADMAP.md) points here rather than copying it.

**Traffic.** WPBL sessions a week: 1,544 (week of Sep 7), 1,408, 973, 508, **350** (week of
Oct 5). MLB rose to 178 in the week of Sep 28 on its own postseason, then 71. WPBL pages by
sessions over the 14 days: Home 650, Stats 179, players 155, games 104, **Compare 76**, Teams 57,
Schedule 43, the season recap 38. Compare at fifth, with no work since it shipped, is the one
surprise; it is item 6 of the winter order now. Every figure here carries the dev-server rows
item 2 describes, which is why that item comes first.

**Ops, in order:**

1. ✅ **RetroWPBL moved its data, and three jobs went red together** (fixed Oct 10). On Oct 9 the
   repo took Retrosheet's download layout and put every folder under `alldata/`, so
   `events/2026SFF.EVW` answered 404 and `wpbl-retro-sync`, `wpbl-play-gap-fill` and
   `wpbl-retro-stats-check` failed every run after. `RAW` in `check-wpbl-retro-stats.mjs` (which
   the gap fill imports) and the sync's own copy now point at `alldata/`; all three pass locally,
   and the stats check is clean against its baseline.
2. ✅ **Keep the dev server out of `events`** (the gate and the build tag shipped Oct 10; the
   triage below is open). `track()` refused a test run but not `npm run dev`,
   which talks to the production project, so every local session writes real rows. 234 of the 286
   `app_error` rows in the 14 days were HMR crashes against `localhost:5173` (`useShellZ is not
   defined`, "doesn't provide an export named"), which buries Site health on `/admin` and inflates
   every session count. Now `silenced()` in `analytics.ts` refuses a DEV build (opt back in with
   `localStorage.sdDevTrack = '1'`), and `app_error` carries `build`, the entry script's name.
   **Open:** triage what is left once a week of tagged rows has landed (a row with a `build` is a
   reader's), which looks real but could not be told from dev before:
   "Rendered more hooks than during the previous render" (`where: app`, a conditional hook), a
   lazy import resolving to `undefined` (`$._result is undefined`, 8 rows), `seasonStat.volume.toFixed
   is not a function`, `onPage is not a function`, and a temporal-dead-zone read of `desktopNow`.
   **Triaged Oct 20:** a week of tagged rows held 5 reader crashes in 5 sessions, every one the lazy
   import resolving to `undefined`, and the other four suspects never appeared (they were dev). It
   was our own `vite:preloadError` listener: canceling the event makes Vite resolve the import
   with `undefined`, so `lazy()` threw in the second before the reload landed (each session then
   logged a clean `chunk_reload`). The boundary now asks `reloadUnderway()` and shows "Loading the
   latest version" instead of reporting a crash.
3. ✅ **Field layout shift is poor on MLB desktop and middling everywhere else** (the attribution
   shipped Oct 11; the fixes are open). `web_vitals` p75 over the 14 days (production builds only,
   so this one is not polluted): WPBL 0.149 on a phone and 0.154 on a desktop, MLB 0.182 and
   **0.270**, where Google's lines are 0.1 good and 0.25 poor. The sweep's baseline is empty because
   it measures the load; the field metric is the worst burst across the whole visit, so these
   shifts come after first paint: a tab switch, a sheet opening, a card arriving late. Every report
   now names its largest shift (the element, the heading of its box, and the route the reader was
   on when it moved), and Page speed on `/admin` ranks them. **Open:** read that list once a week
   of reports has landed and fix the top few. 70 loads in the 14 days were over 0.1, so a week is
   about 35 named ones.
4. ✅ **Database headroom** (Oct 11). 332 MB by then, not 254: `mlb_batting_lines` had reached
   100 MB and `mlb_pitching_lines` 37 MB. `events` now keeps 90 days of raw rows, each UTC day rolled
   into `events_daily` first (the first delete is due Nov 3), and pg_cron forgets runs older than a
   week, which took `cron.job_run_details` from 112k rows to 15k and, after one VACUUM FULL by hand,
   from 49 MB to 4.5 MB (the database to 305 MB). Both on pg_cron, in
   `20261011034522_events_rollup_and_retention.sql`. The plan's limit is not readable from the CLI;
   if it is the free tier's 500 MB, the MLB line tables are now the thing to watch before the plays
   mirror, not analytics. `events_test` (9 MB) is the test-run quarantine and stays.
5. ✅ **Actions off Node 20** (Oct 11). `checkout`, `setup-node` and `upload-artifact` moved from
   v4 to v7, their Node 24 majors, in all 38 workflows. `daily-bots.yml` also ran its own scripts on
   Node 20, past end of life since April; it is on 22 with everything else. The deploy-key pushes
   (sitemap, archive, feature requests) are the part CI cannot exercise: watch their next runs.
6. **Dependencies.** ✅ **Done Oct 13.** Patch and minor as one pull request (#75), then every major
   one commit at a time: React 19, MUI 9, Vite 8 with plugin-react 6 and esbuild 0.28, ESLint 10
   with react-hooks 7 and globals 17, TypeScript 7, jsdom 29, jest-dom 7, web-vitals 6. Three
   things were left as decisions rather than finished:
   - **Two TypeScripts.** The typecheck runs 7 (2s against 13); `typescript` stays at 6.0 because
     typescript-eslint parses through the JS API that 7 does not have. See docs/CI.md.
   - **An npm override for jsx-a11y**, whose peer range stops at ESLint 9. Drop it when a release
     declares 10.
   - **react-hooks 7 reports 314 findings under its recommended set**, almost all React Compiler
     readiness (138 refs read during render, 117 setState in an effect). Only the two rules the
     lint already named are on. The one real defect among them (components declared inside a
     parent, remounting every render) is fixed. Turning the rest on is its own sweep, and only
     worth it if the React Compiler is adopted.
   Vite 8 also splits the entry into about 60 preloaded chunks where Rollup made one, about 5%
   more initial JavaScript; left at the default, since hand-written chunk groups once blanked the
   page.
7. **Rehearse the spring.** Replay the archived 2026 feed through `wpbl-ingest` into a scratch
   schema and diff it against the mirror, so the feed re-verification on the clock above is a run
   rather than a reading of CLAUDE.md. Same item as the clock's: make `wpbl-postseason-check` fail
   on missing secrets.
8. **Open data, and something to embed** 🎯. A `/wpbl/data` page offering the 2026 season as CSV
   (and Retrosheet-style event files where RetroWPBL's permission covers it), credited, and an
   embeddable standings and box-score widget for the two writers. Links are the brake on search
   (#3), and a dataset and a widget are the two things other sites link to without being asked.
9. **Google Play.** A signed build works on a device; what is left is Play's own process
   ([docs/ANDROID.md](docs/ANDROID.md)).

---

## Priorities (set Oct 12, 2026)

*Superseded Oct 16, 2026 by [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md), which merges this
list with MLB, the World Cup, the UI overhaul and photo tagging. Kept for the reasoning.*

Site-wide, both sections. ROADMAP.md points here. Everything in P0 to P2 lands well before the 2027
WPBL season.

**The live order is on `/admin` → Roadmap** (the `roadmap_items` table, owner only), from Oct 13,
2026: add, reprioritize, reorder, mark done and delete there, without a commit. It was seeded with
this section as it stood that day plus the engineering backlog below. This section is the snapshot
and the reasoning; where the two disagree, `/admin` is the order.

**Engineering backlog (added Oct 13, 2026).** Tiered on `/admin`; the reasons in brief:
- *P2, spring readiness.* ~~A feed contract in `wpbl-ingest` (valibot or zod), so a renamed
  `game_type`, a missing `completed_at` or a short `/games` list throws instead of logging
  `ok: true`. `summary.errors` meaning failure, plus a freshness alarm that DMs the owner on
  Discord for a scheduled game past first pitch with no live row (`admin-health-alert` already
  pushes on both, so this is the second channel). A column-partition test from
  `supabase gen types` asserting `LIVE_GAME_COLUMNS` and the immutable list cover exactly
  `wpbl_games`, and the same for the line column lists, which turns that trap into a CI failure.~~
  ✅ **done Oct 17, 2026**, three ways different from the plan. The contract (`feed-contract.ts`)
  reports a break into `summary.errors` and keeps ingesting rather than throwing, because a renamed
  `game_type` breaks every row and throwing would stop the mirror; only a list with no `count`
  stops the pass. The Discord channel is the ops webhook (`DISCORD_ALERTS_WEBHOOK_URL`), not a DM,
  since no owner DM plumbing exists; it carries every health page, the never-started alarm
  included. The partition test replays the migrations rather than `supabase gen types`, so CI needs
  no database; it found `tracking_checked_at` in neither list (ingest-only, now named as such).
  Deployed Oct 20, 2026; the first run under it was clean (`ok: true`, 40 games, no errors).
- *P2, cheap now.* Freeze past seasons as static JSON (R2 or `/data/2026/*.json`, immutable
  cache), which also becomes the open-data download. A `size-limit` bundle budget in CI. `knip`
  for dead exports and files.
- *P3.* Prefetch on link hover or visibility. Archive old MLB line tables to R2 or Parquet before
  the 500 MB ceiling. Replace `html2canvas` (unmaintained) with `modern-screenshot` or
  `html-to-image`. `@tanstack/react-virtual` for the stats table and Watch once two seasons double
  the rows. `fast-check` property tests for `derive/` (WAR sums, `runsOnPlay`, base-state
  transitions). A DuckDB-WASM SQL sandbox on the open-data page, over the frozen season files.

**P0**
- **Multiple seasons** (✅ built Oct 13; the spring leftovers are below). Every WPBL surface assumes one season: year menus, career totals,
  standings, the boards, slugs, the archive. 2027 breaks all of them on its first game. Build it
  this winter with the spring rehearsal (ops item 7) as its test.
  **Built Oct 13** (see the trap in CLAUDE.md): the season on screen (`SeasonContext.tsx`, the
  newest year with a final), `?season=` and a year menu on Standings, Stats, Teams, club pages and
  the series pages, every board and page cut to one year, Home and previews pinned to the current
  season, a Career option on the player card, one recap per year at `/wpbl/season/2026` (the bare
  URL is the latest finished one), year-aware titles and canonicals, the share and Discord cards
  and the run-environment job on the current season, and a dev switch that clones 2026 into a
  fake 2027. **Finished the same day:** the archive writes one `archive/wpbl-<year>/` per season
  (rows filed by their game's year) and `archive/wpbl/` for the clubs, players and links; Compare
  has the year menu, on the address like the series pages; the Home gallery card is "Gallery",
  since it samples every year; and the offseason skeleton ends on the next Opening Day, which the
  loaded Home remembers from the schedule (`offseasonCalendar.ts`), rather than running until
  `POSTSEASON_SCHEDULE` is replaced. **Left for spring:** `POSTSEASON_SCHEDULE`, `PICKEM_SEASON`
  and the award constants are 2026's and wait for the league's 2027 calendar (a first visit before
  then still guesses the offseason frame for one load); the rehearsal (ops item 7) is the real test.

**P1**
- **The worst layout shifts** (ops item 3). Started Oct 12 from the field reports, by path: the
  WPBL desktop panel, `/wpbl/stats` on a desktop, the WPBL to MLB switch on a phone, and MLB Home
  on a desktop. Reproduced with Playwright at 4x CPU throttle, clicking and scrolling, which is
  what the sweep does not do. **Fixed Oct 12:** a cold WPBL player or game address drew Home's
  skeleton, then the page at another width (now the page's own frame from the first frame); the
  photo, clip and reading blocks under a player landed before the stats and were pushed off the
  screen; the honors row grew the band late; the season line dropped its rank row between two
  reads; the win probability chart had a `null` fallback; MLB's bracket skeleton held four series
  in the LCS. Cold player pages went from 0.10 to 0.23 down to about 0.02, game pages 0.09 to
  0.01, the phone switch to MLB 0.11 to 0.03. **Read Oct 20** (a quiet week: 32 reports): WPBL's
  p75 is 0.013 on a phone and on a desktop, and no WPBL load passed 0.1, so `/wpbl/stats` needs
  nothing. The one offender was the MLB player page: a cold address drew the empty search view,
  then a spinner the contract and links drew under, then the card landed above them (0.39 on a
  phone, 0.31 on a desktop). **Fixed Oct 20:** the card draws from the address's id at once, its
  loading state is the card drawn empty, and the player pages are in the sweep (about 0.03 now).
- **Google Play release** (ops item 9). Close; only Play's process is left.
- ~~Wins added and baserunning on the player card and Compare (item 8 below)~~ ✅ done Oct 15, v1.165.0.
- ~~Dependencies (ops item 6)~~ ✅ done Oct 13, patch, minor and every major.
- Crash triage (ops item 2), once a week of tagged rows is in.

**P2**
- **iOS** ([docs/IOS.md](docs/IOS.md)): a much bigger build than Play, done before the season.
- Spring readiness: the feed rehearsal, `wpbl-postseason-check` failing on missing secrets, the
  Traps re-verified, the Bluesky rethink.

**P3**
- `/wpbl/data` and the embeddable widget (ops item 8).
- MLB plays and pitches. **None are stored yet** (checked Oct 12): the mirror is box-score lines
  only, 2000 to 2026, about 196 MB of a 344 MB database. Mirror 2026 and measure before any backfill.
- MLB Draft board, the Visuals list, the data-mining list, portrait rights.

**Parked:** Call the Play, pick'em (2027 Opening Day), favorite-team theming, "This day in the
inaugural season" (Aug 2027), rolling form, WPBL streaks and milestones.

## Next: in priority order

**The winter order below is finished (Oct 16, 2026).** Items 2, 3, 6, 7 and 8 shipped by Oct 15;
Call the Play is parked. What comes next is in [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md). The crash triage (ops item 2) and the
layout-shift fixes (ops item 3) wait for about a week of reports, around Oct 18.

**The winter order, set Sep 27, 2026.** Every season-locked item below has shipped or missed its
window. The one problem left is the one "Where the section stands" names: nothing gives a reader a
reason to come back more than once a month until spring. So the order is by that, and by cost:

1. ⏸ **Call the Play: deferred to much later (Oct 11).** The owner does not rate it as it stands;
   the build is parked in `git stash` ("Call the Play (daily play predictor), parked 2026-09-28").
   Do not pick it up from this list without asking. The original case for it, kept for the record:
   **Call the Play, on the site** (data-mining list). The engine, [`derive/trivia.ts`](src/wpbl/derive/trivia.ts),
   is written, pure and tested, and nothing calls it: not the site, and not Discord either, despite
   what its header says. A date-seeded daily question with a shareable result is the only item on
   this page that gives a reason to come back TOMORROW, and about 980 usable plate appearances is
   years of them. Aimed straight at the gap. Post the day's question to the fan Discord as well
   (Oct 10): that server is the one channel the traffic says is durable, and a post there costs a
   reader nothing to answer.
2. ✅ **The wildest games of 2026** (shipped Oct 11 as a section of `/wpbl/season`: the six games
   whose win probability moved most, each with its line from the winner's side, its lead changes,
   ties and extra innings, and a link into Game Center. Postseason included, since it ranks games
   rather than totalling a season; a game whose play log stops before the seventh is left out
   rather than ranked low. `wildestGames` in `derive/winProbability.ts`. The top game, Aug 9 at
   Boston, never changed leader, which is why ties are counted beside lead changes.) The original
   item: **The wildest games of 2026** (#6's open half, and the Game quilt under Visuals). `excitement`
   is computed on every game and read only by the awards shortlist. A ranked list, or the quilt, on
   `/wpbl/season`, every entry a link into Game Center, which is the other half of the retention
   gradient. Cheap, and it doubles as an Offseason Visual.
3. ✅ **The six season-series pages** (shipped Oct 11, v1.156.0, see the log). The original item: (data-mining list). Indexable pages from data already held, for
   a section whose constraint is search. Who owns whom shipped Sep 28 as `/wpbl/matchups` (see the
   log).
4. ~~**Decide Road to Springfield.**~~ ❌ *Dropped Sep 30: an AI-made hometown map and share
   videos is work that belongs to a visual artist or motion designer, and the site should not be
   standing in for one. Do not rebuild it.*
5. ~~**Fielding columns in the Stats tab** (#7).~~ ✅ *Shipped Oct 9 as a Fielding board (v1.130.0,
   see the log).*
6. ✅ **A Compare pair that unfurls as itself** (shipped Oct 11). A shared pair now carries both
   names, a season line for each by the player card's role rule (`wpblCompareCard` in
   `ogCard.ts`), the alphabetical canonical as og:url, and club-pair art. The art is per pair of
   CLUBS, not players: composing two faces per request needs image work the edge cannot do (the
   zone's Cloudflare transforms are off, and a free Worker's CPU budget would not cover it), and
   drawing all 6,903 player pairs ahead of time is about 250 MB. So 16 files,
   `cards/compare-<a>-<b>.webp` in the link's order, drawn by `make-wpbl-share-cards.py pairs`.
   Faces per pair would need either of those two things. The original item:
   **A Compare pair that unfurls as itself** (added Oct 10). Compare is the fifth most-visited
   page in the section over the two weeks to Oct 10 (76 sessions, ahead of Teams, Schedule and the
   season recap) and has had no work since it shipped. A shared `/wpbl/compare/<a>-vs-<b>` link
   unfurls as the generic site card: [`functions/wpbl/index.ts`](functions/wpbl/index.ts) resolves
   the pair for its 404 and then calls `next()` without rewriting a tag. Give it the player
   pages' treatment through `src/lib/ogTags.ts`: both names, both headline lines, and a 1200x630
   image (two share cards side by side, or drawn by the same Python as the player cards). The
   pair is the thing people argue about, which is the thing people share.
7. ✅ **A season WPA leaderboard, and credit for baserunning** (shipped Oct 11 as two cards on
   Run value, "Most wins added" and "Best on the bases"; see the log). The player card and Compare are item 8; the MVP race stays as it is (see the log
   for why). The original item:
   **A season WPA leaderboard, and credit for baserunning** (added Oct 10, both from "What it does
   NOT have"). The win model is live and per play, so WPA per player is a sum over plays already
   held; it belongs on Run value beside RE24, where the reader will already be. Baserunning is the
   larger half: the MVP race prices the plate and the mound, and a steal or an extra base is
   neither. Start with stolen bases and caught stealing at run-expectancy values: the per-play run
   values that `stealEconomy` (in `src/league/runExpectancy.ts`, behind the steal card) sums for
   the league already price each attempt, so this is crediting them to the runner.
8. ✅ **Wins added and baserunning on the player card and Compare** (shipped Oct 15 as v1.165.0; see the log). The original item:
   (decided Oct 11). Item 7 put both
   numbers on Run value only; a reader looking at one player, or arguing about two, should meet
   them there too. Neither surface reads the league play log today, which is what both numbers
   are summed from (`wpaLeaders` in `derive/winProbability.ts`, `baserunningEvents` and
   `runnerIds` in `derive/baserunning.ts`). Things to settle while building it:
   - **The read.** `fetchWpblAllRunValuePlays` is cached for the session and already paid by Run
     value, Home and the recap, but a cold player link would pay it for two numbers. Either take
     it after the card has drawn (the card must not wait on it, and its box is reserved from the
     first paint, per the loading rule), or add a per-player read. A player's own plays are not
     enough for baserunning: a runner's extra bases are on OTHER batters' plays, and the
     average-runner baseline needs the whole league.
   - **Compare** takes `plays` already, for the head-to-head, but as `WpblMatchupPlay`, which
     carries the narrative but not the bases, the outs or the sequence. Widen it to `WpblRunValuePlay` or pass the league log alongside.
   - **Rank, not just the number,** the way the season line shows league ranks, from the same
     leaderboard Run value draws, so the card and the board can never disagree.
   - A pitcher's card gets wins added only; the bases are a hitting number.
   - New reads mean `npm run sweep:record` and the new fixture in the same pull request.

**Not this winter, on purpose.** "This day in the inaugural season" has nothing to replay from
October to July, since every game was played Aug 1 to Sep 22: park it until August 2027. Rolling
form ("Hot Hands", stashed) answers "who is hot right now", which has no answer without games.
The pick'em is parked for 2027 Opening Day (see Parked). **Spring work** is on the clock above:
the feed re-verification and the Bluesky rethink.

The September ordering is kept below as the record of how the season was worked.

**Read this first, Sep 1.** #0 shipped, which empties the top of the list with five regular-season
days left. The numbers below are stable references and are not renumbered; the order to work them
in now is:

1. ~~**#1c, today or not at all.**~~ ✅ *Done Sep 1: the flag came off and the card was audited
   against a real browser on the way out, which found four scale bugs the desktop rebuild's sweep
   could not have found, because a flagged card never renders. See the log.*
2. ~~**#1b's open half, before Sep 9.**~~ ✅ *Done Sep 1: series records on the schedule and in
   Game Center, and series-aware recap, Discord and Bluesky wording. See the log.*
3. ~~**The postseason arrival check** (#1, and the note in the clock).~~ ✅ *Done Sep 1, as a job
   rather than as a diary note: `wpbl-postseason-check` compares the published calendar against
   the feed's own marking four times a day through the postseason and fails loudly on a
   disagreement. The answer to what the feed actually sends still arrives on Sep 9; what changed
   is that it now arrives as an email rather than as somebody remembering to look.*
4. ~~**#5 daily standouts.**~~ ❌ *Dropped Sep 1: this league plays one game a day, so the day's
   standouts and that game's stars are the same three players, and `LastGameCard` already draws
   them. See the entry. What it was really reaching for became **#5b**.*
5. ~~**#5b: Home's one player name should open the player.**~~ ✅ *Done Sep 1.*
6. **#2 the archive**, scoped Sep 1 and smaller than it looked: the mirror is already complete
   against the feed, so there is no capture pass to write and the whole build can wait for the
   winter. Its one dated half, a verified export of the season, ~~cannot wait~~ ✅ *shipped
   Sep 1*. See the scope under #2.
7. **#4 the primer**, cheap, durable, and aimed at an audience that is entirely first-time
   visitors.
8. **#2a the season recap page**, added Sep 8 and wanted soon. The regular season is final, so
   the whole thing is buildable today and only gains a postseason section on Sep 22. It is the
   one item on this list with an audience in November.

### 5b. Home's star name opens the game, not the player 🎯: ✅ **shipped Sep 1, 2026** (`abbb9b6`; the star is now a player link)

Split out of #5 when that was dropped, because it is the half of it that was right.
`LastGameCard` renders one star and passes `onClick={() => onOpenGame(game)}`, so the single
player name on `/wpbl` opens a box score. `GameRecapView` two hundred lines up does it correctly,
passing `onOpenPlayer(p)`, so the wiring and the lookup from a `RecapStar` back to a
`WpblPlayer` both already exist. Worth checking at the same time whether the card should show
all three stars rather than one: it shows one because of a layout constraint (it shares a
stretched row with Leaders), which is a real reason and may still be the right answer.

### 0. The desktop rebuild: Home, and the 1.4x zoom that shaped it 🎯⚙️: ✅ **shipped Aug 31, 2026 as v1.58.0** (see the log)

Started and finished Aug 31, in five phases plus the shell. Kept in full rather than cut down to a
log entry, because the three kinds of fixed length it establishes (rem for boxes holding type,
`chromePx()` for structure, raw px for ornament) now bind everything new in the section, and the
reasoning for which is which is here rather than in the diff. `/mlb` still runs the 1.4 zoom on
its own subtree and takes its turn separately; that is the deliberate price recorded below.

What it was. A Home redesign and the retirement of the desktop `zoom` are one job rather
than two, because the zoom is what forced most of Home's layout decisions in the first place:
`HOME_WIDE_W` exists only to break back out of a column the zoom had already shrunk, and the
scoreboard's placement, its edge fades and the bracket's connector have each been wrong at
least once for the same underlying reason.

**What the zoom is.** `zoom: 1.4` on the app root at `md` and up, covering `/mlb` and `/wpbl`
together (`DESKTOP_ZOOM` in `mlb/constants.ts`). It was a one-line answer to a real problem:
a 720px mobile-first column reads tiny and lost on a 1440 monitor. It is not a browser
compatibility problem, and `zoom` has been standard since Firefox 126. This is a
maintainability job with an accessibility payoff attached.

**What it costs.** It splits the app into two pixel units that nothing in the type system tells
apart. CSS lengths, `scrollLeft` and `offsetHeight` are layout pixels; `getBoundingClientRect`,
viewport units and media queries are visual pixels, 1.4x larger. Every line crossing between
them has to divide by `--app-zoom`, and forgetting is silent: no error, no failing test. As of
Aug 31 that is 14 lines across 6 files that exist only to divide it back out (7 in WPBL, 5 in
the shared shell, 2 in MLB), sitting on top of 51 rect and scroll call sites in 8 WPBL files
that live in the same hazard. It has produced at least five shipped bugs: `--app-header-h`
twice in opposite directions, the scoreboard anchor, the scoreboard fade, and `PlayerDetail`
having to write `lg` where it means `md`. Two more artefacts: the page pops 40% larger in one
step when a window crosses 900px, and the zoom multiplies with the reader's own browser zoom,
so someone already at 125% because they need it lands at 175%.

**THE SHELL DECISION, TAKEN Aug 31: the wrapper moves DOWN onto the MLB view, it does not move
away.** The header, search, bell and account menu are inside the same wrapper and shared with
`/mlb`, so nothing can happen to the zoom on one section without happening to them on both.
Un-zooming the shell only on `/wpbl` is a one-liner and is worse than the bug it fixes: the
header would change size when you toggle MLB and WPBL, on a control that lives in the header.
Doing both sections at once is the only fully coherent end state and roughly doubles the work.
So the shell is retuned once at real scale and serves both, MLB keeps its 1.4x on its own
subtree, and `/mlb` reads slightly top-light until it takes its turn. That last part is the
price, and it is deliberate.

**WHAT A TYPE RAMP DOES AND DOES NOT COST, MEASURED Aug 31 RATHER THAN ASSUMED.** The obvious
replacement is to drop the zoom and raise the root font size instead, which scales the 454 `rem`
font sizes in `src/wpbl` for free. The first version of this entry said a blanket px-to-rem
conversion of all 156 fixed sizes was therefore "the job", on the strength of the note in
`AccessibilityContext.tsx` calling 1.125 the largest step the dense tables hold. Both halves of
that were wrong, and the correction is what shaped phase 2.

**Wrong the first way: a blanket conversion would break the Large text setting rather than
free it.** That setting exists precisely to scale TYPE and leave layout alone; its own note
rejects browser zoom because zoom reflows the wide grids into something other than what the
reader had. Put every dimension in `rem` and the setting becomes browser zoom. So the fixed
sizes are not one pile. They are three, and only the first belongs in `rem`:

- **Boxes reserving room for a string or a number.** A rank column, a club-name column, a
  scoreboard chip. These MUST grow with the type or they clip, and growing them is not
  "scaling the layout", it is the box doing its job.
- **Art and tap targets.** Badges, avatars, the dashed placeholder circle, a 24px close
  control, the `minHeight: 48` touch minimum. These are not holding type and must not follow
  it. A tap target that grows with the text size is a worse tap target.
- **Layout constants.** The scoreboard's 24px edge fades, its 40px hover zones, the sheet
  grabber. Nothing to do with type at any scale.

**Wrong the second way: the 1.125 ceiling is a caution, not a measurement.** Scanning every
leaf element on the Stats board at 1024px wide for overflow: **nothing clips at 1.125, and
nothing clips at 1.25.** The first thing in the whole section to overflow its box is the
`width: 18` rank column, and it goes at **1.375**, needing 20px for a two-digit rank. Three
call sites (`StatsView` twice, `ui.tsx` once). With those three in `rem` the scan is clean
through 1.625, which is as far as it was taken.

So the accessibility payoff is real but far smaller and far more targeted than first written:
it is a handful of narrow numeric columns, not 156 values. What actually justifies the phase is
the first bullet above, because a type-only desktop ramp in phase 3 only works if the boxes
holding type follow it.

**The phases.** Each leaves the site working; none is a long-lived branch.

1. **Move the wrapper, retune the shell.** `zoom` comes off the app root and goes onto the MLB
   view. Retune the toolbar at real scale: logo, the `BRAND_WORDMARK_MIN` raw-px threshold
   (tuned against the zoomed toolbar), the three `70vh` menu caps, and the `--app-header-h`
   publisher. Five compensation sites become dead and get deleted. Visible on `/mlb`, not on
   `/wpbl`.
2. **Put the text-sized boxes in rem, and only those.** Not 156 values: the subset that
   reserves room for a string or a number, judged per site against the three kinds above. Do it
   with the zoom STILL ON, so every file can be checked against a rendering that must not move
   at the default text size, and land it grouped by file rather than as one sweep. The check
   that matters is the overflow scan at 1, 1.25 and 1.375, not eyeballing.
   *Done Aug 31, 47 sites across 14 files.* `Home`, `PlayoffBracket`, `StatsView`, `ui`,
   `TeamPage`, `GameDetail`, `PlayerDetail`, `GamePreview`, `WpblApp`, `TeamsGrid`, `RecapCard`,
   `DraftValue`. Three kinds of site the first pass would have missed, all found by sweeping the
   rendered page rather than by reading the source: **glyph boxes** whose font was already in rem
   while the box was in px (the winner caret, the recap medal, which was the first thing on Home
   to overflow); **`tableLayout: 'fixed'` columns** in the standings, where a cell wider than its
   column does not push it out, it spills; and **budgets measured against type**, like the player
   band's `maxWidth: 200` form strip, which is sized against the bio line beside it and so has to
   scale with it.

   Sweep result, every leaf element checked for overflow at 1024 and 1440: Home, Schedule,
   Standings, Stats and the player page are clean through **150%**. Teams still truncates two
   club names at 137.5%, and that one is correct: they are `flex` + `ellipsis` with no fixed
   width, so the container is the constraint and the ellipsis is the designed backstop.

   What stayed in px, deliberately: every dot, badge, avatar and icon square; the `minHeight: 48`
   touch minimum; the scoreboard's 24px fades and 40px hover zones; the sheet grabber; the page
   column caps, which are phase 3's business.
3. **Set the desktop ramp, move the caps, flip the zoom off.** ✅ *Done Aug 31, settled at 1.25.*

   **TWO SCALES, NOT ONE, AND THEY CARRY DIFFERENT DEPENDENCIES.** `--app-type` is spent on the
   root font size, so it moves every `rem`: the type, and the boxes phase 2 taught to follow it.
   It multiplies with `--sd-text-scale`, because a reader who wants larger text on a desktop
   wants it larger than desktop already is. `--app-chrome` is spent on everything measured in px
   that is not type: MUI's whole spacing scale (one `spacing` function in the theme, since
   nothing reads `theme.spacing()` in JS), badges and portraits (one calc each in `TeamBadge`
   and `PlayerPortrait`, covering all 43 call sites), and the toolbar logo. It deliberately
   excludes `--sd-text-scale`: Large text scales type and leaves structure alone, and a tap
   target that grows with the text size is a worse tap target.

   Both are set at md+ on `:root[data-app-scale='wpbl']`, an attribute App.tsx sets per route.
   **MLB must stay out of it**: it still runs the zoom, and a root font-size ramp on top of a
   1.4 zoom compounds. Exactly one section is mounted at a time, so the two never overlap.

   `AccessibilityContext` had to stop setting `font-size` directly and publish its factor
   instead, because an inline style beats the stylesheet: left as it was, a reader on Large text
   would have got the MOBILE type size on a desktop. It also turned out `--sd-text-scale` was
   already being published for "the fixed-width numeric columns that have to grow with their
   contents", with a comment pointing at usages that never existed. Phase 2 did that job with
   rem instead.

   Caps re-derived, all stopping their `/ var(--app-zoom)`: `HOME_WIDE_W` 900 to **1260**,
   `FULL_BLEED_W` 1100 to **1540**, `BAR_W` to match, the section column 720 to **1008**. Each
   is the old layout number times the 1.4 it was rendered at, so every column is the same width
   on screen it has always been.

   **The ramp is at 1.4, which reproduces today's rendering exactly, and that was the point of
   landing it there**: it makes the flip verifiable rather than a matter of taste. Verified at
   1728: no `zoom` anywhere, root font size 22.4px, Home column 1260, scoreboard chip 190.4px,
   toolbar logo 44.8px, all identical to the zoomed rendering. Sticky offsets meet exactly
   (header bottom 56.98, control bar top 56.98). Zero overflow on Home, Schedule, Standings,
   Teams and Stats at both text scales, including the new combined maximum of 1.4 x 1.125.
   The wordmark threshold needed a second value (960 unscaled, 1350 scaled) because the same
   lockup is 1.4x wider in viewport pixels on a scaled route.

   **Settled at 1.25**, after landing at 1.4 to prove the flip and then moving it. 1.4 was
   never a desktop decision: it was the number that stopped a phone column looking lost, and it
   magnified everything equally, margins included. With the column caps now set independently
   the scale only has to size the CONTENT inside them, and 1.25 puts body copy at 16px. At 1728
   that is seven scoreboard games instead of six and two more cards above the fold, in the same
   pixels. Lower starts to read as small on a page where a lot of the type is 0.6-0.8rem by
   design.

   **Two kinds of column, and the difference is what the content can do with width.** The
   section column (Schedule, Standings, Teams) is a READING column: it tracks the scale via
   `chromePx(720)`, because what a text column is measured against is its own type. Pinning it
   at a fixed screen width, which it was for one commit, made every row 12% wider than the
   words in it: a club name on the left of a Teams card with its record marooned at the right,
   a schedule row with a gulf between the matchup and the time. Home and the stats table BREAK
   OUT of that column and keep fixed widths (1260 and 1540) on purpose, because they have
   somewhere to put the extra room: another scoreboard chip, more stat columns.

   The number lives in one place, `WPBL_DESKTOP_SCALE` in App.tsx, published as
   `--app-scale-desktop`. CSS keeps the breakpoint, because a media query is the one thing JS
   should not be deciding. The toolbar's second wordmark threshold is DERIVED from it rather
   than written down, since a hardcoded pair would drift the first time the scale moved and the
   symptom would be a wordmark ellipsising into the search box in one narrow band of widths
   nobody thinks to check.

3b. **The shared toolbar, scaled on both sections.** ✅ *Done Aug 31.* Until this, switching
   WPBL to MLB shrank the whole bar 25%, because only WPBL's root carried the scale. A third
   variable, `--app-shell`, scales the `AppBar` on its own and only where the root is not
   already doing it. It spends it as `zoom`, which is the right tool for a chrome bar and the
   wrong one for a section: see the CLAUDE.md entry. Two raw px in the bar had to become
   structure for the two paths to agree, the `Toolbar` minHeight and the search box width.
   Measured on both routes: bar 61px, logo 40px, search box 325px, wordmark within 1.7%. The
   only residual is MUI's own hardcoded 5px `IconButton` padding, worth 2.5px on a 40px control,
   left alone rather than chased with a global theme override.

4. **Delete the compensations.** ✅ *Done Aug 31.* Every `--app-zoom` division in the section is
   gone: the scoreboard's anchor placement is plain subtraction again, the nav-height publisher
   hands over its rect, `PINNED_CHROME` spends the sum as it arrives. `PlayerDetail` drops back
   from `lg` to `md`, which it only used because `md` meant 900px of screen but 643px of layout
   inside the zoom. CLAUDE.md's trap is rewritten rather than patched: the old one described two
   pixel units, which is no longer the hazard.

   **The regression this phase caught.** Phase 3 re-derived the page columns and missed every
   structural length INSIDE them: a `maxWidth: 840` that used to render at 1176 rendered at 840
   against type that was still larger. The player dialog wrapped a name onto two lines. Found by
   opening the page, which is the only thing that finds it. `chromePx()` in `ui.tsx` now carries
   that kind, and the three kinds are written up in CLAUDE.md.
**Verification, because nothing in the suite can catch this.** All 1,009 tests pass at 1.4 or
at 1: jsdom has no layout engine and none of them measure anything. Every zoom bug so far was
found by a person looking at the page, so that has to be the plan rather than the accident.
A screenshot pass over the five tabs plus the four detail screens, at 640, 1024 and 1440, in
both themes. Plus three measured invariants checked in a real browser, all three being known
regressions: the header and nav sticky offsets meeting with no crack, the scoreboard anchor
landing on a chip boundary at max scroll, and the bracket connector's stubs hitting the box
centers.

**On the timing.** This was scoped for after Sep 22, when the feed stops and the data freezes,
because phase 2's whole safety net is "the rendering did not change" and that net is weaker
while the scoreboard updates every two minutes. Brought forward deliberately on Aug 31 and
folded into the Home redesign. What that costs: the before-and-after screenshots are being
taken against moving data, so phase 2 needs more care per file than it would have in October,
and phase 3 lands during the run-up to the postseason. Worth knowing if something looks off in
mid-September.

### 1. Postseason data hygiene ⚙️: ✅ **shipped Aug 20, 2026** (see the log). Kept here until the first postseason game confirms what the feed sends

**Dates published Aug 24** and now carried on the bracket card AND the schedule tab
(`POSTSEASON_SCHEDULE` in `derive/bracket.ts`): Semifinal A Sep 9, 11, 13* · Semifinal B
Sep 10, 12, 14* · Championship Sep 16, 17, 19, 20*, 22*. They are a constant rather than rows,
because a game row needs two clubs and the seeds are not set until Sep 6. The schedule prints
them through `postseasonScheduleRows` (Sep 3, see the log), naming a seed until that seed is
locked and standing down the day the feed publishes a real game on the date. **Home’s Scoreboard
strip reads the same list** (Sep 5), so the section does not run out of season on Sep 7.

**Format** (confirmed Aug 16): all four teams qualify · semifinals **best-of-3** ·
finals **best-of-5**. So **7–11 postseason games** land on top of a 30-game regular season,
and a team that reaches the finals plays up to **8 more games on top of its 15, a 53%
increase on its season**.

**Not a bracket feature.** A clinch tracker or playoff-odds board is pointless when four of
four qualify, and that idea stays parked. This item is about the numbers those 7–11 games
will silently corrupt.

**The aggregation layer cannot exclude them.** In [`stats.ts`](src/wpbl/stats.ts):

```
sumBatting(lines)                  // lines only
sumPitching(lines)                 // lines only
aggregateBatting(players, lines)   // no games argument at all
aggregatePitching(players, lines)  // no games argument at all
```

No game context reaches these functions, so there is no parameter through which a
postseason line could be filtered. Every line in the DB gets summed. The first semifinal
box score silently changes every season number on the site.

**Uneven is worse than inflated.** A finalist's hitter gains up to 8 extra games of
counting stats; a team swept in the semis gains 2. HR / RBI / strikeout leaderboards would
reorder by how far a team went rather than how a player performed. `wpblQualifiers` scales
its thresholds off games played, so the qualified filter drifts too.

**Standings have the same hole, one layer up.** `game_type` and `counts_in_standings` are
both ingested and stored
([`wpbl-ingest/index.ts:652`](supabase/functions/wpbl-ingest/index.ts)) but **no consumer
reads either**. `computeStandings` ([`api/games.ts`](src/wpbl/api/games.ts)) filters on
`status === 'final'` alone.

**Blast radius**: everything reading those four functions. Stats tab, home leaders, team
pages, player pages, the Draft tab's draft-value analysis, the Discord `/player` command,
and the OG cards on shared links. **The season archive (#2) is built on these numbers**, so
leaving this unfixed makes the permanent record of the inaugural season wrong.

**Scope** (done): thread game context into the four aggregation functions and their 23 call
sites; audit every `status === 'final'` filter for whether it means "counts toward the
season record" or "has been played"; confirm what the feed actually puts in `game_type` for
a postseason game (unknown until the first one lands, and the semis start right after
Sep 6).

**The last of those is now watched rather than remembered** (Sep 1, see the log).
`scripts/check-wpbl-postseason.ts` reads the league's published dates out of
`POSTSEASON_SCHEDULE` and the feed's marking through `countsInStandings`, and fails when they
disagree in either direction. It runs four times a day through September and October and is the
one job in the repo that is MEANT to go red. What it must never become is a filter: a
regular-season game postponed into the Sep 7-8 gap would vanish from the standings, which is why
the date raises an alarm a person reads and never decides what counts.

### 1b. Series state 🎯: ✅ **the bracket shipped Aug 20, 2026 and is now live for everyone** (see the log). The rest is open

Postseason baseball is series-shaped and **almost nothing in the section models a series**.
The schedule, recaps and the Discord poster are all single-game shaped. "SF leads 2–1" is the
unit fans track, and as it stands a best-of-5 clincher gets recapped as "the Firebells won
4–2" with no notion that a championship was just won.

**THIS ITEM WAS FILED AS BLOCKED AND WAS NOT.** The entry used to end "depends on knowing how
the feed represents a series (game number? series id?), which is unknown until the first
postseason game lands." That premise was wrong, and it had parked the whole item behind a date
we do not control. A series needs no id: the postseason is the only part of the schedule
`countsInStandings` rejects, and **within it an unordered pair of team ids identifies a series
uniquely**, because the semifinals are 1v4 and 2v3, the championship is the two winners, and
no two of those three pairings can be the same two clubs. Grouping postseason games by their
team pair reconstructs every series record with no new field, whatever the feed calls them.

**Done**: `derive/bracket.ts` (pairings from the standings order, series records from grouped
postseason games, championship slot, champion) and the Home card that draws it. Before Sep 6
it is a projection that moves with the standings; from Sep 9 the same boxes carry real series.
**The flag came off**, and what took it off was the odds rather than a decision to be braver: a
bare projected bracket is a third view of the standings, and the same boxes carrying a price on
each series are the section's one forward-looking surface. The hedge moved into the card's own
footnote, which is what a bracket-shaped guess needs and what a switch almost nobody flips never
was. Reasoning is in the header comment of `PlayoffBracket.tsx`.

**Odds, added Aug 24** (see the log): the bracket card now prices each series and the title from
season run differential, with an elimination flag, which is the "something new" the postseason
needed rather than a third view of the standings. `derive/seriesOdds.ts`.

**The rest shipped Sep 1** (see the log). `derive/series.ts` answers the question every surface
other than the bracket has, which is the opposite way round from `buildBracket`: given ONE game,
what series is it, which game of it, and what is the record. The schedule carries "Semifinal ·
Game 2 · Firebells lead 1-0", Game Center adds what a win would settle, and the recap engine
takes the series as an optional argument so the site card, the Discord embed and the Bluesky post
all say a championship was won on the night one is.

**Still open**: nothing on this item that is not waiting on Sep 9. The clinched/eliminated state
is carried by the bracket's flag and by Game Center's "Winner takes the series"; a club knocked
OUT is not named as such anywhere, which is a wording gap rather than a missing derive.

**The one real dependency**, now isolated: the feed must mark postseason games at all, through
`game_type` or `counts_in_standings`. If it marks neither, those games read as regular season,
the bracket stays empty and every season total is wrong, which is the exposure #1 already
carries (see `season.ts`) rather than a new one. Confirm it the day the first semifinal lands.

### 1c. The seeding race 🎯: ✅ shipped Aug 20, 2026 · ❌ **removed Sep 8, 2026**

Built to answer what the last games were FOR, since all four clubs qualify and the seed order
was the entire stake of them. That is a card with an expiry date written into its purpose, and
the date was Sep 6: with the order settled it answers a question nobody has, and left alone it
would have gone on answering it until spring. Taken off Standings, which is a table and a footer
now, and `SeedingRace.tsx` is deleted with it rather than left as 346 lines that render nowhere.

`derive/seeding.ts` STAYS and is load-bearing: `derive/bracket.ts` builds the whole bracket out
of `seedingRace`, and `seeding.test.ts` still covers it. Only the card is gone.

All four clubs qualify, so a clinch tracker is pointless and stays parked. **Seeding is not
pointless**: the standings order sets the semifinals 1v4 and 2v3, and it is the only thing
the remaining games decide. Nothing on the section said so, and Standings presented itself
as a race for a title already conceded to everyone. Shipped as a card under the table: seed
number, the cushion over the seed below, a magic number to lock a seed, and the semifinal
each seed would draw. All derived from `computeStandings`, so it needed no new data and no
new request. **Opt-in from Settings**: it is the first thing on the section to make a
forward-looking claim rather than report a result, and a number like "8 to lock 1st" is worth
being wrong in front of a handful of volunteers first.

**THE FLAG CAME OFF ON SEP 1, with five games left to live** (v1.59.0, see the log). The argument
was the expiry: the bracket (1b) is durable through Sep 22 and beyond, and a card whose whole
subject is what the remaining REGULAR-season games decide is worth nothing after Sep 6. An
experiment nobody can see is not being tested, it is just unread. The magic numbers were checked
against the live table before the switch and the arithmetic holds: SF need 2 to lock first, LA
and NY 2 apiece for second and third, BOS 5 to climb to third, which is every game both clubs
have left.

### 2. The inaugural-season archive 🔬🎯: *the only durable item on this list*

On Sep 7 this section becomes a static site with no reason to visit. The one asset worth
building is **the definitive record of the WPBL's inaugural season**: frozen final
leaderboards, single-season and single-game records, the complete game log, the Hall of
Firsts promoted from a home-page card to a permanent artifact, and a season-in-review page
with each team's arc.

Two reasons to start now rather than in September:

- Some of it needs **capture during the season**: anything derived from live state, or
  from feed fields that may not persist, has to be snapshotted while the games are running.
- It is the natural home for the multi-season support that has been deferred since Phase 3
  (see Parked). Building the archive is what makes 2027 a second season rather than a reset.

#### Scoped Sep 1, 2026, and the first bullet above is mostly wrong

The item has been carrying a deadline it does not have. Audited against the live feed and the
live mirror, field by field:

**THE MIRROR IS ALREADY COMPLETE AGAINST THE FEED.** Every field the feed publishes on a game,
a box-score line or a play has a column in `wpbl_games` / `wpbl_batting_lines` /
`wpbl_pitching_lines` / `wpbl_fielding_lines` / `wpbl_game_plays`, down to `pitch_sequence`,
`pitch_events`, `fouls`, `balls`, `strikes`, `home_lob`, `sf`, `sh`, `ibb`, `gdp`, `tb`. Today
that is 30 games, 610 batting lines, 142 pitching lines, 469 fielding lines and 2,358 plays. The
ingest has been snapshotting continuously since August; there is no separate capture pass to
write. Three things in the feed are NOT mirrored and none is worth a column: the venue's postal
address (one venue, all season), each club's and player's `profile_url` on the league's own site
(which dies with the site either way), and the `wins/losses/record/streak` fields on `/teams`,
which the league publishes empty and we compute ourselves anyway.

**SO EVERY HEADLINE FEATURE OF THIS ITEM IS RECOMPUTABLE FOREVER**, and none of it has to be
built before Sep 22. Frozen leaderboards, single-season and single-game records, the complete
game log, the Hall of Firsts, run expectancy, win probability, the MVP race, `excitement`, each
club's arc: all of it derives from stored plays and stored box lines. Nothing reads live state
that is not also written to the play log. The archive is a build-whenever job.

**WHAT IS ACTUALLY AT RISK, in order.** Not the feed's own data. The things AROUND it, all of
them partial and all of them owned by somebody else:

- **TrackMan: 2 of 25 finals.** 766 pitch rows, from a batch the league published once and
  stopped. Not a coverage gap we can close, and `wpbl-tracking-watch` runs daily **year-round**
  (checked: no season window), so a resumption in November is still caught. Nothing to do.
- **RetroWPBL: 20 of 25 finals**, a stranger's hand transcription, incomplete, and **no license,
  so all rights reserved by default**. `wpbl-retro-sync` is also year-round. The license is the
  problem, not the clock: it can be read to check our own rows and cannot be republished, which
  bars it from an archive that is meant to be the public record. Asking the author is the only
  path and it is not a September job.
- **YouTube: 20 of 25 finals have a linked video**, plus 112 unlinked clips. We hold ids and
  titles, never the video, and rehosting is neither possible nor right. Channel deletion is the
  rot and it cannot be mitigated. What CAN be checked is whether the metadata we keep reads as a
  record on its own once the embed is dead.
- **Five finals have no video and no Retro detail at all.** The box score is the whole record of
  those games. Worth knowing before someone promises "the definitive record".
- **One of 119 players has no bundled portrait**, and 118 do. Team logos are bundled too, so the
  art does not depend on anyone else's server.

**AND THE ONE REAL DEADLINE, WHICH WAS NOT ON THIS LIST AT ALL** (built Sep 1, see the log). Everything above says the
inaugural season survives as long as the mirror does. The mirror is one Supabase project. When
the feed goes quiet on Sep 22 there is no longer a source to re-ingest from, so from that date
the database stops being a cache of someone else's data and becomes **the only copy of the
WPBL's first season that we control**, and a dropped table or a lapsed project takes it with no
recovery path. A verified export is worth more than every feature in this entry and is a fraction of the
work. **That was the September job, and it is done**: `npm run archive` writes the season to
`archive/wpbl-2026/` and a weekly job commits it when it moved. Everything else here can wait
for the winter, which is also when it has an audience.

Worth noting as evidence of demand: `github.com/exu6jh/RetroWPBL` is a stranger
hand-transcribing WPBL play-by-play into Retrosheet format, game by game, from the same
public feed we already mirror in far more depth. People want the historical record.

**Partly answered as of Aug 19**, from the other end: the Commons archive gallery (see the
shipped log) is durable content that needed no season capture at all. It does not replace this
item, which is about *this* season's record. It does mean `/wpbl` is no longer completely empty
of reasons to visit in November, so the deadline pressure here is about the snapshotting, not
about having something to show.

### 2a. The season recap page 🎯🔬: ✅ **shipped Sep 13, 2026 as `/wpbl/season`** (see the log). The diamond, the baserunning read and a postseason section are the open remainder; ✅ **the best-game lines shipped the same day as the Bests board** (see the log), which answers them in more depth than this page wanted and which `/wpbl/season` should link to rather than duplicate

#2 above is the RECORD. This is the READ of it: one page that says what the first season of
professional women's baseball was actually like, for somebody who did not watch it. #2 lists "a
season-in-review page with each team's arc" as one bullet among a dozen; this is that bullet,
scoped on its own, because it is the one the section wants first and it is the only thing on
either list that gives `/wpbl` a reason to exist in November.

**RATE STATS ARE FIRST-CLASS HERE, AND THE REASON IS NOT THE OBVIOUS ONE.** The instinct with a
15-game season is to treat every rate as noise and lead with counting stats and absolutes
instead. That instinct is imported from a 162-game league and it is wrong here. **If 15 games is
the length of every WPBL season, then a season rate line is the league's native scale**: .450 in
2026 and .450 in 2027 are the same achievement measured the same way, comparable forever, and
apologizing for the sample would mean this league never gets to have batting champions. Build
the standard leaders and give them the standard billing. `wpblQualifiers` already sets the bar
in plate appearances (2.4 per team game, floor 6, so 36 PA at 15 games); it needs nothing.

**WHAT GOES ON IT**, in the order it was asked for:

- **Standard leaders.** The full slash line plus HR, RBI, SB, R, H; W, ERA, SO, WHIP, IP, saves.
  Qualified, using the bar above.
- **Best at each position, drawn on a diamond.** Nine positions laid out as a field rather than
  as a table, each one carrying the player who owned it, and each one a tap through to her page.
  `position` is on every batting line, so the pick is derivable; the diamond is the part that has
  to be drawn. This is the page's centerpiece and the thing most likely to be shared.
- **Performance of the season, batting and pitching.** The single best game line of each kind,
  named, with a route into that game's box score.
- **The most improbable win.** Lowest win probability a club held at any point in a game it went
  on to win. `derive/winProbability.ts` computes this per play already and `excitement` is
  computed on every game and drawn nowhere (see "What it does NOT have"), so this is a read of
  something that exists rather than a new model.
- **Baserunning.** *The per-runner half is built (Oct 11, `derive/baserunning.ts`, on Run value); this
  page can read it.* 96 steals against 16 caught, 85.7%, and what that was worth against the
  league's own run expectancy table. The MVP race explicitly prices the plate and not the bases,
  so this is also the season's answer to a gap that entry names.
- **The mess: errors, balks, wild pitches, passed balls, hit batters.** 22 balks and 71 wild
  pitches in 30 games is not a footnote in this league, it is a characteristic.
- **No triples. Included, and NOT the headline.** It is a good line and it should be on the page,
  but it is a curiosity and the page should not be built around a curiosity.

**THE SEASON'S OWN NUMBERS, measured against the mirror on Sep 8** and recorded here so nobody
has to re-derive them: 30 regular-season games, 15.83 combined runs per game, a league batting
average of **.339**, 277 walks against 269 strikeouts (more walks than strikeouts, league-wide),
a 58.7% strike rate, 96 steals for 112 attempts, 75 hit batters, 71 wild pitches, 22 balks, 10
sacrifice bunts, 57 home runs, 102 doubles, and **zero triples**. The home side went **14-16**,
which is worth a line of its own: one hub venue means no travel and no park, so this is a
cleaner read on whether batting last is worth anything than a real league can produce, and the
answer is that it was not.

**THE ZERO IS REAL, CHECKED THREE WAYS** before it goes on a page: no play carries a `triple`
event type, no narrative in 2,835 plays contains the word, and the `triples` column sums to zero
on both the batting lines and the pitching lines (triples allowed). Note the consequence for the
Hall of Firsts, which has a `first_triple` slot: it is an empty case, and it stays empty until
somebody hits one in 2027.

**WHAT IT BUILDS ON, all of it already here**: `stats.ts` for the aggregates and the qualifier,
`derive/runExpectancy.ts` for anything priced in runs, `derive/winProbability.ts` for the
improbable win, `derive/mvpRace.ts` for the value leaders, `firsts.ts`, `tracking.ts` for the
radar extremes, `hometowns.ts` for where the players came from. The page is mostly composition.

**ONE THING TO CHECK BEFORE BUILDING ANYTHING PLAY-DERIVED.** 552 of the 2,835 stored plays
carry `event_type: 'unknown'`, which is 19% of them. Steals, wild pitches, caught stealing and
passed balls are all separately typed, so the bucket is probably substitutions and pickoffs and
harmless, but a season board built on event types without confirming that would be quietly wrong
by a fifth. Confirm first.

**TIMING.** The regular season is final as of Sep 6, so every number above is already frozen and
the page can be built and published now against the regular season alone. The postseason ends
Sep 22 and the page gains a section then. Do not wait for Sep 22 to start: a recap that lands in
October has missed the only week anybody was looking.

### 3. SEO follow-through ⚙️: *the code half is done; links are the brake*

**Search Console is verified** (it was recorded as open here and in `CLAUDE.md` until Aug 21,
2026, and both were wrong). The plumbing is all built and shipped: robots, a sitemap on a daily
cron, per-route meta and JSON-LD, real `<a href>` links, one path per tab, a page per player,
and real 404s for everything else (see the Aug 21 entries in the log). **Pre-rendering was
canceled rather than built**: URL Inspection confirmed Googlebot renders the JS completely, so
it would have bought nothing.

**What is actually left is not code.** As of Aug 21 the site had 3 indexed pages against ~128
submitted, and near-zero inbound links, which is the one input we cannot ship our way out of.
[`docs/BACKLINKS.md`](docs/BACKLINKS.md) is the list of who to approach and the drafts to send;
working that list is the item. Also open and cheap: `www.sportydolphin.fun` is NXDOMAIN.
Indexing lag is measured in weeks and search volume for "WPBL standings / stats / roster"
collapses after Sep 22, so the send-the-emails half is the part with a deadline.

### 4. League primer + stat glossary 🎯: ✅ **both halves shipped**

✅ *the primer as `/wpbl/league` on Aug 27, 2026 (v1.52.1) and the glossary as
`/wpbl/glossary` on Sep 4, 2026 (v1.64.0): see the log for each. Nothing is left in this item;
it stays here because #3 was written to feed off it.*

A short "what is the WPBL" explainer (four teams, one hub venue at Robin Roberts Stadium
in Springfield IL, inaugural Aug–Sep 2026, seven-inning games, link to the official site)
plus a glossary of the stat abbreviations. Every visitor to a brand-new league is a
first-time visitor. Doubles as indexable prose, which the section currently has almost
none of.

**They shipped as two sibling pages rather than one, which was not the plan here.** One URL
cannot rank for both "where the WPBL players came from" and "WPBL rules", and burying the rules
under the primer's title spends the only thing the rules page has going for it: it is the one
page on this site answering a question with no other answer anywhere on the web, because the
league does not publish how a pitcher earns a win or why an inning ended the way it did.

### 5. Daily standouts: Home card 🎯: ❌ **dropped Sep 1, 2026. It is a card the section already has**

A "top performers" card for the latest game day, built from box lines Home already fetches,
mirroring the MLB TopPerformers/Spotlight pattern. Cheap, durable past Sep 6, and it kept moving
up this list on the strength of the retention gradient.

**The premise was imported from MLB and does not survive contact with this schedule.** A daily
standouts card is worth building where a game day holds fifteen games and nobody can watch them
all, so a digest of the day beats any one box score. This league plays **one game a day**: 24 of
the 27 game days to Sep 1 had exactly one, all five remaining regular-season days have one, and
every postseason date has one by construction, since the bracket never runs two series on the
same night. So "the standouts of the day" and "the stars of that game" are the same three
players, computed from the same box lines, and `LastGameCard` on Home is already drawing them
from `buildRecap`. It would have been a second card restating the first, and the MLB pattern it
mirrors is the reason that was not obvious.

**What was actually right about it, and is now its own job.** The reason it kept climbing was the
traffic finding above: a browser that opens a player page returns at 76.5%, against 7.8% for one
that opens neither a player page nor Game Center, and Home is where most of them are lost. The
card was a means to putting a tappable player name in front of them. Home HAS one and it does not
go to the player: `LastGameCard` renders `recap.stars[0]` alone, and its name and portrait are
wired to `onOpenGame`, so the one player name on the section's landing page opens a box score
instead of the page the gradient is about. That is a two-line fix and a much better use of the
same reasoning than a new card, so it is filed as its own item rather than lost with this one.

### 6. Win probability in Game Center 🔬

✅ *built Aug 23, 2026, readable play by play by holding a finger on it, and live for everyone
from the same day: see the log.*

The fiddly part was supposed to be a credible model for a seven-inning league with no
history, and it turned out the run-value work had already paid for it. An empirical
win-probability table is out of reach by three orders of magnitude (about 7,000 cells against
1,820 plays), but nothing has to be looked up: the run-expectancy walk already measures how
many runs follow each base-out state, and keeping that as a histogram instead of a mean gives
the two distributions a win model needs. From there it is exact dynamic programming backwards
from the last out, no simulation and no sampling noise.

Built on it since: ranking games by how much they moved (Oct 11, "The wildest games" on
`/wpbl/season`) and a season WPA leaderboard (Oct 11, "Most wins added" on Run value).

### 7. Incremental depth 🔬

~~Fielding columns in the Stats tab~~ ✅ *shipped Oct 9, 2026 as the Fielding board (see the log)* ·
player-page splits vs each opponent as the sample grows · ~~WPBL recents
in the empty-query search dropdown~~ ✅ *shipped Aug 24, 2026 (see the log)*.

### 8. Cross-cutting leftover ⚙️

Settings accent-color picker (the last open item from the Aug 6 "Sprint C"; shared with the
MLB section).

### 9. Desktop detail views: the side panel and the full page 🎯⚙️: ✅ **shipped in both sections by Oct 7, 2026** (MLB as v1.128.0)

**Why.** On a desktop a player or a game opened as a centered dialog over a dimmed page. It was
about as wide as the 900px section column, so the gutters either side sat dimmed and unused, the
list the reader came from was covered, and Game Center kept its phone tabs on a screen with room
for every board at once. MLB opened players as a full page, so the two sections disagreed too.

**What was decided, and on what** (researched Oct 5: Material's side sheets and canonical
layouts, NN/g on modal and nonmodal dialogs and on tabs, Notion's side peek and full page):

- **Peek, then page.** A nonmodal side panel for opening things from a list, where the reader is
  working down rows and needs the list beside them; a full page for reading one game in depth. A
  modal blocks exactly the context such a reader is checking against.
- **The panel is the phone layout** in a phone-width column (`chromePx(420)`, 525px on screen).
  It reuses the most-tested layout, so each card still has two layouts, not three.
- **No tabs on the full page.** Tabs fail when the reader needs two panels at once, and a recap
  read against its box score is that case.
- **The dimmed centered dialog stays for short pickers** (Sort, Filter): a quick choice to make
  before carrying on, which is the job it suits.

**The plan and where it stands.**

1. ✅ **The player as the side panel** (Oct 5). No scrim, no scroll lock, no focus trap: focus
   moves in on open and back to the last row clicked on close, and Escape closes it. Clicking
   another row swaps it in place and REPLACES the history entry, so Back closes the panel in one
   step however many rows were looked at. It opens over any dialog it is reached from (the series
   view, Game Center, the ballot): its z-index is measured against what is open each time it
   opens or swaps. On the standalone pages the game overlay stays mounted under a player opened
   from it.
2. ✅ **Game Center as the side panel** (Oct 5). A player opened from it is a second panel drawn
   exactly over it, with a "‹ Game" back control, so the two read as one panel that navigated.
   Swapping games remounts Game Center (it seeds its tabs and data once); the panel tells a swap
   from an opening and does not slide in again. Every layout question in Game Center now asks
   `usePhoneLayout()`, and so does `useWpblName`.
3. ✅ **The full-page Game Center** (Oct 5, `GameCenterPage` in [GameCenterPage.tsx](src/wpbl/gameDetail/GameCenterPage.tsx)).
   Two columns from `lg`: the narrative on the left (Recap, or Live during a game, then the
   play-by-play), the numbers on the right (both box scores stacked, then pitch data). One column
   in reading order between `md` and `lg`, with the two box scores side by side once they fit
   (about 1045px; see Open). A pinned
   bar under the toolbar carries the score and jump links in place of the tabs. Reached by a game
   URL arrived at from outside the section (a cold load, a shared link, a link from a standalone
   page) and by "⤢ Expand" in the panel, which replaces the entry rather than pushing. Same URL
   as the panel: which one renders is `gamePage` on WpblApp's history snapshot. A player opens
   beside the page as the panel. Phones are unchanged throughout. The player's full page followed
   on Oct 6 on the same terms (see Open).
4. ✅ **MLB**: the same for `/mlb` (Oct 7). See Handoff item 11 in [ROADMAP.md](ROADMAP.md).

**Open.**

- ✅ **The full page during a live game and before one** (Oct 5). Live was checked on a real game
  through the dev live simulator, and that found the situation card going three-across in the
  page's 690px column with each name clipped to 6px; it now keys that layout on its own width (a
  container query, `WIDE_CARD` in LiveGameView), which fixes the 650px dialog the same way. An
  unplayed game now lays the preview's Matchup, Leaders and Rosters out as three boards rather than
  behind a toggle, checked with a future game injected into the schedule from the console. Both
  are pinned in `__tests__/gameCenterPage.test.tsx`.
- ✅ **The panel header's name switch** (Oct 6), checked with screenshots forcing frames in the
  hidden preview pane. The suspected flash was real and was on the phone sheet too: the band was
  measured against the viewport, so a card still sliding in read as scrolled out and the header
  named the player for 220ms. Each band is now measured against its own scroller.
- ✅ **The page moves aside for the panel** (Oct 5). The column slides left as far as it needs to
  and never further than its own left gutter allows, with no change of width, so nothing reflows
  (`panelShiftSx` in ModalShell, which also publishes whether a panel is open, so a page that does
  not own the panel hears about it). WpblApp reads each surface's real width from
  [`layoutWidths.ts`](src/wpbl/layoutWidths.ts), so the wide ones (Home 1260, Stats 1540, the full
  Game Center 1260) move a little or not at all instead of off the left edge. Schedule at 1440px:
  the panel covered 260px of every row and now covers 13px; from 1536px it clears completely. The
  standalone pages (season recap, scorigami, the league page and the rest) do the same through
  `WpblPage`, by their own column width: the season recap moves 137px at 1440.
- ✅ **Expand keeps the board** (Oct 5): from Box Score in the panel, the page opens scrolled to
  the box score with `?tab=box`. A `?tab=` link holds its jump while the recap's videos load
  above it, which had pushed a box score 560px below where it landed.
- ✅ **A game link followed from the full page adds a history entry** (Oct 5), as a page should;
  only the panel swaps in place.
- **Box scores on the full page sit side by side from about a 1045px window**, not from `md`: the
  widest table is 23.6rem and an auto-layout table cannot shrink below its capped name column, so
  any lower floor scrolls one of them. Below that they stack, capped at 30rem.
- ✅ **A player's full page** (Oct 6): `layout="page"` on PlayerDetailModal, the desktop layout
  (every role in full) at the 1100px the desktop dialog was measured at, under the same
  `DetailPageBar` as the full Game Center. Reached by the panel's Expand and by a player link
  arrived at; a link naming a game too (`?game=`) keeps the game as the page and the player as the
  panel. Its log opens games as pages, pushed, so Back walks page to page. `playerPage` on the
  history snapshot, on `gamePage`'s terms.
- ✅ **Where a click came from decides the history** (Oct 6). A row clicked on the PAGE while a
  panel is open swaps the panel, whatever it held; a link followed INSIDE a card stacks, so Back
  returns to the card. The cards get their own openers (`openPlayerFromGame`,
  `openGameFromPlayer`; `fromCard` in App.tsx for the standalone pages). Before this, a player
  clicked on the page with a game panel open landed over the game behind a "‹ Game" control.
- ✅ **The ballot's ✕ and backdrop close the ballot** (Oct 6) with a player panel from it still
  open, instead of closing the panel (Back would). Not checkable in the browser until the ballot
  returns: it comes off Home after Oct 1, which also leaves `/wpbl/awards` opening onto a Home
  with no ballot on it.

---

## Search: what's next (Oct 14, 2026) 🎯⚙️

Site-wide, both sections. The box (`src/CommandPalette.tsx`, see ARCHITECTURE's "Search") now reads
names with typos and nicknames, Find questions, rankings, a year, two players, a club and a part of
its page, and a game or a WPBL pairing (v1.158.0, log below). What is left, roughly in the order
worth doing:

1. ✅ **Stat definitions** (Oct 14). "what is OPS+", "wRC+ meaning", "what does FIP stand for", or
   a term typed bare that cannot be a name or a ranking ("fip", "wrc+"), opens the section's
   glossary scrolled to the term, with its group switched on. Asked in words, the row comes first;
   bare, it waits behind the rankings. `askedTerms` in `src/league/glossary.ts`.
2. ✅ **Career and all-time** (Oct 14). "most hr all time", "career era leaders", "Whitmore
   career". MLB links its all-time board, but only on the sorts it fetches: it is the top 100 on a
   fixed list of career sorts, so "fewest hr all time" would rank the home run leaders and offers
   no row. WPBL has no every-season table, so its all-time row is the one-season table while there
   is one season and nothing after; an every-season board is what would take that further. A
   player opens on the career from either section (WPBL's card shows its one season until there
   is a second).
3. ✅ **The answer in the row** (Oct 14, v1.160.0). "Whitmore avg" puts ".312 AVG · 2026" in front
   of the player row's subtitle, for the first three player rows (`typedStat` in finderParse.ts,
   `resolvePlayerStat` on the bridge). A word for both sides ("strikeouts") is read on the side the
   player plays, and on the word's lean for a two-way player. WPBL answers from the lines search
   already reads; MLB makes one call per player, kept for the session, and answers a retired player
   with no year typed for the career.
4. ✅ **A peek at the leader** (Oct 14, v1.160.0). A ranking row says "Kelsie Whitmore leads with 9"
   (or "4 tied at 9"). It is the first row of the board the link opens, from that board's own
   columns and rules (`src/wpbl/statColumns.ts`, moved out of StatsView for this; MLB's `sortBoard`
   and qualifier), so the two cannot disagree. Recent keeps the row without the name, which would
   go stale. **Advanced stats too** (same release): OPS+, wRC+, wOBA, ISO, BABIP, K%, BB%, ERA+, FIP
   and K/BB in both sections, WAR and WPA on WPBL ("highest wrc+", "Whitmore war"). They are season
   figures only (`RANK_ALIASES` in finderParse.ts, which the Find parser never reads, since "2 war"
   is not a game). WPBL builds them with the table's own builders (`hittingColumns`,
   `pitchingColumns`, `OVR_COLS` in statColumns.ts), reading the run values only for wOBA, wRC+ and
   FIP and the play log only for WAR and WPA; MLB folds them in with the table's `withAdvanced`,
   reading sabermetrics only for wOBA and wRC+ and park factors only for OPS+ and ERA+. **MLB has no
   WAR**: "most war" there offers no row, because the site has no MLB WAR to rank. A career answers
   on MLB only the figures that need no league (K%, ISO and the like).
5. ✅ **Live games first** (Oct 14, v1.162.0). A club typed alone ("Dodgers", "SF score") asks the
   section's game lookup for today, and a game under way leads as "SF 3 at NY 2 · Live · Bottom 6".
6. ✅ **Clubs as the subject** (Oct 14, v1.162.0). "SF team ERA", "most runs by a team", "Dodgers hr"
   open the team stats board sorted on the stat (`parseTeamRankText`). MLB's Teams board has the
   plain columns only, so an advanced figure there offers no row.
7. ✅ **The other section** (Oct 14, v1.162.0). A name the section on screen cannot find is looked
   up in the other one, after the section found nobody and only for a plain name
   (`src/otherSection.ts`).
8. ✅ **A part of a player's page** (Oct 14). "Ohtani splits", "Whitmore game log" opens the card
   scrolled there, through `lib/sectionScroll.ts` as a club page row does: the game log, splits,
   pitch mix, advanced, fielding and contract on MLB; the game log, pitch profile, matchups, hit
   locations and fielding on WPBL (`src/lib/playerParts.ts`). The scroll is held for three seconds
   while the card's blocks land, since the first one measured scrolled and was then pushed 470px
   down. Not done: on a phone, a two-way player's other role's tab is not switched to, so "Ohtani
   pitch mix" there opens on whichever role is showing.
9. **Spans and splits.** "hr since August", "avg at home 2026" as a Find link with a date range,
   once the Find board takes one.
10. **Records and firsts.** ✅ Records (Oct 14, v1.162.0): "most hr in a game", "longest scoreless
    outing" open Bests at that card (`parseRecordText`), and the season ranking steps aside for
    single-game words. Firsts wait for a page to link: there is no Hall of Firsts yet.
11. ✅ **Questions in Recent** (Oct 14). A ranking, a Find question or a glossary term run from the
    box comes back in Recent, merged with the players and clubs by when each was opened
    (`src/lib/recentQuestions.ts`). On this device only: the sections' synced recents are typed as
    a player or a club, and an older client drops anything else as it writes the list back.
12. ✅ **Keyboard** (Oct 14, v1.162.0). Tab completes the lit row's name into the box, ready for
    " avg" after it; "?" lists everything the box understands.
13. **Examples from use.** Pick the idle examples from what readers ask, once the "Offered nothing
    for" list on /admin (live from v1.158.0) and the picks by kind have a few weeks in them.
14. ✅ **Measure the forgiving pass** (Oct 14). A pick of a row only the typo fallback found carries
    `forgiving: true`, and the Search box card says how many player and club picks it saved
    (migration `20261014194835`, not applied yet).
15. ✅ **Cache MLB name lookups** (Oct 14). `searchPlayers` keeps each name's answer ten minutes,
    shares a call in flight, and keeps no failure.

Two limits to keep in mind rather than fix. A player's name inside a Find question ("Whitmore 2
hr") is dropped from the Find row, because Find cannot filter by player; the name search beside it
finds the player. And MLB has no regular-season page for a pairing of
clubs, so "Cubs vs Cardinals" answers with their latest and next game only.

## Where new things go (decided Aug 27, 2026)

The section has four nouns: games, clubs, players, and **the league itself**. The fourth has
never had a home, which is why the media shelf sits on Home and the archive, the primer, the
glossary and the map have nowhere to be. Two containers, decided rather than drifted into:

- **Findings**, a chip on the Stats tab, for anything computed from the play log that ends in an
  answer: the steal economy, what a play is worth, what a count is worth, spray tendencies. One
  chip, however many cards. Shipped Aug 27. Rules for its cards are in the log entry above.
  **Folded into Run value on Sep 10, 2026 (v1.80.0)**: the container was right about its cards
  and wrong about being a destination, and the traffic said so. The rules survive in
  `src/wpbl/PlayValue.tsx`, which is also where the evidence is written down.
- **`/wpbl/league`**, for the durable half that is not a number: where the 118 players come
  from, the primer and glossary (#4), the inaugural-season archive (#2), the media shelf
  **moved off Home**, this-day, the awards ballot, the puzzle. All of it still works in
  February, which is more than the rest of the section can say. **Built and held back on Aug
  27**, not shipped: the page and the move both work, and the page wants another pass first.

**The league page gets no nav pill yet, deliberately.** It ships as a real path with real
sub-URLs, linked from the footer and one card on Home, and earns a sixth pill from the events or
does not get one. Two reasons: the top pills are already the least reachable place on an 812px
phone and the sixth used to sit off-screen entirely (see the note in
[`BottomNav.tsx`](src/wpbl/BottomNav.tsx)), and the footer is a proven crawl path, since it is
how Google found `/privacy` and `/terms` while `/mlb` sat undiscovered for months. Promoting it
later costs four lines; demoting it after it disappoints costs a redirect and an apology.

---

## The data-mining backlog (Aug 20, 2026)

Everything above was scoped from what the section is *missing*. This list came from the other
direction: reading the schema and querying production to find what is already **stored and
unread**. It is a menu to work through over the rest of the season and into the winter, not a
one-off, so nothing here gets deleted when it ships. It gets a ✅ and a pointer to the log.

Numbers are real, taken from the live DB on Aug 20, 2026 (16 final games, 1,527 plays, 393
batting lines, 766 tracking rows). Where a probe says "in the sample" it read 1,000 rows,
which is all PostgREST returns without paging.

> Re-run any of these with the anon key: `curl "$VITE_SUPABASE_URL/rest/v1/<table>?select=…"
> -H "apikey: $VITE_SUPABASE_ANON_KEY"`. Public-read RLS means the whole mirror is queryable
> from the shell in one line, which is how this list got its numbers.

### The three underused assets

**1. `pitch_events` / `pitch_sequence`: a pitch-level dataset nothing reads.** ✅ *shipped as
the Pitches board, Aug 20, 2026 (see the log)*. Six codes, 2,801 pitches in the sample: `B`
ball 1139 · `K` called strike 553 · `P` in play 542 · `F` foul 392 · `S` swinging strike 151 ·
`H` hbp 24. That is roughly 4,300 pitches across every final game, against TrackMan's 766 rows
across **two**. Three findings that made it cheap: `pitch_sequence` is the same data as a
string and agreed with `pitch_events` on all 739 rows that had both, so the string is the
whole read; both are null on exactly the plays that are not plate appearances (steals, wild
pitches, subs), so a row with a sequence is one completed PA with no double counting; and
`batter_id` / `pitcher_id` are only 2.4% and 1.4% null, so the play log keys on our own player
ids after all. **The feed's own `type` labels are wrong** and this is the trap: `K` arrives as
`"unknown"` and `P` as `"pitchout"`. Decode the code letter locally, never the label.

**2. Hit direction is in the narrative text, at near-total coverage.** 475 of 522 balls in
play in the sample name a fielder or a field (`ss` 69, `3b` 58, `lf` 53, `2b` 46, `cf` 44,
`rf` 39, …), and the 47 misses were "up the middle" and "to p" / "to c" phrasings the probe
regex did not cover rather than plays with no direction. That is a league-wide spray dataset
for **every** game, with no radar involved, sitting in a column already fetched for other
reasons.

**3. Base-out state plus `runsOnPlay()` gives run expectancy for free.** ✅ *shipped as the Run
value board, Aug 23, 2026, behind the experiments switch: see the log*. Every play stores outs and all three bases, and
summing runs chronologically reconstructs the score at each play. So RE24, and a WPA-shaped
leverage number, are derivable from our own 1,527 plays with no new field and no new table.
The table it produced is itself the finding: nobody on and nobody out is worth **1.13 runs** in
this league against roughly 0.5 in the majors, which is what makes a borrowed table unusable
here.

### The list

Tags as above: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra.

- **Play of the game / biggest swings of the season** 🔬🎮. ✅ *the engine shipped Aug 23, 2026
  behind the experiments switch; the biggest-swings list itself was built and cut, see the log*. Build the run-expectancy table from our own play log,
  rank every play by its RE change. It is also the honest half of win probability (#6) without
  needing a credible seven-inning win model, and every entry is a tappable name, which the
  traffic section says is the retention lever. **Still open**, and all of it now cheap because
  `derive/runExpectancy.ts` is pure and the values are already computed: a Game Center badge on
  the game's biggest play (the per-game play rows are already fetched there, so it costs no new
  request), a Home "swing of the day" card, which is the half of this that only works while
  games are being played, and the permanent top-10 in the archive (#2).
  The `batter_id` worry in the original entry is gone: 18 of 1,725 plays are missing one and
  every one of those is a pickoff or reached-on-error row rather than a plate appearance.
- **Spray charts on player pages** 🎯🔬. ✅ *shipped Sep 10, 2026, on player pages and
  `/wpbl/season` ([`SprayChart.tsx`](src/wpbl/SprayChart.tsx), from the play text)*. A fan diagram per hitter from asset 2, with
  pull/middle/oppo percentages, and the inverse for a pitcher. Lands on the surface that
  correlates with return visits.
- **Daily "Call the Play" puzzle on the site** 🎮. [`derive/trivia.ts`](src/wpbl/derive/trivia.ts)
  is already written, pure and seeded, and only Discord can reach it. Seed it from the date so
  everyone gets the same play, add a shareable result grid. ~980 usable plate appearances is
  about three years of daily puzzles, and it needs no live feed. **The strongest durable item
  on this page after the archive.** *First on the winter order (Sep 27): see Next.*
- **This day in the inaugural season** 🎯. A dated card replaying that day's recap, box,
  highlight reel and article. Everything is already mirrored (75 videos, 20 articles). Turns
  the archive from a static page into a daily surface.
- **Fan awards ballot** 🎮🎯. Every player in the league is a rookie and nobody has voted on
  anything. MVP, best pitcher, play of the year seeded from the leverage list. Uses the
  existing browser-writes-through-RLS path, and it *peaks after Sep 22* rather than dying with
  the feed. **Half built, Sep 6, 2026**: 13 categories in
  [`awards.ts`](src/wpbl/awards.ts) (five the numbers can argue about, eight only a fan can
  settle), shortlists in [`derive/awards.ts`](src/wpbl/derive/awards.ts) that reuse the MVP
  race, the run-expectancy table and the win model rather than inventing a second number for
  anything, the votes table and its two aggregate-read RPCs in
  `scripts/migrations/20260906214500_add_wpbl_fan_awards.sql`, and the client in
  [`awardVotes.ts`](src/wpbl/awardVotes.ts). **What is left is the surface**: the ballot and
  the running tally on `/wpbl/league`. The migration is applied. **Its write path was broken
  and is fixed** (Sep 7): the client upserted, which this table cannot accept, so no vote it
  ever took would have been stored. Go through `castWpblAwardVote`, which now calls
  `wpbl_cast_award_vote`; see the Sep 7 log entry. The bracket pick'em is the first surface
  on the ballot and is a working example of the whole path.
  One vote per browser (the analytics localStorage id), opening the day after the last
  regular-season game and closing Sep 23, except "Build Around Her", which stays open until
  spring and is the only thing on the section that still takes an answer in January.
- **Who owns whom: the batter-vs-pitcher board** 🔬. Four teams and six pairings means the same
  hitter and pitcher meet again and again, but the samples are smaller than this entry used to
  claim: across the 2026 regular season the most any pair met is 10 times, 85 pairs met 5+ times
  and 314 met 3+. Anything drawing a duel should lead with PA and the counts, not an average.
  ✅ **Shipped, three surfaces**: the comparison page draws ONE pair (Sep 12), the player card lists
  every opponent from both sides of the plate (Sep 28), and `/wpbl/matchups` is the league-wide
  board (Sep 28). Next is a "vs this pitcher" line on Game Center's Live tab for spring 2027, which
  first has to decide whether it means this season or a career, and that decision belongs to the
  multi-season work (#2), since these tables will mix 2026 and 2027 the day the first 2027 play
  lands.
- **Season series pages** 🎯. Six rivalry pages: running series record, the H2H grid, the
  matchup edges, every game log. Six durable indexable pages from data already held.
- **Where they come from** 🎯. `hometown` on 118 players and `birth_date` on 65: a league map,
  an age curve, youngest and oldest. Indexable prose and images for a section that has almost
  none, which feeds SEO (#3). **Coverage recheck Aug 27: `hometown` is on all 118 and
  `birth_date` on 106**, and the tail is the story: USA 64, Canada 18, then Mexico, Australia
  and Japan on 9 each, South Korea 4, and one player each from Venezuela, the UK, France,
  Puerto Rico and Curacao. Ages 18 to 40, median 24.
- **Rolling form** 🎯. A last-5-game OPS sparkline per player. Nothing on the section answers
  "who is hot right now".
- **Fielding in the Stats tab** 🔬. 303 fielding lines, computed in `stats.ts` already, surfaced
  only on player and team pages. Also unlocks a catcher board from `sba` / `cs`. (Same item as
  #7, restated here because the data audit reached it independently.)
- **Errors behind the pitcher** 🔬. Unearned runs and errors charged while each pitcher was on,
  from fielding lines plus narratives. Nobody else covering this league will have it.
- **What every kind of play is worth** 🔬. ✅ *shipped Sep 11, 2026 on the Run value board
  ([`PlayValue.tsx`](src/wpbl/PlayValue.tsx))*. The league's own linear weights, already computed by
  `playRunValues` and never shown: home run +1.55, double +0.82, single +0.54, walk +0.34,
  groundout -0.43, strikeout -0.52, double play -0.97, and the sacrifice bunt at **-0.00 runs
  across 14 attempts**. One small table settles "should they bunt" and "is a strikeout worse
  than a groundout" for this league rather than by analogy to the majors. (Data audit, Aug 27.)
- **What a single pitch is worth** 🔬🎯. ✅ *shipped Sep 10, 2026 as the count board on Run
  value*. Counts reconstruct cleanly from `pitch_sequence`, 5,657
  pitches, and nothing uses them: after 1-0 a hitter reaches base 48.4% of the time, after 0-1
  37.2%. **Eleven points of on-base on one pitch.** League first-pitch strike rate is 53.6%,
  and per-pitcher it separates (Kelsie Whitmore 72.0%, Gigi Schiano 43.2%), though only nine
  pitchers have faced 60 batters. `derive/pitches.ts` decodes the letters already and stops
  short of the count. (Data audit, Aug 27.)
- **Direction on every batted ball, from the prose** 🔬. 973 of 1,489 plate appearances name a
  fielder or a field in the narrative ("grounded out to 3b", "singled through the left side"),
  which crossed with `event_type` (groundout / flyout / popup / lineout) is a batted-ball
  profile for the whole season with no new ingest. Ground rates separate pitchers cleanly:
  Jill Albayati 69.2% on the ground, Raine Padgham 34.4%. Per batter it is thin, ~26 located
  balls for a regular, so this is a pitcher and team surface before it is the spray chart
  above. (Data audit, Aug 27.)
- **One ballpark, all season** 🎯. Worth confirming and then saying somewhere: the feed names a
  venue on 2 of 30 rows and RetroWPBL names one park on all 15 it covers, and they are the same
  Springfield ground. If that holds, "home" in this league means batting last and nothing else,
  which is context for every home/away number on the section. The record is consistent with it:
  the home side is 8-21 and scores fewer runs, 7.33 to 7.57. (Data audit, Aug 27.)
- **The season in 30 seconds** 🎯. Each club's W-L path and run differential over time as one
  chart, from 30 game rows. Makes a good share image.

### Visuals (Sep 13, 2026)

A second pass at the same data, asking what could be DRAWN rather than tabulated. Nothing here
repeats a chart that already exists (season shape, win probability, spray, team radar, pitch
location, the count and take/swing boards). Three of these extend entries above rather than
replacing them, and say so. Suggested first two: Scorigami and the count subway map, because
both are cheap, survive Sep 22 and make a share image.

**Durable**

- ~~**WPBL Scorigami** 🎯🎮. A grid of every final score, lit the first time it happened and linked to
  that game. In an inaugural season every score is a first, so the grid is mostly dark and fills in
  next year. From `wpbl_games` alone; postseason finals count here, since a score is a score.~~
  ✅ *Shipped Sep 13, 2026 as `/wpbl/scorigami` (see the log).*
- ~~**Road to Springfield**. Arcs from all 118 hometowns converging on the one ballpark.~~ ❌
  *Dropped Sep 30, 2026: illustrative map art and motion pieces are an artist's work, not
  something to generate. See the winter order.*
- **The count as a subway map** 🔬🎯. The 12 counts as stations, edge thickness for how many
  plate appearances traveled it, color for on-base rate from there. Draws "What a single pitch is
  worth" above: the 1-0 against 0-1 split (48.4% vs 37.2%) becomes a visible fork.
- **Umpire zone personalities** 🔬. Called-strike rate per plate umpire, `K` against `B` from
  `pitch_sequence`, keyed on `umpire_crew`. Only as wide as RetroWPBL's coverage (20 of 25 finals
  on Sep 1), and it must read the STARTING plate umpire per inning, not the crew list, since one
  game swapped the plate umpire in the 6th.
- **Pitcher barcodes** 🎯🔬. A pitcher's season as a strip of colored ticks, one per pitch (ball,
  called strike, whiff, foul, in play). An attacker and a nibbler look different before a number is
  read. Doubles as share-card art.
- **Game quilt** 🎯. Every game's win-probability line as a small tile, ordered by `excitement`.
  Tap a tile to open the game. *The top six of it shipped Oct 11 as "The wildest games" on
  `/wpbl/season`, each with its line; the full grid of all 40 is what is left.*
- **Who owns whom, as a web** 🔬. Batters and pitchers as nodes, edges weighted by plate
  appearances and colored by who won the matchup. A drawn form of the league-wide board still
  open under "Who owns whom" above; four clubs make the web dense enough to read.

**Postseason, while games are still being played**

- ~~**When the runs come** 🎯. Runs by inning per club as a heatmap, regular season beside the
  postseason. From the line scores.~~ ✅ *Shipped Sep 14, 2026 as Runs by inning on `/wpbl/season`
  (see the log).*
- **Longest battles** 🎮. The season's longest at-bats drawn pitch by pitch, foul after foul, to the
  result. From `fouls` and `pitch_sequence`.
- **Tug of war** 🎮. A small rope per bracket game that moves on every lead change, sized to sit on
  the scoreboard strip.

**Odd, and real**

- **The league's edit history** 🔬. A diff-style timeline of what the league changed on a box score
  after final, from `wpbl_game_revisions`. Read-only by nature, and the only record of those edits.
- **Hear the game** 🎮. A game's win probability as a rising and falling tone, a click on each run.

## Player charts (Oct 20, 2026) 🎯🔬

Every player on two stats at once, the shape a table sorted by one column cannot show. MLB's
`/mlb/charts` plots the 30 clubs; four clubs make a thin plot, so WPBL's dots are players. The
frame is shared: [`src/ui/charts/`](src/ui/charts/) holds `ScatterPlot` (every dot a real link, a
tap pins the card before a second tap opens the player, a viewBox about the width it is drawn at so
the type stays readable on a phone), MLB's tooltip and `niceTicks` moved there from `src/mlb/`, and
`scale.ts`, the axis and guide arithmetic with no React in it, so `scripts/visuals/` can draw the
same axes for a share image.

**Shipped (v1.174.0):** Stats › Analysis › **Charts** (`/wpbl/stats?board=charts`, a query param,
so no new route), [`ChartsView.tsx`](src/wpbl/ChartsView.tsx) over
[`derive/charts.ts`](src/wpbl/derive/charts.ts). The side switch picks the charts: Hitting is
OBP vs SLG (OPS lines across it) and Swing% vs Contact%; Pitching is ERA vs FIP (with the ERA =
FIP diagonal) and F-Strike% vs BB%; Overall is Pos WAR vs Pit WAR for two-way players, the one this
league can ask and MLB barely can. Regular season only, qualified players by default (the Players
table's bars), from the stored seasons and the Pitch by pitch board's play log, so the board reads
nothing new. Labels only, no subtitles (the copy rule in CLAUDE.md, Oct 21, 2026).

**Next, in order:**

- **A player's dot on their own page.** The OBP-SLG or ERA-FIP chart with that player highlighted
  and everyone else gray, under the stat table.
- **One headline chart on `/wpbl/season`**, OBP against SLG, linking to the board.
- **Share images.** Two-way players first (Kelsie Whitmore sits alone in the top right), through
  `npm run visual` using `scale.ts`. Recheck every number against the full season first.
- **More pairs, each a chip on the board once there are more than two a side:** K% against BB%
  (hitters); pitches per PA against OBP; wOBA against RE24 (who did more with men on); RE24 against
  WPA (when it mattered); OPS against left-handers and right-handers (platoon); batting runs against
  baserunning and fielding runs; whiff rate against strike rate (pitchers). Groundball against
  flyball pitchers and the age curve on the visuals menu below are the same frame.
- **MLB's three team plots onto `ScatterPlot`**, which brings them the tap-to-pin and real links,
  and DraftValue's hand-drawn scatter with them.
- **Not planned:** a club highlight. A season total carries no club, and a traded player's club is a
  fact about a date (`src/wpbl/CLAUDE.md`), so coloring by `team_id` would put a traded player's whole
  season on the club they finished with.

## Offseason visuals (Sep 24, 2026)

A share series for Bluesky and Reddit, posted as "Offseason Visual #N" once or twice a week
through the winter. **This is a menu, not a schedule: the owner picks which one is next, every
time**, and nothing here is committed to or in order. Posted so far: #1 the hits bar chart race
(screen-recorded from the season page). Road to Springfield was dropped Sep 30, 2026 and is
not on the menu.

**How one gets made.** `npm run visual -- <slug> --n <number>` renders a visual from
[`scripts/visuals/`](scripts/visuals/) into `share/visuals/<slug>/` (gitignored) at three sizes:
1200x630 (Bluesky, link previews), 1080x1350 (Instagram feed, Discord, Reddit), 1080x1920
(stories). An animated one gets an .mp4 and a .png of its last frame, a static one the .png
alone. The series frame (the "Offseason Visual #N" tag, the title block, the footer, the three
layouts) lives in [`scripts/visuals/kit.ts`](scripts/visuals/kit.ts), so a new visual draws only
its own chart. **Re-check every number against the full season before it goes on an image**: the
figures below come from roadmap audits made with about 30 games in the mirror, and the season
finished at 40 finals plus the postseason.

**Where to post.** r/dataisbeautiful wants an [OC] tag and a comment naming the source and the
tool; r/sabermetrics suits the run-value ones; r/baseball the history and player ones. Link each
post to the site page it comes from, which is also the backlink work in docs/BACKLINKS.md.

**Ideas**, tagged 🎞️ animated or 🖼️ static:

- 🎞️ **Every home run of 2026.** Each homer drops onto a drawn field toward the side the play text
  names ("homered to left"), in date order, with a counter and the hitter's name.
- 🎞️ **Strikeout bar chart race.** The pitching twin of #1.
- 🎞️ **Scorigami fills in.** The grid lights up game by game in date order and ends mostly dark.
- 🎞️ **Every pitch in 30 seconds.** Each pitch of the season falls into a ball, called strike,
  whiff, foul or in-play pile.
- 🎞️ **Game quilt.** All 40 win-probability lines as tiles, dullest to wildest (`excitement`),
  then the wildest drawn out in full.
- 🎞️ **Longest at-bat, replayed** pitch by pitch with count bulbs, foul after foul.
- 🎞️ **Standings as a horse race.** The standings-by-date chart on `/wpbl/season`, recorded.
- 🎞️ **The stolen-base economy.** Runner dots sprint from first to second, the safe and the caught,
  then this league's break-even rate.
- 🎞️ **Tug of war** for each game of the final, a rope that moves on every lead change.
- 🎞️ **Hear the game.** The final's win probability as a rising and falling tone, a click on each
  run. A video with sound.
- 🖼️ **What every play is worth.** The league's own linear weights; the sacrifice bunt was worth
  -0.00 runs across 14 attempts (August figure).
- 🖼️ **Hall of Firsts timeline.** First hit, home run, win, save, walk-off, as one poster.
- 🖼️ **Run expectancy diamond.** The 24 base-out states as diamonds; bases empty with nobody out
  is worth about 1.1 runs here against about 0.5 in MLB.
- 🖼️ **The count as a subway map.** On base 48% after 1-0 and 37% after 0-1 (August figures).
- 🖼️ **Anatomy of the championship.** Game 5's win-probability line annotated with its swings.
- 🖼️ **Pitcher barcodes.** Each pitcher's season as a strip of ticks, one per pitch.
- 🖼️ **The chaos index.** Balks, wild pitches, passed balls and hit batters per game against MLB
  rates. Affectionate, not mocking.
- 🖼️ **Where the runs came from.** Every run by how it scored, and the share that never came off
  the bat.
- 🖼️ **Groundball vs flyball pitchers**, a named scatter from the batted-ball type in the play text.
- 🖼️ **Who owns whom.** The batter-vs-pitcher duels as a web.
- 🖼️ **Age curve**, 18 to 40, against OPS.
- 🖼️ **The data All-WPBL team**, drawn on a diamond.
- 🖼️ **The league's edit history.** What changed on box scores after final, as a diff
  (`wpbl_game_revisions`, which only we hold).
- 🖼️ **The season calendar**, a heatmap of every game day.
- 🖼️ **Home was not an advantage.** One ballpark all season, so "home" only meant batting last.

## Far off: women's baseball beyond the WPBL 🔬⚙️

Moved to its own document on Oct 15, 2026: **[ROADMAP-WOMENS-BASEBALL.md](ROADMAP-WOMENS-BASEBALL.md)**.
The first step touches this section: a WPBL player's page shows their World Cup lines (32 of 118
players were in the 2026 group stage).

---

## Parked, with reasons

- **Game predictions / pick'em (+ bots)** 🎮: *demoted from "the marquee open item",
  where it sat unstarted from Aug 4 to Aug 16.* With 12 games left, a Wilson-ranked
  leaderboard over ≤12 picks is statistical noise, and it is the largest build on the list
  (pick UI + grading + boards precompute + a daily bot Action). Its value decayed past its
  cost for *this* season. Revisit for **2027 Opening Day**, when it gets a full season to
  accumulate against. Or ship a stripped "pick today's winner + running record, no
  leaderboard" if the appetite is for something now.
- ~~**Multi-season support**~~: ✅ *unparked and built Oct 13, 2026* (Priorities P0).
- **Followed players / teams + notifications**: dropped as low-value for a four-team
  league. The per-game and all-games push reminders already cover the real need.
- **Favorite team + team color theming** ⚙️🎯: *built Aug 17, 2026, parked the same day
  on branch `wpbl-favorite-team`.* Working end to end, not shipped: the theming isn't
  settled. What's on the branch: a one-shot Home prompt that never shares a screen with
  the Discord card, a ★ toggle on each team page, "no favorite" as a real answer that
  never re-prompts, and a section that takes the team's color (solid nav chip, radial
  masthead, ~4% card wash, tinted card hairline, and `theme-color` for the phone's browser
  chrome). Contrast is measured per team rather than assumed, since a fixed white nav label
  fails WCAG AA on **seven of the eight** team/theme pairs.
  **Why it's parked, and the thing to solve first:** in a 30-game season, anything that
  prioritizes your club takes more away than it gives, because every game is a big slice of the
  whole. That is why the pick only ever *adds* color and never hides, reorders, or
  demotes the other three. That constraint leaves color doing all the work, and color
  alone didn't feel like enough to justify the ask. Two concrete problems to fix before
  unparking: **Heights blue (`#5bb2ec`) is nearly the league default (`#60a5fa`)**, so a
  quarter of the audience picks a team and sees almost nothing change; and a team page
  still shows its *own* club's colors in the body while only the chrome follows your
  favorite, which is defensible but was never actually decided.
  The DB column (`user_preferences.wpbl_favorite_team_id`) **is already on main and applied
  to production**: it shipped alone because it had been applied before the feature was
  parked. It is nullable and nothing reads it.
- **Ingest play-level `batter_id` / `pitcher_id` backfill**: ✅ **answered by measurement,
  Aug 22, 2026, and it was never as bad as this entry assumed.** The premise was that
  `resolveName` being exact-only leaves these null on any name variant. Counted over the whole
  play log: `batter_id` is null on **18 of 1,725** plays and `pitcher_id` on none, and all 18
  are `event_type: 'unknown'` rows (pickoffs, reached-on-error) rather than plate appearances.
  The Run value board reads the linkage directly and needs no name fallback. Nothing to unpark:
  win probability (#6) can assume the ids are there.
- **Game duration**: ✅ **unparked and shipped Aug 21, 2026**, from a source outside the feed.
  The original finding still stands for the league's own feed: no duration or first-pitch
  field, `completed_at` is a processing timestamp, plays carry no timestamps at all. RetroWPBL
  records `starttime` and `timeofgame` by hand and we now have permission to use it (see the
  log). Available only for games somebody has transcribed, which trails the schedule.
- **Streak report cards, Milestone Watch, WPBL Streak Survivor** 🎁: the remaining fun
  MLB mechanics. All want more season history than a six-week inaugural year provides.

---

## Ongoing hygiene & ops

- **Name-mangling audit.** ✅ *Esthela Segovia corrected Aug 24, 2026* (was "Estheoa";
  migration `20260824120000_fix_estheoa_segovia_name.sql`). She was a seed-only row with no
  feed id and no games, so a guarded `UPDATE` was safe and the ingest will not revert it.
  Watch for the next such case: same family as the issues
  [`names.ts`](supabase/functions/wpbl-ingest/names.ts) handles.
- **Portrait rights.** Ask the league for permission to republish player headshots. Open
  since the portrait work, and more pressing now that shared player links unfurl with them.
- **Triage the nightly scoring check.** `wpbl-pbp-validation` runs at 08:00 UTC and records
  its health to `/admin` (Clean / N new / Stale / Failed). It deliberately never fails the
  job, so nothing shouts: the state to act on is **Stale**, meaning the run went missing.
  New findings get either a correction in `wpbl_play_corrections` or a baseline update.
  **44 findings accepted as known, re-triaged Sep 1, 2026** (was 57 from Aug 17). See
  [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md). The one finding in there that a
  human could still act on is the **Aug 20 NY at BOS** game, where the league's own play log
  is short about a dozen NY plate appearances, never records an out in either of the last two
  top halves, and lands a run under the final score. Everything else is the ordinary scoring
  sloppiness the baseline exists to hold.
- **Watch that the drift check stays green.** `wpbl-drift-check` runs at 07:30 UTC and, unlike
  the validator beside it, is allowed to fail: red means a game the feed and the mirror
  disagree about did not reconcile when re-ingested, which is the one case needing a person.
- **Re-baseline the RetroWPBL stats check when it goes red, and do it promptly.**
  `wpbl-retro-stats-check` reports only disagreements it has not been told about, so red means
  a person should look and then accept or act. Triage the findings, then
  `--update-baseline`, which REPLACES the list rather than appending: a disagreement the
  transcriber has since fixed drops out, which is the point. It went red on Sep 3, 2026, the
  day after it shipped, and stayed red for five days, because the baseline was taken fifteen
  minutes before RetroWPBL pushed a round of fix-ups. That is the muted-alarm failure the job
  was written to avoid, arrived at from the other direction.
- **Periodic dupe / orphan audit** of players and games; the ingest has produced duplicate
  roster rows before (bad decode, tz-twin games) and each was caught by hand.
- **Birth dates: 65 of 118 players.** The community sheet does not cover everyone.
  *Evaluated and declined (Aug 16):* RetroWPBL's `biofile.csv` would fill 37 of the 53
  gaps, but it carries no license (all rights reserved by default), 6 of its dates are
  year-only, and 13 disagree with our sheet, 5 of those as clean day/month transpositions,
  meaning one of the two sources has ambiguous date formatting. Not worth ingesting.
  Revisit only if we get explicit permission *and* a way to adjudicate the conflicts.
  **Closed Aug 21, 2026, and not by the permission.** Permission was granted, and re-checking
  the biofile against production the case had evaporated anyway: our own coverage is 106 of 118
  now, not 65, the biofile agrees on 104 of them, and it fills **zero** gaps, because the 12
  players we have no date for it has no date for either. One row disagrees (Luciana Moreno: we
  hold 2006-09-09 marked `doc-unsettled`, they hold 2006-09-06), which is a judgment call
  about two weak sources rather than a reason to ingest anything.

---

## Background: architecture and locked decisions

**The league.** Inaugural season Aug 1 – Sep 6, 2026, postseason Sep 9 – Sep 22. Four teams
(Boston Hunters, LA Queens, NY Heights, SF Firebells), 30 regular-season games (15 each), all
at one hub venue (Robin Roberts Stadium, Springfield IL). **Seven-inning games**, and ERA and the
strikeout rate are computed over **7** to match, which is what the league itself now publishes.
It was 9 until early September 2026, when the league switched its own stat page and this
followed it, verified against that page rather than assumed (see the Sep 3 log entry, and
`ERA_BASIS_CANONICAL` in [`stats.ts`](src/wpbl/stats.ts), which is the one definition of it). A
reader can switch to 9 in Settings, and nothing that leaves the site does. **Postseason:** all four teams qualify · semifinals best-of-3 ·
finals best-of-5, so 7–11 games follow Sep 6 (up to 8 more for a finalist).

**The published postseason schedule.** Every game 7:30 p.m. ET on ESPN+. An asterisk is
if-necessary. **The league also designates a home club for the six semifinal games** and for none
of the championship's five, which is on `POSTSEASON_SCHEDULE` as a seat: higher seed bats last in
games 1 and 3, lower seed in game 2. Every game is at the one hub venue, so that is a batting
order and not a building. **The feed stores start times in Central** (`WPBL_TZ` in
[`constants.ts`](src/wpbl/constants.ts)), so 7:30 ET arrives as `6:30 PM`, identical to the
regular-season slot: nothing keyed on the clock needs moving, and the cron windows already
cover it.

| Date | Round | | Date | Round |
|---|---|---|---|---|
| Wed Sep 9 | Semifinal A, G1 | | Wed Sep 16 | Championship, G1 |
| Thu Sep 10 | Semifinal B, G1 | | Thu Sep 17 | Championship, G2 |
| Fri Sep 11 | Semifinal A, G2 | | Sat Sep 19 | Championship, G3 |
| Sat Sep 12 | Semifinal B, G2 | | Sun Sep 20 | Championship, G4\* |
| Sun Sep 13 | Semifinal A, G3\* | | Tue Sep 22 | Championship, G5\* |
| Mon Sep 14 | Semifinal B, G3\* | | | |

Note the two dark days, Sep 15 and Sep 18, and that Championship G3 skips Friday. Anything
that infers "the season is over" from a gap in the schedule has to survive a two-day one.

**The Discord watch parties for all eleven are already up**, named for the slot rather than
the clubs (`Semifinal A Game 1`), because an event is only worth having if it exists early
enough to RSVP to and nobody knows the matchups yet. `wpbl-discord-postseason` renames each
one as the bracket fills in, follows a first pitch that moves, and deletes the asterisked
games a clinched series never plays. See [`docs/DISCORD.md`](docs/DISCORD.md).

**Architecture, pivoted twice.** It began as owner hand-entry with Supabase as the source
of truth. In Aug 2026 the league published a public JSON feed at
`stats.womensprobaseballleague.com/v1`, so the model flipped to a **feed mirror**: the
`wpbl-ingest` edge function pulls on a cron and upserts games, box-score lines,
play-by-play and TrackMan tracking; the public reads the mirror. Hand-entry (`GameEntry.tsx`)
is retired.

**Locked decisions:**
- **WPBL-native components.** Lean components built for a small dataset, rather than forcing
  WPBL data into StatsAPI-shaped types. Borrow the site's *conventions* (team-color map,
  modal pattern, compact tabular-nums tables) so it still feels like one site.
- **The section is self-contained.** `src/wpbl/` has no MLB coupling; the shell (auth,
  search, notifications, theme, units) is the only shared surface.
- **Two write paths only**: browser-through-RLS for user rows, service-role for everything
  ingested or derived. See `CLAUDE.md`.

**Live gotchas worth remembering:**
- The recap engine (`derive/recap.ts`, `derive/discordRecap.ts`) is loaded by three builds
  including **Deno**, so its runtime imports need explicit `.ts` extensions and it must
  never import `constants.ts`. See `CLAUDE.md`.
- A **vendor-chunk split** (`manualChunks` splitting MUI/React) was tried and **reverted**:
  it produced a circular import that blanked the page on a fresh load. Any retry must keep
  React + MUI + emotion in one chunk and be browser-verified first.
- TrackMan coverage is partial and radar-based: home runs leave the park and often go
  unmeasured, so an absent HR on a distance board is a data gap, not a bug.

---

## Shipped log

The dated log of what shipped lives in [`docs/roadmap-log/`](docs/roadmap-log/), one file per month,
newest first. A new entry goes at the top of the current month's file (start a new file when the month
turns). The changelog in [`src/changelog.ts`](src/changelog.ts) holds the per-version detail.

- [Oct 2026](docs/roadmap-log/wpbl-2026-10.md)
- [Sep 2026](docs/roadmap-log/wpbl-2026-09.md)
- [Aug 2026](docs/roadmap-log/wpbl-2026-08.md)

## Realignment log

**Sep 24, 2026: realigned for the offseason.** The clock now says the season is over and grades
by durability alone; "Where the section stands" describes the offseason surfaces; the shipped log
is caught up from Sep 15 in one summary entry, since the changelog holds the detail; #5b is marked
shipped; the flag notes are corrected (it hides only the Run value steal card).

**Aug 16, 2026: split out of `ROADMAP.md`; reprioritized around the season clock.**
The WPBL section had outgrown living as an appendix to the MLB roadmap, and that doc's WPBL
entries had gone six days stale while v1.33 → v1.43 shipped. Changes to the plan, not just
the filing:

1. **Postseason data hygiene promoted to #1**: from "deferred, low stakes" to the lead
   item, and reframed. The old reasoning judged the *drama* of a bracket where everyone
   qualifies, and on that it was right, and a clinch tracker stays parked. But it never asked
   whether the code works, and it doesn't: the season-stat aggregation takes lines with no
   game context, so it *cannot* exclude a postseason game, and `counts_in_standings` is
   stored and never read. With semis best-of-3 and finals best-of-5 (format confirmed
   Aug 16), that's 7–11 games, up to 8 for a finalist against a 15-game season, landing
   unevenly on every leaderboard on the site. Only item here with a date we don't control.
   Split out **1b, series state**, as the postseason feature that does earn its keep.
2. **The season archive promoted to #2**: the section has no answer for Sep 7 onward, and
   parts of the answer must be captured while games are still being played.
3. **Predictions / pick'em demoted to parked**: it held the "marquee open item" label for
   twelve days without being started, which is itself a signal. Three weeks of games is not
   enough runway for a leaderboard, and it's the biggest build on the list.
4. **Search Console and the league primer moved up**: both are cheap, both are worth
   most during the season, and the primer feeds the SEO work.
