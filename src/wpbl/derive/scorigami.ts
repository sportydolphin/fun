// WPBL Scorigami: every final score the league has produced, as a grid.
//
// A "scorigami" is a final score that has never happened before. In an inaugural season that is
// nearly all of them, so the grid is mostly the record of what HAS occurred rather than a hunt for
// the novel one; it fills in as the seasons stack. See ROADMAP-WPBL.md, Visuals.
//
// FROM wpbl_games ALONE. A final carries both scores on its own row, so this is a group-by over the
// schedule and nothing else: no lines, no plays, no roster. It takes the games array the section
// already caches and returns a map the component draws.
//
// POSTSEASON COUNTS. Everywhere else on the section a postseason box score is held out of season
// totals (countsInStandings, and the scope machinery in season.ts), because a bracket game is not
// part of the 34-game record. A score is not a record: 11-9 happened whether it happened in July or
// in the semifinal, and a grid of "scores this league has produced" that omitted the postseason
// would be lying by a different name. So this deliberately does NOT filter on counts_in_standings or
// game_type; every FINAL is a cell.

import type { WpblGame } from '../types'

/** One filled square: a final score, and the games that ended on it. */
export interface ScorigamiCell {
  /** The winning (larger) score. Always > lose. */
  win: number
  /** The losing (smaller) score. */
  lose: number
  /** How many games ended on exactly this score. */
  count: number
  /** The earliest game with this score: the "first time it happened", which is what the cell links
   *  to. In the inaugural season every score is that first, so this is simply the one occurrence for
   *  most cells. */
  first: WpblGame
  /** Every game with this score, earliest first, so a repeated score can name them all. */
  games: WpblGame[]
}

export interface WpblScorigamiGrid {
  /** Keyed `${win}-${lose}`, so a cell is a direct lookup while drawing. */
  cells: Map<string, ScorigamiCell>
  /** The largest winning score seen; the grid's height and (win) axis top. 0 when there are no
   *  finals yet, which the component reads as its empty state. */
  maxWin: number
  /** Finals counted (both scores present, not a tie). The denominator under the grid. */
  totalGames: number
}

/** The map key for a cell, shared by the builder and every reader so the two cannot spell it
 *  differently. */
export const scorigamiKey = (win: number, lose: number): string => `${win}-${lose}`

/** A game's date as a sortable string, tolerant of a missing one. `game_date` is 'YYYY-MM-DD', which
 *  sorts lexically; the id breaks a same-day tie so "first" is deterministic. */
const gameOrder = (g: WpblGame): string => `${String(g.game_date ?? '')}|${g.id}`

/**
 * Build the scorigami grid from the schedule.
 *
 * Only FINAL games with two present scores that differ are counted. A tie cannot happen in this
 * league (extra innings settle it), so an equal-score row is treated as bad data and dropped rather
 * than drawn on a diagonal the grid does not have.
 */
export function wpblScorigami(games: readonly WpblGame[]): WpblScorigamiGrid {
  const finals = games.filter(g =>
    g.status === 'final'
    && g.home_score != null && g.away_score != null
    && g.home_score !== g.away_score)

  const cells = new Map<string, ScorigamiCell>()
  let maxWin = 0

  // Earliest first, so the first push into a cell's `games` is its `first` and the array stays
  // date-ascending without a second sort.
  const ordered = [...finals].sort((a, b) => gameOrder(a).localeCompare(gameOrder(b)))

  for (const g of ordered) {
    const win = Math.max(g.home_score!, g.away_score!)
    const lose = Math.min(g.home_score!, g.away_score!)
    if (win > maxWin) maxWin = win
    const key = scorigamiKey(win, lose)
    const existing = cells.get(key)
    if (existing) {
      existing.count += 1
      existing.games.push(g)
    } else {
      cells.set(key, { win, lose, count: 1, first: g, games: [g] })
    }
  }

  return { cells, maxWin, totalGames: finals.length }
}
