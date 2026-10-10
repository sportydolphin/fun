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
- **Loading states: every one is the loaded page drawn empty, so nothing moves when content
  lands.** That covers index.html's static toolbar, each tab's skeleton, and any card's own
  loading branch. Each must take exactly the box its content will: the same title in the same
  place (a title needs no data, so draw the real words), the same padding, badge sizes and row
  heights. Build them from the components the loaded view uses (`TabTitle`, `SectionLabel`,
  `radarBox`), not from hand-picked numbers. A one-line "Loading." in a card that will hold a
  chart is a jump. Where the shape depends on data nothing has yet, reserve the most likely
  shape; the calendar alone can tell the offseason (`offseasonByCalendar`). **Measure it; don't
  judge it by eye.** Load with `?devSlowMount=3000` (the static bar) or `?devSlow=2500` (the
  skeletons; 8s trips the request timeout and shows "No teams yet"), see
  [`src/dev/slowLoad.ts`](src/dev/slowLoad.ts), and compare element rects against the loaded
  page at 375, 760, 960 and 1440. A hidden browser pane records no layout-shift entries, so
  compare rects rather than trusting CLS. It also fires no `requestAnimationFrame`, even while it
  reports itself visible, so anything scheduled on one (a scroll, a measurement) never happens
  there: check those in Playwright's Chrome, as the sweep does. `npm run sweep -- --shift` does exactly this against the
  dev server ([`scripts/layout-sweep.mjs`](scripts/layout-sweep.mjs)); `--routes` narrows it.
  **CI runs it on every pull request** (the `layout` check, four parallel slices) from a recorded
  snapshot of the data, with the clock frozen at the moment it was taken. A query the snapshot
  lacks fails the job, so a change to what a page fetches comes with `npm run sweep:record`, run
  against real data, and the new `scripts/fixtures/layout-sweep.json.gz` in the same pull request.
  The accepted-findings baseline is empty: fix a finding, don't baseline it. A failure CI sees and
  your machine doesn't is CI's slower runner catching a real loading phase; reproduce it with
  `--cpu 4` and the job's `sweep-shots` artifact ([docs/CI.md](docs/CI.md)).
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
  table. See [`docs/PLAY_VALIDATION.md`](docs/PLAY_VALIDATION.md). **The one table that is
  the opposite is `wpbl_game_revisions`**, which records what the league changed after a
  game went final. It is append-only, written by a single call inside
  [`scripts/check-wpbl-drift.mjs`](scripts/check-wpbl-drift.mjs) that must stay BEFORE the
  repair, and nothing can regenerate it: the repair replaces the old scoring and the feed
  only ever serves the current version, so rebuilding this table would empty it in silence.
- **A PostgREST `.upsert()` needs a SELECT policy, and `wpbl_award_votes` deliberately has
  none.** An upsert becomes `insert ... on conflict do update`, and Postgres applies the
  SELECT policies to the conflicting row on that path, so the statement is refused even when
  there is nothing to conflict with. It fails as **"new row violates row-level security
  policy"**, which points at WITH CHECK expressions that are both literally `true`, and a
  plain `.insert()` of the same values succeeds. The fan-award ballot shipped this way on
  Sep 6, 2026 and every vote it ever took went nowhere; nothing noticed, because the ballot
  had no surface yet and a table at zero rows looks exactly like a poll nobody has voted in.
  Writes now go through `wpbl_cast_award_vote`, security definer, on the same footing as the
  two read RPCs beside it. **Any table whose rows the browser must not read cannot be
  upserted into by the browser**: give it a writer function instead.
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
  **Four more things take the schedule for the same reason, and every one of them was found
  leaking the day the first postseason game went final**: `buildPositionIndex` /
  `displayPosition` / `positionsPlayed` in [`positions.ts`](src/wpbl/positions.ts),
  `aggregateTracking` in [`tracking.ts`](src/wpbl/tracking.ts), and `headToHead` in
  [`derive/matchups.ts`](src/wpbl/derive/matchups.ts), which claimed "the same rule as
  computeStandings" in its own comment while applying only the decisive-final half of it, and
  drew San Francisco 6-0 over Boston one row above a standings table reading 10-5. The position
  one is the subtle shape: counting a playoff start did not ADD a position, it broke the strict
  majority Kelsie Whitmore held in centre field, so `primaryPosition` returned null and her
  label fell back to the roster listing that module exists to override.

