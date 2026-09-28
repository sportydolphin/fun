# MLB App Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Scope: the **MLB section** (`/mlb`) only. The WPBL section has its own plan and its own
> calendar: see **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)**. (The two lived in this file until
> Aug 16, 2026; the WPBL section had outgrown being an appendix.)
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Sep 27, 2026**, around bringing the section up to the WPBL standard (see
> "Aligning with WPBL" below, which is now the live front). Before that Aug 10, 2026.
>
> *Status note, Aug 22, 2026, now history: the section was dormant on purpose while the WPBL
> season ran. Over the 14 days to Aug 19, `/mlb` drew 768 events across 33 browsers against
> `/wpbl`'s 18,213 across 2,036. The WPBL season is over, which is what reopens this file.*

## Aligning with WPBL (Sep 27, 2026) 🎯⚙️

MLB was built first; WPBL was built second, under a season clock, and came out ahead on the
phone, on navigation, on URLs and on load cost. The aim is to bring `/mlb` up to what WPBL
learned **without losing what MLB still does better** (listed at the end of this section).
Audited against the code and a 375px walk of both sections on Sep 27.

**The clock.** The MLB postseason starts Sep 29 (Wild Card) and runs to Oct 31; the offseason
starts Nov 1. October is the only MLB traffic window until spring, so what makes October work
goes first and the rest is winter work.

### What the audit found

