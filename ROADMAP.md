# MLB App Roadmap

> Living document — a menu of ideas, not a contract. Reorder/drop freely.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **July 26, 2026** (post-v1.15.0 — playoff odds shipped)

## Where the app stands

**Strong:** live scoreboard + deep Game Center (play-by-play, scrubbable win-probability, live situation, full box scores), personalized home feed (team card, followed players with form sparklines, standings snapshot, dual daily report cards, standout carousel, On Fire / Ice Cold), predictions game with vote bars, confidence-ranked leaderboard and running record, bot rivals, installable PWA with daily pick-reminder push, all-time leaderboards, rosters, recent-search UX, dark mode, responsive, exact back-button restoration.

**Shipped since the last roadmap revision (v1.4 → v1.9 + in flight):**
- ✅ Live Game Center — built, then deepened (win-prob scrubbing, between-innings states, due-up stats, 9-inning line score)
- ✅ PWA + push foundation — installable, Settings toggle, daily "make your picks" reminder Action (`docs/PUSH_NOTIFICATIONS.md`)
- ✅ Pick consensus — live vote bars with percentages on the home predictor
- 🟡 Predictions 2.0 — confidence-ranked (Wilson) leaderboard + running record shipped; badges/weekly boards/smart bot still open
- ✅ Player streak report cards (🔥 hitting / 🧊 scoreless / 🥶 hitless) — shipped with nightly precompute (`update-streaks.yml` → `streak_leaders`)
- ✅ Playoff odds — nightly Monte Carlo (`update-playoff-odds.yml` → `playoff_odds`); Odds tab in Standings + followed-team odds strip. Second precompute customer
- ✅ Backlog sweep (v1.18.0) — recently-reached milestones + hitting/pitching filter, trades show both players on the Roster Moves card, team pages show their schedule (today highlighted), and a batch of mobile fixes (predictions header overlap, tappable report-card info buttons, player-page section order)
- ✅ Single-Game Standout bar (v1.18.1) — the standout carousel now gates on a genuine standout line instead of "best of the day," so a thin early-day slate falls back to the most recent day with a real standout. Clears the last open Site todo

**Deliberately dropped:**
- ~~Friend leagues~~ — fantasy apps already own this. The social slot goes to **bot rivalry** instead: the app's personality is you vs. the bots, not you vs. your group chat.
- Game-thread reactions — shelved with the social layer.

**Gaps driving this roadmap:**
1. **Retention is solo now** — with friends out, the daily loop must come from quick daily games, streak mechanics, richer push alerts, and bots with personality.
2. **Calendar-blind** — the app doesn't know the trade deadline is July 31, that races tighten in August, or that October exists. Every era of the season is a content opportunity it currently ignores.
3. **Numbers-only for casual fans** — no stat explainers, no narrative layer.
4. **Infra ceiling rising** — streak boards fan out ~100 client-side fetches per visit; leaderboard ranking pulls the whole table client-side. The nightly-precompute pipeline now has real customers waiting.
5. **Offseason darkness** — unchanged; November is coming.

---

## The season calendar (what's timely when)

| Window | Moment | Roadmap payoff |
|---|---|---|
| **Now – Jul 31** | Trade deadline | Transactions / Roster Moves feed |
| **August** | Races tighten | ✅ Playoff odds · Streak Survivor launch |
| **September** | Magic numbers, milestones | Milestone Watch, bracket-challenge build |
| **October** | Postseason | Bracket Challenge, Season Wrapped |
| **November +** | Offseason | Offseason mode, trivia/history (evergreen) |

---

## Phase 1 — Ride the season (now → September)

