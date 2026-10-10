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

/** Every screen the section can show. 'search' is a player or team page; the views in
 *  MLB_STATS_BOARDS are the boards of the Stats tab. */
export type MlbView = 'home' | 'scores' | 'standings' | 'stats' | 'leaderboard' | 'teamStats' | 'fielding' | 'viz' | 'teams' | 'search'
const MLB_VIEWS: readonly MlbView[] = ['home', 'scores', 'standings', 'stats', 'leaderboard', 'teamStats', 'fielding', 'viz', 'teams', 'search']
export const isMlbView = (v: unknown): v is MlbView => typeof v === 'string' && (MLB_VIEWS as readonly string[]).includes(v)

/** The Stats tab's boards, in WPBL's order (Leaders, Players, Teams, Fielding), with MLB's Charts
 *  after them. ONE LIST because "is this a Stats board" was spelled out by hand all over the
 *  section, and a board missing from one of those tests loses its season on Back, or its column
 *  width, with no error. */
export const MLB_STATS_BOARDS = ['leaderboard', 'stats', 'teamStats', 'fielding', 'viz'] as const
export type MlbStatsBoard = (typeof MLB_STATS_BOARDS)[number]
export const isMlbStatsBoard = (v: unknown): v is MlbStatsBoard =>
  typeof v === 'string' && (MLB_STATS_BOARDS as readonly string[]).includes(v)

export const MLB_BASE = '/mlb'
export const MLB_TEAMS_BASE = '/mlb/teams'
export const MLB_PLAYERS_BASE = '/mlb/players'
export const MLB_GAMES_BASE = '/mlb/games'

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
  // Not /mlb/teams/stats: everything under /mlb/teams/ is a club, and a club slug is the nickname.
  teamStats:   '/mlb/team-stats',
  fielding:    '/mlb/fielding',
  viz:         '/mlb/charts',
  teams:       MLB_TEAMS_BASE,
}

/** The five tabs. Here rather than in MlbStats because the shell's toolbar draws them on a
 *  desktop (see src/sectionNav.ts) and must be able to before the section's chunk has loaded. */
export type MlbNavKey = 'home' | 'scores' | 'standings' | 'stats' | 'teams'
export const MLB_NAV: { key: MlbNavKey; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'scores',    label: 'Scores' },
  { key: 'standings', label: 'Standings' },
  { key: 'stats',     label: 'Stats' },
  { key: 'teams',     label: 'Teams' },
]

/** The tab a path lights before the section has said so itself. The Stats boards are one
 *  tab; a player, game or series page lights nothing until the section knows where it came from. */
export function mlbNavKeyFromPath(pathname: string): MlbNavKey | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === MLB_BASE) return 'home'
  if (p === MLB_VIEW_PATHS.scores) return 'scores'
  if (p === MLB_VIEW_PATHS.standings) return 'standings'
  if (MLB_STATS_BOARDS.some(b => MLB_VIEW_PATHS[b] === p)) return 'stats'
  if (p === MLB_TEAMS_BASE || p.startsWith(`${MLB_TEAMS_BASE}/`)) return 'teams'
  return null
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

// ─── Games ────────────────────────────────────────────────────────────────────
//
// /mlb/games/<gamePk>: Game Center (or, before first pitch, the matchup preview), which is a SHEET
// over a page rather than a page of its own. The address belongs to the sheet's history entry
// (state/sheetHistory.ts), so it is in the bar exactly while the sheet is up and Back takes it
// away with the sheet. Landed on cold, the page under it is Scores (state/GameRoute.tsx).
//
// THE PK ALONE, with no matchup in the slug. A game's clubs and date are fixed, but a postseason
// game is published before its clubs are known ("HOU/CWS"), so a slug written then would be wrong
// by the time anyone shared it, and the id is what StatsAPI resolves on anyway.

export function mlbGamePath(gamePk: number): string {
  return `${MLB_GAMES_BASE}/${gamePk}`
}

