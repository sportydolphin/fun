import { buildRunExpectancy, playRunValues, type RunValueGame } from './runExpectancy'
import { winProbModel, wpaLeaders } from './winProbability'
import { baserunningEvents, baserunningLeaders, runnerIds } from './baserunning'
import { catcherArmLeaders, catcherIndex } from './catching'
import { defenseIndex, fieldingLedger } from './fielding'
import { warSeason, type WarSeason } from './war'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay } from '../types'

/**
 * One row per player for the Overall side of the Stats tab: WAR and every part it is made of,
 * beside wins added.
 *
 * WHY ONE ROW AND NOT A BOARD PER SIDE. Every other side splits a player in half, so a two-way
 * player's season was never added up anywhere. WAR is the sum: what a player did at the plate, on
 * the bases, in the field and on the mound, in one unit (derive/war.ts, docs/WAR.md).
 *
 * WINS ADDED STAYS, AS A DIFFERENT QUESTION. WAR is context-neutral: a home run is worth the same
 * in a tie game and a rout. Wins added prices each play by the scoreboard, so it is the record of
 * who moved games when they were close. The two disagree exactly where clutch is argued about.
 *
 * NO ENGINE OF ITS OWN BEYOND WAR'S. Every input is a function the Run value board or the Stats
 * table already calls, so a number here and the same number there cannot disagree. REGULAR SEASON
 * ONLY, because every one of those engines is.
 */
export interface WpblValueTotals {
  /** Plate appearances, and outs pitched: the two samples, for the tiebreak and the sublabel. */
  pa: number
  outs: number
  /** Runs, in WAR's components (see `WarLine`). */
  bat: number
  bsr: number
  gdp: number
  rng: number
  err: number
  dp: number
  ofArm: number
  cArm: number
  cBlk: number
  fld: number
  pos: number
  lgAdj: number
  rep: number
  pit: number
  /** Wins. */
  batWar: number
  pitWar: number
  war: number
  /** Wins added, batting and pitching together. */
  wpa: number
  /** Catching: steal attempts against and runners thrown out, for the arm's sample. */
  armAtt: number
  armCs: number
}

export interface PlayerValueSeason<P> { player: P; totals: WpblValueTotals }

const empty = (): WpblValueTotals => ({
  pa: 0, outs: 0, bat: 0, bsr: 0, gdp: 0, rng: 0, err: 0, dp: 0, ofArm: 0, cArm: 0, cBlk: 0, fld: 0,
  pos: 0, lgAdj: 0, rep: 0, pit: 0, batWar: 0, pitWar: 0, war: 0, wpa: 0, armAtt: 0, armCs: 0,
})

/** The zero row, for a league line the Overall side has no rates to put in. */
export const EMPTY_VALUE_TOTALS: WpblValueTotals = Object.freeze(empty())

export interface PlayerValueResult {
  seasons: PlayerValueSeason<WpblPlayer>[]
  /** The constants the season was measured with, null before there is a season to measure. */
  context: WarSeason['context'] | null
}

export function playerValueSeasons(
  plays: WpblRunValuePlay[],
  games: WpblGame[],
  players: WpblPlayer[],
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] },
): PlayerValueResult {
  if (plays.length === 0) return { seasons: [], context: null }
  const rvGames = games as RunValueGame[]
  const table = buildRunExpectancy(plays, rvGames)
  const values = playRunValues(plays, rvGames, table)
  const idOf = runnerIds(plays, players)
  const model = winProbModel(plays, games)
  const runner = baserunningEvents(plays, rvGames, table, idOf)
  const arm = catcherArmLeaders(runner, games, catcherIndex(lines.batting, plays, players), players)
  const ledger = fieldingLedger(values, table, defenseIndex(lines.batting, plays, players), runner)
  const baserunning = new Map<string, { steal: number; advance: number }>()
  for (const l of baserunningLeaders(runner, players)) {
    if (l.player) baserunning.set(l.player.id, { steal: l.stealRuns, advance: l.advanceRuns })
  }

  const war = warSeason({
    values, table, games, players, batting: lines.batting, pitching: lines.pitching, baserunning, ledger, arm,
  })

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

  for (const l of war?.lines.values() ?? []) {
    const r = row(l.playerId)
    if (!r) continue
    r.pa = l.pa; r.outs = l.outs
    r.bat = l.bat; r.bsr = l.bsr; r.gdp = l.gdp
    r.rng = l.rng; r.err = l.err; r.dp = l.dp; r.ofArm = l.ofArm; r.cArm = l.cArm; r.cBlk = l.cBlk; r.fld = l.fld
    r.pos = l.pos; r.lgAdj = l.lgAdj; r.rep = l.repBat + l.repPit; r.pit = l.pit
    r.batWar = l.batWar; r.pitWar = l.pitWar; r.war = l.war
  }
  for (const l of wpaLeaders(model, plays, rvGames, players, 'hitting', idOf)) {
    const r = row(l.player?.id); if (r) r.wpa += l.wpa
  }
  for (const l of wpaLeaders(model, plays, rvGames, players, 'pitching')) {
    const r = row(l.player?.id); if (r) r.wpa += l.wpa
  }
  for (const a of arm) {
    const r = row(a.playerId); if (r) { r.armAtt += a.attempts; r.armCs += a.cs }
  }

  return {
    seasons: [...rows].map(([id, totals]) => ({ player: byId.get(id)!, totals })),
    context: war?.context ?? null,
  }
}
