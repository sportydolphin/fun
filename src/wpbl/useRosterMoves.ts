import { useEffect, useState } from 'react'
import { fetchWpblRosterMoves, getCachedWpblRosterMoves, ROSTER_MOVES_CHANGED_EVENT } from './api'
import { rosterStatus, ROSTER_SEASON, UNPLACED_LABELS, club2026, CLUB_CITIES, type RosterStatus } from './offseason2027'
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

function factValue(status: RosterStatus): string {
  const city = CLUB_CITIES[status.teamId] ?? status.teamId
  switch (status.kind) {
    case 're-signed': return 'Re-signed'
    case 'traded': return `Traded to ${city}`
    case 'drafted': return `Drafted by ${city}`
    case 'signed': return `Signed with ${city}`
    case 'released': return `Released by ${city}`
    default: return UNPLACED_LABELS[status.kind]
  }
}

/**
 * The player card's line about next season. For a player on a 2026 roster its label is there from
 * the first paint and only the value waits on the read ("—" until then), so the band never grows a
 * line under the reader. Anyone else has a line only once a move names them, so before the read
 * `stored` (this browser's last one) is the only hint that there will be one. Null before the
 * window opens.
 */
export function rosterFact(
  playerId: string, moves: readonly WpblRosterMove[] | null, now: number, stored?: readonly WpblRosterMove[] | null,
): { label: string; value: string; inline: string } | null {
  const label = String(ROSTER_SEASON)
  const status = rosterStatus(playerId, moves ?? (club2026(playerId) ? [] : stored ?? []), now)
  if (!status) return null
  if (moves == null) return { label, value: '—', inline: `${label}: …` }
  const value = factValue(status)
  return { label, value, inline: `${label}: ${value.charAt(0).toLowerCase()}${value.slice(1)}` }
}
