# MLB App Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Scope: the **MLB section** (`/mlb`) only. The WPBL section has its own plan and its own
> calendar: see **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)**. (The two lived in this file until
> Aug 16, 2026; the WPBL section had outgrown being an appendix.)
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Sep 27, 2026**, around bringing the section up to the WPBL standard (see
> "Aligning with WPBL" below, which is now the live front). Before that Aug 10, 2026.
> Last reviewed for handoff: **Oct 2, 2026**, at v1.115.1. Start at "Handoff" just below.
>
> *Status note, Aug 22, 2026, now history: the section was dormant on purpose while the WPBL
> season ran. Over the 14 days to Aug 19, `/mlb` drew 768 events across 33 browsers against
> `/wpbl`'s 18,213 across 2,036. The WPBL season is over, which is what reopens this file.*

## Handoff: where MLB stands (Oct 2, 2026)

**State.** Items 0 to 6 of the plan below are done, and 7 is half done. The section now has
WPBL's phone shell, history-backed sheets, a real path for every tab, club, player and game, a
postseason bracket, an offseason-aware Home, the desktop scale with no `zoom`, and a chunk per
view. The postseason runs to Oct 31, and the offseason shape
switches itself on from the league's own calendar on Nov 1 (`seasonPhase.ts`,
`shared/mlbSeason.js`): nothing needs doing on that date.

**Next, in order** (why, in each item below):

1. **Stats as a ranked list on a phone** (item 7). The Table board is still a wide spreadsheet in
   a nested scroller at 375px, sorted by OPS with the OPS column off screen. WPBL's
   `StatsView.tsx` is the pattern: a ranked list with a sort sheet.
2. **Real `<a href>`s and an `<h1>` per page** (item 7). The paths exist, but about 200
   `onClick`s against a handful of `href`s means Google can reach few of them. Use `linkTo()` /
   `linkPress` and WPBL's `PageHeading`. The scoreboard's "Box →" is the clearest case.
3. **Home's own weight** (item 5). A Home landing costs 132 kB gzip of MLB code against 67 to 82 kB
   for any other page, because the Predictor, Live Game Center and the report cards load with it
   rather than on use.