| Area | `/mlb` | WPBL pattern to copy |
|---|---|---|
| Phone nav | 6 pills in a sideways scroller; at 375px Stats and Search are off screen, no swipe, and the player page lights no tab | Bottom bar + More sheet, swipe pager, visited tabs kept mounted |
| Overlays | 10 hand-rolled `position: fixed` boxes: centred, 26px close, `backdropFilter` blur (the cost WPBL removed), not portalled | `ModalShell`: portalled, a bottom sheet on a phone with drag to dismiss |
| Back | Back with Game Center open leaves the section entirely (lands on `/wpbl`), because no MLB modal is a history entry | Every modal is a history entry; Back closes it |
| URLs, SEO | One URL, `/mlb?view=&pid=`, so one title and nothing indexable; 8 `href`s against 201 `onClick`s (the scoreboard's "Box →" is a plain div); no `<h1>` | A path per tab, player, game and team; `linkTo()`; `PageHeading` |
| Requests | **107 on Home mount**, 60 of them per-team stats (`fetchTeamRankings`, 30 clubs x 2 groups) that `/teams/stats?sportIds=1` answers in 2 | 24 on Home |
| Loading | No skeletons, "Loading…" text; all six views ship in one chunk | Skeletons, lazy modals, last-good seeds |
| Stats on a phone | A wide spreadsheet in a nested scroller (`maxHeight: calc(100vh - 280px)`); sorted by OPS with the OPS column off screen | Ranked list with a sort sheet |
| Desktop | Still under `zoom: 1.4`. All 553 MLB font sizes are already rem, so the type half of the ramp is free | `--app-type` / `--app-chrome`, `chromePx()` |
| Measurement | 3 events | 71 |
| Tests | 0 | 119 |
| House rules | 525 em dashes in 62 files; a Yankees example in `HomeView.tsx`; BOM and mojibake in `MlbStats.tsx` | |
| Polling | ✅ *Fixed in v1.99.2*: `useForegroundInterval` moved to `src/lib` and every MLB poll uses it | |

### The plan, in order

0. ✅ **Survive the postseason** (Sep 28, `src/mlb/gameStatus.ts`). Every schedule read filtered
   on `gameType=R`, so from Sep 29 the predictor, the game-start bell and push, the pick
   reminder, the team schedule strip, the live-team check, the bots, Survivor and the prediction
   resolvers would all have seen no games for a month. Schedule reads now take `R,F,D,L,W`;
   season totals (streaks, leaderboards, playoff odds, report cards) stay `R`, and
   `__tests__/gameStatus.test.ts` fails on any new schedule read that filters to `R` without a
   listed reason. Four postseason shapes came with it:
   - **Cancelled is not final.** Sep 27's BAL@NYY (rain, `codedGameState` "C") rendered as
     "FINAL 0–0"; only a postponement was recognised.
   - **Stand-in clubs** ("HOU/CWS", id 5528) are shown but cannot be picked, by people or bots,
     since a pick against the stand-in's id can never resolve.
   - **Placeholder start times** (`startTimeTBD`, published as 07:33Z) print "TBD" and are never
     counted down to or pushed against.
   - **"If necessary" games** say so on the pick card (`Gm 3 if nec.`). Survivor grades
     postseason at-bats, since a bare gameLog is regular season only.

   Not changed, and why: Spotlight and the On Fire / Ice Cold cards stay regular season, because
   `stats=byDateRange` returns nothing for a postseason date. Postseason standouts need box
   scores. Also fixed on the way: the pick board's title named today's date over tomorrow's
   slate every evening.
1. **Instrument** (this week). Tab viewed, player opened, and an impression per Home card.
   "Keep what MLB does better" is a guess until October says what gets used.
2. **Lift the section-agnostic WPBL pieces into shared code**: `BottomNav` (accent as a prop),
   `SwipeableViews`, `ModalShell` and its scroll lock, `chromePx`. A pure move with the WPBL
   tests unchanged, since `src/wpbl` must stay free of MLB coupling and MLB must not import it.
3. **Phone shell** (October). Five tabs, Home · Scores · Standings · Stats · Teams, plus More.
   Leaderboard and Visualize become boards inside Stats, Search lives only in the toolbar, and
   More holds Predictions, Survivor, Milestones, Roster Moves, Odds and Payroll.
4. **Overlays and URLs** (October). All ten overlays onto `ModalShell` sheets, each a history
   entry. Paths `/mlb/standings`, `/mlb/players/<name>-<id>` (the id always, since MLB has real
   namesakes), `/mlb/games/<pk>`, `/mlb/teams/<abbr>`, each with its `_redirects` lines,
   `seo.ts` entry and routes test; old `?view=` links 301 at the edge, and the notification
   URLs in `shared/notifications.js` (`/mlb?view=home&open=predictor`) keep working. The
   969-line `useMlbState` becomes route-driven.
5. **Load cost.** The bulk team-stats call (60 requests to 2), lazy Game Center and player
   page, skeletons, last-good seeds.
6. **Offseason shape, by Nov 1.** Six daily MLB crons run all winter (only game-start is gated
   by month); give them a due-gate like `wpbl_ingest_due()`. The predictor's empty
   "TOMORROW / No upcoming games" card needs an offseason state.
7. **Winter.** MLB off the zoom onto the desktop ramp (then `DESKTOP_ZOOM`, `--app-shell` and
   the compensation sites go); Stats as a phone ranked list; real `<a href>`s and headings; the
   em-dash sweep; the first MLB tests.

### What MLB does better, and keeps

- **Follow a team and players**, synced to `user_preferences` across devices, with Home built
  around it. WPBL's favourite team is still parked.
- **Recent searches synced across devices**, and toolbar suggestions (Recent, Your Team,
  Trending). WPBL's recents are localStorage only.
- **Stat card to leaderboard with the player highlighted** (`handleStatCardClick`): the next
  step after WPBL's `?sort=`, and worth porting back.
- Per-stat leaderboard cards, the scoreboard's date stepper and fullscreen, the rolling trend
  chart with a league-average line, the Live Drama ticker, `InfoTip` explainers.
- The predictions engine (bots, Wilson-ranked board) and the MLB-only content: Milestones,
  Roster Moves, contracts, payroll.
- **Back restores the exact screen you left** (self-describing history snapshots). WPBL does
  the same thing another way; keep the behaviour, the implementation can change.

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