/** The gamePk a game path names, or null. Digits only, no leading zero, so each game is one URL. */
export function mlbGamePkFromPath(pathname: string): number | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${MLB_GAMES_BASE}/`)) return null
  const m = /^[1-9]\d{0,9}$/.exec(p.slice(MLB_GAMES_BASE.length + 1))
  return m ? Number(m[0]) : null
}

/** The gamePk of a pre-Oct 2026 game link, `/mlb?open=game&gamePk=…`, which every game-start push
 *  carried and some still sit on phones and in the bell's store. Null when the query is not one. */
export function mlbLegacyGamePk(search: string): number | null {
  const params = new URLSearchParams(search)
  if (params.get('open') !== 'game') return null
  const pk = Number(params.get('gamePk'))
  return Number.isInteger(pk) && pk > 0 ? pk : null
}

// ─── Postseason series ────────────────────────────────────────────────────────
//
// /mlb/postseason/<season>/<slot>: the series sheet, a sheet over Standings exactly as a game is a
// sheet over Scores. The SLOT, not the clubs: the bracket is published before most of its clubs are
// known, so "alds-1" is the only name the series has from the day the field is set, and it never
// changes. The slots are StatsAPI's series ids (postseason.ts), restated here because this file
// imports nothing. The season is in the path so a link shared in October still means that October
// the following spring.

export const MLB_POSTSEASON_BASE = '/mlb/postseason'

/** StatsAPI series id to slot. The 12-club format these ids describe began in 2022. */
export const MLB_SERIES_SLUGS = {
  F_1: 'al-wild-card-1', F_2: 'al-wild-card-2', F_3: 'nl-wild-card-1', F_4: 'nl-wild-card-2',
  D_1: 'alds-1', D_2: 'alds-2', D_3: 'nlds-1', D_4: 'nlds-2',
  L_1: 'alcs', L_2: 'nlcs', W_1: 'world-series',
} as const
export type MlbSeriesId = keyof typeof MLB_SERIES_SLUGS
export const MLB_FIRST_BRACKET_SEASON = 2022

export interface MlbSeriesRef { season: number; id: MlbSeriesId }

export function mlbSeriesPath(season: number, id: MlbSeriesId): string {
  return `${MLB_POSTSEASON_BASE}/${season}/${MLB_SERIES_SLUGS[id]}`
}

/** The series a path names, or null. Not checked against the calendar: the edge does that. */
export function mlbSeriesFromPath(pathname: string): MlbSeriesRef | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${MLB_POSTSEASON_BASE}/`)) return null
  const m = /^(\d{4})\/([a-z0-9-]+)$/.exec(p.slice(MLB_POSTSEASON_BASE.length + 1))
  if (!m) return null
  const season = Number(m[1])
  const id = (Object.keys(MLB_SERIES_SLUGS) as MlbSeriesId[]).find(k => MLB_SERIES_SLUGS[k] === m[2])
  return id && season >= MLB_FIRST_BRACKET_SEASON ? { season, id } : null
}

/** A sheet with an address of its own (a game, a series) is on top, rather than a page. */
export const isMlbSheetPath = (pathname: string): boolean =>
  mlbGamePkFromPath(pathname) != null || mlbSeriesFromPath(pathname) != null

// ─── Short links ──────────────────────────────────────────────────────────────
//
// /m/<code>, for a share that has to fit a post: WPBL's /p and /g for the MLB section, and the
// same arrangement (functions/m/[[code]].ts 302s to the canonical path, which is what a reader
// lands on, Google indexes and an unfurler reads). One prefix for three kinds, told apart by the
// code's first letter, because the WPBL section already holds the two obvious ones.
//
//   p + the player id in base 36     /m/pe5gv     -> /mlb/players/<name>-660271
//   g + the gamePk in base 36        /m/gi7q8     -> /mlb/games/849824
//   s + yy + the series id           /m/s26d1     -> /mlb/postseason/2026/alds-1
//
// NOTHING IS STORED. Every code is the id it stands for, re-encoded, so there is no table to keep,
// nothing to mint at share time, and a code cannot go stale or be reused; the edge proves the
// target exists exactly as it does for the long form.

