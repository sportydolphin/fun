// The one row the search offers from the OTHER section: "Ohtani" typed on WPBL, "Whitmore" on MLB.
//
// Asked only when the section on screen found no player for the name, so a reader who typed a
// name the site knows elsewhere gets one row into it rather than "nothing found". Each half is
// imported on first use: a WPBL reader who never types an MLB name never loads MLB's API module,
// and the reverse. The answer is a link, like every other question row, so the shell's navigate()
// does the section switch.

import { TEAM_ABBR } from './mlb/constants'
import { mlbPlayerPath } from './mlb/routes'
import { wpblPlayerPath } from './wpbl/routes'
import type { NavSection } from './sectionNav'

export interface OtherSectionRow { title: string; subtitle: string; href: string }

export async function otherSectionPlayer(section: NavSection, name: string): Promise<OtherSectionRow | null> {
  if (section === 'wpbl') {
    const { searchPlayers } = await import('./mlb/api')
    // StatsAPI puts active players first, which is who a WPBL reader typing a name most likely means.
    const p = (await searchPlayers(name))[0]
    if (!p) return null
    const teamId = p.currentTeam?.id as number | undefined
    return {
      title: p.fullName,
      subtitle: ['MLB', p.primaryPosition?.abbreviation, teamId != null ? TEAM_ABBR[teamId] : null].filter(Boolean).join(' · '),
      href: mlbPlayerPath(p),
    }
  }
  const [{ fetchWpblAllPlayers }, { searchPlayers }] = await Promise.all([import('./wpbl/api'), import('./wpbl/playerSearch')])
  const roster = await fetchWpblAllPlayers()
  // Confident only: the roster is 118 names, and a loose match on an MLB surname would offer a
  // WPBL player nobody asked for.
  const hit = searchPlayers(name, roster).find(h => h.confident)
  if (!hit) return null
  return { title: hit.player.name, subtitle: 'WPBL', href: wpblPlayerPath(hit.player, roster) }
}
