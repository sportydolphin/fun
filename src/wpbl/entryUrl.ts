/**
 * The address this page was OPENED at, captured once, before anything rewrites it.
 *
 * WHY THIS EXISTS. The section rewrites the address bar on mount: `urlFor` in WpblApp builds a
 * path and a query and no fragment, and `openFromLink` replaces the entry with it. So a link to
 * one at-bat, `/wpbl/games/2026-09-11-firebells-at-hunters#play-79`, lost its `#play-79` a beat
 * after the modal opened, and by the time the play-by-play mounted there was nothing left to
 * act on. Worse, the pane REMOUNTS during that first refresh (the tab content is swapped for a
 * spinner for about 200ms), so even a component that read the fragment correctly on first render
 * read an empty one on its second.
 *
 * A module-level constant is the only thing early enough. It is evaluated when the module graph
 * is, which is before any React effect, and it never changes afterwards, so every reader of it
 * sees the same answer however many times they mount.
 *
 * ITS OWN MODULE, and not WpblApp's, only because GameDetail needs it too and WpblApp renders
 * GameDetail. Nothing here imports anything.
 *
 * NOT THE CURRENT URL. `window.location.hash` is still the right thing to read for a fragment
 * the reader creates by clicking a `#` beside a play; this is only for the one they arrived on.
 */

/** The one fragment shape the section mints: a play's `sequence` within its game. */
export const PLAY_HASH_RE = /^#play-(\d+)$/

export const ENTRY_HASH = typeof window === 'undefined' ? '' : window.location.hash
export const ENTRY_PATH = typeof window === 'undefined' ? '' : window.location.pathname

/** The sequence a fragment names, or null when it is not one of ours. */
export function playHashSequence(hash: string): number | null {
  const m = PLAY_HASH_RE.exec(hash ?? '')
  return m ? Number(m[1]) : null
}

/**
 * A play asked for from inside the app, which no fragment can carry.
 *
 * An in-app open of a game (a Find row for one inning) rewrites the address without a fragment, for
 * the reason at the top of this file, so `#play-N` on its href would reach a new tab and nothing
 * else. The opener leaves the play here instead and Game Center takes it once, as it mounts, the way
 * it reads ENTRY_HASH: keyed to the game, so a request can never land on a different one, and
 * used up a moment after it is first taken, so opening the same game again later starts where any
 * game starts.
 */
let requestedPlay: { gameId: string; hash: string; box: BoxSide | null; takenAt: number | null } | null = null

/** Which club's box score a game opens on. */
export type BoxSide = 'away' | 'home'

/** How long a taken request still answers the same game. Game Center can mount twice as it opens
 *  (the remount above), and a link from search reached it that way: the first mount took the play
 *  and the second opened on the Recap (Nov 9, 2026). A reader who closes the game and opens it again
 *  takes longer than this. */
const REMOUNT_MS = 3000

export function requestPlay(gameId: string, sequence: number): void {
  requestedPlay = { gameId, hash: `#play-${sequence}`, box: null, takenAt: null }
}

/**
 * A game opened from a stat, at the box score that holds the line, on the club that line was for.
 *
 * A FINAL OPENS ON ITS RECAP, which is right for a game looked up as a game (a score, the schedule,
 * "Firebells last game") and wrong for one reached through a number: a reader who tapped "4 HR" on
 * Bests or a row on Find came for that line, and the Recap made them find the Box Score tab and then
 * the right club. The same one-shot, game-keyed hand-off as `requestPlay`; a link that leaves the app
 * carries `?tab=box` (and `&side=home`) instead, which a cold open already reads.
 */
export function requestBoxScore(gameId: string, side: BoxSide): void {
  requestedPlay = { gameId, hash: '', box: side, takenAt: null }
}

/** What a game opens on: a play or a box score asked for in-app for this game, or else the entry's
 *  fragment. */
export function takeOpening(gameId: string, now = Date.now()): { hash: string; box: BoxSide | null } {
  const r = requestedPlay
  const live = r && r.gameId === gameId && (r.takenAt == null || now - r.takenAt < REMOUNT_MS)
  if (!live) { requestedPlay = null; return { hash: ENTRY_HASH, box: null } }
  r.takenAt ??= now
  return { hash: r.hash, box: r.box }
}

/** The fragment a game opens on (`takeOpening`'s hash). */
export function takeOpeningPlayHash(gameId: string, now = Date.now()): string {
  return takeOpening(gameId, now).hash
}

/** The box score of `teamId`'s side of `game`, for a line from that game: the side, and the query a
 *  link to the game carries for a new tab. */
export function boxScoreOf(game: { home_team_id: string }, teamId: string | null): { side: BoxSide; query: string } {
  const side: BoxSide = teamId != null && teamId === game.home_team_id ? 'home' : 'away'
  return { side, query: side === 'home' ? '?tab=box&side=home' : '?tab=box' }
}

/**
 * The entry fragment, re-attached to the one URL it belongs to.
 *
 * PATH-MATCHED SO IT CANNOT LEAK. A fragment naming a play means nothing on Standings and less
 * than nothing on somebody's player page, so it rides only the URL it arrived on. Open a
 * different game, or a player, or walk to another tab, and the path stops matching and the
 * fragment is gone for the rest of the session, which is exactly what navigating away from a
 * play means.
 */
export function playFragmentFor(path: string): string {
  return PLAY_HASH_RE.test(ENTRY_HASH) && path === ENTRY_PATH ? ENTRY_HASH : ''
}
