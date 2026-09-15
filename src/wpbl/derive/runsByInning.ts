// Runs by inning: when in a game each club scores, and when it gives them up.
//
// FROM THE LINE SCORES ALONE. Every final row carries `away_line` / `home_line`, and both lines sum
// exactly to the final score, so this is a group-by over the schedule the section already caches:
// no box-score lines, no plays. A row whose lines do not add up is skipped (see `battedHalves`).
//
// THE DENOMINATOR IS HALF-INNINGS BATTED, NOT GAMES, and the feed hides the difference. A bottom
// half the home side never needed to bat (it led after the top of the last inning) is stored as
// `{ runs: 0 }`, byte-identical to a half it batted and did not score in, and nearly every home win
// ends on one. Divide by games and every club's home 7th reads as a scoreless inning it never
// played, dragging each club's 7th toward zero by roughly half its home games, so the league's
// "quiet 7th" would be an artefact of scorekeeping rather than a finding. `battedHalves` infers the
// unbatted half from the score and drops it.
//
// EXTRA INNINGS SHARE ONE COLUMN. Extra-inning games are rare enough that a column per extra
// inning would be a column of one or two games each. Pooled, and still divided by the halves
// actually batted, so a game that goes to the 9th contributes two halves, not one.
//
// REGULAR SEASON AND POSTSEASON ARE SEPARATE SCOPES, split by `countsInStandings` and nothing
// else. The feed sends `counts_in_standings: true` on postseason rows (see CLAUDE.md), so the
// split holds on that function's `game_type` backstop, the same one every season total relies on.

import { countsInStandings } from '../season'
import type { WpblGame, WpblLineScoreEntry, WpblTeam } from '../types'

export type RunsScope = 'regular' | 'postseason'

/** Regulation length in this league. */
export const REGULATION_INNINGS = 7
/** The one column every extra inning folds into. */
export const EXTRAS_COLUMN = REGULATION_INNINGS + 1

export interface InningCell {
  /** 1 to REGULATION_INNINGS, or EXTRAS_COLUMN for every extra inning pooled. */
  inning: number
  runs: number
  /** Half-innings actually batted that land in this column. */
  halves: number
}

export interface RunsByInningRow {
  /** Null on the league row. */
  teamId: string | null
  /** Games in scope this row played. On the league row, games rather than club-games. */
  games: number
  /** Indexed by column - 1, always EXTRAS_COLUMN long so a column is a direct lookup. */
  scored: InningCell[]
  allowed: InningCell[]
}

export interface RunsByInning {
  /** The columns worth drawing: 1..7, plus EXTRAS_COLUMN only when a game in scope went long. */
  columns: number[]
  /** One row per club that played in scope, in the order `teams` arrived. */
  clubs: RunsByInningRow[]
  league: RunsByInningRow
  /** Finals counted. 0 is the empty state. */
  games: number
  /** The league's runs per half-inning over regulation innings: the colour scale's grey midpoint.
   *  The same number scored or allowed, since every run is both. */
  mean: number
  /** How far the furthest club square sits from `mean`, over regulation innings, scored and
   *  allowed both, so flipping between the two does not rescale the colours under the reader.
   *  Extras are left out: a four-game column would otherwise set the scale for the whole grid. */
  spread: number
}

/** Runs per half-inning batted, or null for a column nobody batted in. */
export const perHalf = (c: InningCell): number | null => (c.halves > 0 ? c.runs / c.halves : null)

type Half = { inning: number; runs: number }

const usable = (line: WpblLineScoreEntry[]): Half[] =>
  line.filter(e => Number.isInteger(e.inning) && e.inning >= 1 && Number.isFinite(e.runs))

const through = (line: Half[], inning: number): number =>
  line.reduce((s, e) => (e.inning <= inning ? s + e.runs : s), 0)

/**
 * The half-innings each side actually batted in one final, or null when the row cannot be trusted.
 *
 * Null when either line is missing or the lines do not add up to the final score: a line score
 * that disagrees with its own game has lost or invented runs somewhere, and there is no way to say
 * which inning. Better one game short than a heatmap that quietly misplaces runs.
 *
 * The home side's last half is dropped when the home side led after the top of that inning, which
 * is the one case it is never batted. A walk-off (tied or trailing going to the bottom) is kept.
 */
