import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, type Theme } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllLines, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, fmtRate, fmtTwo } from './stats'
import { computeWpblPlayerRanks, ordinal, type WpblStatRank, type WpblPlayerRanks } from './percentiles'
import { useEraBasis } from './EraBasisContext'
import type { EraBasis } from './stats'
import { wpblAccent, wpblColor, wpblSecondary, wpblFullName, outsToIp } from './constants'
import { ModalShell, PlayerPortrait, CopyLinkButton, TapTip, SegNav, useWpblDark } from './ui'
import SwipeableViews from './SwipeableViews'
import { WrittenAbout } from './Reading'
import { PitchLocationCard } from './PitchLocation'
import { displayPosition } from './positions'
import { wpblPlayerPath } from './routes'
import { track, EVENTS } from '../lib/analytics'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblArticle } from './types'

// Player page: profile, season totals aggregated from box-score lines, where those totals sit
// against the league, and a per-game log. Public read; opened from a roster row, a leaderboard,
// the header search, a Home chip, a Discord link or a shared URL.
//
// STRUCTURE, and why it is tabs (Aug 25, 2026). This used to stack every stat block down one
// scroll. Measured on a 375px phone that came to 1287px of scrolling against 654px of sheet,
// and a two-way player got two of everything: two hero cards, two game logs, two sets of table
// chrome for the same nine games. Worse, all four blocks carried the same visual weight, so
// fielding percentage over nine games — which is noise — sat as tall as a .400 average.
//
// Now the roles are a segmented control and only the active one is mounted, the same shape
// Game Center uses for its four boards and the media shelf uses for its three segments. The
// control appears ONLY when a player has more than one real role; the great majority of the
// roster is a hitter or a pitcher and simply sees her own numbers with no chrome around them.
//
// AND WHY IT IS TWO COLUMNS AT lg. Everything above was measured on a phone, and desktop was
// getting that column verbatim: 1143px of stacked content in a 640px dialog on a 1440px
// screen, roughly a third of it visible at a time, with ~800px of empty screen either side.
// So at `lg` the dialog widens, the season facts and the game log sit side by side, and the
// headline pair moves onto the club band, which was otherwise a gradient running most of the
// way across to nothing. Same content, ~600px tall instead of 1143. Nothing below `lg`
// changes: the phone is still the layout everything else here was measured for.

// What each abbreviation stands for — surfaced on hover/tap so the stat line isn't cryptic.
const STAT_FULL: Record<string, string> = {
  AVG: 'Batting average', OBP: 'On-base percentage', SLG: 'Slugging percentage', OPS: 'On-base plus slugging',
  G: 'Games', AB: 'At-bats', R: 'Runs', H: 'Hits', '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs',
  RBI: 'Runs batted in', BB: 'Walks', SO: 'Strikeouts', SB: 'Stolen bases', TB: 'Total bases',
  ERA: 'Earned run average', WHIP: 'Walks + hits per inning pitched', 'W-L': 'Wins–Losses', SV: 'Saves',
  IP: 'Innings pitched', ER: 'Earned runs', P: 'Pitches thrown', DEC: 'Decision (W/L/S/H)', OPP: 'Opponent',
  POS: 'Position played that game', FPCT: 'Fielding percentage', PO: 'Putouts', A: 'Assists', E: 'Errors', DP: 'Double plays',
  PB: 'Passed balls', SBA: 'Stolen bases allowed',
  'K/9': 'Strikeouts per nine innings', 'K/7': 'Strikeouts per seven innings, a full WPBL game',
  'K/BB': 'Strikeouts per walk',
}
// ERA is the one abbreviation whose meaning is incomplete without its denominator, and this
// tooltip is where a reader is already asking what a column is. Everything else is fixed.
const statFull = (k: string, basis: EraBasis): string =>
  k === 'ERA' ? `Earned run average, per ${basis}` : STAT_FULL[k] ?? k

/**
 * Where she played THAT game, off the box-score line.
 *
 * Deliberately the raw line, not `displayPosition`: that answers "what position does this
 * player play", a season-long question decided by majority vote, and it is already answered
 * once in the band at the top. The game log is asking the opposite question, one row at a
 * time, and the interesting rows are exactly the ones the season-long answer overrules: the
 * catcher's three games at first, the day the left fielder finished the game on the mound.
 * Feeding it a smoothed answer would print the same code down all forty rows.
 *
 * The feed writes a slash when she moved mid-game ("lf/p"), and that is kept whole rather than
 * truncated to the first token the way `positions.ts` does for VOTING: a vote has to count one
 * game once, but a reader looking at the row wants to know she pitched. Upper-cased because
 * the feed writes these lowercase and the rest of the page writes positions in caps.
 */
const gamePosition = (raw: string | null | undefined): string => {
  const t = String(raw ?? '').trim()
  return t ? t.toUpperCase() : '—'
}

// A batting line only counts as real batting if the player actually came to the plate — an
// at-bat, a walk, a HBP, or a sacrifice. Zero-PA rows (a pinch-runner who scored, a defensive
// sub) otherwise surface as an all-zero stat block and a phantom "0-for-0" game-log line, so
// we drop them entirely rather than show empty stats.
const hasPlateAppearance = (l: WpblBattingLine): boolean =>
  l.ab + l.bb + l.hbp + l.sf + l.sh > 0
// The player modal sits at zIndex 1600; MUI's tooltip defaults to 1500, so it would
// render behind the modal. Lift the popper above it.
const TIP_Z = 1700

type Role = 'batting' | 'pitching'

// ─── pieces ──────────────────────────────────────────────────────────────────

/**
 * The two numbers a reader came for, each on its own line with its own rank.
 *
 * This replaced a headline that read `.406/.513/.688` under the label `AVG/OBP/SLG` with a
 * floating `6th of 33` pill off to the right. Three problems, all of them the same problem:
 * the pill did not say WHICH of the three stats it ranked, a slash line is three numbers
 * where the page only needs the one that summarises them, and OBP and SLG were being given
 * hero weight while OPS — which is just the two of them added — sat in the small grey line
 * underneath. Now the rank sits on the same row as the stat it belongs to and cannot be
 * misread, and OPS leads with AVG under it because those are the two anyone asks for.
 */
