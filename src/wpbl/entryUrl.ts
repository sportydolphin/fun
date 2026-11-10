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
 * consumed, so opening the same game again later starts where any game starts.
 */
let requestedPlay: { gameId: string; hash: string } | null = null

export function requestPlay(gameId: string, sequence: number): void {
  requestedPlay = { gameId, hash: `#play-${sequence}` }
}

/** The fragment a game opens on: one asked for in-app for this game, or else the entry's. */
export function takeOpeningPlayHash(gameId: string): string {
  const asked = requestedPlay?.gameId === gameId ? requestedPlay.hash : null
  requestedPlay = null
  return asked ?? ENTRY_HASH
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
