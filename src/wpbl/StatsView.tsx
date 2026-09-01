import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameCount,
  getCachedWpblAllPlayers, getCachedWpblAllLines, wpblStatsCacheAgeMs,
} from './api'
import { trackingWorthShowing } from './tracking'
import { WPBL_ACCENT, outsToIp, wpblFullName } from './constants'
import {
  TeamBadge, PlayerPortrait, ModalShell, SectionLabel, PillGroup, ExpandRow, NewDot,
  CARD_BORDER, pressable, FOCUS_RING, useWpblName,
} from './ui'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, wpblQualifiers, plateAppearances,
  kRateLabel, scaleToBasis, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'
import type { EraBasis } from './stats'
import { track, EVENTS } from '../lib/analytics'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'
import { useWpblPlayerLink, type WpblPlayerLinkProps } from './LinkContext'
import { useWpblHeadingTag } from './PageHeading'
import { useEraBasis } from './EraBasisContext'
// Two of the five Stats groups, behind their own chunks. Hitting and Pitching are what the
// tab opens on; Tracking (the TrackMan boards) and Draft (the draft-value model) are each a
// separate sub-tab with its own layout and neither is reachable without a deliberate tap.
const WpblTrackingView = lazy(() => import('./TrackingView'))
const WpblPitchView = lazy(() => import('./PitchView'))
const WpblRunValueView = lazy(() => import('./RunValueView'))
const WpblFindingsView = lazy(() => import('./FindingsView'))
const WpblDraftValue = lazy(() => import('./DraftValue'))

// Complete season stat table for the WPBL — a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

// Rate-stat qualifiers come from stats.ts (`wpblQualifiers`) and scale with the season —
// single-sourced with the Home leader boards so the two can't drift apart.

// This tab has two independent axes, not one list of four tabs.
//
// `side` is which half of the game you're looking at. It's the reader's main choice and it
// outlives everything else: the season table splits on it, and so do the tracked boards.
// TrackingView used to carry its own Hitting/Pitching switch, which meant the same question
// was being asked twice one level apart — the clearest sign these were never four peers.
//
// `source` is where the numbers come from: the box scores we aggregate all season, the
// play-by-play read one pitch at a time, or the feed's TrackMan radar. Switching it keeps your
// side, so "Pitching → Tracked" reads as the same subject measured another way rather than a
// jump somewhere else.
//
// Ordered by how much of the season each one can speak for: Season (every game), Pitch by
// pitch (every game, one row deeper), Tracked (two games, and hidden until that changes; see
// trackingWorthShowing). The pitch board used to sit in the middle chip labelled "Pitches",
// which collided with the SIDE named Pitching one row above it: with Hitting selected, a chip
// called Pitches read as "you are about to leave the hitters", which is the opposite of what
// it does. The internal value stays 'pitches' so the board-usage analytics keep one name
// across the rename.
//
// 'draft' sits on neither axis on purpose: it's a one-off analysis of the draft class that
// spans both sides at once, so it's reached from a card under the table instead.
type Side = 'hitting' | 'pitching'
type Source = 'season' | 'tracked' | 'pitches' | 'runs' | 'findings' | 'draft'
type Mode = 'players' | 'teams'

// The deep-link contract, unchanged — Home's leader cards ask for 'hitting'/'pitching' with a
// column, and a legacy ?view=tracking URL asks for 'tracking'. Resolved onto the axes above.
type Group = 'hitting' | 'pitching' | 'tracking' | 'pitches' | 'runs' | 'findings' | 'draft'

// Whether this page-load has already logged an arrival at Stats. Module scope rather than a
// ref inside the component, because the pager unmounts the pane on the way out of the tab:
// a component-scoped flag is born false on every visit, which would call all of them 'open'
// and leave the two names measuring nothing.
let statsOpened = false

// A tracking link names no side, so it lands on whichever one the reader already had open.
function axesOf(g: Group): { side?: Side; source: Source } {
  if (g === 'tracking') return { source: 'tracked' }
  if (g === 'pitches') return { source: 'pitches' }
  if (g === 'runs') return { source: 'runs' }
  if (g === 'findings') return { source: 'findings' }
  if (g === 'draft') return { source: 'draft' }
  return { side: g, source: 'season' }
}

interface Col<T> {
  key: string
  label: string
  value: (t: T) => number | null      // sort value (null = sorts to the bottom)
  display?: (t: T) => string          // cell text (defaults to the value)
  rate?: boolean                      // rate stat → dash when null, eligible for the qualified filter
  lowerBetter?: boolean               // ERA/WHIP sort ascending by default
}

// Columns are ordered headline → secondary (not raw box-score order), so the stats a fan
// actually scans sit up front. With the sort column pinned on mobile, this is also the
// left-to-right scroll order right after it: slash line, then power/production, then the
// peripheral/volume tail (AB, G) last.
const HIT_COLS: Col<WpblBattingTotals>[] = [
  { key: 'avg', label: 'AVG', value: t => t.avg, display: t => fmtRate(t.avg), rate: true },
  { key: 'obp', label: 'OBP', value: t => t.obp, display: t => fmtRate(t.obp), rate: true },
  { key: 'slg', label: 'SLG', value: t => t.slg, display: t => fmtRate(t.slg), rate: true },
  { key: 'ops', label: 'OPS', value: t => t.ops, display: t => fmtRate(t.ops), rate: true },
  { key: 'hr',  label: 'HR',  value: t => t.hr },
  { key: 'rbi', label: 'RBI', value: t => t.rbi },
  { key: 'r',   label: 'R',   value: t => t.r },
  { key: 'h',   label: 'H',   value: t => t.h },
  { key: 'sb',  label: 'SB',  value: t => t.sb },
  // CS beside SB, because a steal total on its own cannot say whether the running was any
  // good, and this league runs constantly. Same reason the Findings board prices it.
  { key: 'cs',  label: 'CS',  value: t => t.cs },
  { key: '2b',  label: '2B',  value: t => t.doubles },
  { key: '3b',  label: '3B',  value: t => t.triples },
  { key: 'tb',  label: 'TB',  value: t => t.tb },
  { key: 'bb',  label: 'BB',  value: t => t.bb },
  { key: 'so',  label: 'SO',  value: t => t.so },
  // The rest of the trips to the plate that AB does not count. All four arrive on every line
  // and were shown nowhere: HBP is 54 of them this season, GDP 28, and the two sacrifices
  // are how a bunt or a fly ball shows up at all.
  { key: 'hbp', label: 'HBP', value: t => t.hbp },
  { key: 'gdp', label: 'GDP', value: t => t.gdp },
  { key: 'sf',  label: 'SF',  value: t => t.sf },
  { key: 'sh',  label: 'SH',  value: t => t.sh },
  // Trips to the plate, and the unit the qualifier is set in. See `plateAppearances`.
  { key: 'pa',  label: 'PA',  value: t => plateAppearances(t) },
  { key: 'ab',  label: 'AB',  value: t => t.ab },
  { key: 'g',   label: 'G',   value: t => t.g },
]

const PIT_COLS: Col<WpblPitchingTotals>[] = [
  { key: 'era',  label: 'ERA',  value: t => t.era,  display: t => fmtTwo(t.era),  rate: true, lowerBetter: true },
  { key: 'whip', label: 'WHIP', value: t => t.whip, display: t => fmtTwo(t.whip), rate: true, lowerBetter: true },
  { key: 'w',    label: 'W',    value: t => t.w },
  { key: 'l',    label: 'L',    value: t => t.l },
  { key: 'sv',   label: 'SV',   value: t => t.s },
  { key: 'so',   label: 'SO',   value: t => t.so },
  { key: 'ip',   label: 'IP',   value: t => t.outs, display: t => outsToIp(t.outs) },
  { key: 'h',    label: 'H',    value: t => t.h },
  { key: 'r',    label: 'R',    value: t => t.r },
  { key: 'er',   label: 'ER',   value: t => t.er },
  { key: 'bb',   label: 'BB',   value: t => t.bb },
  { key: 'hr',   label: 'HR',   value: t => t.hr },
  { key: 'hbp',  label: 'HBP',  value: t => t.hbp },
  { key: 'wp',   label: 'WP',   value: t => t.wp },
  { key: 'bk',   label: 'BK',   value: t => t.bk },
  // How much work the outing WAS, as opposed to what it gave up. Every one of these is on
  // the feed's line and none of them was summed anywhere before Aug 27: the board could say
  // a pitcher allowed two runs and not that she faced nine batters or threw ninety pitches.
  { key: 'kbb',  label: 'K/BB', value: t => t.kbb, display: t => fmtTwo(t.kbb), rate: true },
  { key: 'strikePct', label: 'STR%', value: t => t.strikePct,
    display: t => (t.strikePct == null ? '—' : `${Math.round(t.strikePct * 100)}%`), rate: true },
  { key: 'bf',   label: 'BF',   value: t => t.bf },
  { key: 'p',    label: 'P',    value: t => t.pitches },
  { key: 'gs',   label: 'GS',   value: t => t.gs },
  { key: 'g',    label: 'G',    value: t => t.g },
]

// Resolve a requested column into the sort state the table should adopt. Direction comes from
// the column itself (`lowerBetter` → ascending, so ERA/WHIP lead with the best), which is why
// a leader card only has to name a column and never a direction. An unknown or absent key
// falls back to the group's headline column — the first in each list.
function defaultSort(side: Side, key?: string): { key: string; asc: boolean } {
  const cols: Col<never>[] = (side === 'pitching' ? PIT_COLS : HIT_COLS) as unknown as Col<never>[]
  const col = (key ? cols.find(c => c.key === key) : undefined) ?? cols[0]
  return { key: col.key, asc: !!col.lowerBetter }
}

// What each abbreviation stands for, for the stat picker. A sheet that offers "SLG, OPS, OPS+"
// and nothing else is a vocabulary test, and this section's audience is two months old: the
// point of the picker is that a reader who knows what an RBI is can find their way around it.
//
// Per side, because the same three letters are two different stats depending on who is being
// measured. SO is a batter's failure and a pitcher's work; H, R and HR are things a hitter
// does and things a pitcher allows. Writing "Strikeouts" for both would be the sort of nearly
// right that reads as carelessness to anyone who follows the sport.
const HIT_NAMES: Record<string, string> = {
  avg: 'Batting average', obp: 'On-base', slg: 'Slugging', ops: 'On-base plus slugging',
  opsPlus: 'OPS vs the league', hr: 'Home runs', rbi: 'Runs batted in', r: 'Runs', h: 'Hits',
  sb: 'Stolen bases', cs: 'Caught stealing', '2b': 'Doubles', '3b': 'Triples',
  tb: 'Total bases', bb: 'Walks', so: 'Strikeouts', hbp: 'Hit by pitch',
  gdp: 'Grounded into a double play', sf: 'Sacrifice flies', sh: 'Sacrifice bunts',
  pa: 'Plate appearances', ab: 'At-bats', g: 'Games',
}
const PIT_NAMES: Record<string, string> = {
  era: 'Earned run average', whip: 'Walks + hits per inning', eraPlus: 'ERA vs the league',
  w: 'Wins', l: 'Losses', sv: 'Saves', so: 'Strikeouts', ip: 'Innings pitched',
  h: 'Hits allowed', r: 'Runs allowed', er: 'Earned runs', bb: 'Walks',
  hr: 'Home runs allowed', hbp: 'Batters hit by a pitch', wp: 'Wild pitches', bk: 'Balks',
  kbb: 'Strikeouts per walk', strikePct: 'Share of pitches thrown for strikes',
  bf: 'Batters faced', p: 'Pitches thrown', gs: 'Games started', g: 'Games',
}

