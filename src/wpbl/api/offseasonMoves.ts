import { supabase } from '../../lib/supabase'
import type { WpblRosterMove } from '../types'
import { safe, once, isFreshSlow, ownerWrite } from './core'

// Roster moves (wpbl_roster_moves): the re-signings, and later the draft and free agency, recorded
// by hand from /admin. One small table, read whole: a season is at most a few dozen rows per club.

let movesCache: { data: WpblRosterMove[]; at: number } | null = null

export function getCachedWpblRosterMoves(): WpblRosterMove[] | null { return movesCache?.data ?? null }

/** Fired after an owner write, so an open rosters page or player card redraws without a reload. */
export const ROSTER_MOVES_CHANGED_EVENT = 'wpbl:roster-moves-changed'

const COLUMNS = 'id,season,kind,player_id,player_name,team_id,draft_round,draft_pick,announced_on,source_url'

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
