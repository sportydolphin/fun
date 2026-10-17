// The season page's leader boards: which figures, and who ranks on them. Split out of SeasonPage.tsx.
import { plateAppearances, fmtRate, fmtTwo, type WpblBatSeason, type WpblPitSeason } from '../stats'
import { compareRows } from '../leaderOrder'

// ─── Leader boards ──────────────────────────────────────────────────────────────
// One accessor per category. `null` from the accessor drops the row (no denominator), which is
// what keeps a pitcher with no innings off the ERA board rather than sorting them to the top.

// `chip` is the short name on a phone's stat chips, where six full labels would not fit a row.
type BatKey = { label: string; chip: string; get: (t: WpblBatSeason['totals']) => number | null; fmt: (v: number) => string; asc?: boolean; rate?: boolean }
type PitKey = { label: string; chip: string; get: (t: WpblPitSeason['totals']) => number | null; fmt: (v: number) => string; asc?: boolean; rate?: boolean }

const asInt = (v: number) => String(v)

export const BAT_BOARDS: BatKey[] = [
  { label: 'AVG', chip: 'AVG', get: t => t.avg, fmt: fmtRate, rate: true },
  { label: 'OPS', chip: 'OPS', get: t => t.ops, fmt: fmtRate, rate: true },
  { label: 'Home runs', chip: 'HR', get: t => t.hr, fmt: asInt },
  { label: 'RBI', chip: 'RBI', get: t => t.rbi, fmt: asInt },
  { label: 'Hits', chip: 'H', get: t => t.h, fmt: asInt },
  { label: 'Stolen bases', chip: 'SB', get: t => t.sb, fmt: asInt },
]

export const PIT_BOARDS: PitKey[] = [
  { label: 'Wins', chip: 'W', get: t => t.w, fmt: asInt },
  { label: 'ERA', chip: 'ERA', get: t => t.era, fmt: fmtTwo, asc: true, rate: true },
  { label: 'Strikeouts', chip: 'K', get: t => t.so, fmt: asInt },
  { label: 'WHIP', chip: 'WHIP', get: t => t.whip, fmt: fmtTwo, asc: true, rate: true },
  { label: 'Saves', chip: 'SV', get: t => t.s, fmt: asInt },
]

const TOP_N = 3
/** Everyone tied for the last place shown is shown, up to this: the 2026 wins title was a
 *  five-way tie at 3, and three of the five, picked by roster order, read as a ranking of them. */
const TIED_CAP = 6

/**
 * The top three and anyone tied with the third, in the Leaders board's order (`compareRows`: value,
 * then the bigger sample, then the name). A tie is judged on the figure as printed, as the Leaders
 * board and the Stats table judge it, so two co-leaders read "T-1" here as they do there.
 */
function topWithTies<S>(sorted: S[], text: (s: S) => string): S[] {
  if (sorted.length <= TOP_N) return sorted
  const cut = text(sorted[TOP_N - 1])
  let n = TOP_N
  while (n < sorted.length && n < TIED_CAP && text(sorted[n]) === cut) n++
  return sorted.slice(0, n)
}

/** Rank a set of season lines by one accessor, dropping nulls and (for a rate title) anyone
 *  short of the qualifying bar. */
export function rankBatting(seasons: WpblBatSeason[], board: BatKey, minPa: number, active: boolean): WpblBatSeason[] {
  const eligible = seasons.filter(s => {
    if (board.get(s.totals) == null) return false
    if (board.rate && active && plateAppearances(s.totals) < minPa) return false
    return true
  })
  eligible.sort((a, b) => compareRows(board.get(a.totals), board.get(b.totals), !!board.asc,
    plateAppearances(a.totals), plateAppearances(b.totals), a.player.name, b.player.name))
  return topWithTies(eligible, s => board.fmt(board.get(s.totals)!))
}

export function rankPitching(seasons: WpblPitSeason[], board: PitKey, minOuts: number, active: boolean): WpblPitSeason[] {
  const eligible = seasons.filter(s => {
    if (board.get(s.totals) == null) return false
    if (board.rate && active && s.totals.outs < minOuts) return false
    // A save or win board should not be topped by someone with one appearance and a fluke; but
    // counting stats are their own qualifier (you cannot accumulate them without playing), so
    // only the rate boards gate. The `w`/`s` boards drop a zero via the value sort naturally.
    return true
  })
  eligible.sort((a, b) => compareRows(board.get(a.totals), board.get(b.totals), !!board.asc,
    a.totals.outs, b.totals.outs, a.player.name, b.player.name))
  // Drop trailing zeros on a counting board so "Saves" does not list three players tied at 0.
  const nonZero = eligible.filter(s => (board.get(s.totals) ?? 0) > 0)
  return topWithTies(nonZero.length ? nonZero : eligible, s => board.fmt(board.get(s.totals)!))
}
