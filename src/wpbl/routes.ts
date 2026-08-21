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
import { slugifyName } from './slug'

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
