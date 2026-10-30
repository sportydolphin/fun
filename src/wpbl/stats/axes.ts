import type { WpblValueTotals } from '../derive/playerValue'
import {
  type WpblBattingTotals, type WpblPitchingTotals, type WpblFieldingTotals,
} from '../stats'
import { HIT_COLS, PIT_COLS, OVR_COLS, type Col } from '../statColumns'
import { FLD_COLS } from './columns'

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
// changes; see trackingWorthShowing). The pitch board is labeled "Pitch by pitch", not
// "Pitches", which beside the side named Pitching reads as "you are about to leave the
// hitters". The internal value stays 'pitches' so the board-usage analytics keep one name.
//
// FIELDING IS THE THIRD SIDE, on screen as well as in here (Oct 2026). It was a tab in the board row
// for a while, because a third option did not fit a phone beside Sort and Filters (390px in a 351px
// row); those two are one pill now, which is what made the room. Leaders, Players, Teams and Find
// answer it (`sideOn`). Every other board reads `boardSide`, the last of Hitting or Pitching the
// reader chose, and moving to one of them while on Fielding drops the switch back to it.
//
// OVERALL IS THE FOURTH, and the first (Oct 2026). Every other side splits a player in half, so a
// two-way player's season was never added up anywhere, and the value figures (wins added, run
// value, baserunning, the catcher's arm) lived one side at a time on Run value. Overall puts them
// in one row per player. It is where Leaders and Players open, and only those two answer it
// (`sideOn`): Teams, Bests, Find and the play-by-play boards rank something Overall has no row for.
export type Side = 'overall' | 'hitting' | 'pitching' | 'fielding'
/** The side every board other than the season tables speaks. */
export type BallSide = 'hitting' | 'pitching'
export type Totals = WpblBattingTotals | WpblPitchingTotals | WpblFieldingTotals | WpblValueTotals
export type Source = 'leaders' | 'season' | 'bests' | 'find' | 'tracked' | 'pitches' | 'runs' | 'draft' | 'charts'

export type Mode = 'players' | 'teams'

// The deep-link contract: a link asks for 'hitting'/'pitching' with a column, and a legacy
// ?view=tracking URL asks for 'tracking'. Resolved onto the axes above.
export type Group = 'hitting' | 'pitching' | 'tracking' | 'pitches' | 'runs' | 'findings'