/** A column's text for one row. Was written out three times: the pinned cell, the scrolling
 *  cell and now the list, which have to agree or the same number reads differently depending
 *  on where you are looking at it from. */
function cellText<T>(c: Col<T>, t: T): string {
  const v = c.value(t)
  return c.display ? c.display(t) : (c.rate ? fmtRate(v) : String(v ?? 0))
}

// The stats a list row carries under the name, in preference order, minus whichever one is
// already the big number on the right. Three of them fit a 375px row.
//
// TWO LISTS, PICKED BY WHAT THE BOARD IS RANKED ON, because the question the line has to answer
// changes with it. Ranked by a RATE, the first thing missing is how much of a season it was
// measured over: .500 off nine trips to the plate and .500 off ninety are not the same claim,
// so the line leads with PA (or innings, for a pitcher) and follows with what she did with
// them. Ranked by a COUNTING stat, volume is already the big number on the right and repeating
// it teaches nobody anything, so the line spends itself on the rates instead: eight home runs
// beside a .658 average and a 1.998 OPS is a season in one row.
//
// They are the stats a fan would ask for unprompted, not the ones the table happens to start
// with: a row that says "12 HR" is worth more than one that says ".412 OBP", even though OBP
// is the better stat, because this line is here to identify a season rather than to rank it.
const CONTEXT_KEYS: Record<Side, { rate: string[]; counting: string[] }> = {
  hitting: {
    rate: ['pa', 'hr', 'rbi', 'ops', 'avg'],
    counting: ['avg', 'rbi', 'ops', 'hr', 'pa'],
  },
  pitching: {
    rate: ['ip', 'w', 'so', 'era', 'whip'],
    counting: ['era', 'whip', 'ip', 'so'],
  },
}

// How much of the list a phone gets before it asks. Ten is a leaderboard; thirty-four is a
// directory, and the difference matters more than the rows do: everything UNDER the list (the
// switch to the full grid, the count, the draft-value card) was two thousand pixels down, so
// in practice nobody found it. A capped list puts the whole board and everything it offers on
// one screen and a bit, and the reader who wants the other twenty-four asks for them.
const LIST_CAP = 10

// Phones get the ranked list; this is the escape hatch for the reader who wants the grid
// anyway, remembered because it is a preference about how someone reads rather than a state
// of the page. Off by default: see the list itself for why.
const FULL_TABLE_KEY = 'wpbl_stats_full_table'
function readFullTable(): boolean {
  try { return localStorage.getItem(FULL_TABLE_KEY) === '1' } catch { return false }
}

// One table row — normalized so the same table renders a player or a whole team.
interface Row {
  key: string
  team: WpblTeam | undefined       // for the badge (a player's club, or the team itself)
  label: string                    // player short name, or full team name
  /** The player's name as the league spells it. `label` is already abbreviated to fit the
   *  table's 84px name column, and the portrait lookup is keyed on the real one. */
  fullName?: string
  shortLabel?: string              // teams mode on a phone: the nickname alone ('Firebells')
  sublabel?: string                // player position (players only)
  totals: WpblBattingTotals | WpblPitchingTotals
  qualified: boolean
  onClick?: () => void
  /** Players only: the props that make this row's name a real <a href> to her page.
   *  A team row has no URL to point at, so it stays a plain onClick. */
  link?: WpblPlayerLinkProps
}

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Zoom-aware: inside the desktop `zoom` wrapper vw units aren't shrunk, so divide by
// Capped so it doesn't sprawl on huge monitors.
const FULL_BLEED_W = 'min(1540px, calc(100vw - 24px))'

// The chrome pinned above this view.
//
// Exactly one of the two terms is non-zero at a time: the toolbar is sticky only on desktop,
// the section nav only on mobile, so the sum lands just below the chrome on both without
// either breakpoint being special-cased at the call sites.
//
// It divided by `--app-zoom` for one commit, while the toolbar had left the zoom and this
// section had not. Both are out now, so a published rect and a sticky `top` are the same
// pixel and the sum is spent as it arrives.
const PINNED_CHROME = 'calc(var(--app-header-h, 0px) + var(--wpbl-nav-h, 0px))'
const fullBleedSx = {
  width: FULL_BLEED_W,
  position: 'relative',
  left: '50%',
  transform: 'translateX(-50%)',
} as const

// The sticky control bar, which is wider than everything else on purpose. Centred with a
// margin rather than left + transform: the bar is the one full-bleed block here that also has
// to stick, and those two can't share a box, since sticky spends `left` on its own threshold
// and a transformed ancestor becomes the containing block for anything positioned inside it.
//
// EDGE TO EDGE ON A PHONE, WITH THE GUTTER AS PADDING. At the cards' width the bar stopped
// 12px short of each side of the screen, so its background and the hairline under it ended in
// mid-air while the nav bar directly above ran the whole way across: the tabs read as a strip
// someone had cut the ends off. Content still lines up with the cards below, because the 12px
// the bar gives back as padding is exactly the gutter the cards keep as margin.
//
// PHONE ONLY, and `100vw` is the reason. It measures the viewport INCLUDING a classic
// scrollbar, so on a desktop with one it is a dozen pixels wider than the page can hold and
// the whole site gains a horizontal scrollbar. Touch scrollbars are overlaid and take no
// width, so the phone is exactly where the unit is safe. It is also the only place the fix is
// wanted: the nav above goes full-bleed on xs alone (`mx: { xs: -2, sm: 0 }`), so above sm
// there is no mismatch to correct.
const FULL_BLEED_GUTTER = 12
const BAR_W = `min(${1540 + 2 * FULL_BLEED_GUTTER}px, calc(100vw))`
const fullBleedStickySx = {
  width: { xs: BAR_W, sm: FULL_BLEED_W },
  marginLeft: { xs: `calc(50% - (${BAR_W}) / 2)`, sm: `calc(50% - (${FULL_BLEED_W}) / 2)` },
  px: { xs: `${FULL_BLEED_GUTTER}px`, sm: 0 },
} as const

// The two frozen columns are separate table cells, so the join between them is a seam, and a
// fractional device pixel can open it into a 1px window onto the stats scrolling underneath.
//
// IT USED TO BE CLOSED BY OVERLAPPING, AND THAT COST MORE THAN THE SEAM DID. The pinned column
// was stuck at `left: nameW - 2`, two pixels left of where the table actually puts it. Sticky
// does not clamp until you have scrolled past its threshold, so the column sat flush at rest
// and then CREPT two pixels left over the first two pixels of every horizontal scroll, in the
// one place the whole design promises nothing moves. Visible on every phone, every scroll.
//
// So the offset is exact now (`left: nameW`, which is precisely the cell's own offsetLeft: the
// collapsed border adds nothing, measured), and the seam is covered by something that cannot
// move anything, drawn by the pinned column over the last of the name column beside it.
//
// NOT A BOX-SHADOW, WHICH IS THE TRAP HERE. `box-shadow` does not apply to internal table
// elements when `border-collapse` is `collapse`, and this table collapses its borders. A
// shadow set on one of these cells computes, inspects and reads back exactly as if it worked,
// and paints nothing at all. That is also why FROZEN_EDGE below is a pseudo-element: the
// frozen columns' drop shadow was written as a box-shadow the day the pinned column shipped
// and has never once rendered.
//
// The cover redraws the divider at its right edge, because it lands on top of the name cell's
// own border. 3px wide so rounding at any device pixel ratio has somewhere to land: the name
// column's last 8px are padding, so there is nothing under there to hide.
const SEAM_COVER = {
  content: '""',
  position: 'absolute' as const,
  top: 0, bottom: 0, right: '100%', width: 3,
  bgcolor: 'background.paper',
  borderRight: '1px solid',
  borderColor: 'divider',
  pointerEvents: 'none' as const,
}

// The frozen columns' rightward shadow onto the scrolling stats once you are off the left
// edge: the "these columns float over the rest" cue.
const FROZEN_EDGE = {
  content: '""',
  position: 'absolute' as const,
  top: 0, bottom: 0, left: '100%', width: 6,
  background: 'linear-gradient(to right, rgba(0,0,0,0.25), rgba(0,0,0,0))',
  pointerEvents: 'none' as const,
}

// Fixed width of the frozen Player column on mobile, so the pinned sort-value column can
// sit flush against it with a constant `left` — no measurement to drift and let the two
// frozen columns overlap the name when scrolled. Names ellipsize within it.
const NAME_W = 150
const NAME_INNER_MAX = 84 // NAME_W minus rank + badge + gaps + padding, so the column can't grow past NAME_W
// Teams mode gets a narrower frozen column. There are only four rows, each with a distinct
// badge, and the nickname alone identifies them — so the width a player's full name needs is
// dead space here, and every pixel of it is a stat column pushed off a phone screen.
// No rank number in this mode (see the row), so the budget is padding + badge + gap + label.
const TEAM_NAME_W = 104
const TEAM_NAME_INNER_MAX = 62

/** What the table should be showing, when it's opened from somewhere else (a Home leader
 *  card's "View all"). `token` increments on every such jump — see the effect below. */
export interface WpblStatsFocus {
  group: Group
  sortKey?: string  // a HIT_COLS / PIT_COLS key; falls back to the group's default column
  /** 'teams' opens the four-team comparison instead of the player board. */
  mode?: Mode
  /** Pre-select the team filter chip (players mode only). null clears it. */
  teamId?: string | null
  token: number     // 0 = nothing requested yet
}

// Placeholder while a sub-tab's chunk arrives. These views render in place under the group
// bar, so a centred spinner in the content area is what the reader already sees while their
// data loads — the switch reads as slow rather than broken.
function SubViewFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={26} sx={{ color: 'var(--wpbl-accent-fg)' }} />
    </Box>
  )
}