function HeroStat({ value, label, rank, primary, onDark }: {
  value: string; label: string; rank?: WpblStatRank; primary?: boolean
  /** Drawn on the club band rather than on the page. The band is the club's primary, which is
   *  near-black on all four teams, so the theme's own text colours would be invisible on it in
   *  light mode. */
  onDark?: boolean
}) {
  const { basis: eraBasis } = useEraBasis()
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      {/* One width for both rows, so the two numbers right-align into a column and the two
          labels start at the same x. They used to be 96 and 62, which put OPS and AVG at
          different indents and made the pair read as two unrelated lines. */}
      <Typography sx={{
        fontSize: primary ? '2rem' : '1.15rem', fontWeight: 800, lineHeight: 1.1,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        minWidth: HERO_VALUE_W, textAlign: 'right', flexShrink: 0,
        ...(onDark ? { color: '#fff' } : {}),
      }}>
        {value}
      </Typography>
      <TapTip title={statFull(label, eraBasis)} popperZIndex={TIP_Z} sx={{ flexShrink: 0 }}>
        <Typography sx={{
          fontSize: primary ? '0.75rem' : '0.68rem', fontWeight: 800, textTransform: 'uppercase',
          // 0.80 on the band, not 0.72. The band hero sits in the last 216px of the wash,
          // which is the strongest point of it, and the stronger gradient took this line to
          // 4.4:1 over New York's sky blue. Same reason as the hometown lines. See the band.
          letterSpacing: 0.6, color: onDark ? 'rgba(255,255,255,0.80)' : 'text.disabled',
        }}>
          {label}
        </Typography>
      </TapTip>
      {rank && (
        // The rank carries its population, always. "2nd" alone invites a reader to picture a
        // league of hundreds; "2nd of 17" is the same fact without the borrowed authority.
        //
        // Neutral, NOT the team accent. The accent is a club identity, and three of the four
        // are green or red, so "31st of 33" rendered in Boston green reads as good news about
        // a bad number, and a Firebells hitter leading the league would get her rank in red.
        // The rank is a fact; the colour was editorialising, at random, by club.
        <Typography sx={{
          ml: 'auto', flexShrink: 0, fontSize: '0.7rem', fontWeight: 800,
          color: onDark ? 'rgba(255,255,255,0.82)' : 'text.secondary', fontVariantNumeric: 'tabular-nums',
        }}>
          {ordinal(rank.rank)} of {rank.of}
        </Typography>
      )}
    </Box>
  )
}

/** Sample size and the counting facts that are not worth a grid cell. One line, and the ONLY
 *  place games and at-bats appear: they used to be here and again as the first two chips of
 *  the grid below, which is the same fact twice on the same screen. */
const HERO_VALUE_W = 104

/**
 * CENTRED, and it is the only element in the hero that is.
 *
 * The two stat rows are a three-column arrangement with three hard vertical lines: the values
 * right-align at one edge, the labels start at the next, the ranks right-align at the last.
 * This line was block-level and left-aligned, so it began at the hero's own left edge: 16px
 * left of the headline number, 65px left of the one under it, and level with nothing at all.
 * One element out of four aligned to a line no other element uses reads as a mistake, and it
 * is the line a reader's eye lands on last, which is why it was the piece that kept looking
 * wrong after the block itself was fixed.
 *
 * Centred rather than joined to one of the three columns, because its LENGTH varies more than
 * anything else here: "10 G · 29 AB" against "9 G · 41.2 IP · 6-2 · 3 SV · small sample". Tied
 * to the value column it would fit the first and wrap the second; centred, a long one simply
 * grows either side of the axis the whole block is already centred on.
 */
function SampleLine({ text, onDark }: { text: string; onDark?: boolean }) {
  return (
    <Typography sx={{
      // 0.76 on the band: it is the smallest thing sitting in the strongest part of the wash,
      // and 0.62 measured 3.7:1 over New York. See the band's gradient for the whole budget.
      fontSize: '0.72rem', color: onDark ? 'rgba(255,255,255,0.76)' : 'text.disabled',
      mt: 0.75, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
    }}>
      {text}
    </Typography>
  )
}

/**
 * Counting stats as a WRAPPING grid rather than a single row.
 *
 * The row this replaced was `display:flex; overflow-x:auto`, and on a 375px phone a batting
 * line came to 408px of content in a 307px box: SB and TB were cut off mid-row with no
 * scrollbar, no fade and no hint that anything was missing. Silent data loss is the worst
 * shape a layout bug can take, because nobody reports it. A grid cannot clip: it wraps.
 */
/** The widest column count that divides `n`, so the last row is never part-empty. `cap` is what
 *  the narrowest supported width can hold. Four is the fallback when nothing divides (seven
 *  fielding chips), being the least ragged of the leftovers rather than a rule of its own. */
export const gridColumns = (n: number, cap: number): number => {
  if (n <= cap) return n
  for (let c = cap; c >= 3; c--) if (n % c === 0) return c
  return Math.min(cap, 4)
}

function StatGrid({ items }: { items: [string, string | number][] }) {
  const { basis: eraBasis } = useEraBasis()
  // A column count that DIVIDES the item count rather than a fixed four and six. Ten batting
  // chips in six columns is 6 + 4, so the row ends in two dead cells and the block reads as a
  // grid that failed to fill rather than as a stat line.
  //
  // `xs` was pinned at four on the claim that five 3-character chips do not fit a 375px phone.
  // Measured on one, they do, and so do six: at five columns the chip is 63px against a 57px
  // label, at six it is 52 against 45, and neither clips or wraps. So the phone takes the same
  // cap as everything else, and the ten batting chips go from three ragged rows to two full
  // ones (138px to 90px) while the six pitching chips collapse to a single row (90px to 45px).
  // That is worth having on the two blocks sitting directly under the headline.
  //
  // The reason six is safe on the narrowest phones is worth stating, because it is a property
  // of the data rather than of the rule: six columns can only ever be chosen for a six-item
  // grid, since six does not divide ten, and the six-item grid is the pitching one, whose
  // labels are all one or two characters. The three-character labels (RBI) live in the ten,
  // which lands on five. Re-measure if a twelve-item grid is ever added here.
  const cols = gridColumns(items.length, 6)
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 0.75,
    }}>
      {items.map(([label, value]) => (
        <TapTip key={label} title={statFull(label, eraBasis)} popperZIndex={TIP_Z}
          sx={{ textAlign: 'center', borderRadius: 1.5, bgcolor: 'action.hover', py: 0.6, px: 0.4, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>{label}</Typography>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>{value}</Typography>
        </TapTip>
      ))}
    </Box>
  )
}

/**
 * Where each stat sits against the qualified field.
 *
 * The bar is position-only: it is not coloured good-to-bad, because a four-club league in its
 * first season does not support a red-to-blue scale that implies a settled distribution. The
 * population size is printed under the strip for the same reason. See percentiles.ts.
 */
