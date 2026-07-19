# MLB App Roadmap

> Living document — a menu of ideas, not a contract. Reorder/drop freely.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **July 18, 2026** (v1.9.0)

## Where the app stands

**Strong:** live scoreboard + deep Game Center (play-by-play, scrubbable win-probability, live situation, full box scores), personalized home feed (team card, followed players with form sparklines, standings snapshot, dual daily report cards, standout carousel, On Fire / Ice Cold), predictions game with vote bars, confidence-ranked leaderboard and running record, bot rivals, installable PWA with daily pick-reminder push, all-time leaderboards, rosters, recent-search UX, dark mode, responsive, exact back-button restoration.

**Shipped since the last roadmap revision (v1.4 → v1.9 + in flight):**
- ✅ Live Game Center — built, then deepened (win-prob scrubbing, between-innings states, due-up stats, 9-inning line score)
- ✅ PWA + push foundation — installable, Settings toggle, daily "make your picks" reminder Action (`docs/PUSH_NOTIFICATIONS.md`)
- ✅ Pick consensus — live vote bars with percentages on the home predictor
- 🟡 Predictions 2.0 — confidence-ranked (Wilson) leaderboard + running record shipped; badges/weekly boards/smart bot still open
- 🟡 Player streak report cards (🔥 hitting / 🧊 scoreless / 🥶 hitless) — built, uncommitted; needs precompute (see infra)

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
| **August** | Races tighten | Playoff odds, Streak Survivor launch |
| **September** | Magic numbers, milestones | Milestone Watch, bracket-challenge build |
| **October** | Postseason | Bracket Challenge, Season Wrapped |
| **November +** | Offseason | Offseason mode, trivia/history (evergreen) |

---

## Phase 1 — Ride the season (now → September)

- **Land the streak boards + first nightly precompute** ⚙️ — Commit the streak report cards, then move `fetchStreakLeaders` into the existing Actions pipeline (nightly job → Supabase table, client reads one row). This is the template every later precompute (spotlight, odds, trivia, grid puzzles) reuses.
- **Trade Deadline HQ** 🔬🎯 — StatsAPI `/transactions` → a Roster Moves strip on home, badges on followed players who move, and a deadline-day live view. Timely for ~2 weeks; the feed stays useful all year (injuries, call-ups, DFAs).
- **Predictions 2.0, finish** 🎮 — Streak badges + heater banner, weekly/monthly leaderboard cuts, and one smart rival (Elo or Pythag bot) in `run-bots.mjs` so the top of the board is beatable-but-hard.
- **Push alerts beyond the daily reminder** ⚙️🎯 — "Your team is up 2–1 in the 8th" close-game alerts, game-start nudges, followed-player milestone pings. Reuses the shipped plumbing; multiplies every other feature.
- **Playoff odds** 🔬🎯 — Nightly Monte Carlo of the remaining schedule in an Action → Supabase; odds on team cards + a race page with magic numbers in September. August is when everyone starts checking.
- **Milestone Watch** 🎯🔬 — Countdown cards for players approaching round numbers and records; feeds the push-alert system.

## Phase 2 — Daily games (no friends required)

Solo-first games sharing auth + leaderboards + streak infra. Bots play these too — beat-the-bot is the multiplayer.

- **Streak Survivor** 🎮 — Pick one hitter a day to get a hit; a miss resets. Season leaderboard, bot entrants. Simple, sticky, and pairs perfectly with the new hitting-streak boards.
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

- **Precompute nightly, serve from Supabase** ⚙️ — Streak leaders first (in flight), then report cards, spotlight, odds, trivia, grid puzzles. Client reads one row instead of fanning out to StatsAPI.
- **Server-side leaderboard ranking** ⚙️ — Move the Wilson-score ranking from `PredictionStats.tsx` into a SQL RPC (top N + current user's row) before the table gets big.
- **Payroll source resilience** ⚙️ — Fallback for FanGraphs 403s (Spotrac/Cot's) so payroll boards don't silently go stale.
- **Prod error visibility** ⚙️ — No way to know today whether visitors hit errors. Even a tiny Supabase `client_errors` table fed by a `window.onerror` hook would answer "is anything broken?"

---

**Suggested next three:** land streaks + nightly precompute → Trade Deadline HQ (timely) → Predictions 2.0 finish + close-game push alerts.
