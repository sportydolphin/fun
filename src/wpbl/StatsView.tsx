import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, Skeleton, useMediaQuery } from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameCount,
  getCachedWpblAllPlayers, getCachedWpblAllLines, wpblStatsCacheAgeMs,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  fetchWpblAllFielding, getCachedWpblAllFielding,
} from './api'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { wobaWeights, fipWeights, wobaContext, woba, wrcPlus } from './derive/linearWeights'
import { trackingWorthShowing } from './tracking'
import { WPBL_ACCENT, outsToIp, wpblFullName } from './constants'
import {
  TeamBadge, PlayerPortrait, ModalShell, SectionLabel, PillGroup, ExpandRow, NewDot,
  CARD_BORDER, pressable, FOCUS_RING, useWpblName, hoverOnly, tappableIf, chromePx,
  BOARD_COLUMN, BOARD_COLUMN_WIDE } from './ui'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import {
  aggregateBatting, aggregatePitching, aggregateFielding, sumBatting, sumPitching, sumFielding,
  wpblQualifiers, plateAppearances,
  kRateLabel, scaleToBasis, fmtRate, fmtTwo, fmtPct, fip, fipConstant,
  type WpblBattingTotals, type WpblPitchingTotals, type WpblFieldingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from './types'
import { isPostseasonGame, scopedLines, type SeasonScope } from './season'
import {
  decodeFinderQuery, encodeFinderQuery, finderFields,
  type FinderQuery, type FinderVenue,
} from './derive/finder'
import type { EraBasis } from './stats'
import { track, EVENTS } from '../lib/analytics'
import { useWpblPlayerLink, type WpblPlayerLinkProps } from './LinkContext'
import { TabTitle } from './PageHeading'
import { useEraBasis } from './EraBasisContext'
import { BOTTOM_NAV_SPACE } from './BottomNav'
import { STATS_FULL_BLEED_W } from './layoutWidths'
import { typePx } from '../ui/scale'
import { PageTabs } from '../ui/PageTabs'
import { FilterChip } from '../ui/FilterChip'
// The boards that render outside the shared season table, behind their own chunks. Hitting and
// Pitching are what the tab opens on; Tracking (the TrackMan boards) is a separate sub-tab with
// its own layout, not reachable without a deliberate tap. The draft-value model lives on
// /wpbl/league: it is one analysis of the draft class, not a season stat.
const WpblTrackingView = lazy(() => import('./TrackingView'))
const WpblPitchView = lazy(() => import('./PitchView'))
const WpblRunValueView = lazy(() => import('./RunValueView'))
const WpblBestsView = lazy(() => import('./BestsView'))
const WpblFindView = lazy(() => import('./FindView'))
// The draft-class model. On Stats since it left the league page: it is a question about how players
// performed, asked of the draft, and this is where a reader looks for how players performed.
const WpblDraftValue = lazy(() => import('./DraftValue'))

// Complete season stat table for the WPBL: a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

// Rate-stat qualifiers come from stats.ts (`wpblQualifiers`) and scale with the season, so
// every board that gates on them agrees about who qualifies.

// This tab has two independent axes, not one list of boards.
//
// `side` is which half of the game you're looking at. It's the reader's main choice and it
// outlives everything else: the season table splits on it, and so do the tracked boards, which
// is why no board asks the Hitting/Pitching question again one level down.
//
// `source` is where the numbers come from: the box scores we aggregate all season, the
// play-by-play read one pitch at a time, or the feed's TrackMan radar. Switching it keeps your
// side, so "Pitching → Tracked" reads as the same subject measured another way rather than a
// jump somewhere else.
//
// Ordered by how much of the season each one can speak for: Season (every game), Pitch by
// pitch (every game, one row deeper), Tracked (a handful of games, and hidden until that
// changes; see trackingWorthShowing). The pitch board is labelled "Pitch by pitch", not
// "Pitches", which beside the side named Pitching reads as "you are about to leave the
// hitters". The internal value stays 'pitches' so the board-usage analytics keep one name.
//
// FIELDING IS A THIRD SIDE TO THE SEASON TABLE AND A BOARD TO THE READER. Internally it is a side,
// because the whole table (columns, sort, qualifier, league line, phone list) is built per side and
// Fielding wants all of it. On screen it is a tab in the board row, because a third option in the
// Hitting/Pitching switch does not fit a phone: at 375px the switch, Sort and Filters came to
// 390px in a 351px row, so Hitting itself wrapped onto a second line. The board row already
// scrolls sideways and has the room. So `side` is 'fielding' exactly while the Fielding tab is
// open, the switch is hidden there (no other side applies), and every other board reads
// `boardSide`, the last of Hitting or Pitching the reader chose.
type Side = 'hitting' | 'pitching' | 'fielding'
/** The side every board other than the season tables speaks. */
type BallSide = 'hitting' | 'pitching'
type Totals = WpblBattingTotals | WpblPitchingTotals | WpblFieldingTotals
type Source = 'season' | 'bests' | 'find' | 'tracked' | 'pitches' | 'runs' | 'draft'

/** Boards that lay themselves out in two columns on a large desktop, and so take the wider
 *  page column. Everything else is one column and stays at the list measure. */
// Boards whose CONTENT is a wide multi-column grid and so earns the wider page column. Find is
// deliberately NOT one: it is a form and a pair of result cards, and at the wide column its
// controls stretch to absurd widths (a stat dropdown running the whole row) and the cards read as
// sparse. It caps at the ordinary board column instead; its results still split into two under it.
const WIDE_BOARDS = new Set<Source>(['runs', 'bests'])
type Mode = 'players' | 'teams'

// The deep-link contract: a link asks for 'hitting'/'pitching' with a column, and a legacy
// ?view=tracking URL asks for 'tracking'. Resolved onto the axes above.
type Group = 'hitting' | 'pitching' | 'tracking' | 'pitches' | 'runs' | 'findings'

// Whether this page-load has already logged an arrival at Stats. Module scope rather than a
// ref inside the component, because the tab's pane can unmount on the way out (on desktop only
// the active tab is rendered): a component-scoped flag would be born false on every visit, call
// every arrival 'open' and leave the two names measuring nothing.
let statsOpened = false

// A tracking link names no side, so it lands on whichever one the reader already had open.
function axesOf(g: Group): { side?: Side; source: Source } {
  if (g === 'tracking') return { source: 'tracked' }
  if (g === 'pitches') return { source: 'pitches' }
  if (g === 'runs') return { source: 'runs' }
  // Findings is folded into Run value (see PlayValue.tsx). The group stays in the union rather
  // than being deleted: nothing in the app constructs it, but a bookmark or a stale link still
  // can, and the honest answer is the board its cards moved to.
  if (g === 'findings') return { source: 'runs' }
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

// Since the Standard/Advanced split this order is only the Rank by sheet's; the table's
// left-to-right order is `VIEW_ORDER` below, and the column a side opens on is `HEADLINE`.
const HIT_COLS: Col<WpblBattingTotals>[] = [
  { key: 'avg', label: 'AVG', value: t => t.avg, display: t => fmtRate(t.avg), rate: true },
  { key: 'obp', label: 'OBP', value: t => t.obp, display: t => fmtRate(t.obp), rate: true },
  { key: 'slg', label: 'SLG', value: t => t.slg, display: t => fmtRate(t.slg), rate: true },
  { key: 'ops', label: 'OPS', value: t => t.ops, display: t => fmtRate(t.ops), rate: true },
  // OPS+ is spliced in after OPS at render time, so these two land right behind it: power on
  // its own, then the luck check on the average.
  { key: 'iso', label: 'ISO', value: t => t.iso, display: t => fmtRate(t.iso), rate: true },
  { key: 'babip', label: 'BABIP', value: t => t.babip, display: t => fmtRate(t.babip), rate: true },
  { key: 'hr',  label: 'HR',  value: t => t.hr },
  { key: 'rbi', label: 'RBI', value: t => t.rbi },
  { key: 'r',   label: 'R',   value: t => t.r },
  { key: 'h',   label: 'H',   value: t => t.h },
  { key: 'sb',  label: 'SB',  value: t => t.sb },
  // CS beside SB, because a steal total on its own cannot say whether the running was any
  // good, and this league runs constantly. Same reason the steal card on Run value prices it.
  { key: 'cs',  label: 'CS',  value: t => t.cs },
  { key: 'sbPct', label: 'SB%', value: t => t.sbPct, display: t => fmtPct(t.sbPct), rate: true },
  { key: '2b',  label: '2B',  value: t => t.doubles },
  { key: '3b',  label: '3B',  value: t => t.triples },
  { key: 'xbh', label: 'XBH', value: t => t.xbh },
  { key: 'tb',  label: 'TB',  value: t => t.tb },
  { key: 'bb',  label: 'BB',  value: t => t.bb },
  { key: 'so',  label: 'SO',  value: t => t.so },
  { key: 'bbPct', label: 'BB%', value: t => t.bbPct, display: t => fmtPct(t.bbPct), rate: true },
  { key: 'kPct', label: 'K%', value: t => t.kPct, display: t => fmtPct(t.kPct), rate: true, lowerBetter: true },
  { key: 'ibb', label: 'IBB', value: t => t.ibb },
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
  // How much work the outing WAS, as opposed to what it gave up. Every one of these is on the
  // feed's line, and without them the board could say a pitcher allowed two runs but not that they
  // faced nine batters or threw ninety pitches.
  { key: 'kbb',  label: 'K/BB', value: t => t.kbb, display: t => fmtTwo(t.kbb), rate: true },
  // Per batter faced rather than per inning; see `kPct` in stats.ts.
  { key: 'kPct', label: 'K%', value: t => t.kPct, display: t => fmtPct(t.kPct), rate: true },
  { key: 'bbPct', label: 'BB%', value: t => t.bbPct, display: t => fmtPct(t.bbPct), rate: true, lowerBetter: true },
  { key: 'kbbPct', label: 'K-BB%', value: t => t.kbbPct, display: t => fmtPct(t.kbbPct), rate: true },
  { key: 'strikePct', label: 'STR%', value: t => t.strikePct,
    display: t => (t.strikePct == null ? '—' : `${Math.round(t.strikePct * 100)}%`), rate: true },
  { key: 'babip', label: 'BABIP', value: t => t.babip, display: t => fmtRate(t.babip), rate: true, lowerBetter: true },
  { key: 'bf',   label: 'BF',   value: t => t.bf },
  { key: 'p',    label: 'P',    value: t => t.pitches },
  { key: 'gs',   label: 'GS',   value: t => t.gs },
  { key: 'g',    label: 'G',    value: t => t.g },
]

// Everything a fielding line carries except catcher's interference, which happened once all
// season. Fewer is better for the three a fielder is charged with (E, PB and SBA), so "best first"
// on them is the fewest, which is what the qualified filter is there to make meaningful: among
// regulars, the fewest errors is a leaderboard, and among everyone it is a list of bench players.
// SBA rather than MLB.com's SB because the player card already calls it SBA, and the same column
// should not be two abbreviations a tap apart.
const FLD_COLS: Col<WpblFieldingTotals>[] = [
  { key: 'fpct', label: 'FPCT', value: t => t.fpct, display: t => fmtRate(t.fpct), rate: true },
  { key: 'tc',  label: 'TC',  value: t => t.tc },
  { key: 'po',  label: 'PO',  value: t => t.po },
  { key: 'a',   label: 'A',   value: t => t.a },
  { key: 'e',   label: 'E',   value: t => t.e, lowerBetter: true },
  { key: 'dp',  label: 'DP',  value: t => t.dp },
  { key: 'pb',  label: 'PB',  value: t => t.pb, lowerBetter: true },
  { key: 'sba', label: 'SBA', value: t => t.sba, lowerBetter: true },
  { key: 'g',   label: 'G',   value: t => t.g },
]

// ─── Standard and Advanced ─────────────────────────────────────────────────────
// Two views of each board, the split FanGraphs and Baseball-Reference use. With the advanced
// stats added in v1.97.0 the full hitting table reached 1,833px, which scrolled sideways on
// every desktop; each view alone fits. A column can be in both (the slash line, ERA, WHIP, IP),
// because a rate stat read with no context beside it is a number with nothing to compare it to.
//
// THE ORDER IS THE ONE READERS ALREADY KNOW, and each list is left to right. Standard follows
// Baseball-Reference and MLB.com: playing time, the counting line in box-score order, the slash
// line, then the tail B-Ref ends on (TB, GDP, HBP, SH, SF, IBB). Advanced follows FanGraphs:
// discipline rates first, the slash line, then the one-number answer last (wOBA and wRC+ for
// hitters, ERA and FIP for pitchers), with B-Ref's OPS+ and ERA+ where FanGraphs puts its own
// indexes. A fan who reads those sites finds each column where their eye already goes.
//
// A key in NEITHER list is appended to Standard, so a column added later shows up somewhere
// rather than silently nowhere.
type View = 'standard' | 'advanced'
const VIEW_ORDER: Record<Side, Record<View, readonly string[]>> = {
  hitting: {
    standard: ['g', 'pa', 'ab', 'r', 'h', '2b', '3b', 'hr', 'rbi', 'sb', 'cs', 'bb', 'so',
      'avg', 'obp', 'slg', 'ops', 'tb', 'gdp', 'hbp', 'sh', 'sf', 'ibb', 'lob'],
    advanced: ['pa', 'bbPct', 'kPct', 'avg', 'obp', 'slg', 'ops', 'opsPlus', 'iso', 'xbh', 'babip',
      'sbPct', 'woba', 'wrcPlus'],
  },
  pitching: {
    standard: ['w', 'l', 'era', 'g', 'gs', 'sv', 'ip', 'h', 'r', 'er', 'hr', 'bb', 'so', 'hbp',
      'bk', 'wp', 'bf', 'p', 'whip', 'k9'],
    advanced: ['ip', 'bf', 'k9', 'kbb', 'hr9', 'kPct', 'bbPct', 'kbbPct', 'strikePct', 'whip',
      'babip', 'eraPlus', 'era', 'fip'],
  },
  // One view: nine columns fit any desktop, and there is nothing advanced to compute from a line
  // with no position and no innings on it. The empty list is what hides the view switch.
  fielding: {
    standard: ['g', 'tc', 'po', 'a', 'e', 'dp', 'fpct', 'pb', 'sba'],
    advanced: [],
  },
}
const VIEW_OPTIONS = [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced' }]
const SIDES = [{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]
function inView(side: Side, view: View, key: string): boolean {
  const order = VIEW_ORDER[side]
  if (!order.standard.includes(key) && !order.advanced.includes(key)) return view === 'standard'
  return order[view].includes(key)
}
/** A view's columns in its own order, plus (on Standard) anything neither list names. */
function orderForView<C extends { key: string }>(side: Side, view: View, cols: C[]): C[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const named = VIEW_ORDER[side][view].map(k => byKey.get(k)).filter((c): c is C => !!c)
  if (view === 'advanced') return named
  const known = new Set([...VIEW_ORDER[side].standard, ...VIEW_ORDER[side].advanced])
  return [...named, ...cols.filter(c => !known.has(c.key))]
}
/** The view a sort column lives in, preferring the one already showing. */
function viewFor(side: Side, key: string, current: View): View {
  return inView(side, current, key) ? current : current === 'standard' ? 'advanced' : 'standard'
}

// ─── the view in the address bar ──────────────────────────────────────────────

/**
 * Which board, which side and which column, mirrored into the query string.
 *
 * WHY THE QUERY AND NOT THE PATH. `urlFor` in WpblApp sets the rule the section follows: the
 * tab is the PATH, because it is a page worth indexing under its own title, and anything laid
 * OVER that page is a query param. A sorted column is the second kind. It also means this costs
 * nothing in the three places a new route would: `/wpbl/stats` is already in `_redirects`, the
 * sitemap is unchanged, and `seo.ts` builds its canonical from `path.split('?')[0]`, so every
 * permutation of these four params canonicalises back to `/wpbl/stats` and none of them can
 * reach the index as a near-duplicate.
 *
 * ONLY NON-DEFAULTS ARE WRITTEN, so the ordinary reader who never touches a control keeps a
 * clean `/wpbl/stats` in the address bar and a link they paste says only what they changed.
 *
 * `board` IS THE TAB ROW AS DRAWN, not the internal pair behind it: a reader looking at Teams
 * sees one tab called Teams, where the code sees `source: 'season'` plus `mode: 'teams'`. The
 * URL is read by people, so it spells the thing on screen.
 */
type BoardParam = 'players' | 'teams' | 'fielding' | 'bests' | 'find' | 'pitches' | 'runs' | 'tracked' | 'draft'

const STATS_PATH = '/wpbl/stats'

/**
 * The query params this board owns, named so WpblApp can carry them.
 *
 * WHY WpblApp HAS TO KNOW. `urlFor` builds a URL out of the navigation snapshot and nothing
 * else, and the effect that stamps the section's first history entry calls it on mount. So on a
 * COLD LOAD every param on the address it was opened at would be discarded in the first tick,
 * before this component has rendered once: `/wpbl/stats?board=runs` would open on Players with
 * the query gone. That is the expensive kind of failure, because switching boards writes the
 * param correctly, so a link a reader copies is right and the same link pasted back quietly lands
 * them somewhere else.
 *
 * These are not snapshot state: they are a board's own view of itself, owned and written here,
 * so the list is exported instead and `urlFor` carries whatever it finds under these names when
 * the target is this tab. See `playFragmentFor` in entryUrl.ts for the related case of the URL
 * fragment, which needs capturing rather than carrying.
 */
export const STATS_URL_PARAMS = ['board', 'side', 'sort', 'dir', 'q', 'team', 'opp', 'venue'] as const

/** Copy this board's params from one query onto another, leaving everything else alone.
 *
 *  ONE DEFINITION, used by the writer effect below and by `urlFor` in WpblApp, so a param added
 *  here cannot be carried by one and dropped by the other, which is the asymmetry that loses a
 *  board's state on a pasted link. */
export function carryStatsParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const k of STATS_URL_PARAMS) {
    const v = from.get(k)
    if (v != null) to.set(k, v)
  }
}

function boardParam(source: Source, mode: Mode, side: Side): BoardParam {
  if (source !== 'season') return source as BoardParam
  if (side === 'fielding') return 'fielding'
  return mode === 'teams' ? 'teams' : 'players'
}

function boardAxes(board: string | null): { source: Source; mode: Mode; side?: Side } | null {
  switch (board) {
    case 'players': return { source: 'season', mode: 'players' }
    case 'fielding': return { source: 'season', mode: 'players', side: 'fielding' }
    case 'teams':   return { source: 'season', mode: 'teams' }
    case 'bests':   return { source: 'bests', mode: 'players' }
    case 'find':    return { source: 'find', mode: 'players' }
    case 'pitches': return { source: 'pitches', mode: 'players' }
    case 'runs':    return { source: 'runs', mode: 'players' }
    case 'draft':   return { source: 'draft', mode: 'players' }
    case 'tracked': return { source: 'tracked', mode: 'players' }
    // Anything else is a hand-edited or stale link, and the honest answer to one of those is
    // the default board rather than a blank screen.
    default: return null
  }
}

/** What the address bar is asking for, or nulls. Read once at mount: after that the reader's
 *  own controls are the truth and this module writes the URL rather than reading it. */
function axesFromQuery(): {
  source?: Source; mode?: Mode; side?: Side; sortKey?: string; sortAsc?: boolean
  find?: string | null; findTeam?: string | null; findOpp?: string | null; findVenue?: FinderVenue
} {
  if (typeof window === 'undefined') return {}
  // Only on the stats tab. A player modal opened from here owns the path, and the axes on it
  // belong to the entry underneath rather than to the page being shown.
  if (window.location.pathname.replace(/\/+$/, '') !== STATS_PATH) return {}
  const q = new URLSearchParams(window.location.search)
  const board = boardAxes(q.get('board'))
  const side = q.get('side')
  const dir = q.get('dir')
  const venue = q.get('venue')
  return {
    ...(board ?? {}),
    side: board?.side ?? (side === 'hitting' || side === 'pitching' ? side : undefined),
    sortKey: q.get('sort') ?? undefined,
    sortAsc: dir === 'asc' ? true : dir === 'desc' ? false : undefined,
    // The Find board's question. Decoded against the side the URL names, since the fields
    // differ between the two and a hitting condition means nothing on a pitching board.
    find: q.get('q'),
    findTeam: q.get('team'),
    findOpp: q.get('opp'),
    findVenue: venue === 'home' || venue === 'away' ? (venue as FinderVenue) : undefined,
  }
}

// Resolve a requested column into the sort state the table should adopt. Direction comes from
// the column itself (`lowerBetter` → ascending, so ERA/WHIP lead with the best), which is why a
// link only has to name a column and never a direction. An unknown or absent key falls back to
// the side's `HEADLINE` column.
//
// The columns spliced in at render time (they need the league's own weights, or the reader's
// ERA basis) are not in HIT_COLS / PIT_COLS, so without this list a shared `?sort=fip` link was
// "unknown" and landed on ERA. Each maps to its `lowerBetter`. A key added to hitCols / pitCols
// and not here still renders and sorts on click, it just cannot be linked to.
const DERIVED_SORTS: Record<Side, Record<string, boolean>> = {
  hitting: { lob: false, opsPlus: false, woba: false, wrcPlus: false },
  pitching: { eraPlus: false, fip: true, k9: false, hr9: true },
  fielding: {},
}
// The column each side opens on. ONE NAME, read by the cold load, the side switch and the view
// switch alike: the cold load used to take the first column in HIT_COLS (AVG) while the two
// switches hard-coded OPS, so the board opened on one headline and came back from Pitching on
// another. Both views carry both of these, which is what lets the view switch fall back to them.
const HEADLINE: Record<Side, string> = { hitting: 'ops', pitching: 'era', fielding: 'fpct' }

function defaultSort(side: Side, key?: string): { key: string; asc: boolean } {
  if (key && Object.prototype.hasOwnProperty.call(DERIVED_SORTS[side], key)) return { key, asc: DERIVED_SORTS[side][key] }
  const cols: Col<never>[] = (side === 'pitching' ? PIT_COLS : side === 'fielding' ? FLD_COLS : HIT_COLS) as unknown as Col<never>[]
  const col = (key ? cols.find(c => c.key === key) : undefined) ?? cols.find(c => c.key === HEADLINE[side])!
  return { key: col.key, asc: !!col.lowerBetter }
}

// What each abbreviation stands for, for the stat picker. A sheet that offers "SLG, OPS, OPS+"
// and nothing else is a vocabulary test, and this section's audience is new to the league: the
// point of the picker is that a reader who knows what an RBI is can find their way around it.
//
// Per side, because the same three letters are two different stats depending on who is being
// measured. SO is a batter's failure and a pitcher's work; H, R and HR are things a hitter
// does and things a pitcher allows. Writing "Strikeouts" for both would be the sort of nearly
// right that reads as carelessness to anyone who follows the sport.
const HIT_NAMES: Record<string, string> = {
  avg: 'Batting average', obp: 'On-base', slg: 'Slugging', ops: 'On-base plus slugging',
  opsPlus: 'OPS vs the league', woba: 'Weighted on-base average',
  wrcPlus: 'Runs created vs the league', iso: 'Isolated power', babip: 'Average on balls in play',
  sbPct: 'Stolen base success rate', bbPct: 'Walks per plate appearance',
  kPct: 'Strikeouts per plate appearance', ibb: 'Intentional walks', hr: 'Home runs', rbi: 'Runs batted in', r: 'Runs', h: 'Hits',
  sb: 'Stolen bases', cs: 'Caught stealing', '2b': 'Doubles', '3b': 'Triples', xbh: 'Extra-base hits',
  tb: 'Total bases', bb: 'Walks', so: 'Strikeouts', hbp: 'Hit by pitch',
  gdp: 'Grounded into a double play', sf: 'Sacrifice flies', sh: 'Sacrifice bunts',
  pa: 'Plate appearances', ab: 'At-bats', g: 'Games', lob: 'Runners left on base',
}
const PIT_NAMES: Record<string, string> = {
  era: 'Earned run average', whip: 'Walks + hits per inning', eraPlus: 'ERA vs the league',
  w: 'Wins', l: 'Losses', sv: 'Saves', so: 'Strikeouts', ip: 'Innings pitched',
  h: 'Hits allowed', r: 'Runs allowed', er: 'Earned runs', bb: 'Walks',
  hr: 'Home runs allowed', hbp: 'Batters hit by a pitch', wp: 'Wild pitches', bk: 'Balks',
  kbb: 'Strikeouts per walk', kPct: 'Strikeouts per batter faced', bbPct: 'Walks per batter faced',
  kbbPct: 'Strikeout rate minus walk rate', babip: 'Average allowed on balls in play',
  fip: 'Fielding independent pitching', strikePct: 'Share of pitches thrown for strikes',
  bf: 'Batters faced', p: 'Pitches thrown', gs: 'Games started', g: 'Games',
}
const FLD_NAMES: Record<string, string> = {
  fpct: 'Fielding percentage', tc: 'Total chances', po: 'Putouts', a: 'Assists', e: 'Errors',
  dp: 'Double plays turned', pb: 'Passed balls', sba: 'Stolen bases allowed',
  g: 'Games played, in any role',
}

/** What each column stands for on one side, with the basis-dependent ones spelled out. Shared by
 *  the Rank by sheet and the table's headings, so the two explain a column the same way. */
function statNames(side: Side, eraBasis: EraBasis): Record<string, string> {
  if (side === 'hitting') return HIT_NAMES
  if (side === 'fielding') return FLD_NAMES
  return {
    ...PIT_NAMES,
    era: `Earned run average, per ${eraBasis}`,
    // The strikeout RATE. Its key is `k9` and its label is built at render time, so a static
    // entry in PIT_NAMES could not carry the denominator and a lookup on the key would find
    // nothing, leaving "K/7" unexplained in the one place a reader is asking what a column means.
    k9: `Strikeouts per ${eraBasis} innings`,
    hr9: `Home runs allowed per ${eraBasis} innings`,
  }
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
// so the line leads with PA (or innings, for a pitcher) and follows with what they did with
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
  fielding: {
    rate: ['tc', 'e', 'g', 'fpct'],
    counting: ['fpct', 'tc', 'e', 'g'],
  },
}

// How much of the list a phone gets before it asks. Ten is a leaderboard; thirty-four is a
// directory, and the difference matters more than the rows do: everything UNDER an uncapped list
// (the switch to the full grid, the count) is two thousand pixels down, so in practice nobody
// finds it. A capped list puts the whole board and everything it offers on one screen and a bit,
// and the reader who wants the rest asks for them.
const LIST_CAP = 10

// Phones get the ranked list; this is the escape hatch for the reader who wants the grid
// anyway, remembered because it is a preference about how someone reads rather than a state
// of the page. Off by default: see the list itself for why.
const FULL_TABLE_KEY = 'wpbl_stats_full_table'
function readFullTable(): boolean {
  try { return localStorage.getItem(FULL_TABLE_KEY) === '1' } catch { return false }
}

/** A row's place on the board: its number, and whether it shares it. */
interface RankMark { n: number; tied: boolean }

/** "T-3" for a shared place, the leaderboard convention; "T3" run together read as a code rather
 *  than a tie. The prefix is set a touch smaller so a tied two-digit rank still fits: in the table
 *  it runs left into the name cell's padding rather than widening the rank column, which would take
 *  the room from the names on a phone. */
function RankText({ rank }: { rank: RankMark }) {
  // Centred on the number rather than sitting on its baseline: the smaller "T-" set on the same
  // line hangs at the top of it in a flex parent and reads as a superscript.
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {rank.tied && <Box component="span" sx={{ fontSize: '0.8em', lineHeight: 1 }}>T-</Box>}
      <Box component="span" sx={{ lineHeight: 1 }}>{rank.n}</Box>
    </Box>
  )
}

/** Fades what it wraps, for a row under the qualifying bar. On the CONTENT, never on a cell:
 *  the name cell and the phone's sort cell are sticky and paint an opaque background so the
 *  columns scrolling underneath stay hidden, and opacity on the cell would fade that too. */
const FADED = 0.5

// One table row, normalized so the same table renders a player or a whole team.
interface Row {
  key: string
  team: WpblTeam | undefined       // for the badge (a player's club, or the team itself)
  label: string                    // player short name, or full team name
  /** The player's name as the league spells it. `label` is already abbreviated to fit the
   *  table's 84px name column, and the portrait lookup is keyed on the real one. */
  fullName?: string
  shortLabel?: string              // teams mode on a phone: the nickname alone ('Firebells')
  sublabel?: string                // player position (players only)
  totals: Totals
  qualified: boolean
  onClick?: () => void
  /** Players only: the props that make this row's name a real <a href> to her page.
   *  A team row has no URL to point at, so it stays a plain onClick. */
  link?: WpblPlayerLinkProps
}

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Capped so it doesn't sprawl on huge monitors.
const FULL_BLEED_W = STATS_FULL_BLEED_W

// The chrome pinned above this view: the toolbar, which above a phone carries the section's tabs
// too (ToolbarNav), so its height is the whole of it. 0 on a phone, where the toolbar scrolls away
// and the section nav is the fixed bottom bar, pinning nothing at the top; what that takes at the
// BOTTOM is `BOTTOM_NAV_SPACE`, which the board's cap subtracts on its own. There was a second term
// for the WPBL pill row until v1.124.0 moved the tabs into the toolbar.
const PINNED_CHROME = 'var(--app-header-h, 0px)'
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
// EDGE TO EDGE ON A PHONE, WITH THE GUTTER AS PADDING. At the cards' width the bar would stop
// 12px short of each side of the screen, so its background and the hairline under it would end
// in mid-air while the nav bar directly above runs the whole way across. Content still lines up
// with the cards below, because the 12px the bar gives back as padding is exactly the gutter the
// cards keep as margin.
//
// PHONE ONLY, and `100vw` is the reason. It measures the viewport INCLUDING a classic
// scrollbar, so on a desktop with one it is a dozen pixels wider than the page can hold and
// the whole site gains a horizontal scrollbar. Touch scrollbars are overlaid and take no
// width, so the phone is exactly where the unit is safe. It is also the only place the fix is
// wanted: the nav above goes full-bleed on xs alone (`mx: { xs: -2, sm: 0 }`), so above sm
// there is no mismatch to correct.
const FULL_BLEED_GUTTER = 12
const BAR_W = `min(${1540 + 2 * FULL_BLEED_GUTTER}px, calc(100vw))`
/** Where the board pins: the bottom of the control bar, which is itself pinned under the
 *  shell's chrome. `--wpbl-stats-bar-h` is published by the bar (see the effect that sets it).
 *
 *  IT IS ONLY EVER A STICKY OFFSET, never a height, and that is what makes measuring it safe.
 *  A cap derived from a measurement can render a board that is not there; an offset derived
 *  from one can at worst pin a few pixels high or low. */
const BOARD_TOP = `calc(${PINNED_CHROME} + var(--wpbl-stats-bar-h, 0px))`

/** What is left under the board once everything that can change size is measured: the card's
 *  own two borders and the page's bottom gutter, plus two pixels of slack so a rounding error
 *  cannot tip the board past the point where it stays pinned.
 *
 *  TWO VALUES, because the site footer steps aside for the phone's player table (see the effect
 *  that sets `data-wpbl-stats-table`), and the 32 between them is the footer's top margin, which
 *  goes with it. Read off the same flag that hides the footer, so the two cannot be out of step.
 *  `--wpbl-foot-h` measures whatever footer is laid out, and reads 0 while it is hidden.
 *
 *  THE BOARD'S OWN FOOTER IS NOT IN HERE ANY MORE. It was, as a constant, until v1.98.0 gave the
 *  phone's full table a second row (the Standard/Advanced switch) and the constant came up 25px
 *  short. Its height depends on the text size and on whether the count wraps, not on the board,
 *  so it is measured and published as `--wpbl-board-foot-h` beside the site footer's.
 *
 *  STILL A CONSTANT FOR THE REST, BECAUSE IT IS FURNITURE. Deriving it from the document's
 *  height would mean reading the swipe pager's floor and any blank the board is itself leaving,
 *  so the board's height would feed back into its own cap and iterate away to nothing. */
const BOARD_TAIL_PX = 52
const BOARD_TAIL_BARE_PX = 20

/** The header (27px) and five rows (43px each): the least that is still a table.
 *
 *  THE FLOOR BEATS THE FIT, so where it binds the headers can slide behind the bar at the bottom
 *  of the page again. It was 320 until the bottom nav was counted, which left a 667px phone (an
 *  iPhone SE) needing 271 and getting 320, headers gone. At 240 the fit wins on any phone from
 *  about 636px tall. */
const MIN_BOARD_PX = 240

/** Full-bleed for a box that ALSO has to stick. Centred with a margin rather than
 *  `left: 50%` + a transform, because sticky spends `left` on its own threshold: given the
 *  centring rule, the board would try to stick sideways. Same reason the bar has its own. */
const fullBleedStickyCardSx = {
  width: FULL_BLEED_W,
  marginLeft: `calc(50% - (${FULL_BLEED_W}) / 2)`,
} as const

const fullBleedStickySx = {
  width: { xs: BAR_W, sm: FULL_BLEED_W },
  marginLeft: { xs: `calc(50% - (${BAR_W}) / 2)`, sm: `calc(50% - (${FULL_BLEED_W}) / 2)` },
  px: { xs: `${FULL_BLEED_GUTTER}px`, sm: 0 },
} as const

// The two frozen columns are separate table cells, so the join between them is a seam, and a
// fractional device pixel can open it into a 1px window onto the stats scrolling underneath.
//
// NOT CLOSED BY OVERLAPPING. Sticking the pinned column a couple of pixels left of where the
// table puts it covers the seam at rest, but sticky does not clamp until you have scrolled past
// its threshold, so the column would creep those pixels left over the start of every horizontal
// scroll, in the one place the design promises nothing moves. So the offset is exact
// (`left: nameW`, precisely the cell's own offsetLeft, since the collapsed border adds nothing),
// and the seam is covered by something that cannot move anything, drawn by the pinned column
// over the last of the name column beside it.
//
// NOT A BOX-SHADOW, WHICH IS THE TRAP HERE. `box-shadow` does not apply to internal table
// elements when `border-collapse` is `collapse`, and this table collapses its borders. A
// shadow set on one of these cells computes, inspects and reads back exactly as if it worked,
// and paints nothing at all. That is also why FROZEN_EDGE below is a pseudo-element.
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

// Fixed width of the frozen Player column on mobile, so the pinned sort-value column can sit
// flush against it with a constant `left`: no measurement to drift and let the two frozen
// columns overlap the name when scrolled. Names ellipsize within it.
//
// IN REM, because the column is reserving room for a name: a box sized in px around type sized
// in rem holds what it held while the text inside it grows (see CLAUDE.md on px in /wpbl). The
// stats table shortens names to "F. Last" in JS, and the few surnames still too long for it
// (Leguizamon, Geldenhuis) ellipsize ON PURPOSE: every rem added here is a stat column pushed
// off a phone screen, and the full name is one tap away.
//
// The same rem on `left` as on the width, and that is load-bearing rather than tidy. These two
// numbers are the same number by construction (see the note above on the frozen columns' seam:
// the pinned column's `left` is precisely the name cell's own offsetLeft), so they have to
// scale together or the two frozen columns drift apart and overlap the name under a scroll.
const NAME_W = '9.375rem'
// NAME_W minus rank + badge + gaps + padding, so the column can't grow past NAME_W.
//
// An APPROXIMATION, deliberately on the safe side. What is subtracted is not all type: the
// badge and the padding are chrome and hold still when the reader enlarges text, so the inner
// budget should really grow by more than the type does, not exactly with it. Scaling it in
// step therefore leaves it a few pixels tight at Large text, which spends one more character
// of a name than it strictly must. That is the right direction to be wrong in: too small only
// ellipsizes a hair early, while too large lets the column outgrow NAME_W and take the sticky
// offset with it.
// 5.125 since the rank column grew by 0.125rem for tied ranks; the two move together.
const NAME_INNER_MAX = '5.125rem'
/** The table's rank column. In rem, since it reserves room for a number (see NAME_W). */
const RANK_W = '1.25rem'
/** The focus ring for a column heading, drawn INSIDE the cell: the headings sit at the top of a
 *  scroll box, which would clip the usual ring that sits outside. */
const HEAD_FOCUS = {
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
} as const
// Teams mode gets a narrower frozen column. There are only four rows, each with a distinct
// badge, and the nickname alone identifies them, so the width a player's full name needs is
// dead space here, and every pixel of it is a stat column pushed off a phone screen.
// No rank number in this mode (see the row), so the budget is padding + badge + gap + label.
const TEAM_NAME_W = '6.5rem'
const TEAM_NAME_INNER_MAX = '3.875rem'

/** What the table should be showing, when it's opened from somewhere else (a "Full stats"
 *  link). `token` increments on every such jump: see the effect below. */
export interface WpblStatsFocus {
  group: Group
  sortKey?: string  // a HIT_COLS / PIT_COLS key; falls back to the group's default column
  /** 'teams' opens the four-team comparison instead of the player board. */
  mode?: Mode
  /** Pre-select the team filter chip (players mode only). null clears it. */
  teamId?: string | null
  /** Force the Qualified filter on or off (players mode only). Left alone when omitted, so
   *  an ordinary jump still lands on whatever the season default is.
   *
   *  FALSE IS THE INTERESTING ONE, and the team page's roster link is why it exists. That
   *  card lists the whole roster, so "Full stats" landing on the qualified board would drop
   *  most of the names the reader had just been looking at: the door out of a 30-player list
   *  opening onto a 9-player one, with nothing on screen saying a filter had been applied. */
  qualified?: boolean
  /** A player to pick out on the board: a rank pressed on their card lands on the table sorted by
   *  that stat with their row tinted and scrolled to, the way MLB's stat card does. */
  playerId?: string
  token: number     // 0 = nothing requested yet
}

// Placeholder while a sub-tab's chunk arrives. These views render in place under the group
// bar, so a centred spinner in the content area is what the reader already sees while their
// data loads, and the switch reads as slow rather than broken.
function SubViewFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={26} sx={{ color: 'var(--wpbl-accent-fg)' }} />
    </Box>
  )
}

