import { mlbNavKeyFromPath, isMlbGlossaryPage, isMlbComparePage, MLB_BASE, MLB_VIEW_PATHS, MLB_TEAMS_BASE, MLB_GLOSSARY_PAGE, MLB_COMPARE_BASE } from './mlb/routes'
import type { MlbNavKey } from './mlb/routes'
import { wpblViewFromPath, wpblPathFor, isWpblGlossaryPage, isWpblComparePage, WPBL_BASE, WPBL_GLOSSARY_PAGE, WPBL_COMPARE_BASE } from './wpbl/routes'
import type { WpblView } from './wpbl/routes'

// WHERE THE TOOLBAR'S MLB | WPBL SWITCH GOES: the same page in the other league. It went to the
// other section's Home from anywhere, so a reader comparing the two leagues' standings switched,
// landed on Home, and tapped Standings again, every time. The five tabs are the same five on both
// sides, and so are the glossary and Compare, since the second alignment pass in ROADMAP.md.
//
// Into MLB, Stats lands on the same BOARD where both have it: WPBL's Players board on MLB's, and
// Leaders or a WPBL-only board on Leaders, since MLB's boards are paths it reads on every move. Into
// WPBL it is the Stats tab as the reader last left it (Leaders on a first visit): WPBL's boards are a
// query its Stats view reads once, at mount, so a kept-alive one would ignore `?board=` and a link
// that works only on a first visit is worse than none.
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
  // Leaders, the board both Stats tabs open on. WPBL's Players board goes to MLB's (see below).
  stats: MLB_VIEW_PATHS.leaderboard,
  teams: MLB_TEAMS_BASE,
}

/** The other section's counterpart of `pathname` (and `search`, for WPBL's Stats boards), which is
 *  a page in one of the two sections. */
export function otherSectionPath(pathname: string, onWpbl: boolean, search = ''): string {
  if (onWpbl) {
    if (wpblViewFromPath(pathname) === 'stats' && new URLSearchParams(search).get('board') === 'players') return MLB_VIEW_PATHS.stats
    if (isWpblGlossaryPage(pathname)) return MLB_GLOSSARY_PAGE
    if (isWpblComparePage(pathname)) return MLB_COMPARE_BASE
    const view = wpblViewFromPath(pathname)
    return view ? WPBL_TO_MLB[view] : MLB_BASE
  }
  if (isMlbGlossaryPage(pathname)) return WPBL_GLOSSARY_PAGE
  if (isMlbComparePage(pathname)) return WPBL_COMPARE_BASE
  const key = mlbNavKeyFromPath(pathname)
  return key ? wpblPathFor(MLB_TO_WPBL[key]) : WPBL_BASE
}