4. **Let the address drive `useMlbState`** (item 4's open note). It reads the address but is not
   driven by it.
5. **Swipe pager with kept-alive tabs** (item 3's open note). Views unmount and refetch on every
   tab change.
6. **House rules sweep** (item 7). About 500 em dashes in 62 MLB files (the ones meaning "no
   value" stay), and the BOM plus mojibake in `MlbStats.tsx` (`â†’` in a comment). The Yankees
   examples were removed Oct 2.

**Before deciding what moves into More**, read "MLB: what gets used" on `/admin` (item 1) once
October is over; it is the first real measurement of which Home cards are used.

**Tests**: 9 files and 89 cases under `src/mlb/__tests__/`, against 126 files in WPBL. Each item
above should leave a test behind, as items 0, 4 and 5b did.

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
| Phone nav | ✅ *Fixed Sep 28 (item 3).* Was 6 pills in a sideways scroller; at 375px Stats and Search are off screen, no swipe, and the player page lights no tab | Bottom bar + More sheet, swipe pager, visited tabs kept mounted |
| Overlays | ✅ *Fixed Sep 28 to 30 (item 4).* Were 10 hand-rolled `position: fixed` boxes: centred, 26px close, `backdropFilter` blur (the cost WPBL removed), not portalled | `ModalShell`: portalled, a bottom sheet on a phone with drag to dismiss |
| Back | ✅ *Fixed Sep 28 (item 4).* Back with Game Center open leaves the section entirely (lands on `/wpbl`), because no MLB modal is a history entry | Every modal is a history entry; Back closes it |
| URLs, SEO | 🟡 *Paths done Oct 2 (item 4); hrefs and headings open (item 7).* Was one URL, `/mlb?view=&pid=`, so one title and nothing indexable; 8 `href`s against 201 `onClick`s (the scoreboard's "Box →" is a plain div); no `<h1>` | A path per tab, player, game and team; `linkTo()`; `PageHeading` |
| Requests | ✅ *Fixed Sep 28 (item 5).* Was **107 on Home mount**, 60 of them per-team stats (`fetchTeamRankings`, 30 clubs x 2 groups) that `/teams/stats?sportIds=1` answers in 2 | 24 on Home |
| Loading | ✅ *Chunk per view in v1.115.1; skeletons on Scores, Standings, the bracket and the predictor (item 5).* Was no skeletons, "Loading…" text, all views in one chunk | Skeletons, lazy modals, last-good seeds |
| Stats on a phone | Open (item 7). A wide spreadsheet in a nested scroller (`maxHeight: calc(100vh - 280px)`); sorted by OPS with the OPS column off screen | Ranked list with a sort sheet |
| Desktop | ✅ *Fixed in v1.115.0*: off `zoom: 1.4`, onto the same 1.25 ramp as WPBL | `--app-type` / `--app-chrome`, `chromePx()` |
| Measurement | ✅ *5 `mlb_*` events since Sep 28 (item 1).* Was 3 events | 71 |
| Tests | 9 files, 89 cases (was 0) | 126 files |
| House rules | Open (item 7). 525 em dashes in 62 files; ~~a Yankees example in `HomeView.tsx`~~ (removed Oct 2); BOM and mojibake in `MlbStats.tsx` | |
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
1. ✅ **Instrument** (Sep 28). Five `mlb_*` events: each Home card as seen (scrolled into view)
   and used (first click inside), tab changes with how they happened, and player and team opens
   with where from. Read on /admin under "MLB: what gets used" (`admin_mlb_usage`). "Keep what
   MLB does better" is a guess until October says what gets used, so read it before phase 3
   decides what moves into More.
2. ✅ **Lift the section-agnostic WPBL pieces into shared code** (Sep 28). `src/ui/` now holds
   `BottomNav` (accent and labels as props), `SwipeableViews`, `ModalShell` with its scroll lock
   and drag-to-dismiss, and the tap helpers (`pressable`, `hoverOnly`, `linkPress`, `FOCUS_RING`).
   WPBL's old paths re-export them, so no WPBL call site changed and its tests passed untouched.
   `chromePx` stays in WPBL until MLB takes the desktop ramp (7).
3. ✅ **Phone shell** (Sep 28). Five tabs, Home · Scores · Standings · Stats · Teams, plus More:
   WPBL's floating bottom bar and More sheet on a phone, pills and a More menu above that.
   Leaderboard, Stats and Visualize are the Leaders / Table / Charts boards of one Stats tab, and
   stay separate views underneath so every old `?view=` link lands. Scores is the full grid with
   date navigation (and now refreshes live, which the Home strip never did); Teams lists all 30
   by division as real links. More opens Predictions, Survivor, Milestones, Roster moves, Odds and
   Charts & payroll through deep links their owners already listen for. Not done: the swipe pager.
   MLB's views unmount on a tab change and refetch, so keeping them mounted side by side is a
   separate job from the bar.
4. 🟡 **Overlays and URLs.** *Done Sep 28:* Game Center and the game preview are `ModalShell`
   sheets (drag down to close on a phone) and history entries, so Back closes them instead of
   leaving the section (`state/sheetHistory.ts`, pinned in `__tests__/sheetHistory.test.tsx`). A
   link out of a sheet replaces its entry, so Back from that player lands where the sheet opened.
   *Done Sep 30 (v1.108.0):* the other eight overlays (scoreboard, predictions and their stats,
   milestones, roster moves, survivor, schedule, leaderboard fullscreen) open in `MlbSheet`, the
   same history-backed `ModalShell`; the trends chart and the player card's fullscreen take a
   `FullscreenEntry` so Back leaves fullscreen rather than the page. `ModalShell` now gives Escape
   to the newest shell only, since two stacked sheets each called `history.back()` on one key.
   *Done Oct 2 (v1.112.0), the real paths* (`src/mlb/routes.ts`): `/mlb/scores`,
   `/mlb/standings`, `/mlb/leaders`, `/mlb/stats`, `/mlb/charts`, `/mlb/teams`, one page per club
   at `/mlb/teams/<nickname>` (`red-sox`, `blue-jays`: what a fan types, where an abbreviation is
   not), and `/mlb/players/<name>-<id>`, which resolves on the id alone since MLB has real
   namesakes. Every tab is a real link, each page has its own title and canonical, the tabs and
   clubs are in the sitemap (players deliberately are not), and `routes.test.ts` pins the
   redirects, sitemap and tags together. `functions/mlb/` 301s every old `?view=` / `?pid=` /
   `?tid=` link onto its path, keeping `open=` so the notification URLs still open their board,
   and answers a real 404 for a player URL naming nobody. Each tap now pushes its DESTINATION's
   address, which also fixes the stale-build reload landing back on the page being left. Found on
   the way: a tab left the player selected behind it, so its history entry (and, under the old
   query, the `pid=` in the address) went on naming the player; a tab now clears the selection.
   *Done Oct 2 (v1.114.0), `/mlb/games/<pk>`.* Game Center and the preview stay sheets; the
   address belongs to the sheet's history entry (`mlbSheetUrl`, `state/sheetHistory.ts`), so it is
   in the bar exactly while the sheet is up and Back takes it away. `views/GameRoute.tsx` opens
   one from an address (cold, the bell, Forward, the old `?open=game`), seating Scores beneath a
   cold landing so Back cannot land on the same address and reopen it. Each game titles itself
   with its clubs, score and date (`state/gameSeo.ts`). The edge 404s a pk that is no game the
   scoreboard shows and 301s the old `open=game` push links; games stay out of the sitemap, as
   players do. The game-start push now opens any game, where the team card used to drop one
   that was not the followed club's. *Open:* `useMlbState` reads the address but is not yet
   driven by it.
   *Done Oct 2 (v1.113.0), Regular / Playoffs / All* on the Leaders and Table boards
   (`lib/gameScope.ts`, `games=` on the address). StatsAPI serves the postseason as `gameType=P`
   and has no combined pool, so All is summed per player with every rate rebuilt from its counts.
   The postseason qualifier is MLB's 3.1 PA / 1 IP per team game counted per club, since the
   regular rule's single bar with its 30 PA floor emptied every board for the first week. Career
   playoffs have no qualified pool in StatsAPI at all, so that board is built from volume with a
   bar of ours (100 PA, 40 IP), and career offers no All.
5. 🟡 **Load cost.** *Done Sep 28:* one `/teams/stats` read per group replaces the 60 per-club
   reads behind a team's league ranks and the Visualize charts. *Done Oct 1, layout shift:* field
   CLS was 0.227 at p75 on phones (Google's "poor" starts at 0.25), measured with headless Chrome
   at 0.35 on a fresh Home load and 0.29 on desktop. The late bracket alone was 0.35; the standout
   carousel added about 0.06 a slide by animating margin-left. Now the bracket and the season
   calendar are seeded from the last read on the device, the scores, bracket, Standings and
   predictions hold their room while loading, the MLB content (and its Suspense fallback) is a
   screen tall so the footer never starts mid-screen, and both carousels move by transform. Every
   tab now measures under 0.1 on a phone and a desktop. *Done Oct 2, INP* (232ms p75 on phones):
   opening a team page from Home re-rendered the whole app about six times, around 15,000
   component renders, because MlbStats republished to the search bridge on every render, the
   bridge notified the app shell, and the shell re-rendered MlbStats through an inline prop. The
   bridge now skips no-op updates and MlbStats reads only the query from it; MlbStats and HomeView
   are memoized on stable props. Measured at 4x CPU on the dev build: team open 440 to 90ms, a
   keystroke in search 144 to about 50ms median (production before). *Done Oct 2 (v1.115.1), lazy views*
   (`views/lazyViews.ts`): every MLB page shipped all eight views, 148 kB gzip of MLB code. Each
   view is now its own chunk, fetched beside MlbStats rather than after it, and the rest are warmed
   4s after landing. A landing now costs 67 to 82 kB, Home 132 kB. *Open:* Home is most of what is
   left (Predictor, Live Game Center, report cards load with it, not on use).
5b. ✅ **A postseason bracket** (Sep 28, `postseason.ts`, `views/PlayoffBracket.tsx`). Not in the
   original plan: MLB had no postseason surface at all, and October is the window. One read of
   `/schedule/postseason/series` gives all eleven series; the series ids fix the shape and every
   seed (checked against 2022 to 2026, pinned against recorded 2025 and 2026 feeds in
   `__tests__/postseason.test.ts`), and a feed of any other shape draws nothing. One round at a
   time, the current one by default, compact on Home and full as Standings' default mode while a
   postseason is on; each series opens game by game, with Game Center or the preview behind each
   game. Draws nothing until the Wild Card field is set. *Dropped Sep 30:* bracket picks. The
   per-game predictor already covers every postseason game, so a second pick'em would split the
   same readers across two boards.
5c. ✅ **Home knows the regular season is over** (Oct 1, `seasonPhase.ts`). Not in the original
   plan either: an audit at 375px found Home still drawing the regular season a week into October
   (a Wild Card race at 0% down the column, On Fire over a window with no games, streaks called
   "active", a followed club eliminated a week earlier leading the page). The phase comes from the
   league's own `/seasons` calendar, plus a check for a makeup still to be played, and fails toward
   the regular season. Past it: a club that is out shrinks to one line under the picks and says how
   its season ended; a club still playing keeps its card with its series line; standouts are built
   from postseason box scores; the race card, On Fire / Ice Cold and the remaining-schedule boards
   step aside; Milestone Watch leads with the season's reached marks and drops season totals that
   can no longer fall. The 30-logo team picker that led a new reader's feed is a one-line prompt
   opening a sheet by division. The dev gear pins either phase, and "No team", for review. The
   offseason (Nov 1) gets the same treatment for free; what it still needs is item 6.
6. ✅ **Offseason shape** (Oct 1). The MLB jobs run only inside the league calendar's window for
   their kind (`scripts/mlb-job-due.mjs`, `shared/mlbSeason.js`, one definition shared with the
   site); the streak and milestone readers take the frozen end-of-season row as final instead of
   recomputing live or hiding. `CURRENT_SEASON` is the latest season that has OPENED, not the
   calendar year, which on Jan 1 would have emptied every MLB stats view until opening day. The
   predictor rolls past an off day to the next slate (a postseason travel day used to read "No
   upcoming games"), and says when matchups are pending or when Opening Day is. Winter Home drops
   the scoreboard, as WPBL's does; Scores opens on the last day with games; the bracket is titled
   with its season once it is over. The dev gear previews Winter.
7. **Winter.** Stats as a phone ranked list; real `<a href>`s and headings; the em-dash sweep.
   *Done Oct 2 (v1.115.0), off the zoom.* `/mlb` renders on the same root ramp as `/wpbl` at the
   same 1.25 (`DESKTOP_SCALE`, one number, since the toolbar rides it), and `DESKTOP_ZOOM`,
   `--app-zoom`, the toolbar's own `--app-shell` zoom and every division by them are gone. Done in
   two steps so the first could be checked rather than eyeballed: the ramp at 1.4 with the zoom
   off, element boxes diffed against production on nine pages at 1440, 1024 and phone width,
   which matched within hairline rounding once three blind spots were closed (`letterSpacing`
   numbers are px, now `typePx()`; px strings on spacing keys; a padding held in a variable);
   then 1.25. The two section columns keep their screen widths (1372 Home, 1792 elsewhere), so
   the content got smaller inside them and more fits. Sheets, menus and tooltips are portaled and
   the zoom never reached them, so on a desktop Game Center's smallest labels drew at about 9.6px;
   they now scale with the page, caps included. Overflow-scanned at Default and Large text at
   1440, 1024 and 390: 39 boxes holding a rank, stat or verdict went to rem, and the Home
   leaderboard rows give the name a floor and let the bar give way, since at 1024 with Large text
   the name had been left 18px. Pre-existing and left: the contract bars' salary labels spill 3px
   into their gap at Large text. MUI's Switch and the native select arrow stay at their fixed
   size, as on WPBL.
   *Done Oct 2 (v1.115.0), the nav row and its controls.* The desktop tab bar sits in WPBL's 720
   column with the pills centred and More pinned right as WPBL's bordered ▾ chip, so a section
   switch moves nothing at the top. `SegControl` takes WPBL's raised chip for its active option:
   the old white-on-#60a5fa fill measured about 2.5:1, under AA in both themes, and its options were
   click-only boxes a keyboard could not reach. Settings on the data (Hitting / Pitching, Regular /
   Playoffs / All, league rank, the bracket's round) moved to WPBL's solid `PillGroup`, now in
   `src/ui`, so a page's navigation and its filters no longer look the same. Kept MLB's way:
   the desktop More menu keeps a one-line hint per item, which WPBL's drops; MLB's items are
   feature names that say nothing alone, and both phone sheets already carry hints.

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

## Where the app stands (as of Aug 10, 2026)

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

*The paragraph below is the Aug 10 suggestion and is superseded by "Handoff" at the top.*

**Suggested next three:** close-game push alerts (reuses the shipped push plumbing + the milestone-alert pattern, as in "up 2–1 in the 8th") → a second Phase 2 daily game (Daily Trivia is the offseason-proof pick) → the September race page + magic numbers (playoff-odds follow-on, timely as divisions tighten). Phase 1 is fully shipped and Predictions 2.0 is now complete (v1.20.0), so the retention loop leans on push alerts and the next daily game.
