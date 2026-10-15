# WPBL client traps

Loaded when you read anything under `src/wpbl/`. The feed and ingest traps (ids, game status, start times, the `/games` cap, drift) are in [`supabase/functions/wpbl-ingest/CLAUDE.md`](../../supabase/functions/wpbl-ingest/CLAUDE.md): read it before touching anything that decides which game, club or player a row is.

- **The feed's `runs_scored` does not count the batter.** It counts the runners who
  crossed, so a solo home run reads 0, a two-run homer 1, a grand slam 3. This has caught
  every reader of the field so far, including a validator, a Game Center badge and the Hall
  of Firsts. Call `runsOnPlay()` in
  [`src/wpbl/derive/playByPlay.ts`](derive/playByPlay.ts) instead of reading the
  column. **`is_scoring_play` is not a second opinion on this, it is the same number**: across
  every stored play it is exactly `runs_scored > 0`, so "a home run the feed forgot to flag"
  only ever means "a solo home run". A validator check spent two rewrites finding that out and
  put ten of them in the accepted baseline as real league errors.

- **"Read every row" needs explicit paging.** PostgREST silently caps a bare `.select()` at
  1000 rows: no error, just a short array. Any fetch that means "all of them" must page
  with `.range()` *and* carry a deterministic `.order()`, or Postgres can return the same
  row twice and skip another. Getting this wrong quietly makes league-wide aggregates wrong
  by a silent prefix (OPS+ and ERA+ take their baseline from `fetchWpblAllLines`). Use
  `fetchAllPaged` in [`src/wpbl/api.ts`](api.ts).

- **Postseason games must never reach the standings *or any season total*, and the filter
  fails OPEN.** `countsInStandings()` now lives in [`src/league/season.ts`](../league/season.ts),
  re-exported by [`src/wpbl/season.ts`](season.ts) (no imports beyond that, so the Pages
  Functions can use it without pulling in the supabase client; `api.ts` re-exports it too). It is the one definition of "counts toward the regular
  season", used by `computeStandings`, by Home's season-series line, and by
  `regularSeasonLines()`, which every aggregate in [`stats.ts`](stats.ts) runs its
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
  `displayPosition` / `positionsPlayed` in [`positions.ts`](positions.ts),
  `aggregateTracking` in [`tracking.ts`](tracking.ts), and `headToHead` in
  [`derive/matchups.ts`](derive/matchups.ts), which claimed "the same rule as
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
  [`routes.ts`](routes.ts) correctly decide a shared name is ambiguous, so her
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
  [`names.ts`](../../supabase/functions/wpbl-ingest/names.ts), guarding three call sites). A real
  trade always carries a new id, by the same rule that opens this paragraph. Emi Saiki spent a
  day on Los Angeles, a club she has never played a game for, because an id-less "Emi Saiki" in
  a Los Angeles box score read as a trade out of New York; she has eleven rows in
  `wpbl_player_team_changes`, in pairs, one club each way per game. Of 118 players, the 49 with
  no feed id have no box-score line between them, which is what makes the rule free.
  `wpbl_merge_players(keep, dupe)` is the tool for the duplicates no rule can catch.

- **A series that is being played is not "upcoming", and the pick'em is the only thing that
  cares.** `seriesPickOpen` locks a series once the bracket stops calling it `upcoming`, and the
  bracket derived that from DECIDED games, so with game 1 in the second inning the semifinal still
  read `upcoming` and the sheet still asked who would win it. `postseasonSeries` in
  [`derive/bracket.ts`](derive/bracket.ts) now registers a pairing on a game that is
  merely `live` while still counting wins from finals only, and `seriesPickOpen` takes a REQUIRED
  `now` and independently refuses once `POSTSEASON_SCHEDULE`'s published first pitch has passed:
  that constant needs nothing from the feed, which is the whole point, since the outage above meant
  there were no game rows to read at all. **The lock is UI-only.** Votes go through
  `wpbl_cast_award_vote`, which stores a category and an answer and knows nothing about dates.

- **`live_state` is the feed's last word, not the current state, and it is wrong twice.** It is
  `box.status` mirrored verbatim, and between at-bats it holds a count that cannot exist: watched
  on Sep 5, 2026 it published balls 3, strikes 3 on a batter with nobody out, then dropped to 0-1.
  That is the previous strikeout's full count sitting on the next batter's name. Printed as "3-3"
  in a four-character strip nobody noticed for months; drawn as bulbs it is a fourth ball and a
  third strike, so **anything that renders the count must clamp it** (3 and 2). The other half is
  the break between half-innings, where the batter, the count and the runners all describe an
  at-bat that has finished: `betweenInnings` in [`Live.tsx`](Live.tsx) is the only
  detector, and it works by finding the half-inning the feed has left EMPTY rather than one it
  names. Its header explains why every signal the MLB side keys on is absent here. **And the bases
  are runner NAMES**, not booleans: `first_base` is "Val Perez". `deriveSituation` exposes both
  the flag and the name because a surface can want either, and the 34px strip throws the name away.

