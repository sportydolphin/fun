import type { WpblPitchingUsageRow } from '../types'

/**
 * Shapes wpbl_pitching_usage rows into the bullpen-usage grid: the most recent games across
 * the top in chronological order (oldest left, newest right), pitchers down the side, pitch
 * count in each cell.
 *
 * Pure and separate from the component so the ordering rule — the part with judgement in
 * it — can be tested.
 */

export type UsageCell = {
  started: boolean
  outs: number
  pitches: number | null
  daysRest: number | null
}

export interface UsageGrid {
  games: { id: string; date: string; opp: string | null }[]
  /** Pitcher ids, in render order. */
  pitchers: string[]
  cells: Map<string, Map<string, UsageCell>>
  /** Total pitches thrown inside the window, per pitcher. */
  windowPitches: Map<string, number>
}

/**
 * Where a pitcher sorts. A usage chart is read top-down as "rotation, then bullpen", so
 * anyone who has started inside the window comes first, ordered by their most recent start:
 * that puts whoever pitched last night at the top and, by extension, shows the rotation in
 * turn order. Relievers follow, heaviest workload first, because the whole question the
 * chart answers is who has been leaned on.
 *
 * `gameOrder` is the grid's DISPLAY order, oldest to newest, so the most recent start is the
 * HIGHEST index and the sort key is negated to keep "most recent" sorting first. This used
 * to be a plain `Math.min` back when the columns ran newest-first; flipping the columns
 * without flipping this would have quietly reversed the rotation, ranking each starter by
 * their OLDEST outing in the window.
 */
export function rankPitcher(cells: UsageCell[], gameOrder: string[], gameOf: Map<UsageCell, string>) {
  const startedAt = cells.filter(c => c.started).map(c => gameOrder.indexOf(gameOf.get(c)!))
  const pitches = cells.reduce((s, c) => s + (c.pitches ?? 0), 0)
  return startedAt.length
    ? { group: 0, key: -Math.max(...startedAt), pitches }
    : { group: 1, key: 0, pitches }
}

// Two sorts, because picking the games and showing them want opposite orders.
//
// The WINDOW is the N most recent games, so choosing them means sorting newest first and
// taking the head. The DISPLAY is left-to-right chronological, matching every other
// time-ordered surface in the app: the scoreboard strip runs oldest to newest across, and a
// player's game log reads top-down the same way. These two grids used to be the only places
// that ran backwards.
//
// Two games can share a date (a doubleheader) and the view carries no start time or game
// number to separate them, so the id breaks the tie: an arbitrary order, but a STABLE one,
// and the same one in both grids. Without it the two cards on a team page could show the
// same doubleheader's columns in opposite orders. Note the tie-break stays ASCENDING in
// both, so reversing the window can't flip a doubleheader's two games against each other.
const byGameDesc = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  b.date.localeCompare(a.date) || a.id.localeCompare(b.id)
const byGameAsc = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

export function buildUsageGrid(rows: WpblPitchingUsageRow[], maxGames: number): UsageGrid {
  const meta = new Map<string, { id: string; date: string; opp: string | null }>()
  for (const r of rows) {
    if (!meta.has(r.game_id)) {
      meta.set(r.game_id, { id: r.game_id, date: r.game_date, opp: r.opponent_team_id })
    }
  }
  const games = [...meta.values()].sort(byGameDesc).slice(0, maxGames).sort(byGameAsc)
  const order = games.map(g => g.id)
  const keep = new Set(order)

  const cells = new Map<string, Map<string, UsageCell>>()
  const gameOf = new Map<UsageCell, string>()
  for (const r of rows) {
    if (!keep.has(r.game_id)) continue
    let m = cells.get(r.player_id)
    if (!m) { m = new Map(); cells.set(r.player_id, m) }
    const existing = m.get(r.game_id)
    const cell: UsageCell = {
      started: r.started, outs: r.outs, pitches: r.pitches, daysRest: r.days_rest,
    }
    // Two outings in one game shouldn't happen, but if the feed ever emits them, add the
    // work together rather than letting one silently replace the other.
    if (existing) {
      existing.outs += r.outs
      existing.pitches = (existing.pitches ?? 0) + (r.pitches ?? 0)
      existing.started = existing.started || r.started
    } else {
      m.set(r.game_id, cell)
      gameOf.set(cell, r.game_id)
    }
  }

  const windowPitches = new Map<string, number>()
  for (const [pid, m] of cells) {
    windowPitches.set(pid, [...m.values()].reduce((s, c) => s + (c.pitches ?? 0), 0))
  }

  const pitchers = [...cells.keys()].sort((a, b) => {
    const ra = rankPitcher([...cells.get(a)!.values()], order, gameOf)
    const rb = rankPitcher([...cells.get(b)!.values()], order, gameOf)
    return ra.group - rb.group || ra.key - rb.key || rb.pitches - ra.pitches
  })

  return { games, pitchers, cells, windowPitches }
}

/** Outs → the "4.2" innings-pitched convention (whole innings, then outs after the dot). */
export function outsToIpShort(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}