export default function WpblStatsView({
  teams, games, focus, active = true, newBoardBadge, onNewBoardSeen, onOpenPlayer, onOpenTeam,
}: {
  teams: WpblTeam[]
  games: WpblGame[]
  focus?: WpblStatsFocus
  /** Draw the "new here" dot on the Run value chip. The same badge is on the Stats pill
   *  one level up; this is the half that points the rest of the way. */
  newBoardBadge?: boolean
  /** Called once the reader has actually reached that board, by any route. Owned by WpblApp,
   *  which holds the badge and writes the seen flag. */
  onNewBoardSeen?: (via: string) => void
  // Whether this pane is the one on screen. The pager keeps visited tabs mounted, so without
  // it every return to Stats after the first would go unrecorded (see the board log below).
  active?: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of flashing the spinner.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [loading, setLoading] = useState(() => getCachedWpblAllPlayers() == null || getCachedWpblAllLines() == null)
  // The name column is a fixed 84px, so the default character threshold is the wrong test —
  // it let a 12-character "Jamie Mackay" through whole to be cut to "Jamie Mac…" while a
  // 13-character "Denae Benites" became "D. Benites". 0 abbreviates every phone row alike.
  const shortName = useWpblName(0)
  const playerLink = useWpblPlayerLink()
  const headingTag = useWpblHeadingTag()
  const isNarrow = useMediaQuery('(max-width:600px)')
  const { basis: eraBasis, offLeague: eraOffLeague, setBasis: setEraBasis, fmtEra } = useEraBasis()
  // Read ONCE, not on every render: `shouldShowBadge` reads localStorage, and re-reading it
  // each pass would put the note back the moment anything else on the board re-rendered.
  // Kept on until the reader acts, including across a switch to Hitting and back, so it is
  // still there if they went looking for the setting first.
  const [eraNoteOpen, setEraNoteOpen] = useState(() => shouldShowBadge('era-per-9'))
  const dismissEraNote = () => { markBadgeSeen('era-per-9'); setEraNoteOpen(false) }
  const scrollRef = useRef<HTMLDivElement>(null)
  // Horizontal-scroll edges — drive the frozen-column shadow (not at start) and the
  // right-edge fade (not at end), so it's obvious the table scrolls sideways.
  const [scrollX, setScrollX] = useState({ atStart: true, atEnd: true })

  // A deep link picks the starting axes; everything else defaults to the season hitting table.
  const seedAxes = axesOf(focus?.group ?? 'hitting')
  // A tracking link names no side, so in-session it keeps whichever one the reader had. On a
  // cold load there's nothing to keep, and an old ?view=tracking bookmark used to open on the
  // velocity boards — so seed those rather than dropping it somewhere it has never been.
  const [side, setSide] = useState<Side>(seedAxes.side ?? (seedAxes.source === 'tracked' ? 'pitching' : 'hitting'))
  const [source, setSource] = useState<Source>(seedAxes.source)
  // One-shot: "open Run value with its explanation already unfolded". Set only by the Findings
  // play-value card's "how this is worked out" row, which is a promise of an explanation and
  // would otherwise hand the reader a leaderboard with the answer folded shut below it.
  const [openRunValueHow, setOpenRunValueHow] = useState(false)
  const [mode, setMode] = useState<Mode>('players')
  const [teamId, setTeamId] = useState<string | null>(null)
  // One row and one integer (see fetchWpblTrackedGameCount), read so the chip row can decide
  // whether Tracked is worth offering without loading the tracking scan to find out. Null
  // until it answers, and null means "do not offer": showing the chip and then discovering it
  // has two games in it is the outcome being avoided.
  const [fullTable, setFullTable] = useState(readFullTable)
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const stuckMarkRef = useRef<HTMLDivElement>(null)
  const [barStuck, setBarStuck] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [trackedGames, setTrackedGames] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchWpblTrackedGameCount().then(n => { if (!cancelled) setTrackedGames(n) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  // The PA / IP qualifier only defaults on once every team has played 2+ games;
  // before that it would hide nearly everyone, so the complete table shows by default.
  // Is the control bar holding content under itself? Sticky gives no way to ask, so compare
  // the bar with a zero-height marker sitting immediately above it: the two tops agree until
  // the bar is pinned and the page has scrolled on without it. Cheaper than reading the
  // resolved `top` off the CSS variables on every scroll event, and it needs no threshold.
  //
  // The marker exists because this used to compare against the bar's PARENT, on the reasoning
  // that the bar was the first thing in it. The page-level <h1> above it broke that silently
  // in v1.49.0: the parent's top then sits a heading's height higher, so the comparison was
  // true at rest and the bar wore its pinned edge permanently, on a page nobody had scrolled.
  // Anchoring to a sibling means anything added above the bar cannot do that again.
  useEffect(() => {
    const onScroll = () => {
      const el = barRef.current
      const mark = stuckMarkRef.current
      if (!el || !mark) return
      setBarStuck(el.getBoundingClientRect().top > mark.getBoundingClientRect().top + 0.5)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  // Games that have actually been played, which is what the tracked count has to be a share
  // of: measured against the 30-game schedule instead, the bar could never be cleared in April.
  const showTracked = useMemo(
    () => trackedGames != null && trackingWorthShowing(trackedGames, games.filter(g => g.status === 'final').length),
    [trackedGames, games])
  // Once a reader has actually been on the Tracked board in this session (a ?view=tracking
  // link, a Discord post from the watcher, the back button), the chip stays for the rest of
  // it. Taking it away the moment they switched off would strand them somewhere they had just
  // been, with the URL as the only way back.
  // Any route onto the board counts, not just a tap on the chip: a ?view= link and the back
  // button both land here without going through switchSource.
  useEffect(() => {
    if (source === 'runs') onNewBoardSeen?.('board')
  }, [source, onNewBoardSeen])
  const [trackedSeen, setTrackedSeen] = useState(seedAxes.source === 'tracked')
  useEffect(() => { if (source === 'tracked') setTrackedSeen(true) }, [source])
  const trackedOffered = showTracked || trackedSeen
  // The position each player has actually been playing, for the leaderboard sublabels.
  const positionIndex = useMemo(() => buildPositionIndex(lines.batting), [lines.batting])
  const [qualified, setQualified] = useState(() => qual.active)
  const [sortKey, setSortKey] = useState(() => defaultSort(seedAxes.side ?? 'hitting', focus?.sortKey).key)
  const [sortAsc, setSortAsc] = useState(() => defaultSort(seedAxes.side ?? 'hitting', focus?.sortKey).asc)

  // ── What board is being read ─────────────────────────────────────────────────
  // Stats is the most-opened tab in the section and, until this, the only one whose contents
  // were invisible: the axes are component state and never reach the URL, so neither
  // `wpbl_tab_viewed` nor Cloudflare's path counts can tell Hitting from the Draft board.
  // Logged imperatively at each place the board changes rather than from an effect on the
  // axes, because the useful part is *why* it changed and only the caller knows that.
  type BoardVia = 'open' | 'return' | 'link' | 'side' | 'source' | 'mode'
  const logBoard = (via: BoardVia, next?: { side?: Side; source?: Source; mode?: Mode }) =>
    track(EVENTS.WPBL_STATS_BOARD, {
      side:   next?.side   ?? side,
      source: next?.source ?? source,
      mode:   next?.mode   ?? mode,
      via,
    })
  // Set by the focus effect, consumed by the arrival effect below. A leader-card jump makes
  // this pane active AND re-seeds it in the same commit; both effects run, and without the
  // handoff the one visit would be logged twice, once per reason.
  const linkLogged = useRef(false)

  // Re-focus the table whenever a leader card sends us here. Keyed on `token`, NOT on the
  // group/column values: this panel stays mounted once visited, so seeding state at mount is
  // not enough (a second "View all" used to be a no-op), while reacting to the values alone
  // would fight the reader's own sorting on every unrelated re-render. A token bump means
  // "the reader just asked for this view" and nothing else does.
  const requested = focus?.token ?? 0
  useEffect(() => {
    if (!focus || requested === 0) return
    const axes = axesOf(focus.group)
    if (axes.side) setSide(axes.side)
    setSource(axes.source)
    // A link can also ask for the teams board, or for the player board already narrowed to
    // one club — the two states the team page links into. Both are left alone when the link
    // doesn't mention them, so an ordinary leader-card jump behaves exactly as before.
    if (focus.mode) setMode(focus.mode)
    if (focus.teamId !== undefined) setTeamId(focus.teamId)
    linkLogged.current = true
    logBoard('link', { side: axes.side, source: axes.source, mode: focus.mode })
    if (axes.source !== 'season') return // the tracked boards and draft have nothing to sort
    const next = defaultSort(axes.side ?? 'hitting', focus.sortKey)
    setSortKey(next.key)
    setSortAsc(next.asc)
  }, [requested])

  // Arriving at the tab: the first time counts as an open, every later one as a return. Both
  // report the board that was showing on arrival, which is the number that makes "boards read"
  // comparable to "tab views" without inferring the second from the first in SQL. Note the
  // board a return lands on is the default one, not the board that reader left: the unmount
  // takes the axes with it.
  useEffect(() => {
    if (!active) return
    if (linkLogged.current) { linkLogged.current = false; statsOpened = true; return }
    logBoard(statsOpened ? 'return' : 'open')
    statsOpened = true
  }, [active])

  // Revalidate on mount, but skip the DB round trip entirely when the shared cache is
  // still fresh — so a quick swipe out and back is instant and silent. Box scores move
  // as games are played, so a stale cache (or a live game) still refreshes in the
  // background without gating the already-painted table behind the spinner.
  useEffect(() => {
    const STATS_STALE_MS = 30_000
    if (wpblStatsCacheAgeMs() < STATS_STALE_MS) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines()]).then(([p, l]) => {
      if (cancelled) return
      setPlayers(p); setLines(l); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // OPS+ normalizes a hitter's OBP+SLG to the league (100 = league average, 150 = 50%
  // better). It needs league-wide rate context, so build the hitting columns in-component
  // with the league OBP/SLG closed over — computed from every batting line regardless of the
  // team/qualified filters, since the baseline is the whole league. No park factors: the
  // classic formula includes them, but this league's single-season, unmeasured parks give no
  // reliable adjustment, so we omit it (implicitly 1.0). Sits right after OPS.
  const hitCols = useMemo<Col<WpblBattingTotals>[]>(() => {
    const lg = sumBatting(lines.batting, games)
    const lgObp = lg.obp, lgSlg = lg.slg
    const opsPlus = (t: WpblBattingTotals): number | null =>
      t.obp != null && t.slg != null && lgObp != null && lgObp > 0 && lgSlg != null && lgSlg > 0
        ? 100 * (t.obp / lgObp + t.slg / lgSlg - 1)
        : null
    const cols = [...HIT_COLS]
    // Team rows only. Player LOB isn't reported by the feed, so on the player board this
    // column would be a solid stripe of dashes pretending to be a stat.
    if (mode === 'teams') {
      cols.splice(cols.findIndex(c => c.key === 'g'), 0, {
        key: 'lob', label: 'LOB',
        value: t => t.lob,
        // Never the default `String(v ?? 0)` — an unreported LOB must read as "unknown",
        // not as "nobody was left on".
        display: t => (t.lob == null ? '—' : String(t.lob)),
      })
    }
    const opsIdx = cols.findIndex(c => c.key === 'ops')
    cols.splice(opsIdx + 1, 0, {
      key: 'opsPlus', label: 'OPS+',
      value: opsPlus,
      display: t => { const v = opsPlus(t); return v == null ? '—' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.batting, mode])

  // ERA+ mirrors OPS+ for pitchers: league ERA over the pitcher's ERA, ×100 (100 = league
  // average, higher is better — note it inverts ERA, so unlike ERA it sorts descending). No
  // park factor, same reasoning as OPS+. A 0.00 ERA has no finite ratio, so it reads "∞" and
  // sorts to the top rather than dashing to the bottom. Sits right after ERA.
  const pitCols = useMemo<Col<WpblPitchingTotals>[]>(() => {
    const lgEra = sumPitching(lines.pitching, games).era
    const eraPlus = (t: WpblPitchingTotals): number | null => {
      if (t.era == null || lgEra == null || lgEra <= 0) return null
      return t.era === 0 ? Infinity : 100 * lgEra / t.era
    }
    const cols = [...PIT_COLS]
    const eraIdx = cols.findIndex(c => c.key === 'era')
    // ERA is stored per 9 and shown on whatever the reader chose (see stats.ts). Swapped in
    // here rather than in PIT_COLS because that list is a module constant with no reader to
    // ask. `value` is left on the stored number on purpose: the sort is identical either way,
    // and leaving it alone keeps ERA+ below reading the same figure the league does.
    cols[eraIdx] = { ...cols[eraIdx], display: t => fmtEra(t.era) }
    // K/9 belongs beside ERA for the same reason ERA is swapped in here: it is STORED per nine
    // and shown on whatever the reader chose, so its label is not knowable in a module
    // constant. `value` stays on the stored number, which sorts identically.
    const soIdx = cols.findIndex(c => c.key === 'so')
    cols.splice(soIdx + 1, 0, {
      key: 'k9', label: kRateLabel(eraBasis),
      value: t => t.k9,
      display: t => fmtTwo(scaleToBasis(t.k9, eraBasis)),
      rate: true,
    })
    cols.splice(eraIdx + 1, 0, {
      key: 'eraPlus', label: 'ERA+',
      value: eraPlus,
      display: t => { const v = eraPlus(t); return v == null ? '—' : !isFinite(v) ? '∞' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.pitching, fmtEra, eraBasis])

  const cols = (side === 'hitting' ? hitCols : pitCols) as Col<WpblBattingTotals | WpblPitchingTotals>[]
  const activeCol = cols.find(c => c.key === sortKey) ?? cols[0]
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // On phones the sorted column is pinned right after the name (a second frozen column) so
  // rank → name → its ranking value are always adjacent and the table can rest at its
  // natural left (G, AB, R, H…). Wide screens keep the plain single-scroll table.
  const pinActive = isNarrow
  // Teams mode only narrows on a phone; a wide screen has room for the full club name.
  const teamsNarrow = pinActive && mode === 'teams'
  const nameW = teamsNarrow ? TEAM_NAME_W : NAME_W
  const nameInnerMax = teamsNarrow ? TEAM_NAME_INNER_MAX : NAME_INNER_MAX
  const scrollCols = pinActive ? cols.filter(c => c.key !== activeCol.key) : cols

  // Flipping sides re-sorts on that side's headline stat. Safe to do even while the tracked
  // boards are showing: it leaves the table sorted sensibly for when the reader switches back.
  const switchSide = (s: Side) => {
    if (s !== side) logBoard('side', { side: s })
    setSide(s)
    if (s === 'hitting') { setSortKey('ops'); setSortAsc(false) }
    else { setSortKey('era'); setSortAsc(true) }
  }
  const switchSource = (s: Source) => {
    if (s !== source) logBoard('source', { source: s })
    setSource(s)
    // Any ordinary board change clears the request to open Run value's explainer, so tapping
    // the Run value chip yourself gets whatever you last chose. Only the Findings link below
    // sets it, immediately after calling this.
    setOpenRunValueHow(false)
  }
  const switchMode = (m: Mode) => {
    if (m !== mode) logBoard('mode', { mode: m })
    setMode(m)
  }
  // The two filters don't change which board is open, only what it shows, so they get their
  // own event rather than muddying the board counts. Both are here to answer one question
  // each: does a four-team league need a team filter, and does the qualified toggle earn
  // the space it takes on a phone.
  const filterTeam = (id: string | null) => {
    track(EVENTS.WPBL_STATS_FILTERED, { filter: 'team', on: id !== null, teamId: id, side })
    setTeamId(id)
  }
  const toggleQualified = () => {
    track(EVENTS.WPBL_STATS_FILTERED, { filter: 'qualified', on: !qualified, side })
    setQualified(q => !q)
  }
  const clickHeader = (c: Col<WpblBattingTotals | WpblPitchingTotals>) => {
    // The column a reader sorts by is the stat they came for, which is the question the
    // frozen archive leaderboards will need answered. Only deliberate header taps are
    // logged: the re-sort switchSide does for them is a side effect of the board, not a choice.
    const asc = c.key === sortKey ? !sortAsc : (c.lowerBetter ?? false)
    track(EVENTS.WPBL_STATS_SORTED, { key: c.key, asc, side, mode })
    if (c.key === sortKey) setSortAsc(a => !a)
    else { setSortKey(c.key); setSortAsc(c.lowerBetter ?? false) }
  }

  // Picking from the sheet is a choice of STAT, never of direction: a menu that silently
  // reversed the list when you tapped the row already ticked would be a trap. Direction is its
  // own control below the stats, in the words a fan would use for it.
  const pickSort = (c: Col<WpblBattingTotals | WpblPitchingTotals>) => {
    setSortOpen(false)
    if (c.key === sortKey) return
    track(EVENTS.WPBL_STATS_SORTED, { key: c.key, asc: c.lowerBetter ?? false, side, mode })
    setSortKey(c.key)
    setSortAsc(c.lowerBetter ?? false)
  }
  // "Best first" is not a direction: for ERA and WHIP it is ascending and for everything else
  // it is descending. The column already knows which, so the reader never has to.
  const bestAsc = activeCol.lowerBetter ?? false
  const bestFirst = sortAsc === bestAsc

  const toggleFullTable = () => {
    setFullTable(prev => {
      const next = !prev
      try { localStorage.setItem(FULL_TABLE_KEY, next ? '1' : '0') } catch { /* choice just isn't remembered */ }
      return next
    })
  }

  // Team LOB, keyed `${gameId}|${teamId}`. It has to come off the game row: the feed sends a
  // per-player `lob` but never fills it in, and summing the players wouldn't give the team
  // total anyway (see the note in sumBatting).
  const lobByGameTeam = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) {
      if (g.home_lob != null) m.set(`${g.id}|${g.home_team_id}`, g.home_lob)
      if (g.away_lob != null) m.set(`${g.id}|${g.away_team_id}`, g.away_lob)
    }
    return m
  }, [games])

  const rows = useMemo<Row[]>(() => {
    let built: Row[]
    if (mode === 'teams') {
      // One row per team (only four). Team G is the team's games played — the count of
      // distinct game_ids — not the number of player lines that sumBatting/sumPitching add up.
      built = teams.map(team => {
        const src = side === 'hitting'
          ? lines.batting.filter(l => l.team_id === team.id)
          : lines.pitching.filter(l => l.team_id === team.id)
        const totals = side === 'hitting'
          ? sumBatting(src as WpblBattingLine[], games)
          : sumPitching(src as WpblPitchingLine[], games)
        const gameIds = new Set(src.map(l => l.game_id))
        totals.g = gameIds.size
        if (side === 'hitting') {
          // Summed over exactly the games this team has box-score lines for, so LOB covers
          // the same games as the rest of the row rather than drifting ahead of it when a
          // game's score lands before its boxscore does. Left null when none of them
          // reported one, so the cell dashes instead of claiming a tidy zero.
          let lob = 0, any = false
          for (const gid of gameIds) {
            const v = lobByGameTeam.get(`${gid}|${team.id}`)
            if (v != null) { lob += v; any = true }
          }
          ;(totals as WpblBattingTotals).lob = any ? lob : null
        }
        return {
          key: team.id, team, label: wpblFullName(team), shortLabel: team.name,
          totals, qualified: true,
          onClick: onOpenTeam ? () => onOpenTeam(team) : undefined,
        }
      })
    } else {
      const seasons = side === 'hitting'
        ? aggregateBatting(players, lines.batting, games).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: plateAppearances(s.totals) >= qual.minPa }))
        : aggregatePitching(players, lines.pitching, games).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.outs >= qual.minOuts }))
      let list = seasons
      if (teamId) list = list.filter(s => s.player.team_id === teamId)
      // The qualifier applies to every sort, counting stats included — a 1-for-1 HR leader
      // shouldn't top the board over a full-season slugger. (Was rate-columns only, which
      // made the lit "✓ Qualified" chip silently do nothing on counting stats.)
      if (qualified) list = list.filter(s => s.qualified)
      built = list.map(s => ({
        key: s.player.id, team: teamById.get(s.player.team_id),
        label: shortName(s.player.name), fullName: s.player.name, sublabel: displayPositionFromIndex(s.player, positionIndex).label ?? undefined,
        totals: s.totals, qualified: s.qualified,
        onClick: () => onOpenPlayer(s.player),
        link: playerLink(s.player, onOpenPlayer),
      }))
    }

    const val = (r: Row) => activeCol.value(r.totals)
    // Ties break toward the bigger sample, innings pitched (outs) for pitching and plate
    // appearances for hitting, regardless of sort direction (more is always the better
    // tiebreak). Both are the unit that side's qualifier is set in.
    const sample = (r: Row) => side === 'pitching' ? (r.totals as WpblPitchingTotals).outs : plateAppearances(r.totals as WpblBattingTotals)
    return built.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return sample(b) - sample(a)
      if (av == null) return 1          // nulls always sink
      if (bv == null) return -1
      if (av !== bv) return sortAsc ? av - bv : bv - av
      return sample(b) - sample(a)
    })
  }, [mode, side, players, lines, teams, teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, shortName, lobByGameTeam])

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The five boards, in one row. `source` and `mode` stay as they were underneath: the deep
  // links, the ?view= URLs and axesOf() all speak that language, and collapsing them into a
  // single state would mean rewriting all of it to gain a variable.
  const boards: { key: string; label: string; badge?: boolean }[] = [
    { key: 'players', label: 'Players' },
    { key: 'teams', label: 'Teams' },
    { key: 'pitches', label: 'Pitch by pitch' },
    // Live for everyone. It spent its first weeks behind the experimental-features switch,
    // which meant the board most likely to be misread was shown only to the readers least
    // likely to misread it; what it needed was the sentence above the table saying what a
    // "run" means here, not a flag almost nobody flips.
    { key: 'runs', label: 'Run value', badge: newBoardBadge },
    // ONE CHIP FOR EVERY FINDING, however many get written. The row was starting to carry two
    // different kinds of thing: the boards beside this are ways to cut the numbers, and what
    // is behind this chip is answers. Giving each answer its own chip is what would break the
    // row, on a phone first. See FindingsView.tsx.
    { key: 'findings', label: 'Findings' },
    // Hidden while the league has published radar for barely any games, and kept for the
    // session once a link has opened it anyway. See trackedOffered.
    ...(trackedOffered ? [{ key: 'tracked', label: 'Tracked' }] : []),
    // Last, and a tab rather than the card it used to be. That card sat under the season
    // board, which meant it sat under the players table AND the teams table, an invitation to
    // somewhere else pinned to the bottom of two different pages. It is a destination like
    // the other four, the row above is the list of destinations, and it costs nothing there.
    { key: 'draft', label: 'Draft' },
  ]
  const activeBoard = source === 'season' ? mode : source
  const selectBoard = (k: string) => {
    if (k === 'players' || k === 'teams') { switchSource('season'); switchMode(k as Mode) }
    else switchSource(k as Source)
  }

  // Anything the reader has changed away from how the board opens. Drives the dot on the
  // Filters pill: `qualified` defaults to `qual.active`, so "on" is not the same as "set".
  const filtersSet = teamId !== null || qualified !== qual.active

  // THE PHONE READS A LIST, NOT A GRID. Sixteen columns behind a 150px frozen name column show
  // four stats at a time on a 375px screen, so the one thing anyone comes here to do (rank the
  // league by a stat) meant scrolling sideways to hunt for the column and tapping its header.
  // The list ranks by one stat, chosen from a control that says which, and carries three more
  // under each name for context; everything else about a player is one tap away on her card,
  // where it was always better presented. Desktop keeps the table: there the grid fits, and
  // comparing across columns is the thing a grid is for.
  const listView = isNarrow && source === 'season' && !fullTable

  // The three context stats: the preference list minus whatever is already the big number.
  const contextCols = useMemo(() => (
    CONTEXT_KEYS[side][activeCol.rate ? 'rate' : 'counting']
      .filter(k => k !== sortKey)
      .map(k => cols.find(c => c.key === k))
      .filter((c): c is Col<WpblBattingTotals | WpblPitchingTotals> => !!c)
      .slice(0, 3)
  ), [side, sortKey, cols, activeCol])

  const capped = listView && !expanded && rows.length > LIST_CAP
  const visibleRows = capped ? rows.slice(0, LIST_CAP) : rows

  // Collapsing removes a screenful and a half from BELOW the reader, so the browser clamps
  // the scroll and leaves them staring at the page footer with the list they just closed
  // somewhere above. Put them back at the top of it. `scrollMarginTop` on the card is what
  // keeps the sticky control bar from landing on the first two rows.
  const collapseRef = useRef(false)
  const collapse = () => { collapseRef.current = true; setExpanded(false) }
  // After the DOM has shrunk and before it is painted. A rAF here fired against the OLD
  // layout, scrolled to the right place in it, and was then clamped back down when the page
  // lost 1,200px underneath: the reader ended up 66px above the first row instead of on it.
  useLayoutEffect(() => {
    if (expanded || !collapseRef.current) return
    collapseRef.current = false
    listRef.current?.scrollIntoView({ block: 'start' })
  }, [expanded])

  // Shared by both boards so the count and the view switch cannot drift apart.
  //
  // It reads the population out in words, which is what lets the phone's Filters pill be one
  // pill with a dot instead of a row of chips that each have to announce themselves. "34
  // players · Boston · qualified only" is every filter's state AND what it did to the board,
  // in less room than the chips took to say only the first half.
  const noun = mode === 'teams' ? (rows.length === 1 ? 'team' : 'teams') : (rows.length === 1 ? 'player' : 'players')
  const filterWords = [
    // The club's full name, not the nickname the chip shows: "Boston Hunters" is a sentence
    // and "Hunters" is a crossword clue.
    teamId ? (() => { const t = teamById.get(teamId); return t ? wpblFullName(t) : null })() : null,
    mode === 'players' && qualified ? 'qualified only' : null,
  ].filter(Boolean) as string[]
  const boardFooter = (
    <Box sx={{
      px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600, minWidth: 0 }}>
        {[
          capped ? `${LIST_CAP} of ${rows.length} ${noun}` : `${rows.length} ${noun}`,
          ...filterWords,
          '2026 season',
          // Only when the reader has moved OFF the league's basis, and only on the pitching
          // side. Their ERA no longer matches the one the league publishes, and that is worth
          // a permanent three words at the foot rather than relying on a note they dismissed
          // weeks ago. On the league's own basis it would be noise on every board.
          side === 'pitching' && eraOffLeague ? `ERA per ${eraBasis}` : null,
        ].filter(Boolean).join(' · ')}
        {!listView && ' · tap a column to sort'}
      </Typography>
      {/* The way into the grid and back out. At the foot rather than in the control bar: it is
          a preference someone sets once, not a control they work with, and the bar is the
          thing this redesign is trying to make smaller. It only reads as a foot now that the
          list is capped, which is the point of capping it.

          The row above it adds PLAYERS and this one adds COLUMNS. "Every stat" named the
          second by what it gets you, which read well next to the first and badly on its own:
          the thing it switches to is a table, and calling it anything else means a reader has
          to find out what it does by pressing it. */}
      {isNarrow && source === 'season' && (
        <Box {...pressable(toggleFullTable)} sx={{
          ...FOCUS_RING, ml: 'auto', flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 0.4,
          minHeight: 34, px: 1.25, borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER,
          fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        }}>{fullTable ? 'Ranked list' : 'Full table'}</Box>
      )}
    </Box>
  )

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching sides — but only if it isn't already visible, so a wide desktop
  // table (all columns shown) or a user who's scrolled elsewhere is left alone.
  useLayoutEffect(() => {
    if (loading || pinActive) return // pinned: the sorted column is always in view (frozen)
    const c = scrollRef.current
    if (!c) return
    const th = c.querySelector('th[data-active="true"]') as HTMLElement | null
    if (!th) return
    const cRect = c.getBoundingClientRect()
    const tRect = th.getBoundingClientRect()
    const rightInView = tRect.right - cRect.left
    const leftInView = tRect.left - cRect.left
    if (rightInView > c.clientWidth) c.scrollLeft += rightInView - c.clientWidth + 12
    else if (leftInView < 0) c.scrollLeft += leftInView - 12
  }, [loading, side, sortKey, rows.length, pinActive])

  // Track horizontal scroll position to toggle the edge affordances.
  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    const update = () => {
      const max = c.scrollWidth - c.clientWidth
      setScrollX({ atStart: c.scrollLeft <= 1, atEnd: max <= 1 || c.scrollLeft >= max - 1 })
    }
    update()
    c.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(c)
    return () => { c.removeEventListener('scroll', update); ro.disconnect() }
  }, [loading, side, mode, rows.length, pinActive])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  // Draft takes the whole panel rather than sitting in a bar as a fourth tab. It's one
  // analysis covering hitters and pitchers at once, so a side switch above it would be inert
  // and a source switch meaningless — every control would be a control that does nothing.
  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }

  return (
    <Box>
      {/* The page's one <h1>: /wpbl/stats, the section's most-searched term. It sits above the
          sticky control bar and scrolls away with the content, leaving the bar to pin as
          before; the bar's top offset is unaffected because this is not sticky itself.

          FULL BLEED, like everything under it. This tab is the one place in the section whose
          content is wider than the page column, and the heading was still in that column: on a
          desktop it started 119px right of the board tabs directly beneath it and of the table
          under those, so it read as floating at no particular margin rather than as the title
          of the thing below. It lines up with the left edge of the board now. Same measure as
          the table (`fullBleedSx`), not the bar's, which is deliberately wider still and gives
          the difference back as padding, so the two agree on where content starts. */}
      <Typography component={headingTag} sx={{
        ...fullBleedSx,
        fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, mb: 1,
      }}>
        WPBL Stats
      </Typography>
      {/* The control bar, pinned. A 36-row table used to scroll every control off the top,
          leaving no way to change side, source or filter without scrolling back up. It offsets
          by PINNED_CHROME, whose note explains both terms and the division. Above the table's
          own sticky header, which pins inside the scroll box below it. */}
      {/* Where the bar sits when nothing is pinning it. Zero height, no paint; see the
          barStuck effect for what reads it. */}
      <Box ref={stuckMarkRef} aria-hidden sx={{ height: 0 }} />
      <Box ref={barRef} sx={{
        position: 'sticky',
        top: PINNED_CHROME,
        zIndex: 6,
        bgcolor: 'background.default',
        pt: 1,
        transition: 'box-shadow 0.2s',
        // An EDGE once it is holding something under it, and NOTHING before that. Without any
        // edge, rows slide up and vanish into an unexplained band of page colour below the
        // pills, which reads as the table being eaten rather than as a bar it is passing
        // behind. The shadow alone carries that now: this also drew a hairline, which put a
        // hard rule directly under the Hitting/Pitching pills and, on the boards that lead
        // with prose rather than a table, sat across the page above the first sentence with
        // nothing above it to separate. Two rules within 70px of each other (the board tabs
        // draw the other) is one more than the hierarchy needs.
        boxShadow: barStuck ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
        // Four pixels of the same paint above the top edge, for the seam with the bar above.
        // Two sticky bars meeting at a shared offset agree only to within a rounding error,
        // and a rounding error is a device pixel of the page showing between them. Same
        // reasoning as the frozen columns' seam cover: put something there so whatever the
        // device rounds to lands on paint rather than on a stats row.
        //
        // It lands on the nav's bottom 4px, which includes the hairline the nav draws when it
        // pins, and covering that is the intent as much as the seam is: with a second bar
        // directly beneath it, a rule across the middle of the chrome and none at the bottom
        // is the wrong way round. The stack now shows one edge, and it is the one content
        // actually passes under.
        '&::before': {
          content: '""', position: 'absolute', left: 0, right: 0, top: -4, height: 4,
          bgcolor: 'background.default', pointerEvents: 'none',
        },
        ...fullBleedStickySx,
      }}>
      {/* ROW ONE: WHICH BOARD. Five pages, one row, underline tabs, because that is what they
          are: tapping one replaces the screen. They used to be chips on the second row, in the
          same pill shape as the team filter and the qualified toggle, so "Run value" (a
          different page) and "LA" (a filter on this one) were drawn identically, and the side
          of the ball, which applies to all five, sat ABOVE them and looked more important.
          The hierarchy is the right way up now: board, then side, then filters.

          Players and Teams are boards here rather than a Season/Players+Teams pair, which is
          what lets the row exist at all. "Season" was never a useful label anyway (every
          number on this section is this season); its real meaning was "the normal table", and
          splitting it into the two things it actually ranks says that outright and takes the
          conditional Players/Teams row away with it.

          Scrolls sideways rather than wrapping when Tracked is showing. SwipeableViews hands
          the gesture back at the edges, so an extra flick still pages to the next tab. */}
      <Box sx={{
        display: 'flex', alignItems: 'flex-end', gap: { xs: 1.5, sm: 2 }, mb: 1.25,
        borderBottom: '1px solid', borderColor: 'divider',
        overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' },
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        {boards.map(b => {
          const on = b.key === activeBoard
          return (
            <Box key={b.key} {...pressable(() => selectBoard(b.key))} aria-current={on ? 'page' : undefined} sx={{
              ...FOCUS_RING,
              pb: 1, mb: '-1px', flexShrink: 0, cursor: 'pointer', userSelect: 'none',
              whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
              borderBottom: '2px solid', borderColor: on ? WPBL_ACCENT : 'transparent',
              color: on ? 'text.primary' : 'text.secondary',
              // Tightened on a phone so the five fit 375px without the last one, which is the
              // one that just moved up here, being the one that hangs off the edge. It still
              // scrolls when Tracked makes it six.
              fontSize: { xs: '0.86rem', sm: '0.9rem' },
              fontWeight: on ? 800 : 600, transition: 'color 0.15s',
              '&:hover': { color: 'text.primary' },
            }}>
              {b.label}
              {b.badge && <NewDot sx={{ ml: 0.6 }} />}
            </Box>
          )
        })}
      </Box>

      {/* ROW TWO: HOW TO CUT IT. Side of the ball on the left in a segmented pill, which is a
          third visual language on purpose: underline tabs are pages, this is a two-way switch
          that applies to whichever page you are on, and chips are filters. The row keeps its
          shape on every board (the right-hand controls just empty out), so the bar no longer
          grows and shrinks under a sticky header as you move between boards. Emptying them out
          is not enough on its own to hold that height on a phone: see the switch below. */}
      {source !== 'draft' && source !== 'findings' && (
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, rowGap: 1, pb: 1.5,
      }}>
        {/* Two things, both about the switch staying put as the reader moves between boards.
            The note above claims the row keeps its shape on every board; on a desktop that was
            already true, because the switch is the tallest thing in it and nothing else is.
            On a phone it was not.

            HEIGHT. The Sort/Filters pair on the right is 34 high against this switch's 28.7,
            so the row stood 34 on Players and Teams and 28.7 on every board without that pair,
            and moving between them nudged the switch and the whole board under it by five
            pixels, under a bar that is otherwise pinned still. Reserving the taller height
            HERE rather than on the row is deliberate: the row carries its own bottom padding,
            so a min-height on it has to know that padding to mean anything, and would go quietly
            wrong the day the padding changed.

            WIDTH. It sits next to a pair that refuses to shrink, so on a narrow phone the flex
            algorithm took the overflow out of the only item that could give: this one. A long
            sort label ("Sort ERA+") is enough to do it, and the switch came out a few pixels
            narrower on the season boards than on the others. Wrapping is the better failure. */}
        <Box sx={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          minHeight: isNarrow ? 34 : undefined,
        }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={side}
            onChange={v => switchSide(v as Side)}
          />
        </Box>

        {/* Phones: the two controls that do the work, stating what they are set to. Desktop
            keeps the chips inline, where there is room for the whole filter set at once and
            the column headers already sort. */}
        {source === 'season' && isNarrow && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Box {...pressable(() => setSortOpen(true))} aria-haspopup="dialog" aria-expanded={sortOpen} sx={{
              ...FOCUS_RING,
              display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0,
              cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
              minHeight: 34, px: 1.25, borderRadius: 999, fontSize: '0.78rem', fontWeight: 700,
              border: '1px solid', borderColor: WPBL_ACCENT, bgcolor: `${WPBL_ACCENT}12`,
              color: 'var(--wpbl-accent-fg)',
            }}>
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 700 }}>Sort</Box>
              {activeCol.label}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>

            {/* One pill for both filters. Which ones are on is not written here: the footer
                under the board says the population in words ("34 players · Boston · qualified
                only"), which is the same fact plus its consequence, and it costs no room in a
                bar this narrow. The dot is only there to say "something is not the default",
                so a filter can never be silently on. */}
            {mode === 'players' && (
              <Box {...pressable(() => setFiltersOpen(true))} aria-haspopup="dialog" aria-expanded={filtersOpen} sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0,
                cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                minHeight: 34, px: 1.25, borderRadius: 999, fontSize: '0.78rem', fontWeight: 700,
                border: '1px solid', transition: 'all 0.15s',
                borderColor: filtersSet ? WPBL_ACCENT : CARD_BORDER,
                bgcolor: filtersSet ? `${WPBL_ACCENT}12` : 'transparent',
                color: filtersSet ? 'var(--wpbl-accent-fg)' : 'text.secondary',
              }}>
                Filters
                {filtersSet && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: WPBL_ACCENT }} />}
                <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
              </Box>
            )}
          </Box>
        )}

        {/* Desktop: the filters themselves, no sheet in the way. */}
        {source === 'season' && mode === 'players' && !isNarrow && (
          <Box sx={{ ml: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Chip active={teamId === null} onClick={() => filterTeam(null)}>All</Chip>
            {teamChips.map(t => (
              <Chip key={t.id} active={teamId === t.id} onClick={() => filterTeam(teamId === t.id ? null : t.id)}>
                <TeamBadge team={t} size={16} />
                <Box component="span" sx={{ ml: 0.5 }}>{t.abbr}</Box>
              </Chip>
            ))}
            <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
            <Chip active={qualified} onClick={() => toggleQualified()}>{qualified ? '✓ Qualified' : 'Qualified'}</Chip>
          </Box>
        )}
      </Box>
      )}
      </Box>

      {/* Only on the season pitching board: it is the surface the numbers actually moved on,
          and the one a reader would be comparing against the league site. Tracked and Pitches
          are velocities and locations, which have no denominator to argue about. */}
      {eraNoteOpen && side === 'pitching' && source === 'season' && (
        <EraBasisNote
          basis={eraBasis}
          onSetBasis={b => { setEraBasis(b); dismissEraNote() }}
          onDismiss={dismissEraNote}
        />
      )}

      {/* Tracked and Pitches each render their own boards (league tiles + ranked leaders)
          rather than the shared table: a different shape of data, not more columns. Both read
          the same `side` as the table, so switching Hitting/Pitching above carries straight
          through instead of being asked again inside them. */}
      {source === 'draft' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblDraftValue players={players} batting={lines.batting} pitching={lines.pitching} games={games}
            onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'tracked' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblTrackingView side={side} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'pitches' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblPitchView side={side} teams={teams} games={games} trackedVisible={trackedOffered} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'findings' ? (
        <Suspense fallback={<SubViewFallback />}>
          {/* The play-value card's "how this is worked out" row lands on Run value, which owns
              the explanation now. Same tab, one board across, so it is a source switch rather
              than a navigation. */}
          <WpblFindingsView games={games} battingLines={lines.batting} onOpenPlayer={onOpenPlayer}
            onOpenRunValue={() => { switchSource('runs'); setOpenRunValueHow(true) }} />
        </Suspense>
      ) : source === 'runs' ? (
        // Full-bleed, like the season table and unlike the other boards. Its two columns are a
        // table and a leaderboard side by side, which want the width; left in the 720px page
        // column they sat visibly indented from the control bar directly above them, which is
        // full-bleed itself.
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblRunValueView side={side} teams={teams} games={games} onOpenPlayer={onOpenPlayer}
              openExplainer={openRunValueHow} />
          </Suspense>
        </Box>
      ) : rows.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
            {qualified
              ? (isNarrow
                  ? 'Nobody has qualified yet. Filters → Everyone shows the whole roster.'
                  : 'Nobody has qualified yet. Turn off Qualified to show the whole roster.')
              : 'Stats fill in as games are played.'}
          </Typography>
        </Box>
      ) : listView ? (
        // No inner scroller here, unlike the table: a vertical list inside a vertical page is
        // two scrolls under one thumb, and the one your finger lands on is never the one you
        // meant. The control bar above is sticky, so the sort control stays reachable anyway.
        <Box ref={listRef} sx={{
          border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
          scrollMarginTop: `calc(${PINNED_CHROME} + 104px)`,
          ...fullBleedSx,
        }}>
          {/* A one-line header, the way the grid has one. The big number on the right was the
              only unlabelled figure on the row: every stat in the line under a name carries
              its abbreviation, and the one the whole board is ranked by carried none. Labelled
              here rather than on each row, because ten greyed "AVG"s down a column is the same
              word ten times, and it also gives the list the direction arrow the grid gets: on
              the ERA board, ranked best first, the numbers ascend and nothing said so. */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
            borderBottom: '1px solid', borderColor: 'divider',
          }}>
            <Typography sx={{
              flex: 1, minWidth: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.4,
              textTransform: 'uppercase', color: 'text.disabled',
            }}>{mode === 'teams' ? 'Team' : 'Player'}</Typography>
            <Typography sx={{
              flexShrink: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.4,
              textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)',
            }}>
              {activeCol.label}
              <Box component="span" sx={{ ml: 0.3, fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>
            </Typography>
          </Box>
          {visibleRows.map((r, i) => (
            <StatListRow key={r.key} row={r} rank={i + 1} first={i === 0} isTeam={mode === 'teams'}
              total={visibleRows.length}
              value={cellText(activeCol, r.totals)}
              context={contextCols.map(c => `${cellText(c, r.totals)} ${c.label}`).join(' · ')} />
          ))}
          {rows.length > LIST_CAP && (
            <ExpandRow expanded={!capped} moreLabel={`Show all ${rows.length} ${noun}`}
              onToggle={capped ? () => setExpanded(true) : collapse} />
          )}
          {boardFooter}
        </Box>
      ) : (
        <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden', ...fullBleedSx }}>
          <Box sx={{ position: 'relative' }}>
          {/* Capped inner scroll so the column headers stay sticky (top:0) as you scroll the
              rows. `overscroll-behavior: contain` stops the scroll from chaining out to the
              page at the ends, so it reads as one list rather than a scroll-box fighting the
              page. `dvh` tracks the mobile browser chrome so the cap doesn't overshoot.

              TWO SUBTRACTIONS, because a phone turned sideways wants a different one.

              260px is everything standing above the table at the top of the page: toolbar, tab
              nav, board picker, sort row. Subtracting all of it means "tall enough that nothing
              has to scroll", which is the right answer whenever the screen can afford it.

              A landscape phone cannot. 375dvh less 260 left a 115px window on a 1149px table:
              the header and TWO of thirty-three rows, which reads as broken rather than as
              tight. There the page has to scroll, and the cap becomes what fits in the gap the
              PINNED chrome leaves. Everything else scrolls away.

              That gap is asked for rather than assumed. The shell publishes whichever of its
              bars is actually holding a position (--app-header-h on desktop, --wpbl-nav-h on
              mobile, both 0 when the bar is static), so subtracting the sum is right at every
              width without naming a breakpoint here — and it followed by itself the day the
              toolbar started scrolling away on a short screen. 100px is this page's OWN
              control bar, which pins under them and is the one height the shell cannot report
              (91px measured, the rest slack).

              Going taller than that is not merely wasteful, it breaks the thing this box exists
              for: a table taller than the free gap can never be scrolled fully into it, so its
              sticky header ends up parked behind the nav and the reader loses the column labels
              for the rest of the board. Tried at `100dvh - 60px` and measured: 315px of table
              in a 240px gap, header at y=-94.

              560px is where the two meet, and is picked rather than guessed: it is the height
              at which the first subtraction still leaves about eight rows, which is the point
              below which a scroll-box stops being a table. The query and the calc now read the
              same viewport: they used to diverge on desktop, where the calc was inside the
              1.4 `zoom` and the query was not, which made the query late and the box merely
              shorter than it could be. That was the safe direction and it no longer happens at
              all. The unsafe direction, a box taller than the gap, was never reachable from
              here. */}
          <Box ref={scrollRef} sx={{
            overflowX: 'auto', overflowY: 'auto', overscrollBehavior: 'contain',
            maxHeight: 'calc(100dvh - 260px)',
            '@media (max-height: 560px)': {
              maxHeight: `calc(100dvh - ${PINNED_CHROME} - 100px)`,
            },
          }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" data-swipe-handle="" sx={{ ...thBase, left: 0, zIndex: 4, textAlign: 'left', width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined, borderRight: '1px solid', borderColor: 'divider', pl: 1, touchAction: pinActive ? 'pan-y' : undefined }}>
                    {mode === 'teams' ? 'Team' : 'Player'}
                  </Box>
                  {pinActive && (
                    <Box component="th" data-swipe-handle="" onClick={() => clickHeader(activeCol)} sx={{
                      ...thBase, position: 'sticky', left: nameW, zIndex: 5, touchAction: 'pan-y',
                      textAlign: 'center', cursor: 'pointer', minWidth: '3.125rem', px: 0.5,
                      color: 'var(--wpbl-accent-fg)',
                      backgroundImage: `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)`,
                      borderRight: '1px solid', borderColor: 'divider',
                      '&::before': SEAM_COVER,
                      '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
                    }}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                        {activeCol.label}
                        <Box component="span" sx={{ fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>
                      </Box>
                    </Box>
                  )}
                  {scrollCols.map(c => {
                    const active = c.key === sortKey
                    return (
                      <Box component="th" key={c.key} onClick={() => clickHeader(c)}
                        data-active={active ? 'true' : undefined}
                        sx={{
                          ...thBase, textAlign: 'center', cursor: 'pointer', minWidth: '2.375rem',
                          color: active ? 'var(--wpbl-accent-fg)' : 'text.disabled',
                          // The sorted column's tint rides on backgroundImage over the opaque
                          // paper thBase already sets. As a bgcolor it *replaced* that paper
                          // with a 14%-alpha accent, so this one header cell went see-through
                          // and the rows scrolling under the sticky header showed through it.
                          // Same layering the frozen column beside it already uses.
                          backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)` : undefined,
                          '&:hover': { color: 'var(--wpbl-accent-fg)' },
                        }}>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                          {c.label}
                          {active && <Box component="span" sx={{ fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>}
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((r, i) => {
                  return (
                    <Box component="tr" key={r.key} onClick={r.onClick}
                      sx={{
                        cursor: r.onClick ? 'pointer' : 'default', userSelect: 'none',
                        WebkitTapHighlightColor: 'transparent',
                        // Hover tints via backgroundImage for the same reason as the header:
                        // the row's frozen name cell — and, on a phone, its pinned sort cell —
                        // are sticky and rely on an opaque backgroundColor. Overwriting that
                        // made the hovered row's name cell transparent, so the stat columns
                        // scrolling beneath it showed through.
                        '@media (hover: hover)': {
                          '&:hover > td, &:hover > th': r.onClick
                            ? { backgroundImage: `linear-gradient(${WPBL_ACCENT}0e, ${WPBL_ACCENT}0e)` }
                            : undefined,
                        },
                      }}>
                      <Box component="th" data-swipe-handle="" sx={{
                        position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
                        textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
                        width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined,
                        borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                        touchAction: pinActive ? 'pan-y' : undefined,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {/* Four rows, already in sorted order, with the sorted column
                              arrowed in the header — the rank digit restates all of that and
                              costs 24px that a nickname needs to render whole. */}
                          {!teamsNarrow && (
                            <Typography sx={{ width: '1.125rem', textAlign: 'right', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled' }}>{i + 1}</Typography>
                          )}
                          {r.team && <TeamBadge team={r.team} size={20} />}
                          <Box sx={{ minWidth: 0, maxWidth: pinActive ? nameInnerMax : undefined }}>
                            {/* The NAME is the link, not the row: a <tr> cannot be an <a>, and
                                the row keeps its own onClick so the whole width stays a target.
                                This is the anchor a crawler follows and the tab stop a keyboard
                                lands on. */}
                            <Typography {...r.link} sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {teamsNarrow && r.shortLabel ? r.shortLabel : r.label}
                            </Typography>
                            {r.sublabel && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.sublabel}</Typography>}
                          </Box>
                        </Box>
                      </Box>
                      {pinActive && (
                        <Box component="td" data-swipe-handle="" onClick={e => { e.stopPropagation(); clickHeader(activeCol) }} sx={{
                          position: 'sticky', left: nameW, zIndex: 3, touchAction: 'pan-y',
                          textAlign: 'center', py: 0.5, px: 0.5,
                          borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                          fontSize: '0.84rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                          backgroundColor: 'background.paper',
                          backgroundImage: `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)`,
                          '&::before': SEAM_COVER,
                          '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
                          whiteSpace: 'nowrap',
                        }}>
                          {cellText(activeCol, r.totals)}
                        </Box>
                      )}
                      {scrollCols.map(c => {
                        const active = c.key === sortKey
                        const txt = cellText(c, r.totals)
                        return (
                          <Box component="td" key={c.key} onClick={e => { e.stopPropagation(); clickHeader(c) }} sx={{
                            textAlign: 'center', py: 0.5, px: 0.5, borderTop: '1px solid', borderColor: 'divider',
                            fontSize: active ? '0.84rem' : '0.8rem', fontWeight: active ? 800 : 500,
                            color: active ? 'var(--wpbl-accent-fg)' : 'text.primary',
                            // Layered like the header, so a hovered row and the sorted column
                            // compose instead of one of them winning outright.
                            backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)` : undefined,
                            whiteSpace: 'nowrap',
                          }}>
                            {txt}
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>
          {/* Right-edge fade — "more stats this way" — hidden once you've scrolled to the end. */}
          <Box aria-hidden sx={theme => ({
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none', zIndex: 6,
            background: `linear-gradient(to right, ${alpha(theme.palette.background.paper, 0)}, ${theme.palette.background.paper})`,
            opacity: scrollX.atEnd ? 0 : 1, transition: 'opacity 0.2s',
          })} />
          </Box>
          {boardFooter}
        </Box>
      )}

      {sortOpen && (
        <SortSheet cols={cols} sortKey={sortKey} side={side} eraBasis={eraBasis} bestFirst={bestFirst}
          onPick={pickSort}
          onDirection={best => setSortAsc(best ? bestAsc : !bestAsc)}
          onClose={() => setSortOpen(false)} />
      )}
      {filtersOpen && (
        <FilterSheet teams={teamChips} teamId={teamId} onTeam={filterTeam}
          qualified={qualified} onQualified={toggleQualified}
          side={side} minPa={qual.minPa} minIp={outsToIp(qual.minOuts)}
          onClose={() => setFiltersOpen(false)} />
      )}

    </Box>
  )
}

// One row of the phone board. Deliberately the same shape as LeaderRow, which every other
// board on this tab already uses (Pitch by pitch, Run value, Tracked): rank, face, name, one
// big number. Not literally LeaderRow, because that one takes a WpblPlayer and puts a portrait
// on it, and half the rows here can be clubs, which want their badge and have no face.
//
// The name is the league's spelling, not the table's. `row.label` is pre-abbreviated to
// "D. Benites" to survive an 84px column; a list row has 200px and no reason to shorten
// anybody.
//
// The player's position, which the table shows under the name, gives its line to the three
// context stats. A leaderboard answers "how good", and the card behind one tap answers
// everything else, position included.
function StatListRow({ row, rank, value, context, isTeam, first, total }: {
  row: Row
  rank: number
  value: string
  context: string
  isTeam: boolean
  first: boolean
  /** How many rows are on screen. Only used to decide whether marking a top three says
   *  anything: see the rank digit below. */
  total: number
}) {
  // A top-three mark is a claim that three rows stand out from the rest, so it needs a rest to
  // stand out FROM. The teams board is four clubs, where it lit 1, 2 and 3 and left 4 grey,
  // which does not read as "these three lead" — it reads as the Hunters' number having failed
  // to render. Nothing is marked when the marked group would not be a clear minority, so the
  // four clubs get one colour and the ranking is carried by the order and the number on the
  // right, which is all it was ever carried by on a board this short.
  const marked = rank <= 3 && total > 6
  return (
    // A player row is an <a href> to her page; a team row has no URL, so it stays a
    // `pressable` div (role=button, tab stop, Enter/Space). Both are keyboard reachable.
    <Box {...(row.link?.href ? row.link : pressable(row.onClick))} sx={{
      ...FOCUS_RING,
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.85,
      borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
      cursor: row.onClick ? 'pointer' : 'default',
      WebkitTapHighlightColor: 'transparent',
      // Hover only where there is one. On a touch browser it sticks to whichever row the
      // scroll started on, which reads as a selection nobody made. Same guard as LeaderRow.
      '@media (hover: hover)': { '&:hover': row.onClick ? { bgcolor: 'action.hover' } : undefined },
    }}>
      <Box sx={{
        // 1.125rem is the 18px this has always been at the default root size, in rem because it
        // reserves room for a NUMBER the reader can enlarge. At a 1.375 text scale a two-digit
        // rank wants 20px, and this column was the FIRST thing in the section to overflow its
        // box: nothing else clips until well past it. See AccessibilityContext's note on how
        // far that setting is allowed to go.
        width: '1.125rem', flexShrink: 0, textAlign: 'center', fontSize: '0.8rem', fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        color: marked ? 'var(--wpbl-accent-fg)' : 'text.disabled',
      }}>{rank}</Box>

      {isTeam
        ? (row.team ? <TeamBadge team={row.team} size={32} /> : null)
        : <PlayerPortrait name={row.fullName ?? row.label} teamId={row.team?.id ?? null} size={32} />}

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.85rem', fontWeight: 600,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{isTeam ? (row.shortLabel ?? row.label) : (row.fullName ?? row.label)}</Typography>
          {!isTeam && row.team && <TeamBadge team={row.team} size={15} />}
        </Box>
        <Typography sx={{
          fontSize: '0.68rem', color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{context}</Typography>
      </Box>

      <Box sx={{
        flexShrink: 0, fontSize: '1.05rem', fontWeight: 800,
        color: 'var(--wpbl-accent-fg)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</Box>
    </Box>
  )
}

// ── The sheets, and the one rule they are built to ───────────────────────────────
//
// EVERY TARGET IN HERE IS AT LEAST 52px TALL. The first version of both sheets used the same
// `Chip` as the control bar, which is 24px: fine as a label you glance at, half the minimum
// anything a finger has to hit should be, and there were fifteen of them wrapped into three
// dense lines. A chip row is a good way to SHOW a small set of options and a bad way to let
// someone pick from a long one.
//
// So the options are tiles and rows now, sized for a thumb, and the room that costs buys
// something back: there is space to say what each abbreviation means.

/** One option in a picker. Fills its grid cell, two lines, 52px minimum. */
function OptionTile({ label, hint, on, onClick }: {
  label: string
  hint?: string
  on: boolean
  onClick: () => void
}) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      minHeight: 52, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      px: 1.25, py: 0.85, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', transition: 'all 0.15s',
      borderColor: on ? WPBL_ACCENT : CARD_BORDER,
      bgcolor: on ? `${WPBL_ACCENT}14` : 'transparent',
      '@media (hover: hover)': { '&:hover': { borderColor: WPBL_ACCENT } },
    }}>
      <Typography sx={{
        fontSize: '0.85rem', fontWeight: 800, lineHeight: 1.2,
        color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
      }}>{label}</Typography>
      {hint && (
        <Typography sx={{
          fontSize: '0.66rem', lineHeight: 1.25, color: 'text.disabled',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{hint}</Typography>
      )}
    </Box>
  )
}

/** A full-width option row, for a short list where the label wants the whole line. */
function OptionRow({ label, hint, icon, on, onClick }: {
  label: string
  hint?: string
  icon?: React.ReactNode
  on: boolean
  onClick: () => void
}) {
  return (
    <Box {...pressable(onClick)} aria-pressed={on} sx={{
      ...FOCUS_RING,
      minHeight: 52, display: 'flex', alignItems: 'center', gap: 1.25,
      px: 1.25, py: 0.85, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      border: '1px solid', transition: 'all 0.15s',
      borderColor: on ? WPBL_ACCENT : CARD_BORDER,
      bgcolor: on ? `${WPBL_ACCENT}14` : 'transparent',
      '@media (hover: hover)': { '&:hover': { borderColor: WPBL_ACCENT } },
    }}>
      {icon}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.25,
          color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
        }}>{label}</Typography>
        {hint && (
          <Typography sx={{ fontSize: '0.7rem', lineHeight: 1.3, color: 'text.disabled' }}>
            {hint}
          </Typography>
        )}
      </Box>
      {/* A tick as well as the fill, never the fill alone: a tinted border is the sort of
          difference that disappears in sunlight, and about one man in twelve cannot use
          colour to tell two states apart at all. */}
      <Box aria-hidden sx={{
        flexShrink: 0, fontSize: '0.95rem', fontWeight: 800,
        color: 'var(--wpbl-accent-fg)', opacity: on ? 1 : 0,
      }}>✓</Box>
    </Box>
  )
}

/** The sheet's way out, at the bottom where a thumb is. The ✕ in the header is 700px up the
 *  screen on a sheet this tall, which is the corner of a phone a hand cannot reach without
 *  regripping it. Both sheets apply their choices live, so this only closes: it is a Done
 *  rather than an Apply, and it says so. */
function SheetDone({ onClose }: { onClose: () => void }) {
  return (
    <Box {...pressable(onClose)} sx={{
      ...FOCUS_RING,
      minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 2, cursor: 'pointer', userSelect: 'none',
      bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: '0.9rem',
    }}>Done</Box>
  )
}

/** A titled group inside a sheet. */
function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <SectionLabel>{title}</SectionLabel>
      <Box sx={{ mt: 0.9 }}>{children}</Box>
    </Box>
  )
}

// Choosing what the board ranks by. Two columns of tiles: sixteen options as full-width rows
// is three screenfuls of scrolling, and two columns is one and a bit, with every tile still
// 165px wide on the narrowest phone.
//
// ─── "The ERA changed" notice ─────────────────────────────────────────────────
//
// A one-line note above the pitching board, not a dialog. The change is worth telling a
// returning reader about (their ace's ERA moved by about a third overnight, and a number
// moving with no explanation is how a site loses trust), but it is worth exactly one line:
// a modal on tab-open makes every reader dismiss something before they can look at the board
// they came for, including the majority who never saw the old number and have nothing to
// reconcile. Interrupting them to explain a change they did not witness is worse than silence.
//
// It carries the SETTING rather than a link to Settings. The only reader who cares enough to
// read this is the one who might want the old basis back, and making them go and find it in a
// dialog two taps away is where they give up. Dismissing and switching are the same size of
// gesture on purpose.
//
// THE PER-7 SIDE ALSO NAMES SETTINGS, because that is the branch a reader only reaches by
// having changed something, and this note is the only thing on the section that says the
// choice is theirs. It is dismissible and it retires on the badge store's expiry, so a reader
// who switched to per 7 and then lost the line would be left on numbers that disagree with the
// league's own site with nothing on screen saying where that came from or how to undo it. Two
// clauses is cheap; a reader who thinks the site is simply wrong is not.
//
// Retires on the badge store's expiry (see lib/seen.ts): by the end of the feed nobody
// arriving has seen a per-7 number here, so the note and its key can be deleted together.
function EraBasisNote({ basis, onSetBasis, onDismiss }: {
  basis: EraBasis
  onSetBasis: (b: EraBasis) => void
  onDismiss: () => void
}) {
  const action = (label: string, onClick: () => void) => (
    <Box component="span" {...pressable(onClick)} sx={{
      ...FOCUS_RING, cursor: 'pointer', borderRadius: 0.5, fontWeight: 800, whiteSpace: 'nowrap',
      color: 'text.primary', textDecoration: 'underline', textUnderlineOffset: 2,
    }}>{label}</Box>
  )
  return (
    <Box sx={{
      mx: { xs: 1.5, sm: 0 }, mb: 1.5, px: 1.5, py: 1.15, borderRadius: 2,
      border: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${WPBL_ACCENT}`,
      display: 'flex', alignItems: 'baseline', gap: 1.25,
    }}>
      <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary', lineHeight: 1.5, flex: 1, minWidth: 0 }}>
        {basis === 9
          ? <>ERA and the strikeout rate are now <b>per 9 innings</b>, matching the official WPBL site. They used to be per 7. </>
          : <>ERA and the strikeout rate are <b>per 7 innings</b>, the length of a WPBL game. The official WPBL site uses per 9, and Settings will put you back on it whenever you want. </>}
        {basis === 9
          ? action('Show per 7', () => onSetBasis(7))
          : action('Show per 9', () => onSetBasis(9))}
        {' · '}
        {action('Dismiss', onDismiss)}
      </Typography>
    </Box>
  )
}

// Direction is named rather than described. "Ascending" is a fact about the sort and "best
// first" is what the reader wants, and the two are opposites for ERA and WHIP, which is
// exactly where getting it wrong is least forgivable.
function SortSheet({ cols, sortKey, side, eraBasis, bestFirst, onPick, onDirection, onClose }: {
  cols: Col<WpblBattingTotals | WpblPitchingTotals>[]
  sortKey: string
  side: Side
  eraBasis: EraBasis
  bestFirst: boolean
  onPick: (c: Col<WpblBattingTotals | WpblPitchingTotals>) => void
  onDirection: (bestFirst: boolean) => void
  onClose: () => void
}) {
  // ERA carries its denominator here and nowhere else on the board. This sheet is the one
  // place a reader is already asking what a stat means, so it is the cheapest place to answer
  // "which ERA is this" without putting a number on every column heading.
  const names = side === 'pitching'
    ? { ...PIT_NAMES, era: `Earned run average, per ${eraBasis}` }
    : HIT_NAMES
  const groups: [string, Col<WpblBattingTotals | WpblPitchingTotals>[]][] = [
    ['Rate stats', cols.filter(c => c.rate)],
    ['Counting stats', cols.filter(c => !c.rate)],
  ]
  const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 } as const
  return (
    <ModalShell sheet eyebrow={side === 'pitching' ? 'Rank pitchers by' : 'Rank hitters by'}
      onClose={onClose} maxWidth={480} footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map(([title, list]) => list.length === 0 ? null : (
          <SheetGroup key={title} title={title}>
            <Box sx={grid}>
              {list.map(c => (
                <OptionTile key={c.key} label={c.label} hint={names[c.key]}
                  on={c.key === sortKey} onClick={() => onPick(c)} />
              ))}
            </Box>
          </SheetGroup>
        ))}
        <SheetGroup title="Order">
          <Box sx={grid}>
            <OptionTile label="Best first" on={bestFirst} onClick={() => onDirection(true)} />
            <OptionTile label="Worst first" on={!bestFirst} onClick={() => onDirection(false)} />
          </Box>
        </SheetGroup>
      </Box>
    </ModalShell>
  )
}

// The two filters, on a phone, in one sheet.
//
// Rows rather than tiles: there are only seven, a club wants its badge and its whole name
// rather than the three letters the chips showed, and "Qualified" needs a sentence under it.
// It says what qualified MEANS, which the chip never did: a word a reader either knows or is
// excluded by, set against a bar that moves with the season (see wpblQualifiers), so nobody
// could have known it from memory either.
function FilterSheet({ teams, teamId, onTeam, qualified, onQualified, side, minPa, minIp, onClose }: {
  teams: WpblTeam[]
  teamId: string | null
  onTeam: (id: string | null) => void
  qualified: boolean
  onQualified: () => void
  side: Side
  minPa: number
  minIp: string
  onClose: () => void
}) {
  const rows = { display: 'flex', flexDirection: 'column', gap: 0.75 } as const
  return (
    <ModalShell sheet eyebrow="Filter" onClose={onClose} maxWidth={480}
      footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SheetGroup title="Team">
          <Box sx={rows}>
            <OptionRow label="All teams" on={teamId === null} onClick={() => onTeam(null)} />
            {teams.map(t => (
              <OptionRow key={t.id} label={wpblFullName(t)} on={teamId === t.id}
                icon={<TeamBadge team={t} size={28} />}
                onClick={() => onTeam(teamId === t.id ? null : t.id)} />
            ))}
          </Box>
        </SheetGroup>

        <SheetGroup title="Who to include">
          <Box sx={rows}>
            <OptionRow label="Qualified" on={qualified}
              hint={side === 'pitching' ? `${minIp} innings pitched or more` : `${minPa} plate appearances or more`}
              onClick={() => { if (!qualified) onQualified() }} />
            <OptionRow label="Everyone" on={!qualified}
              hint={side === 'pitching'
                ? 'One good relief outing can top the ERA board'
                : 'A hitter who is 1 for 1 can top the average board'}
              onClick={() => { if (qualified) onQualified() }} />
          </Box>
        </SheetGroup>
      </Box>
    </ModalShell>
  )
}

// Small pill used for the team filter + qualified toggle.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={{
      ...FOCUS_RING,
      display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      flexShrink: 0, whiteSpace: 'nowrap',
      px: 1, py: 0.4, borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
      border: '1px solid', transition: 'all 0.15s',
      borderColor: active ? WPBL_ACCENT : CARD_BORDER,
      color: active ? 'var(--wpbl-accent-fg)' : 'text.secondary',
      bgcolor: active ? `${WPBL_ACCENT}12` : 'transparent',
      '&:hover': { borderColor: WPBL_ACCENT },
    }}>
      {children}
    </Box>
  )
}
