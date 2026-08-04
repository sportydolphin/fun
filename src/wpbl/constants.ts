import type { WpblTeam } from './types'
import bostonLogo from './logos/boston.webp'
import laLogo from './logos/la.webp'
import nyLogo from './logos/ny.webp'
import sfLogo from './logos/sf.webp'

// Section accent — deliberately the SAME blue as the MLB app's ACCENT (see
// src/mlb/constants.ts; keep the two in sync). The leagues share one nav-slider / UI
// accent rather than splitting into a gendered blue-vs-pink pairing; WPBL keeps its own
// identity through team colors and logos, not a section-wide accent. Drives the nav's
// active pill, links, chips, and card stripes.
export const WPBL_ACCENT = '#60a5fa'

// Everything visual for a team lives here — one source of truth for color + logo, so
// setting a value once applies across the whole section (badges, accents, ordering).
// This is also the static fallback used before the Supabase `wpbl_teams` rows load.
//   color     — primary; badge fill + team accent
//   secondary — accent hue; used as the badge ring so team badges stay defined even
//               when the primary is near-black (e.g. LA) or matches the page bg
//   logo      — bundled asset (imported → hashed URL at build)
//   logoFill  — the logo image already includes its own background and should fill the
//               badge edge-to-edge (Boston's is a finished green lockup); others are
//               transparent knockouts that sit centered on the color fill
export interface WpblTeamMeta {
  id: string; city: string; name: string; abbr: string
  color: string; secondary: string
  logo: string; logoFill?: boolean
  sort_order: number
}

export const WPBL_TEAMS: Record<string, WpblTeamMeta> = {
  BOS: { id: 'BOS', city: 'Boston',        name: 'Hunters',   abbr: 'BOS', color: '#00281e', secondary: '#da7718', logo: bostonLogo, logoFill: true, sort_order: 1 },
  LA:  { id: 'LA',  city: 'Los Angeles',   name: 'Queens',    abbr: 'LA',  color: '#000000', secondary: '#b58f5f', logo: laLogo,     sort_order: 2 },
  NY:  { id: 'NY',  city: 'New York',      name: 'Heights',   abbr: 'NY',  color: '#091b47', secondary: '#b8dbf1', logo: nyLogo,     sort_order: 3 },
  SF:  { id: 'SF',  city: 'San Francisco', name: 'Firebells', abbr: 'SF',  color: '#2d1747', secondary: '#fe2100', logo: sfLogo,     sort_order: 4 },
}

// Team color lookup, mirroring the MLB app's TEAM_BG convention. Falls back to a
// neutral gray for any id not in the map.
export function wpblColor(teamId: string | null | undefined): string {
  if (!teamId) return '#6b7280'
  return WPBL_TEAMS[teamId]?.color ?? '#6b7280'
}

// Secondary/accent hue (badge ring, highlights). Neutral gray fallback.
export function wpblSecondary(teamId: string | null | undefined): string {
  if (!teamId) return '#9ca3af'
  return WPBL_TEAMS[teamId]?.secondary ?? '#9ca3af'
}

// Mix a hex toward white (mirrors the MLB app's brightColor) so a dark primary is
// readable when used as foreground text/borders on a dark background.
function brightenHex(hex: string, mix = 0.55): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const c = (n: number) => Math.round(n + (255 - n) * mix).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// Team primary made safe for FOREGROUND use (text, thin borders, accent bars). The
// primaries are dark (Boston's near-black, LA's pure black), which reads fine on a
// light background but vanishes on a dark one — so lighten it in dark mode, matching
// the MLB app's accentColor(). Use this for text/borders; use wpblColor() for fills.
export function wpblAccent(teamId: string | null | undefined, isDark: boolean): string {
  const base = wpblColor(teamId)
  return isDark ? brightenHex(base) : base
}

// Bundled logo asset for a team, or null (badge then falls back to the abbr).
export function wpblLogo(teamId: string | null | undefined): string | null {
  if (!teamId) return null
  return WPBL_TEAMS[teamId]?.logo ?? null
}

// Whether the logo image fills the badge (has its own background) vs. sits centered.
export function wpblLogoFill(teamId: string | null | undefined): boolean {
  if (!teamId) return false
  return WPBL_TEAMS[teamId]?.logoFill ?? false
}

// Full display name, 'Boston Hunters'.
export function wpblFullName(team: Pick<WpblTeam, 'city' | 'name'>): string {
  return `${team.city} ${team.name}`
}

// Game times are stored as flat wall-clock strings ("6:30 PM") at the single hub
// venue, which sits in U.S. Central Time. Interpret that wall clock as Central and
// re-render it in the VIEWER's local zone (a 5:00 PM Central game shows as "6:00 PM"
// on the east coast). Pass withZone to append the zone abbreviation ("6:00 PM EDT")
// where it helps disambiguate. Returns the original string if it isn't "H:MM AM/PM".
const WPBL_TZ = 'America/Chicago'
export function formatGameTime(gameDate: string, startTime: string | null | undefined, withZone = false): string | null {
  if (!startTime) return null
  const m = startTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return startTime
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const min = parseInt(m[2], 10)
  const [y, mo, d] = gameDate.split('-').map(Number)
  // Treat the wall clock as UTC, then correct by Central's offset at that instant so
  // the result is the true UTC instant of the game (DST-safe, no hardcoded offset).
  const naive = Date.UTC(y, mo - 1, d, h, min)
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  const real = new Date(naive + offset)
  return real.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' } : {}) })
}

// The true UTC instant (epoch ms) of a game's first pitch, treating the stored wall
// clock as Central (same DST-safe math as formatGameTime). Null if there's no valid
// start time. Used for the home-page countdown.
export function gameStartMs(gameDate: string, startTime: string | null | undefined): number | null {
  if (!startTime) return null
  const m = startTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  const min = parseInt(m[2], 10)
  const [y, mo, d] = gameDate.split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, min)
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  return naive + offset
}

// Roster sort key: defensive position order (pitchers first, then around the diamond,
// then bench/utility). Unknown or blank positions sort last. Pair with a name tiebreak.
const POSITION_ORDER = ['P', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'IF', 'LF', 'CF', 'RF', 'OF', 'DH', 'UTIL']
export function positionRank(pos: string | null | undefined): number {
  if (!pos) return 999
  const i = POSITION_ORDER.indexOf(pos.trim().toUpperCase())
  return i === -1 ? 900 : i
}

// Innings pitched (stored as outs) → the familiar "5.2" display.
export function outsToIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// The inverse: parse an IP entry ("5.2" = 5 innings + 2 outs) into total outs.
// Accepts "5", "5.0", "5.1", "5.2"; clamps an invalid fraction (.3+) down to .2.
export function ipToOuts(ip: string): number {
  const t = ip.trim()
  if (!t) return 0
  const [wholeStr, fracStr] = t.split('.')
  const whole = parseInt(wholeStr || '0', 10) || 0
  let frac = fracStr ? parseInt(fracStr, 10) || 0 : 0
  if (frac > 2) frac = 2
  return whole * 3 + frac
}
