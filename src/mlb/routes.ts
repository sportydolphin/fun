// The MLB section's URL map: a path per tab, per club and per player.
//
// PATHS, NOT A QUERY STRING, for the reason WPBL moved on Aug 21, 2026 (see src/wpbl/routes.ts).
// Until Oct 2026 every MLB screen was `/mlb?view=…&pid=…`, which a search engine reads as ONE
// page: one title, one canonical, one thing it could rank, for a section with seven tabs, thirty
// clubs and every player in the majors. It also meant Cloudflare's analytics could not tell the
// tabs apart, and that a pushState carried the CURRENT address rather than the destination, so
// the stale-build reload in lib/staleBuild.ts reloaded the page the reader was leaving.
//
// DEPENDENCY-FREE ON PURPOSE. The shell (App.tsx), seo.ts, the sitemap script and the Pages
// Function in functions/mlb/ all need these paths, and the section itself is a lazy chunk:
// importing anything from it here would drag the whole section into the entry bundle, and
// anything touching a Vite asset would break the edge and the script outright.
//
// The old spelling still resolves. functions/mlb/index.ts 301s `/mlb?view=` / `?pid=` / `?tid=`
// onto these paths, and the section reads it too (`mlbTargetFromUrl`) for the in-app navigations
// that never reach the edge: a notification in the bell, an old history entry.

/** Every screen the section can show. 'search' is a player or team page; 'leaderboard', 'stats'
 *  and 'viz' are the three boards of the Stats tab. */
export type MlbView = 'home' | 'scores' | 'standings' | 'stats' | 'leaderboard' | 'viz' | 'teams' | 'search'
const MLB_VIEWS: readonly MlbView[] = ['home', 'scores', 'standings', 'stats', 'leaderboard', 'viz', 'teams', 'search']
export const isMlbView = (v: unknown): v is MlbView => typeof v === 'string' && (MLB_VIEWS as readonly string[]).includes(v)

export const MLB_BASE = '/mlb'
export const MLB_TEAMS_BASE = '/mlb/teams'
export const MLB_PLAYERS_BASE = '/mlb/players'

/** The path of every view that IS a page. 'search' is not: it is a player or a team, which have
 *  paths of their own below. The three Stats boards get flat names rather than /mlb/stats/…,
 *  because each is a different page a reader would search for ("MLB leaders" is not "MLB stats
 *  table"), and flat keeps the redirect file one line per page. */
export const MLB_VIEW_PATHS: Record<Exclude<MlbView, 'search'>, string> = {
  home:        MLB_BASE,
  scores:      '/mlb/scores',
  standings:   '/mlb/standings',
  leaderboard: '/mlb/leaders',
  stats:       '/mlb/stats',
  viz:         '/mlb/charts',
  teams:       MLB_TEAMS_BASE,
}

// ─── Clubs ────────────────────────────────────────────────────────────────────
//
// WRITTEN OUT, NOT DERIVED FROM THE API. The edge, the sitemap and seo.ts all need a club's URL
// with no StatsAPI call behind them, and there are thirty clubs that change about once a decade.
// The slug is the nickname, which is unique across the league and is what a reader types; the id
// is StatsAPI's and never changes when a club moves or renames (Oakland is still 133 in Sacramento).
// A rename means editing a slug here and adding a 301 from the old one in public/_redirects.

export interface MlbClub { id: number; slug: string; name: string }

