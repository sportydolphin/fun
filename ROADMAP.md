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

**Architecture — inverts the MLB model.** MLB is read-only against StatsAPI with no DB for game data. WPBL makes **Supabase the source of truth**: the owner enters data through an admin UI, the public reads it. Reuses the site's existing owner-RLS pattern (`public.is_site_owner()` for writes, public read).

**Locked decisions:**
- **Lean MVP** — teams, rosters, schedule, scores, standings, basic season stat totals. Box scores + leaderboards land in the season phase; the flashier stuff (streak cards, milestone watch, predictions) only after there's data history.
- **Scores + box scores entry** — full batting/pitching lines per game (enables player stats), so the entry UX matters. A "paste box score" parser is worth building early to cut the ~10-20 min/game once games start.
- **WPBL-native components** — build lean components for the small dataset rather than forcing WPBL data into StatsAPI-shaped types. Borrow the site's *conventions* (team-color map à la `TEAM_BG`, modal pattern, compact tabular-nums tables, responsive cap-and-center) so it still feels like the same site.

**Phasing:**
- **Phase 0 (now → Aug 1)** ⚙️ — schema + owner-RLS + public-read; seed teams/rosters/schedule **via a seed script** (all public now; admin CRUD deferred to Phase 1 when box-score entry needs it); `/wpbl` section shell reached by a **toolbar league toggle** (MLB | WPBL — needed since root now lands on `/mlb` with no launcher); schedule and team/roster pages. Everything here is static and known before launch.
- **Phase 1 (season)** 🔬 — box-score entry form + paste-parser, scores, standings (derived), player season totals, player pages.
- **Phase 2** 🔬🎮 — game logs, leaderboards, home-view polish.
- **Phase 3+** 🎮 — port the fun MLB mechanics (streak cards, milestone watch, maybe predictions) once a season of data exists.

**Open items:** the box-score paste format is unknown until game one (parser is a Phase-1 task); decide whether the entry UI extends AdminPanel or lives as a dedicated `/wpbl` admin sub-view (leaning dedicated — box-score entry is bulky and WPBL-specific).

**Progress (as of Jul 29, 2026):**
- ✅ **Schema drafted** — `scripts/create_wpbl.sql`: five tables (teams, players, games, batting_lines, pitching_lines) with public-read / owner-write RLS via `public.is_site_owner()`. Line tables included now to avoid a second hand-run migration. Text-slug team ids (e.g. `BOS`); pitching IP stored as `outs` (int) for clean season aggregation. **Not yet run in Supabase.**
- ✅ **Frontend skeleton built** — `src/wpbl/` (`types.ts`, `constants.ts`, `api.ts`, `WpblApp.tsx`) + wired into `App.tsx` (`/wpbl` route, lazy `WpblApp`, toolbar MLB | WPBL toggle as the entry point). Views: Home / Schedule / Standings (derived) / Teams+roster, all lean and WPBL-native. Reads degrade gracefully (empty states) pre-migration; typechecks clean and renders with no console errors. ⚠️ Team colors in `constants.ts` (`WPBL_TEAMS`) are **provisional placeholders** — swap for the real palette when gathering assets. Logos not wired (fall back to abbr text until `logo_url` is seeded).
- ✅ **`create_wpbl.sql` run** in Supabase (2026-07-29) — tables live.
- ✅ **Seed run + verified** — `scripts/seed_wpbl.sql` (4 teams + full 30-game schedule, Aug 1 – Sep 6, cross-checked vs official site + trackers, 15 games/team; idempotent via team upsert + games natural-key unique index) run in Supabase 2026-07-29. Confirmed live on `/wpbl`: Home "Next up", Schedule renders the full slate grouped by date (doubleheaders stack), Standings shows all four 0–0, Teams grid + team detail with roster empty state. No console errors. **Phase 0 is functionally complete.**
- ✅ **Rosters complete** — `wpbl_players` extended with `age`/`hometown`/`status`/`draft_round`/`draft_pick` + `(team_id, name)` unique index (`scripts/add_wpbl_player_fields.sql` for existing DBs; baked into `create_wpbl.sql` for fresh). `scripts/seed_wpbl_rosters.sql` holds all four teams from the 2026 draft board — **118 players** (BOS 30, LA 29, SF 29, NY 30), idempotent, apostrophes escaped, sparse rows handled (null age/pos/etc.). Team-detail UI shows position/hometown/age/B-T. **Migration + roster seed written, not yet run** (verify counts on `/wpbl` after running).
- ⬜ **Next (pick up here):** owner runs `add_wpbl_player_fields.sql` then `seed_wpbl_rosters.sql` (both idempotent — safe even if the earlier Boston-only version was already run); still to supply real team colors (swap in `constants.ts` + re-run team upsert) + hosted logos (`logo_url`). Then **Phase 1**: box-score entry UI + paste-parser, player pages, season totals. Known follow-ups: browser back-stack for team detail; global footer still says "Not affiliated with MLB" on the WPBL route.