export function battedHalves(game: WpblGame): { away: Half[]; home: Half[] } | null {
  if (!game.away_line?.length || !game.home_line?.length) return null
  if (game.away_score == null || game.home_score == null) return null
  const away = usable(game.away_line)
  const home = usable(game.home_line)
  if (away.length === 0 || home.length === 0) return null
  if (through(away, Infinity) !== game.away_score || through(home, Infinity) !== game.home_score) return null

  const last = Math.max(...away.map(e => e.inning), ...home.map(e => e.inning))
  const homeSkippedLast = through(home, last - 1) > through(away, last)
  return {
    away,
    home: homeSkippedLast ? home.filter(e => e.inning !== last) : home,
  }
}

const blankRow = (teamId: string | null): RunsByInningRow => {
  const cells = () => Array.from({ length: EXTRAS_COLUMN }, (_, i) => ({ inning: i + 1, runs: 0, halves: 0 }))
  return { teamId, games: 0, scored: cells(), allowed: cells() }
}

const add = (cell: InningCell, runs: number) => { cell.runs += runs; cell.halves += 1 }

/** Build the runs-by-inning grid for one scope. */
export function runsByInning(
  games: readonly WpblGame[],
  teams: readonly Pick<WpblTeam, 'id'>[],
  scope: RunsScope,
): RunsByInning {
  const rows = new Map(teams.map(t => [t.id, blankRow(t.id)]))
  const league = blankRow(null)
  let counted = 0

  for (const g of games) {
    if (g.status !== 'final') continue
    if ((scope === 'regular') !== countsInStandings(g)) continue
    const halves = battedHalves(g)
    if (!halves) continue
    counted++

    const away = rows.get(g.away_team_id)
    const home = rows.get(g.home_team_id)
    if (away) away.games++
    if (home) home.games++

    // A club missing from `teams` still counts toward the league row; it just has no row of its own.
    const sides: [Half[], RunsByInningRow | undefined, RunsByInningRow | undefined][] = [
      [halves.away, away, home],
      [halves.home, home, away],
    ]
    for (const [line, batting, fielding] of sides) {
      for (const e of line) {
        const i = Math.min(e.inning, EXTRAS_COLUMN) - 1
        add(league.scored[i], e.runs)
        add(league.allowed[i], e.runs)
        if (batting) add(batting.scored[i], e.runs)
        if (fielding) add(fielding.allowed[i], e.runs)
      }
    }
  }
  league.games = counted

  const clubs = [...rows.values()].filter(r => r.games > 0)
  const regulation = league.scored.slice(0, REGULATION_INNINGS)
  const halvesBatted = regulation.reduce((s, c) => s + c.halves, 0)
  const mean = halvesBatted > 0 ? regulation.reduce((s, c) => s + c.runs, 0) / halvesBatted : 0
  let spread = 0
  for (const r of clubs) {
    for (let i = 0; i < REGULATION_INNINGS; i++) {
      for (const cell of [r.scored[i], r.allowed[i]]) {
        const v = perHalf(cell)
        if (v != null) spread = Math.max(spread, Math.abs(v - mean))
      }
    }
  }

  const columns = Array.from({ length: REGULATION_INNINGS }, (_, i) => i + 1)
  if (league.scored[EXTRAS_COLUMN - 1].halves > 0) columns.push(EXTRAS_COLUMN)

  return { columns, clubs, league, games: counted, mean, spread }
}

/** The league's biggest and quietest regulation inning, for the one sentence above the grid. Null
 *  when no regulation inning has been batted, or when every inning reads the same. */
export function leagueExtremes(grid: RunsByInning): { high: InningCell; low: InningCell } | null {
  const cells = grid.league.scored.slice(0, REGULATION_INNINGS).filter(c => c.halves > 0)
  if (cells.length < 2) return null
  const byRate = [...cells].sort((a, b) => perHalf(b)! - perHalf(a)! || a.inning - b.inning)
  const high = byRate[0]
  const low = byRate[byRate.length - 1]
  return perHalf(high)! > perHalf(low)! ? { high, low } : null
}