export const MLB_CLUBS: readonly MlbClub[] = [
  { id: 108, slug: 'angels',       name: 'Los Angeles Angels' },
  { id: 109, slug: 'diamondbacks', name: 'Arizona Diamondbacks' },
  { id: 110, slug: 'orioles',      name: 'Baltimore Orioles' },
  { id: 111, slug: 'red-sox',      name: 'Boston Red Sox' },
  { id: 112, slug: 'cubs',         name: 'Chicago Cubs' },
  { id: 113, slug: 'reds',         name: 'Cincinnati Reds' },
  { id: 114, slug: 'guardians',    name: 'Cleveland Guardians' },
  { id: 115, slug: 'rockies',      name: 'Colorado Rockies' },
  { id: 116, slug: 'tigers',       name: 'Detroit Tigers' },
  { id: 117, slug: 'astros',       name: 'Houston Astros' },
  { id: 118, slug: 'royals',       name: 'Kansas City Royals' },
  { id: 119, slug: 'dodgers',      name: 'Los Angeles Dodgers' },
  { id: 120, slug: 'nationals',    name: 'Washington Nationals' },
  { id: 121, slug: 'mets',         name: 'New York Mets' },
  { id: 133, slug: 'athletics',    name: 'Athletics' },
  { id: 134, slug: 'pirates',      name: 'Pittsburgh Pirates' },
  { id: 135, slug: 'padres',       name: 'San Diego Padres' },
  { id: 136, slug: 'mariners',     name: 'Seattle Mariners' },
  { id: 137, slug: 'giants',       name: 'San Francisco Giants' },
  { id: 138, slug: 'cardinals',    name: 'St. Louis Cardinals' },
  { id: 139, slug: 'rays',         name: 'Tampa Bay Rays' },
  { id: 140, slug: 'rangers',      name: 'Texas Rangers' },
  { id: 141, slug: 'blue-jays',    name: 'Toronto Blue Jays' },
  { id: 142, slug: 'twins',        name: 'Minnesota Twins' },
  { id: 143, slug: 'phillies',     name: 'Philadelphia Phillies' },
  { id: 144, slug: 'braves',       name: 'Atlanta Braves' },
  { id: 145, slug: 'white-sox',    name: 'Chicago White Sox' },
  { id: 146, slug: 'marlins',      name: 'Miami Marlins' },
  { id: 147, slug: 'yankees',      name: 'New York Yankees' },
  { id: 158, slug: 'brewers',      name: 'Milwaukee Brewers' },
]

export const mlbClubById = (id: number): MlbClub | undefined => MLB_CLUBS.find(c => c.id === id)

/** A club's page. An id that is not one of the thirty (an All-Star side, a stale link) has no
 *  page, and lands on the Teams tab rather than on a URL that would 404. */
export function mlbTeamPath(teamId: number): string {
  const club = mlbClubById(teamId)
  return club ? `${MLB_TEAMS_BASE}/${club.slug}` : MLB_TEAMS_BASE
}

// ─── Players ──────────────────────────────────────────────────────────────────
//
// /mlb/players/<name>-<id>, the shape Baseball Savant uses. The ID is the identity and the name
// is for the reader: a player's name can change spelling, and two players can share one, so the
// page resolves on the trailing digits alone and the name is only ever checked by the edge, which
// 301s a stale or missing name onto the current one. The bare `/mlb/players/<id>` is accepted for
// that reason, and it is what the section pushes the instant a player is tapped, before the
// player's details (and so the name) have arrived; the address is corrected once they do.

/** Accents stripped, lowercase, anything else to single hyphens. The same rule as
 *  src/wpbl/slug.ts, restated rather than imported so neither section imports the other. */
export function slugifyMlbName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function mlbPlayerPath(player: { id: number; fullName?: string | null }): string {
  const name = player.fullName ? slugifyMlbName(player.fullName) : ''
  return `${MLB_PLAYERS_BASE}/${name ? `${name}-` : ''}${player.id}`
}

