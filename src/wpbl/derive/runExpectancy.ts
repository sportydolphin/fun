import {
  buildRunExpectancy as build, playRunValues as values,
  type PlayRunValue as Value, type ReTable, type RunnerLine as Runner,
  type RunValueLine as Line, type WorkedExample as Example,
} from '../../league/runExpectancy'
import { WPBL_LEAGUE } from '../league'
import type { WpblSeasonGame } from '../season'
import type { WpblGame, WpblPlayer, WpblRunValuePlay } from '../types'

// Run expectancy for WPBL. The engine is league-neutral and lives in src/league/runExpectancy.ts,
// where its reasoning is written down; the seven innings and the feed's `runs_scored` quirk come
// from ../league.ts. This file binds the two and keeps the names the Run value tab, the win
// model and the tests already use.

export {
  BASE_PHRASE, BASE_ROW_ORDER, BASE_SHORT, DIST_MAX, baseCode, biggestSwings, describeState,
  eventValues, fmtRe, fmtRunValue, reOf, runValueLeaders, stealEconomy, topRunners, workedExample,
} from '../../league/runExpectancy'
export type {
  BaseCode, EventValue, ReCell, ReTable, StealEconomy,
} from '../../league/runExpectancy'

/** The neutral `RunValueGame`, as WPBL's own row, so `status` keeps its union. */
export type RunValueGame = WpblSeasonGame &
  Pick<WpblGame, 'status' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score'
    | 'home_line' | 'away_line'>
export type PlayRunValue = Value<WpblRunValuePlay>
export type RunValueLine = Line<WpblPlayer, WpblRunValuePlay>
export type RunnerLine = Runner<WpblPlayer>
export type WorkedExample = Example<WpblRunValuePlay>

export const buildRunExpectancy = (plays: WpblRunValuePlay[], games: RunValueGame[]): ReTable =>
  build(WPBL_LEAGUE, plays, games)

export const playRunValues = (
  plays: WpblRunValuePlay[], games: RunValueGame[], table: ReTable,
): PlayRunValue[] => values(WPBL_LEAGUE, plays, games, table)