- **A player's feed id is not the player, and a player's team is a fact about a DATE.** The
  league mints a NEW `player_id` when someone changes club (Diana Ibarra is `moizfkn9…` on New
  York and `27svefz4…` on Los Angeles, both ACTIVE, `career_id` empty on both), so nothing in
  the payload says they are one person. Left alone, the ingest inserted a second Diana Ibarra
  and split her season 8 games to 1, which is not merely a duplicate: the slug rules in
  [`routes.ts`](src/wpbl/routes.ts) correctly decide a shared name is ambiguous, so her
  canonical `/wpbl/players/diana-ibarra` started answering 404 and the Discord bot started
  offering a "did you mean" for someone who exists once. `wpbl_players.api_ids` now holds every
  id a person has held and the resolver matches on any of them. Two consequences to keep:
  **`team_id` on a roster row means "now", never "then"**: a game log, a team page, or a Hall
  of Firsts badge must take the club off the box-score line or the play, both of which carry
  the team that game was played for, or a traded player's July reads as if she spent it
  somewhere she had not arrived yet. **And it is not only the club: it is whether she is on the
  sheet at all.** A line carries a `player_id` and nothing else, so any name map built from the
  two clubs' CURRENT rosters simply omits her and every name falls through to `'—'`. Game
  Center did this until Sep 6, 2026: the pitcher who threw six innings and won NY 14-2 on Sep 4
  was a dash in the winning-pitcher line, a dash as a Star of the Game and a dash in the
  pitching table, because her roster row had been moved to another club. Build these from
  `fetchWpblAllPlayers` (cached app-wide, so it costs nothing) and keep the club rosters only as
  the cold-failure floor. Pinned in `src/wpbl/__tests__/gameDetailNames.test.tsx`. And **the ingest only ever moves a player forward in
  time**, guarded by `team_as_of`: it re-reads old box scores constantly (`force`, the
  TrackMan backfill, mode `all`), every one of those is honest evidence of where she was
  *then*, and without the guard her club is whichever game the loop happened to touch last.
  **The feed's id is the only thing that separates a trade from a namesake, so an entry without
  one is evidence of NOTHING about identity**: it cannot be read as a trade, cannot move a
  player's club, and cannot be inserted as a new player (`anonymous` in
  [`names.ts`](supabase/functions/wpbl-ingest/names.ts), guarding three call sites). A real
  trade always carries a new id, by the same rule that opens this paragraph. Emi Saiki spent a
  day on Los Angeles, a club she has never played a game for, because an id-less "Emi Saiki" in
  a Los Angeles box score read as a trade out of New York; she has eleven rows in
  `wpbl_player_team_changes`, in pairs, one club each way per game. Of 118 players, the 49 with
  no feed id have no box-score line between them, which is what makes the rule free.
  `wpbl_merge_players(keep, dupe)` is the tool for the duplicates no rule can catch.
- **A CLUB'S FEED ID IS NOT THE CLUB EITHER, and the postseason proved it.** The league mints a
  new team id per context exactly as it does per player: Boston is `9f08or2mffx81409` all regular
  season and `rknw1oz8pl20apx4` in the bracket, same name, same club, both live in `/games` at
  once. `wpbl_teams.api_id` held one id, so `wpbl-ingest` could map neither postseason club and
  pushed `unmapped team in <game>` into `summary.errors` for all four bracket games, every pass,
  for two days. **`summary.errors` does not set `ok: false`**, so the run logged `ok: true` and the
  only surface that noticed was an amber chip on `/admin` that nobody was looking at. Game 1 was
  played on Sep 9, 2026 with no row on the site: no scoreboard line, no Game Center, no push, no
  Discord recap. `wpbl_teams.api_ids` now holds every id a club has held and the ingest matches on
  any of them; it also ADOPTS an unseen id whose feed name matches a club exactly, and persists it,
  because the next set the feed mints will otherwise fail the same silent way. Two things to keep
  from it. **The postseason player ids are new too** and resolve on `(team, name)`, which is only
  safe because the club maps first: get the club wrong and every one of those lines forks a
  duplicate roster row. And **the feed sends `counts_in_standings: true` on postseason rows**, so
  the flag is useless here and `countsInStandings()` is holding the postseason out of the standings
  and every season total on its `game_type` backstop alone.
