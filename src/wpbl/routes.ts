// The WPBL section's URL map: one path per tab.
//
// WHY THIS IS ITS OWN MODULE, AND WHY IT IMPORTS (ALMOST) NOTHING. Three eagerly-loaded places need
// to agree on these paths: the shell's router in src/App.tsx, the per-route tags in
// src/seo.ts, and WpblApp itself. WpblApp is a `lazy()` chunk, so importing the map from
// there would drag the whole WPBL bundle into the entry chunk and undo the code splitting.
// Keeping it dependency-free also keeps it usable from the Pages Functions and from build
// scripts (the sitemap), neither of which can load anything that touches Vite assets: the
// same reasoning that keeps constants.ts out of the recap engine.
//
// The tabs were `/wpbl?view=standings` until Aug 21, 2026. A query string is one URL as far
// as a search engine is concerned, so the whole section had a single title, a single
// description and a single canonical no matter which tab you were on, and Google had
// exactly one WPBL page it could rank. Paths give each tab its own. The old spelling still
// resolves: functions/wpbl/index.ts 301s it here, so shared links and notification payloads
// from before the change keep working.

// The one exception to the no-imports rule. slug.ts is itself dependency-free, and it is
// deliberately the single definition of name-to-slug shared by the app and the Pages
// Function, so re-deriving it here is exactly the drift that file exists to prevent.
//
// THE `.ts` IS LOAD-BEARING. This module is now reached from Deno inside `wpbl-ingest`
// (announce-final.ts builds a game's URL for the Discord recap), and Deno resolves a local
// specifier literally: extensionless, it simply does not find the file, and the ingest's
// announce step fails at import time. Vite and esbuild both accept the explicit extension,
// and tsconfig has `allowImportingTsExtensions`, so it costs the other two builds nothing.
import { slugifyName } from './slug.ts'

export type WpblView = 'home' | 'schedule' | 'standings' | 'stats' | 'teams'

/** Tab order, which is also the order the mobile pager swipes through. */
export const WPBL_NAV: { key: WpblView; label: string }[] = [
  { key: 'home',      label: 'Home' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'standings', label: 'Standings' },
  { key: 'stats',     label: 'Stats' },
  { key: 'teams',     label: 'Teams' },
]

export const WPBL_BASE = '/wpbl'

/** Home is the section root; every other tab hangs off it. */
export function wpblPathFor(view: WpblView): string {
  return view === 'home' ? WPBL_BASE : `${WPBL_BASE}/${view}`
}

export const isWpblView = (v: unknown): v is WpblView => WPBL_NAV.some(n => n.key === v)

// Tracking used to be its own tab; it's now a stat group inside Stats. Any old bookmark,
// shared link, or restored history snapshot still naming it lands on Stats instead of
// falling back to Home. `wasTracking` tells the caller to open Stats *on* that group.
export const WPBL_LEGACY_TRACKING = 'tracking'

export function normalizeWpblView(v: unknown): { view: WpblView; wasTracking: boolean } {
  if (v === WPBL_LEGACY_TRACKING) return { view: 'stats', wasTracking: true }
  return { view: isWpblView(v) ? v : 'home', wasTracking: false }
}

/**
 * The tab a pathname names, or null if the path is not a WPBL tab at all.
 *
 * Null rather than a fallback to 'home' on purpose: the caller in App.tsx uses it to decide
 * whether this path belongs to the section, and `/wpbl/api` is a sibling route with its own
 * page rather than a tab. Collapsing an unknown path to Home there would swallow the API
 * docs, and would also make every mistyped `/wpbl/anything` render the section instead of
 * the 404 it now gets.
 */
export function wpblViewFromPath(pathname: string): WpblView | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === WPBL_BASE) return 'home'
  if (!p.startsWith(`${WPBL_BASE}/`)) return null
  const rest = p.slice(WPBL_BASE.length + 1)
  return isWpblView(rest) ? rest : null
}

/** Every tab URL, for the sitemap and for tests that pin the two lists together. */
export const WPBL_VIEW_PATHS = WPBL_NAV.map(n => wpblPathFor(n.key))

// ─── Player pages ─────────────────────────────────────────────────────────────
//
// A player is a modal over whichever tab you opened it from, but it gets ONE canonical URL
// regardless: /wpbl/players/denae-benites, never /wpbl/stats?player=<uuid>. Two reasons.
// A uuid says nothing to a reader or to a search engine, and the same player reachable from
// five tabs under five URLs is five near-duplicate pages competing with each other.

export const WPBL_PLAYERS_BASE = '/wpbl/players'

