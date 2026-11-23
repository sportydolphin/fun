# WPBL Stats tab: audit fixes

Plan for the improvements found in the Nov 7, 2026 audit of `/wpbl/stats` (production v1.207.3),
checked at 360, 375, 1024, 1280 and 1440px in the dark theme across all nine boards (Leaders,
Players, Teams, Bests, Find, Run value, Charts, plus Pitch by pitch and Draft untouched).
Nothing found is broken; the problems are consistency between boards and wasted space.

## Before starting

- Read `src/CLAUDE.md` and `src/wpbl/CLAUDE.md` first (loading states, borders, a11y, the two
  desktop scales, `chromePx` vs `rem`, names never cut by character count).
- Most of the tab is `src/wpbl/stats/` (`StatsView.tsx` is the orchestrator, `ControlBar.tsx` the
  bar, `axes.ts` the board/side/view rules, `RankedList.tsx` the phone list, `SeasonTable.tsx` the
  grid). Leader cards: `src/wpbl/LeadersBoard.tsx` on top of `src/ui/leaders.tsx`. Find:
  `src/ui/finderBoard.tsx`. Bests: `src/wpbl/BestsView.tsx`. Charts: `src/wpbl/ChartsView.tsx`.
- **Shared with MLB:** `src/ui/leaders.tsx`, `src/ui/finderBoard.tsx` and `STATS_W` in
  `src/ui/layoutWidths.ts`. Any change there must be checked on `/mlb/stats` too.
- Many current choices are deliberate and explained in comments. Read the comment above the code
  before changing it; where a fix below contradicts one, it is marked **Owner decision** and should
  not be built without asking.
- Every PR: `npm run test`, lint clean, and `npm run sweep -- --shift --routes /wpbl/stats` (add
  `/mlb/stats` when a shared file moved). If a change alters what the control bar or the Leaders
  board draws on load, update `stats/Skeleton.tsx` to match so nothing shifts. If a fetch changes,
  record sweep fixtures in the same PR (see `src/CLAUDE.md`).
- Changelog entry at the top of `src/changelog.ts`, label-style copy, no em dashes, American
  spelling.

## PR 1: consistency fixes (small, low risk)

### 1.1 One tie notation everywhere
- **Problem:** Leaders and Players mark ties `T-3`. Bests repeats the number with no mark
  (`2, 2, 4`). Find numbers rows `1..9` even when all nine are tied at 4 H.
- **Fix:** Bests: pass the `tied` flag through to `GameLineRow` and draw `T-n` the way
  `src/ui/leaders.tsx` does. Find: `finderBoard.tsx:502` passes `rank={i + 1}`; compute competition
  ranks on the displayed sort value (same rule as `StatsView.tsx:806`, judged on the text as shown,
  a dash is never a tie) and draw `T-n`. Consider extracting the rank helper from `StatsView.tsx`
  into `src/ui/` so the three boards share one function.
- **Check:** the rank column width in `finderBoard.tsx` (`COL.rank: 1.5` rem) fits `T-10` at Large
  text; widen it in rem if not.

### 1.2 One name stage per column in Find
- **Problem:** on Find at 1440, `D. Benites` sits above `Emi Saiki` in the same column, because each
  row is fitted on its own.
- **Fix:** fit the column once, the way `useLineNameFit` in `src/ui/names.ts` fits a line of
  several names: the stage is the longest one any row needs. Same for Bests if it shows the issue.
- **Check:** `npm run sweep -- --ellipsis --routes /wpbl/stats` lists no full names.

### 1.3 Disabled side options that look disabled
- **Problem:** an unavailable side (Overall on Bests, Find, Run value; Fielding on Bests and Run
  value) renders at `rgba(255,255,255,0.5)` next to available ones at `0.7`. They read alike, so the
  switch looks broken.