- **A series that is being played is not "upcoming", and the pick'em is the only thing that
  cares.** `seriesPickOpen` locks a series once the bracket stops calling it `upcoming`, and the
  bracket derived that from DECIDED games, so with game 1 in the second inning the semifinal still
  read `upcoming` and the sheet still asked who would win it. `postseasonSeries` in
  [`derive/bracket.ts`](src/wpbl/derive/bracket.ts) now registers a pairing on a game that is
  merely `live` while still counting wins from finals only, and `seriesPickOpen` takes a REQUIRED
  `now` and independently refuses once `POSTSEASON_SCHEDULE`'s published first pitch has passed:
  that constant needs nothing from the feed, which is the whole point, since the outage above meant
  there were no game rows to read at all. **The lock is UI-only.** Votes go through
  `wpbl_cast_award_vote`, which stores a category and an answer and knows nothing about dates.
- **The postseason is a SEPARATE presto season, and it does not use the timezone-twin
  encoding.** The bracket games live under "Womens Pro Baseball League Playoffs 2026" with its
  own `season_id`, which is the root of the new team ids above and of this: the regular season
  publishes each game twice, tagged Central and tagged Eastern an hour apart, and `correctedStart`
  exists only to collapse that pair. The playoffs publish ONE copy, tagged Eastern, already
  carrying the true instant, so the shift put every bracket game an hour late. Sep 9's game was
  stored at 7:00 PM Central against a 6:00 PM first pitch, and nothing on the site said so: a
  start time is only ever contradicted by the game itself starting, which nobody is watching for.
  `correctedStart` now skips the shift on a postseason `game_type`. **The league's own schedule
  page is the check**, `womensprobaseballleague.com/schedule/`, which prints Pacific and agrees
  with `POSTSEASON_SCHEDULE` on all 11 postseason games. **And the feed's times can simply be
  wrong**, separately from any math we do: on Sep 9, 2026 its Sep 10 row said 5:00 PM Central
  against the league's 6:00 PM and had not been updated since Sep 7, so a game time that
  disagrees with the league page is not a bug in the conversion. It was still wrong on the
  page, which is the only place it counts: a Pacific reader was told 3:00 PM for a 4:00 PM
  first pitch, and the fix is not to touch the zone math, which was right the whole time.
  `applyLeagueStartTimes` in [`src/wpbl/startTimes.ts`](src/wpbl/startTimes.ts) puts the
  league's own calendar (`wpbl_site_games`) over the feed's `start_time` for a game still
  SCHEDULED, matched on the date and both clubs, and nothing else about the row. Applied in
  `WpblApp` rather than at `fetchWpblSchedule` where the section's three other schedule rules
  live, because it needs a second table the section deliberately does not wait on; the bell
  ([`notifications/gameStart.ts`](src/wpbl/notifications/gameStart.ts)) and the push sender
  ([`scripts/send-wpbl-game-start.mjs`](scripts/send-wpbl-game-start.mjs)) each apply the same
  rule to their own narrower read, because a reminder an hour early is the version of this that
  reaches somebody who is not even looking. Across all 34 games the feed had published the two
  sources agreed 33 times, which is what makes this a correction rather than a second opinion.
- **A game's status GOES BACKWARDS, and `completed_at` is the only field that does not.** Game 1
  of the 2026 postseason finished at 01:51Z on Sep 10. Both feed surfaces published
  `completed_at`, the list said Final, we stored final, `announceFinal` posted the recap a
  minute later. Then both surfaces reverted to `"In Progress - Bottom of 7th"` with
  `complete: false` and stayed there, and since the list status is re-read onto the row on EVERY
  pass, we followed: a live dot on a game nobody was playing, the semifinal's 1-0 lead gone from
  the bracket (which counts finals), and no second chance at the recap, because that fires on a
  not-final to final transition and the transition had been spent. `completed_at` was absent
  through the whole of the live game, checked in the bottom of the 1st, and is present on all 31
  started games in the feed against none of the 34 unplayed ones. It now outranks the status
  string in BOTH writers, the list upsert and the boxscore patch, which is what `isPlayed` in
  the phantom-suppression pass had always done with it.
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
- **`live_state` is the feed's last word, not the current state, and it is wrong twice.** It is
  `box.status` mirrored verbatim, and between at-bats it holds a count that cannot exist: watched
  on Sep 5, 2026 it published balls 3, strikes 3 on a batter with nobody out, then dropped to 0-1.
  That is the previous strikeout's full count sitting on the next batter's name. Printed as "3-3"
  in a four-character strip nobody noticed for months; drawn as bulbs it is a fourth ball and a
  third strike, so **anything that renders the count must clamp it** (3 and 2). The other half is
  the break between half-innings, where the batter, the count and the runners all describe an
  at-bat that has finished: `betweenInnings` in [`Live.tsx`](src/wpbl/Live.tsx) is the only
  detector, and it works by finding the half-inning the feed has left EMPTY rather than one it
  names. Its header explains why every signal the MLB side keys on is absent here. **And the bases
  are runner NAMES**, not booleans: `first_base` is "Val Perez". `deriveSituation` exposes both
  the flag and the name because a surface can want either, and the 34px strip throws the name away.

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

