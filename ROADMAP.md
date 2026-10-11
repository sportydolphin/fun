# MLB App Roadmap

> Living document: a menu of ideas, not a contract. Reorder/drop freely.
> Scope: the **MLB section** (`/mlb`) only. The WPBL section has its own plan and its own
> calendar: see **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)**. (The two lived in this file until
> Aug 16, 2026; the WPBL section had outgrown being an appendix.)
> Tags: 🎯 casual · 🔬 serious fan · 🎮 fun/game · ⚙️ infra
> Last realigned: **Sep 27, 2026**, around bringing the section up to the WPBL standard (see
> "Aligning with WPBL" below, which is now the live front). Before that Aug 10, 2026.
> Last reviewed for handoff: **Oct 2, 2026**, at v1.115.1. Start at "Handoff" just below.
> Audited **Oct 10, 2026** with the rest of the site: the site-wide ops list (error reporting,
> layout shift, database headroom, Actions, dependencies) is in "The Oct 10, 2026 audit" in
> [ROADMAP-WPBL.md](ROADMAP-WPBL.md), and MLB's own findings are under "Handoff".
>
> *Status note, Aug 22, 2026, now history: the section was dormant on purpose while the WPBL
> season ran. Over the 14 days to Aug 19, `/mlb` drew 768 events across 33 browsers against
> `/wpbl`'s 18,213 across 2,036. The WPBL season is over, which is what reopens this file.*

## Handoff: where MLB stands (Oct 9, 2026)

**State.** The September alignment plan (items 0 to 7) is done, and so is every item in the list
that follows. Open work is the **second alignment pass** below this handoff (Oct 9), plus a
decision after October (the note under item 12). The section now has
WPBL's phone shell, history-backed sheets, a real path for every tab, club, player and game, a
postseason bracket, an offseason-aware Home, the desktop scale with no `zoom`, and a chunk per
view. The postseason runs to Oct 31, and the offseason shape
switches itself on from the league's own calendar on Nov 1 (`seasonPhase.ts`,
`shared/mlbSeason.js`): nothing needs doing on that date.

**Next, in order** (why, in each item below):

1. ✅ **Stats as a ranked list on a phone** (item 7, Oct 2, v1.116.0).
   Under 600px the Table board is a ranked list of one stat (`views/StatsRankedList.tsx`): rank
   with ties, face, a real `<a href>` per player, the ranked number, three supporting numbers,
   ten rows then "Show 50". A Sort sheet picks the stat and a Best / Worst first order; one
   Filters sheet holds season, Regular / Playoffs / All and Qualified. "Full table" brings the
   grid back and is remembered. The board math is `lib/statsBoard.ts`, shared with the grid.
   Pinned in `__tests__/statsBoard.test.ts` and `statsRankedList.test.tsx`.
2. ✅ **Real `<a href>`s and an `<h1>` per page** (item 7, Oct 2, v1.117.0). Every row that opens a player,
   a club or a game is now a link to its path (`lib/links.ts`): Leaders, the Stats grid, Standings
   and the bracket, the odds board, rosters, box scores, Scores' game cards, Home's cards and the
   live card. A table row keeps its whole-width click through `rowClick`, with the link on the
   name; a card holding a club chip does the same. Every page has exactly one `<h1>`
   (`components/PageHeading.tsx`): Scores and Teams draw theirs, the other tabs, player and club
   pages carry a hidden one, and a game sheet takes it over while its address is in the bar.
   Pinned in `__tests__/pageLinks.test.tsx`. Not converted: the Charts SVG marks, Predictor and
   Live drama, the followed-players grid, and club logos inside schedule chips.
3. ✅ **Leaders and Table, one job each** (item 7, Oct 2, v1.118.0). Leaders is the overview, the Table the
   full ranking. Each Leaders card ends in "All N ranked", a real link to the Table at
   `/mlb/stats?sort=<stat>` (`sort=` is on the address now, read on landing and on Back, and left
   off for the default stat), which opens as its own history entry where the old expand icon swapped
   the view in place. Leaders on a phone takes the Table's controls (Hitting / Pitching, a Stats
   pill, a Filters sheet without All-Time), and ranks ties the way the Table does: "T-1", with a
   medal only for a place nobody shares. Pinned in `__tests__/leadersBoard.test.tsx`.
4. ✅ **Readable colour in both themes** (Oct 2, v1.118.0). MLB's colours were picked on dark, so on light
   the section blue, the status colours and team colours as text measured 1.9 to 3.8:1, and the
   team cards' secondary white 2.1:1 on the red clubs. Text now goes through `ACCENT_TEXT`,
   `TONE` (theme-keyed `--mlb-tone-*` in styles.css) or `textTone()` / `useTextTone()` for a
   colour known only at runtime; white sits on `FILL` or the solid accent; `teamPalette` sizes
   its secondary white per club and deepens Baltimore and Philadelphia's card a shade. Raw hexes
   stay for fills, bars and tints. A page-by-page audit (every MLB tab, team, player and game
   page, light and dark, phone and desktop) found nothing under 4.5:1 afterwards. Pinned in
   `__tests__/contrast.test.ts`. WPBL's bottom bar took the same fix in the same release: its
   active tab is `--wpbl-accent-fg`, the "new" dot keeps the solid accent.
5. ✅ **Home's own weight** (item 5, Oct 2, v1.119.0). A Home landing was 130.6 kB gzip of MLB code against
   68 to 82 kB for any other page; it is now 115.7. What came out is what only opens on a tap:
   Game Center was a static import in Live drama and the team schedule strip (FinalGames and
   GameRoute already had it lazy), the Predictor's full board and its stats sheet rode in with
   the small Home widget (`views/PredictorModal.tsx` is the board, split out; both are warmed 4s
   after landing so the first tap is not a fetch), and the followed-players "+ Add" box used
   MUI's InputBase, which brought the form-control stack for one field. What is left is the cards
   Home actually draws (the HomeView chunk, 31 kB, plus the bracket and report-card code); their
   pop-ups (milestones, survivor leaderboard, roster moves) are a few kB together and stay put.
   *Oct 7:* two more tap-only pieces out. The game preview sheet was a static import in the
   scoreboard, the team schedule strip and `GameRoute`, so it rode with Home and with MlbStats on
   every MLB page; it is lazy there now and warmed beside Game Center. And `TeamLogo` lived in the
   Standings page, so Home loaded that whole page's chunk for one component and the bracket card;
   it is `components/TeamLogo.tsx` now.