- ✅ **Land the streak boards + first nightly precompute** ⚙️ — Shipped v1.11.1 (`update-streaks.yml` → `streak_leaders` table, client reads one row). This is the reusable template every later precompute (odds, trivia, grid puzzles) copies.
- ✅ **Trade Deadline HQ** 🔬🎯 — Shipped: Roster Moves strip + deadline countdown (v1.11.0) and move-badges on followed players (v1.12.0). Feed stays useful all year (injuries, call-ups, DFAs). *Open (optional):* a deadline-day live view — low ROI post-Jul 31.
- ✅ **Predictions 2.0** 🎮 — Done. Wilson-ranked board + running record (v1.9.0); streak badges + heater banner and the 🧠 Sabermetric Bot (Pythagorean + log5 + home edge) in v1.19.0; weekly/monthly leaderboard cuts in v1.20.0 (nightly `update-prediction-boards.yml` → `prediction_boards`, All-time/30d/7d toggle on the board). Fourth precompute customer of the streak template. The board still ranks by Wilson lower bound so a hot small sample can't leapfrog a proven record.
- 🟡 **Push alerts beyond the daily reminder** ⚙️🎯 — Game-start reminders shipped (v1.13.0, `game-start-reminders.yml`). Still open: "up 2–1 in the 8th" close-game alerts, followed-player milestone pings. Reuses the shipped plumbing.
- ✅ **Playoff odds** 🔬🎯 — Shipped. Nightly Monte Carlo of the remaining schedule (`update-playoff-odds.yml` → `playoff_odds`); "Odds" tab in Standings (make-playoffs / win-division % per league) + odds strip on the followed-team card. Second consumer of the streak-precompute template. *Open (September):* magic numbers + a dedicated race page as the divisions clinch.
- ✅ **Milestone Watch** 🎯🔬 — Shipped. Home card of active players closing in on career round numbers, single-season marks, and all-time records (nightly `update-milestones.yml` → `milestone_watch`); View-all modal grouped career/season/records, and a followed-player bell alert when someone's within a few. Third precompute customer. **v1.18.0:** also surfaces milestones *just reached* (the nightly run diffs a totals snapshot to catch crossings, keeps them 7 days), and the View-all modal filters by hitting/pitching. *Open (optional):* push delivery of the milestone alerts (bell only today).

## Phase 2 — Daily games (no friends required)

Solo-first games sharing auth + leaderboards + streak infra. Bots play these too — beat-the-bot is the multiplayer.

- ✅ **Streak Survivor** 🎮 — Shipped. Pick one hitter a day to get a hit; a miss resets. Home card + leaderboard, nightly resolver (`resolve-survivor.mjs`), and 3 bot entrants (🤖 Streak / Chalk / Coin Flip Bot) that pick each morning. *Open (optional):* a dedicated full-screen view, and streak-milestone push alerts.
- **Daily Trivia** 🎮🎯 — One auto-generated question/day from StatsAPI history, Wordle-style streaks. Works year-round, i.e. offseason insurance.
- **Mystery Player** 🎮 — Guess from progressive clues (team → position → stat line → silhouette). Shareable result grid.
- **The Grid** 🎮 — Immaculate-Grid-style 3×3 team/stat intersections; puzzles precomputed in Actions.
- **October Bracket Challenge** 🎮 — Postseason bracket, points by round. Build in September, launch with the Wild Card round.
- **Card collection** 🎮 — Predictions and games earn player cards (rarity tiers); the reward layer that makes every other game more rewarding. Build after two or more games exist.

## Phase 3 — Depth & narrative

- **Stat explainers** 🎯 — Tap any stat abbreviation → plain-English tooltip. One shared component, app-wide. Small effort, big casual-fan payoff; slot in anytime.
- **Splits & situational stats** 🔬 — vs LHP/RHP, home/away, last 15/30, RISP (`stats=statSplits&sitCodes=...`). Player-page tab.
- **Player comparison tool** 🔬 — 2–3 players side-by-side + radar chart; mostly assembly from charts.tsx + stat defs.
- **Statcast layer** 🔬 — Baseball Savant public endpoints (verify access rules). Exit velo, barrels, xwOBA; "Luckiest Hitters" report card (xwOBA−wOBA).
- **Narrative recaps** 🎯 — Template- or LLM-generated one-paragraph game stories (nightly Action); makes the Game Center readable for casual fans.
- **Farm report** 🔬 — MiLB via sportId 11–16; follow prospects, team's top farmhands and AAA lines.

## Phase 4 — All-season & long-term

- **Season Wrapped** 🎯🎮 — October recap: team arc, followed players' best games, your prediction record. Shareable cards (Web Share API). **Start collecting anything per-user that Wrapped needs by early September.**
- **Offseason mode** ⚙️🎯 — Calendar-aware home: free-agency tracker + signing predictions, awards ballots, Opening Day countdown. The transactions feed from Phase 1 is the backbone.
- **This Day in Baseball / History Explorer** 🎯 — StatsAPI goes back a century. Daily card; franchise pages; all-time leaderboards already exist as a foundation. Could grow a "replay a classic game" mode via historical play-by-play + the existing Game Center UI.
- **Second sport** — Launcher architecture supports it; NFL pick'em would reuse ~80% of the predictions infra, and the offseason overlaps perfectly with MLB's dark months.

