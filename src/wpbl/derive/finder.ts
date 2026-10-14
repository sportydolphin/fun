// The finder for WPBL. The engine is league-neutral and lives in src/league/finder.ts, where
// its reasoning is written down. It is generic over the player and game types, so handed WPBL's
// rows it hands WPBL's rows back; this file only keeps the names FindView and its tests use.

export {
  EMPTY_FINDER_QUERY, decodeFinderPer, decodeFinderQuery, describeFinderQuery, encodeFinderQuery, finderFields,
  parseFinderValue, finderColumns, validFinderSort, runFinder as runWpblFinder,
} from '../../league/finder'
export type { FinderQuery, FinderSide, FinderSort, FinderVenue } from '../../league/finder'