6. ✅ **Let the address drive `useMlbState`** (item 4's open note, Oct 3, v1.119.2). Landing, Back,
   Forward and the shell's `navigate()` now all go through one reader, `mlbSnapshotFromUrl` in
   `routes.ts` (the inverse of `mlbUrlFor`), and the address wins over the history entry.
   `restoreTarget` reads the entry for only what an address cannot carry: a player page's season
   and card, and the page under a game sheet. It was the other way round, the entry first, with
   each path reading its own part of the query, and none of them read the season: Back onto an
   earlier season's board drew this season and the URL sync rewrote the address to match. Every
   initial value now comes from the landing address in its initializer, so a pitching board no
   longer draws and fetches hitting first. Pinned in `__tests__/addressState.test.ts`.
7. ✅ **Swipe pager with kept-alive tabs** (item 3's open note, Oct 3, v1.120.0). The five tabs sit
   in the shared `SwipeableViews`: swiped between on a phone, each returning to its own scroll,
   and kept mounted once visited on every width (`keepAlive`, new, since the pager rendered the
   active panel alone above 600px). A player or club page draws over the pager, which stays
   mounted beneath it, so Back from a player opened off Home costs no requests where it rebuilt
   Home from nothing; the pager mounts with the first tab shown, so a cold landing on a player
   page does not pay for Home. Two things keep a hidden tab cheap (`lib/panelActive.ts`): its
   `useForegroundInterval` polls stop and pull once on return only if a tick was missed, and its
   heading steps down so the page keeps one h1. The Stats boards' rows are kept for five minutes
   per request, so Leaders to Table and Back onto a board no longer blank and refetch. The
   Standouts carousel and the Charts board's Report card / Graphs swipe take `data-swipe-lock`.
   Each tab has its own error boundary and Suspense, as WPBL's do. Pinned in
   `__tests__/keptAliveTabs.test.tsx`.
8. ✅ **House rules sweep** (item 7, Oct 5). Every em dash in MLB prose is gone (about 390, nearly
   all in comments; the "no value" glyph stays), along with the BOM and the `â†’` mojibake in
   `MlbStats.tsx`. The same pass took out what read as generated rather than written:
   filler intensifiers in comments ("simply", "genuinely"), "Chasing history" on Milestone Watch,
   and "these guys" in two board explainers. *Open:* the emoji leading MLB headings and sheet
   titles (Milestone Watch, Roster moves, Predictions, Streak Survivor, On Fire / Ice Cold, the
   live card's "🎉 Run Scored!"), which WPBL never had. *Decided Oct 7:* kept, as MLB's own voice.
9. ✅ **Series pages and short links** (v1.121.0, Oct 5). A postseason series opens a sheet
   (`views/SeriesSheet.tsx`, data in `seriesDetail.ts`) at `/mlb/postseason/<season>/<slot>`, in
   the sitemap once a game in it is final. Series, games and players copy `/m/<code>` short links
   (`functions/m`), WPBL's `/p` and `/g` for this section.
10. ✅ **Game Center aligned with WPBL** (v1.122.0, Oct 5). Wider from `lg`, line score as the
   header, Summary / Box Score / Plays tabs. Summary: series band, WPBL's win probability chart
   (team territories from `chartPairColors`, scrub via the shared `src/ui/chartScrub.ts`), top
   performers, biggest swings, game info (`views/GameSummary.tsx`). Plays fold by half-inning with
   a remembered Expand all. One type ramp (`views/gameType.ts`). *Open:* opening a player from a
   game closes it, so Back lands on Scores rather than the game. Item 11 closes this.
11. ✅ **Side panel and full-page Game Center** (done Oct 7, see the last note; WPBL's half built Oct 5, see #9 in
   [ROADMAP-WPBL.md](ROADMAP-WPBL.md) for the reasoning and the research behind it). On a desktop:
   a player opens as a nonmodal side panel showing the phone layout, swapped in place as the reader
   clicks down a list; Game Center opens as the same panel, with a player from it drawn over it
   behind a "‹ Game" back control; and Game Center gets a full page with no tabs, reached from a
   cold or shared game link and from the panel's Expand. MLB's player is a full page today (the
   view `search`): it becomes the panel's Expand target rather than going away. The shell pieces
   are shared already (`ModalShell`'s `panel`, `openKey` and `onBack`, `usePhoneLayout`,
   `ExpandButton`, all in `src/ui`). What MLB needs is its own wiring: through `useSheetHistory`,
   since a swap must REPLACE the entry or Back walks every row looked at; a pass of `src/mlb/views`
   replacing raw width queries with `usePhoneLayout()`, which inside the panel would otherwise see
   a desktop and draw the desktop layout into 525px; and a `layout="page"` arrangement for
   `LiveGameCenter.tsx`.
   *Progress, Oct 6:* ✅ **Game Center and the preview are the side panel.** A game clicked on the
   page while one is open swaps it (`useSheetHistory`'s `panel`: the new sheet takes the old one's
   entry and depth), from the same list or another opener on the page; a navigation from the page
   (`pushEntry`, which the tabs, search and the player links now all go through) closes it and
   takes its entry. Game Center is keyed by game, so a swap is a remount rather than the old box
   score under the new header. Pinned in `__tests__/sheetHistory.test.tsx`. *Next:* the player as
   the panel, then the full pages. Until then a player opened from the panel is still the page.
   *Oct 6:* ✅ **The player page rebuilt on WPBL's card** (item 12), which takes the big part of
   this away: the player is now a self-fetching component (`views/MlbPlayerDetail.tsx`) with WPBL's
   prop shape, so the panel is wiring rather than a rewrite.
   *Oct 7:* ✅ **the player as the panel, and the full Game Center page.** On a desktop a player
   clicked anywhere on the page opens beside it (`views/MlbPlayerPanel.tsx`, opened through
   `state/playerPanel.ts`); another row swaps it in place on one history entry. A player from inside
   the Game Center panel stacks over it with "‹ Game" (`stackNextPanel` in sheetHistory, the one-shot
   that tells a trip from a card from a row on the page), and so does a game from the player's log.
   The panel's Expand is the player's page; a rank opens the board with the player picked out. The
   search bar still goes to the page, at every width. Game Center has a full page
   (`GameCenterPage`, no tabs: summary and plays on the left, both box scores on the right from
   `lg`, one column below, a pinned bar with the score and jump links), drawn by GameRoute for a game
   ARRIVED AT on a desktop and for the panel's Expand, which replaces the panel's entry and keeps the
   board (`state/gamePage.ts`: the entry carries `mlbGamePage`, kept through every restamp). A player
   from the page opens as the panel beside it. An unplayed game stays the preview sheet. Phones are
   unchanged. Pinned in `__tests__/sheetHistory.test.tsx` and `gamePage.test.ts`.
   *Left:* `src/mlb/views` has no raw width query inside the panel (the only ones are MlbStats', on
   the page), so the planned `usePhoneLayout()` pass came to nothing beyond the card's own `wide`.
   Same day: the page is drawn before its data (the scoreboard from the summary, the cards at their
   loaded height, measured within a pixel at 1440 and 960 with `?devSlow`), the series band's room
   is held while the bracket loads, and the page and panel were swept for overflow at 1440, 1024 and
   960 at both text sizes. A rank on the panel now pushes the board OVER the panel's entry and Back
   reopens the panel (`usePlayerPanelRestore`), which also brings a player back as the panel rather
   than the page at the bottom of a player, game, player stack. Between a phone and a desktop Game
   Center is held at full height (`dialogFill` on ModalShell, MLB only; WPBL's dialogs still grow).
12. ✅ **Player page rebuilt** (Oct 6). The customizable share card (four auto-picked stats, palette
   shuffle, PNG export) is gone; the page is WPBL's card, its parts shared in
   `src/ui/playerCard.tsx`: the club band (bio, draft, MLB awards as ribbons, last-five form strip),
   the full season line with league ranks (top ten lit; a rank opens the Stats table on that stat
   with the player picked out, which `handleStatCardClick` already did from the old card),
   Regular / Playoffs / Both, the game log (rows open Game Center), Advanced (WAR, wRC+, wOBA,
   x-stats, K% / BB% / Whiff%; FIP, xFIP, ERA- for pitchers), splits (vs LHP / RHP, home / away,
   RISP), the pitch mix, a career table whose years open that season, the trend chart (kept),
   fielding, the contract and links out. Two-way seasons get WPBL's role
   tabs on a phone and stacked roles on a desktop; cameos are one line. A traded season now reads
   its season total rather than the club with the most games. Data in `playerProfile.ts`, pinned in
   `__tests__/playerProfile.test.ts`; `useMlbState` lost its seventy player props for
   `playerSeason`. Back on a cold landing goes to the tab the page lights rather than off the site.
   *Oct 7:* a year menu on the season line with **Career** as its first choice (career totals,
   the year-by-year and the per-year trend; restored by Back through the entry's `statsView`); the
   top of the card in the order other stat sites use (headline AVG / HR / RBI / OPS or W-L, SV or
   HLD / ERA / SO / WHIP, then MLB.com's standard line with the rates last, folding into even rows
   on a phone); the header bar in one type style (`src/ui/headerBar.tsx`); the trend chart drawn at
   the card's width on a desktop instead of blown up to it, scrubbed sideways and scrolled
   vertically on a phone (`touch-action: pan-y`, only a tap selects); honours on one row with
   "+N"; club stripes audited (Dodgers white, Angels navy, Brewers yellow, Guardians red). The same
   year menu is on WPBL's card, showing a plain label until a player has a second season.

**Before deciding what moves into More**, read "MLB: what gets used" on `/admin` (item 1) once
October is over; it is the first real measurement of which Home cards are used.

**From the Oct 10 audit** (the site-wide half is in ROADMAP-WPBL.md):

- **Layout shift is worst here.** The field p75 is 0.270 on an MLB desktop and 0.182 on a phone,
  against WPBL's 0.15; Google calls anything over 0.25 poor. The sweep passes because it measures
  the load, so the shifts come after it. The audit's ops item 3 adds attribution; MLB's elements
  are likely the first fixes.
- **A winter Home needs something that changes.** From Nov 1 the bracket and live cards retire,
  and nothing on Home moves until spring training. StatsAPI publishes transactions
  (`/api/v1/transactions`): signings, trades, the 40-man adds in November, the non-tender
  deadline, the Winter Meetings. A "Hot stove" card on Home, filtered to followed clubs when there
  are any, and a full list on its own page, is MLB's answer to the problem WPBL's winter order is
  built around. Pairs with the roster-moves card Home already has.
- **The plays mirror (second pass, item 6, step 4) waits on database headroom.** The database is
  at 254 MB, 62 MB of it the two line tables from one backfilled season; plays and pitches are
  roughly 1M rows more. Ops item 4 clears room first.

**Tests**: 19 files and about 180 cases under `src/mlb/__tests__/` (Oct 9), against 130 files in WPBL. Each item
above should leave a test behind, as items 0, 4 and 5b did.

## The second alignment pass (Oct 9, 2026) 🎯⚙️

The September pass (next section) fixed MLB's plumbing: navigation, sheets, Back, URLs, load cost.
What is left is what a reader sees. MLB still draws with its own building blocks, and a few
features exist in one section only. Audited against the code and both sections at 1440px on Oct 9.

**Timing.** The MLB postseason ends Oct 31 and the offseason Home switches itself on Nov 1, which
retires the bracket and live cards. Do the visual items after that, against the screens readers
will actually see all winter. The functional items do not wait.

**Functional, in order:**

1. ✅ **Share cards for MLB links** (Oct 9). Only `functions/wpbl/` rewrote `og:` tags, so a shared
   MLB player or game link unfurled as the generic site card. A player now unfurls with club,
   season line and the headshot on the club colour; a game with the score, status and series.
   See "Link previews, MLB" in ARCHITECTURE.md.
2. ✅ **Short links for MLB players, games and series** were already there (`/m/<code>`,
   `functions/m/`), and every MLB copy-link button uses them. Listed so nobody builds them twice.
3. ✅ **WPBL's recent searches synced across devices** (Oct 9, v1.131.0), on MLB's footing, in
   their own column `user_preferences.wpbl_recent_searches` (see the log in ROADMAP-WPBL.md).
4. **A glossary and Compare for MLB.** ✅ *Glossary shipped Oct 9 (v1.131.0):* `/mlb/glossary`,
   WPBL's page with MLB's data (`statGlossary.ts`: five rules, terms in three groups, FAQ markup),
   in the sitemap, the footer and the More menu on both widths. Every stat tooltip on the player
   card ends in a link to it, and WPBL's tooltips now link to `/wpbl/glossary` the same way. Its frame and lists are the shared `src/ui/StandalonePage.tsx` and
   `src/ui/Glossary.tsx`, and the qualifying bar it quotes is `qualify.ts`, which replaced four
   literal 3.1s. The board `InfoTip`s describe a board rather than a term, so they carry no link.
   ✅ *Compare shipped Oct 9 (v1.132.0):* `/mlb/compare`, WPBL's page on MLB's player slugs
   (`ComparePage.tsx`, rules in `compare.ts`), on a frame now shared with WPBL's
   (`src/ui/compare.tsx`). Adds what WPBL's feed has no number for: a WAR / wRC+ / FIP block, and a
   head-to-head from StatsAPI's `vsPlayer` (this season, career, postseason). The picker offers the
   season's players by playing time, 60 at a time, with search for the rest. A Compare chip on the
   player card (Follow and Compare drop their words on a phone and in the side panel, where all
   four did not fit), the More menu and the footer. Pinned in `__tests__/compare.test.ts` and the
   edge cases in `routes.test.ts`. ✅ *Follow-ups, Oct 9 (v1.133.0):* any season, as `?season=`,
   which the player card's Compare chip carries from its year menu (the club in each head is the
   one that season was played for); and the pair's skeleton is sized from the two bios, which land
   first and are usually cached, so a pitcher pair reserves a Pitching card and a hitter against a
   pitcher both cards and the duel. Still a guess with no bio in hand: a cold pitcher pair grows
   once, when the bios land rather than when the lines do.
5. ✅ **Every MLB player link opens the side panel on a desktop** (Oct 9). The team page's roster
   and Team Leaders cards pushed the player's full page themselves, the one place in `/mlb` that
   did; they now go through the section's `openPlayer` like every other list.
6. **WPBL's Stats boards on MLB** (scoped Oct 10). WPBL's Stats tab has ten boards and MLB's had
   three. The goal is the same as the rest of this pass: a board gets written once, for both
   leagues. What blocks most of them is data rather than drawing. WPBL's engines run over every
   box-score line and play we store, and MLB has only StatsAPI's season totals.

   | WPBL board | MLB needs | Size |
   |---|---|---|
   | Teams, Fielding | StatsAPI `teams/stats` and `group=fielding` | ✅ done |
   | Draft | StatsAPI `/draft/{year}`; WPBL's engine is 6 rounds over one season, so it needs rethinking for 20 rounds that take years to pay off | M, later (see below) |
   | Bests, Find | every game line, league-wide | L |
   | Pitch by pitch, Run value | every play with base/out state and pitch codes | XL |
   | Tracked | Savant leaderboards, through a Pages Function or a nightly job (CORS); Savant already does this board better | M, maybe never |

   **The fork is where MLB's game lines live.** A season is about 2,430 games, 170k plays and 700k
   pitches, which no browser can fetch. Recommended: mirror finished games into Supabase
   (`mlb_game_lines`, `mlb_plays`) with a nightly `scripts/*.mjs` job reading `feed/live`, the same
   shape as `wpbl-ingest`, so WPBL's engines run unchanged once their inputs are league-neutral
   types. The alternative, a cron job per board writing static JSON, is cheaper but needs a new job
   for every new board, which is what this item exists to stop. Check Supabase storage first:
   plays and pitches are roughly 1M rows a season.

   **In order:**
   1. ✅ *Teams and Fielding (Oct 10).* `/mlb/team-stats` and `/mlb/fielding`, in WPBL's board order
      (Leaders, Players, Teams, Fielding, then Charts). One component, `views/SeasonGridView.tsx`,
      for both, reading its own rows (`fetchAllTeamStats`, new `fetchSeasonFielding`); arithmetic in
      `lib/seasonGrid.ts`. The table frame is now `views/statsTable.tsx`, shared with Players. Fielding
      is one row per player per position, as StatsAPI splits it, with WPBL's columns plus GS, INN and
      RF/9, the catching columns (SB, CS, CS%, PB) on the C chip only, and Rule 9.22(c)'s bar
      (`qualify.ts`). All leaves out the pitchers, who have their own chip: on All they filled the
      top of FPCT with 1.000s on a dozen chances. "Is this a Stats board" is now `isMlbStatsBoard`
      in `routes.ts`, where it was spelled out by hand in the shell, the state and the URL code.
      Pinned in `__tests__/seasonGrid.test.ts`. *Linked through, Oct 10:* everything on both boards
      is on the address (`?lb=`, `?season=`, `?sort=`, and Fielding's `?pos=` and `?team=<slug>`, a
      club filter), held in `useMlbState` so Back restores it; the URL sync now writes the board's
      own history snapshot, so a field added there reaches the address with no second list. A club
      page links "Team batting", "Team pitching" (the club picked out and scrolled to) and
      "Fielding" (its fielders, on innings, bar off); each position in a player card's Fielding
      section links that position's board with the player picked out, turning the bar off if they
      do not clear it. All of these are real `<a href>`s (`openGridBoard`). The glossary gained TC,
      DP, RF/9, CS% and PB. *Then, Oct 10:* a reversed sort is on the address on all three tables,
      Players included, as `?dir=asc|desc`, written only when the column is turned round from its
      natural order. Teams and Fielding take the section's Regular season / Playoffs / Both, shared
      with Players and Leaders (`?games=`): the playoffs are StatsAPI's `gameType=P`, and Both is
      the halves summed per club and per player-position (`combineTeamLines`,
      `combineFieldingSplits`), rates rebuilt from the counts. Fielding's bar uses the club's games
      in the same slice, so a playoff catcher qualifies on half the club's playoff games. A club
      page or player card opens its board on the regular season, which is what both show.
      On a phone the sorted column is frozen beside the name, as Players' is, on the same styles
      (`frozenSx` in `views/statsTable.tsx`, lifted out of Players).
   2. ✅ *League-neutral engines (Oct 10).* The four engines are in `src/league/` (`bests.ts`,
      `finder.ts`, `pitches.ts`, `runExpectancy.ts`), on neutral line and play types
      (`league/types.ts`) whose fields are WPBL's column names, so a WPBL row needs no adapter and
      the MLB mirror's job is to write the same columns. What differs is a `League`:
      `src/wpbl/league.ts` and `src/mlb/league.ts` give the regulation innings, the pitch-code
      alphabet (WPBL's `P` is a ball in play, StatsAPI's a pitchout), the pitch boards' bars and
      `runsOnPlay` (WPBL's feed leaves the batter out of `runs_scored`; the MLB mirror must not).
      Engines are generic over the league's own player and game types, so a row hands back the
      caller's object. The season split moved with them to `league/season.ts`; MLB's playoff
      rounds are single letters the loose pattern cannot match, so the mirror sets
      `counts_in_standings: false` on them, which is definitive and keeps the filter fail-open.
      WPBL's `derive/` files of the same names bind the engines and keep every old export, so no
      caller changed and WPBL's suites are the proof nothing moved. `league/__tests__/leagueNeutral.test.ts`
      runs them at nine innings in MLB's letters. Not in the adapter yet: the ERA basis, which none
      of the four computes; it joins `League` with the first engine that does. MLB's pitch codes are
      unchecked against our own data until step 4, and the unknown count on the coverage line is
      what will show a missing letter.
   3. ✅ *The MLB lines mirror, then Bests and Find on it (Oct 10).* `mlb_games`,
      `mlb_batting_lines`, `mlb_pitching_lines` and `mlb_players`, in the neutral columns, written by
      `scripts/sync-mlb-lines.mjs` (workflow `mlb-lines`, nightly in the `games` window). 2026 is
      backfilled: 2,453 finals, 50,440 batting and 21,041 pitching lines, 8 MB. The browser reads a
      season as one row of the `mlb_season_lines` view, column names beside arrays, about 600 KB
      gzipped and edge-cached, and runs WPBL's engines over it with no further request
      (`seasonLines.ts` is the adapter: ids to strings, a line id from game and player). Boards at
      `/mlb/bests` and `/mlb/find`, between Fielding and Charts, in MLB's own row parts
      (`components/GameLineRow.tsx`). Find's question is on the address (`q`, `team`, `opp`,
      `venue`). **One change the engine needed at this size**: a tie at the cut is two rows in WPBL
      and sixty in MLB (every three-homer game), so `bestGames` takes a `cap` and counts the rows
      past it (`more`, printed as "And 14 more with 3 HR") instead of dropping them; WPBL passes
      none. Seasons before 2026 are not mirrored and say so; adding one is a `--season` backfill.
   4. *Plays and pitches in the mirror,* then Pitch by pitch and Run value. MLB's run-expectancy
      table built from our own plays is a free check against published RE24. *Gated Oct 10* on
      database headroom: see the audit's ops item 4 in ROADMAP-WPBL.md.
   5. *Tracked* last, if at all.

   **Later, not in this pass: Draft.** Deferred Oct 10; nothing in the order above waits on it. It
   needs only StatsAPI's `/draft/{year}`, not the mirror, so it can be picked up at any time.

   Every new board is a route (`routes.ts`, `seo.ts`, `_redirects`, the sitemap, pinned in
   `routes.test.ts`) and a layout-sweep route, so it ships with a `sweep:record --merge` of its reads.
   Thirty clubs against WPBL's four: anything WPBL lays out per club (team chips, a Teams board's
   frozen column) needs a 30-row shape on MLB.

**Visual, after Nov 1, in order:**

1. **Move WPBL's building blocks into `src/ui/`** (`SectionCard`, `SectionLabel`, `TabTitle`,
   `TYPE_SCALE`, `LeaderRow`, `TeamBadge`) and rebuild MLB's cards on them. *Started Oct 9:*
   `SectionCard`, the card surfaces and `TYPE_SCALE` are in `src/ui/card.tsx` (the glossary needed
   them); the rest, and rebuilding MLB's own cards, still waits for Nov 1. MLB has its own
   `SectionLabel`, none of its 565 font sizes go through `TYPE_SCALE` (45 distinct sizes against
   WPBL's 38), its card titles carry emoji ("🔄 Roster Moves") where WPBL's are small-caps labels,
   and its "View All" is a pill where WPBL's "See all ›" is a text link. This one move is most of
   the visual alignment.
   ✅ *Done Oct 9, ahead of Nov 1 (v1.134.0):* `SectionLabel` (the two copies were identical) and
   WPBL's header link, now `CardLink`, are in `src/ui/card.tsx`, and `SectionCard` takes a
   `titleAdornment` for an info tip or a chip beside the title. Every Home card that stays up
   through the winter is on `SectionCard`: the Report Card boards (Home and Charts, `BoardCard` in
   `components/leaderboards.tsx`), Roster Moves, Milestone Watch, Predictions, Streak Survivor, the
   standings snapshot and the follow-a-team prompt. The emoji moved into the card's icon slot, so
   each `h2` is the words alone; the pills, the expand icon and the "View all" footers are
   `CardLink`s, a real link to `/mlb/charts` on Home; and the spinners in the boards and Roster
   Moves are the rows themselves ghosted. Followed players keeps a hand-drawn header, because its
   title gives way to a search field and an edit count, but in `SectionCard`'s type and padding.
   `defaultBorder` now returns `CARD_BORDER`'s values, so the cards not converted draw the same
   outline. The board rows take `TYPE_SCALE`, and `leaderboards.tsx` is the first MLB file on the
   type-scale test's adopted list. Pinned in `__tests__/boardCard.test.tsx`.
   *Kept as they are:* Standouts and On Fire / Ice Cold, whose frames are the club's colour and
   gradient (a hero card, like WPBL's Last game, not a list card); and the scoreboard, bracket
   and live cards, which retire on Nov 1. `TabTitle` goes with item 2, which is what it is for.
   `TeamBadge` and `LeaderRow` stay in WPBL: both read WPBL's own logos, portraits and player
   type, and MLB's `TeamLogo` and `PlayerHeadshot` do the same jobs on StatsAPI's art, so moving
   them would share the box and nothing else.
   ✅ *Type audit of Home, Oct 9 (v1.135.0):* measured in the browser, every text node in every
   Home card had about 25 sizes (0.37rem to 1.5rem, often 0.02rem apart), all six weights from
   400 to 900, and five letter-spacings on caps. Now six `TYPE_SCALE` steps plus `ICON_SIZE`
   (moved to `src/ui/card.tsx`), four weights, and two caps spacings, by role: a name is `body`
   700, a value `body` 800, a secondary line ("LF · NYM", a date, a record) `meta`, a column label
   `caption` caps 700, a status chip `caption` caps 800, an eyebrow `micro` caps 800 at 1px.
   `text.disabled` is for inert marks only (separators, placeholders, ranks); 37 live labels and
   dates drawn in it are `text.secondary` now. Raw hexes on text went to `TONE`. Breakpoint bumps
   on font sizes (`{ xs: 1.05, sm: 1.25 }`) are gone: the root already scales at `md`. All
   fourteen Home files and `src/ui/card.tsx` are on the type-scale test's adopted list. Two layout
   fixes came out of it: the scoreboard chip is `7.75rem` rather than `chromePx(124)`, since it
   reserves room for text, and the standings snapshot's header labels share the rem widths of the
   cells under them. And `SectionCard`'s icon is a 1em box with the emoji centred in it: an emoji font draws
   well inside its advance, so the 10px gap to the title read as 14px. Spacing to match: one gap on Home,
   `HOME_GAP` (1.5, WPBL's), under the title, the scoreboard and the bracket and between cards both
   ways, where it was 2 and 2.5; and the score strip's padding is 0.5, room for the hover lift.
   The gaps above "Playoff series" and the cards read 41px; they are 27 and 29 now, as WPBL's do.
   ✅ *One Home width, Oct 9 (v1.136.0):* MLB Home was 1372px (980 under the old zoom) and WPBL's
   1260, so a section switch moved the cards 56px each side; below `md` the columns were 640 and 720.
   Both read `HOME_W` and `PHONE_COLUMN_W` from `src/ui/layoutWidths.ts` now. MLB's Home is SIZED
   to it and centred with a margin rather than capped, since WPBL's breaks out of the shell's 20px
   padding and a cap stops short of it below about 1300px. Measured edge to edge at 1440, 1100, 960
   and 760: the two match.
   ✅ *Sections kept alive, Oct 9 (v1.137.0):* a section switch tore the section down and rebuilt
   the other from skeletons and fresh reads. App.tsx now keeps each section mounted once visited,
   hidden behind the other, and `SectionActiveContext` (src/lib/panelActive.ts) tells the hidden one
   to stand down: no polling, no address writes, no claim on the toolbar's search or tabs. And the
   bracket's label sits on the Scores header's box (`SCORES_HEADER_H`, `STRIP_PY`), so both
   scoreboards' labels are the same distance above their cards at every width and text size.
   ✅ *The switch keeps the page, Oct 9:* the toolbar's MLB | WPBL switch lands on the same tab in
   the other league (Standings to Standings, any of MLB's three Stats boards to WPBL Stats, WPBL
   Stats to MLB's Table), and the glossary and Compare likewise; a player, game or series goes to
   Home, a club page to Teams (`src/sectionSwitch.ts`). A kept-alive WPBL now reads its tab off an
   address it did not push, where it used to fall back to Home under any WPBL path.
2. **Visible page titles.** Every WPBL page opens with one ("WPBL Standings"); MLB's `<h1>` is
   hidden, so its pages open on a row of pills. *Home done Oct 9 (v1.135.0):* "Major League
   Baseball" in `TAB_TITLE_SX` (moved to `src/ui/card.tsx`), as WPBL's Home draws "Women's Pro
   Baseball League"; the hidden "MLB scores, stats and standings" is gone. ✅ *The other tabs,
   Oct 9:* `MlbTabTitle` (mlb/components/PageHeading.tsx), `TAB_TITLE_SX` under the section's
   heading owner, draws "MLB Standings", "MLB Scores", "MLB Teams" and each Stats board's own
   name ("MLB Stat Leaders", "MLB Player Stats", "MLB Charts"); `TAB_H1` is gone, and Scores and
   Teams lost their two private title sizes. Measured at 1440: 30px, 800, top 81 on every MLB tab
   and on `/wpbl/standings`.
3. **One sub-navigation pattern.** WPBL: a left-aligned row of text tabs over filter chips. MLB: a
   centred pill row, sometimes with a second segmented control on the right. Use WPBL's.
   ✅ *Oct 9:* WPBL Stats' board row is `src/ui/PageTabs.tsx`, and MLB's page-level rows are on
   it: the Stats boards (Leaders / Table / Charts, real links) and Standings' modes (Bracket /
   Divisions / Playoff Picture / Odds), left-aligned where they were a centred `SegControl`. Charts'
   Report Card / Graphs was a second, centred underline row; it is a switch on one address, so it
   is a `PillGroup` at the head of the board's controls. The rule in both sections now: underline
   tabs are pages, `PillGroup` is a switch, chips are filters. Measured at 1000px: the row sits at
   y=136 on every MLB tab and on `/wpbl/stats`. ✅ *The player card's Batting / Pitching, Oct 10:*
   WPBL's way now, a strip pinned under the toolbar (under the shell's top in the panel) with
   WPBL's padding, and the two roles page under a finger (`SwipeableViews`, window mode, since
   MLB's phone player is a page and not a sheet). The card frame is `overflow: clip`, or the
   strip would stick to it instead of the page.
4. **One stats-table look.** WPBL's spans the page with a league-average row and a "+ Qualified"
   chip; MLB's sits in a titled card, pages by 50, and has a "Qual" button. The code can stay two.
   ✅ *Oct 9:* MLB's grid is in WPBL's hairline frame, with no raised paper and no gradient title
   strip; its caption is the footer ("124 hitters · 2026 MLB · Qualified · sort by any column
   heading"). The header is WPBL's small labels with the league average folded in under each rate
   (`leagueLine` in `lib/statsBoard.ts`, summed from the board's own playerPool=All rows, which
   match the 30 clubs' totals exactly; none on a career board). Every row is drawn, in the capped
   scroll box, where "Load 50 more" paged it. The qualifying bar and the regular / playoffs / all
   choice are WPBL's chips (`src/ui/FilterChip.tsx`, moved out of WPBL's StatsView). The phone's
   ranked list is unchanged. Still MLB's own: the medals, the headshots and the sort colours.
5. ✅ **One box score and one play row** inside Game Center (Oct 10). The drawing is
   `src/ui/gameCenter.tsx`, WPBL's, and each section feeds it: `BoxTable` (centred cells, muted
   zeros, the pinned name column, a totals row under the club's colour, fitted on a phone),
   `BoxTeamHeading` and `BoxTeamSwitch` (underline tabs, where MLB had pills), `HalfHeading`
   ("Top 6th · CLE · vs A. Kay", then +N and the score after) and `PlayRow` (the green rail, the
   batter in weight, the runners underneath, the count and the bases and outs the play left at
   the right). `BaseDiamond` and the out lamps moved to `src/ui/BaseDiamond.tsx`. MLB's box takes
   WPBL's columns (HR, 2B and SB added; IP totalled as outs), keeps the season AVG and ERA off a
   phone, and prints "(W)" there. Kept apart: MLB's latest-first order and its Scoring / All
   chips, WPBL's pitch sequences, clips and play links, which StatsAPI has no match for here.
   The sheet's tabs are `SegControl`, centred on their own row, with the Plays controls moved
   under them: the five shared one row and wrapped on a phone. A live game's unplayed home half
   no longer prints the X a finished game does.

6. ✅ **One shape for the Stats tab** (Oct 9). Both open on Leaders, a card per stat, with Players
   (MLB's "Table" until now) beside it, so the board rows read "Leaders, Players, …" in both
   sections. WPBL's Leaders board is new (see its log); the league switch maps WPBL's Players board
   to MLB's and everything else on Stats to Leaders. The rest of each row is the league's own.
   ✅ *One look, Oct 9 (v1.142.0):* both Leaders boards draw `src/ui/leaders.tsx`'s card: five
   rows, ranks as numbers with the top three in the accent and "T-2" for a shared place, no medals,
   a portrait and the club's mark beside the name, "See all ›" in the header, and the hovered player
   lit across every card. MLB's default cards are WPBL's eight in WPBL's order (Walks for Runs, and
   seven on pitching, since FIP is no StatsAPI leader category); the table's default sort moved to
   `TABLE_DEFAULT_SORT` so it no longer rides on that list. MLB's Players grid takes WPBL's row: a
   20px club logo where the 35px headshot was (rows 42px, were 56), centred cells in WPBL's sizes and
   tint, and competition ranks on the sorted column. Kept apart: MLB's season and stat pickers,
   WPBL's Advanced view and club chips. The predictions and Survivor boards keep their medals:
   those are games, not stats.
   ✅ *One page, Oct 9 (v1.143.0):* measured element by element at 375, 760, 960 and 1440, the
   title, board tabs, controls, first card and table of both Stats tabs now share every edge.
   MLB's three boards take WPBL Stats' width (`STATS_W` in `src/ui/layoutWidths.ts`, 1416 against
   1385 at 1440) and its phone gutter (12px, where other tabs keep 16); both sections' phone column
   has WPBL's 4px under the toolbar, which MLB lacked on every tab; the gaps under the tabs and
   controls are WPBL's; the table's height cap is WPBL's. WPBL's Leaders spans the bleed rather than
   capping at 1150. Card titles are title case, MLB's labels word for word. MLB's scope is WPBL's
   chips and words ("Regular season / Playoffs / Both"). MLB's phone list takes WPBL's header (Player,
   the league average), club logos, its "Show all N players" foot (`src/ui/ExpandRow.tsx`) and its
   footer row with the Full table switch inside the frame, and the foot's words are WPBL's ("10 of
   124 players · qualified only · 2026 season"). ✅ *The last measured difference, Oct 10:* WPBL's
   control row is 1164px with its five club chips, so below `lg` it wrapped and the table sat 42px
   under MLB's at 960. Below `lg` the clubs are one `FilterSelect` ("All clubs"), as MLB's season
   is; and MLB's scope chips take WPBL's 6px gap, without which MLB's row overflowed by a pixel at
   760. The table now starts at the same y on both at 760, 960, 1100 and 1440.
   ✅ *One table, Oct 10 (v1.144.0):* the last of what read as two products.
   - Headings: "MLB Stats" on all three boards, as WPBL's "WPBL Stats" (each board keeps its own
     `<title>`). MLB's season picker and Stats picker are chips (`FilterSelect` in
     `src/ui/FilterChip.tsx`); the Leaders "Show all" switch went, the picker's All does the same.
   - The bar pins on every MLB board (`src/mlb/views/StatsBar.tsx`), and the table pins under it.
   - The desktop table stops at 25 rows in both sections (`TABLE_CAP`) with "Show all N players".
   - MLB's columns are WPBL's, in WPBL's (Baseball-Reference's) order: G, PA, R and the TB to IBB
     tail added, K labelled SO, 1B gone. Cells, header and padding are WPBL's; the line under a name
     is the position (SP / RP for pitchers), and portraits wear the club's second colour.
   - MLB has Advanced (`src/mlb/lib/advanced.ts`): WPBL's columns, computed from the season line
     except wOBA and wRC+, which come from StatsAPI's sabermetrics and only for a regular season.
   - Both headers are two rows, the labels and then a pinned "League avg" row
     (`src/ui/statsTableHead.ts`), so every label sits on one line.
   - MLB's phone table is WPBL's: inset, the sorted column frozen beside the name, a tap on a cell
     sorts by it, fitted between the pinned bar and the bottom nav with the site footer stepped
     aside, and vertical scroll handed to the page until the board pins. Both tables lock a drag to
     one axis (`src/ui/useAxisLock.ts`).
   ✅ *Park factors, Oct 10 (v1.146.0):* OPS+ and ERA+ on a season board are park adjusted, by the
     club's run factor from StatsAPI's home and road team splits over three seasons, halved for the
     road half (`fetchParkFactors` in `src/mlb/apiSeasonStats.ts`). Coors reads highest and Seattle
     lowest, and OPS+ now sits beside wRC+ instead of apart from it. The splits endpoint answers 50
     of 60 rows without a `limit`; a year that comes back short is dropped. A traded player takes
     the club StatsAPI files the season under; a career board stays unadjusted.

**Stays different, on purpose:** predictions, Milestones, Roster Moves, Live Drama and follow a
team only make sense with thirty clubs (follow a team was dropped for WPBL's four), and each
league keeps its own colour on the section switch.

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
| URLs, SEO | ✅ *Paths done Oct 2 (item 4), hrefs and headings Oct 2 (item 7), the address driving the state Oct 3.* Was one URL, `/mlb?view=&pid=`, so one title and nothing indexable; 8 `href`s against 201 `onClick`s (the scoreboard's "Box →" is a plain div); no `<h1>` | A path per tab, player, game and team; `linkTo()`; `PageHeading` |
| Requests | ✅ *Fixed Sep 28 (item 5).* Was **107 on Home mount**, 60 of them per-team stats (`fetchTeamRankings`, 30 clubs x 2 groups) that `/teams/stats?sportIds=1` answers in 2 | 24 on Home |
| Loading | ✅ *Chunk per view in v1.115.1; skeletons on Scores, Standings, the bracket and the predictor (item 5).* Was no skeletons, "Loading…" text, all views in one chunk | Skeletons, lazy modals, last-good seeds |
| Stats on a phone | Open (item 7). A wide spreadsheet in a nested scroller (`maxHeight: calc(100vh - 280px)`); sorted by OPS with the OPS column off screen | Ranked list with a sort sheet |
| Desktop | ✅ *Fixed in v1.115.0*: off `zoom: 1.4`, onto the same 1.25 ramp as WPBL | `--app-type` / `--app-chrome`, `chromePx()` |
| Measurement | ✅ *5 `mlb_*` events since Sep 28 (item 1).* Was 3 events | 71 |
| Tests | 16 files, 137 cases (was 0) | 126 files |
| House rules | ✅ *Swept Oct 5 (Handoff item 8).* Was 525 em dashes in 62 files, a Yankees example, a BOM and mojibake in `MlbStats.tsx` | |
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
   Charts & payroll through deep links their owners already listen for. *Done Oct 3 (v1.120.0):*
   the swipe pager, with visited tabs kept mounted (Handoff item 7).
4. ✅ **Overlays and URLs.** *Done Sep 28:* Game Center and the game preview are `ModalShell`
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
   that was not the followed club's. *Done Oct 3 (v1.119.2):* the address drives `useMlbState`
   (Handoff item 6).
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
   4s after landing. A landing now costs 67 to 82 kB, Home 132 kB. Home's leftovers were
   handoff items 5 (Oct 2) and its Oct 7 note.
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
- **Stat card to leaderboard with the player highlighted** (`handleStatCardClick`). *Ported to
  WPBL Oct 7:* a rank on a WPBL player card opens Stats sorted by that stat with the row tinted
  and scrolled to (`WpblStatsFocus.playerId`).
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
- ~~**Prod error visibility**~~ ⚙️: ✅ answered by `app_error` (Sep 26, 2026; `AppErrorBoundary`, reported under "Site health" on `/admin`). *Oct 10:* most of its rows were the dev server's, see the audit's ops item 2 in ROADMAP-WPBL.md.

---

*The paragraph below is the Aug 10 suggestion and is superseded by "Handoff" at the top.*

**Suggested next three:** close-game push alerts (reuses the shipped push plumbing + the milestone-alert pattern, as in "up 2–1 in the 8th") → a second Phase 2 daily game (Daily Trivia is the offseason-proof pick) → the September race page + magic numbers (playoff-odds follow-on, timely as divisions tighten). Phase 1 is fully shipped and Predictions 2.0 is now complete (v1.20.0), so the retention loop leans on push alerts and the next daily game.
