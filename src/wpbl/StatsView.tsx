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
  CARD_BORDER, pressable, FOCUS_RING, useWpblName, hoverOnly, tappableIf, chromePx,
  BOARD_COLUMN, BOARD_COLUMN_WIDE } from './ui'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, wpblQualifiers, plateAppearances,
  kRateLabel, scaleToBasis, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'
import { isPostseasonGame, scopedLines, type SeasonScope } from './season'
import {
  decodeFinderQuery, encodeFinderQuery, finderFields,
  type FinderQuery, type FinderVenue,
} from './derive/finder'
import type { EraBasis } from './stats'
import { track, EVENTS } from '../lib/analytics'
import { shouldShowBadge, markBadgeSeen } from '../lib/seen'
import { useWpblPlayerLink, type WpblPlayerLinkProps } from './LinkContext'
import { useWpblHeadingTag, useTabHeadingPhoneSx } from './PageHeading'
import { useEraBasis } from './EraBasisContext'
// The boards that render outside the shared season table, behind their own chunks. Hitting and
// Pitching are what the tab opens on; Tracking (the TrackMan boards) is a separate sub-tab with
// its own layout, not reachable without a deliberate tap. The draft-value model lives on
// /wpbl/league: it is one analysis of the draft class, not a season stat.
const WpblTrackingView = lazy(() => import('./TrackingView'))
const WpblPitchView = lazy(() => import('./PitchView'))
const WpblRunValueView = lazy(() => import('./RunValueView'))
const WpblBestsView = lazy(() => import('./BestsView'))
const WpblFindView = lazy(() => import('./FindView'))

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
type Side = 'hitting' | 'pitching'
type Source = 'season' | 'bests' | 'find' | 'tracked' | 'pitches' | 'runs'

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
  // good, and this league runs constantly. Same reason the steal card on Run value prices it.
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
  // How much work the outing WAS, as opposed to what it gave up. Every one of these is on the
  // feed's line, and without them the board could say a pitcher allowed two runs but not that they
  // faced nine batters or threw ninety pitches.
  { key: 'kbb',  label: 'K/BB', value: t => t.kbb, display: t => fmtTwo(t.kbb), rate: true },
  { key: 'strikePct', label: 'STR%', value: t => t.strikePct,
    display: t => (t.strikePct == null ? '—' : `${Math.round(t.strikePct * 100)}%`), rate: true },
  { key: 'bf',   label: 'BF',   value: t => t.bf },
  { key: 'p',    label: 'P',    value: t => t.pitches },
  { key: 'gs',   label: 'GS',   value: t => t.gs },
  { key: 'g',    label: 'G',    value: t => t.g },
]

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
type BoardParam = 'players' | 'teams' | 'bests' | 'find' | 'pitches' | 'runs' | 'tracked'

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

function boardParam(source: Source, mode: Mode): BoardParam {
  if (source !== 'season') return source as BoardParam
  return mode === 'teams' ? 'teams' : 'players'
}