- **Fix:** keep them drawn (the comment above `SIDES` in `axes.ts` explains why the switch keeps
  its width), but make the difference unmistakable: no pill hover, `cursor: not-allowed`, a dotted
  or absent separator, and the existing `hint` shown as a tooltip on hover and focus. Stay with the
  theme's `text.disabled` token, never `opacity` on text. Lives in `PillGroup` (find it from
  `ControlBar.tsx:166`).

### 1.4 Small copy fixes
- Bests caption `Single game · 30 regular-season games` (`BestsView.tsx:51`) sits beside a Teams
  board where each club shows G = 15. Make it unambiguous: `Single game · 30 league games` (and the
  playoff variants to match).
- Charts legend renders as `• ● Size: PA`. Find the stray glyph in the legend in `ChartsView.tsx`
  (the `size` field around lines 140 to 175) and leave one swatch.
- Card titles mix case: `Matching Games`, `Best Run Value`, `Most Wins Added` are title case while
  `Search` is not. `finderBoard.tsx:784` passes `'Matching games'`, so the title casing is applied
  somewhere in `SectionCard`. **Owner decision** which way to standardize: the Leaders card titles
  are title case on purpose, copied word for word from MLB's `leaderLabel`s
  (`LeadersBoard.tsx:44`). Recommendation: title case for every card title on both sections, and
  leave the Leaders/MLB titles alone.
- `RBIs` (Leaders) vs `Runs Batted In` (Bests). Match Bests to the Leaders title, since that one
  mirrors MLB.

## PR 2: controls that hold still between boards

### 2.1 Keep the reader's side when moving between boards
- **Problem:** `defaultSide` (`axes.ts:127`) opens Leaders and Players on Overall and every other
  board on Hitting, so moving Players to Teams silently flips the switch.
