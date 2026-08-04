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
- **Phase 3 (engagement + postseason)** 🔬🎮 **← next** — see "Next" below: playoffs view, followed players/teams + notifications, team pages, search integration, and porting the fun MLB mechanics (streak cards, milestone watch, predictions/bots) now that a live feed exists.

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

- ⬜ **Next (Phase 3 — engagement + postseason):**
  1. **Playoffs & championship view** — the inaugural season ends mid-Sept with a postseason; add a bracket / clinch tracker as it approaches.
  2. **Followed players/teams + notifications** — reuse the site notification system for WPBL: game-start reminders, final scores, and followed-player firsts/milestones (Hall of Firsts is a natural source).
  3. **Team pages** — team stat leaders, results, batting/pitching totals, roster with inline stats (today Teams is just a roster list).
  4. **Search integration** — wire WPBL players/teams into the toolbar search bridge.
  5. **Port the fun MLB mechanics** — streak report cards, milestone watch, and predictions/pick'em + bots for WPBL games (the live feed now makes this viable).
  6. **Data-quality + ingest hardening** — reconcile feed name variants (e.g. "Fox"/"Foxx"), the "Unknown" pitcher gaps in TrackMan, the duplicate-game feed quirk (currently deduped client-side); consider an ingest health indicator.
  7. **Loose ends** — browser back-stack for team/player detail within /wpbl; confirm/swap BOS & NY secondary colors; multi-season support for future seasons.
