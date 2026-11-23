// The finder for WPBL. The engine is league-neutral and lives in src/league/finder.ts, where
// its reasoning is written down. It is generic over the player and game types, so handed WPBL's
// rows it hands WPBL's rows back; this file only keeps the names FindView and its tests use, and
// tells the engine the league's regulation length, which decides what an extra-inning game is.

import { runFinder, type FinderBoardSide, type FinderOptions, type FinderQuery, type FinderResult, type FinderSort } from '../../league/finder'
import type { BattingGameLine, LeagueGame, LeaguePlayer, PitchingGameLine } from '../../league/types'
import { REGULATION_INNINGS } from '../innings'

export {
  EMPTY_FINDER_QUERY, decodeFinderByClub, decodeFinderCuts, decodeFinderPer, decodeFinderQuery, describeFinderConditions, describeFinderQuery, encodeFinderQuery, finderFields,
  parseFinderValue, finderColumns, finderPitcherApplies, finderPlayerApplies, validFinderSort,
} from '../../league/finder'
export type { FinderBoardSide, FinderQuery, FinderSide, FinderSort, FinderVenue } from '../../league/finder'

/** `runFinder` with WPBL's seven innings. */
export function runWpblFinder<P extends LeaguePlayer, G extends LeagueGame>(
  side: FinderBoardSide, batting: BattingGameLine[], pitching: PitchingGameLine[], players: P[], games: G[],
  query: FinderQuery, limit = 50, sort: FinderSort | null = null, opts: FinderOptions = {},
): FinderResult<P, G> {
  return runFinder(side, batting, pitching, players, games, query, limit, sort, { regulationInnings: REGULATION_INNINGS, ...opts })
}