function boardAxes(board: string | null): { source: Source; mode: Mode } | null {
  switch (board) {
    case 'players': return { source: 'season', mode: 'players' }
    case 'teams':   return { source: 'season', mode: 'teams' }
    case 'bests':   return { source: 'bests', mode: 'players' }
    case 'find':    return { source: 'find', mode: 'players' }
    case 'pitches': return { source: 'pitches', mode: 'players' }
    case 'runs':    return { source: 'runs', mode: 'players' }
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
    side: side === 'hitting' || side === 'pitching' ? side : undefined,
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
// the group's headline column, the first in each list.
function defaultSort(side: Side, key?: string): { key: string; asc: boolean } {
  const cols: Col<never>[] = (side === 'pitching' ? PIT_COLS : HIT_COLS) as unknown as Col<never>[]
  const col = (key ? cols.find(c => c.key === key) : undefined) ?? cols[0]
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
  totals: WpblBattingTotals | WpblPitchingTotals
  qualified: boolean
  onClick?: () => void
  /** Players only: the props that make this row's name a real <a href> to her page.
   *  A team row has no URL to point at, so it stays a plain onClick. */
  link?: WpblPlayerLinkProps
}

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Capped so it doesn't sprawl on huge monitors.
const FULL_BLEED_W = 'min(1540px, calc(100vw - 24px))'

// The chrome pinned above this view.
//
// Exactly one of the two terms is non-zero at a time: the toolbar is sticky only on desktop,
// the section nav only on mobile, so the sum lands just below the chrome on both without
// either breakpoint being special-cased at the call sites.
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

/** Everything between the last visible row and the top of the site footer: the line that names
 *  the population ("31 players · qualified only"), the card's own two borders, and the page's
 *  bottom gutter under it.
 *
 *  A CONSTANT, BECAUSE IT IS FURNITURE. None of it moves with the data, the board or the
 *  viewport, which is what separates it from the footer above: that one wraps to more rows as
 *  the window narrows and has to be measured. Deriving this one instead would mean reading the
 *  document's height, which on a phone includes the swipe pager's floor and any blank the board
 *  is itself leaving, so the board's height would feed back into its own cap and iterate away to
 *  nothing. */
const BOARD_TAIL_PX = 104

/** A header and about five rows: the least that is still a table. */
const MIN_BOARD_PX = 320

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
// stats table shortens names in JS before the CSS cap is reached, so nothing here ellipsizes at
// either text scale; the unit is what keeps it that way.
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
const NAME_INNER_MAX = '5.25rem'
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
  // The name column is a fixed width, so the default character threshold is the wrong test: it
  // would let a 12-character "Jamie Mackay" through whole to be cut to "Jamie Mac…" while a
  // 13-character "Denae Benites" became "D. Benites". 0 abbreviates every phone row alike.
  const shortName = useWpblName(0)
  const playerLink = useWpblPlayerLink()
  const headingTag = useWpblHeadingTag()
  const hidePhone = useTabHeadingPhoneSx()
  const isNarrow = useMediaQuery('(max-width:600px)')
  const { basis: eraBasis, offLeague: eraOffLeague, setBasis: setEraBasis, fmtEra } = useEraBasis()
  // Read ONCE, not on every render: `shouldShowBadge` reads localStorage, and re-reading it
  // each pass would put the note back the moment anything else on the board re-rendered.
  // Kept on until the reader acts, including across a switch to Hitting and back, so it is
  // still there if they went looking for the setting first.
  const [eraNoteOpen, setEraNoteOpen] = useState(() => shouldShowBadge('era-per-9'))
  const dismissEraNote = () => { markBadgeSeen('era-per-9'); setEraNoteOpen(false) }
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
  const [mode, setMode] = useState<Mode>(fromUrl.mode ?? 'players')
  // THE FIND BOARD'S QUESTION, seeded from the address bar exactly once, like the axes above.
  // `scope` is NOT held in here: the season slice is a control the whole tab shares (the chips
  // in the bar, the sheet on a phone), and duplicating it would give the board two answers to
  // one question. It is folded in where the query is used instead.
  const [findQuery, setFindQuery] = useState<Omit<FinderQuery, 'scope'>>(() => ({
    conditions: decodeFinderQuery(
      fromUrl.find ?? null,
      fromUrl.side ?? (seedAxes.side === 'pitching' ? 'pitching' : 'hitting'),
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

  // Re-focus the table whenever another surface sends us here. Keyed on `token`, NOT on the
  // group/column values: this panel stays mounted once visited, so seeding state at mount is
  // not enough (a second jump would be a no-op), while reacting to the values alone would
  // fight the reader's own sorting on every unrelated re-render. A token bump means "the
  // reader just asked for this view" and nothing else does.
  const requested = focus?.token ?? 0
  useEffect(() => {
    if (!focus || requested === 0) return
    const axes = axesOf(focus.group)
    if (axes.side) setSide(axes.side)
    setSource(axes.source)
    // A link can also ask for the teams board, for the player board already narrowed to one
    // club, or for the qualified filter off: the states the team page links into. All three
    // are left alone when the link doesn't mention them, so an ordinary jump is unaffected.
    if (focus.mode) setMode(focus.mode)
    if (focus.teamId !== undefined) setTeamId(focus.teamId)
    if (focus.qualified !== undefined) setQualified(focus.qualified)
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
    })
    return cols
  }, [lines.batting, mode, games, scope])

  // ERA+ mirrors OPS+ for pitchers: league ERA over the pitcher's ERA, ×100 (100 = league
  // average, higher is better; it inverts ERA, so unlike ERA it sorts descending). No
  // park factor, same reasoning as OPS+. A 0.00 ERA has no finite ratio, so it reads "∞" and
  // sorts to the top rather than dashing to the bottom. Sits right after ERA.
  const pitCols = useMemo<Col<WpblPitchingTotals>[]>(() => {
    const lgEra = sumPitching(lines.pitching, games, scope).era
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
    })
    cols.splice(eraIdx + 1, 0, {
      key: 'eraPlus', label: 'ERA+',
      value: eraPlus,
      display: t => { const v = eraPlus(t); return v == null ? '—' : !isFinite(v) ? '∞' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.pitching, fmtEra, eraBasis, games, scope])

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
    // The Find board's conditions are keyed to one side's fields: innings pitched and earned
    // runs are pitching-only, total bases and stolen bases hitting-only. Left alone, a
    // condition on a field the other side does not have survives the switch as a picker stuck
    // on a blank option and a query that silently matches nothing, which reads as a broken
    // board rather than as a stat that does not apply. Drop those on the switch; a shared field
    // (strikeouts, home runs, walks) stays and changes sense with the side.
    setFindQuery(prev => {
      const valid = new Set(finderFields(s).map(f => f.key))
      const conditions = prev.conditions.filter(c => valid.has(c.field))
      return conditions.length === prev.conditions.length ? prev : { ...prev, conditions }
    })
  }
  const switchSource = (s: Source) => {
    if (s !== source) logBoard('source', { source: s })
    setSource(s)
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
    const board = boardParam(source, mode)
    const def = defaultSort(side)
    // Only what the reader has actually changed. A default view keeps a bare /wpbl/stats, and a
    // link they paste carries only the part worth saying.
    const set = (k: string, v: string | null) => { if (v == null) q.delete(k); else q.set(k, v) }
    set('board', board === 'players' ? null : board)
    set('side', side === 'hitting' ? null : side)
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
  }, [active, source, mode, side, sortKey, sortAsc, findQuery, scope])

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
        ? aggregateBatting(players, lines.batting, games, scope).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: plateAppearances(s.totals) >= qual.minPa }))
        : aggregatePitching(players, lines.pitching, games, scope).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.outs >= qual.minOuts }))
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
  }, [mode, side, players, lines, teams, teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, shortName, lobByGameTeam, games, scope])

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The five boards, in one row. `source` and `mode` stay as they were underneath: the deep
  // links, the ?view= URLs and axesOf() all speak that language, and collapsing them into a
  // single state would mean rewriting all of it to gain a variable.
  const boards: { key: string; label: string; badge?: boolean }[] = [
    { key: 'players', label: 'Players' },
    { key: 'teams', label: 'Teams' },
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
    // Hidden while the league has published radar for barely any games, and kept for the
    // session once a link has opened it anyway. See trackedOffered.
    ...(trackedOffered ? [{ key: 'tracked', label: 'Tracked' }] : []),
  ]
  const activeBoard = source === 'season' ? mode : source
  const selectBoard = (k: string) => {
    if (k === 'players' || k === 'teams') { switchSource('season'); switchMode(k as Mode) }
    else switchSource(k as Source)
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
          // WHICH GAMES, IN WORDS. On a phone the scope chips live in the Filters sheet, and a sheet is
          // shut: a board counting the playoffs looks exactly like one counting the season, for the
          // reader most likely to have set it by accident. The pill's dot says only that SOMETHING is
          // not the default; this is the line that says what.
          scope === 'postseason' ? '2026 playoffs'
            : scope === 'all' ? '2026 season + playoffs'
            : '2026 season',
          // Only when the reader has moved OFF the league's basis, and only on the pitching
          // side. Their ERA no longer matches the one the league publishes, and that is worth
          // a permanent three words at the foot rather than relying on a note they dismissed
          // weeks ago. On the league's own basis it would be noise on every board.
          side === 'pitching' && eraOffLeague ? `ERA per ${eraBasis}` : null,
        ].filter(Boolean).join(' · ')}
        {!listView && ' · tap a column to sort'}
      </Typography>
      {/* The way into the grid and back out. At the foot rather than in the control bar: it is
          a preference someone sets once, not a control they work with, and every pixel of the
          bar is taken from the board. It reads as a foot because the list is capped.

          The row above it adds PLAYERS and this one adds COLUMNS. The label names what it
          switches to, a table, rather than what it gets you, so a reader does not have to
          press it to find out what it does. */}
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
  // when switching sides, but only if it isn't already visible, so a wide desktop
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

  // THE BAR PUBLISHES ITS OWN HEIGHT, because the board below pins to the BOTTOM of it and
  // nothing else on the page can know where that is: the shell reports its own chrome
  // (`--app-header-h`, `--wpbl-nav-h`) and this bar pins under that, wrapping to two rows on a
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
    }
    publish()
    // jsdom has no ResizeObserver in every environment this runs in; the values published above
    // are still correct for a layout that never changes.
    //
    // Watching the document as well as the bar is what catches the footer arriving, or growing
    // a row as the window narrows. It cannot feed back on itself: what gets published is the
    // FOOTER's height, and the footer does not care how tall the board is, so a republish on a
    // board resize writes the same value and stops there.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    if (ro) { ro.observe(el); ro.observe(document.body) }
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--wpbl-stats-bar-h')
      root.style.removeProperty('--wpbl-foot-h')
    }
  }, [loading])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }

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
        <Box sx={{
          display: 'flex', alignItems: 'flex-end', gap: { xs: 1.5, sm: 2 }, mb: 1.25,
          borderBottom: '1px solid', borderColor: 'divider',
          overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {boards.map(b => {
            const on = b.key === activeBoard
            return (
              <Box key={b.key} {...pressable(() => selectBoard(b.key))} aria-current={on ? 'page' : undefined}
                // The dot is aria-hidden, so a badged tab carries the news in its name instead,
                // the same way SegNav's pills do one level up.
                aria-label={b.badge ? `${b.label}, updated` : undefined} sx={{
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
      <Typography component={headingTag} sx={{
        ...fullBleedSx,
        fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, mb: 1,
        // Spread LAST: when it hides, it is absolute positioning at 1px square and has to beat the
        // width and negative margins the full-bleed rule above just set. Drawn on a phone once the
        // nav is at the foot of the screen (see useTabHeadingPhoneSx), same as every tab title.
        ...hidePhone,
      }}>
        WPBL Stats
      </Typography>
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
        pt: 1,
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
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, rowGap: 1, pb: 1.5,
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
      {source === 'tracked' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblTrackingView side={side} games={games} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : source === 'bests' ? (
        // FULL BLEED for the same reason Run value is, and the board caps and centres inside
        // it: below `sm` the bleed is `calc(100vw - 24px)`, which is WIDER than the page
        // column, and those 8px are the difference between a name fitting and being clipped at
        // the reader's Large text setting. The cap simply never binds on a phone.
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblBestsView side={side} players={players} batting={lines.batting}
              pitching={lines.pitching} games={games} scope={scope}
              onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
          </Suspense>
        </Box>
      ) : source === 'find' ? (
        <Box sx={fullBleedSx}>
          <Suspense fallback={<SubViewFallback />}>
            <WpblFindView side={side} teams={teams} players={players} batting={lines.batting}
              pitching={lines.pitching} games={games}
              query={{ ...findQuery, scope }} onQuery={q => setFindQuery(q)}
              onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
          </Suspense>
        </Box>
      ) : source === 'pitches' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblPitchView side={side} teams={teams} games={games} trackedVisible={trackedOffered} onOpenPlayer={onOpenPlayer} />
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
            <WpblRunValueView side={side} teams={teams} games={games} battingLines={lines.batting}
              onOpenPlayer={onOpenPlayer} />
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
              page. `dvh` tracks the mobile browser chrome so the cap doesn't overshoot.

              TWO SUBTRACTIONS, because a phone turned sideways wants a different one.

              260px is everything standing above the table at the top of the page: toolbar, tab
              nav, board picker, sort row. Subtracting all of it means "tall enough that nothing
              has to scroll", which is the right answer whenever the screen can afford it.

              A landscape phone cannot: 375dvh less 260 is a 115px window, the header and two
              rows, which reads as broken rather than tight. There the page has to scroll, and
              the cap becomes what fits in the gap the PINNED chrome leaves.

              That gap is asked for rather than assumed. The shell publishes whichever of its
              bars is actually holding a position (--app-header-h on desktop, --wpbl-nav-h on
              mobile, both 0 when the bar is static), so subtracting the sum is right at every
              width without naming a breakpoint here. 100px is this page's OWN control bar,
              which pins under them and is the one height the shell cannot report (about 91px,
              the rest slack).

              Going taller than that breaks the thing this box exists for: a table taller than
              the free gap can never be scrolled fully into it, so its sticky header parks
              behind the nav and the reader loses the column labels for the rest of the board.

              560px is where the two meet: the height at which the first subtraction still
              leaves about eight rows, the point below which a scroll-box stops being a table. */}
          <Box ref={scrollRef} sx={{
            overflowX: 'auto', overflowY: 'auto', overscrollBehavior: 'contain',
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
            '@media (max-width:600px)': {
              maxHeight: `max(${MIN_BOARD_PX}px, calc(100dvh - ${BOARD_TOP} - var(--wpbl-foot-h, 0px) - ${BOARD_TAIL_PX}px))`,
            },
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
                      <Box component="th" data-swipe-handle="" sx={{
                        position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
                        textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
                        width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined,
                        borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                        touchAction: pinActive ? 'pan-y' : undefined,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {/* Four rows, already in sorted order, with the sorted column
                              arrowed in the header: the rank digit restates all of that and
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
          side={side} minPa={qual.minPa} minIp={outsToIp(qual.minOuts)}
          scope={hasPostseason ? scope : null} onScope={setScope}
          showWho={source === 'season' && mode === 'players'}
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
  // stand out FROM. On the teams board (four clubs), lighting 1, 2 and 3 and leaving 4 grey does
  // not read as "these three lead": it reads as the fourth club's number having failed to render.
  // Nothing is marked when the marked group would not be a clear minority, so the four clubs get
  // one colour and the ranking is carried by the order and the number on the right, which is all
  // it was ever carried by on a board this short.
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
      ...tappableIf(row.onClick),
    }}>
      <Box sx={{
        // 1.125rem (18px at the default root size), in rem because it reserves room for a NUMBER the
        // reader can enlarge: at a 1.375 text scale a two-digit rank wants 20px, and this column is the
        // first thing in the section to overflow at large text scales. See AccessibilityContext's note
        // on how far that setting is allowed to go.
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
// who switched bases and then lost the line would be left on numbers that disagree with the
// league's own site with nothing on screen saying where that came from or how to undo it. Two
// clauses is cheap; a reader who thinks the site is simply wrong is not.
//
// Once the badge store's expiry has passed (see lib/seen.ts), the note and its key can be
// deleted together.
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

// Choosing what the board ranks by. Two columns of tiles: sixteen options as full-width rows
// is three screenfuls of scrolling, and two columns is one and a bit, with every tile still
// 165px wide on the narrowest phone.
//
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
    ? {
      ...PIT_NAMES,
      era: `Earned run average, per ${eraBasis}`,
      // The strikeout RATE. Its key is `k9` and its label is built at render time, so a static
      // entry in PIT_NAMES could not carry the denominator and a lookup on the key would find
      // nothing, leaving "K/7" unexplained in the one place a reader is asking what a column means.
      k9: `Strikeouts per ${eraBasis} innings`,
    }
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
// rather than three letters, and "Qualified" needs a sentence under it saying what qualified
// MEANS: a word a reader either knows or is excluded by, set against a bar that moves with
// the season (see wpblQualifiers), so nobody could know it from memory either.
function FilterSheet({ teams, teamId, onTeam, qualified, onQualified, side, minPa, minIp, scope, onScope, showWho, onClose }: {
  teams: WpblTeam[]
  teamId: string | null
  onTeam: (id: string | null) => void
  qualified: boolean
  onQualified: () => void
  side: Side
  minPa: number
  minIp: string
  /** Null when no postseason game has finished, which is when the choice does not exist yet
   *  rather than when it is set to the regular season. */
  scope: SeasonScope | null
  onScope: (s: SeasonScope) => void
  /** The teams board has no per-player population to filter, so it gets the season group and
   *  nothing else. It is also the reason the sheet can open there at all now. */
  showWho: boolean
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
            <OptionRow label="Qualified" on={qualified}
              hint={side === 'pitching' ? `${minIp} innings pitched or more` : `${minPa} plate appearances or more`}
              onClick={() => { if (!qualified) onQualified() }} />
            {/* No hint. "Qualified" needs one because it names a threshold a reader cannot see;
                "Everyone" is self-evident, and a warning here would be the board arguing with the
                option it is offering. */}
            <OptionRow label="Everyone" on={!qualified}
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
      ...hoverOnly({ borderColor: WPBL_ACCENT }),
    }}>
      {children}
    </Box>
  )
}