/** The shape a player needs to have to get a URL. Structural so callers can pass a full
 *  WpblPlayer row, a search hit, or the two columns the edge function reads. */
export interface WpblSluggable { id: string; name: string }

/**
 * The canonical slug for a player, which is their name unless that is ambiguous.
 *
 * Today the roster is 118 names with no collisions at all, but "unique by name" is a
 * property of the current roster rather than a rule, and the failure it would cause is the
 * bad kind: two players silently sharing a URL, one of them unreachable, with nothing
 * logged. So when a name IS shared, EVERY player holding it takes the id-suffixed form and
 * the bare slug resolves to nobody (see findWpblPlayerBySlug). Serving a 404 for a genuinely
 * ambiguous URL is recoverable; quietly serving the wrong player is not.
 *
 * `roster` is required for that reason: uniqueness cannot be judged from one row.
 */
export function wpblPlayerSlug(player: WpblSluggable, roster: readonly WpblSluggable[]): string {
  const base = slugifyName(player.name)
  if (!base) return player.id
  const shared = roster.filter(p => slugifyName(p.name) === base).length > 1
  return shared ? `${base}-${player.id.slice(0, 8)}` : base
}

export function wpblPlayerPath(player: WpblSluggable, roster: readonly WpblSluggable[]): string {
  return `${WPBL_PLAYERS_BASE}/${wpblPlayerSlug(player, roster)}`
}