/** The player id a player path names, or null. One segment only, ending in the id. */
export function mlbPlayerIdFromPath(pathname: string): number | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${MLB_PLAYERS_BASE}/`)) return null
  const rest = p.slice(MLB_PLAYERS_BASE.length + 1)
  // Case-insensitive so a hand-typed capital still finds the player; the edge 301s it lowercase.
  const m = /^(?:[a-z0-9-]*-)?(\d{1,9})$/i.exec(rest)
  const id = m ? Number(m[1]) : NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

// ─── Reading an address ───────────────────────────────────────────────────────

/** What a URL asks the section to show. */
export interface MlbTarget { view: MlbView; playerId?: number; teamId?: number }

/** The target a pathname names, or null if it is not an MLB page at all. Null rather than a
 *  fallback to Home so the shell can tell an MLB page from a typo under /mlb, which 404s. */
export function mlbTargetFromPath(pathname: string): MlbTarget | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  for (const [view, path] of Object.entries(MLB_VIEW_PATHS)) {
    if (p === path) return { view: view as MlbView }
  }
  if (p.startsWith(`${MLB_TEAMS_BASE}/`)) {
    const slug = p.slice(MLB_TEAMS_BASE.length + 1)
    const club = MLB_CLUBS.find(c => c.slug === slug)
    return club ? { view: 'search', teamId: club.id } : null
  }
  const playerId = mlbPlayerIdFromPath(p)
  return playerId ? { view: 'search', playerId } : null
}

export const isMlbPath = (pathname: string): boolean => mlbTargetFromPath(pathname) !== null

/** The pre-Oct 2026 spelling, `/mlb?view=standings` or `/mlb?pid=…` / `?tid=…`, or null when the
 *  query names none of it. `view` wins over an id, as it always did: Home used to load a player in
 *  the background while the URL still said `view=home`. */
export function mlbLegacyTarget(search: string): MlbTarget | null {
  const params = new URLSearchParams(search)
  const view = params.get('view')
  const pid = Number(params.get('pid'))
  const tid = Number(params.get('tid'))
  if (isMlbView(view) && view !== 'search') return { view }
  if (Number.isInteger(pid) && pid > 0) return { view: 'search', playerId: pid }
  if (Number.isInteger(tid) && tid > 0) return { view: 'search', teamId: tid }
  return null
}

/** What an address asks for, old spelling or new. The old one only ever lived on the section
 *  root, so it is read only there. */
export function mlbTargetFromUrl(pathname: string, search: string): MlbTarget | null {
  const target = mlbTargetFromPath(pathname)
  if (target?.view === 'home') return mlbLegacyTarget(search) ?? target
  return target
}

/** The query names the legacy form spends, which the new paths make redundant. Everything else
 *  on a query (`open=`, `gamePk=`, `lb=`, `season=`) is carried through a redirect untouched. */
export const MLB_LEGACY_PARAMS = ['view', 'pid', 'tid'] as const

// ─── Writing an address ───────────────────────────────────────────────────────

/** A history snapshot as useMlbState stamps it, or as much of one as a caller knows. */
export interface MlbSnapshot {
  view: MlbView
  playerId?: number
  playerName?: string | null
  teamId?: number
  lb?: 'hitting' | 'pitching'
  allTime?: boolean
  season?: number | null
  /** Regular season (the default, left off the address), postseason, or both. */
  games?: 'regular' | 'post' | 'all'
}

/** The full address of a snapshot: the path, plus the board filters the path cannot say. */
export function mlbUrlFor(s: MlbSnapshot, currentSeason?: number): string {
  let path: string
  if (s.playerId) path = mlbPlayerPath({ id: s.playerId, fullName: s.playerName })
  else if (s.teamId) path = mlbTeamPath(s.teamId)
  else path = s.view === 'search' ? MLB_BASE : MLB_VIEW_PATHS[s.view]
  const params = new URLSearchParams()
  if (!s.playerId && !s.teamId && (s.view === 'leaderboard' || s.view === 'viz' || s.view === 'stats')) {
    if (s.lb === 'pitching') params.set('lb', 'pitching')
    if (s.view === 'stats' && s.allTime) params.set('season', 'all')
    else if (s.season != null && currentSeason != null && s.season !== currentSeason) params.set('season', String(s.season))
    if (s.view !== 'viz' && s.games && s.games !== 'regular') params.set('games', s.games)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Every page with a fixed address, for the sitemap and the tests that pin it to the redirects. */
export const MLB_STATIC_PATHS: readonly string[] = [
  ...Object.values(MLB_VIEW_PATHS),
  ...MLB_CLUBS.map(c => `${MLB_TEAMS_BASE}/${c.slug}`),
]

/** Fired after the section rewrites the address bar, so the shell re-reads its path (and seo.ts
 *  its tags). A pushState or replaceState fires no popstate, so without it the shell would keep
 *  the landing page's title on every tab. The same arrangement as WPBL_PATH_EVENT. */
export const MLB_PATH_EVENT = 'sd:mlb-path'
