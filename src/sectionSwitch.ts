import { mlbNavKeyFromPath, mlbUrlFor, mlbSnapshotFromUrl, isMlbGlossaryPage, isMlbComparePage, MLB_BASE, MLB_VIEW_PATHS, MLB_TEAMS_BASE, MLB_GLOSSARY_PAGE, MLB_COMPARE_BASE } from './mlb/routes'
import type { MlbNavKey } from './mlb/routes'
import { wpblViewFromPath, wpblPathFor, isWpblGlossaryPage, isWpblComparePage, WPBL_BASE, WPBL_GLOSSARY_PAGE, WPBL_COMPARE_BASE } from './wpbl/routes'
import type { WpblView } from './wpbl/routes'

// WHERE THE TOOLBAR'S MLB | WPBL SWITCH GOES: the same page in the other league. It went to the
// other section's Home from anywhere, so a reader comparing the two leagues' standings switched,
// landed on Home, and tapped Standings again, every time. The five tabs are the same five on both
// sides, and so are the glossary and Compare, since the second alignment pass in ROADMAP.md.
//
// Into MLB, Stats lands on the same BOARD and SIDE where both have it (mlbStatsPath), since MLB's
// boards are paths it reads on every move, and a WPBL-only board on Leaders. Into WPBL, the same
// (wpblStatsPath): its Stats view obeys a `?board=` it is moved to, mounted or not.
//
// A page with no counterpart (a player, a game, a series, /wpbl/api, the sources page) goes to the
// other section's Home. A club page goes to Teams: the nearest page that is about clubs. Matching a
// player or a club ACROSS leagues is not a thing to attempt: they are different people and clubs.
//
// Here, in the shell, because it is the one place that may know both sections' routes; neither
// section imports the other.

const MLB_TO_WPBL: Record<MlbNavKey, WpblView> = {
  home: 'home', scores: 'schedule', standings: 'standings', stats: 'stats', teams: 'teams',
}

const WPBL_TO_MLB: Record<WpblView, string> = {
  home: MLB_BASE,
  schedule: MLB_VIEW_PATHS.scores,
  standings: MLB_VIEW_PATHS.standings,
  // Leaders, the board both Stats tabs open on. Every other board goes to its own (mlbStatsPath).
  stats: MLB_VIEW_PATHS.leaderboard,
  teams: MLB_TEAMS_BASE,
}

/** The other section's counterpart of `pathname` (and `search`, for WPBL's Stats boards), which is
 *  a page in one of the two sections. */
/** WPBL's Stats board and side as MLB's address. The two tabs have the same five boards and the same
 *  three sides since Oct 2026, so the switch keeps both; an Analysis board, which MLB does not have
 *  (it needs every play stored on our side), lands on Leaders on the same side. */
function mlbStatsPath(search: string): string {
  const q = new URLSearchParams(search)
  const board = q.get('board')
  const side = q.get('side') === 'fielding' || board === 'fielding' ? 'fielding' : q.get('side') === 'pitching' ? 'pitching' : 'hitting'
  if (board === 'players' || board === 'fielding') return side === 'fielding' ? MLB_VIEW_PATHS.fielding : mlbUrlFor({ view: 'stats', lb: side })
  if (board === 'teams') return mlbUrlFor({ view: 'teamStats', lb: side === 'fielding' ? 'hitting' : side, fielding: side === 'fielding' })
  // Bests and Find have no fielding side, so a link naming one reads as the default.
  if (board === 'bests' || board === 'find') return mlbUrlFor({ view: board, lb: side === 'pitching' ? 'pitching' : 'hitting' })
  return mlbUrlFor({ view: 'leaderboard', lb: side === 'fielding' ? 'hitting' : side, fielding: side === 'fielding' })
}

/** MLB's Stats board and side as WPBL's address, the other half of `mlbStatsPath`. WPBL's Stats
 *  tab obeys the address when it is moved to it, not only when it first mounts (StatsView's
 *  popstate listener), which is what lets this name a board at all. Only what differs from WPBL's
 *  defaults is written, as WPBL's own writer does: Leaders, Hitting.
 *
 *  MLB's Hitting comes over as no side at all, which on WPBL's Leaders and Players is Overall, a
 *  side MLB does not have. Deliberate: MLB opens on Hitting, so a reader who never touched the
 *  switch there lands on the board WPBL opens on, rather than one they did not choose. */
function wpblStatsPath(pathname: string, search: string): string {
  const snap = mlbSnapshotFromUrl(pathname, search)
  const q = new URLSearchParams()
  const view = snap?.view
  const side = view === 'fielding' || snap?.fielding ? 'fielding' : snap?.lb === 'pitching' ? 'pitching' : 'hitting'
  const board = view === 'stats' || view === 'fielding' ? 'players' : view === 'teamStats' ? 'teams'
    : view === 'bests' || view === 'find' ? view : null
  if (board) q.set('board', board)
  if (side !== 'hitting') q.set('side', side)
  const qs = q.toString()
  return qs ? `${WPBL_BASE}/stats?${qs}` : `${WPBL_BASE}/stats`
}

export function otherSectionPath(pathname: string, onWpbl: boolean, search = ''): string {
  if (onWpbl) {
    if (wpblViewFromPath(pathname) === 'stats') return mlbStatsPath(search)
    if (isWpblGlossaryPage(pathname)) return MLB_GLOSSARY_PAGE
    if (isWpblComparePage(pathname)) return MLB_COMPARE_BASE
    const view = wpblViewFromPath(pathname)
    return view ? WPBL_TO_MLB[view] : MLB_BASE
  }
  if (isMlbGlossaryPage(pathname)) return WPBL_GLOSSARY_PAGE
  if (isMlbComparePage(pathname)) return WPBL_COMPARE_BASE
  if (mlbNavKeyFromPath(pathname) === 'stats') return wpblStatsPath(pathname, search)
  const key = mlbNavKeyFromPath(pathname)
  return key ? wpblPathFor(MLB_TO_WPBL[key]) : WPBL_BASE
}