/** This tab while the section's first read is in flight: its title, its control bar and its table,
 *  at the same full-bleed measure the loaded tab draws them at, so nothing moves when it lands.
 *  Desktop measurements over the 1.25 scale, in chromePx. See TabSkeleton in WpblApp.tsx. */
export function StatsSkeleton() {
  return (
    <Box sx={{ flexGrow: 1 }}>
      <TabTitle sx={{ ...fullBleedSx, mb: 1 }}>WPBL Stats</TabTitle>
      {/* The bar and the table touch: the table's top border tucks under the bar's last pixel. */}
      {/* A phone stacks the board tabs over the filters, so its bar is its own number. */}
      <Skeleton variant="rounded" sx={{ ...fullBleedSx, height: { xs: '95px', sm: chromePx(94) }, borderRadius: 2 }} />
      <Skeleton variant="rounded" sx={{ ...fullBleedSx, height: { xs: '593px', sm: chromePx(546) }, borderRadius: 2, mt: '-1px' }} />
    </Box>
  )
}

export default function WpblStatsView({
  teams, games, focus, active = true, newBoards, onBoardSeen, onOpenPlayer, onOpenTeam,
  onOpenGame,
}: {
  teams: WpblTeam[]
  games: WpblGame[]
  focus?: WpblStatsFocus
  /** Board keys that should wear a "new here" dot on their chip. The same news is one dot on
   *  the Stats pill a level up; these are the half that points the rest of the way to each
   *  board. Owned by WpblApp, which reads the seen flags. */
  newBoards?: ReadonlySet<string>
  /** Called once the reader has actually reached one of those boards, by any route. Owned by
   *  WpblApp, which writes the seen flag and drops the board from `newBoards`. */
  onBoardSeen?: (key: string) => void
  // Whether this pane is the one on screen. The pager keeps visited tabs mounted, so without
  // it every return to Stats after the first would go unrecorded (see the board log below).
  active?: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
  /** Opens a game page. Only the Bests board wants one: every other board on this tab ranks
   *  people over a season, and that one ranks single NIGHTS, so each of its rows has a second
   *  destination. Optional, so the tab still renders in a test or in isolation; the link is a
   *  real href either way and keeps working under a modified click. */
  onOpenGame?: (g: WpblGame) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of flashing the spinner.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [loading, setLoading] = useState(() => getCachedWpblAllPlayers() == null || getCachedWpblAllLines() == null)
  // Null until it lands. Read on mount but never awaited by the table: only the Fielding side
  // draws it, and the most-read tab's first paint should not wait on a side most visits never open.
  const [fielding, setFielding] = useState<WpblFieldingLine[] | null>(() => getCachedWpblAllFielding())
  // The name column is a fixed width, so the default character threshold is the wrong test: it
  // would let a 12-character "Jamie Mackay" through whole to be cut to "Jamie Mac…" while a
  // 13-character "Denae Benites" became "D. Benites". 0 abbreviates every phone row alike.
  const shortName = useWpblName(0)
  const playerLink = useWpblPlayerLink()
  const isNarrow = useMediaQuery('(max-width:600px)')
  const { basis: eraBasis, offLeague: eraOffLeague, fmtEra } = useEraBasis()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Horizontal-scroll edges: they drive the frozen-column shadow (not at start) and the
  // right-edge fade (not at end), so it's obvious the table scrolls sideways.
  const [scrollX, setScrollX] = useState({ atStart: true, atEnd: true })

  // A deep link picks the starting axes; everything else defaults to the season hitting table.
  const seedAxes = axesOf(focus?.group ?? 'hitting')
  // A tracking link names no side, so in-session it keeps whichever one the reader had. On a
  // cold load there's nothing to keep, and an old ?view=tracking bookmark means the velocity
  // boards, so seed those rather than dropping it somewhere it has never been.
  // THE ADDRESS BAR WINS ON A COLD LOAD, and `focus` wins after that. They answer two different
  // questions: `focus` is an in-app jump ("Full stats" on a club), which arrives with a bumped
  // token and should always be obeyed; this is what the reader asked for by opening the link,
  // and it only exists at mount. Read once, for that reason.
  const fromUrl = useRef(axesFromQuery()).current
  const [side, setSide] = useState<Side>(
    fromUrl.side ?? seedAxes.side ?? (seedAxes.source === 'tracked' ? 'pitching' : 'hitting'))
  const [source, setSource] = useState<Source>(fromUrl.source ?? seedAxes.source)
  // The last of Hitting and Pitching the reader chose, for every board but Fielding and for the
  // switch to come back to on the way out of it.
  const [ballSide, setBallSide] = useState<BallSide>(
    fromUrl.side === 'pitching' || (!fromUrl.side && seedAxes.side === 'pitching') ? 'pitching' : 'hitting')
  const boardSide: BallSide = side === 'fielding' ? ballSide : side
  const [mode, setMode] = useState<Mode>(fromUrl.mode ?? 'players')
  // THE FIND BOARD'S QUESTION, seeded from the address bar exactly once, like the axes above.
  // `scope` is NOT held in here: the season slice is a control the whole tab shares (the chips
  // in the bar, the sheet on a phone), and duplicating it would give the board two answers to
  // one question. It is folded in where the query is used instead.
  const [findQuery, setFindQuery] = useState<Omit<FinderQuery, 'scope'>>(() => ({
    conditions: decodeFinderQuery(
      fromUrl.find ?? null,
      fromUrl.side === 'pitching' || (!fromUrl.side && seedAxes.side === 'pitching') ? 'pitching' : 'hitting',
    ),
    teamId: fromUrl.findTeam || null,
    oppId: fromUrl.findOpp || null,
    venue: fromUrl.findVenue ?? 'any',
  }))
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
  // Is the control bar holding content under itself? Sticky gives no way to ask, so compare
  // the bar with a zero-height marker sitting immediately above it: the two tops agree until
  // the bar is pinned and the page has scrolled on without it. Cheaper than reading the
  // resolved `top` off the CSS variables on every scroll event, and it needs no threshold.
  //
  // A SIBLING MARKER, NOT THE BAR'S PARENT. Anything added above the bar inside the parent (the
  // page's <h1> is one) shifts the parent's top, so a parent comparison would be true at rest and
  // the bar would wear its pinned edge on a page nobody had scrolled.
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

  /**
   * WHICH SLICE OF THE SEASON THE BOARDS SHOW.
   *
   * DEFAULT IS REGULAR, EVEN DURING THE POSTSEASON, and that is the deliberate choice. "2026
   * stats" means the 30-game season everyone played; the bracket is 11 games at most and a
   * finalist plays 8. Defaulting to the postseason during it would open the section's
   * most-read tab on a leaderboard built from one or two games, where the rate-title
   * qualifier cannot activate and the top of every board is whoever went 2-for-3 last night.
   * The playoffs are worth having, as a slice a reader asks for.
   */
  const [scope, setScope] = useState<SeasonScope>('regular')

  /** Only offer the switch once there is a postseason to switch to. */
  const hasPostseason = useMemo(
    () => games.some(g => isPostseasonGame(g) && g.status === 'final'), [games])
  // A postseason that has not started yet must not strand a reader on an empty board if the
  // scope was set from a previous session or a re-render.
  useEffect(() => { if (!hasPostseason && scope !== 'regular') setScope('regular') }, [hasPostseason, scope])

  const qual = useMemo(() => wpblQualifiers(teams, games, scope), [teams, games, scope])
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
    // Any route onto a newly shipped board retires its dot, not just a tap on the chip: a
    // ?board= link and the back button both land here without going through selectBoard.
    if (source === 'bests' || source === 'find') onBoardSeen?.(source)
  }, [source, onBoardSeen])
  const [trackedSeen, setTrackedSeen] = useState(seedAxes.source === 'tracked')
  useEffect(() => { if (source === 'tracked') setTrackedSeen(true) }, [source])
  const trackedOffered = showTracked || trackedSeen
  // The position each player has actually been playing, for the leaderboard sublabels.
  const positionIndex = useMemo(() => buildPositionIndex(lines.batting, games), [lines.batting, games])
  const [qualified, setQualified] = useState(() => qual.active)
  // `defaultSort` validates the key it is handed and falls back to the board's own default, so
  // a stale or hand-edited ?sort= lands on a sensible column rather than an empty sort.
  const [sortKey, setSortKey] = useState(
    () => defaultSort(fromUrl.side ?? seedAxes.side ?? 'hitting', fromUrl.sortKey ?? focus?.sortKey).key)
  const [sortAsc, setSortAsc] = useState(
    () => fromUrl.sortAsc ?? defaultSort(fromUrl.side ?? seedAxes.side ?? 'hitting', fromUrl.sortKey ?? focus?.sortKey).asc)
  // Not in the address bar: it follows the sort, which is. A link sorted by wRC+ opens on
  // Advanced because that is the only view with wRC+ in it.
  const [view, setView] = useState<View>(() => viewFor(side, sortKey, 'standard'))
  // Whatever moved the sort (the Rank by sheet, a link, a side switch), the sorted column has to
  // be on screen, or the board is ranked by a number nobody can see.
  useEffect(() => { setView(v => viewFor(side, sortKey, v)) }, [side, sortKey])
  // The other direction: a reader choosing a view whose columns do not include the sort. Re-sort
  // on that side's headline stat, which both views carry, rather than bouncing them back.
  const switchView = (v: View) => {
    if (v === view) return
    setView(v)
    if (!inView(side, v, sortKey)) {
      const next = defaultSort(side)
      setSortKey(next.key); setSortAsc(next.asc)
    }
  }

  // ── What board is being read ─────────────────────────────────────────────────
  // Stats is the most-opened tab in the section, and a path count cannot tell its boards apart,
  // so each board change is logged. Imperatively, at each place the board changes, rather than
  // from an effect on the axes, because the useful part is *why* it changed and only the caller
  // knows that.
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
  // The player a rank on their card came here for. Held WITH the board it was asked on and drawn
  // only while that board is still showing, so the reader's own next sort or side switch drops it
  // without anything having to remember to clear it.
  const [picked, setPicked] = useState<{ id: string; side: string; sortKey: string } | null>(null)

  // Re-focus the table whenever another surface sends us here. Keyed on `token`, NOT on the
  // group/column values: this panel stays mounted once visited, so seeding state at mount is
  // not enough (a second jump would be a no-op), while reacting to the values alone would
  // fight the reader's own sorting on every unrelated re-render. A token bump means "the
  // reader just asked for this view" and nothing else does.
  const requested = focus?.token ?? 0
  useEffect(() => {
    if (!focus || requested === 0) return
    const axes = axesOf(focus.group)
    // A link names Hitting or Pitching or no side at all, and every one of them leaves Fielding:
    // a side-less link (Tracked, Run value) lands on the switch's last side, not a hidden switch.
    const linkSide: BallSide = axes.side === 'pitching' || axes.side === 'hitting' ? axes.side : ballSide
    setSide(linkSide); setBallSide(linkSide)
    setSource(axes.source)
    // A link can also ask for the teams board, for the player board already narrowed to one
    // club, or for the qualified filter off: the states the team page links into. All three
    // are left alone when the link doesn't mention them, so an ordinary jump is unaffected.
    if (focus.mode) setMode(focus.mode)
    if (focus.teamId !== undefined) setTeamId(focus.teamId)
    if (focus.qualified !== undefined) setQualified(focus.qualified)
    // The card's ranks are regular-season ranks, so the board they open is too.
    if (focus.playerId) setScope('regular')
    linkLogged.current = true
    logBoard('link', { side: axes.side, source: axes.source, mode: focus.mode })
    if (axes.source !== 'season') return // the tracked boards and draft have nothing to sort
    const next = defaultSort(axes.side ?? 'hitting', focus.sortKey)
    setSortKey(next.key)
    setSortAsc(next.asc)
    setPicked(focus.playerId ? { id: focus.playerId, side: axes.side ?? 'hitting', sortKey: next.key } : null)
    // Once per jump: `requested` is the jump's token, and `focus` arrives with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // On arriving at the tab only; logBoard reads the board showing at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Revalidate on mount, but skip the DB round trip entirely when the shared cache is
  // still fresh, so a quick swipe out and back is instant and silent. Box scores move
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
  useEffect(() => {
    let cancelled = false
    // An empty array rather than null on failure, so the side says "No stats yet" instead of
    // spinning for the rest of the visit.
    fetchWpblAllFielding().then(f => { if (!cancelled) setFielding(f) })
      .catch(() => { if (!cancelled) setFielding(prev => prev ?? []) })
    return () => { cancelled = true }
  }, [])

  // wOBA's weights come from the play log, which this board otherwise never reads. Fetched on its
  // own and never awaited by the table: it is the section's slowest read, and gating the most-read
  // tab's first paint on two columns would make every visit slower for them. Until it lands those
  // two columns read as a dash. The Run value board shares the cache, so a reader who has been
  // there pays nothing.
  const [rvPlays, setRvPlays] = useState(() => getCachedWpblAllRunValuePlays())
  useEffect(() => {
    let cancelled = false
    fetchWpblAllRunValuePlays().then(p => { if (!cancelled) setRvPlays(p) }).catch(() => { /* columns stay dashed */ })
    return () => { cancelled = true }
  }, [])
  // FIP's weights come from the same pass, and so dash until it lands, rather than falling back
  // to MLB's: a column whose numbers change under the reader once the plays arrive would be
  // worse than one that fills in.
  const rvValues = useMemo(() => {
    if (!rvPlays || rvPlays.length === 0) return null
    return playRunValues(rvPlays, games, buildRunExpectancy(rvPlays, games))
  }, [rvPlays, games])
  const wWeights = useMemo(() => (rvValues ? wobaWeights(rvValues) : null), [rvValues])
  const fWeights = useMemo(() => (rvValues ? fipWeights(rvValues) : null), [rvValues])

  // OPS+ normalizes a hitter's OBP+SLG to the league (100 = league average, 150 = 50%
  // better). It needs league-wide rate context, so build the hitting columns in-component
  // with the league OBP/SLG closed over — computed from every batting line regardless of the
  // team/qualified filters, since the baseline is the whole league. No park factors: the
  // classic formula includes them, but this league's single-season, unmeasured parks give no
  // reliable adjustment, so we omit it (implicitly 1.0). Sits right after OPS.
  const hitCols = useMemo<Col<WpblBattingTotals>[]>(() => {
    // The baseline is the same slice as the rows it ranks, or a playoff hitter's OPS+ is
    // measured against a regular-season league they are not being compared with.
    const lg = sumBatting(lines.batting, games, scope)
    const lgObp = lg.obp, lgSlg = lg.slg
    const opsPlus = (t: WpblBattingTotals): number | null =>
      t.obp != null && t.slg != null && lgObp != null && lgObp > 0 && lgSlg != null && lgSlg > 0
        ? 100 * (t.obp / lgObp + t.slg / lgSlg - 1)
        : null
    const wCtx = wobaContext(lg, wWeights)
    const cols = [...HIT_COLS]
    // Team rows only. Player LOB isn't reported by the feed, so on the player board this
    // column would be a solid stripe of dashes pretending to be a stat.
    if (mode === 'teams') {
      cols.splice(cols.findIndex(c => c.key === 'g'), 0, {
        key: 'lob', label: 'LOB',
        value: t => t.lob,
        // Never the default `String(v ?? 0)`: an unreported LOB must read as "unknown",
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
    }, {
      // After OPS+ because they answer the same question better: OPS adds two rates with different
      // denominators and weighs a point of OBP the same as a point of SLG, which undersells walks.
      // Weighted by this league's own run values; see derive/woba.ts.
      key: 'woba', label: 'wOBA',
      value: t => woba(t, wWeights, wCtx),
      display: t => fmtRate(woba(t, wWeights, wCtx)),
      rate: true,
    }, {
      key: 'wrcPlus', label: 'wRC+',
      value: t => wrcPlus(t, wWeights, wCtx),
      display: t => { const v = wrcPlus(t, wWeights, wCtx); return v == null ? '—' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.batting, mode, games, scope, wWeights])

  // ERA+ mirrors OPS+ for pitchers: league ERA over the pitcher's ERA, ×100 (100 = league
  // average, higher is better; it inverts ERA, so unlike ERA it sorts descending). No
  // park factor, same reasoning as OPS+. A 0.00 ERA has no finite ratio, so it reads "∞" and
  // sorts to the top rather than dashing to the bottom. Sits right after ERA.
  const pitCols = useMemo<Col<WpblPitchingTotals>[]>(() => {
    const lgTotals = sumPitching(lines.pitching, games, scope)
    const lgEra = lgTotals.era
    const fipC = fipConstant(lgTotals, fWeights)
    const eraPlus = (t: WpblPitchingTotals): number | null => {
      if (t.era == null || lgEra == null || lgEra <= 0) return null
      return t.era === 0 ? Infinity : 100 * lgEra / t.era
    }
    const cols = [...PIT_COLS]
    const eraIdx = cols.findIndex(c => c.key === 'era')
    // ERA is stored on the league's own basis (`ERA_BASIS_CANONICAL` in stats.ts) and shown on
    // whatever the reader chose. Swapped in here rather than in PIT_COLS because that list is a
    // module constant with no reader to ask. `value` is left on the stored number on purpose: the
    // sort is identical either way, and leaving it alone keeps ERA+ below reading the same figure
    // the league does.
    cols[eraIdx] = { ...cols[eraIdx], display: t => fmtEra(t.era) }
    // The strikeout rate belongs beside ERA for the same reason ERA is swapped in here: it is
    // stored on the canonical basis and shown on whatever the reader chose, so even its LABEL
    // is not knowable in a module constant, which is why `kRateLabel` builds it. Do not write
    // 'K/9' or 'K/7' anywhere: the heading follows the league's basis. `value` stays on the stored
    // number, which sorts identically.
    const soIdx = cols.findIndex(c => c.key === 'so')
    cols.splice(soIdx + 1, 0, {
      key: 'k9', label: kRateLabel(eraBasis),
      value: t => t.k9,
      display: t => fmtTwo(scaleToBasis(t.k9, eraBasis)),
      rate: true,
    }, {
      // Same arrangement as the K rate: stored on the canonical basis, labelled and scaled for
      // the reader's.
      key: 'hr9', label: `HR/${eraBasis}`,
      value: t => t.hr9,
      display: t => fmtTwo(scaleToBasis(t.hr9, eraBasis)),
      rate: true, lowerBetter: true,
    })
    cols.splice(eraIdx + 1, 0, {
      key: 'eraPlus', label: 'ERA+',
      value: eraPlus,
      display: t => { const v = eraPlus(t); return v == null ? '—' : !isFinite(v) ? '∞' : String(Math.round(v)) },
      rate: true,
    }, {
      // Beside ERA+ so the gap between what a pitcher allowed and what they controlled reads in
      // one glance. Centred on the same slice's ERA, so the league line reads the same in both.
      // `fmtEra` rescales it with ERA, which is correct because FIP is linear in the basis.
      key: 'fip', label: 'FIP',
      value: t => fip(t, fWeights, fipC),
      display: t => fmtEra(fip(t, fWeights, fipC)),
      rate: true, lowerBetter: true,
    })
    return cols
  }, [lines.pitching, fmtEra, eraBasis, games, scope, fWeights])

  const cols = (side === 'hitting' ? hitCols : side === 'fielding' ? FLD_COLS : pitCols) as Col<Totals>[]
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
  const viewCols = orderForView(side, view, cols)
  const hasViews = VIEW_ORDER[side].advanced.length > 0
  const scrollCols = pinActive ? viewCols.filter(c => c.key !== activeCol.key) : viewCols

  // Flipping sides re-sorts on that side's headline stat. Safe to do even while the tracked
  // boards are showing: it leaves the table sorted sensibly for when the reader switches back.
  const switchSide = (s: Side, log = true) => {
    if (log && s !== side) logBoard('side', { side: s })
    setSide(s)
    if (s !== 'fielding') setBallSide(s)
    const next = defaultSort(s)
    setSortKey(next.key); setSortAsc(next.asc)
    // The Find board's conditions are keyed to one side's fields: innings pitched and earned
    // runs are pitching-only, total bases and stolen bases hitting-only. Left alone, a
    // condition on a field the other side does not have survives the switch as a picker stuck
    // on a blank option and a query that silently matches nothing, which reads as a broken
    // board rather than as a stat that does not apply. Drop those on the switch; a shared field
    // (strikeouts, home runs, walks) stays and changes sense with the side.
    setFindQuery(prev => {
      const valid = new Set(finderFields(s === 'fielding' ? 'hitting' : s).map(f => f.key))
      const conditions = prev.conditions.filter(c => valid.has(c.field))
      return conditions.length === prev.conditions.length ? prev : { ...prev, conditions }
    })
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
  // A heading is the sort control, so it has to be one for everybody: a tab stop, Enter or Space,
  // the sort state announced, and what the abbreviation stands for on hover. Kept a <th> rather than
  // wrapped in a button, so a screen reader still reads it as the column's header.
  const colNames = statNames(side, eraBasis)
  const headProps = (c: Col<Totals>) => ({
    tabIndex: 0,
    title: colNames[c.key],
    'aria-sort': c.key === sortKey ? (sortAsc ? 'ascending' as const : 'descending' as const) : undefined,
    onClick: () => clickHeader(c),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickHeader(c) }
    },
  })
  const clickHeader = (c: Col<Totals>) => {
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
  const pickSort = (c: Col<Totals>) => {
    setSortOpen(false)
    if (c.key === sortKey) return
    track(EVENTS.WPBL_STATS_SORTED, { key: c.key, asc: c.lowerBetter ?? false, side, mode })
    setSortKey(c.key)
    setSortAsc(c.lowerBetter ?? false)
  }
  // "Best first" is not a direction: for ERA and WHIP it is ascending and for everything else
  // it is descending. The column already knows which, so the reader never has to.
  /**
   * Mirror the view into the address bar, so a refresh lands where the reader was.
   *
   * `replaceState`, NEVER `pushState`. Sorting a column is not navigation: pushed, a reader who
   * tried four columns would need four Backs to leave the page, and the section's whole history
   * contract (see `closeTop` in WpblApp) is built on Back meaning "close the thing on top".
   *
   * THE EXISTING HISTORY STATE IS CARRIED THROUGH UNTOUCHED. WpblApp keeps its navigation
   * snapshot on `history.state.wpbl`, and passing anything else here, including the usual `{}`,
   * would wipe the entry's snapshot and leave Back rendering the wrong tab under this URL.
   *
   * ONLY ON THE STATS PATH, and only while this tab is the one on screen. The pager keeps every
   * visited tab mounted, so without the `active` guard a reader on Schedule would have their
   * URL quietly rewritten to the stats board by a component they cannot see. The path check is
   * the same rule one level down: a player modal opened from here owns the path, and its URL is
   * not ours to edit.
   */
  useEffect(() => {
    if (!active) return
    if (window.location.pathname.replace(/\/+$/, '') !== STATS_PATH) return
    const q = new URLSearchParams(window.location.search)
    const board = boardParam(source, mode, side)
    const def = defaultSort(side)
    // Only what the reader has actually changed. A default view keeps a bare /wpbl/stats, and a
    // link they paste carries only the part worth saying.
    const set = (k: string, v: string | null) => { if (v == null) q.delete(k); else q.set(k, v) }
    set('board', board === 'players' ? null : board)
    // `board=fielding` already says the side, so `side` is only ever the switch's.
    set('side', boardSide === 'hitting' || side === 'fielding' ? null : boardSide)
    set('sort', sortKey === def.key ? null : sortKey)
    set('dir', sortAsc === defaultSort(side, sortKey).asc ? null : (sortAsc ? 'asc' : 'desc'))
    // THE FIND BOARD'S QUESTION, and only while that board is the one open. Left on, a reader
    // who built a question and then walked to Players would carry `?q=so.gte.5` on a board that
    // has no idea what it means, and would paste it to somebody who lands on a table.
    const finding = source === 'find'
    set('q', finding && findQuery.conditions.length ? encodeFinderQuery({ ...findQuery, scope }) : null)
    set('team', finding ? findQuery.teamId : null)
    set('opp', finding ? findQuery.oppId : null)
    set('venue', finding && findQuery.venue !== 'any' ? findQuery.venue : null)
    const str = q.toString()
    const url = str ? `${window.location.pathname}?${str}` : window.location.pathname
    if (url === window.location.pathname + window.location.search) return
    window.history.replaceState(window.history.state, '', url)
  }, [active, source, mode, side, boardSide, sortKey, sortAsc, findQuery, scope])

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
      // One row per team (only four). Team G is the team's games played (the count of distinct
      // game_ids), not the number of player lines that sumBatting/sumPitching add up.
      built = teams.map(team => {
        const src = side === 'hitting'
          ? lines.batting.filter(l => l.team_id === team.id)
          : lines.pitching.filter(l => l.team_id === team.id)
        // SCOPED ONCE, HERE, AND EVERYTHING ON THE ROW READS OFF IT.
        //
        // `sumBatting` and `sumPitching` take the schedule and the scope as required arguments
        // precisely so a season total cannot silently include the postseason. The two figures this
        // branch computes ITSELF, G and LOB, get no such protection: built from unfiltered lines they
        // would count a club's playoff games and runners on every scope, and nothing on screen would
        // look wrong, because the other columns in the same row are filtered.
        //
        // Filtering here and still passing `games` and `scope` below is deliberate belt and
        // braces: `scopedLines` is idempotent, and keeping the required arguments means nobody
        // can later take this line out and leave the sums quietly unscoped.
        const scoped = scopedLines(src as (WpblBattingLine | WpblPitchingLine)[], games, scope)
        const totals = side === 'hitting'
          ? sumBatting(scoped as WpblBattingLine[], games, scope)
          : sumPitching(scoped as WpblPitchingLine[], games, scope)
        const gameIds = new Set(scoped.map(l => l.game_id))
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
        ? aggregateBatting(players, lines.batting, games, scope).map(s => ({ player: s.player, totals: s.totals as Totals, qualified: plateAppearances(s.totals) >= qual.minPa }))
        : side === 'fielding'
        ? aggregateFielding(players, fielding ?? [], lines.batting, lines.pitching, games, scope).map(s => ({ player: s.player, totals: s.totals as Totals, qualified: s.totals.g >= qual.minG }))
        : aggregatePitching(players, lines.pitching, games, scope).map(s => ({ player: s.player, totals: s.totals as Totals, qualified: s.totals.outs >= qual.minOuts }))
      let list = seasons
      if (teamId) list = list.filter(s => s.player.team_id === teamId)
      // The qualifier applies to every sort, counting stats included: a 1-for-1 HR leader shouldn't
      // top the board over a full-season slugger, and a lit "✓ Qualified" chip must not silently do
      // nothing on a counting stat.
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
    // tiebreak). Both are the unit that side's qualifier is set in. Fielding breaks on chances
    // rather than games: a 1.000 off forty chances outranks one off four.
    const sample = (r: Row) => side === 'pitching' ? (r.totals as WpblPitchingTotals).outs
      : side === 'fielding' ? (r.totals as WpblFieldingTotals).tc
      : plateAppearances(r.totals as WpblBattingTotals)
    return built.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return sample(b) - sample(a)
      if (av == null) return 1          // nulls always sink
      if (bv == null) return -1
      if (av !== bv) return sortAsc ? av - bv : bv - av
      return sample(b) - sample(a)
    })
  }, [mode, side, players, lines, fielding, teams, teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, shortName, lobByGameTeam, games, scope, positionIndex])

  // Standard competition ranking (1, 2, T-3, T-3, 5), judged on the number AS SHOWN. Three hitters
  // printed at .400 and numbered 8, 9 and 10 claims an order the reader cannot see, which is
  // what B-Ref's and MLB.com's leaderboards mark as a tie. The raw values are the wrong test:
  // .4004 and .3996 both print .400, and two identical ERAs can differ in the last bit of a
  // float. A dash is never a tie, it is the absence of a number.
  const ranks = useMemo<RankMark[]>(() => {
    const txt = rows.map(r => cellText(activeCol, r.totals))
    const same = (i: number) => i > 0 && txt[i] !== '—' && txt[i] === txt[i - 1]
    const out: RankMark[] = []
    txt.forEach((_, i) => { out.push({ n: same(i) ? out[i - 1].n : i + 1, tied: same(i) || same(i + 1) }) })
    return out
  }, [rows, activeCol])

  // The league average, so a rate has something to be read against: a .400 OBP means little
  // until the header under OBP says the league is at .352, and it is the only honest explanation of
  // what 100 means for OPS+, wRC+ and ERA+. The same slice as the boards (`scope`), and the
  // whole league whatever the team filter says, the same baseline those three indexes use.
  const leagueTotals = useMemo<Totals>(
    () => side === 'hitting' ? sumBatting(lines.batting, games, scope)
      : side === 'fielding' ? sumFielding(fielding ?? [], games, scope)
      : sumPitching(lines.pitching, games, scope),
    [side, lines, fielding, games, scope])
  // RATES ONLY. A league total of home runs is not an average of anything a row here holds,
  // and a per-player mean would be dragged down by every pitcher's empty batting line, so the
  // counting cells are left empty rather than holding a number that means something else.
  const leagueCell = (c: Col<Totals>) => (c.rate ? cellText(c, leagueTotals) : '')

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The five boards, in one row. `source` and `mode` stay as they were underneath: the deep
  // links, the ?view= URLs and axesOf() all speak that language, and collapsing them into a
  // single state would mean rewriting all of it to gain a variable.
  const boards: { key: string; label: string; badge?: boolean }[] = [
    { key: 'players', label: 'Players' },
    { key: 'teams', label: 'Teams' },
    // Beside the two season tables because it IS one: the same table, sort and filters, over the
    // fielding lines. See `Side` for why it is a tab and not a third option in the switch.
    { key: 'fielding', label: 'Fielding' },
    // Third, directly after the two season tables, because it is the same subject asked a
    // different way: those rank a player's whole season, this ranks one night of it. Putting
    // it after Run value would have filed a plain counting-stat board behind the most
    // expert-looking one on the tab.
    { key: 'bests', label: 'Bests', badge: newBoards?.has('bests') },
    // Straight after Bests, because the two are the same idea at two levels of patience: Bests
    // is the questions worth putting on a board, Find is everything else. A reader who has just
    // read a records board and wondered "how often does that happen" is one tab away from the
    // answer.
    { key: 'find', label: 'Find', badge: newBoards?.has('find') },
    { key: 'pitches', label: 'Pitch by pitch' },
    // Not behind the experiments switch: the board most likely to be misread should not be shown
    // only to the readers least likely to misread it. What it needs is the sentence above the
    // table saying what a "run" means here.
    { key: 'runs', label: 'Run value' },
    // Last of the always-on boards: one question about one season's draft, answered once.
    { key: 'draft', label: 'Draft' },
    // Hidden while the league has published radar for barely any games, and kept for the
    // session once a link has opened it anyway. See trackedOffered.
    ...(trackedOffered ? [{ key: 'tracked', label: 'Tracked' }] : []),
  ]
  const activeBoard = source === 'season' ? (side === 'fielding' ? 'fielding' : mode) : source
  // The chosen tab is kept in view by PageTabs itself.
  const selectBoard = (k: string) => {
    // One tap, one board event, named for the widest axis it moved, as the separate source and
    // mode switches named theirs before Fielding made a tap able to move all three.
    if (k !== activeBoard) {
      const next = k === 'fielding' ? { source: 'season' as Source, mode: 'players' as Mode, side: 'fielding' as Side }
        : k === 'players' || k === 'teams' ? { source: 'season' as Source, mode: k as Mode, side: boardSide }
        : { source: k as Source, mode, side: boardSide }
      logBoard(next.source !== source ? 'source' : next.mode !== mode ? 'mode' : 'side', next)
    }
    if (k === 'fielding') {
      setSource('season'); setMode('players')
      if (side !== 'fielding') switchSide('fielding', false)
      return
    }
    if (side === 'fielding') switchSide(ballSide, false)
    if (k === 'players' || k === 'teams') { setSource('season'); setMode(k as Mode) }
    else setSource(k as Source)
  }

  // Anything the reader has changed away from how the board opens. Drives the dot on the
  // Filters pill: `qualified` defaults to `qual.active`, so "on" is not the same as "set".
  // Scope counts as a filter on a phone, where it lives in the sheet: the dot is the only
  // thing saying a board is not showing the whole regular season, and a reader who set
  // Playoffs on one board and came back to it later has no other way to find out.
  // Bests and Find take only the season slice; the team chip and the qualified toggle do not
  // reach either (neither has a per-player population to cut or a rate to gate, and Find has a
  // club picker of its own), so counting them here would light the dot on a board where nothing
  // had been filtered.
  const filtersSet = source === 'season'
    ? teamId !== null || qualified !== qual.active || scope !== 'regular'
    : scope !== 'regular'

  // THE PHONE READS A LIST, NOT A GRID. Sixteen columns behind a 150px frozen name column show
  // four stats at a time on a 375px screen, so the one thing anyone comes here to do (rank the
  // league by a stat) would mean scrolling sideways to hunt for the column and tapping its header.
  // The list ranks by one stat, chosen from a control that says which, and carries three more
  // under each name for context; everything else about a player is one tap away on their card,
  // where it is better presented. Desktop keeps the table: there the grid fits, and comparing
  // across columns is the thing a grid is for.
  const listView = isNarrow && source === 'season' && !fullTable

  // The three context stats: the preference list minus whatever is already the big number.
  const contextCols = useMemo(() => (
    CONTEXT_KEYS[side][activeCol.rate ? 'rate' : 'counting']
      .filter(k => k !== sortKey)
      .map(k => cols.find(c => c.key === k))
      .filter((c): c is Col<Totals> => !!c)
      .slice(0, 3)
  ), [side, sortKey, cols, activeCol])

  const pickedId = picked && mode === 'players' && picked.side === side && picked.sortKey === sortKey ? picked.id : null
  const pickedIdx = pickedId ? rows.findIndex(r => r.key === pickedId) : -1
  // Arriving from a rank on a player's card, the player has to be on screen: the cap stretches to
  // include them rather than land on a board that does not show who the reader came for.
  const listCap = Math.max(LIST_CAP, pickedIdx + 1)
  const capped = listView && !expanded && rows.length > listCap
  const visibleRows = capped ? rows.slice(0, listCap) : rows
  const pickedRef = useRef<HTMLElement | null>(null)
  // Centred, after the pane has had a frame to become the visible one. Keyed on the request too,
  // so pressing the same rank a second time scrolls back to the row.
  useEffect(() => {
    if (pickedIdx < 0) return
    const t = setTimeout(() => pickedRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' }), 120)
    return () => clearTimeout(t)
  }, [pickedIdx, requested])
  const pickedTint = `linear-gradient(${WPBL_ACCENT}1c, ${WPBL_ACCENT}1c)`

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
  // The club's full name, not the nickname the chip shows: "Boston Hunters" is a sentence
  // and "Hunters" is a crossword clue.
  const teamWord = teamId ? (() => { const t = teamById.get(teamId); return t ? wpblFullName(t) : null })() : null
  const qualWord = mode === 'players' && qualified ? 'qualified only' : null
  // What the faded rows are, in the bar's own unit. The only place the qualifying bar is ever
  // stated as a number, so it is also the answer to "why is this player not on the qualified board".
  const qualBar = side === 'hitting' ? `${qual.minPa} PA`
    : side === 'fielding' ? `${qual.minG} G` : `${outsToIp(qual.minOuts)} IP`
  const fadedWord = mode === 'players' && rows.some(r => !r.qualified)
    ? `faded: under ${qualBar}`
    : null
  // WHICH GAMES, IN WORDS. On a phone the scope chips live in the Filters sheet, and a sheet is
  // shut: a board counting the playoffs looks exactly like one counting the season, for the
  // reader most likely to have set it by accident. The pill's dot says only that SOMETHING is
  // not the default; this is the line that says what.
  const scopeWord = scope === 'postseason' ? '2026 playoffs'
    : scope === 'all' ? '2026 season + playoffs'
    : '2026 season'
  // Only when the reader has moved OFF the league's basis, and only on the pitching side. Their
  // ERA no longer matches the one the league publishes, and that is worth a permanent three words
  // at the foot. On the league's own basis it would be noise on every board.
  const eraWord = side === 'pitching' && eraOffLeague ? `ERA per ${eraBasis}` : null

  // THE PHONE'S FULL TABLE SAYS ONLY WHAT IS NOT THE DEFAULT, and on a default board says nothing.
  // The board there is capped to the screen, so the foot's line of words was a row of players: the
  // count moved into the first column's heading (see the table), and what is left here is the
  // population's departures from the default, which is the half the Filters dot cannot spell out.
  // A reader who has set nothing gets one line of controls; one who has set something sees what.
  const phoneTable = isNarrow && source === 'season' && !listView
  const footWords = phoneTable
    ? [teamWord, qualified !== qual.active ? qualWord : null, fadedWord,
        scope !== 'regular' ? scopeWord : null, eraWord]
    : [capped ? `${LIST_CAP} of ${rows.length} ${noun}` : `${rows.length} ${noun}`,
        teamWord, qualWord, fadedWord, scopeWord, eraWord]
  const footText = (footWords.filter(Boolean) as string[]).join(' · ')
    + (!listView && !phoneTable ? ' · sort by any column heading' : '')
  const boardFooter = (
    <Box data-board-foot="" sx={{
      px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'center', gap: 1, flexWrap: phoneTable ? 'wrap' : undefined,
    }}>
      {footText && (
        // On the phone's table the words take a line of their own: beside two controls they
        // were a column of single words.
        <Typography sx={{
          fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600, minWidth: 0,
          flexBasis: phoneTable ? '100%' : undefined,
        }}>{footText}</Typography>
      )}
      {/* The way into the grid and back out. At the foot rather than in the control bar: it is
          a preference someone sets once, not a control they work with, and every pixel of the
          bar is taken from the board. It reads as a foot because the list is capped.

          The row above it adds PLAYERS and this one adds COLUMNS. The label names what it
          switches to, a table, rather than what it gets you, so a reader does not have to
          press it to find out what it does. */}
      {phoneTable && hasViews && (
        <Box sx={{ flexShrink: 0 }}>
          <PillGroup options={VIEW_OPTIONS} value={view} onChange={v => switchView(v as View)} />
        </Box>
      )}
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

  // THE SITE FOOTER STEPS ASIDE FOR THE PHONE'S FULL PLAYER TABLE. The board there is pinned under the bar
  // and has to fit above everything that follows it, or it stops being pinned before the reader
  // stops scrolling and its headers slide behind the bar (see the cap on the scroll box). The footer
  // was most of what followed: 139px of links, plus its gutters, reserved on every phone, which left
  // four or five rows of players. Its links are all in the bottom nav's More sheet as well.
  //
  // SAFE FOR THE CRAWLER BY CONSTRUCTION: the full table is a preference stored in localStorage and
  // off by default, and Googlebot has neither, so it only ever renders the ranked list and the
  // footer's links under it. A root attribute rather than a prop, because the footer belongs to the
  // shell and this board is the only thing that knows when it is in the way. SiteFooter reads it.
  //
  // PLAYERS ONLY. The teams board is four rows, never meets its cap, and hiding the footer there
  // just ended the page in a blank band above the nav.
  const hideSiteFooter = phoneTable && mode === 'players'
  useEffect(() => {
    if (!(active && hideSiteFooter)) return
    const root = document.documentElement
    root.setAttribute('data-wpbl-stats-table', '')
    return () => root.removeAttribute('data-wpbl-stats-table')
  }, [active, hideSiteFooter])

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching sides, but only if it isn't already visible, so a wide desktop
  // table (all columns shown) or a user who's scrolled elsewhere is left alone.
  // A new view or side is a different set of columns, so an old sideways offset lands the reader
  // partway through a table they have not seen the start of. Back to the first column; the effect
  // below then brings the sorted one into view where it needs to. Declared first so it runs first.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (c) c.scrollLeft = 0
  }, [view, side])
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
  }, [loading, side, view, sortKey, rows.length, pinActive])

  // ON A PHONE THE PAGE SCROLLS FIRST, THEN THE TABLE.
  //
  // The phone's cap sizes the table for where it PINS, under the bar once the title and the board
  // tabs have scrolled away, so at rest it runs about 145px further down, behind the bottom nav. That
  // is fine as long as the page gets scrolled, and nothing made it: a drag on the table scrolled the
  // table, and `overscroll-behavior: contain` kept it from ever handing the gesture to the page, so
  // the last rows and the board's footer sat behind the nav for anyone who never touched outside it.
  //
  // So the table only takes vertical scroll once it is pinned. Before that it is `overflow-y:
  // hidden`, which leaves its scroll position alone and passes the drag through to the page, which
  // carries it up until it pins. Scrolling back up at the table's top chains to the page again (the
  // Y overscroll is left to the browser on a phone for that reason) and unpins it. The same nested
  // scroll native apps do with a collapsing header.
  //
  // "At the page's bottom" also counts as pinned: if a short page cannot carry the table all the way
  // up, it must still be scrollable from wherever the page stops.
  const [boardPinned, setBoardPinned] = useState(false)
  useEffect(() => {
    if (!pinActive || listView || loading) return
    // Pinned means the BAR is being held (it sits below the zero-height marker that marks its
    // resting place; see barStuck), since the board always sits flush under the bar, held or not.
    const check = () => {
      const bar = barRef.current
      const mark = stuckMarkRef.current
      if (!bar || !mark) return
      const held = bar.getBoundingClientRect().top > mark.getBoundingClientRect().top + 0.5
      const atBottom = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 2
      setBoardPinned(held || atBottom)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [pinActive, listView, loading, source, mode])

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

  // THE BAR PUBLISHES ITS OWN HEIGHT, because the board below pins to the BOTTOM of it and
  // nothing else on the page can know where that is: the shell reports its own chrome
  // (`--app-header-h`) and this bar pins under that, wrapping to two rows on a
  // narrow screen and back to one when the filters fold away. Same shape as the shell's own
  // variables, and read the same way.
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const root = document.documentElement
    // THE FOOTER, BECAUSE IT IS THE ONLY THING LEFT BELOW THE BOARD, and how tall it is decides
    // how tall the board is allowed to be. A pinned board stays pinned only while its
    // containing block has somewhere left to travel, and the arithmetic comes out at exactly
    // one condition: the board must fit in the screen under the bar with room for whatever
    // follows it. Taller than that and it stops being pinned before the reader stops scrolling.
    //
    // MEASURED OFF THE `<footer>` ELEMENT, not off the document's height, and the difference is
    // the whole reason this is safe. The document's height includes the swipe pager's floor
    // (`minHeight` in SwipeableViews, which keeps a short tab a full-screen swipe target) and
    // any blank the board itself is leaving; feeding that back into the board's height is a
    // loop that runs the table down to nothing. The footer's height cannot depend on the board's.
    // Declared before `publish` so it can watch the two footers it finds (see below).
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => publish()) : null
    const publish = () => {
      // THE ONE THAT IS LAID OUT, and looked up every time rather than held from the first pass.
      // `/wpbl` keeps its swipe pager's visited tabs mounted, so the page can hold several
      // `<footer>` elements and `querySelector` may return a hidden tab's, which measures zero; and
      // the shell's footer is not guaranteed to be in the document when this board first mounts.
      // Either way a zero would be published, the board would size itself as though nothing were
      // beneath it, and the headers would slide behind the bar this arrangement exists to stop.
      const foot = Array.from(document.querySelectorAll('footer'))
        .find(f => f.getBoundingClientRect().height > 0)
      root.style.setProperty('--wpbl-stats-bar-h', `${el.getBoundingClientRect().height}px`)
      root.style.setProperty('--wpbl-foot-h', `${foot?.getBoundingClientRect().height ?? 0}px`)
      // The board's own footer, on the same terms: the laid-out one, since the ranked list and
      // the table each render it, and its height does not depend on the board's.
      const boardFoot = Array.from(document.querySelectorAll('[data-board-foot]'))
        .find(f => f.getBoundingClientRect().height > 0)
      root.style.setProperty('--wpbl-board-foot-h', `${boardFoot?.getBoundingClientRect().height ?? 0}px`)
      // WATCH THE FOOTERS THEMSELVES, not only the body. Switching to Large text grows both of
      // them without resizing the body in a way the observer reports, so the published heights
      // went stale and the board was sized for the old text: headers behind the bar at the
      // bottom of the page for anyone who changed the setting with this tab mounted, which the
      // pager keeps it. Observing an element twice is a no-op, so this is safe on every pass.
      if (foot) ro?.observe(foot)
      if (boardFoot) ro?.observe(boardFoot)
    }
    publish()
    // jsdom has no ResizeObserver in every environment this runs in; the values published above
    // are still correct for a layout that never changes.
    //
    // Watching the document as well as the bar is what catches the footer arriving, or growing
    // a row as the window narrows. It cannot feed back on itself: what gets published is the
    // FOOTER's height, and the footer does not care how tall the board is, so a republish on a
    // board resize writes the same value and stops there.
    if (ro) { ro.observe(el); ro.observe(document.body) }
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--wpbl-stats-bar-h')
      root.style.removeProperty('--wpbl-foot-h')
      root.style.removeProperty('--wpbl-board-foot-h')
    }
  }, [loading])

  // The section's skeleton, not a spinner: the players and lines are a SECOND read after the
  // section's own, so a spinner here replaced the skeleton with a box 200px tall and the board
  // then landed where the skeleton had been.
  if (loading) {
    return <StatsSkeleton />
  }

  // NO text-transform. The column labels are already written in capitals, and the two that are
  // not (wOBA, wRC+) are spelled that way on purpose: the lowercase w is part of the name. Only
  // the Player/Team heading is set in capitals, on its own cell.
  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4),
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }
  // The body cells, shared by every player row.
  const nameCellSx = {
    position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
    textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
    width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined,
    borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
    touchAction: pinActive ? 'pan-y' : undefined,
  } as const
  const pinnedCellSx = {
    position: 'sticky', left: nameW, zIndex: 3, touchAction: 'pan-y',
    textAlign: 'center', py: 0.5, px: 0.5,
    borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
    fontSize: '0.84rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
    backgroundColor: 'background.paper',
    backgroundImage: `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)`,
    '&::before': SEAM_COVER,
    '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
    whiteSpace: 'nowrap',
  } as const
  const cellSx = (active: boolean) => ({
    textAlign: 'center', py: 0.5, px: 0.5, borderTop: '1px solid', borderColor: 'divider',
    fontSize: active ? '0.84rem' : '0.8rem', fontWeight: active ? 800 : 500,
    color: active ? 'var(--wpbl-accent-fg)' : 'text.primary',
    // Layered like the header, so a hovered row and the sorted column
    // compose instead of one of them winning outright.
    backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)` : undefined,
    whiteSpace: 'nowrap',
  } as const)
  // THE LEAGUE AVERAGE, FOLDED INTO THE HEADER, on every screen. As a row of its own it cost 35px
  // of a phone's capped board, and on a desktop it was a tall two-line label over a row that is
  // mostly blank, since only the rates have a league figure. The header is also the one line that
  // never scrolls away, so the averages stay beside the column labels down the whole board. Every
  // cell gets the second line, blank or not, or a table's middle alignment would put the labels at
  // two different heights.
  const headLeague = (text: string, align?: 'right') => (
    <Box data-league-head="" sx={{
      fontSize: '0.58rem', fontWeight: 600, letterSpacing: 0, lineHeight: 1.1, minHeight: '1.1em',
      mt: 0.25, color: 'text.secondary', textTransform: 'none', textAlign: align,
    }}>{text}</Box>
  )

  /* ROW ONE: WHICH BOARD. One row of underline tabs, because that is what they are:
      tapping one replaces the screen. Drawn differently from the team filter and the
      qualified toggle on purpose, so a different page and a filter on this one never
      look alike, and placed above the side of the ball, which applies to all of them.
      The hierarchy is board, then side, then filters.

      Players and Teams are boards here rather than a Season/Players+Teams pair: "Season"
      means nothing on a section where every number is this season, and splitting it
      into the two things it actually ranks says that outright.

      Scrolls sideways rather than wrapping when Tracked is showing. SwipeableViews hands
      the gesture back at the edges, so an extra flick still pages to the next tab. */
   //
   // NOT PINNED ON A PHONE, which is where it is rendered from rather than what it looks
   // like. See where this is placed below.
  const boardTabs = (
    <PageTabs
      options={boards.map(b => ({
        value: b.key, label: b.label,
        // The dot is aria-hidden, so a badged tab carries the news in its name instead,
        // the same way SegNav's pills do one level up.
        adornment: b.badge ? <NewDot sx={{ ml: 0.6 }} /> : undefined,
        ariaLabel: b.badge ? `${b.label}, updated` : undefined,
      }))}
      value={activeBoard}
      onChange={selectBoard}
    />
  )

  return (
    // STRETCHED TO FILL THE TAB, which is what gives the pinned board somewhere to stay pinned.
    //
    // A sticky element stops sticking when its containing block runs out, and the board is the
    // last thing in this box, so its containing block ended exactly where it did: zero travel,
    // and the board slid up behind the bar the moment the page moved. The room it needs is
    // already on the page and in the wrong place. `/wpbl` floors every tab of its swipe pager
    // at a screenful so a short tab is still a full-screen swipe target (`minHeight` in
    // SwipeableViews), and that floor is a flex container, so growing into it moves the slack
    // from AFTER this box to INSIDE it. The page gets no longer, and the board gets exactly as
    // much room to hold its position as the tab had going spare.
    //
    // Inert wherever the parent is not a flex container, which is every other caller.
    <Box sx={{ flexGrow: 1 }}>
      {/* The page's one <h1>: /wpbl/stats, the section's most-searched term. It sits above the
          sticky control bar and scrolls away with the content, leaving the bar to pin; the
          bar's top offset is unaffected because this is not sticky itself.

          FULL BLEED, like everything under it. This tab's content is wider than the page
          column, so a heading left in that column would start well right of the board tabs
          and the table beneath it and read as floating. Same measure as the table
          (`fullBleedSx`), not the bar's, which is deliberately wider still and gives the
          difference back as padding, so the two agree on where content starts. */}
      {/* Spacing only: TabTitle applies the phone rule LAST, since when it hides it is absolute
          positioning at 1px square and has to beat the width and margins the full-bleed rule
          sets. Drawn on a phone once the nav is at the foot of the screen, as every tab title. */}
      <TabTitle sx={{ ...fullBleedSx, mb: 1 }}>WPBL Stats</TabTitle>
      {/* The control bar, pinned, so a long table never scrolls every control off the top. It
          offsets by PINNED_CHROME, whose note explains both terms. Above the table's own
          sticky header, which pins inside the scroll box below it. */}
      {/* Where the bar sits when nothing is pinning it. Zero height, no paint; see the
          barStuck effect for what reads it. */}
      {/* ON A PHONE THE BOARD PICKER SCROLLS AWAY, and that is what pays for the table below it.
          WHICH BOARD is a decision you make once and then read; SORT and FILTERS are what you
          reach for while reading, so those are what the bar keeps. Everything the bar pins is
          height the board underneath has to clear, because the board is pinned to the bar's
          bottom edge and has to fit between there and the footer: the tabs are about half the
          bar, and pinning them would cost a row of stats on every phone at every scroll
          position. Desktop keeps them in the bar, where the whole thing is one row. */}
      {isNarrow && <Box sx={{ ...fullBleedStickySx, pt: 1 }}>{boardTabs}</Box>}
      <Box ref={stuckMarkRef} aria-hidden sx={{ height: 0 }} />
      <Box ref={barRef} sx={{
        position: 'sticky',
        top: PINNED_CHROME,
        zIndex: 6,
        bgcolor: 'background.default',
        // Tighter on a phone, where every pixel of this pinned bar comes off the capped board below.
        pt: { xs: 0.5, sm: 1 },
        transition: 'box-shadow 0.2s',
        // An EDGE once it is holding something under it, and NOTHING before that. Without any
        // edge, rows slide up and vanish into an unexplained band of page colour below the
        // pills, which reads as the table being eaten rather than as a bar it is passing
        // behind. A shadow, not a hairline: a rule would sit directly under the Hitting/Pitching
        // pills and, on boards that lead with prose, across the page above the first sentence,
        // with the board tabs already drawing one rule nearby.
        //
        // BOTTOM EDGE ONLY, which is what the negative spread buys. A plain `0 4px 12px` blurs
        // 12px in every direction with no offset to pull it down, so on a full-bleed bar those
        // 12px hang off the LEFT and RIGHT of the header as two vertical shadow strips down the
        // sides of the page. Spread equal to the negative of the blur cancels the horizontal
        // reach exactly (side extent = blur + spread = 0) while the y offset still drops a soft
        // edge below, which is the only side content actually passes under.
        boxShadow: barStuck ? '0 6px 6px -6px rgba(0,0,0,0.14)' : 'none',
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
      {!isNarrow && boardTabs}

      {/* ROW TWO: HOW TO CUT IT. Side of the ball on the left in a segmented pill, which is a
          third visual language on purpose: underline tabs are pages, this is a two-way switch
          that applies to whichever page you are on, and chips are filters. The row keeps its
          height on every board (the right-hand controls just empty out), so the bar does not
          grow and shrink under a sticky header as you move between boards. Emptying them out
          is not enough on its own to hold that height on a phone: see the switch below. */}
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, rowGap: 1, pb: { xs: 1, sm: 1.5 },
        // THE SWITCH SITS OVER THE BOARD IT SWITCHES, which is not the same place on every board.
        // This bar is full-bleed because the season table under it is, and on Players and Teams that
        // is right: the pills start level with the table's first column. On boards whose content is
        // the ordinary page column, a full-bleed switch would hang off the edge of the page, well
        // left of everything it applies to.
        //
        // The same page-column cap and centring those boards use, so this is not a number to keep in
        // step with them: it is the page column. On a season board the cap is not applied at all and
        // the row spans the bleed, which also keeps Sort and Filters hard against the table's right edge.
        //
        // So the switch MOVES between boards (the note above is about height, not position). The
        // trade is worth it: the row of board tabs stays put, because that is the control pressed to
        // change boards and it cannot move out from under the press, while this one belongs to the
        // board and follows it. The cap follows the BOARD, because Run value lays itself out in two
        // columns on a large desktop and the rest do not: one width for all of them would sit level
        // with a 720px board on some tabs and well inside a 1150px one on another, which reads as the
        // control drifting rather than as the board changing.
        ...(source === 'season' ? {} : {
          maxWidth: WIDE_BOARDS.has(source) ? { xs: BOARD_COLUMN, lg: BOARD_COLUMN_WIDE } : BOARD_COLUMN,
          mx: 'auto', width: '100%',
        }),
      }}>
        {/* Two things, both about the switch staying put as the reader moves between boards on
            a phone.

            HEIGHT. The Sort/Filters pair on the right is 34px high against this switch's 28.7,
            so without a reserve the row stands 34 on Players and Teams and 28.7 elsewhere, and
            moving between them nudges the switch and the board under it by five pixels, under a
            bar that is otherwise pinned still. The reserve is HERE rather than on the row: the
            row carries its own bottom padding, so a min-height on it would have to know that
            padding, and would go quietly wrong the day the padding changed.

            WIDTH. It sits next to a pair that refuses to shrink, so on a narrow phone the flex
            algorithm would take any overflow out of this one (a long sort label like "Sort ERA+"
            is enough), and the switch would come out narrower on some boards than others.
            Wrapping is the better failure. */}
        {/* NOT ON FIELDING, where neither side applies. Its height stays, on the row, so moving to
            Fielding does not lift the board by the switch's height: on a phone Sort and Filters
            hold the row at 34 anyway, and on a desktop the switch is the tallest thing in it. */}
        {side === 'fielding' ? (
          !isNarrow && <Box aria-hidden sx={{ minHeight: `calc(${chromePx(28)} + 6px)`, width: 0, mr: -1 }} />
        ) : (
        <Box sx={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          minHeight: isNarrow ? 34 : undefined,
        }}>
          <PillGroup
            options={SIDES}
            value={boardSide}
            onChange={v => switchSide(v as Side)}
          />
        </Box>
        )}
        {/* Desktop only. A phone's ranked list shows one stat, so there is nothing to switch; its
            full table carries the same switch in the footer, where the bar has no room left. */}
        {source === 'season' && !isNarrow && hasViews && (
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <PillGroup options={VIEW_OPTIONS} value={view} onChange={v => switchView(v as View)} />
          </Box>
        )}

        {/* Phones: the two controls that do the work, stating what they are set to. Desktop
            keeps the chips inline, where there is room for the whole filter set at once and
            the column headers already sort. */}
        {(source === 'season' || source === 'bests' || source === 'find') && isNarrow && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            {/* NO SORT PILL ON BESTS. Its boards each rank by their own stat and say so in
                their own title, so there is no column to choose: the equivalent control would
                be "which board", and that is the tab row above. */}
            {source === 'season' && (
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
            )}

            {/* One pill for both filters. Which ones are on is not written here: the footer
                under the board says the population in words ("34 players · Boston · qualified
                only"), which is the same fact plus its consequence, and it costs no room in a
                bar this narrow. The dot is only there to say "something is not the default",
                so a filter can never be silently on. */}
            {(source === 'season' ? mode === 'players' || hasPostseason : hasPostseason) && (
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

        {/* WHICH SEASON. Chips rather than a third segmented pill, because it is a filter on
            the data and not a switch between two views of it, and because it has three
            options where the side switch has two.

            ONLY WHERE IT DOES SOMETHING, and only once a postseason game has actually
            finished. The season tables, Bests and Find all filter their lines through
            `scopedLines`, so the switch moves all three; the other boards (Pitch by pitch, Run
            value, Tracked) read their own data through paths this does not touch, so offering it
            there would be a control that silently does nothing.

            IT MATTERS MOST ON BESTS, which is the one board where the two slices are separate
            books rather than one number counted over more games: a postseason record is its
            own record, and folding it into the regular season's would quietly overwrite a
            league record with a playoff one. */}
        {/* DESKTOP ONLY. On a phone these three would wrap onto a row of their own and take that
            height from the table, which is capped so its column headers cannot be carried up
            behind the bar. They are in the Filters sheet there, which is what they are. */}
        {(source === 'season' || source === 'bests' || source === 'find') && hasPostseason && !isNarrow && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {/* "Both" rather than "All", which is what this option is: the team filter sitting
                immediately to its right already has an "All" chip, and two chips reading All
                side by side in one row is a coin toss about which one a tap changes. */}
            {([['regular', 'Regular season'], ['postseason', 'Playoffs'], ['all', 'Both']] as const)
              .map(([k, label]) => (
                <Chip key={k} active={scope === k} onClick={() => setScope(k)}>{label}</Chip>
              ))}
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
      </Box>

      {/* Tracked and Pitches each render their own boards (league tiles + ranked leaders)
          rather than the shared table: a different shape of data, not more columns. Both read
          the same `side` as the table, so switching Hitting/Pitching above carries straight
          through instead of being asked again inside them. */}
      {source === 'tracked' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblTrackingView side={boardSide} games={games} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'bests' ? (
        // FULL BLEED for the same reason Run value is, and the board caps and centres inside
        // it: below `sm` the bleed is `calc(100vw - 24px)`, which is WIDER than the page
        // column, and those 8px are the difference between a name fitting and being clipped at
        // the reader's Large text setting. The cap simply never binds on a phone.
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblBestsView side={boardSide} players={players} batting={lines.batting}
              pitching={lines.pitching} games={games} scope={scope}
              onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
          </Suspense>
        </Box>
      ) : source === 'find' ? (
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblFindView side={boardSide} teams={teams} players={players} batting={lines.batting}
              pitching={lines.pitching} games={games}
              query={{ ...findQuery, scope }} onQuery={q => setFindQuery(q)}
              onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
          </Suspense>
        </Box>
      ) : source === 'pitches' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblPitchView side={boardSide} teams={teams} games={games} trackedVisible={trackedOffered} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'draft' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblDraftValue side={boardSide} players={players} batting={lines.batting}
            pitching={lines.pitching} games={games} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'runs' ? (
        // STILL FULL-BLEED, with the content inside capped and centred, even though the board is one
        // sentence, one list and one collapsed explainer with nothing to spend width on.
        //
        // Dropping the bleed looks identical on a desktop and is wrong on a PHONE: `FULL_BLEED_W` is
        // `calc(100vw - 24px)` there, which is 351px on a 375px screen against the page column's 343,
        // so below `sm` the bleed is the WIDER of the two. Those 8px are real: at the Large text
        // setting, losing them clips names off the leaderboard.
        //
        // So the box keeps the width at every size and `RunValueView` decides what to do with it:
        // nothing on a phone, where the cap never binds, and a centred column on a desktop.
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblRunValueView side={boardSide} teams={teams} games={games} battingLines={lines.batting}
              onOpenPlayer={onOpenPlayer} />
          </Suspense>
        </Box>
      ) : side === 'fielding' && fielding == null ? (
        // Only if Fielding is picked before its read (started on mount) has landed.
        <SubViewFallback />
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
          {/* A one-line header, the way the grid has one. Without it the big number on the right
              would be the only unlabelled figure on the row. Labelled here rather than on each row,
              because ten greyed "AVG"s down a column is the same word ten times, and it gives the
              list the direction arrow the grid gets: on the ERA board, ranked best first, the
              numbers ascend and nothing else says so. */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
            borderBottom: '1px solid', borderColor: 'divider',
          }}>
            <Typography sx={{
              flex: 1, minWidth: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4),
              textTransform: 'uppercase', color: 'text.disabled',
            }}>{mode === 'teams' ? 'Team' : 'Player'}</Typography>
            {/* The league's figure for the stat being ranked, in the header line rather than a
                row of its own: it cost 33px of the first screen as a row, and here it costs
                nothing. A rate only, for the reason the table's league headers leave their counting
                cells empty. */}
            {activeCol.rate && (
              <Typography data-league-head="" sx={{
                flexShrink: 0, fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
              }}>League avg {leagueCell(activeCol)}</Typography>
            )}
            <Typography sx={{
              // Not uppercased: see thBase on wOBA and wRC+.
              flexShrink: 0, fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(0.4),
              color: 'var(--wpbl-accent-fg)',
            }}>
              {activeCol.label}
              <Box component="span" sx={{ ml: 0.3, fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>
            </Typography>
          </Box>
          {visibleRows.map((r, i) => (
            <StatListRow key={r.key} row={r} rank={ranks[i]} first={i === 0} isTeam={mode === 'teams'}
              picked={r.key === pickedId ? { ref: pickedRef, tint: pickedTint } : undefined}
              faded={mode === 'players' && !r.qualified}
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
        <Box sx={{
          // PINNED UNDER THE BAR, so the page cannot carry the board's column headers up
          // behind it. The headers stick to the top of the scroll box inside, and that box is
          // an ordinary element in page flow: without this, scrolling the PAGE takes the whole
          // board up and the labels go with it, which reads as a table that has lost its
          // headings. The board has no reason to travel anyway. Everything a reader came here
          // to move is inside it, and the little the page has left to scroll is the footer.
          //
          // UNDER the bar, never over it: the bar is `zIndex: 6` and this is 1. Without saying
          // so the board would paint on top of the bar it is sliding beneath, since both are
          // positioned and this one comes later in the DOM.
          position: 'sticky', top: BOARD_TOP, zIndex: 1,
          border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
          ...fullBleedStickyCardSx,
        }}>
          <Box sx={{ position: 'relative' }}>
          {/* Capped inner scroll so the column headers stay sticky (top:0) as you scroll the
              rows. `overscroll-behavior: contain` stops the scroll from chaining out to the
              page at the ends, so it reads as one list rather than a scroll-box fighting the
              page. On a desktop, that is; a phone hands its vertical scroll to the page until
              the board pins (see `boardPinned`). `dvh` tracks the mobile browser chrome so the cap doesn't overshoot.

              TWO SUBTRACTIONS, because a phone turned sideways wants a different one.

              260px is everything standing above the table at the top of the page: toolbar, tab
              nav, board picker, sort row. Subtracting all of it means "tall enough that nothing
              has to scroll", which is the right answer whenever the screen can afford it.

              A landscape phone cannot: 375dvh less 260 is a 115px window, the header and two
              rows, which reads as broken rather than tight. There the page has to scroll, and
              the cap becomes what fits in the gap the PINNED chrome leaves.

              That gap is asked for rather than assumed. The shell publishes whichever of its
              bars is actually holding a position at the top (--app-header-h on desktop, 0 on a
              phone, whose section nav is the bottom bar), so subtracting the sum is right at every
              width without naming a breakpoint here. 100px is this page's OWN control bar,
              which pins under them and is the one height the shell cannot report (about 91px,
              the rest slack).

              Going taller than that breaks the thing this box exists for: a table taller than
              the free gap can never be scrolled fully into it, so its sticky header parks
              behind the nav and the reader loses the column labels for the rest of the board.

              560px is where the two meet: the height at which the first subtraction still
              leaves about eight rows, the point below which a scroll-box stops being a table. */}
          <Box ref={scrollRef} sx={{
            // On a phone, vertical scroll waits for the board to pin; see `boardPinned`.
            overflowX: 'auto', overflowY: !pinActive || boardPinned ? 'auto' : 'hidden',
            overscrollBehaviorX: 'contain', overscrollBehaviorY: pinActive ? 'auto' : 'contain',
            // HOW TALL THE BOARD IS ALLOWED TO BE, and the two answers are different
            // because the question is.
            //
            // The column headers pin to the top of this box, and the box is an ordinary
            // element in page flow, so scrolling the PAGE carries them up behind the bars
            // above. The board is sticky (see where it pins) so it holds its place under the
            // bar, but sticky only holds while its containing block has somewhere left to go,
            // and the arithmetic comes out at one condition: the board has to FIT between the
            // bar and whatever follows it. Taller than that and it stops being pinned before
            // the reader stops scrolling.
            //
            // ON A PHONE THAT IS WORTH PAYING FOR. The page is short, a thumb reaches the
            // bottom of it by accident, and the board is the only thing on screen. So the cap
            // there is the real gap: the screen, less the bars above, less the footer below,
            // less the board's own furniture.
            //
            // ON A DESKTOP IT IS NOT. The page barely moves under a board this size, so the
            // guarantee would buy a case that does not arise and charge well over a hundred
            // pixels of table for it. Wide screens keep the plain measure, where 260px is
            // everything standing above the table at the top of the page.
            //
            // THE FOOTER IS MEASURED, THE REST IS NOT, and that split is the whole safety of
            // it. `--wpbl-foot-h` comes off the `<footer>` element, whose height cannot depend
            // on the board's. Deriving the cap from the DOCUMENT's height instead would loop:
            // on a phone that includes the swipe pager's full-screen floor, so the board's
            // height feeds back into its own cap, and read from a tab the pager has not yet
            // shown it measures a zero rect and renders no board at all. The floor is what
            // stops any of that reaching the screen.
            maxHeight: 'calc(100dvh - 260px)',
            // THE BOTTOM NAV IS BELOW EVERYTHING ELSE, as padding the shell reserves so the footer
            // clears it (`BOTTOM_NAV_SPACE` plus the home-indicator inset, in WpblApp). It is not
            // pinned at the TOP, so PINNED_CHROME reads 0 on a phone and says nothing about it.
            // Leaving it out made the board 76px too tall (about 110px on an iPhone), and at the
            // bottom of the page the column headers slid up behind the control bar.
            '@media (max-width:600px)': {
              maxHeight: `max(${MIN_BOARD_PX}px, calc(100dvh - ${BOARD_TOP} - var(--wpbl-foot-h, 0px)`
                + ` - var(--wpbl-board-foot-h, 0px) - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px)`
                + ` - ${hideSiteFooter ? BOARD_TAIL_BARE_PX : BOARD_TAIL_PX}px))`,
            },
            '@media (max-height: 560px)': {
              maxHeight: `calc(100dvh - ${PINNED_CHROME} - 100px)`,
            },
          }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  {/* "League avg" RIGHT-ALIGNED, because it is a row label for the figures to its
                      right: flush left it sat a column-width away from the number it names. On a
                      phone the count above it follows, since a lone left-aligned line over a
                      right-aligned one read as a mistake in a cell that narrow. */}
                  <Box component="th" data-swipe-handle="" sx={{ ...thBase, textTransform: 'uppercase', left: 0, zIndex: 4, textAlign: pinActive ? 'right' : 'left', width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined, borderRight: '1px solid', borderColor: 'divider', px: 1, touchAction: pinActive ? 'pan-y' : undefined }}>
                    {/* On a phone the count lives here, since the board's footer gave up its line
                        of words for the height; see boardFooter. */}
                    {pinActive ? `${rows.length} ${noun}` : mode === 'teams' ? 'Team' : 'Player'}
                    {headLeague('League avg', 'right')}
                  </Box>
                  {pinActive && (
                    <Box component="th" data-swipe-handle="" {...headProps(activeCol)} sx={{
                      ...HEAD_FOCUS,
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
                      {headLeague(leagueCell(activeCol))}
                    </Box>
                  )}
                  {scrollCols.map(c => {
                    const active = c.key === sortKey
                    return (
                      <Box component="th" key={c.key} {...headProps(c)}
                        data-active={active ? 'true' : undefined}
                        sx={{
                          ...thBase, ...HEAD_FOCUS, textAlign: 'center', cursor: 'pointer', minWidth: '2.375rem',
                          color: active ? 'var(--wpbl-accent-fg)' : 'text.disabled',
                          // The sorted column's tint rides on backgroundImage over the opaque
                          // paper thBase already sets. As a bgcolor it would REPLACE that paper
                          // with a 14%-alpha accent, so this one header cell would go see-through
                          // and the rows scrolling under the sticky header would show through it.
                          // Same layering the frozen column beside it uses.
                          backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)` : undefined,
                          '&:hover': { color: 'var(--wpbl-accent-fg)' },
                        }}>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                          {c.label}
                          {active && <Box component="span" sx={{ fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>}
                        </Box>
                        {headLeague(leagueCell(c))}
                      </Box>
                    )
                  })}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((r, i) => {
                  // Under the qualifying bar, on a board showing everyone. Faded rather than
                  // hidden, which is the whole point of choosing Everyone, and rather than
                  // marked with a symbol, which would be one more thing on a row to decode.
                  // The footer says what the bar is.
                  const faded = mode === 'players' && !r.qualified
                  const fade = (node: React.ReactNode) => faded
                    ? <Box component="span" sx={{ opacity: FADED }}>{node}</Box>
                    : node
                  return (
                    <Box component="tr" key={r.key} onClick={r.onClick}
                      data-faded={faded ? '' : undefined}
                      ref={r.key === pickedId ? (el: HTMLElement | null) => { pickedRef.current = el } : undefined}
                      sx={{
                        // The picked-out player, tinted through backgroundImage for the same reason
                        // as hover below: the sticky cells need their opaque backgroundColor.
                        ...(r.key === pickedId ? { '& > td, & > th': { backgroundImage: pickedTint } } : {}),
                        cursor: r.onClick ? 'pointer' : 'default', userSelect: 'none',
                        WebkitTapHighlightColor: 'transparent',
                        // Hover tints via backgroundImage for the same reason as the header:
                        // the row's frozen name cell (and, on a phone, its pinned sort cell)
                        // is sticky and relies on an opaque backgroundColor. Overwriting that
                        // would make the hovered row's name cell transparent, so the stat
                        // columns scrolling beneath it would show through.
                        '@media (hover: hover)': {
                          '&:hover > td, &:hover > th': r.onClick
                            ? { backgroundImage: `linear-gradient(${WPBL_ACCENT}0e, ${WPBL_ACCENT}0e)` }
                            : undefined,
                        },
                      }}>
                      <Box component="th" data-swipe-handle="" sx={nameCellSx}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: faded ? FADED : undefined }}>
                          {/* Four rows, already in sorted order, with the sorted column
                              arrowed in the header: the rank digit restates all of that and
                              costs 24px that a nickname needs to render whole.

                              FLEX-END, NOT text-align: right. A tied two-digit rank ("T-24") is
                              wider than the column, and right-aligned TEXT still overflows to the
                              right, into the badge. A flex-end box overflows at its start, so the
                              extra runs left into the cell's padding, where there is room. */}
                          {!teamsNarrow && (
                            <Typography sx={{ width: RANK_W, display: 'flex', justifyContent: 'flex-end', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap' }}>
                              <RankText rank={ranks[i]} />
                            </Typography>
                          )}
                          {r.team && <TeamBadge team={r.team} size={20} />}
                          <Box sx={{ minWidth: 0, maxWidth: pinActive ? nameInnerMax : undefined }}>
                            {/* The NAME is the link, not the row: a <tr> cannot be an <a>, and
                                the row keeps its own onClick so the whole width stays a target.
                                This is the anchor a crawler follows and the tab stop a keyboard
                                lands on. */}
                            {/* BLOCK, which is what keeps the row at its own height. With a link the
                                name renders as an inline <a>, and an inline box inside this one sits
                                on a line box struck at the inherited 24px, not at its own 1.15, so
                                every player row came out 9px taller than its text: two rows fewer
                                on a phone's capped board. A team row has no link and renders a <p>,
                                already a block, which is why the league row never showed it. */}
                            <Typography {...r.link} sx={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {teamsNarrow && r.shortLabel ? r.shortLabel : r.label}
                            </Typography>
                            {/* Not on a phone, where the board is capped to the screen and the line
                                costs a sixth of every row. The card behind the tap has it, and the
                                ranked list never carried it either. */}
                            {r.sublabel && !pinActive && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.sublabel}</Typography>}
                          </Box>
                        </Box>
                      </Box>
                      {pinActive && (
                        <Box component="td" data-swipe-handle="" onClick={e => { e.stopPropagation(); clickHeader(activeCol) }} sx={pinnedCellSx}>
                          {fade(cellText(activeCol, r.totals))}
                        </Box>
                      )}
                      {scrollCols.map(c => {
                        const active = c.key === sortKey
                        return (
                          <Box component="td" key={c.key} onClick={e => { e.stopPropagation(); clickHeader(c) }} sx={cellSx(active)}>
                            {fade(cellText(c, r.totals))}
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>
          {/* Right-edge fade ("more stats this way"), hidden once you've scrolled to the end. */}
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
          scope={hasPostseason ? scope : null} onScope={setScope}
          showWho={source === 'season' && mode === 'players'}
          bar={qual.active ? qualBar : null}
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
// "D. Benites" to survive a narrow column; a list row has 200px and no reason to shorten
// anybody.
//
// The player's position, which the table shows under the name, gives its line to the three
// context stats. A leaderboard answers "how good", and the card behind one tap answers
// everything else, position included.
function StatListRow({ row, rank, value, context, isTeam, first, total, faded, picked }: {
  row: Row
  /** The player a rank on their card came here for. */
  picked?: { ref: React.MutableRefObject<HTMLElement | null>; tint: string }
  rank: RankMark
  /** Under the qualifying bar, on a board showing everyone. See the table's rows. */
  faded?: boolean
  value: string
  context: string
  isTeam: boolean
  first: boolean
  /** How many rows are on screen. Only used to decide whether marking a top three says
   *  anything: see the rank digit below. */
  total: number
}) {
  // A top-three mark is a claim that three rows stand out from the rest, so it needs a rest to
  // stand out FROM. On the teams board (four clubs), lighting 1, 2 and 3 and leaving 4 grey does
  // not read as "these three lead": it reads as the fourth club's number having failed to render.
  // Nothing is marked when the marked group would not be a clear minority, so the four clubs get
  // one colour and the ranking is carried by the order and the number on the right, which is all
  // it was ever carried by on a board this short.
  const marked = rank.n <= 3 && total > 6
  return (
    // A player row is an <a href> to her page; a team row has no URL, so it stays a
    // `pressable` div (role=button, tab stop, Enter/Space). Both are keyboard reachable.
    <Box {...(row.link?.href ? row.link : pressable(row.onClick))}
      ref={picked ? (el: HTMLElement | null) => { picked.ref.current = el } : undefined} sx={{
      ...FOCUS_RING,
      ...(picked ? { backgroundImage: picked.tint } : {}),
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.85,
      borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
      cursor: row.onClick ? 'pointer' : 'default',
      WebkitTapHighlightColor: 'transparent',
      // Hover only where there is one. On a touch browser it sticks to whichever row the
      // scroll started on, which reads as a selection nobody made. Same guard as LeaderRow.
      ...tappableIf(row.onClick),
      // The children, not the row: faded on the row itself, the focus ring would fade with it.
      ...(faded ? { '& > *': { opacity: FADED } } : {}),
    }}>
      <Box sx={{
        // 1.5rem (24px at the default root size), in rem because it reserves room for a NUMBER the
        // reader can enlarge: at a 1.375 text scale a two-digit rank wants 20px, and this column is the
        // first thing in the section to overflow at large text scales. See AccessibilityContext's note
        // on how far that setting is allowed to go. 1.875 rather than 1.125 since ranks can be tied, and
        // "T-10" is the widest thing it has to hold.
        // A flex box rather than text-align, so anything wider spills evenly both ways instead of
        // only to the right, into the portrait. See the table's rank for the same trap.
        width: '1.875rem', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        color: marked ? 'var(--wpbl-accent-fg)' : 'text.disabled',
      }}><RankText rank={rank} /></Box>

      {isTeam
        ? (row.team ? <TeamBadge team={row.team} size={32} /> : null)
        : <PlayerPortrait name={row.fullName ?? row.label} teamId={row.team?.id ?? null} size={32} />}

      {/* Line heights set, not inherited: MUI's body 1.5 put 6px of air in each of the two lines,
          and a row is ten of these on a screen. */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.25,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{isTeam ? (row.shortLabel ?? row.label) : (row.fullName ?? row.label)}</Typography>
          {!isTeam && row.team && <TeamBadge team={row.team} size={15} />}
        </Box>
        <Typography sx={{
          fontSize: '0.68rem', lineHeight: 1.35, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
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
// EVERY TARGET IN HERE IS AT LEAST 52px TALL. The control bar's `Chip` is 24px: fine as a
// label you glance at, half the minimum for anything a finger has to hit, and fifteen of them
// wrap into dense lines. A chip row is a good way to SHOW a small set of options and a bad way
// to let someone pick from a long one.
//
// So the options are tiles and rows, sized for a thumb, and the room that costs buys something
// back: there is space to say what each abbreviation means.

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
      ...hoverOnly({ borderColor: WPBL_ACCENT }),
    }}>
      <Typography sx={{
        fontSize: '0.85rem', fontWeight: 800, lineHeight: 1.2,
        color: on ? 'var(--wpbl-accent-fg)' : 'text.primary',
      }}>{label}</Typography>
      {hint && (
        // Wraps to a second line rather than truncating: the hint is the whole point of the
        // picker, and "Strikeouts per…" does not say which denominator. Clamped at two so a
        // long one cannot make its row of tiles tower over the rest.
        <Typography sx={{
          fontSize: '0.66rem', lineHeight: 1.25, color: 'text.disabled', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
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
      ...hoverOnly({ borderColor: WPBL_ACCENT }),
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
// Direction is named rather than described. "Ascending" is a fact about the sort and "best
// first" is what the reader wants, and the two are opposites for ERA and WHIP, which is
// exactly where getting it wrong is least forgivable.
function SortSheet({ cols, sortKey, side, eraBasis, bestFirst, onPick, onDirection, onClose }: {
  cols: Col<Totals>[]
  sortKey: string
  side: Side
  eraBasis: EraBasis
  bestFirst: boolean
  onPick: (c: Col<Totals>) => void
  onDirection: (bestFirst: boolean) => void
  onClose: () => void
}) {
  // ERA carries its denominator here and nowhere else on the board. This sheet is the one
  // place a reader is already asking what a stat means, so it is the cheapest place to answer
  // "which ERA is this" without putting a number on every column heading.
  const names = statNames(side, eraBasis)
  const groups: [string, Col<Totals>[]][] = [
    ['Rate stats', cols.filter(c => c.rate)],
    ['Counting stats', cols.filter(c => !c.rate)],
  ]
  // minmax(0, 1fr), never bare 1fr: a bare fr track will not shrink below its content's
  // min-content width, so one long hint ("Strikeouts per plate appearance") widened both columns
  // past the sheet and the whole picker scrolled sideways on a phone.
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 } as const
  return (
    <ModalShell sheet eyebrow={side === 'pitching' ? 'Rank pitchers by' : side === 'fielding' ? 'Rank fielders by' : 'Rank hitters by'}
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
// Rows rather than tiles: there are only seven, and a club wants its badge and its whole name
// rather than three letters.
function FilterSheet({ teams, teamId, onTeam, qualified, onQualified, scope, onScope, showWho, bar, onClose }: {
  teams: WpblTeam[]
  teamId: string | null
  onTeam: (id: string | null) => void
  qualified: boolean
  onQualified: () => void
  /** Null when no postseason game has finished, which is when the choice does not exist yet
   *  rather than when it is set to the regular season. */
  scope: SeasonScope | null
  onScope: (s: SeasonScope) => void
  /** The teams board has no per-player population to filter, so it gets the season group and
   *  nothing else. It is also the reason the sheet can open there at all now. */
  showWho: boolean
  /** The qualifying bar in its own unit ("36 PA", "12.0 IP"), or null before it applies. Said
   *  here because the phone's table no longer says it under the board unless Everyone is on. */
  bar: string | null
  onClose: () => void
}) {
  const rows = { display: 'flex', flexDirection: 'column', gap: 0.75 } as const
  return (
    <ModalShell sheet eyebrow="Filter" onClose={onClose} maxWidth={480}
      footer={<SheetDone onClose={onClose} />}>
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* FIRST, because it is the widest of the three: it changes which GAMES everything
            below is counted from, where the other two only choose who to list out of them. */}
        {scope && (
          <SheetGroup title="Games">
            <Box sx={rows}>
              <OptionRow label="Regular season" on={scope === 'regular'} onClick={() => onScope('regular')} />
              <OptionRow label="Playoffs" on={scope === 'postseason'} onClick={() => onScope('postseason')} />
              {/* "Both" rather than "All": the team group below opens on "All teams", and two
                  rows reading All in one sheet is a coin toss about which one a tap changes. */}
              <OptionRow label="Both" on={scope === 'all'} onClick={() => onScope('all')} />
            </Box>
          </SheetGroup>
        )}

        {showWho && (
        <>
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
            <OptionRow label="Qualified" on={qualified} hint={bar ? `${bar} or more` : undefined}
              onClick={() => { if (!qualified) onQualified() }} />
            <OptionRow label="Everyone" on={!qualified} hint={bar ? `Under ${bar} shown faded` : undefined}
              onClick={() => { if (qualified) onQualified() }} />
          </Box>
        </SheetGroup>
        </>
        )}
      </Box>
    </ModalShell>
  )
}

// Small pill used for the team filter + qualified toggle.
const Chip = FilterChip
