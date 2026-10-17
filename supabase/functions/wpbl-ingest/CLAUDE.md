# WPBL feed and ingest traps

What the league feed does that it never says, and what the ingest does about it. Also binding on `scripts/check-wpbl-drift.mjs` and every other script that reads the feed. The player-id trap lives in [`src/wpbl/CLAUDE.md`](../../../src/wpbl/CLAUDE.md) because most of its consequences are on the page; it applies here too.

- **`wpbl_game_plays` is a mirror. Never fix a scoring error by editing it.** `wpbl-ingest`
  deletes and reinserts every play for a game on each pass, so an edit survives two minutes
  and then vanishes with no trace it existed. Corrections go in `wpbl_play_corrections` and
  are applied as a read-time overlay keyed on `(game_id, sequence)`, never the play's uuid,
  which is regenerated on every reinsert. Same reasoning for every other mirrored WPBL
  table. See [`docs/PLAY_VALIDATION.md`](../../../docs/PLAY_VALIDATION.md). **The one table that is
  the opposite is `wpbl_game_revisions`**, which records what the league changed after a
  game went final. It is append-only, written by a single call inside
  [`scripts/check-wpbl-drift.mjs`](../../../scripts/check-wpbl-drift.mjs) that must stay BEFORE the
  repair, and nothing can regenerate it: the repair replaces the old scoring and the feed
  only ever serves the current version, so rebuilding this table would empty it in silence.

- **A CLUB'S FEED ID IS NOT THE CLUB EITHER, and the postseason proved it.** The league mints a
  new team id per context exactly as it does per player: Boston is `9f08or2mffx81409` all regular
  season and `rknw1oz8pl20apx4` in the bracket, same name, same club, both live in `/games` at
  once. `wpbl_teams.api_id` held one id, so `wpbl-ingest` could map neither postseason club and
  pushed `unmapped team in <game>` into `summary.errors` for all four bracket games, every pass,
  for two days. **`summary.errors` did not then set `ok: false`**, so the run logged `ok: true` and
  the only surface that noticed was an amber chip on `/admin` that nobody was looking at. Since
  Oct 2026 any entry there makes the run `ok: false`, which pages with the first errors named;
  do not add an expected, routine error to it, or the alarm learns to be ignored. Game 1 was
  played on Sep 9, 2026 with no row on the site: no scoreboard line, no Game Center, no push, no
  Discord recap. `wpbl_teams.api_ids` now holds every id a club has held and the ingest matches on
  any of them; it also ADOPTS an unseen id whose feed name matches a club exactly, and persists it,
  because the next set the feed mints will otherwise fail the same silent way. Two things to keep
  from it. **The postseason player ids are new too** and resolve on `(team, name)`, which is only
  safe because the club maps first: get the club wrong and every one of those lines forks a
  duplicate roster row. And **the feed sends `counts_in_standings: true` on postseason rows**, so
  the flag is useless here and `countsInStandings()` is holding the postseason out of the standings
  and every season total on its `game_type` backstop alone.

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
  `applyLeagueStartTimes` in [`src/wpbl/startTimes.ts`](../../../src/wpbl/startTimes.ts) puts the
  league's own calendar (`wpbl_site_games`) over the feed's `start_time` for a game still
  SCHEDULED, matched on the date and both clubs, and nothing else about the row. Applied in
  `WpblApp` rather than at `fetchWpblSchedule` where the section's three other schedule rules
  live, because it needs a second table the section deliberately does not wait on; the bell
  ([`notifications/gameStart.ts`](../../../src/wpbl/notifications/gameStart.ts)) and the push sender
  ([`scripts/send-wpbl-game-start.mjs`](../../../scripts/send-wpbl-game-start.mjs)) each apply the same
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
  [`scripts/check-wpbl-drift.mjs`](../../../scripts/check-wpbl-drift.mjs) is what closes this, nightly.

- **The feed has a contract, [`feed-contract.ts`](feed-contract.ts), and it reports rather than
  refuses.** Every `/games` row and box score is checked with valibot against the shape the 2026
  feed actually sent (all 71 box scores and the list passed; fixtures in
  `src/wpbl/__tests__/fixtures/feed-2026/`). A broken row lands in `summary.errors`, grouped with a
  count, and is ingested anyway, because a renamed `game_type` breaks every row at once and
  dropping them would blank the site. Only a list envelope with no numeric `count` stops the pass,
  because the truncation guard needs it. Two facts the contract had to learn from the real feed:
  `completed_at` is ABSENT, not `''`, until a game ends (so a final without it is the check), and an
  undecided bracket game's box score has `''` for both club ids. **The import is a bare
  `'valibot'`**, mapped in this folder's `deno.json`; a test fails if its version leaves
  `package.json`'s, and `denoGraph.test.ts` fails on any bare import the map lacks.
