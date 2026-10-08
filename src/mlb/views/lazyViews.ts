import { lazy } from 'react'
import { mlbTargetFromUrl } from '../routes'
import type { MlbView } from '../routes'

// EACH MLB VIEW IS ITS OWN CHUNK. They all shipped inside MlbStats, so a reader landing on
// Scores downloaded and parsed the player page, the stats table and the charts before seeing a
// score. This module holds only the import thunks, so App.tsx can import it without pulling in a
// single view, and start the landing view's chunk BESIDE MlbStats's instead of after it: lazy
// views behind a lazy section are otherwise a two-hop waterfall on every cold load.
//
// 'scores' is missing on purpose. FinalGames is also what GameRoute reads a game's summary from,
// and GameRoute is mounted on every MLB page, so it is in MlbStats's chunk whatever this does.
const loaders = {
  home:        () => import('./HomeView'),
  standings:   () => import('./Standings'),
  teams:       () => import('./TeamsView'),
  leaderboard: () => import('./LeaderboardView'),
  stats:       () => import('./StatsView'),
  viz:         () => import('./VizView'),
  search:      () => import('./SearchView'),
} satisfies Record<Exclude<MlbView, 'scores'>, () => Promise<unknown>>

export const HomeView        = lazy(() => loaders.home().then(m => ({ default: m.HomeView })))
export const Standings       = lazy(() => loaders.standings().then(m => ({ default: m.Standings })))
export const TeamsView       = lazy(() => loaders.teams().then(m => ({ default: m.TeamsView })))
export const LeaderboardView = lazy(() => loaders.leaderboard().then(m => ({ default: m.LeaderboardView })))
export const StatsView       = lazy(() => loaders.stats().then(m => ({ default: m.StatsView })))
export const VizView         = lazy(() => loaders.viz().then(m => ({ default: m.VizView })))
export const SearchView      = lazy(() => loaders.search().then(m => ({ default: m.SearchView })))

// The player page is the view 'search' too, but its own chunk: a team page does not need it, and
// it does not need the team card. Warmed with the other views, and first on a player's address.
const loadPlayer = () => import('./MlbPlayerDetail')
export const MlbPlayerDetail = lazy(loadPlayer)
// The same card as the desktop side panel, a thin wrapper that shares the card's chunk.
const loadPlayerPanel = () => import('./MlbPlayerPanel')
export const MlbPlayerPanel = lazy(() => loadPlayerPanel().then(m => ({ default: m.MlbPlayerPanel })))

// Prefetches swallow failures: the real import reports a missing chunk (and the stale-build
// reload in lib/staleBuild.ts handles it) when the reader actually goes there.
function warm(view: MlbView) {
  if (view !== 'scores') loaders[view]().catch(() => {})
}

/** The chunk for whatever view this address opens. */
export function preloadMlbViewFor(pathname: string, search: string) {
  const target = mlbTargetFromUrl(pathname, search)
  // A game's address on a desktop is the full Game Center page, which is that chunk.
  if (target?.gamePk != null) import('./LiveGameCenter').catch(() => {})
  if (target?.playerId != null) loadPlayer().catch(() => {})
  else warm(target?.view ?? 'home')
}

/** Every view's chunk. Once the landing view has settled, so that a tab tap renders in one commit
 *  rather than through an empty Suspense fallback while its chunk comes over the wire. */
export function preloadAllMlbViews() {
  for (const v of Object.keys(loaders) as (keyof typeof loaders)[]) warm(v)
  loadPlayer().catch(() => {})
  loadPlayerPanel().catch(() => {})
  // The two game sheets every scoreboard opens on a tap. Lazy so Home does not carry them, warmed
  // here so the first tap is not a fetch.
  import('./LiveGameCenter').catch(() => {})
  import('./GamePreview').catch(() => {})
}
