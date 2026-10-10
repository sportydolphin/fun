import { mlbNavKeyFromPath, isMlbGlossaryPage, isMlbComparePage, MLB_BASE, MLB_VIEW_PATHS, MLB_TEAMS_BASE, MLB_GLOSSARY_PAGE, MLB_COMPARE_BASE } from './mlb/routes'
import type { MlbNavKey } from './mlb/routes'
import { wpblViewFromPath, wpblPathFor, isWpblGlossaryPage, isWpblComparePage, WPBL_BASE, WPBL_GLOSSARY_PAGE, WPBL_COMPARE_BASE } from './wpbl/routes'
import type { WpblView } from './wpbl/routes'

// WHERE THE TOOLBAR'S MLB | WPBL SWITCH GOES: the same page in the other league. It went to the
// other section's Home from anywhere, so a reader comparing the two leagues' standings switched,
// landed on Home, and tapped Standings again, every time. The five tabs are the same five on both
// sides, and so are the glossary and Compare, since the second alignment pass in ROADMAP.md.
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
  // The Table board, which is what WPBL's Stats is: every player, a column per stat. Not the
  // Leaders board MLB's tab opens on, which WPBL has no equivalent of.
  stats: MLB_VIEW_PATHS.stats,
  teams: MLB_TEAMS_BASE,
}

/** The other section's counterpart of `pathname`, which is a page in one of the two sections. */
export function otherSectionPath(pathname: string, onWpbl: boolean): string {
  if (onWpbl) {
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