- **Both sections render at a DESKTOP SCALE in CSS, not under a `zoom`, and there are two scales.**
  Until Aug 31, 2026 the whole app sat inside `zoom: 1.4` at `md`, which split it into two
  pixel units nothing in the type system tells apart and cost five shipped bugs. `/wpbl` came out
  then and `/mlb` in Oct 2026; there is no `zoom` left on the site. The scale is keyed on
  `:root[data-app-scale]`, set per route in App.tsx, and off both sections (`/admin`, `/privacy`)
  everything stays at 1. The two scales, in `styles.css`:
  **`--app-type`** is spent on the root font size, so it moves every `rem` (the type, and the
  boxes that reserve room for type) and it MULTIPLIES with `--sd-text-scale`, the reader's
  Large text setting. **`--app-chrome`** is spent on px that is not type: MUI's whole `spacing`
  scale, `TeamBadge` / `PlayerPortrait`, the toolbar logo, and every structural length via
  `chromePx()` in [`src/ui/scale.ts`](src/ui/scale.ts). It deliberately EXCLUDES the text scale,
  because a tap target that grows with the reader's text size is a worse tap target.
  `AccessibilityContext` must keep PUBLISHING `--sd-text-scale` rather than setting `font-size`
  itself: an inline style beats the stylesheet, so setting it there gives a Large-text reader the
  MOBILE type size on a desktop. **One number for both sections** (`DESKTOP_SCALE` in App.tsx):
  the shared toolbar rides the root scale, so two values would resize the bar on every section
  switch. It had a `zoom` of its own while `/mlb` was zoomed, and that is gone too. See item 0 in
  [ROADMAP-WPBL.md](ROADMAP-WPBL.md) and item 7 in [ROADMAP.md](ROADMAP.md).

- **A fixed px size in either section is one of three things, and only two of them scale.**
  Ordinary CSS has no equivalent of `zoom`, so every length now says what it is. A box **reserving room
  for a string or a number** goes in `rem` (a rank column, a club-name column, the scoreboard
  chip): it must grow with the type or it clips, and this is the one that bites, because a box
  sized in px around a font sized in rem looks perfectly right until someone enlarges the text.
  **Structure** goes through `chromePx()` (rail widths, a dialog's cap, a card's flex basis):
  left raw it silently shrinks 40% against the type inside it, which is how the player dialog
  started wrapping a name onto two lines. **Ornament** stays raw px: hairline borders, the 6px
  live dot, a 4px scrollbar. **Letter spacing** is type, so it is `typePx()` (rem): MUI reads a
  bare `letterSpacing: 0.5` as px, which the old zoom scaled and the ramp does not, and that alone
  re-wrapped headings across `/mlb`; the lint now refuses a px one. MUI's own controls (a `Switch`, a native `select` arrow) are
  fixed px inside and stay that way on both sections. The failure is silent in every direction, and `tsc` sees none of
  it: the only check that works is opening the page and looking for a box whose content is
  wider than it is, at more than one text scale, which `npm run sweep` does at four widths and
  both text sizes. **Anything behind the experiments flag is exempt from that check by
  construction, so it is swept separately**, with `--experiments`, by the `layout experiments`
  slice in CI. That slice names its routes: put a new flagged surface behind the flag and its route goes
  in that list, or it is checked by nothing. The seeding race sat out the whole rebuild for
  exactly this reason and carried four of these bugs into September. As of Sep 14, 2026 the
  flag hides exactly one thing: the steal card on Run value. The win probability chart (v1.48.1), the Run value board (v1.52.0), the bracket and
  the seeding race (v1.59.0) all came out from behind it, and the mobile bottom nav shipped to
  every phone on Sep 14, 2026, so anything still describing those as experimental is stale.