// A tracking link names no side, so it lands on whichever one the reader already had open.
export function axesOf(g: Group): { side?: Side; source: Source } {
  if (g === 'tracking') return { source: 'tracked' }
  if (g === 'pitches') return { source: 'pitches' }
  if (g === 'runs') return { source: 'runs' }
  // Findings is folded into Run value (see PlayValue.tsx). The group stays in the union rather
  // than being deleted: nothing in the app constructs it, but a bookmark or a stale link still
  // can, and the honest answer is the board its cards moved to.
  if (g === 'findings') return { source: 'runs' }
  return { side: g, source: 'season' }
}

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
export type View = 'standard' | 'advanced'
export const VIEW_ORDER: Record<Side, Record<View, readonly string[]>> = {
  // FanGraphs' order: playing time, then the runs a player made (batting, the bases, the glove, the
  // position, pitching), then WAR last, the one-number answer, with wins added after it as the
  // second opinion. Advanced takes the glove apart and shows the two adjustments every row carries.
  overall: {
    standard: ['pa', 'ip', 'bat', 'bsr', 'fld', 'pos', 'pit', 'batWar', 'pitWar', 'war', 'wpa'],
    advanced: ['pa', 'ip', 'rng', 'err', 'dp', 'ofArm', 'cArm', 'cBlk', 'fld', 'gdp', 'lgAdj', 'rep', 'war'],
  },
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
export const VIEW_OPTIONS = [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced' }]
// THE SIDE OF THE GAME IS ONE SWITCH, on every board, in the same place, with all three sides in it.
// Fielding was a board in the tab row until Oct 2026 while Hitting and Pitching were this switch,
// so the three answers to one question lived in two places, and opening Fielding made the switch
// vanish and the controls after it slide left. A board that cannot answer Fielding keeps the option
// drawn, so the switch is the same width everywhere, and pressing it goes to Leaders on that side
// (`pickSide`). It was drawn disabled until Oct 2026: faded to 40%, which took its text under the
// contrast floor, and a pill that does nothing when pressed read as a broken board.
export const SIDES: { value: Side; label: string }[] = [
  { value: 'overall', label: 'Overall' },
  { value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }, { value: 'fielding', label: 'Fielding' },
]
/** Whether a board answers a side. Hitting and Pitching are answered everywhere. Fielding by the
 *  season tables (one row per fielder, one per club), the leader cards built from the same lines, and
 *  Find, which searches the fielding lines one night at a time: Bests and the play-by-play boards
 *  read batting and pitching lines only. Overall by Leaders and Players, the two that rank players: a
 *  club's wins added is just its record. */
export function sideOn(side: Side, source: Source, mode: Mode = 'players'): boolean {
  if (side === 'fielding') return source === 'season' || source === 'leaders' || source === 'find'
  if (side === 'overall') return source === 'leaders' || (source === 'season' && mode === 'players')
  return true
}
/** Where a board opens, and what an address with no `side` means on it. */
export const defaultSide = (source: Source, mode: Mode = 'players'): Side =>
  (sideOn('overall', source, mode) ? 'overall' : 'hitting')
/** The side a linked column belongs to, for an address that names a column and no side: every link
 *  written before Overall existed, when a missing side meant Hitting. */
export function sideOfSort(key: string): Side | undefined {
  for (const s of ['hitting', 'pitching', 'fielding', 'overall'] as const) {
    if (Object.prototype.hasOwnProperty.call(DERIVED_SORTS[s], key) || colsFor(s).some(c => c.key === key)) return s
  }
  return undefined
}
export function inView(side: Side, view: View, key: string): boolean {
  const order = VIEW_ORDER[side]
  if (!order.standard.includes(key) && !order.advanced.includes(key)) return view === 'standard'
  return order[view].includes(key)
}
/** A view's columns in its own order, plus (on Standard) anything neither list names. */
export function orderForView<C extends { key: string }>(side: Side, view: View, cols: C[]): C[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const named = VIEW_ORDER[side][view].map(k => byKey.get(k)).filter((c): c is C => !!c)
  if (view === 'advanced') return named
  const known = new Set([...VIEW_ORDER[side].standard, ...VIEW_ORDER[side].advanced])
  return [...named, ...cols.filter(c => !known.has(c.key))]
}
/** The view a sort column lives in, preferring the one already showing. */
export function viewFor(side: Side, key: string, current: View): View {
  return inView(side, current, key) ? current : current === 'standard' ? 'advanced' : 'standard'
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
  overall: {},
}
// The column each side opens on. ONE NAME, read by the cold load, the side switch and the view
// switch alike: the cold load used to take the first column in HIT_COLS (AVG) while the two
// switches hard-coded OPS, so the board opened on one headline and came back from Pitching on
// another. Both views carry both of these, which is what lets the view switch fall back to them.
const HEADLINE: Record<Side, string> = { overall: 'war', hitting: 'ops', pitching: 'era', fielding: 'fpct' }

/** A side's module-scope columns. The render-time ones (OPS+, FIP and the rest) are DERIVED_SORTS. */
function colsFor(side: Side): Col<never>[] {
  return (side === 'pitching' ? PIT_COLS : side === 'fielding' ? FLD_COLS : side === 'overall' ? OVR_COLS : HIT_COLS) as unknown as Col<never>[]
}

export function defaultSort(side: Side, key?: string): { key: string; asc: boolean } {
  if (key && Object.prototype.hasOwnProperty.call(DERIVED_SORTS[side], key)) return { key, asc: DERIVED_SORTS[side][key] }
  const cols = colsFor(side)
  const col = (key ? cols.find(c => c.key === key) : undefined) ?? cols.find(c => c.key === HEADLINE[side])!
  return { key: col.key, asc: !!col.lowerBetter }
}
