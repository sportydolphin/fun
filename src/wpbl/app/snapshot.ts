import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { carryStatsParams } from '../stats/address'
import { wpblPathFor, wpblViewFromPath, normalizeWpblView,
  wpblPlayerPath,
  wpblGamePath,
  wpblTeamPath, wpblTeamSlugFromPath,
  WPBL_AWARDS_PATH, isWpblAwardsPage,
  type WpblView,
} from '../routes'
import { playFragmentFor } from '../entryUrl'
import { seasonFromSearch } from '../SeasonContext'

// A navigable WPBL location, persisted in history.state.wpbl so browser Back unwinds the
// section one step at a time (tab → team detail → game/player modal) instead of leaping
// straight out to /mlb. The MLB|WPBL toolbar switch pushes its own /mlb or /wpbl entry, so
// it sits in the same back-stack for free. game/player hold the full row (plain Supabase
// objects, structured-clonable), so a modal reopens intact on Back or refresh.
export type WpblSnap = {
  view: WpblView
  team: WpblTeam | null
  game: WpblGame | null
  player: WpblPlayer | null
  /**
   * The fan awards ballot, which is a modal over Home with an address of its own.
   *
   * A BOOLEAN AND NOT AN OBJECT, unlike the three above it, because there is exactly one
   * ballot: nothing has to be resolved out of the URL, so it needs no roster, no schedule and
   * none of the pending-slug machinery those three carry. `/wpbl/awards` says everything there
   * is to say about this state.
   *
   * OPTIONAL BECAUSE OLD ENTRIES EXIST. Every snapshot already sitting in a reader's back stack
   * was written before this field, so it arrives `undefined`; read it through `!!` and an old
   * entry means "closed", which is what it was.
   */
  awards?: boolean
  /**
   * The open game is drawn as the full desktop page rather than the side panel. Same URL either
   * way: the address names the game, and how it is presented depends on how the reader got here.
   * A game opened from inside the section is the panel, so the page they were on stays beside it;
   * a game ARRIVED AT (a cold load, a shared link, a link from a page outside this component) is
   * the page, because there is nothing beside it worth keeping. "Expand" turns one into the other.
   * Ignored on a phone, where both are the sheet. Optional because old entries exist; see `awards`.
   */
  gamePage?: boolean
  /**
   * The open player is drawn as their full desktop page rather than the side panel, on the same
   * terms as `gamePage`: same URL, chosen by how the reader got here (arrived at, or "Expand").
   * Never alongside `gamePage`: a player over the full Game Center is the panel beside it.
   */
  playerPage?: boolean
  /**
   * The year on screen, or null for the current one (see SeasonContext). ABSENT is not null: an
   * entry written before this field existed, or one built by a call site that has no reason to know
   * the year (opening a game), leaves the reader's pick alone rather than resetting it, and `stamp`
   * fills it in before the entry is stored, so Back always restores the year it left.
   */
  season?: number | null
}
export const normalizeView = normalizeWpblView
export const HOME_SNAP: WpblSnap = { view: 'home', team: null, game: null, player: null, awards: false }

/** The tabs a picked season applies to, which are the ones that sum a season. Home is "now" and
 *  Scores lists every fixture, next year's included, so neither carries `?season=`. */
export const SEASON_VIEWS: ReadonlySet<WpblView> = new Set<WpblView>(['standings', 'stats', 'teams'])

/** `?season=2026` off the address, or null. Validated against the schedule later, in
 *  useWpblSeason, since a year the league never played is only knowable once it has loaded. */
const seasonFromLocation = () => seasonFromSearch(window.location.search)

/**
 * The view a cold load is asking for.
 *
 * A legacy `?view=` is read BEFORE the path, because it is the only one of the two that can
 * still say `tracking`. That group lives inside Stats now, so the edge 301s such a link to
 * /wpbl/stats and deliberately keeps the param (see functions/wpbl/index.ts); reading the
 * path first would see plain `stats`, and the Tracked board the link asked for would
 * silently not open. Every other legacy value is 301'd with the param stripped, so in
 * practice this only ever fires for tracking.
 */
export function viewFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('view')
    ?? wpblViewFromPath(window.location.pathname)
}

/** The snapshot an address asks for when its history entry carries none: a cold load, and an
 *  entry someone else pushed, which is the toolbar's league switch landing on the same tab in this
 *  section (src/sectionSwitch.ts). The tab and the awards sheet come from the path; a club, a
 *  player or a game has to wait for the roster. */
export function snapFromLocation(): WpblSnap {
  const v = viewFromLocation()
  if (v != null) return { ...HOME_SNAP, view: normalizeView(v).view, season: seasonFromLocation() }
  // /wpbl/teams/<slug> is the Teams tab with a club chosen, and `viewFromLocation` says
  // null for it because it is not a tab path. Left at that fallback the section seeds on
  // HOME, the very first replaceState rewrites the address bar to /wpbl, and the club that
  // then resolves out of the path has had its own URL thrown away before it arrives. The
  // club itself cannot be seeded here (the roster has not loaded), only the tab.
  if (wpblTeamSlugFromPath(window.location.pathname)) return { ...HOME_SNAP, view: 'teams', season: seasonFromLocation() }
  // /wpbl/awards is Home with the ballot open. Unlike a club or a player there is nothing to
  // resolve, so this is the whole of the cold-load path for it: no pending ref, no effect
  // waiting on a fetch.
  if (isWpblAwardsPage(window.location.pathname)) return { ...HOME_SNAP, awards: true }
  return HOME_SNAP
}

