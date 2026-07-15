# MLB App Roadmap

> Living document — a menu of ideas, not a contract. Reorder/drop freely.
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra

## Where the app stands (July 2026)

**Strong:** home dashboard (live scores, box scores, Spotlight, Peak Form, Report Cards), My Stuff personalization, predictions game with bot rivals, deep player/team pages, dark mode, responsive.

**Gaps driving this roadmap:**
1. Weak daily retention loop — predictions game has no reminders, no friends, only bots + global leaderboard.
2. Live games are shallow — the StatsAPI v1.1 live feed (play-by-play, baserunners, win probability) is untapped.
3. Very "today"-centric — app goes dark in the offseason; no historical content.
4. Numbers-only for casual fans — no narrative layer or stat explainers.
5. Infra ceiling — everything is client-side StatsAPI fetches; no push notifications; heavy aggregates recomputed per visitor.

---

## Phase 1 — Complete the daily loop (this season)

- **Live Game Center** 🔬🎯 — Tap a live/final game → play-by-play, diamond with baserunners, count/outs, batter vs pitcher matchup, scoring-play timeline, win-probability chart. APIs: `/api/v1.1/game/{gamePk}/feed/live` + `/api/v1/game/{gamePk}/winProbability`. ✅ **BUILT July 2026** (`src/mlb/views/LiveGameCenter.tsx`)
- **Predictions 2.0** 🎮 — Confidence points, weekly/monthly leaderboards, streak badges, heater banner. Add a smart rival (Elo Bot / Pythag Bot) in `run-bots.mjs`.
- **Daily Trivia** 🎮🎯 — One auto-generated question/day from StatsAPI history, Wordle-style streaks, shared leaderboard infra.
- **PWA + push notifications** ⚙️ — Service worker, installable; "picks lock soon," "your team up 2–1 in the 8th," milestone alerts. Multiplies everything else. 🟡 **FOUNDATION BUILT July 2026** — installable PWA (manifest + SW), Web Push subscribe/unsubscribe (Settings → Notifications), and a daily "make your picks" reminder via GitHub Action (`scripts/send-reminders.mjs` + `daily-reminders.yml`). Setup + remaining infra steps in `docs/PUSH_NOTIFICATIONS.md`. Next alert types (team game starting, live score/milestone) reuse this plumbing.
- **Stat explainers** 🎯 — Tap any stat abbreviation → plain-English tooltip. One shared component, app-wide.

## Phase 2 — Social layer

- **Friend leagues** 🎮 — Private prediction groups with invite links (Supabase + RLS). The retention feature.
- **Pick reveals & consensus** 🎮🎯 — Post-lock: "78% picked the Dodgers," highlight contrarian picks.
- **Achievements** 🎮 — Badges for prediction feats, exploration, loyalty. Profile card display.
- **Game-thread reactions** 🎯 — Lightweight emoji reactions on live games. Presence, not chat.

## Phase 3 — Serious fan depth

- **Splits & situational stats** 🔬 — vs LHP/RHP, home/away, last 15/30, RISP (`stats=statSplits&sitCodes=...`). Player-page tab.
- **Player comparison tool** 🔬 — 2–3 players side-by-side + radar chart. Mostly assembly from charts.tsx + stat defs.
- **Playoff odds** 🔬🎯 — Nightly Monte Carlo of remaining schedule in a GitHub Action → Supabase. Team cards + odds page.
- **Statcast layer** 🔬 — Baseball Savant public endpoints (verify access rules). Exit velo, barrels, xwOBA; "Luckiest Hitters" report card (xwOBA−wOBA).
- **Transactions & injuries feed** 🔬 — StatsAPI `/transactions` → Roster Moves strip; injury badges on followed players.
- **Milestone Watch** 🎯🔬 — Countdown cards for players near 500 HR / 3000 K / records. Push-notification fodder.
- **Farm report** 🔬 — MiLB via sportId 11–16. Follow prospects; team's top farmhands and AAA lines.

## Phase 4 — Out-of-the-box games

Each is a standalone daily game sharing auth + leaderboard + streak infra:

- **The Grid** 🎮 — Immaculate-Grid-style 3×3 team/stat intersections; puzzles precomputed in Actions.
- **Mystery Player** 🎮 — Guess from progressive clues (team → position → stat line → silhouette). Shareable result grid.
- **Streak Survivor** 🎮 — Pick one hitter/day to get a hit; a miss resets. Season leaderboard.
- **Weekly Three (fantasy-lite)** 🎮🎯 — Monday: pick 3 hitters + 1 pitcher under a star budget; real stats score all week.
- **Card collection** 🎮 — Predictions/games earn player cards (rarity tiers), collection book. Makes every other game more rewarding.
- **October Bracket Challenge** 🎮 — Postseason bracket, points by round. Reuses predictions infra.
- **Derby bracket** 🎮 — All-Star week HR Derby pick'em (`homeRunDerby` endpoint).

## Phase 5 — All-season & long-term

- **Season Wrapped** 🎯🎮 — October recap: team arc, followed players' best games, your prediction record. Shareable cards.
- **Offseason mode** ⚙️🎯 — Calendar-aware home: free-agency tracker + signing predictions, awards ballots, Opening Day countdown.
- **This Day in Baseball / History Explorer** 🎯 — StatsAPI goes back a century. Daily card; franchise pages; all-time leaderboards.
- **Narrative recaps** 🎯 — Template- or LLM-generated one-paragraph game stories (nightly Action).
- **Second sport** — Launcher architecture supports it; NFL pick'em would reuse ~80% of predictions/social infra.

## Infrastructure thread (under everything)

- **Precompute nightly, serve from Supabase** ⚙️ — Report cards, spotlight, odds, trivia, grid puzzles via the existing Actions pipeline → tables; client reads one row.
- **Payroll source resilience** ⚙️ — Fallback for FanGraphs 403s (Spotrac/Cot's) so payroll boards don't silently go stale.
- **PWA plumbing** ⚙️ — Gateway to notifications, offline scores, installs.
- **Leaderboard ranking done server-side** ⚙️ — Predictions leaderboard (v1.6.0) now fetches up to 500 `prediction_stats` rows and computes the Wilson-score ranking client-side. Fine at current scale, but as the user base grows this should move into SQL/an RPC (compute the Wilson bound and rank in the query, return only top N + the current user's row) so the client isn't pulling the whole table. See `fetchLeaderboard` in `src/mlb/views/PredictionStats.tsx`.

---

**Suggested next three:** Live Game Center → friend leagues + Predictions 2.0 → Mystery Player.
