// What the header search knew last time, kept in this browser so the next visit can answer the
// first letter typed before the roster read lands.
//
// WHY NOT A GENERATED FILE. A nightly `search-index.json` would be a second copy of the roster
// that is up to a day behind: a signing would be missing from search until the cron ran, on a
// site where the roster read is already served from Cloudflare's cache. This copy is the reader's
// own last answer instead, and the live roster replaces it the moment it arrives, so the worst it
// can be is one visit stale, and only for the second or so before the read lands.
//
// THE POSITIONS ride along because they are the expensive part: on a first search they can cost
// the season's every box-score line (~340KB), and a reader who comes back gets them for free.
//
// Every read and write is guarded: private modes and blocked storage throw, and the cost of that
// is only the wait this module exists to skip.

import type { PrimaryPosition } from './positions'
import type { WpblPlayer, WpblTeam } from './types'

// Bump when WpblPlayer, WpblTeam or PrimaryPosition change shape, so an old copy is dropped rather
// than handed to a row builder that expects a field it lacks.
const KEY = 'sd:wpblSearchIndex:v1'

export interface WpblSearchIndex {
  players: WpblPlayer[]
  teams: WpblTeam[]
  positions: [string, PrimaryPosition][]
  /** The current season's WAR leaders, the empty box's suggestions, best first. */
  leaders: string[]
}

export const EMPTY_SEARCH_INDEX: WpblSearchIndex = { players: [], teams: [], positions: [], leaders: [] }

/** The copy from the last visit, or the empty index when there is none (or it is unreadable). */
export function readSearchIndex(): WpblSearchIndex {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_SEARCH_INDEX
    const v = JSON.parse(raw) as Partial<WpblSearchIndex>
    // A copy half written by a build that crashed, or edited by hand, must not reach the rows.
    if (!Array.isArray(v.players) || !Array.isArray(v.teams) || !Array.isArray(v.positions)) return EMPTY_SEARCH_INDEX
    // `leaders` came after the first copies were written, so a copy without it is still good.
    return { players: v.players, teams: v.teams, positions: v.positions, leaders: Array.isArray(v.leaders) ? v.leaders : [] }
  } catch {
    return EMPTY_SEARCH_INDEX
  }
}

/** Keeps the live answer for next time. Never writes an empty roster: a failed read would
 *  otherwise erase the copy that would have covered the next one. */
export function saveSearchIndex(index: WpblSearchIndex): void {
  if (!index.players.length || !index.teams.length) return
  try { localStorage.setItem(KEY, JSON.stringify(index)) } catch { /* storage full or blocked */ }
}