## Infrastructure thread (under everything)

- **Precompute nightly, serve from Supabase** ⚙️ — Streak leaders ✅, playoff odds ✅, and milestone watch ✅ shipped on this template; next candidates: report cards, spotlight, trivia, grid puzzles. Client reads one row instead of fanning out to StatsAPI.
- **Server-side leaderboard ranking** ⚙️ — Move the Wilson-score ranking from `PredictionStats.tsx` into a SQL RPC (top N + current user's row) before the table gets big.
- **Payroll source resilience** ⚙️ — Fallback for FanGraphs 403s (Spotrac/Cot's) so payroll boards don't silently go stale.
- **Prod error visibility** ⚙️ — No way to know today whether visitors hit errors. Even a tiny Supabase `client_errors` table fed by a `window.onerror` hook would answer "is anything broken?"

---

**Suggested next three:** close-game push alerts (reuses the shipped push plumbing + the milestone-alert pattern — "up 2–1 in the 8th") → a second Phase 2 daily game (Daily Trivia is the offseason-proof pick) → the September race page + magic numbers (playoff-odds follow-on, timely as divisions tighten). Phase 1 is fully shipped and Predictions 2.0 is now complete (v1.20.0), so the retention loop leans on push alerts and the next daily game.

---

## WPBL — A second league (new site section) 🔬⚙️

A parallel initiative, not part of the MLB phases above. Adds Women's Pro Baseball League coverage as its own top-level section of the site (route `/wpbl`), separate from the MLB app.

**Context (researched Jul 2026):** the WPBL's inaugural season runs Aug 1 – mid-Sept 2026: four teams (Boston Hunters, LA Queens, NY Heights, SF Firebells), a ~6-week regular season + playoffs + championship, all at one hub venue (Robin Roberts Stadium, Springfield IL). There is **no official public API or data feed** — the league site is promotional only, and third-party fan sites have no dependable machine-readable source. So the data path is **manual entry**, which is sustainable here precisely because the league is tiny (4 teams, ~1 game/day).

**Architecture — pivoted twice.** It began owner-hand-entry (Supabase as source of truth). Then (Aug 2026) the league published a **public JSON feed** at `stats.womensprobaseballleague.com/v1`, so the model flipped again to a **feed mirror**: the `wpbl-ingest` Supabase Edge Function pulls the feed on a cron and upserts games, box-score lines, play-by-play, and TrackMan pitch tracking; the public reads the mirror (public-read RLS, service-role writes). Hand-entry (`GameEntry.tsx`) is retired. See `scripts/add_wpbl_api_ingest.sql` (schema) and `scripts/wpbl_cron.sql` (schedule).

**Locked decisions:**
- **Lean MVP** — teams, rosters, schedule, scores, standings, basic season stat totals. Box scores + leaderboards land in the season phase; the flashier stuff (streak cards, milestone watch, predictions) only after there's data history.
- **Scores + box scores entry** — full batting/pitching lines per game (enables player stats), so the entry UX matters. A "paste box score" parser is worth building early to cut the ~10-20 min/game once games start.
- **WPBL-native components** — build lean components for the small dataset rather than forcing WPBL data into StatsAPI-shaped types. Borrow the site's *conventions* (team-color map à la `TEAM_BG`, modal pattern, compact tabular-nums tables, responsive cap-and-center) so it still feels like the same site.

**Phasing:**
- **Phase 0** ✅ **done** — schema + RLS + public-read; teams/rosters/schedule; `/wpbl` shell via the toolbar MLB | WPBL toggle.
- **Phase 1 (season)** ✅ **done** — scores, standings, player season totals, player pages, box scores. (Shipped v1.23.0.)
- **Feed pivot** ✅ **done** — `wpbl-ingest` Edge Function mirrors the official feed on a cron; Game Center with line score + play-by-play + TrackMan pitch data + live in-game state; hand-entry retired.
- **Phase 2 (depth + polish)** ✅ **done** — rich home (scoreboard, standings snapshot, leaders, next-game countdown), a full sortable **Stats tab**, redesigned player pages with stat tooltips, **Hall of Firsts**, and **live-updating** schedule/scoreboard/leaders. (v1.24.0 → v1.27.0.)
- **Phase 3 (hardening + depth + postseason)** 🔬🎮 **← next** — see "Next" below for the prioritized list. Done: ingest hardening, loose ends, team pages, search integration. Done: ingest deploy shipped, live-data QA sweep, richer standings. Next (realigned Aug 5, playoffs deprioritized since all four teams qualify): velocity/TrackMan leaderboards → predictions/pick'em (+ bots) → daily standouts → league primer/glossary → win probability, then the remaining fun MLB mechanics. "Followed players/teams + notifications" was dropped (tiny league — low value).

**Open items:** the box-score paste format is unknown until game one (the 1d parser waits on it). Entry UI question **resolved** — it lives as a dedicated `/wpbl` admin modal (`GameEntry.tsx`), not an AdminPanel extension.

**Progress (last realigned Aug 4, 2026):**
- ✅ **Schema drafted** — `scripts/create_wpbl.sql`: five tables (teams, players, games, batting_lines, pitching_lines) with public-read / owner-write RLS via `public.is_site_owner()`. Line tables included now to avoid a second hand-run migration. Text-slug team ids (e.g. `BOS`); pitching IP stored as `outs` (int) for clean season aggregation. **Not yet run in Supabase.**
- ✅ **Frontend skeleton built** — `src/wpbl/` (`types.ts`, `constants.ts`, `api.ts`, `WpblApp.tsx`) + wired into `App.tsx` (`/wpbl` route, lazy `WpblApp`, toolbar MLB | WPBL toggle as the entry point). Views: Home / Schedule / Standings (derived) / Teams+roster, all lean and WPBL-native. Reads degrade gracefully (empty states) pre-migration; typechecks clean and renders with no console errors. ⚠️ Team colors in `constants.ts` (`WPBL_TEAMS`) are **provisional placeholders** — swap for the real palette when gathering assets. Logos not wired (fall back to abbr text until `logo_url` is seeded).
- ✅ **`create_wpbl.sql` run** in Supabase (2026-07-29) — tables live.
- ✅ **Seed run + verified** — `scripts/seed_wpbl.sql` (4 teams + full 30-game schedule, Aug 1 – Sep 6, cross-checked vs official site + trackers, 15 games/team; idempotent via team upsert + games natural-key unique index) run in Supabase 2026-07-29. Confirmed live on `/wpbl`: Home "Next up", Schedule renders the full slate grouped by date (doubleheaders stack), Standings shows all four 0–0, Teams grid + team detail with roster empty state. No console errors. **Phase 0 is functionally complete.**
- ✅ **Rosters complete** — `wpbl_players` extended with `age`/`hometown`/`status`/`draft_round`/`draft_pick` + `(team_id, name)` unique index (`scripts/add_wpbl_player_fields.sql` for existing DBs; baked into `create_wpbl.sql` for fresh). `scripts/seed_wpbl_rosters.sql` holds all four teams from the 2026 draft board — **118 players** (BOS 30, LA 29, SF 29, NY 30), idempotent, apostrophes escaped, sparse rows handled (null age/pos/etc.). Team-detail UI shows position/hometown/age/B-T. **Migration + roster seed run in Supabase** — rosters live on `/wpbl`.
- ✅ **Phase 1 done (1a–1c), shipped public in v1.23.0** (`d1cda25`, 2026-07-30):
  - **1a — entry modal** (`GameEntry.tsx`, admin-only): status/score/innings + per-team batting & pitching lines; save via `saveWpblGameResult` (owner RLS). **Real signed-in owner save verified working** (the long-standing RLS-write question is closed).
  - **1b — box-score read view** (`GameDetail.tsx`, public): per-team batting/pitching tables + totals, winner-emphasized header, empty states, admin "Edit result" shortcut.
  - **1c — player pages + season totals** (`PlayerDetail.tsx` + `stats.ts`): profile + season batting/pitching totals aggregated from lines + a per-game log.
  - **Design language unified** — `src/wpbl/ui.tsx` (SegNav pill nav, SectionLabel, shared ModalShell) mirrors the MLB app; all three modals use it.
  - **Colors + logos** — single-sourced in `constants.ts` `WPBL_TEAMS` (color + secondary + bundled `src/wpbl/logos/*.webp`); shared `TeamBadge` = team-color circle ringed in secondary; `wpblAccent()` keeps dark primaries readable on dark bg. ⚠️ BOS (`#da7718`) + NY (`#b8dbf1`) secondaries flagged uncertain by owner.
  - **Public** — MLB|WPBL toggle ungated; footer shows a WPBL disclaimer on /wpbl.
**Aug 4, 2026 realignment — the feed pivot + Phase 2 shipped:**
- ✅ **Feed mirror live** — league published `stats.womensprobaseballleague.com/v1`; `wpbl-ingest` Edge Function + cron mirror games/lines/play-by-play/TrackMan into Supabase; hand-entry retired. (`add_wpbl_api_ingest.sql`, `wpbl_cron.sql`.)
- ✅ **Game Center** (`GameDetail.tsx`) — fixed-height tabbed modal: line score, box score (one team at a time, hitting+pitching), collapsible play-by-play, TrackMan pitch data (by-pitcher, driven off the box-score names).
- ✅ **Rich home** — scoreboard strip, standings + teams cards, batting/pitching leaders (team badges + View all), a **Next game card with countdown**.
- ✅ **Stats tab** (`StatsView.tsx`) — full sortable hitting/pitching table, team filter, qualified toggle (auto-on once every team has 2+ games), full-bleed so all columns show.
- ✅ **Player pages redesigned** — batting/pitching/fielding cards with a rate-stat hero + aligned stat line, game log split by type, per-stat hover tooltips, smart fielding (PB/SBA/DP only when relevant).
- ✅ **Hall of Firsts** (`firsts.ts`) — first HR / win / strikeout / stolen base / complete game etc. from play-by-play + box lines, featured on home with portraits + View all.
- ✅ **Live updates** — schedule/scoreboard/standings/leaders poll (20s live / 60s idle) + refresh on tab focus; Game Center already polled the open game.

- 🔬 **Next (Phase 3 — hardening → depth → engagement → postseason), in priority order:**
  1. **Data-quality + ingest hardening** — *in progress:*
     - ✅ **Name variants** — the ingest now auto-resolves prefix nickname shortenings (Val↔Valerie, Alex↔Alexandra) via a new `PlayerResolver.nickname()` matcher, on top of the existing accent/case norm + edit-distance-1 fuzzy (Fox↔Foxx). Only non-prefix nicknames (Gabby↔Gabriella) still need the manual `wpbl_merge_players.sql`.
     - ✅ **Hall of Firsts bug fixed** — first hit / first RBI were misattributed because the feed play log spells name variants ("Maggie Fox") that the ingest's exact-only play `resolveName` left with a null `batter_id`, so `firsts.ts` silently skipped the genuine first. Now it falls back to the play's name via the forgiving matcher and attributes even unresolved players by feed name, so the chronologically-first event always wins. Also orders same-day games by start time (not just per-game sequence). Verified against the real inaugural game: first hit + first RBI → Maggie Foxx (seq 7).
     - ✅ **Ingest health indicator** — new `wpbl_ingest_runs` log table (`scripts/add_wpbl_ingest_health.sql`); the function writes a row every run (ok/games/boxscores/errors/duration); admin-only freshness dot on the WPBL home header (green fresh / amber stale-or-errors / red failed).
     - ✅ **TrackMan "Unknown" pitcher — fixed.** Investigating the live feed showed the real cause: the box score spells a pitcher "Maggie Fox" while TrackMan spells her "Foxx, Maggie", so the client's exact-name merge missed her velocity AND made it look like two pitchers were unnamed, which broke the single-candidate rescue for the genuinely-unnamed starter. `GameDetail.tsx` now matches box↔tracking names tolerantly (surname within one edit + given-name prefix/edit), so all named pitchers get their velo and the lone unnamed starter is rescued. Client-only (no deploy). The truly-null tracking rows (no inning/half/batter/name/id — confirmed unrecoverable from feed data) stay handled by the rescue; a game with ≥2 genuinely-unnamed pitchers still footnotes (feed limitation, not fixable).
     - ✅ **Duplicate-game dedup — moved server-side.** Confirmed the phantom is a stale "Not Started" copy left beside a completed game (weather-delay artifact: same date+matchup, different game_id). `wpbl-ingest` now suppresses it (deletes the phantom row from the mirror; self-heals if it ever actually starts), so every consumer gets a clean schedule. The client `dedupeSchedule` stays as a cheap no-op fallback.
     - ⚠️ **DEPLOY PENDING for the dedup** — needs `supabase functions deploy wpbl-ingest` (already deployed once this session, so redeploy after the dedup change) + a re-ingest to clear the already-stored phantom. The TrackMan + Firsts fixes are client-only (ship with the build). Health-log SQL already run.
  2. **Loose ends** — *in progress:*
     - ✅ **Browser back-stack** — WPBL navigation now lives in `history.state` (`WpblApp`): every tab change / team-detail / game+player modal pushes a snapshot, `popstate` restores it, and modal ✕/Escape route through `history.back()` so they and the browser Back are one action. Modals stack correctly (Back closes the player, leaves the game). The MLB|WPBL toolbar switch already pushes its own route entry, so section-switching sits in the same stack (Back from WPBL home → /mlb; Back into WPBL restores the exact prior state, modals included). Verified end-to-end in the browser, no console errors.
     - ✅ **BOS & NY secondaries confirmed** — BOS `#f3801b`, NY `#67c3e9` (`WPBL_TEAMS` in constants.ts; flows to badge rings via `wpblSecondary`).
     - ⏸️ Multi-season support — deferred (only the inaugural season exists; revisit for 2027).
  3. ✅ **Team pages** — `src/wpbl/TeamPage.tsx` replaces the plain roster list: header + record/standing, full results (W/L + vs/@, click into Game Center), team batting & pitching season totals, team leaders (OPS/HR/RBI, ERA/SO), and a roster with inline stats (AVG/HR/RBI for hitters, IP/ERA/SO for pitchers). Verified in-browser with real data; fixed pitcher detection for RHP/LHP position codes (`isPitcherPos` + `POSITION_ORDER`).
  4. ✅ **Search integration** — WPBL players + teams now feed the shared header search. The search bridge (`SearchBridgeContext.ts`) gained a `source` discriminator + a self-describing `resultRows` path so the always-loaded toolbar can render WPBL results (portrait/logo URLs + team colors) without importing the lazy WPBL chunk; MLB keeps its own richer player/team dropdown untouched. `WpblApp` registers as the search owner while `/wpbl` is mounted, filters the full roster + teams on the typed query, and each result's `onSelect` routes through the existing `openPlayer`/`selectTeam` so the section back-stack stays intact. (WPBL recents/suggestions deferred — the empty-query dropdown stays MLB-only for now.)
  *(Realigned Aug 4, 2026 — search shipped; "followed players/teams + notifications" dropped from the active plan; the live season now drives priorities. New order below.)*
  5. ✅ **Ingest deploy closed out** — `wpbl-ingest` is live at **v5** (server-side dedup + ingest-health logging), and the 2-minute `mode=active` pg_cron is firing cleanly (verified Aug 5: a clean 30-game mirror, phantom cleared, `wpbl_ingest_runs` logging every run ok). Live scores now auto-refresh and the admin freshness dot reads green.
  6. ✅ **Live-data QA sweep** — audited the whole mirror (2 finals + full roster/lines/plays/tracking) against the source. **Data integrity is clean**: no orphan line player_ids, no duplicate players, both finals reconcile exactly (batting runs = line-score sum = final score), pitching decisions present, all TrackMan rows carry velo, 30-game schedule with zero duplicate matchups (dedup holding). The one real finding was **name-variant resolution**: the feed play log spells four players as variants of their roster name (Maggie Fox→Foxx, Val→Valerie Perez, Gabriella→Gabrielle Haas, Isabella Villareal→Villarreal), and the client Hall-of-Firsts `findByName` fallback only matched first-name-exact + surname-prefix, so three of the four wouldn't link. **Fixed (client-only)** — `firsts.ts` `findByName` now mirrors the ingest box-score resolver's tolerance (surname + given name each match on equal / prefix / within-one-edit) with an unambiguous-single-candidate guard; validated against the live roster (all four link, zero collisions across 119 players). No first is *currently* owned by an affected player, so this future-proofs the linking rather than fixing a visible error. ⏸️ *Deferred (near-zero impact):* the ingest's play-level `resolveName` is still exact-only, so `wpbl_game_plays.batter_id/pitcher_id` stay null for these variants — but nothing but Hall of Firsts reads them, and that now resolves by name. Revisit only if a feature needs play→player linkage (would need a redeploy + `mode=all` re-ingest to backfill).
  7. ✅ **Richer standings** — the Standings page now shows W / L / **PCT / GB / L10 / STRK** (was just W/L/Diff). `computeStandings` (api.ts) derives win%, games-back from the leader, current W/L streak, and last-10 record from the chronologically-ordered final games, and its sort gained a **head-to-head tiebreak** (win% → H2H record between the tied pair → run differential). Rendered as a real fixed-layout table (L10 hidden on xs for mobile fit), streak/L10 colored green/red, and rows click through to the team page. `WpblStandingRow` extended (backward-compatible — Home's standings card + TeamPage still read wins/losses/RS/RA). Validated against live data (SF & LA co-lead 1.000, tiebreak by run-diff; NY/BOS GB 1.0).
  *(Realigned Aug 5, 2026 — richer standings shipped; **playoffs deprioritized** (the format takes all four teams to the postseason, so a bracket/clinch tracker has little stakes and can wait). Remaining work reprioritized around the section's unique data + live-season engagement. Grounded in a feature-surface audit vs the MLB app: WPBL surfaces Home / Schedule / Standings / Stats / Teams / Game Center / Player pages / Hall of Firsts / search / live updates; it has NO predictions, no daily standouts, no win-probability, no league primer, and its TrackMan velo is trapped inside one game's Pitch Data.)*
  8. ✅ **Velocity / TrackMan leaderboards** — new **Tracking** tab (`src/wpbl/TrackingView.tsx` + `tracking.ts` aggregation + `fetchWpblAllTracking` in api.ts). League-best tiles (fastest pitch, hardest hit, longest hit) + a Pitching/Hitting toggle: velocity leaders (by hardest pitch, with avg + count), fastest individual pitches (with pitch type), spin leaders; and exit-velocity + distance leaders for batted balls. Season-wide aggregation attributes each pitch/ball by feed id (= our `api_id`) → forgiving name match → the per-game single-candidate rescue for the unnamed starter (reused from GameDetail). Fetch uses a slim PostgREST jsonb projection (`raw->>…`) so it never ships the whole `raw` blob, paginated for the full season. Verified against live data (Ayami Sato 79.4 max, the previously-unnamed fastest pitch rescued to her; Alexia Jorge 315-ft longest). Distinctive data no other baseball site surfaces. *(Aug 5 follow-up: the "Longest hits" card is renamed **"Longest tracked hits"** with a "By radar-measured distance" subtitle + a footnote, because TrackMan only records a distance on ~60 of 400 rows and missed the season's lone home run (Benites) — so an absent HR reads as a data gap, not a bug. Also hardened `tracking.ts` to gate the hardest / longest boards on independent feed fields — a ball can rank on distance without an exit-velo reading, and vice-versa. Still open: a small Home teaser card linking here.)*
  9. **Game predictions / pick'em (+ bots)** — the marquee engagement feature, now viable with the live feed. Pick winners of upcoming games, grade against finals, per-user record + a Wilson-ranked leaderboard (mirror the MLB `game_predictions` / `prediction_stats` / precomputed boards pattern; auth already exists). Phase 1: pick UI + grading + leaderboard. Phase 2: bots (Coin Flip / Homer / a Pythagorean-from-run-diff) via a daily GitHub Action like `daily-bots.yml`. Largest item, highest engagement.
  10. **Daily standouts (Home card)** — a "top performers" card highlighting the best hitting + pitching lines from the latest game day (mirrors MLB's TopPerformers/Spotlight), built from box lines already fetched. Keeps Home fresh each game day; low-to-medium effort.
  11. **League primer + stat glossary** — a short "What is the WPBL" explainer (four teams, one hub venue — Robin Roberts Stadium, Springfield IL — inaugural Aug–Sep 2026, link to the official site) plus a glossary of the stat abbreviations, alongside the existing "stats from the official feed, not affiliated" note. Cheap; the league is brand-new so first-time visitors need context.
  12. **Win probability in Game Center** — add a win-prob line for live/final games (the MLB Game Center has one) from a generic score / inning / base-out model. Adds depth; medium effort, the fiddly part being a credible model for a league with no history.
  13. **Incremental depth** — fielding columns in the Stats tab (already computed in `stats.ts`, only shown on player/team pages); player-page splits (vs each team) as the sample grows; team-page pitch-velo; WPBL recents in the empty-query search dropdown.
  - ⏸️ **Deferred / parked** — Playoffs & championship view (low stakes, everyone qualifies; revisit near season's end only if the format tightens). Multi-season (2027). Followed players + notifications (tiny league). Ingest play-level `batter_id`/`pitcher_id` backfill (only if a play→player feature needs it — e.g. win prob or a "biggest hits" feed).
  - 🧹 **Data hygiene / ops (ongoing)** — delete the "Suzu Naraski" duplicate roster row (SQL provided); periodic dupe/orphan audit; ask the WPBL for permission to republish player headshots before the section grows (rights caveat from the portrait work).
  - 🎁 **Later — remaining fun MLB mechanics** — streak report cards + Milestone Watch (more valuable once the season accumulates history) and a WPBL Streak Survivor (thinner with only four teams; a pick-a-team-to-win variant).

**Aug 6, 2026 realignment — the "Wpbl" Google Tasks list.** A new Google Tasks list ("Wpbl", pulled via `npm run tasks`) captured 7 hands-on **polish / bugfix / hygiene** items that weren't on the feature-forward Next list above. Sequenced into three sprints ahead of the marquee predictions feature (#9), which is untouched:
  - **Sprint A — fix & refine shipped surfaces** *(in progress):*
    - ✅ **Tracking data missing for a previous game** — root-caused: the Aug 5 BOS@LA game has **zero TrackMan in the feed itself** (Aug 1/2 have full 200 rows each), so it's a league-side feed gap. Behind it, a real defect: `mode=active` never re-fetches a game once stored `final`, so late-arriving TrackMan (which routinely posts *after* a game goes Final) would be lost forever. Fixes: (a) **ingest backfill** — re-fetch recently-final games (≤3 days) still missing tracking so late data self-heals then stops (`wpbl-ingest`, **⚠️ deploy pending**); (b) **client empty-state** — the Pitch Data tab now shows on any played game with an explicit "No pitch tracking" note instead of silently vanishing (ships with the build).
    - ✅ **Box-score mobile columns** — batting reordered importance-first (`AB R H RBI BB SO` lead; `HR 2B SB` after), so K/BB are visible before 2B on a phone.
    - ✅ **Box-score Tracking summary** — the Pitch Data tab now leads with a standout game-highlights strip: **hardest pitch · hardest hit (exit velo) · first hit**, with the detailed per-pitcher tables kept below.
    - 🔍 **Game duration** — investigated thoroughly, not reliably derivable. The feed has no duration/first-pitch field; `completed_at` is a processing timestamp (hours after the game); **plays carry no timestamps at all** (inning/half/sequence/counts only — so first-play↔last-play can't work); the *only* wall-clock stamps are TrackMan `occurred_at`, which are real + monotonic **but the feed caps tracking at 200 events/game (~68% coverage — Aug 2 tracked 200 of ~293 pitches)**, so the last tracked event is ~⅔ through the game, undercounting duration by a variable amount — and it's absent entirely for untracked games (e.g. Aug 5). Parked until the feed exposes a real first-pitch/final-out timestamp or lifts the 200-row cap.
  - **Sprint B — hygiene & ops** ✅ *(done):*
    - ✅ **Off-roster filter** — the roster seed carries the whole 118-player draft board, but ~half were drafted and never signed. `TeamPage` now shows only `status === 'Signed'` players plus anyone with a recorded stat line (the override self-corrects on debut and keeps signed-but-not-yet-played players). Verified live: LA roster 29 → 18. Uses the seed's Signed/Drafted marker — `active` is true for everyone and `api_id` only sets on first appearance, so neither distinguishes a benched roster player from a cut draftee; `status` does.
    - ✅ **Freshness consolidated to Admin** — the WPBL feed-mirror ingest health moved off the WPBL home header into the site Admin panel as a "WPBL Ingest" section (green/amber/red = fresh / stale-or-errors / failed, with last-run mode + games/boxscores + age), alongside the existing payroll/contract freshness. Retired the `isAdmin` plumbing through `WpblApp`/`WpblHome` (the flag only gated that dot) and the now-dead `fetchWpblIngestHealth`.
  - **Sprint C — cross-cutting** *(next):* user accent-color picker in Settings.

**Aug 6, 2026 — bots ops note.** The `daily-bots` GitHub Action began failing today; root cause was a **GitHub Actions major outage** (jobs cancelled/failed in "Set up job" before any bot code ran — every other workflow that ran earlier in the day succeeded). Nothing wrong with the bot code/deps/secrets. Hardened `daily-bots.yml` with a **90-min backup schedule** (`30 15 * * *`) and a **10-min job timeout** so transient runner drops get a second attempt and a stalled fetch fails fast; needs to land on `main` to take effect.
