import { buildRunExpectancy, playRunValues, runValueLeaders, type RunValueGame } from './runExpectancy'
import { winProbModel, wpaLeaders } from './winProbability'
import { baserunningEvents, baserunningLeaders, runnerIds } from './baserunning'
import { catcherArmLeaders, catcherIndex, type CatcherSourceLine } from './catching'
import type { WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

/**
 * One row per player for the Overall side of the Stats tab: every value figure the section
 * computes from the play log, put side by side.
 *
 * WHY ONE ROW AND NOT FIVE BOARDS. Wins added, run value and baserunning each had a leaderboard
 * on Run value, one side at a time, so a two-way player's season was two half-rows on two boards
 * and nothing anywhere added them up. The point of this row is the sum.
 *
 * TWO UNITS, KEPT APART. Wins added (`wpa`) is in wins and prices a play by the scoreboard as
 * well as the bases, so a hit in a tie game outweighs the same hit in a rout. The run columns
 * price by the situation alone. They answer different questions, so the one total is the wins
 * column, made from the two wins columns and nothing else: adding baserunning or arm RUNS into a
 * WINS figure would need a runs-per-win rate this league has not played long enough to pin down.
 * Steals are already inside a runner's batting wins added (`wpaLeaders` credits the runner), so
 * adding baserunning on top would count them twice.
 *
 * NO ENGINE OF ITS OWN. Every figure is the same function the Run value board calls, so a number
 * here and the same number there cannot disagree. REGULAR SEASON ONLY, because every one of
 * those engines is.
 */
export interface WpblValueTotals {
  /** Plate appearances, and batters faced: the two samples, for the tiebreak and the sublabel. */
  pa: number
  bf: number
  batWpa: number
  pitWpa: number
  /** Batting plus pitching wins added. */
  wpa: number
  /** Run value at the plate (runs added) and on the mound (runs prevented). */
  batRuns: number
  pitRuns: number
  /** Runs on the bases against the league's average runner. */
  bsr: number
  /** Catching: steal attempts against, runners thrown out, and runs saved against an average arm. */
  armAtt: number
  armCs: number
  armRuns: number
}

export interface PlayerValueSeason<P> { player: P; totals: WpblValueTotals }

const empty = (): WpblValueTotals => ({
  pa: 0, bf: 0, batWpa: 0, pitWpa: 0, wpa: 0, batRuns: 0, pitRuns: 0, bsr: 0, armAtt: 0, armCs: 0, armRuns: 0,
})

/** The zero row, for a league line the Overall side has no rates to put in. */
export const EMPTY_VALUE_TOTALS: WpblValueTotals = Object.freeze(empty())

export function playerValueSeasons(
  plays: WpblRunValuePlay[],
  games: WpblGame[],
  players: WpblPlayer[],
  /** Box-score lines, for who caught each game. The batting lines carry the position. */
  battingLines: readonly CatcherSourceLine[],
): PlayerValueSeason<WpblPlayer>[] {
  if (plays.length === 0) return []
  const rvGames = games as RunValueGame[]
  const table = buildRunExpectancy(plays, rvGames)
  const values = playRunValues(plays, rvGames, table)
  const idOf = runnerIds(plays, players)
  const model = winProbModel(plays, games)
  const runner = baserunningEvents(plays, rvGames, table, idOf)

  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, WpblValueTotals>()
  // A line the play log could not resolve to a roster row has no page to open and no club to file
  // under, so it is left off rather than shown as a name nobody can tap.
  const row = (id: string | undefined | null) => {
    if (!id || !byId.has(id)) return null
    let r = rows.get(id)
    if (!r) rows.set(id, r = empty())
    return r
  }

  for (const l of wpaLeaders(model, plays, rvGames, players, 'hitting', idOf)) {
    const r = row(l.player?.id); if (r) { r.batWpa += l.wpa; r.pa += l.pa }
  }
  for (const l of wpaLeaders(model, plays, rvGames, players, 'pitching')) {
    const r = row(l.player?.id); if (r) { r.pitWpa += l.wpa; r.bf += l.pa }
  }
  for (const l of runValueLeaders(values, players, 'hitting')) {
    const r = row(l.player?.id); if (r) r.batRuns += l.value
  }
  for (const l of runValueLeaders(values, players, 'pitching')) {
    const r = row(l.player?.id); if (r) r.pitRuns += l.value
  }
  for (const l of baserunningLeaders(runner, players)) {
    const r = row(l.player?.id); if (r) r.bsr += l.total
  }
  for (const l of catcherArmLeaders(runner, games, catcherIndex(battingLines, plays, players), players)) {
    const r = row(l.playerId); if (r) { r.armAtt += l.attempts; r.armCs += l.cs; r.armRuns += l.runs }
  }

  const out: PlayerValueSeason<WpblPlayer>[] = []
  for (const [id, t] of rows) {
    t.wpa = t.batWpa + t.pitWpa
    out.push({ player: byId.get(id)!, totals: t })
  }
  return out
}

