# Player page: audit and plan

> Audited **Nov 2, 2026** on the dev build: Kelsie Whitmore (two-way, the longest page on the site)
> and Sabrina Robinson (12 PA), at desktop and at 375px. Written ahead of World Cup stage 1
> ([ROADMAP-WOMENS-BASEBALL.md](../ROADMAP-WOMENS-BASEBALL.md)), which puts a second competition on
> this page, and of the UI overhaul's phase 1 ([ROADMAP-UI.md](../ROADMAP-UI.md)), which mocks it.
> The page is [`src/wpbl/PlayerDetail.tsx`](../src/wpbl/PlayerDetail.tsx) and
> [`src/wpbl/player/`](../src/wpbl/player/); the shared parts are
> [`src/ui/playerCard.tsx`](../src/ui/playerCard.tsx).

## What is already right

Keep these through any redesign. They are why the page reads as a stat site and not a template.

- **The club band.** Real club colors, contrast-checked, a portrait with room for the uniform, facts
  as labels ("Hometown", "Drafted"). It is the one decorative surface, and it earns it.
- **Ranks in the cell.** "1st" under the HR figure, linked to the board it came from, shown only
  past a bar. Context without a sentence.
- **The League avg row** under every table. The fastest way to read a number in a new league.
- **Honest sourcing.** "Source: play descriptions, not measured locations" under the spray chart;
  the pitch plot hidden when the radar covered too few games.
- **No prose.** No generated summaries, no "insights". The numbers carry it.
- **Loading is the page drawn empty**, measured by the sweep.

## Findings

### Hierarchy: nothing on the page is the headline

1. **The first thing under the band is an 11-column table.** Nothing answers "how good is this
   player" at a glance. The UI direction is one number that dominates; here every figure is the
   same 14px weight, and on a phone the summary scrolls sideways, so wRC+ and WAR are off the first
   screen entirely.
2. **The summary repeats under All stats.** With All stats open, G, PA, HR, AVG, OBP, SLG and OPS
   appear twice and wOBA, wRC+ and WAR twice more: three tables, ten repeated figures.
3. **Three heading levels look like one.** "Batting" is barely larger than the small caps of
   STANDARD, GAME LOG, CLIPS and PITCH MIX, and those are the same as a table's own column labels.
   A two-way player's Pitching starts about 3,000px down the desktop page with nothing to jump to.
4. **A two-way player has no single value.** Pos WAR (1.48) and Pit WAR (0.31) sit in two sections;
   the one figure that sums a two-way season is nowhere.

### Layout

5. **Clips interrupt the stats on desktop.** A 230px strip of posters sits between the season tables
   and the game log, which are read together.
6. **The spray chart is the biggest object on the page** (about 400px tall), left-aligned, with
   Pull / Center / Oppo floating at the far right edge. Its ramp is red, which reads as "bad" on a
   page where blue means "better than league".
7. **On a phone the role pills sit above the band**: navigation before identity. The sheet's first
   screen is the pills, the band and one table header.
8. **The pitch mix legend is a sentence** ("Tick: league · Blue: better · Amber: worse"). It is a
   definition; it belongs in an `InfoDot`.

### Data

9. **Likely bug: G disagrees between Home and the page.** Home's Player Spotlight shows Sabrina
   Robinson at 9 G; her page shows 7. `SeasonStrip` in
   [`home/PlayerCards.tsx`](../src/wpbl/home/PlayerCards.tsx) hands `seasonGames` to `sumBatting`
   where the page hands the whole schedule; if `seasonGames` lacks the postseason games, the
   postseason filter (which excludes by id, and fails open) cannot drop them. Verify before fixing.

### World Cup readiness: the page is built around one league's season

10. **The season picker and Regular / Playoffs / Both assume the WPBL.** A World Cup has a group
    stage and a Finals, a different year cadence, and no season to pick.
11. **The band is a club band.** A World Cup-only player (about 200 of the 2026 field) has no club,
    and a WPBL player's national team is not shown anywhere. Hometown carries a country by
    accident ("San Diego, California, USA").
12. **Every section assumes WPBL depth.** Run value, WPA, the matchups, the pitch profile and the
    spray chart all exist for the WPBL. A World Cup player with five games would get a page of
    empty sections unless each one is designed to be absent.
13. **The stat table has one row.** `SEASON | 2026` is a career table with one row in it. That is the
    shape a second competition should grow into, not a new section bolted underneath.

## Principles for the redesign

What separates a stat page from template output. Every change below is held to these.

- **One accent per page: the club's** (or the national team's). Blue stays the rank and link color.
  No second gradient, no glow, no colored icon beside each heading.
- **Numbers carry the weight; labels stay quiet.** Large tabular figures, small uppercase labels,
  two or three type sizes on a screen.
