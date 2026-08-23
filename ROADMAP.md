# MLB App Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Scope: the **MLB section** (`/mlb`) only. The WPBL section has its own plan and its own
> calendar: see **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)**. (The two lived in this file until
> Aug 16, 2026; the WPBL section had outgrown being an appendix.)
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Aug 10, 2026**: the cross-cutting auth return-to-page fix landed with
> that day's WPBL work. Nothing in the MLB list below has moved since; treat the "Suggested
> next three" as the live front.
>
> **Status note, Aug 22, 2026: this section is dormant on purpose, and the measurement says
> keep it that way.** Over the 14 days to Aug 19, `/mlb` drew 768 events across 33 browsers
> against `/wpbl`'s 18,213 across 2,036 (see "What the traffic says" in
> [ROADMAP-WPBL.md](ROADMAP-WPBL.md)). WPBL's feed stops Sep 22 and its work is deadlined;
> nothing here is. The MLB cron jobs all still run and the section still works: it is
> unattended, not broken. Revisit when the WPBL season is over.

## Where the app stands

**Strong:** live scoreboard + deep Game Center (play-by-play, scrubbable win-probability, live situation, full box scores), personalized home feed (team card, followed players with form sparklines, standings snapshot, dual daily report cards, standout carousel, On Fire / Ice Cold), predictions game with vote bars, confidence-ranked leaderboard and running record, bot rivals, installable PWA with daily pick-reminder push, all-time leaderboards, rosters, recent-search UX, dark mode, responsive, exact back-button restoration.

**Shipped since the last roadmap revision (v1.4 → v1.9 + in flight):**
- ✅ Live Game Center: built, then deepened (win-prob scrubbing, between-innings states, due-up stats, 9-inning line score)
- ✅ PWA + push foundation: installable, Settings toggle, daily "make your picks" reminder Action (`docs/PUSH_NOTIFICATIONS.md`)
- ✅ Pick consensus: live vote bars with percentages on the home predictor
- 🟡 Predictions 2.0: confidence-ranked (Wilson) leaderboard + running record shipped; badges/weekly boards/smart bot still open
- ✅ Player streak report cards (🔥 hitting / 🧊 scoreless / 🥶 hitless): shipped with nightly precompute (`update-streaks.yml` → `streak_leaders`)
- ✅ Playoff odds: nightly Monte Carlo (`update-playoff-odds.yml` → `playoff_odds`); Odds tab in Standings + followed-team odds strip. Second precompute customer
- ✅ Backlog sweep (v1.18.0): recently-reached milestones + hitting/pitching filter, trades show both players on the Roster Moves card, team pages show their schedule (today highlighted), and a batch of mobile fixes (predictions header overlap, tappable report-card info buttons, player-page section order)
- ✅ Single-Game Standout bar (v1.18.1): the standout carousel now gates on a genuine standout line instead of "best of the day," so a thin early-day slate falls back to the most recent day with a real standout. Clears the last open Site todo

**Deliberately dropped:**
- ~~Friend leagues~~: fantasy apps already own this. The social slot goes to **bot rivalry** instead: the app's personality is you vs. the bots, not you vs. your group chat.
- Game-thread reactions: shelved with the social layer.

**Gaps driving this roadmap:**
1. **Retention is solo now**: with friends out, the daily loop must come from quick daily games, streak mechanics, richer push alerts, and bots with personality.
2. **Calendar-blind**: the app doesn't know the trade deadline is July 31, that races tighten in August, or that October exists. Every era of the season is a content opportunity it currently ignores.
3. **Numbers-only for casual fans**: no stat explainers, no narrative layer.
4. **Infra ceiling rising**: streak boards fan out ~100 client-side fetches per visit; leaderboard ranking pulls the whole table client-side. The nightly-precompute pipeline now has real customers waiting.
5. **Offseason darkness**: unchanged; November is coming.

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

## Phase 1: Ride the season (now → September)

- ✅ **Land the streak boards + first nightly precompute** ⚙️: Shipped v1.11.1 (`update-streaks.yml` → `streak_leaders` table, client reads one row). This is the reusable template every later precompute (odds, trivia, grid puzzles) copies.
- ✅ **Trade Deadline HQ** 🔬🎯: Shipped: Roster Moves strip + deadline countdown (v1.11.0) and move-badges on followed players (v1.12.0). Feed stays useful all year (injuries, call-ups, DFAs). *Open (optional):* a deadline-day live view, low ROI post-Jul 31.
- ✅ **Predictions 2.0** 🎮: Done. Wilson-ranked board + running record (v1.9.0); streak badges + heater banner and the 🧠 Sabermetric Bot (Pythagorean + log5 + home edge) in v1.19.0; weekly/monthly leaderboard cuts in v1.20.0 (nightly `update-prediction-boards.yml` → `prediction_boards`, All-time/30d/7d toggle on the board). Fourth precompute customer of the streak template. The board still ranks by Wilson lower bound so a hot small sample can't leapfrog a proven record.
- 🟡 **Push alerts beyond the daily reminder** ⚙️🎯: Game-start reminders shipped (v1.13.0, `game-start-reminders.yml`). Still open: "up 2–1 in the 8th" close-game alerts, followed-player milestone pings. Reuses the shipped plumbing.
- ✅ **Playoff odds** 🔬🎯: Shipped. Nightly Monte Carlo of the remaining schedule (`update-playoff-odds.yml` → `playoff_odds`); "Odds" tab in Standings (make-playoffs / win-division % per league) + odds strip on the followed-team card. Second consumer of the streak-precompute template. *Open (September):* magic numbers + a dedicated race page as the divisions clinch.
- ✅ **Milestone Watch** 🎯🔬: Shipped. Home card of active players closing in on career round numbers, single-season marks, and all-time records (nightly `update-milestones.yml` → `milestone_watch`); View-all modal grouped career/season/records, and a followed-player bell alert when someone's within a few. Third precompute customer. **v1.18.0:** also surfaces milestones *just reached* (the nightly run diffs a totals snapshot to catch crossings, keeps them 7 days), and the View-all modal filters by hitting/pitching. *Open (optional):* push delivery of the milestone alerts (bell only today).

