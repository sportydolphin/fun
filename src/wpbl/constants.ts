import type { WpblTeam } from './types'

// Section accent — distinct from the MLB app's blue so the two sections read as
// separate. Provisional; tune once the league's brand palette is settled.
export const WPBL_ACCENT = '#d6336c'

// The four inaugural (2026) teams. This is a static fallback used for theming and
// ordering before the Supabase `wpbl_teams` rows are seeded (and as the color source
// even after, since colors live here, not in the DB read path for the UI).
//
// ⚠️ Colors are PROVISIONAL placeholders — the league has not published an official
// palette we can source. Replace `color` with the real brand hex when gathering team
// assets (see ROADMAP "WPBL" open items). Logos are hosted separately (logo_url on
// the DB row) once we have the files.
export const WPBL_TEAMS: Record<string, Pick<WpblTeam, 'id' | 'city' | 'name' | 'abbr' | 'color' | 'sort_order'>> = {
  BOS: { id: 'BOS', city: 'Boston',        name: 'Hunters',   abbr: 'BOS', color: '#2e5e3a', sort_order: 1 },
  LA:  { id: 'LA',  city: 'Los Angeles',   name: 'Queens',    abbr: 'LA',  color: '#6b2fa0', sort_order: 2 },
  NY:  { id: 'NY',  city: 'New York',      name: 'Heights',   abbr: 'NY',  color: '#1d3461', sort_order: 3 },
  SF:  { id: 'SF',  city: 'San Francisco', name: 'Firebells', abbr: 'SF',  color: '#c8402b', sort_order: 4 },
}

// Team color lookup, mirroring the MLB app's TEAM_BG convention. Falls back to a
// neutral gray for any id not in the map.
export function wpblColor(teamId: string | null | undefined): string {
  if (!teamId) return '#6b7280'
  return WPBL_TEAMS[teamId]?.color ?? '#6b7280'
}

// Full display name, 'Boston Hunters'.
export function wpblFullName(team: Pick<WpblTeam, 'city' | 'name'>): string {
  return `${team.city} ${team.name}`
}

// Innings pitched (stored as outs) → the familiar "5.2" display.
export function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}