- **Separate by space and fill, not boxes.** No card inside a card.
- **Labels, never narration.** "World Cup", "Group stage", "Team USA", not "Her international career".
- **Absent, not empty.** A section with nothing to show is not drawn. No "No data" placeholders
  inside a populated page.
- **No combined line across competitions.** A WPBL season and a World Cup are different levels;
  their totals sit in separate rows and are never summed.
- **No emoji flags.** Windows renders them as two letters. Flags, if any, are small SVGs.

## The plan

### Now: fixes that need no design decision (Nov 2, 2026)

- [x] **The G mismatch** (finding 9). Not the postseason: the page dropped every batting line
  without a plate appearance, which threw out 22 defensive subs' and pinch runners' games and 3
  runs along with the 136 empty lines the box score gives a pitcher. `isBattingGame` in `stats.ts`
  is the one rule now, on the page, Compare and Home.
- [x] **Repeated figures** (finding 2). With All stats open, the summary steps aside when the full
  tables hold all of its columns (`summaryCovered`), on both sections' cards.
- [x] **Role headings** (finding 3) up to `display` size. No jump links: two-way players are a
  handful, and the role headings already carry the search's part anchors.
- [x] **A two-way player's WAR** (finding 4): "Total WAR" on the season caption, from the board.
- [x] **The spray chart** (finding 6): 400px wide on the player page, Pull / Center / Oppo beside
  it rather than across the column. Also fixed: a switch hitter's chart nested a `div` in a `p`.

**Not changed, on review:**

- **The headline strip** (finding 1). The card had one (a large rate strip over the counts) until
  Oct 2026, and it was removed on purpose: three sizes of number and a layout to learn, where a stat
  site prints one table (see `CARD_TYPE` in `playerCard.tsx`). Revisit only in Figma, against that.
- **Clips placement** (finding 5). Placed under the first role's season on purpose, so the most
  human thing on the page is not last. Kept.
- **The spray chart's red** (finding 6). The convention for the chart, and chosen so the field does
  not read as more club chrome. Kept.
- **The phone's role pills above the band** (finding 7). The same pinned control as Game Center's
  tabs over the same pager; inside each pane it would scroll away or be drawn twice. Kept.
- **The pitch mix legend** (finding 8). It is a key to the colors, not a definition, and a chart's
  key belongs on the chart. Kept.

### Phase 1 (November, Figma): mock it with three data cases

The player page is already one of phase 1's four screens. Mock it with the three players it must
serve, phone, desktop and side panel each:

1. **Kelsie Whitmore**: two-way, WPBL plus a World Cup, the most content the page can hold.
2. **A WPBL pitcher with no World Cup**: the most common page.
3. **A World Cup-only player with five games**: the thinnest page, with no club.

Decide in Figma:

- [ ] **Whether a headline earns its place back** (finding 1), knowing why the last one was removed.
- [ ] **The band for two kinds of team.** A club band for a WPBL player, with the national team as
  a fact ("Team USA" with a small flag) beside Hometown and Drafted. A national-team band, in the
  federation's colors, for a World Cup-only player.
- [ ] **The career table by competition** (finding 13): grouped rows, one per season per
  competition, Baseball-Reference style. WPBL rows, then World Cup rows, each with its own League
  avg row, no combined total. A World Cup row names the event and country ("2026 · Group B · USA")
  and links to wbsc.org.
- [ ] **The picker** (finding 10): competition and year in one control, with the phase control
  (Regular / Playoffs for the WPBL, Group stage / Finals for a World Cup) beside it only when that
  competition has phases the player played in.

### Phase 2 (December to January, with World Cup stage 1)

Built against the local, gitignored data; published on WBSC's yes.

- [ ] The career table grouped by competition, reading `international.json` through the person
  registry. Each World Cup row shows the WBSC name it matched as a footnote (the crosswalk check the
  roadmap asks for), not as a column.
- [ ] The national team in the band's facts.
- [ ] The picker and phase control generalized off `SeasonScope`.
- [ ] Every section declares what it needs (a league's run expectancy, pitch data, clips) and is
  absent without it (finding 12). A test renders the page for a World Cup-only fixture and asserts no
  section draws empty.
- [ ] `seo.ts` titles name both competitions once a player has both.
- [ ] Sweep fixtures for the three mock players; `--shift` and `--ellipsis` clean.

### Phase 3 (January to March, with World Cup stage 2)

- [ ] `/players/<slug>` for World Cup-only players: the same component with the national-team
  band, the event table, a game log grouped by event, and the matchups only within an event.
- [ ] Indexing decided by a measured threshold, per the roadmap's thin-page risk.
- [ ] Before Mar 15: everything above settled, so the 2027 WPBL season opens on a stable page.

## Not doing

- **A combined career line across competitions**: different levels; see the principles.
- **Written player bios or generated summaries**: the page stays numbers and labeled facts.
- **WBSC photos or video**: stats only, per the Neighbors table in the roadmap.
