import type { RunValueGame } from './runExpectancy'
import { buildRunExpectancy, playRunValues } from './runExpectancy'
import { winProbModel, wpaLeaders, type WpaLine } from './winProbability'
import { baserunningEvents, baserunningLeaders, runnerIds, type BaserunningLine, type BaserunningRuns } from './baserunning'
import { centredBaserunning, doublePlayRuns } from './war'
import type { WpblBattingLine, WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

/**
 * The two Run value boards that price what the box score cannot, built once for every surface
 * that shows them: Run value's "Most wins added" and "Best on the bases", the player card and
 * Compare.
 *
 * ONE BUILD, SO THE CARD AND THE BOARD CANNOT DISAGREE. A player's "+0.84, 3rd of 74" on their
 * card is read off the very list the board draws, so the number and the place are the board's
 * own. Rebuilding either list on the card from the player's own plays would get the baserunning
 * wrong outright: a runner's extra bases are on OTHER batters' plays, and the average runner it
 * is priced against is the whole league's.
 *
 * BsR IS WAR'S OWN (`centredBaserunning`), so the bases board, the Stats table's BsR column, the
 * card and Compare are one number. The stored WAR rows' `wpa` is still a different one: both sides
 * summed, where the board and the card keep them apart.
 *
 * `games` is the season's schedule (as the Stats tab hands Run value), `plays` that season's log
 * and `batting` its box-score lines, which give each hitter's times on first.
 * REGULAR SEASON ONLY, as every engine underneath is.
 */
export interface SeasonValueBoards<P> {
  wpaHitting: WpaLine<P>[]
  wpaPitching: WpaLine<P>[]
  /** BsR, best first. Hitting only: a pitcher's side of a steal is shared with the catcher. */
  bases: BaserunningRuns<P>[]
}

export function seasonValueBoards(
  plays: WpblRunValuePlay[],
  games: WpblGame[],
  players: WpblPlayer[],
  batting: WpblBattingLine[],
): SeasonValueBoards<WpblPlayer> {
  const rv = games as RunValueGame[]
  const idOf = runnerIds(plays, players)
  const model = winProbModel(plays, games)
  const table = buildRunExpectancy(plays, rv)
  return {
    wpaHitting: wpaLeaders(model, plays, rv, players, 'hitting', idOf),
    wpaPitching: wpaLeaders(model, plays, rv, players, 'pitching'),
    bases: centredBaserunning(
      baserunningLeaders(baserunningEvents(plays, rv, table, idOf), players), players, batting, games,
      doublePlayRuns(playRunValues(plays, rv, table), table)),
  }
}

/** A figure and its place on the board it came from. */
export interface BoardPlace {
  value: number
  /** 1 is the top. A tie shares the better place, as every rank on the card does. */
  rank: number
  /** Everyone on the board, the unresolved names included, because the board lists them too. */
  of: number
}

export interface PlayerSeasonValue {
  wpaHitting: BoardPlace | null
  wpaPitching: BoardPlace | null
  /** With the counts the board prints under the name. */
  bases: (BoardPlace & { line: BaserunningLine<unknown> }) | null
}

function place<R>(rows: R[], value: (r: R) => number, mine: R | undefined): BoardPlace | null {
  if (!mine) return null
  const v = value(mine)
  return { value: v, rank: 1 + rows.filter(r => value(r) > v).length, of: rows.length }
}

/** One player's places on the three boards; null where the player is not on one. */
export function playerSeasonValue<P extends { id: string }>(boards: SeasonValueBoards<P>, playerId: string): PlayerSeasonValue {
  const of = <R extends { player: P | null }>(rows: R[]) => rows.find(r => r.player?.id === playerId)
  const bases = of(boards.bases)
  const basesPlace = place(boards.bases, r => r.bsr, bases)
  return {
    wpaHitting: place(boards.wpaHitting, r => r.wpa, of(boards.wpaHitting)),
    wpaPitching: place(boards.wpaPitching, r => r.wpa, of(boards.wpaPitching)),
    bases: basesPlace && bases ? { ...basesPlace, line: bases } : null,
  }
}

/** "8 SB, 1 caught · 7 of 12 extra bases". A pickoff is folded into "caught": to a reader both are a
 *  runner out on the bases without a ball in play, and two words for it would not fit a phone. */
export function basesLine(r: BaserunningLine<unknown>): string {
  const caught = r.cs + r.pickoffs
  const steals = caught ? `${r.sb} SB, ${caught} caught` : `${r.sb} SB`
  return r.chances ? `${steals} · ${r.extra} of ${r.chances} extra bases` : steals
}
