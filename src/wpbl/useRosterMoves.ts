import { useEffect, useState } from 'react'
import { fetchWpblRosterMoves, getCachedWpblRosterMoves, ROSTER_MOVES_CHANGED_EVENT } from './api'
import { rosterStatus, ROSTER_SEASON, club2026 } from './offseason2027'
import type { WpblRosterMove } from './types'

/** Every recorded roster move, null until the first read lands; redraws after an owner write. */
export function useWpblRosterMoves(enabled = true): WpblRosterMove[] | null {
  const [moves, setMoves] = useState<WpblRosterMove[] | null>(() => getCachedWpblRosterMoves())
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const read = () => { fetchWpblRosterMoves().then(m => { if (!cancelled) setMoves(m) }) }
    read()
    window.addEventListener(ROSTER_MOVES_CHANGED_EVENT, read)
    return () => { cancelled = true; window.removeEventListener(ROSTER_MOVES_CHANGED_EVENT, read) }
  }, [enabled])
  return moves
}

/**
 * The player card's line about next season, for a player on a 2026 roster. Its label is there from
 * the first paint and only the value waits on the read ("—" until then), so the band never grows a
 * line under the reader. Null for anyone the league did not list, and before the window opens.
 */
export function rosterFact(playerId: string, moves: readonly WpblRosterMove[] | null, now: number):
  { label: string; value: string; inline: string } | null {
  if (!club2026(playerId)) return null
  const label = String(ROSTER_SEASON)
  const status = rosterStatus(playerId, moves ?? [], now)
  if (!status) return null
  if (moves == null) return { label, value: '—', inline: `${label}: …` }
  const value = status.kind === 're-signed' ? 'Re-signed'
    : status.kind === 'unsigned' ? 'Not yet re-signed'
      : 'Draft eligible'
  return { label, value, inline: `${label}: ${value.charAt(0).toLowerCase()}${value.slice(1)}` }
}
