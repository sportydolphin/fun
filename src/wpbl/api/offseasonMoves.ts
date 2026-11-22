import { supabase } from '../../lib/supabase'
import type { WpblRosterMove } from '../types'
import { safe, once, isFreshSlow, ownerWrite } from './core'

// Roster moves (wpbl_roster_moves): the re-signings and trades, and later the draft and free agency, recorded
// by hand from /admin. One small table, read whole: a season is at most a few dozen rows per club.

let movesCache: { data: WpblRosterMove[]; at: number } | null = null

export function getCachedWpblRosterMoves(): WpblRosterMove[] | null { return movesCache?.data ?? null }

// THIS BROWSER'S LAST READ, kept only as a shape hint for the rosters page's loading state: which
// players a move has placed decides where every row below it lands, and nothing else can
// know that before the read. Never drawn as data. Missing, unreadable or blocked storage just
// means a first visit's shape (nobody re-signed).
const STORE_KEY = 'sd:wpbl-roster-moves'

export function getStoredWpblRosterMoves(): WpblRosterMove[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    return Array.isArray(v) ? (v as WpblRosterMove[]) : null
  } catch { return null }
}

function storeMoves(data: WpblRosterMove[]) {
  // A failed read also answers [], so an empty answer never replaces a good snapshot.
  if (!data.length) return
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)) } catch { /* storage off or full */ }
}

/** Fired after an owner write, so an open rosters page or player card redraws without a reload. */
export const ROSTER_MOVES_CHANGED_EVENT = 'wpbl:roster-moves-changed'

const COLUMNS = 'id,season,kind,player_id,player_name,team_id,from_team_id,trade_id,draft_round,draft_pick,announced_on,source_url'

export function fetchWpblRosterMoves(): Promise<WpblRosterMove[]> {
  if (isFreshSlow(movesCache)) return Promise.resolve(movesCache!.data)
  return once('rosterMoves', async () => {
    const data = await safe('fetchWpblRosterMoves', () =>
      supabase.from('wpbl_roster_moves').select(COLUMNS)
        .order('announced_on', { ascending: false })
        .order('id', { ascending: false }),
      [] as WpblRosterMove[])
    // An empty table is the ordinary state on the window's first morning, so it is cached like any
    // other answer; a failed read also returns [], and the next mount simply asks again.
    movesCache = { data, at: Date.now() }
    storeMoves(data)
    return data
  })
}

function changed() {
  movesCache = null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ROSTER_MOVES_CHANGED_EVENT))
}

export type NewRosterMove = Omit<WpblRosterMove, 'id'>

export async function saveWpblRosterMove(move: NewRosterMove): Promise<boolean> {
  const ok = await ownerWrite('saveWpblRosterMove', () => supabase.from('wpbl_roster_moves').insert(move))
  if (ok) changed()
  return ok
}

export async function deleteWpblRosterMove(id: number): Promise<boolean> {
  const ok = await ownerWrite('deleteWpblRosterMove', () => supabase.from('wpbl_roster_moves').delete().eq('id', id))
  if (ok) changed()
  return ok
}
