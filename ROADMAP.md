# MLB App Roadmap

> Living document — a menu of ideas, not a contract. Reorder/drop freely.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **July 29, 2026** (post-v1.22.0 — Milestone Watch archive + imminence ordering shipped)

## Where the app stands

**Strong:** live scoreboard + deep Game Center (play-by-play, scrubbable win-probability, live situation, full box scores), personalized home feed (team card, followed players with form sparklines, standings snapshot, dual daily report cards, standout carousel, On Fire / Ice Cold), predictions game with vote bars, confidence-ranked leaderboard and running record, bot rivals, installable PWA with daily pick-reminder push, all-time leaderboards, rosters, recent-search UX, dark mode, responsive, exact back-button restoration.

**Shipped since the last roadmap revision (v1.4 → v1.22.0):**
- ✅ Streak Survivor + playoff odds (v1.16.0), bot opponents (v1.16.1), pick-tomorrow-once-done (v1.16.2)
- ✅ Milestone Watch (v1.17.0), data-gated card (v1.17.1), recent-reached archive + hitting/pitching filter (v1.18.0), reached archive + imminence ordering (v1.22.0)
- ✅ Prediction streak heaters + 🧠 Sabermetric Bot (v1.19.0); weekly/monthly leaderboard cuts (v1.20.0)
- ✅ Player contracts + doubleheader/ordering fixes (v1.14.0); iron-man streaks + today's stats (v1.15.0)
- ✅ Site footer with version, feedback, and Ko-fi support; charcoal default dark mode; dark-aware team logos; MLB app defaults to Home
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

## Prioritized backlog (P0 / P1 / P2)

> Merges the live **Site todos** (Google Tasks, 15 open as of Jul 29) with roadmap gaps and
> infra debt. P0 = broken/eroding trust, fix first · P1 = high-value, mostly small · P2 = polish & bigger builds.
> Already-shipped tasks pruned: donation link, "indicate recent milestones", career/season+hitting/pitching sort.

### P0 — broken or trust-eroding (do first)
1. **Modal scroll-lock** 🐛 — background scrolls behind open cards; should be locked. Affects every modal. _(Site todo)_
2. **Predictions header wraps to 2 rows on mobile again** 🐛 — regression after the "tomorrow" icon landed. _(Site todo)_
3. **Postponed games in the scoreboard** 🐛 — `ScheduleStrip` shows PPD but the scoreboard doesn't account for them; correctness. _(Site todo)_
4. **Followed-players add-player popup is clipped** 🐛 — must render in front of the card instead of being cut short (z-index/overflow). _(Site todo)_

### P1 — high value, mostly quick
5. **Playoff odds beside every homepage team** 🎯🔬 — extend the shipped `playoff_odds` strip from just-your-team to each listed team. _(Site todo + roadmap: playoff-odds follow-on)_
6. **Predictions default state** 🎮 — show 0–0 with a 50/50 color bar instead of blank. _(Site todo)_
7. **Simplify the predictions entry** 🎮 — change "view all X games" to "Make predictions" and drop the redundant top button. _(Site todo)_
8. **Suggested predictions surface the preferred team** 🎯 — always float the user's followed team. _(Site todo)_
9. **Next opponent is unclear on the mobile home team card** 🎯 — make "who's next" legible at a glance. _(Site todo)_
10. **Trim the mobile search team card** 🎯 — much shorter; consider dropping team stats so the schedule is instantly visible. _(Site todo)_
11. **Onboarding: no signup popup on first team-select** 🎯 — replace with a light nudge to the top-right profile button. _(Site todo)_
12. **Google sign-in shows a raw/spam-looking URL for supra** 🐛 — Supabase custom auth domain so the OAuth consent screen reads as trustworthy. _(Site todo; conversion/trust)_
13. **Bot decision explainer on the leaderboard** 🎮 — info tooltip per bot on how it picks. Pairs with Stat explainers (shared component). _(Site todo + roadmap Phase 3)_
14. **Label career vs season on reached milestones** 🔬 — the reached-archive rows don't carry it yet. _(Site todo)_
15. **Prod error visibility** ⚙️ — `client_errors` table fed by `window.onerror`. Today bugs only surface when you hand-file them; telemetry closes that loop. _(roadmap infra; my add — high leverage given the bug list above)_
16. **Server-side leaderboard ranking** ⚙️ — move Wilson ranking into a SQL RPC (top N + current user) before the table grows. _(roadmap infra; my add — pay down before it bites)_

### P2 — polish & bigger builds
17. **Player pictures never circular** 🎯 — square them on team roster + roster moves for consistency. _(Site todo)_
18. **Close-game push alerts** ⚙️🎯 — "up 2–1 in the 8th"; reuses shipped push plumbing + the milestone-alert pattern. _(roadmap "suggested next")_
19. **September race page + magic numbers** 🔬🎯 — playoff-odds follow-on, timely as divisions clinch. _(roadmap; seasonal)_
20. **Daily Trivia** 🎮🎯 — second Phase 2 game, offseason-proof. Only Streak Survivor ships today. _(roadmap Phase 2)_
21. **Stat explainers** 🎯 — tap any abbreviation → plain-English tooltip; one shared component (see #13). _(roadmap Phase 3)_
22. **Payroll source resilience** ⚙️ — FanGraphs 403 fallback so payroll boards don't silently go stale. _(roadmap infra)_

> **Cross-cutting note (my read):** items 2, 9, 10 are all "this card is too tall / unclear on mobile."
> Worth one focused **mobile density sweep** rather than three isolated patches. Likewise 11 + 12 are one
> **onboarding-trust epic** — the first-run flow is where you're leaking conversion.

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
- ✅ **Milestone Watch** 🎯🔬 — Shipped. Home card of active players closing in on career round numbers, single-season marks, and all-time records (nightly `update-milestones.yml` → `milestone_watch`); View-all modal grouped career/season/records, and a followed-player bell alert when someone's within a few. Third precompute customer. **v1.18.0:** also surfaces milestones *just reached* (the nightly run diffs a totals snapshot to catch crossings, keeps them 7 days), and the View-all modal filters by hitting/pitching. **v1.22.0:** dedicated reached-archive with imminence ordering. *Open:* push delivery of the milestone alerts (bell only today); the reached-milestone rows don't yet label career vs season (open Site todo).

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

**Suggested next three:** clear the four **P0 bugs** first (modal scroll-lock, mobile predictions header regression, postponed-game scoreboard, clipped add-player popup) — they erode trust on every visit → then the **onboarding-trust epic** (P1 #11 + #12) since that's the conversion leak → then **playoff odds beside every homepage team** (P1 #5), which is timely as the races tighten and reuses shipped data. Phase 1 is fully shipped and Predictions 2.0 is complete (v1.20.0); the retention loop now leans on bug-cleanup, onboarding, and the next daily game (Daily Trivia, P2 #20). See the **Prioritized backlog** section above for the full P0/P1/P2 list.