/** The slug a pathname names, or null if it is not a player URL. */
export function wpblPlayerSlugFromPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${WPBL_PLAYERS_BASE}/`)) return null
  const rest = p.slice(WPBL_PLAYERS_BASE.length + 1)
  // One segment only: /wpbl/players/a/b is not a player, it is a typo.
  return rest && !rest.includes('/') ? decodeURIComponent(rest) : null
}

/** Resolve a slug back to a player, or null. Null covers both "no such player" and "that
 *  name is shared, so the bare slug does not identify anyone". */
export function findWpblPlayerBySlug<T extends WpblSluggable>(
  slug: string,
  roster: readonly T[],
): T | null {
  const want = slug.toLowerCase()
  const hits = roster.filter(p => wpblPlayerSlug(p, roster) === want)
  return hits.length === 1 ? hits[0] : null
}

/**
 * Every path WpblApp itself renders: the tabs, plus a player page, which is a modal the
 * section opens over a tab and so is still the section's own route.
 *
 * It is exported because two places in two files have to agree on it, and they did not.
 * App.tsx uses it to decide whether to MOUNT the section; WpblApp's popstate handler uses it
 * to decide whether a Back or Forward belongs to the section or is the shell swapping between
 * MLB and WPBL. The handler tested `wpblViewFromPath` alone, which is null for
 * /wpbl/players/<slug>, so every pop that LANDED on a player page was dropped: the address bar
 * moved to her URL and the modals stayed exactly as they were. Reachable by Forward onto any
 * player, and by Back out of any game opened from a player's game log.
 *
 * The players INDEX is deliberately not here. It is a page of its own, not a tab with a modal
 * over it, and App.tsx routes it separately.
 */
export const wpblAppOwnsPath = (pathname: string): boolean =>
  wpblViewFromPath(pathname) !== null
  || wpblPlayerSlugFromPath(pathname) !== null
  || wpblGameSlugFromPath(pathname) !== null

// ─── Game pages ───────────────────────────────────────────────────────────────
//
// Game Center was deep-linkable as `?game=<uuid>` from the start, which is not the same
// thing as having a page. seo.ts canonicalises a query string back to the tab underneath on
// purpose (a hundred shared game links must not read as a hundred near-duplicates of
// Schedule), so every game recap on the section was, by design, unindexable and unlinkable:
// the schedule cards were bare onClick divs because there was no href to give them.
//
// A game gets the same treatment a player got. One canonical path, readable, with the date
// and both clubs in it, so a pasted link says what it is before anyone opens it. That also
// makes 41 recaps the only content on the section that is worth anything after Sep 22.

export const WPBL_GAMES_BASE = '/wpbl/games'

/** What a game needs to have to get a URL. Structural, like WpblSluggable: a full row, a
 *  schedule entry, or the four columns the edge function reads all satisfy it. */
export interface WpblSluggableGame {
  id: string
  /** 'YYYY-MM-DD'. The date is the first thing in the slug because it is what sorts, what
   *  disambiguates a rematch, and what a reader scans for. */
  game_date: string
  home_team_id: string
  away_team_id: string
}

/** Just enough of a club to name it in a URL. */
export interface WpblSluggableTeam { id: string; name: string }

/** Club nickname, slugged: 'Hunters' → 'hunters'. Falls back to the team id (which IS the
 *  abbreviation) so a game whose club is missing from `teams` still gets a stable slug
 *  rather than a hole in the middle of one. */
function teamSlug(teamId: string, teams: readonly WpblSluggableTeam[]): string {
  const t = teams.find(x => x.id === teamId)
  return slugifyName(t?.name ?? teamId) || teamId.toLowerCase()
}

/** The date-and-matchup part, before any disambiguation. Away first, the way a box score
 *  and every scoreboard on the site already read it. */
function gameSlugBase(game: WpblSluggableGame, teams: readonly WpblSluggableTeam[]): string {
  const date = String(game.game_date ?? '').slice(0, 10)
  return `${date}-${teamSlug(game.away_team_id, teams)}-at-${teamSlug(game.home_team_id, teams)}`
}

/**
 * The canonical slug for a game, which is its date and matchup unless that is ambiguous.
 *
 * Date plus an ordered pair of clubs separates every game the league has scheduled,
 * including the postseason, where a best-of-five is five dates for one pairing. The one
 * shape it does NOT separate is a true doubleheader, which the league has not played and may
 * never; the rule is here because "unique by date and matchup" is a property of the current
 * schedule rather than something the format guarantees, and the failure it would cause is
 * the silent kind. So exactly as with a shared player name, when a base slug IS shared every
 * game holding it takes the id-suffixed form and the bare slug resolves to nobody. Serving a
 * 404 for a genuinely ambiguous URL is recoverable; quietly serving the wrong game, with the
 * wrong final score under a title naming the right one, is not.
 *
 * `schedule` is required for that reason: uniqueness cannot be judged from one row.
 */
export function wpblGameSlug(
  game: WpblSluggableGame,
  teams: readonly WpblSluggableTeam[],
  schedule: readonly WpblSluggableGame[],
): string {
  const base = gameSlugBase(game, teams)
  const shared = schedule.filter(g => gameSlugBase(g, teams) === base).length > 1
  return shared ? `${base}-${game.id.slice(0, 8)}` : base
}

export function wpblGamePath(
  game: WpblSluggableGame,
  teams: readonly WpblSluggableTeam[],
  schedule: readonly WpblSluggableGame[],
): string {
  return `${WPBL_GAMES_BASE}/${wpblGameSlug(game, teams, schedule)}`
}

/** The slug a pathname names, or null if it is not a game URL. One segment only, for the
 *  same reason as a player: /wpbl/games/a/b is a typo, not a game. */
export function wpblGameSlugFromPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '')
  if (!p.startsWith(`${WPBL_GAMES_BASE}/`)) return null
  const rest = p.slice(WPBL_GAMES_BASE.length + 1)
  return rest && !rest.includes('/') ? decodeURIComponent(rest) : null
}

/** Resolve a slug back to a game, or null. Null covers both "no such game" and "that date
 *  and matchup is shared, so the bare slug does not identify one". */
export function findWpblGameBySlug<T extends WpblSluggableGame>(
  slug: string,
  schedule: readonly T[],
  teams: readonly WpblSluggableTeam[],
): T | null {
  const want = slug.toLowerCase()
  const hits = schedule.filter(g => wpblGameSlug(g, teams, schedule) === want)
  return hits.length === 1 ? hits[0] : null
}

/** The players index, which exists mainly so every player page has something linking to it. */
export const WPBL_PLAYERS_INDEX = WPBL_PLAYERS_BASE

export const isWpblPlayersIndex = (pathname: string) =>
  pathname.replace(/\/+$/, '') === WPBL_PLAYERS_BASE

/**
 * Fired by WpblApp after it pushes a history entry, so the shell can re-read the path.
 *
 * The section owns its own history: it pushes a snapshot (`history.state.wpbl`) rather than
 * going through the shell's `navigate()`, because Back has to unwind tab → team → modal one
 * step at a time. That was invisible to src/App.tsx while every tab was the same `/wpbl`,
 * and became a bug the moment they weren't: the shell holds the `path` that feeds `useSeo`,
 * so without this the title, description and canonical would stay on whichever tab the
 * reader first landed on while the address bar moved underneath them.
 *
 * A plain Event rather than re-dispatching `popstate`: WpblApp listens for popstate itself
 * and would re-apply a structured-clone of the snapshot it just pushed, handing every
 * consumer new object identities for team/game/player and re-firing effects keyed on them.
 */
export const WPBL_PATH_EVENT = 'sd:wpbl-path'