export const MLB_SHORT_BASE = '/m'

export type MlbShortTarget =
  | { kind: 'player'; id: number }
  | { kind: 'game'; gamePk: number }
  | { kind: 'series'; season: number; id: MlbSeriesId }

/** The two-character series code: F_1 -> f1. */
const seriesCode = (id: MlbSeriesId) => id.replace('_', '').toLowerCase()

export function mlbShortPath(t: MlbShortTarget): string {
  if (t.kind === 'player') return `${MLB_SHORT_BASE}/p${t.id.toString(36)}`
  if (t.kind === 'game') return `${MLB_SHORT_BASE}/g${t.gamePk.toString(36)}`
  return `${MLB_SHORT_BASE}/s${String(t.season % 100).padStart(2, '0')}${seriesCode(t.id)}`
}

/** What a short path names, or null. One segment, lower-case base 36, no leading zero, so each
 *  target has exactly one code. */
export function mlbShortTargetFromPath(pathname: string): MlbShortTarget | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${MLB_SHORT_BASE}/`)) return null
  const code = p.slice(MLB_SHORT_BASE.length + 1)
  const num = /^([pg])([1-9a-z][0-9a-z]{0,7})$/.exec(code)
  if (num) {
    const n = parseInt(num[2], 36)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    return num[1] === 'p' ? { kind: 'player', id: n } : { kind: 'game', gamePk: n }
  }
  const ser = /^s(\d{2})([fdlw]\d)$/.exec(code)
  if (!ser) return null
  const id = (Object.keys(MLB_SERIES_SLUGS) as MlbSeriesId[]).find(k => seriesCode(k) === ser[2])
  const season = 2000 + Number(ser[1])
  return id && season >= MLB_FIRST_BRACKET_SEASON ? { kind: 'series', season, id } : null
}

/** Where a short target lands. A player lands on the bare id, which the /mlb edge 301s onto the
 *  current name unless the caller knows it already. */
export function mlbShortDestination(t: MlbShortTarget, playerName?: string | null): string {
  if (t.kind === 'player') return mlbPlayerPath({ id: t.id, fullName: playerName })
  if (t.kind === 'game') return mlbGamePath(t.gamePk)
  return mlbSeriesPath(t.season, t.id)
}

/** The marker the edge adds to the landing URL, so the section can count the open; the same
 *  spelling as WPBL's (WPBL_SHORT_REF_PARAM), restated because neither section imports the other. */
export const MLB_SHORT_REF_PARAM = 'ref'
export const MLB_SHORT_REF_VALUE = 'short'

// ─── Reading an address ───────────────────────────────────────────────────────

/** What a URL asks the section to show. `gamePk` and `series` are a sheet over that view. */
export interface MlbTarget { view: MlbView; playerId?: number; teamId?: number; gamePk?: number; series?: MlbSeriesRef }

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
  const gamePk = mlbGamePkFromPath(p)
  if (gamePk) return { view: 'scores', gamePk }
  const series = mlbSeriesFromPath(p)
  if (series) return { view: 'standings', series }
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
 *  on a query (`open=`, `gamePk=`, `lb=`, `season=`, `sort=`) is carried through a redirect untouched. */
export const MLB_LEGACY_PARAMS = ['view', 'pid', 'tid'] as const
/** The same for a legacy game link, whose whole meaning moves into the path. */
export const MLB_LEGACY_GAME_PARAMS = ['view', 'pid', 'tid', 'open', 'gamePk'] as const

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
  /** The Table board's ranked stat. Left off when it is the board's default. On the address so
   *  a Leaders card can link to "this stat, ranked in full" and a crawler can follow it. */
  sort?: string | null
  /** A sort turned round from its column's natural order (ERA high to low, HR low to high). Left off
   *  when it is not, so the address only ever says what the reader changed. Named for the order
   *  itself rather than "reversed", so the link reads the same whichever way the column runs. */
  dir?: 'asc' | 'desc' | null
  /** Fielding's position, as StatsAPI abbreviates it. Left off for All. */
  pos?: MlbFieldingPosition | null
  /** Fielding's club filter, by id; the address spells it as the club's slug. Not `teamId`, which
   *  is a club's own PAGE: this is a board narrowed to one club's fielders. */
  club?: number | null
}

/** The positions the Fielding board offers, in scorebook order with the pitcher last. Here rather
 *  than beside the board's arithmetic because the address names them, and this module imports
 *  nothing (see its header). */
export const MLB_FIELDING_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'P'] as const
export type MlbFieldingPosition = (typeof MLB_FIELDING_POSITIONS)[number]
const isFieldingPosition = (v: unknown): v is MlbFieldingPosition =>
  typeof v === 'string' && (MLB_FIELDING_POSITIONS as readonly string[]).includes(v)

/** The full address of a snapshot: the path, plus the board filters the path cannot say. */
export function mlbUrlFor(s: MlbSnapshot, currentSeason?: number): string {
  let path: string
  if (s.playerId) path = mlbPlayerPath({ id: s.playerId, fullName: s.playerName })
  else if (s.teamId) path = mlbTeamPath(s.teamId)
  else path = s.view === 'search' ? MLB_BASE : MLB_VIEW_PATHS[s.view]
  const params = new URLSearchParams()
  if (!s.playerId && !s.teamId && isMlbStatsBoard(s.view)) {
    // Fielding has no side: it is the side.
    if (s.lb === 'pitching' && s.view !== 'fielding') params.set('lb', 'pitching')
    if (s.view === 'stats' && s.allTime) params.set('season', 'all')
    else if (s.season != null && currentSeason != null && s.season !== currentSeason) params.set('season', String(s.season))
    if (s.view !== 'viz' && s.games && s.games !== 'regular') params.set('games', s.games)
    // The sort, on every board that has columns. Each board leaves off its own default.
    if ((s.view === 'stats' || s.view === 'teamStats' || s.view === 'fielding') && s.sort) params.set('sort', s.sort)
    if ((s.view === 'stats' || s.view === 'teamStats' || s.view === 'fielding') && s.dir) params.set('dir', s.dir)
    if (s.view === 'fielding') {
      if (s.pos) params.set('pos', s.pos)
      const club = s.club != null ? mlbClubById(s.club) : undefined
      if (club) params.set('team', club.slug)
    }
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Everything an address says, as the snapshot `mlbUrlFor` would have written it from: the page,
 *  plus the board filters on the query. Null when it is not an MLB page. The inverse of
 *  `mlbUrlFor`, so the section can be put on any address it can produce, and the one reader of
 *  the query: landing, Back, Forward and the shell's navigate() all go through it, where each used
 *  to read its own subset and Back never read the season at all. `season` is null for the current
 *  season, which the address leaves off. A game's address names the scoreboard, as
 *  `mlbTargetFromPath` does; the page under an open sheet is its history entry's to say. */
export function mlbSnapshotFromUrl(pathname: string, search: string): MlbSnapshot | null {
  const target = mlbTargetFromUrl(pathname, search)
  if (!target) return null
  if (target.playerId) return { view: 'search', playerId: target.playerId }
  if (target.teamId) return { view: 'search', teamId: target.teamId }
  const snap: MlbSnapshot = { view: target.view }
  const v = target.view
  if (!isMlbStatsBoard(v)) return snap
  const q = new URLSearchParams(search)
  snap.lb = q.get('lb') === 'pitching' && v !== 'fielding' ? 'pitching' : 'hitting'
  const season = q.get('season')
  const n = Number(season)
  snap.allTime = v === 'stats' && season === 'all'
  snap.season = Number.isInteger(n) && n > 0 ? n : null
  if (v !== 'viz') {
    const g = q.get('games')
    snap.games = g === 'post' || g === 'all' ? g : 'regular'
  }
  if (v === 'stats' || v === 'teamStats' || v === 'fielding') {
    snap.sort = q.get('sort') || null
    const dir = q.get('dir')
    snap.dir = dir === 'asc' || dir === 'desc' ? dir : null
  }
  if (v === 'fielding') {
    // A position or a club the board does not know reads as All: a stale or hand-edited link
    // should open the board rather than an empty one.
    const pos = q.get('pos')
    snap.pos = isFieldingPosition(pos) ? pos : null
    snap.club = MLB_CLUBS.find(c => c.slug === q.get('team'))?.id ?? null
  }
  return snap
}

// ─── The rules & glossary page ────────────────────────────────────────────────
//
// /mlb/glossary, WPBL's /wpbl/glossary for this section (the second alignment pass in ROADMAP.md).
// A STANDALONE page the shell draws, as WPBL's is, and deliberately NOT one of `isMlbPath`'s: that
// test decides whether MlbStats renders, and the section has no tab to light for it. The shell asks
// `isMlbSection` wherever it means "the reader is in MLB" (the scale, the toolbar's tabs, the
// league switch). Before it, MLB explained its stats only in tooltips, which nothing can index.
export const MLB_GLOSSARY_PAGE = `${MLB_BASE}/glossary`

export const isMlbGlossaryPage = (pathname: string): boolean =>
  pathname.replace(/\/+$/, '') === MLB_GLOSSARY_PAGE

// ─── Comparison pages ─────────────────────────────────────────────────────────
//
// /mlb/compare, /mlb/compare/<player> and /mlb/compare/<a>-vs-<b>: WPBL's three states (an empty
// picker, one slot filled, a pair) on MLB's player slugs. Standalone, like the glossary, so not an
// `isMlbPath`. The pair is in the path for the reason WPBL's is: a query string is one URL to a
// search engine, and "X vs Y" is a thing people search for.
//
// THE IDS ARE THE PAIR, and each half is a player path's own slug, `<name>-<id>`, so a name that
// changes spelling or two players who share one cannot make a pair ambiguous the way a bare-name
// slug can. The names are for the reader; the edge 301s a stale or missing one onto the current
// spelling, in the reader's order. Like WPBL's, nothing under the picker goes in the sitemap:
// every pair of players in the majors is millions of machine-made pages.

export const MLB_COMPARE_BASE = `${MLB_BASE}/compare`
export const MLB_COMPARE_JOIN = '-vs-'

type Named = { id: number; fullName?: string | null }

/** One half of a compare slug: a player path's last segment. */
const compareHalf = (p: Named): string => mlbPlayerPath(p).slice(MLB_PLAYERS_BASE.length + 1)

/** A pair in the order it was built, `a` on the left. Not sorted: start from one player's page and
 *  add a second, and that player stays where the reader put them. `mlbCompareCanonicalPath` is the
 *  one spelling for a search engine. */
export function mlbComparePath(a: Named, b: Named): string {
  return `${MLB_COMPARE_BASE}/${compareHalf(a)}${MLB_COMPARE_JOIN}${compareHalf(b)}`
}

/** Both orders of a pair declare this as their rel=canonical, so they are one page to Google. */
export function mlbCompareCanonicalPath(a: Named, b: Named): string {
  const [x, y] = [compareHalf(a), compareHalf(b)].sort()
  return `${MLB_COMPARE_BASE}/${x}${MLB_COMPARE_JOIN}${y}`
}

/** The picker with one slot filled, where a player card's Compare lands. A state, so noindex. */
export function mlbCompareStartPath(p: Named): string {
  return `${MLB_COMPARE_BASE}/${compareHalf(p)}`
}

export type MlbCompareTarget = { kind: 'picker' } | { kind: 'single'; id: number } | { kind: 'pair'; a: number; b: number }

const HALF = '(?:[a-z0-9-]*?-)?([1-9]\\d{0,8})'
const SINGLE_RE = new RegExp(`^${HALF}$`, 'i')
const PAIR_RE = new RegExp(`^${HALF}${MLB_COMPARE_JOIN}${HALF}$`, 'i')

/**
 * What a compare path names, or null when it is not one. The pair is tried first: the first half's
 * id is digits directly before the join, and a single slug can never contain "<digits>-vs-<…><digits>"
 * because it ends in its one id. One segment only, for the reason a player path is: Cloudflare's `*`
 * matches across slashes. A player against themselves is not a pair, and is null.
 */
export function mlbCompareTargetFromPath(pathname: string): MlbCompareTarget | null {
  const p = pathname.replace(/\/+$/, '')
  if (p === MLB_COMPARE_BASE) return { kind: 'picker' }
  if (!p.startsWith(`${MLB_COMPARE_BASE}/`)) return null
  const rest = p.slice(MLB_COMPARE_BASE.length + 1)
  const pair = PAIR_RE.exec(rest)
  if (pair) {
    const a = Number(pair[1]), b = Number(pair[2])
    return a === b ? null : { kind: 'pair', a, b }
  }
  const single = SINGLE_RE.exec(rest)
  return single ? { kind: 'single', id: Number(single[1]) } : null
}

export const isMlbComparePage = (pathname: string): boolean => mlbCompareTargetFromPath(pathname) !== null

// A SEASON OTHER THAN THE CURRENT ONE IS A QUERY STRING, the one exception to the rule at the top
// of this file, and on purpose: it is a view of the same pair, as a year is a view of the same
// player card, so every season of "X vs Y" declares the season-less pair as its canonical and is
// one page to a search engine. As a path it would be a page per pair per year, which is the
// doorway problem above multiplied by a century. The current season is never written, so a link
// shared today follows the section into next season, as every other MLB page with no season in
// its address does.

/** The first season StatsAPI has lines for. */
const MLB_FIRST_SEASON = 1876

/** The season a compare URL asks for: `?season=` when it names one that can have lines, else
 *  `current`. A season in the future or before the record is the current one, not an error page. */
export function mlbCompareSeasonFromSearch(search: string, current: number): number {
  const raw = new URLSearchParams(search).get('season')
  const n = raw && /^\d{4}$/.test(raw) ? Number(raw) : NaN
  return n >= MLB_FIRST_SEASON && n <= current ? n : current
}

/** A compare path carrying `season`, which is left off when it is the current one. */
export function withMlbCompareSeason(path: string, season: number, current: number): string {
  return season === current ? path : `${path}?season=${season}`
}

/** The standalone pages, as rows in the section's More menu on a desktop and on a phone. Real
 *  addresses, so the toolbar draws them as <a href> without the section loaded, as WPBL's are. */
export const MLB_MORE_PAGES: readonly { href: string; label: string; hint: string; event?: string; eventProps?: Record<string, unknown> }[] = [
  // The event's name restated rather than imported, since this file imports nothing (EVENTS in
  // lib/analytics.ts has it as MLB_COMPARE_OPENED).
  { href: MLB_COMPARE_BASE, label: 'Compare players', hint: 'Two players side by side, and how they did against each other',
    event: 'mlb_compare_opened', eventProps: { from: 'more' } },
  { href: MLB_GLOSSARY_PAGE, label: 'Rules & glossary', hint: 'The rules, and what each stat means' },
]

/** Anything that should read as "the reader is in the MLB section": the section's own paths and
 *  the standalone pages beside it. */
export const isMlbSection = (pathname: string): boolean =>
  isMlbPath(pathname) || isMlbGlossaryPage(pathname) || isMlbComparePage(pathname)

/** Every page with a fixed address, for the sitemap and the tests that pin it to the redirects. */
export const MLB_STATIC_PATHS: readonly string[] = [
  ...Object.values(MLB_VIEW_PATHS),
  ...MLB_CLUBS.map(c => `${MLB_TEAMS_BASE}/${c.slug}`),
  MLB_GLOSSARY_PAGE,
  MLB_COMPARE_BASE,
]

/** Fired after the section rewrites the address bar, so the shell re-reads its path (and seo.ts
 *  its tags). A pushState or replaceState fires no popstate, so without it the shell would keep
 *  the landing page's title on every tab. The same arrangement as WPBL_PATH_EVENT. */
export const MLB_PATH_EVENT = 'sd:mlb-path'