## Phase 2: Daily games (no friends required)

Solo-first games sharing auth + leaderboards + streak infra. Bots play these too, and beat-the-bot is the multiplayer.

- ✅ **Streak Survivor** 🎮: Shipped. Pick one hitter a day to get a hit; a miss resets. Home card + leaderboard, nightly resolver (`resolve-survivor.mjs`), and 3 bot entrants (🤖 Streak / Chalk / Coin Flip Bot) that pick each morning. *Open (optional):* a dedicated full-screen view, and streak-milestone push alerts.
- **Daily Trivia** 🎮🎯: One auto-generated question/day from StatsAPI history, Wordle-style streaks. Works year-round, i.e. offseason insurance.
- **Mystery Player** 🎮: Guess from progressive clues (team → position → stat line → silhouette). Shareable result grid.
- **The Grid** 🎮: Immaculate-Grid-style 3×3 team/stat intersections; puzzles precomputed in Actions.
- **October Bracket Challenge** 🎮: Postseason bracket, points by round. Build in September, launch with the Wild Card round.
- **Card collection** 🎮: Predictions and games earn player cards (rarity tiers); the reward layer that makes every other game more rewarding. Build after two or more games exist.

## Phase 3: Depth & narrative

- **Stat explainers** 🎯: Tap any stat abbreviation → plain-English tooltip. One shared component, app-wide. Small effort, big casual-fan payoff; slot in anytime.
- **Splits & situational stats** 🔬: vs LHP/RHP, home/away, last 15/30, RISP (`stats=statSplits&sitCodes=...`). Player-page tab.
- **Player comparison tool** 🔬: 2–3 players side-by-side + radar chart; mostly assembly from charts.tsx + stat defs.
- **Statcast layer** 🔬: Baseball Savant public endpoints (verify access rules). Exit velo, barrels, xwOBA; "Luckiest Hitters" report card (xwOBA−wOBA).
- **Narrative recaps** 🎯: Template- or LLM-generated one-paragraph game stories (nightly Action); makes the Game Center readable for casual fans.
- **Farm report** 🔬: MiLB via sportId 11–16; follow prospects, team's top farmhands and AAA lines.

## Phase 4: All-season & long-term

- **Season Wrapped** 🎯🎮: October recap: team arc, followed players' best games, your prediction record. Shareable cards (Web Share API). **Start collecting anything per-user that Wrapped needs by early September.**
- **Offseason mode** ⚙️🎯: Calendar-aware home: free-agency tracker + signing predictions, awards ballots, Opening Day countdown. The transactions feed from Phase 1 is the backbone.
- **This Day in Baseball / History Explorer** 🎯: StatsAPI goes back a century. Daily card; franchise pages; all-time leaderboards already exist as a foundation. Could grow a "replay a classic game" mode via historical play-by-play + the existing Game Center UI.
- **Second sport**: Launcher architecture supports it; NFL pick'em would reuse ~80% of the predictions infra, and the offseason overlaps perfectly with MLB's dark months.

## Infrastructure thread (under everything)

- **Precompute nightly, serve from Supabase** ⚙️: Streak leaders ✅, playoff odds ✅, and milestone watch ✅ shipped on this template; next candidates: report cards, spotlight, trivia, grid puzzles. Client reads one row instead of fanning out to StatsAPI.
- **Server-side leaderboard ranking** ⚙️: Move the Wilson-score ranking from `PredictionStats.tsx` into a SQL RPC (top N + current user's row) before the table gets big.
- **Payroll source resilience** ⚙️: Fallback for FanGraphs 403s (Spotrac/Cot's) so payroll boards don't silently go stale.
- **Prod error visibility** ⚙️: No way to know today whether visitors hit errors. Even a tiny Supabase `client_errors` table fed by a `window.onerror` hook would answer "is anything broken?"

---

**Suggested next three:** close-game push alerts (reuses the shipped push plumbing + the milestone-alert pattern, as in "up 2–1 in the 8th") → a second Phase 2 daily game (Daily Trivia is the offseason-proof pick) → the September race page + magic numbers (playoff-odds follow-on, timely as divisions tighten). Phase 1 is fully shipped and Predictions 2.0 is now complete (v1.20.0), so the retention loop leans on push alerts and the next daily game.