function PercentileStrip({ ranks, of, color, noun }: {
  ranks: WpblStatRank[]; of: number; color: string; noun: string
}) {
  const { basis: eraBasis } = useEraBasis()
  if (ranks.length === 0) return null
  return (
    <Box sx={{ mt: 1.75 }}>
      <Typography sx={sectionSx}>Against the league</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
        {ranks.map(r => (
          <Box key={r.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TapTip title={statFull(r.label, eraBasis)} popperZIndex={TIP_Z} sx={{ width: 38, flexShrink: 0 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>
                {r.label}
              </Typography>
            </TapTip>
            <Typography sx={{ width: 44, flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {r.display}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0, height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
              <Box sx={{ width: `${Math.round(r.pct * 100)}%`, height: '100%', bgcolor: color, borderRadius: 999 }} />
            </Box>
            <Typography sx={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
              {ordinal(r.rank)}
            </Typography>
          </Box>
        ))}
      </Box>
      {/* The population, and nothing else. It stays because a bar without a field size borrows
          the authority of a Statcast page built on thousands of batted balls, and this is a
          four-club league. The paragraph that used to follow it explaining that has gone: the
          number says it. */}
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.6 }}>
        Against {of} qualified {noun}.
      </Typography>
    </Box>
  )
}

/** Why there is no strip. One short line: saying nothing reads as a bug, and the two
 *  paragraphs this replaced spent more words explaining the absence of a number than the
 *  number would have been worth. */
function NoRanks({ reason }: { reason: WpblPlayerRanks['batReason'] }) {
  if (reason === 'ok' || reason === 'no-data') return null
  const text = reason === 'season-young'
    ? 'League ranks appear once the season is a few games old.'
    : 'Below the qualifying bar for league ranks.'
  return <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1.75 }}>{text}</Typography>
}

/**
 * Fielding as one expandable line rather than a hero card.
 *
 * It had a full card with .950 FPCT set as large as a batting average. Over nine games a
 * fielding percentage is almost entirely noise, and giving it that weight told a reader it
 * meant as much as the slash line above it. It is still here, in full, one tap away.
 */
function FieldingLine({ ft, color }: { ft: ReturnType<typeof sumFielding>; color: string }) {
  const [open, setOpen] = useState(false)
  const full: [string, string | number][] = [
    ['FPCT', fmtRate(ft.fpct)], ['PO', ft.po], ['A', ft.a], ['E', ft.e],
    ...(ft.dp ? [['DP', ft.dp] as [string, number]] : []),
    ...(ft.pb ? [['PB', ft.pb] as [string, number]] : []),
    ...(ft.sba ? [['SBA', ft.sba] as [string, number]] : []),
  ]
  return (
    <Box sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${color}`, borderRadius: 2, overflow: 'hidden' }}>
      <Box
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v) } }}
        role="button" tabIndex={0} aria-expanded={open}
        sx={{
          display: 'flex', alignItems: 'baseline', gap: 1.25, px: 1.5, py: 1, cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: -2 },
        }}
      >
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 0 }}>Fielding</Typography>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {fmtRate(ft.fpct)} FPCT · {ft.po} PO · {ft.a} A · {ft.e} E
        </Typography>
        <Typography sx={{ ml: 'auto', fontSize: '0.7rem', color: 'text.disabled', flexShrink: 0 }}>{open ? '−' : '+'}</Typography>
      </Box>
      {open && <Box sx={{ px: 1.5, pb: 1.5 }}><StatGrid items={full} /></Box>}
    </Box>
  )
}

/**
 * Columns where "the most of it in one game" is an achievement, so the best game can be marked.
 *
 * Deliberately short of the full line, on two rules. A column has to be one where MORE IS
 * BETTER, which drops SO from the batting log outright (marking a hitter's worst game in the
 * same colour as her best is the sort of thing nobody notices until it is pointed at) and drops
 * H, R, ER, BB and HR from the pitching log for the same reason, since those are what she gave
 * up. And it has to be an ACHIEVEMENT rather than an opportunity or a workload: AB is how often
 * she came up, not how she did, and a pitcher's P is how long she was left in.
 *
 * BB is left out of the batting list on a softer judgement. A walk is a good outcome and it is
 * still in the line, but "most walks in a game" is not a thing anyone scans a game log for, and
 * every mark spent on it is one more piece of colour competing with the four-hit night.
 */
const BATTING_BEST = new Set(['R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'TB'])
const PITCHING_BEST = new Set(['IP', 'SO'])

/**
 * The best value in a column, if marking it would actually say something.
 *
 * Three ways a column declines to have a best, and all three are about not spending colour on
 * nothing. A max of zero is a stat she has not done all season, and marking ten zeros as ten
 * best games is absurd. A single game cannot have a best game. And a max held by more than a
 * third of the rows is not a standout: a hitter with 1 HR in five of ten games would get five
 * marks that pick out nothing, which is worse than no marks at all, because it teaches a reader
 * the colour means nothing and they stop seeing it on the games where it does.
 *
 * Values are read through `Number` rather than assumed numeric: IP arrives as "5.2" from
 * outsToIp, and its ordering survives the coercion because the fraction digit is only ever
 * 0, 1 or 2. A column carrying anything unparseable (DEC, POS) drops out here rather than
 * needing to be listed above.
 */
function bestInColumn(values: (string | number)[]): number | null {
  if (values.length < 2) return null
  const nums = values.map(v => Number(v))
  if (nums.some(v => !Number.isFinite(v))) return null
  const max = Math.max(...nums)
  if (max <= 0) return null
  const held = nums.filter(v => v === max).length
  return held > Math.max(1, Math.floor(values.length / 3)) ? null : max
}

/**
 * Per-game log: Date and Opp lead, then that game's line.
 *
 * Cell padding tightens under sm because at 0.85 the hitting log came to 401px inside a 337px
 * box and silently clipped its last two columns. The horizontal scroll is the fallback for
 * anything narrower, but it is a POOR one on a phone, where the scrollbar is an overlay that
 * appears only once a finger is already moving: a reader who never tries has no way to know
 * the row continues. So the target is that the widest line FITS a 375px phone outright.
 *
 * 0.3 rather than the 0.4 this held until POS joined the hitting line. Fourteen columns at 0.4
 * measure 345px against the 341px a 375px sheet leaves, which is four pixels and the whole of
 * the TB column, silently. 0.3 brings it to 323 and leaves ~18px of slack, which is about one
 * more character of POS: enough for a player who moved twice in a game ("LF/CF/P"), and the
 * number to re-measure against if a column is ever added here again.
 */
function GameLogTable({ title, statHeaders, rows, best, accent }: {
  title: string
  statHeaders: string[]
  rows: { date: string; opp: string; cells: (string | number)[]; onOpen?: () => void }[]
  /** Which headers may carry a best-game mark. See BATTING_BEST / PITCHING_BEST. */
  best?: Set<string>
  accent: string
}) {
  const { basis: eraBasis } = useEraBasis()
  // Column index → the value to mark, for the columns that have one. Computed once for the
  // table rather than per cell, which would be O(rows²) down a forty-game log.
  const marks = useMemo(() => {
    const out = new Map<number, number>()
    if (!best) return out
    statHeaders.forEach((h, j) => {
      if (!best.has(h)) return
      const top = bestInColumn(rows.map(r => r.cells[j]))
      if (top != null) out.set(j, top)
    })
    return out
  }, [best, statHeaders, rows])
  if (rows.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={sectionSx}>{title}</Typography>
      {/* Capped and self-scrolling in the desktop two-column layout, with the header pinned.
          This is the one block on the page that grows on its own: a row a game, ten today and
          about forty by Sep 6, which is ~1200px against a left rail that stays ~340 whatever
          happens. Uncapped it would re-open the same empty-column hole the two columns were
          meant to close, just on the other side. Below `lg` there is only one column and the
          pane already scrolls, so a scroller inside a scroller would buy nothing and cost a
          touch gesture. */}
      <Box sx={{ overflowX: 'auto', maxHeight: { lg: LOG_MAX_H }, overflowY: { lg: 'auto' } }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Date</Box>
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Opp</Box>
              {statHeaders.map(h => (
                <TapTip key={h} title={statFull(h, eraBasis)} component="th" popperZIndex={TIP_Z} sx={thSx}>{h}</TapTip>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((r, i) => (
              /* The row opens that game.
                 NOT an anchor, which is the one place this section departs from the house rule
                 about real hrefs, and it departs from it for the rule's own reason. A game is
                 `?game=<id>` query state on whichever tab is underneath, and seo.ts deliberately
                 canonicalises those back to the tab so that a hundred shared game links do not
                 read as a hundred near-duplicate pages. The rule exists to make routes findable;
                 these are the one thing here that is meant NOT to be indexed separately, and
                 every other game card in the section (GameGrid, the Home rail, the schedule) is
                 a `pressable` for the same reason.
                 `role` is left alone: a `role="button"` on a `tr` takes the row out of the table
                 for a screen reader, so the row keeps its semantics and picks up the keyboard
                 handler instead. */
              <Box
                component="tr"
                key={i}
                {...(r.onOpen ? {
                  onClick: r.onOpen,
                  tabIndex: 0,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onOpen?.() }
                  },
                } : {})}
                sx={r.onOpen ? {
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                  // Inset, because an outline drawn outside a table row is clipped by the
                  // log's own scroller on the two rows that matter most, the first and last.
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                } : undefined}
              >
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', color: 'text.disabled' }}>{r.date}</Box>
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>{r.opp}</Box>
                {r.cells.map((c, j) => {
                  // The accent, which is safe here in a way it was not on the percentile ranks:
                  // every column that can be marked is one where more is better, so the club's
                  // colour can only ever be attached to good news.
                  const top = marks.get(j) != null && Number(c) === marks.get(j)
                  return (
                    <Box component="td" key={j} sx={top ? { ...tdSx, fontWeight: 800, color: accent } : tdSx}>{c}</Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── the modal ───────────────────────────────────────────────────────────────

export default function PlayerDetailModal({ player, teams, games, players, onClose, onOpenGame }: {
  player: WpblPlayer
  teams: WpblTeam[]
  games: WpblGame[]
  /** The full roster, needed to prove a name slug is unambiguous. Empty only during the first
   *  moment of a cold load, which the share URL falls back around. */
  players: WpblPlayer[]
  onClose: () => void
  /** Open a game from the log. The section's `openGame` closes this player as it goes, so
   *  Back walks off the game and lands on her page again, which is the same stack the reverse
   *  trip already builds (a player opened from a game sits on top of it). Optional only so a
   *  log still renders in a harness that has nowhere to send the click. */
  onOpenGame?: (game: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const { basis: eraBasis, fmtEra } = useEraBasis()
  const team = useMemo(() => teams.find(t => t.id === player.team_id), [teams, player.team_id])

  // The same canonical URL the section writes to the address bar when a player page is open
  // (WpblApp's `urlFor`): the readable /wpbl/players/<slug> form, so a copied link matches the
  // bar, is the one Google indexes, and the OG card in ogCard.ts unfurls it as the player
  // rather than the league. Falls back to the legacy ?player=<id> form only while the roster
  // is still loading, since a name slug cannot be proven unique without it (see wpblPlayerSlug)
  // — the same window and the same fallback the address bar uses. Built from the current origin
  // rather than a hardcoded host, so a link copied out of a local or preview build points back
  // at that build instead of sending the reader to production.
  const shareUrl = useMemo(
    () => players.length
      ? `${window.location.origin}${wpblPlayerPath(player, players)}`
      : `${window.location.origin}/wpbl?player=${encodeURIComponent(player.id)}`,
    [player, players])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const color = team ? wpblAccent(team.id, isDark) : '#888'
  // The RAW club colours, for the header band only. Everywhere else on this page uses
  // `color` above, which is the foreground-safe accent.
  const teamPrimary = wpblColor(player.team_id)
  const teamSecondary = wpblSecondary(player.team_id)
  // The wash this club can carry, and its mid-ramp at 60% of it so the gradient keeps its shape
  // whatever the end is. Hex pairs because the colour is a hex string and this is appended to it.
  const wash = BAND_WASH[player.team_id ?? ''] ?? BAND_WASH_FLOOR
  const washEnd = wash.toString(16).padStart(2, '0')
  const washMid = Math.round(wash * 0.6).toString(16).padStart(2, '0')

  const [loading, setLoading] = useState(true)
  const [batting, setBatting] = useState<WpblBattingLine[]>([])
  const [pitching, setPitching] = useState<WpblPitchingLine[]>([])
  const [fielding, setFielding] = useState<WpblFieldingLine[]>([])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])
  // Every batting and pitching line in the league, for the percentile strip. Deliberately a
  // separate piece of state from the player's own lines: this one is allowed to never arrive.
  // `fetchWpblAllLines` is cached, deduped and already prefetched when the section lands on
  // Home, so for most readers this is a cache hit and costs nothing; for the rest the ranks
  // simply appear a moment after the totals, and if it fails they never appear at all and the
  // page is exactly what it was before.
  const [leagueLines, setLeagueLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)
  // Posts that name this player. Seeded from the shared cache so reopening a player is
  // instant, then revalidated. Most players are never written about, and for them the
  // section below simply doesn't render.
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])

  useEffect(() => {
    let cancelled = false
    fetchWpblArticles().then(a => { if (!cancelled) setArticles(a) }).catch(() => { /* keep last-good */ })
    fetchWpblAllLines()
      .then(l => { if (!cancelled) setLeagueLines({ batting: l.batting, pitching: l.pitching }) })
      .catch(() => { /* no ranks; the totals stand on their own */ })
    return () => { cancelled = true }
  }, [])

  // Every official-feed id this player has held. `api_id` alone is only her CURRENT club's
  // id, and the feed mints a new one per club. Keyed on the joined string so a fresh array
  // out of a re-render does not re-fire the fetch.
  const feedKey = [...new Set([...(player.api_ids ?? []), player.api_id].filter(Boolean))].sort().join(',')
  const feedIds = useMemo(() => (feedKey ? feedKey.split(',') : []), [feedKey])

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      setBatting(batting); setPitching(pitching); setFielding(fielding); setLoading(false)
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    // Every id she has held, not just the current one, so a trade does not erase the half of
    // her season she threw under the old club's id.
    setPitchLocs([])
    fetchWpblPitcherLocations(feedIds).then(locs => { if (!cancelled) setPitchLocs(locs) })
    return () => { cancelled = true }
  }, [player.id, feedIds])

  // Only real plate appearances count as batting — a 0-for-0 pinch/defensive cameo shouldn't
  // produce an all-zero batting card or a phantom game-log row.
  const battingReal = useMemo(() => batting.filter(hasPlateAppearance), [batting])
  // The season line is the REGULAR season. The game log below it still lists every game
  // the player appeared in, postseason included: a log is a record of what happened, and
  // hiding games from it would read as missing data rather than as a filtered total.
  const bt = useMemo(() => sumBatting(battingReal, games), [battingReal, games])
  const pt = useMemo(() => sumPitching(pitching, games), [pitching, games])
  const ft = useMemo(() => sumFielding(fielding), [fielding])
  const hasBatting = battingReal.length > 0
  const hasPitching = pitching.length > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)

  const ranks = useMemo(
    () => leagueLines
      ? computeWpblPlayerRanks(player.id, players, teams, games, leagueLines.batting, leagueLines.pitching, eraBasis)
      : null,
    [leagueLines, player.id, players, teams, games, eraBasis])

  // Lead with the skill the player is actually here for. Position codes carry the signal —
  // any pitcher role contains a 'P' (RHP/LHP/P/SP/RP), and no position-player code does — so
  // a "RHP, UTL" leads with pitching even when the box score also shows a few at-bats. When
  // one side is a cameo (a pitcher's stray ABs, a hitter's mop-up inning) it does not earn a
  // tab of its own: it folds into the primary pane as a one-line summary, so genuine two-way
  // players stand apart from occasional-hitting pitchers. Thresholds are absolute (AB / outs)
  // so they hold at any sample size; the whole season is only days old.
  // Deliberately the FILED position, not the played one. This decides which side leads, and a
  // two-way player filed RHP who has spent more games at first is still someone whose pitching
  // is the headline. Relabelling where she stands on the field is a different question from
  // which half of her season to lead with.
  const isPitcherPos = /P/.test(player.position ?? '')
  const pitcherFirst = hasPitching && (!hasBatting || isPitcherPos)
  const BAT_CAMEO_AB = 10, PIT_CAMEO_OUTS = 9
  const battingCameo = pitcherFirst && hasBatting && bt.ab < BAT_CAMEO_AB
  const pitchingCameo = !pitcherFirst && hasPitching && pt.outs < PIT_CAMEO_OUTS
  const twoWay = hasBatting && hasPitching && !battingCameo && !pitchingCameo

  // Sample-size meta for each pane, flagged as thin below a rough one-week-ish bar.
  const BAT_SMALL_AB = 25, PIT_SMALL_OUTS = 30 // < ~25 AB / < 10.0 IP reads as small sample
  const battingMeta = `${bt.g} G · ${bt.ab} AB${bt.ab < BAT_SMALL_AB ? ' · small sample' : ''}`
  const pitchingMeta = `${pt.g} G · ${outsToIp(pt.outs)} IP${pt.outs < PIT_SMALL_OUTS ? ' · small sample' : ''}`

  // The control only exists for a genuine two-way player. Everyone else gets her own numbers
  // with no chrome: a lone pill that cannot be switched away from is worse than no pill.
  const [role, setRole] = useState<Role>(() => (pitcherFirst ? 'pitching' : 'batting'))
  useEffect(() => { setRole(pitcherFirst ? 'pitching' : 'batting') }, [pitcherFirst])
  const selectRole = (v: string, via: 'pill' | 'swipe') => {
    const next = v as Role
    if (next === role) return
    // Whether anyone ever looks at the second role is the question this restructure raises,
    // and the tab is the only place it can be answered. Same argument as `wpbl_game_tab`.
    // `via` splits taps from swipes, which is the only way to know whether the gesture is
    // worth what it costs the layout: the band above had to become pinned chrome to give the
    // pager a definite height to live in.
    track(EVENTS.WPBL_PLAYER_ROLE, { role: next, from: role, via, playerId: player.id })
    setRole(next)
  }

  // Opponent label for a game the player appeared in.
  //
  // `lineTeam` is the club she played THAT game for, off the box-score line, not the one on
  // her roster row. A traded player's old games are still in her log, and reading the current
  // club would ask "was Los Angeles at home?" of a New York game she played in July — neither
  // side matches, so the label falls through to naming her own team and the row reads "@ NY"
  // for a game she played for New York. The line always knows; the roster row only knows now.
  const oppLabel = (gameId: string, lineTeam: string | null): { date: string; text: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '' }
    const forTeam = lineTeam ?? player.team_id
    const isHome = g.home_team_id === forTeam
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return { date, text: `${isHome ? 'vs' : '@'} ${opp?.abbr ?? oppId}` }
  }

  // The lead columns of one game-log row, plus what tapping it does. Every log builds its
  // stat cells itself and takes the rest from here, so the two of them cannot drift on which
  // club a traded player's row is read against (see oppLabel) or on where the row goes.
  const logRow = (gameId: string, lineTeam: string | null) => {
    const g = gameById.get(gameId)
    const o = oppLabel(gameId, lineTeam)
    // No handler for a game the schedule does not hold, rather than a dead row that looks
    // pressable: the log is built from box-score lines and the schedule is fetched separately,
    // so a line can arrive for a game this render has not seen.
    return { date: o.date, opp: o.text, onOpen: g && onOpenGame ? () => onOpenGame(g) : undefined }
  }

  // Box-score lines come back in whatever order the API returns them, which is not
  // chronological, so a game log rendered straight off them reads as shuffled. Sort on the
  // game's real ISO date — not the "Aug 13" label the row displays, which would sort
  // alphabetically and put August after April. Sort is stable, so two games sharing a date
  // (a doubleheader) keep their relative order.
  //
  // NEWEST FIRST, which this was not until Aug 25, 2026. Oldest-first reads down the season
  // the way it was played, and that is the better argument right up until the log is long: at
  // ten games it is a nice narrative and at forty it buries last night at the bottom of a
  // scroll, which is the one row anyone opening a player page in September is looking for. It
  // also decides what the desktop cap shows without scrolling, since that clips the BOTTOM of
  // the list (see GameLogTable), and oldest-first would have spent those thirteen rows on August.
  const newestFirst = <T extends { game_id: string }>(lines: T[]): T[] =>
    [...lines].sort((a, b) => {
      const da = gameById.get(a.game_id)?.game_date ?? ''
      const db = gameById.get(b.game_id)?.game_date ?? ''
      return db.localeCompare(da)
    })

  // Posts naming this player, newest first (the query already orders that way).
  const writtenAbout = useMemo(
    () => articles.filter(a => a.player_ids.includes(player.id)),
    [articles, player.id])

  // The position she has actually been playing, which is not always the one on the roster.
  // `overridden` puts the filed one alongside rather than dropping it: a reader who knows her
  // as the club's catcher should not have to wonder whether we lost her.
  const pos = displayPosition(player.position, batting)
  // Uniform number leads the meta line when the roster carries one (69 of 118 do). It is a
  // fact of identity a reader looks for first, so it goes ahead of position and handedness.
  const subParts = [player.jersey_number ? `#${player.jersey_number}` : null, pos.label, pos.overridden && pos.official ? `listed ${pos.official}` : null, [player.bats, player.throws].filter(Boolean).join('/') ? `B/T ${player.bats || '-'}/${player.throws || '-'}` : null, player.age != null ? `${player.age} yrs` : null].filter(Boolean)

  // ── the two panes ──────────────────────────────────────────────────────────

  /**
   * The headline pair for a role, in either of the two places it can live: the club band on a
   * desktop dialog, or the top of the pane on anything narrower. Same numbers either way, so
   * they are built once here rather than written twice and left to drift apart.
   */
  const heroBlock = (r: Role, onDark: boolean) => r === 'pitching' ? (
    // ERA leads and WHIP follows, on the same reasoning as OPS over AVG: ERA is the number
    // anyone asks for and WHIP is the one that says whether it is real.
    <>
      <HeroStat value={fmtEra(pt.era)} label="ERA" primary onDark={onDark}
        rank={ranks?.pitching.find(x => x.key === 'era')} />
      <HeroStat value={fmtTwo(pt.whip)} label="WHIP" onDark={onDark}
        rank={ranks?.pitching.find(x => x.key === 'whip')} />
      <SampleLine onDark={onDark} text={`${pitchingMeta} · ${pt.w}-${pt.l}${pt.s > 0 ? ` · ${pt.s} SV` : ''}`} />
    </>
  ) : (
    // OPS leads and AVG follows. OBP and SLG are still one tap down in the strip and still in
    // the grid; they do not need hero weight when the number above them is their sum. And no
    // "4-for-26": that is H and AB, both already on this line and in the grid below.
    <>
      <HeroStat value={fmtRate(bt.ops)} label="OPS" primary onDark={onDark}
        rank={ranks?.batting.find(x => x.key === 'ops')} />
      <HeroStat value={fmtRate(bt.avg)} label="AVG" onDark={onDark}
        rank={ranks?.batting.find(x => x.key === 'avg')} />
      <SampleLine onDark={onDark} text={battingMeta} />
    </>
  )

  /** The pane's own copy of the hero, which stands down at `lg` where the band is showing it.
   *
   *  Width-capped, and that is the whole point of the wrapper. The rank is right-aligned with
   *  `ml: auto`, which is right in the band's 216px box and wrong the moment the hero has a
   *  whole pane to spread across: on a 412px phone it put 189px of nothing between "OPS" and
   *  "1st of 33", so the two read as unrelated things at opposite ends of the sheet rather than
   *  as one fact about her. Capped, they stay a group, and the two rows still align on the
   *  right edge because the cap is shared. Same width as the band's copy, deliberately.
   *
   *  CENTRED, because capping it alone only moved the problem. A 216px group left-aligned in a
   *  378px pane leaves all 162px of the slack on one side, under a stat grid and a percentile
   *  strip that both run the full width, so the headline reads as shunted into the corner of a
   *  block it is supposed to be the top of. Centred it has an axis: the slack is 81px a side,
   *  and the grid's own columns below are symmetric about the same line. The band's copy is NOT
   *  centred and should not be: there it is one half of a two-part row, and its axis is the
   *  right edge it shares with the card. */
  const paneHero = (r: Role) => (
    <Box sx={{ mb: 1.75, maxWidth: HERO_BLOCK_W, mx: 'auto', display: { xs: 'block', lg: 'none' } }}>{heroBlock(r, false)}</Box>
  )

  // Each pane in two halves, because a desktop dialog puts them side by side: `season` is what
  // is true about her year, `log` is the record of the games it came out of. On anything
  // narrower they simply stack in this order and nothing about the reading changes.
  const battingPane = {
    hasLog: battingReal.length > 0,
    season: (
      <>
        {paneHero('batting')}
        {/* G and AB are on the sample line above, so they are not repeated here. */}
        <StatGrid items={[['R', bt.r], ['H', bt.h], ['2B', bt.doubles], ['3B', bt.triples], ['HR', bt.hr], ['RBI', bt.rbi], ['BB', bt.bb], ['SO', bt.so], ['SB', bt.sb], ['TB', bt.tb]]} />
        {pitchingCameo && (
          <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', mt: 1.5, fontVariantNumeric: 'tabular-nums' }}>
            <Box component="span" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem', mr: 0.75 }}>Also pitched</Box>
            {fmtEra(pt.era)} ERA over {outsToIp(pt.outs)} IP, {pt.so} K
          </Typography>
        )}
        {ranks && (ranks.batReason === 'ok'
          ? <PercentileStrip ranks={ranks.batting} of={ranks.batOf} color={color} noun="batters" />
          : <NoRanks reason={ranks.batReason} />)}
      </>
    ),
    log: (
      <GameLogTable
        title="Game log"
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB', 'TB']}
        best={BATTING_BEST}
        accent={color}
        rows={newestFirst(battingReal).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [gamePosition(l.position), l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.bb, l.so, l.sb, l.tb] }))}
      />
    ),
  }

  const pitchingPane = {
    hasLog: pitching.length > 0 || pitchLocs.length > 0,
    season: (
      <>
        {paneHero('pitching')}
        {/* G and IP are on the sample line above. */}
        <StatGrid items={[['H', pt.h], ['R', pt.r], ['ER', pt.er], ['BB', pt.bb], ['SO', pt.so], ['HR', pt.hr]]} />
        {battingCameo && (
          <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', mt: 1.5, fontVariantNumeric: 'tabular-nums' }}>
            <Box component="span" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem', mr: 0.75 }}>Also batted</Box>
            {fmtRate(bt.avg)}/{fmtRate(bt.obp)}/{fmtRate(bt.slg)}, {bt.h}-for-{bt.ab}{bt.hr ? `, ${bt.hr} HR` : ''}
          </Typography>
        )}
        {ranks && (ranks.pitReason === 'ok'
          ? <PercentileStrip ranks={ranks.pitching} of={ranks.pitOf} color={color} noun="pitchers" />
          : <NoRanks reason={ranks.pitReason} />)}
      </>
    ),
    log: (
      <>
        {pitchLocs.length > 0 && (
          <Box sx={{ mt: 2 }}><PitchLocationCard rows={pitchLocs} accent={color} gamesPitched={pt.g} /></Box>
        )}
        {/* No POS column here, unlike the batting log: a pitching line's position is 'p'
            in every row of every pitcher's season. */}
        <GameLogTable
          title="Game log"
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'P']}
          best={PITCHING_BEST}
          accent={color}
          rows={newestFirst(pitching).map(l => ({ ...logRow(l.game_id, l.team_id), cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.bb, l.so, l.hr, l.pitches ?? '—'] }))}
        />
      </>
    ),
  }

  const showTabs = twoWay
  // The band only takes the hero once there is a hero to take: not while the lines are still
  // in flight, and never for a fielding-only cameo, whose empty batting totals would put a
  // .000 OPS on the card as though it were a fact about her.
  const showBandHero = !loading && (hasBatting || hasPitching)
  // The pager's index space, primary role first. A two-way player gets both panes; everyone
  // else gets exactly one, which is what keeps a lone unswitchable pill off the page. A
  // one-panel pager is not a special case: it simply has no neighbour to reach, so a sideways
  // drag rubber-bands and lets go, which is the same answer the tab bar gives.
  const roles: Role[] = twoWay
    ? (pitcherFirst ? ['pitching', 'batting'] : ['batting', 'pitching'])
    : [pitcherFirst ? 'pitching' : 'batting']
  const roleIndex = Math.max(0, roles.indexOf(role))
  // Fielding and the reading list belong to the PLAYER, not to a role, so they ride inside
  // whichever pane is on screen rather than sitting under the pager: a block below the panes
  // would be pinned chrome at the bottom of the sheet, and a block in only the primary pane
  // would hide a catcher's fielding line behind a tab.
  //
  // TWO COLUMNS AT lg, and why not sooner (Aug 25, 2026). Every measurement behind this page
  // was taken on a 375px phone, and desktop was simply rendering that column with ~800px of
  // empty screen either side: 1143px of stacked content in a 640px box, of which a laptop
  // shows about a third at a time. Side by side the same content is ~600px tall and needs no
  // scrolling at all.
  //
  // `lg` rather than `md` because the WPBL section runs under a 1.4x `zoom` on desktop (see
  // DESKTOP_ZOOM in mlb/constants). A media query is answered in real viewport pixels, so
  // `md` means 900px of screen but only 643px of layout to spend inside the zoom, which is
  // narrower than the single column already is. `lg` is ~860px of layout, the first width
  // where two real columns beat one. Anything below it is untouched, phone included.
  //
  // Season facts left, the record of the games right. That is also the split that keeps the
  // growing half on its own: the game log gains a row a day until Sep 6, and the left rail
  // does not grow at all.
  const panels = roles.map(r => {
    const pane = r === 'pitching' ? pitchingPane : battingPane
    // No second column without something to put in it. Only reachable by a player with no
    // game log at all, which is a fielding-only cameo. The reading list is not a reason for
    // one: it spans both columns either way.
    const twoCol = pane.hasLog
    return (
      <Box key={r} sx={{ px: 2, pt: 2, pb: 2 }}>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: twoCol ? { xs: '1fr', lg: `minmax(0, ${LEFT_RAIL}px) minmax(0, 1fr)` } : '1fr',
          columnGap: 2.5,
          alignItems: 'start',
          // A lone column stretched across a desktop dialog reads as a stat line pulled to fit
          // rather than as a column, so it keeps a measure of its own.
          ...(twoCol ? {} : { maxWidth: { lg: 560 } }),
        }}>
          <Box sx={{ minWidth: 0 }}>
            {pane.season}
            {/* Fielding sits with the other season facts, which is where it belongs and where
                it can be seen: under the game log it was 1100px down the phone's scroll and
                below the fold on every desktop. */}
            {hasFielding && <FieldingLine ft={ft} color={color} />}
          </Box>
          {/* The right rail's first block carries a top margin for the stacked layout, where it
              follows the season facts. Alongside them it has to start level with them instead. */}
          <Box sx={{ minWidth: 0, '& > :first-of-type': { mt: { lg: 0 } } }}>
            {pane.log}
          </Box>
          {/* The reading list runs UNDER both columns rather than inside one of them. It is the
              one block here that is neither a season fact nor a game, its length is set by how
              often someone happened to write about her, and in the right rail a well-covered
              player put 346px of article cards against a 337px left rail: the columns ended
              360px apart, which is most of a screen of empty page beside the fielding line.
              Full width it is also two cards across instead of five very wide ones.

              Rendered even for a player with no line yet (see the no-stats branch below):
              someone who has been written about but has not logged a game is exactly the case
              where this is the most interesting thing on the page. Renders nothing when nobody
              has written about her, which is most of the roster. */}
          <Box sx={{ minWidth: 0, gridColumn: { lg: '1 / -1' } }}>
            <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} wide />
          </Box>
        </Box>
      </Box>
    )
  })

  return (
    <ModalShell
      eyebrow={team ? wpblFullName(team) : 'Player'}
      onClose={onClose}
      // Wide enough at `lg` for the two-column pane below, and unchanged everywhere else. It
      // is a fixed pair rather than a value derived from the content so the dialog cannot
      // resize under the reader as the season totals land.
      maxWidth={{ xs: 640, lg: 840 }}
      zIndex={1600}
      actions={<CopyLinkButton url={shareUrl} title={`Copy a link to ${player.name}`} />}
      // A sheet on a phone, like Game Center: this opens from a roster row, a leaderboard, a
      // Home chip and a shared link, and its only way out was the close button in the far top
      // corner. Now it comes up from the bottom edge with a handle and swipes back down.
      // Unchanged above sm, where a centred dialog is right.
      sheet
      // Constant height while it is a sheet, so it does not leap up the screen when the season
      // totals and game logs finish loading under the reader's thumb. Same reason as the game
      // card, whose box score lands the same way.
      sheetFill
    >
      {/* Two sizings, because the sheet and the dialog are shaped differently, and the same
          arrangement the game card uses for the same reason.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each role pane scroll itself and what
          gives the pager a slot to live in at all.
          Above sm the modal is content-height on purpose, so a short player sizes it down
          instead of forcing full height, and this is clamped rather than filled. `flex: 1`
          there would collapse the pane to nothing, since a flex item with a zero basis
          contributes nothing to an auto-height parent. */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
      {/* Identity, on the club's own colours.
          This was a white block with a 4px accent spine down the left, which is the least a
          team colour can do. The band takes the club's PRIMARY as its background: all four
          WPBL primaries are near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), so
          white text clears 12:1 on every one of them and the wash of secondary across the
          right stays well under the point where it would stop being readable. The stripe along
          the bottom is the secondary at full strength, which is where each club's actual hue
          lives: orange, gold, sky, red. It carries the same 2px as the ring around the
          portrait sitting on it, deliberately, so the band reads as one object drawn in one
          weight rather than as a photo with a heavier rule under it.
          Deliberately NOT `wpblAccent`: that is the foreground-safe variant, built to be read
          as text on the page background. Here the colour IS the background. */}
      {/* `data-sheet-drag` makes this band the sheet's grab surface on a phone, and it is not
          decoration: the redesign pushed this page past the height of the sheet, so its body
          is a real scroller now, and a scroller takes ownership of a touch before the drag
          handler can. That left the 36x4px handle and the eyebrow bar as the only places a
          reader could actually pull the card back down. The band is the obvious thing to grab
          and the one block here nobody scrolls to READ, which is exactly the trade the
          attribute is for. See useSheetDrag. */}
      {/* Pinned, not scrolled away with the stats, and that is what the swipe cost: the pager
          below needs a definite height, so the band had to come out of the scroller. It pays
          for itself twice over. Whose numbers these are stays on screen at any depth, and the
          sheet's grab surface never scrolls out of reach. */}
      <Box data-sheet-drag sx={{
        position: 'relative', flexShrink: 0,
        // The secondary washes OVER an opaque primary rather than being the last stop of a
        // gradient that runs out of colour. As a plain gradient the right-hand end was
        // `secondary` at 25% alpha over whatever sat behind the card, which in light mode is
        // white, so the band faded to near-white exactly where the hero numbers now sit. This
        // keeps every point on the band dark enough for white text, and as a side effect the
        // club's actual hue is finally visible in light mode instead of washing out.
        //
        // MORE OF THE CLUB, LESS OF THE BLACK. The wash used to hold the flat primary to 42%
        // and reach only 25% secondary at the far edge, which left a band reading as black with
        // a hint of something in one corner rather than as the club's colours. It starts at 26%
        // now and ramps to whatever that club can carry. See BAND_WASH for what sets the number.
        backgroundColor: teamPrimary,
        backgroundImage: `linear-gradient(105deg, transparent 0%, transparent 26%, ${teamSecondary}${washMid} 62%, ${teamSecondary}${washEnd} 100%)`,
        borderBottom: `2px solid ${teamSecondary}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 }, p: { xs: 1.75, sm: 2.25 } }}>
          {/* A rounded square rather than a circle, and bigger. A circle crops a
              head-and-shoulders portrait to the face; at this size there is room for the
              shoulders and the uniform, which is most of what makes a player recognisable. */}
          {/* One size at every width, deliberately. This was a `useMediaQuery` picking 92 on
              desktop and 76 on a phone, which is a JS media query: it does not re-render on a
              live window resize the way the CSS breakpoints on this same band do, so dragging a
              desktop window under 600px left a 92px portrait next to phone-sized padding until
              the next navigation. 84 reads well at both, and the band's padding and type still
              step at `sm` where CSS can do it properly. */}
          <PlayerPortrait name={player.name} teamId={player.team_id} square size={84} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              {/* The page's <h1>. A player page is a modal over a tab but it is a real page
                  with its own URL and title, and the tab underneath stops rendering an h1
                  while this is open; see PageHeading.tsx. */}
              <Typography component="h1" sx={{ fontSize: { xs: '1.2rem', sm: '1.4rem' }, fontWeight: 800, lineHeight: 1.15, color: '#fff', m: 0 }}>
                {player.name}
              </Typography>
              {twoWay && (
                // White on a translucent white wash rather than the club's secondary: SF's red
                // on SF's purple measures about 3.5:1, which is thin for a badge and would be
                // the one club whose label is harder to read than the other three.
                <Box sx={{ flexShrink: 0, px: 0.85, py: 0.2, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Two-way
                </Box>
              )}
            </Box>
            {subParts.length > 0 && (
              <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.88)', mt: 0.25 }}>{subParts.join(' · ')}</Typography>
            )}
            {/* Two lines, not one run-on. Joined with a separator the draft wrapped mid-phrase
                behind a long hometown, so "Round 3, Pick 12" broke across lines with the city
                and read as part of the address. They are also separate FACTS: the draft line
                now shows for a player with no hometown on file, which the old single line
                gated away by accident. */}
            {/* 0.75, not the 0.62 these were: the band carries far more of the club's hue than
                it did (see the gradient above), and at 0.62 these two lines fell to 3.7:1 over
                New York's sky blue. They are the smallest text on the card and the first thing
                a stronger wash costs. */}
            {player.hometown && (
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', mt: 0.1 }}>
                {player.hometown}
              </Typography>
            )}
            {player.draft_round && (
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', mt: 0.1 }}>
                Round {player.draft_round}, Pick {player.draft_pick}
              </Typography>
            )}
          </Box>
          {/* The headline numbers, on the band, at the width where the band has room for them.
              This gradient used to run most of the way across to nothing: a club colour with a
              portrait at one end and empty space at the other, while the two numbers a reader
              opened the page for sat below it in the scroller. They belong on the card that
              names her, and moving them takes ~80px off the top of the pane besides.

              Below `lg` the band is only wide enough for the name, so they stay in the pane
              (see `paneHero`) and this renders nothing. The role is the one on screen, so a
              two-way player's band follows her tab. */}
          {showBandHero && (
            <Box sx={{ display: { xs: 'none', lg: 'block' }, width: HERO_BLOCK_W, flexShrink: 0 }}>
              {heroBlock(roles[roleIndex], true)}
            </Box>
          )}
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !hasBatting && !hasPitching && !hasFielding ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
          <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
          </Box>
          <WrittenAbout articles={writtenAbout} title={`Written about ${player.name}`} />
        </Box>
      ) : (
        <>
          {showTabs && (
            /* The pinned strip the role pills live in, and its padding is not arbitrary: it
                matches Game Center's tab bar, which is the same control doing the same job over
                the same kind of pager.
                It was `pt: 2, pb: 0`, which is backwards on both counts. The pill belongs to the
                chrome ABOVE it, not to the pane below, and with no bottom padding its edge sat
                flush against the scroller's clip line: on a phone, scrolled, that put a row of
                stat chips sliced through the middle directly under the control with nothing
                between them, which reads as a broken layout rather than as content that
                continues. The 16px it was spending above bought nothing on a sheet that has
                none to spare. */
            <Box sx={{ flexShrink: 0, px: 2, pt: 0.75, pb: 1 }}>
              <SegNav
                options={roles.map(r => ({ value: r, label: r === 'pitching' ? 'Pitching' : 'Batting' }))}
                value={role}
                onChange={v => selectRole(v, 'pill')}
                accent={color}
                mb={0}
              />
            </Box>
          )}
          {/* The two roles page under a finger, the same gesture and the same component as the
              game card's tabs (`mode="pane"`, because this is a modal with a locked body and an
              inner scroller rather than the window-scrolled page the pager was first built for).
              Two panes is exactly where a swipe is worth having: the tab bar is a 40px target
              at the top of a sheet, and the thing a reader wants to compare is the other half of
              the same player.
              A role is mounted the first time it is shown and then kept, which is the pager's
              own trade: a remount mid-swipe re-shapes a whole game log and a pitch-location plot
              in the frame the finger is moving, and that stutter is the one thing that makes a
              finger-tracked pager feel broken. An unvisited role still costs nothing. */}
          <SwipeableViews
            mode="pane"
            index={roleIndex}
            onIndexChange={i => selectRole(roles[i], 'swipe')}
            panels={panels}
          />
        </>
      )}
      </Box>
    </ModalShell>
  )
}

// The left rail at `lg`. Set by what is left for the game log beside it, not by what the rail
// itself wants: the widest log is the hitting line, which measures ~440px once POS joins it,
// and 320 leaves it ~453. Any wider here and the table falls back to its horizontal scroll on
// a desktop dialog, which is the one place there is plainly room for it not to.
const LEFT_RAIL = 320
/**
 * How much of each club's secondary the band's wash reaches at its far edge, 0-255.
 *
 * PER CLUB, because one number gave four different results. A single 40% looked right on New
 * York's pale sky blue and left Boston's orange looking like a rumour: the four secondaries have
 * nothing like the same luminance, so the same alpha over four different near-black primaries is
 * four different amounts of visible colour.
 *
 * WHAT SETS EACH NUMBER. White text has to clear 4.5:1 against the strongest point of the wash,
 * and the binding case is always the smallest text sitting in it: the hometown and draft lines
 * at 0.75, and on desktop the band hero's stat label at 0.80 and its sample line at 0.76. Each
 * value below is the largest that clears that with a step of headroom, and they measure:
 *
 *   BOS 0x7a (48%) 4.80:1 · LA 0x98 (60%) 4.78:1 · NY 0x61 (38%) 4.84:1 · SF 0x8f (56%) 4.89:1
 *
 * The ceilings before headroom are 51 / 62 / 41 / 61 percent, so there is not much left in any of
 * them. LA was the outlier at 0x8f/5.12, a good half-step short of its own ceiling and so visibly
 * less gold than the other three clubs are their colour; 0x98 lands it on the same ~4.8 as BOS and
 * NY, which is what "a step of headroom" is worth here. It is now within three points of failing:
 * 0xa0 (63%) measures 4.50 and does not clear.
 *
 * Change a club's colours in constants.ts, or lift the wash, and these have to be re-solved
 * against those three text opacities, or the smallest lines on the card quietly stop being
 * readable on one club and nobody reports it.
 */
const BAND_WASH: Record<string, number> = { BOS: 0x7a, LA: 0x98, NY: 0x61, SF: 0x8f }
/** For a club not in the table: the tightest of the four, which is safe for any secondary. */
const BAND_WASH_FLOOR = 0x61

// The hero's own measure, wherever it is drawn: the 104px number column, its label, and a
// right-aligned "1st of 33", with about 27px between the label and the rank. One constant for
// the band and the pane both, because it is the same object at both sizes and the number that
// looks right in the band is the number that looks right in the pane. See paneHero for what
// goes wrong without it.
const HERO_BLOCK_W = 216
// About thirteen rows, which is a little over the tallest the left rail gets. See GameLogTable.
const LOG_MAX_H = 440

const sectionSx = { fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 } as const

// Game-log table cells. Headers are compact uppercase; body cells are tabular so columns
// stay aligned down the table. Both center-align (numeric); the Date/Opp lead columns
// override to left in the component. Horizontal padding is responsive — see GameLogTable.
//
// The header row pins, for the capped desktop log (see GameLogTable). Two details it needs:
// an opaque background, or the rows scroll THROUGH it rather than under it, and its rule drawn
// as an inset shadow rather than a border, because a `border-collapse: collapse` table hands
// its cell borders to the row boundary and a sticky cell leaves them behind. Harmless where
// the log is not capped: a sticky cell in a container that never scrolls never moves.
const thSx = {
  fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', py: 0.6, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: (t: Theme) => `inset 0 -1px 0 ${t.palette.divider}`,
} as const
const tdSx = { fontSize: { xs: '0.74rem', sm: '0.8rem' }, fontWeight: 600, py: 0.55, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const