- **`--app-header-h` is the pinned chrome's height, in plain screen pixels,** spent as a sticky
  `top` (`PINNED_CHROME` in [`StatsView.tsx`](src/wpbl/StatsView.tsx)). Above a phone it is the
  WHOLE of the pinned chrome: both sections' tabs live inside the toolbar
  ([`ToolbarNav.tsx`](src/ToolbarNav.tsx), fed by [`sectionNav.ts`](src/sectionNav.ts)), two rows
  of it below 1024px. There was a second variable for WPBL's own pill row until v1.124.0 removed
  that row. Use the **rect**, never `offsetHeight`: it rounds to a whole pixel, and a bar 43.67px
  tall publishing itself as 44 leaves a sub-pixel crack under it that the page scrolls through,
  one device pixel of a stats row at a time. **On a phone it is 0**: the toolbar scrolls away
  there, and the section nav is the fixed BOTTOM bar, which pins nothing at the top. What the
  bottom bar takes is reserved as padding under the page (`BOTTOM_NAV_SPACE` plus the safe-area
  inset), and anything sized to fit the screen has to subtract that itself: the stats table's cap
  did not, and for twelve days its column headers slid behind the control bar at the bottom of the
  page. This has regressed three times, once in each direction, every time by a scale being
  applied at one end of a sum and not the other.

- **Inside the desktop side panel the viewport lies, so layout code asks `usePhoneLayout()`.**
  Since Oct 5, 2026 a WPBL player or game opens on a desktop as `ModalShell`'s `panel`, which
  renders its content under `PANEL_THEME`, a theme with every breakpoint above `xs` out of reach,
  so every `{ xs, sm, md }` in the card resolves to the phone layout in a 525px column. A raw
  `useMediaQuery('(max-width:600px)')` does not go through the theme and still sees the desktop:
  it draws the desktop layout into the panel and overflows it, with no error. Raw queries stay
  right for the DEVICE (touch, hover, swipe). Two more of the same shape: a hook in the component
  that RENDERS the shell runs outside the provider and has to be told (`wide = mdUp && !panel` in
  `PlayerDetail`), and the panel's z-index is not a constant (it rises above whatever is open each
  time it opens or swaps, so a tooltip portalled out of it reads `useShellZ()`). A swap REPLACES
  the history entry. A game's or a player's full page is the same URL as its panel; which one
  renders is `gamePage` / `playerPage` on WpblApp's history snapshot, never the address. And
  whether a click swaps or stacks depends on WHERE it came from, not what it opens: a row on the
  page swaps the panel, a link inside a card stacks, so a card's links must go through the card's
  own opener (`openPlayerFromGame`, `openGameFromPlayer`, `fromCard` in App.tsx) or Back stops
  returning to the card. See #9 in ROADMAP-WPBL.md.