/**
 * The tab is the PATH (/wpbl/standings); the open modal stays a query param on top of it.
 * The two are different kinds of thing: a tab is a page worth indexing under its own
 * title, a modal is a state laid over whichever page you were on. Keeping the modal in
 * the query is also what lets seo.ts canonicalise it back to the tab underneath, so a
 * hundred shared game links do not read as a hundred near-duplicate pages.
 */
export function wpblUrlFor(s: WpblSnap, { players, games, teams, pickedSeason }: {
  players: WpblPlayer[]
  games: WpblGame[]
  teams: WpblTeam[]
  /** The season the reader picked, for a snapshot that does not carry its own. */
  pickedSeason: number | null
}): string {
  const q = new URLSearchParams()
  if (s.game) q.set('game', s.game.id) // deep-linkable game center

  // A game with nothing open on top of it owns the path, for the same reasons a player
  // does: `?game=<uuid>` is one URL as far as seo.ts is concerned (it canonicalises a
  // query back to the tab underneath, so a hundred shared game links do not read as a
  // hundred near-duplicates of Schedule), which would make every recap unindexable by
  // design. It also gives the schedule cards an href, which is what makes them links a
  // crawler can follow rather than onClick divs.
  //
  // A PLAYER opened from a game keeps the player's path and leaves the game on the query:
  // the deeper modal is the page, the one under it is state.
  //
  // Falls back to the query form while the schedule or the clubs are still in flight,
  // since a slug cannot be proven unique without the whole schedule (see wpblGameSlug).
  if (s.game && !s.player && games.length > 0 && teams.length > 0) {
    // The play fragment a reader arrived on rides the game's own URL and nothing else.
    // See entryUrl.ts for why it has to be captured rather than read.
    const path = wpblGamePath(s.game, teams, games)
    return `${path}${playFragmentFor(path)}`
  }

  // An open player takes over the path, so a player has ONE canonical URL no matter which
  // tab it was opened from. The alternative, ?player=<uuid> hanging off five different
  // tabs, is five near-duplicate URLs for one person, none of them readable.
  //
  // Falls back to the old query form only while the roster is still in flight, since the
  // slug cannot be proven unique without it (see wpblPlayerSlug). That window is the first
  // moment of a cold load, and the URL corrects itself on the next navigation.
  if (s.player) {
    const path = players.length
      ? wpblPlayerPath(s.player, players)
      : `${wpblPathFor(s.view)}`
    const str = q.toString()
    if (players.length) return str ? `${path}?${str}` : path
    q.set('player', s.player.id)
    return `${path}?${q.toString()}`
  }

  // THE STATS BOARD'S OWN PARAMS RIDE THROUGH, and this is the only query this function does
  // not mint itself. `urlFor` builds a URL out of the snapshot, so anything on the address the
  // reader arrived at that the snapshot has never heard of is discarded the moment WpblApp's mount
  // effect below stamps the first entry, a beat before the Stats pane renders: without this,
  // `/wpbl/stats?board=runs` opens on Players with the query gone. See STATS_URL_PARAMS for why
  // the list lives over there.
  //
  // ONLY ONTO THIS TAB, and only with nothing laid over it. Carried blindly, a reader leaving a
  // sorted board for Schedule would take `?sort=ops` with them onto a page that has no columns,
  // and a player opened from the board would get a URL claiming a board underneath them. Reading
  // the CURRENT search is what makes it work at all: at mount that is still the address the
  // reader opened, and on every later navigation it is wherever they actually are, so there is
  // nothing to carry unless they are already on this tab.
  if (s.view === 'stats' && !s.game && !s.player && !s.awards) {
    carryStatsParams(new URLSearchParams(window.location.search), q)
  }

  // A PICKED SEASON, on the tabs that sum one, and only with nothing laid over them: a player or
  // a game has one URL whatever year the page under it shows. Absent for the current season, so
  // the address of a reader who never picks is exactly what it was before seasons existed.
  const season = s.season !== undefined ? s.season : pickedSeason
  if (season != null && SEASON_VIEWS.has(s.view) && !s.game && !s.player && !s.awards) {
    q.set('season', String(season))
  }

  // THE BALLOT, THEN A CLUB, CAN OWN THE PATH, both BELOW the game and player branches above for
  // the reason those are ordered that way: the deeper modal is the page and what is under it is
  // state.
  //
  // The ballot: a player opened from it keeps the player's URL, and closing that player returns to
  // /wpbl/awards, because the entry underneath still carries `awards: true`.
  //
  // A club selected on its own tab opens a whole page of content (results, team stats, lineup
  // history, pitching usage, leaders, the roster) that would otherwise have no URL: unindexable,
  // unlinkable, and with no href to give the cards. Only on the Teams tab, because `selectedTeam`
  // deliberately rides along through a tab switch: a reader who picks a club and swipes to Stats is
  // on Stats, and the path has to say so.
  const str = q.toString()
  if (s.awards && !s.game && !s.player) {
    return str ? `${WPBL_AWARDS_PATH}?${str}` : WPBL_AWARDS_PATH
  }

  if (s.view === 'teams' && s.team && !s.game && !s.player && teams.length > 0) {
    const path = wpblTeamPath(s.team, teams)
    return str ? `${path}?${str}` : path
  }

  return str ? `${wpblPathFor(s.view)}?${str}` : wpblPathFor(s.view)
}