- **Every WPBL bulk read is every season, and every aggregate sums whatever it is handed.** Two
  years of lines summed read as one long season, and nothing errors. Cut before summing: `cut` from
  `useWpblSeason()` in [`SeasonContext.tsx`](SeasonContext.tsx), or `inSeason` with the
  WHOLE schedule. **Never cut against one season's games**: a line whose game the schedule lacks
  counts in the newest year, so a cut made against `seasonGames` leaks every other year back in.
  That is why the provider carries the whole schedule. The default year is the newest with a FINAL
  (`currentSeason`), so a published 2027 schedule does not blank the boards before Opening Day.
  Home, previews and the share and Discord cards pin to it; the tabs follow the reader's
  `?season=`; the ballot pins to `AWARDS_SEASON`; batter vs pitcher and the win model use every
  season on purpose. `__tests__/seasonOnScreen.test.tsx` fails any file that reads a league-wide
  table without cutting it or saying why. **The play log is the exception that reads one year:**
  every play read is a filter over `fetchWpblPlayLog(season)` in api.ts, which asks the database
  for that season alone (`null` is every season). Pass the season on screen, keep the `cut` anyway
  (it is free on rows already one year), and hold what you read WITH the season it was read for,
  or a year picked from the menu cuts the last year's plays to nothing and draws an empty board.
  **Each new year** needs its recap in `WPBL_RECAP_YEARS`
  (plus `_redirects` and seo.ts, pinned by routes.test.ts), a new `POSTSEASON_SCHEDULE` (another
  year's bracket shows no dates until then), and new award constants. `npm run dev` has a fake
  2027 (dev settings, "Second WPBL season") for checking all of it.

- **The live poll reads a hand-listed half of `wpbl_games`, and the two halves must
  partition the table.** `LIVE_GAME_COLUMNS` in [`src/wpbl/api.ts`](api.ts) names
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
  `plateAppearances()` in [`stats.ts`](stats.ts), which is also the only correct PA
  sum: `sh` is on the feed's line and is deliberately NOT in OBP's denominator, so anything
  copied from that denominator drops it. The bar was at-bats until Aug 27, 2026, which gated
  a stat half made of OBP on a count that throws away every walk, and quietly kept the
  league's most patient hitters off the OPS board. `__tests__/qualifiers.test.ts` pins the
  constants; nothing can pin a NEW call site that reaches for `t.ab` instead.

- **`era` and `k9` are stored on whatever basis the LEAGUE publishes, and that changed once.**
  It is per SEVEN as of Sep 3, 2026; it was per 9 before, and this file said so for months. The
  one definition is `ERA_BASIS_CANONICAL` in [`src/wpbl/stats.ts`](stats.ts), and it
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

- **A video missing from the site may be missing on purpose: `fetchWpblVideos` drops what the
  reader's country cannot play.** The league's full-game broadcasts are blocked in the US (28 of 41
  as of Sep 29, 2026). The restriction is `region_allowed` / `region_blocked`, filled by the sync
  from the Data API, and the country comes from `/api/geo` (Cloudflare's `cf.country`). Under
  `npm run dev` there is no Pages Function, so the country is unknown and treated as the US: a
  broadcast you can see on YouTube from abroad is correctly absent locally. Every surface reads
  the filtered list, so none of them needs to ask; do not add a second read of `wpbl_videos` that
  skips `playableIn`, or it will offer a player that says "Video unavailable".

- **Modules shared with Deno carry `.ts` on their imports.** The recap engine
  ([`recap.ts`](derive/recap.ts), [`discordRecap.ts`](derive/discordRecap.ts))
  is loaded by three builds: Vite, the esbuild bundle behind `npm run discord-recaps`, and
  Deno inside `wpbl-ingest`. Deno resolves local specifiers literally, so any *runtime*
  import they add needs the extension (type-only imports are erased and stay
  extensionless). For the same reason they must never import
  [`constants.ts`](constants.ts), which pulls the team logos in as Vite assets:
  that is why `outsToIp` lives in [`innings.ts`](innings.ts).

- **The fan awards ballot is open to everyone, and there is NO audience gate.** It launched behind
  `useIsAdmin()` for a while, but that gate is gone: [`Home.tsx`](Home.tsx) draws the
  ballot for any reader in the slot the MVP race used to hold, and [`FanVote.tsx`](FanVote.tsx)'s
  `drawable` asks only whether there are questions worth drawing, never who is asking. `/wpbl/awards`
  is a normal public route: indexed in [`seo.ts`](../seo.ts), listed in `sitemap.xml`, and not
  disallowed in `robots.txt`. **Nothing may quietly add a gate back**: `routes.test.ts` asserts that
  neither file contains `useIsAdmin` or `useHasRole` and that `drawable` stays exactly
  `fanVoteIsWorthDrawing(entries)`, because a single `&&` here would hide the ballot from every fan
  while the sitemap kept sending them to it. Votes go through `wpbl_cast_award_vote`, callable by
  anyone; the close date is enforced in the UI only (see `AWARDS_CLOSE_AT` in
  [`awards.ts`](awards.ts)), so the RPC itself takes a vote regardless of the clock.