- **Fix:** in `selectBoard` (`StatsView.tsx:848`), keep the current side whenever `sideOn` allows it
  (it already does). The jump comes from boards that cannot answer Overall: when leaving Overall
  for such a board, fall back to `ballSide` (already the case), and when coming BACK to a board that
  answers Overall, return to Overall only if the reader was last on it. Track that with one more
  piece of state, like `ballSide`. Address bar behavior (`?side=` absent means the board's default)
  stays as it is so old links keep working.
- **Check:** analytics: `logBoard('side', ...)` must not fire for these automatic moves.

### 2.2 The season slice keeps its slot
- **Problem:** the Regular season / Playoffs / Both chips appear on Hitting and vanish on Overall
  (`ControlBar.tsx`, the `!overall` condition), so the desktop bar reflows when the side changes.
- **Fix:** on Overall, draw the chips disabled with a hint (`Regular season only`) instead of
  removing them. Same treatment where a board does not take the slice, so the bar is the same
  shape on every board once a postseason exists.

### 2.3 Run value's second Hitting switch
- **Problem:** inside the Most Wins Added card on Run value there is a `Hitting | Both ways` switch
  under a bar that already has a Hitting switch, about 200px of stacked controls on a phone (board
  tabs, Analysis sub-tabs, side switch, then this).
- **Fix:** **Owner decision.** Options: fold `Both ways` into the side switch as the Overall option
  on Run value (Overall is disabled there today), or rename the inner switch so it does not repeat
  the word Hitting (`Batting only | Two-way`). The first removes a control and fills a disabled
  option; recommended. Code in `src/wpbl/RunValueView.tsx` (note that file has uncommitted local
  edits on `feat/world-cup-2004-2008`; check `git status` before starting).

## PR 3: desktop layout

### 3.1 The page gutter and its alignment with the toolbar
- **Problem:** `STATS_W = min(1540px, calc(100vw - 24px))` (`src/ui/layoutWidths.ts:23`). `100vw`
  includes a classic scrollbar, so on Windows at 1440 the content sits **4.5px** from the window
  edge (measured), 12px with overlay scrollbars. Either way the `WPBL Stats` heading starts about
  20px left of the toolbar logo, and 1540 is wider than Home's 1260, so the page width jumps between
  tabs.
- **Fix:** publish the scrollbar width once (`innerWidth - documentElement.clientWidth`) as a CSS
  variable on `:root` (on resize too) and subtract it in `STATS_W` and `HOME_W`. Then set the gutter
  to the toolbar's own horizontal padding (measure it in `ToolbarNav.tsx`) instead of 12px, so
  content and logo share a left edge. **Owner decision** whether to also lower the 1540 cap toward
  1260; see 3.2, which removes most of the reason for it.
- **Check:** both sections, at 1024, 1280, 1440 and 1920, and with the desktop side panel open
  (`WpblApp.tsx` moves the page aside using these widths; see the header comment in
  `src/wpbl/layoutWidths.ts`).

### 3.2 Tables sized to their columns
- **Problem:** on Players → Overall at 1440 there are 11 columns stretched over 1540px: the name
  column is about 410px and the numbers sit far from the names. Teams and Fielding are the same.
- **Fix:** in `SeasonTable.tsx`, give stat columns a fixed rem width (they hold numbers, so rem per
  `src/CLAUDE.md`) and let the table take `width: max-content` with `max-width: 100%`, left aligned
  under the board tabs. The wide hitting Standard view still scrolls inside its box as today.
- **Check:** pinned header and frozen columns (see `useBoardLayout.ts` and the seam note in
  `layout.ts`) still behave; the sweep's overflow check passes at both text sizes.

### 3.3 The Leaders grid's empty slot
- **Problem:** every Leaders side has 8 cards (`LEADER_CARDS`, `LeadersBoard.tsx:54`; Fielding 4)
  in a 3-column grid, so the last row is 2 cards and a hole. The grid is three on purpose
  (`LEADER_GRID_SX`, `src/ui/leaders.tsx:35`: four across cut names at Large text).
- **Fix:** **Owner decision.** Options: 9 cards per side (add one stat each, e.g. Hitting `2B` or
  `BB`, Pitching `GS` or `K/BB`, Overall `Wins Added`, which its comment deliberately left out), or
  6 cards (drop the two weakest). The Overall duplicate in 3.4 frees a slot either way.
  Recommendation: 9.

### 3.4 Overall Leaders repeats itself
- **Problem:** `WAR` and `Position Player WAR` have the same top five.
- **Fix:** **Owner decision.** Replace `Position Player WAR` with a card that adds something
  (`Positional Adjustment` or `Wins Added`), keeping `Pitching WAR`.

### 3.5 The Teams board's empty half
- **Problem:** 4 rows, then about 400px of blank page before the footer at 1440×900, with no
  record or run differential on the board.
- **Fix:** first find where the blank band comes from (the `flexGrow` comment at
  `StatsView.tsx:1036` and the pager's screenful floor in `SwipeableViews` are deliberate; the
  floor may only be needed on touch). Then **Owner decision** on content: add `W-L`, `RS`, `RA`,
  `Diff` as leading columns on Teams (data is already on the game rows), or show the hitting and
  pitching tables stacked on Teams since each is only four rows.

### 3.6 Column order (no change recommended)
- WAR is the 10th of 11 columns on Overall, and Standard pitching carries HBP, BK, WP, BF and P.
  Both follow FanGraphs and Baseball-Reference on purpose (`VIEW_ORDER`, `axes.ts:61`). The sorted
  column is already tinted. **Owner decision**; recommendation is to leave them.
- `Pos` on Overall is the positional adjustment while the line under each name is the position.
  Rename the label to `Pos adj` (`statColumns.ts:238`) and give it a glossary entry in
  `src/wpbl/glossary.ts` (uncommitted local edits there too; check first).

## PR 4: phone

### 4.1 Leaders is a 3,200px scroll
- **Problem:** 8 full cards stacked, about 1.5 per screen at 375.
- **Fix:** on a phone, show 3 rows per card with the existing `See all` (MLB's phone leaders
  likely want the same; it is the shared `src/ui/leaders.tsx`, so make it a prop). Update
  `stats/Skeleton.tsx` so the loading state draws 3 rows.
- **Alternative:** one card at a time with a row of stat chips. More code, less scrolling; owner's
  call if 3 rows is not enough.

### 4.2 The game line on Bests and Find is cut off
- **Problem:** `Aug 12 vs LA · 3-for-4, 3 HR, 6 …` at 360 and 375 (probe found 6 to 7 per board).
- **Fix:** let the line wrap to a second line (`GameLineRow` / `GameLineFrame`), or, if the row
  height must hold, drop items from the end of the line by measuring, never by character count.
  Wrapping is simpler and recommended.

### 4.3 The context line on Players → Overall changes per row
- **Problem:** one row shows `+20.5 Bat · +1.5 Fld`, the next `1.48 Pos WAR · 0.31 Pit WAR`, because
  `StatList` keeps the first two candidates that are not a dash or an echo
  (`CONTEXT_KEYS`, `contextCols` at `StatsView.tsx:913`, list in `RankedList.tsx`).
- **Fix:** pick the pair per board, not per row: `Pos WAR · Pit WAR` when sorted by WAR, the two
  largest components otherwise, and print a dash where a row has none. A row that is all dash
  (a pure hitter's Pit WAR) shows only the other.

### 4.4 Charts filter chips wrap
- **Problem:** at 375, `SF` and `Find player` drop to a second row.
- **Fix:** below `sm`, replace the four club chips with one select (`FilterSelect`, as
  `ControlBar.tsx` already does below `lg`), keeping `Qualified`, `Clubs` and `Find player`.

### 4.5 Label collisions on Charts (both layouts)
- **Problem:** in the lower left cluster of OBP vs SLG at 1440, `M. Davis`, `A. Hondras` and
  `M. Paddison` overlap each other and the dots.
- **Fix:** run the label placer's collision pass against the dots as well as the other labels, and
  drop a label that cannot be placed rather than overlap. Find the placer from `ChartsView.tsx`.

## Order and size

| PR | Items | Size |
|----|-------|------|
| 1 | 1.1 to 1.4 | Small. Start here. |
| 2 | 2.1 to 2.3 | Small to medium. |
| 3 | 3.1 to 3.6 | Medium. Touches MLB via shared widths. |
| 4 | 4.1 to 4.5 | Medium. 4.1 touches MLB via `leaders.tsx`. |

## Owner decisions (answered Nov 7, 2026)

These settle every **Owner decision** above; build to them.

1. **Card titles:** Title Case everywhere. Leaders and MLB titles stay; fix the outliers
   (`Search` and any other card title not in Title Case).
2. **Run value's inner switch:** fold `Both ways` into the Overall side on Run value and remove the
   inner switch. `sideOn` (`axes.ts:121`) must then allow Overall on `runs`.
3. **Width cap:** lower `STATS_W` from 1540px to 1260px, matching Home, together with 3.1 and 3.2.
   Check `/mlb/stats` too (shared constant).
4. **Leaders:** 9 cards per side. Overall: replace `Position Player WAR` with `Wins Added` and add
   `Positional Adjustment` (keep `Pitching WAR`). Hitting and Pitching: add one card each (e.g.
   `2B` or `BB`; `GS` or `K/BB`). Fielding has 4, which leaves a row of 1 in a 3-column grid: take
   it to 6 (candidates: `Range Runs`, `Fielding Runs`, a catcher's `CS%` with a games floor; read the
   comment at `LeadersBoard.tsx:72` on why errors and catcher cards were left off).
5. **Teams board:** add `W-L`, `RS`, `RA` and `Diff` as leading columns, and fix the blank band
   below the table.
6. **Columns:** leave WAR's position and the Standard pitching tail as they are. Only rename `Pos`
   to `Pos adj` and add its glossary entry.