- **A video missing from the site may be missing on purpose: `fetchWpblVideos` drops what the
  reader's country cannot play.** The league's full-game broadcasts are blocked in the US (28 of 41
  as of Sep 29, 2026). The restriction is `region_allowed` / `region_blocked`, filled by the sync
  from the Data API, and the country comes from `/api/geo` (Cloudflare's `cf.country`). Under
  `npm run dev` there is no Pages Function, so the country is unknown and treated as the US: a
  broadcast you can see on YouTube from abroad is correctly absent locally. Every surface reads
  the filtered list, so none of them needs to ask; do not add a second read of `wpbl_videos` that
  skips `playableIn`, or it will offer a player that says "Video unavailable".
- **A cancellable touch listener over scrolling content makes the scroll wait for JavaScript.**
  A `touchmove` listener with `passive: false` forces the browser to ask the page before it
  scrolls anything under it, so on a busy page the content trails the finger, and nothing errors.
  The player sheet felt like this until Oct 7, 2026 with two such listeners (the sheet's
  drag-to-dismiss and the role pager), while Home felt fine. In [`ModalShell.tsx`](src/ui/ModalShell.tsx)
  the drag logic is passive and its one cancelling listener (`claimer`) is attached only while every
  scroller in the sheet is at its top; the pager in [`SwipeableViews.tsx`](src/ui/SwipeableViews.tsx)
  is passive in pane mode, where each pane's `touch-action: pan-y` does the job `preventDefault`
  did, and attaches nothing at all for a single pane. Do not add a `passive: false` touch listener
  inside a sheet. Headless Chrome cannot show this (no display, so no real input latency); measure on
  a phone: `adb` is in `~/.bubblewrap/android_sdk/platform-tools`, `adb reverse tcp:4173 tcp:4173`
  with `vite preview --host 127.0.0.1` (preview binds IPv6 only by default, which `adb` cannot reach).
- **A signed-out reader's Supabase reads come from Cloudflare's cache, so a database edit can
  take a while to show.** In a built site the client's `fetch` ([`edgeFetch.ts`](src/lib/edgeFetch.ts))
  sends every signed-out GET of a table in [`edgeTables.ts`](src/lib/edgeTables.ts) through
  `functions/api/sb`. Tables a daily job writes are held 5 minutes and then served stale for up to
  a day while a refresh runs. Tables a game writes are held 10 seconds while the league is active
  (a game live, or dated within a day) and like the slow ones when it is not. So a hand correction
  out of season can sit unseen behind a stale answer at a quiet location until a reader there
  triggers the refresh; signed in, you read direct and see it at once, which is why it looks fixed
  to you. **A table goes on that list only if every signed-out reader sees the same rows**: the
  cache hands one reader's answer to the next. `npm run dev` never uses it.
- **Modules shared with Deno carry `.ts` on their imports.** The recap engine
  ([`recap.ts`](src/wpbl/derive/recap.ts), [`discordRecap.ts`](src/wpbl/derive/discordRecap.ts))
  is loaded by three builds: Vite, the esbuild bundle behind `npm run discord-recaps`, and
  Deno inside `wpbl-ingest`. Deno resolves local specifiers literally, so any *runtime*
  import they add needs the extension (type-only imports are erased and stay
  extensionless). For the same reason they must never import
  [`constants.ts`](src/wpbl/constants.ts), which pulls the team logos in as Vite assets:
  that is why `outsToIp` lives in [`innings.ts`](src/wpbl/innings.ts).
- **The fan awards ballot is open to everyone, and there is NO audience gate.** It launched behind
  `useIsAdmin()` for a while, but that gate is gone: [`Home.tsx`](src/wpbl/Home.tsx) draws the
  ballot for any reader in the slot the MVP race used to hold, and [`FanVote.tsx`](src/wpbl/FanVote.tsx)'s
  `drawable` asks only whether there are questions worth drawing, never who is asking. `/wpbl/awards`
  is a normal public route: indexed in [`seo.ts`](src/seo.ts), listed in `sitemap.xml`, and not
  disallowed in `robots.txt`. **Nothing may quietly add a gate back**: `routes.test.ts` asserts that
  neither file contains `useIsAdmin` or `useHasRole` and that `drawable` stays exactly
  `fanVoteIsWorthDrawing(entries)`, because a single `&&` here would hide the ballot from every fan
  while the sitemap kept sending them to it. Votes go through `wpbl_cast_award_vote`, callable by
  anyone; the close date is enforced in the UI only (see `AWARDS_CLOSE_AT` in
  [`awards.ts`](src/wpbl/awards.ts)), so the RPC itself takes a vote regardless of the clock.
- **Three write paths to the DB, and only three.** The browser writes user rows through RLS
  (events, feedback, picks, fan-award votes); everything ingested or derived is written by service-role
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
- **A page open across a deploy is on a build that no longer exists, and
  [`lib/staleBuild.ts`](src/lib/staleBuild.ts) is what carries it over.** Cloudflare serves only
  the current `/assets/`, so the old page's next lazy chunk 404s; until Sep 26, 2026 that
  blanked the whole app. Now the page re-reads `index.html` when the tab comes back and, if the
  entry script changed, **patches `history.pushState`** so the next in-app navigation is a full
  load. If you are ever debugging a pushState that reloads the page, that is why. A chunk that
  fails anyway reloads once (`vite:preloadError`, 10s loop guard), and `AppErrorBoundary` catches
  the rest at three layers (app, page area, each WPBL tab), reporting `app_error` / `app_updated`
  to `/admin` under "Site health".
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
  the Worker builds `main` only. Until Oct 9, 2026 it also built every PR branch, and those
  builds were red on every PR ever opened: a branch ran `npx wrangler versions upload`, which
  needs a Wrangler config the repo does not have, where `main` runs `npx wrangler deploy`,
  which works it out. "Builds for non-production branches" is now off in the Worker's Build
  settings, so a PR shows no `Workers Builds` check at all, and `Cloudflare Pages` gives each
  PR its preview. Turn it back on and the red check returns, training everyone to ignore the
  one signal this rule is asking you to read.
- **`public/sitemap.xml` is generated.** `npm run sitemap` rebuilds it from the roster (one
  URL per player). A hand-edit is lost on the next run.
- **The wildcards in `_redirects` (`/wpbl/players/*`, `/wpbl/games/*`, `/wpbl/compare/*`,
  `/mlb/players/*`) each have a Pages Function standing in front of them** that answers a real
  404 for a slug naming nothing; the MLB one is [`functions/mlb/index.ts`](functions/mlb/index.ts),
  which asks StatsAPI. The original, `/wpbl/players/*`, exists because the valid slugs live in
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
- [docs/](docs/): `CI.md` (**read before touching `ci.yml`, the test config, lint rules or the
  layout sweep**: the required checks by name, the two test environments, the flake hunt, and
  why the Worker builds `main` only), `DISCORD.md` (fan-server board, final-score box scores, highlight reels,
  the `/player` slash command, and which secret store each writer reads),
  `ADMIN_ANALYTICS.md` (**read before touching the `events` table or the `admin_*` RPCs**;
  its security section is the only thing keeping site analytics from being readable by
  every signed-in user), `PLAY_VALIDATION.md`, `COMMONS_PHOTOS.md` (**read before approving an archive
  photo**: what the sync will not do, and why the approval gate is in RLS rather than in the
  query), `PUSH_NOTIFICATIONS.md`, `READING.md` and `RECAPS.md` (the outside writers and the
  recap outlet, linked out, never mirrored in full), `FAN_PHOTOS.md` (fan photos tagged by who is in them: ingest, R2, curation on `/admin`),
  `GOOGLE_TASKS.md` (paused, manual only),
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
[`src/ui/`](src/ui/) holds the UI both sections share (the bottom bar, the tab pager,
`ModalShell`, the tap helpers), which WPBL built and re-exports from its old paths: neither
section imports the other, both import this;
[`src/lib/`](src/lib/) holds the shared client libs;
[`shared/notifications.js`](shared/notifications.js) is one catalog serving both the
in-site bell and the push senders.

## Environment

- **Windows.** PowerShell 5.1 is the primary shell; a Bash tool is also available. Mind the
  syntax differences.
- **Dev:** `npm install && npm run dev` → http://localhost:5173, redirects to `/wpbl`.
  Needs `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`
  for push. Without them the app renders empty states.
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
- **SEO:** `robots.txt`, `sitemap.xml`, and per-route meta plus JSON-LD via
  [`src/seo.ts`](src/seo.ts), which runs after React mounts and so never reaches an
  unfurler. Shared player links get their card from [`functions/wpbl/`](functions/wpbl/)
  instead, rewriting the tags at the edge; the per-player 1200x630 art it points at is
  generated by [`scripts/make-wpbl-share-cards.py`](scripts/make-wpbl-share-cards.py) and
  republished at a stable `/cards/<slug>.webp` by a Vite plugin, since the edge has no copy
  of the build's hashed-asset map. MLB player and game links get theirs from
  [`functions/mlb/`](functions/mlb/index.ts) out of the same StatsAPI read that proves the page
  exists, worded by [`src/mlb/ogCard.ts`](src/mlb/ogCard.ts); the player image is MLB's own
  headshot padded to shape on the club colour by MLB's image CDN, so there is no MLB art to
  generate. Both sections rewrite through one helper, [`src/lib/ogTags.ts`](src/lib/ogTags.ts).
  **og:image must stay 1200x630**: Bluesky reads `og:`
  only, ignores the `twitter:card` hint asking for a square thumbnail, and centre-crops
  whatever it gets to one 1.91:1 band. **Search Console is verified**, and Googlebot renders the JS completely,
  so pre-rendering is settled as not needed. The remaining constraint is not code: near-zero
  inbound links, worked from [`docs/BACKLINKS.md`](docs/BACKLINKS.md).
