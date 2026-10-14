// One game as a search row, worded the same in both sections: "SF 6 at NY 4", "Final · Sep 9, 2026".
// Here rather than in either section because each builds its own rows from its own schedule, and
// neither imports the other.

import type { CompareRow } from '../mlb/state/SearchBridgeContext'

export interface GameRowInput {
  away: string
  home: string
  awayScore: number | null
  homeScore: number | null
  state: 'final' | 'live' | 'scheduled'
  /** 'YYYY-MM-DD', the day the schedule lists it on. */
  date: string
  href: string
}

/** "Sep 9, 2026", read as a calendar day so no zone can move it to the 8th. */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function gameRow(g: GameRowInput): CompareRow {
  const scored = g.state !== 'scheduled' && g.awayScore != null && g.homeScore != null
  return {
    title: scored ? `${g.away} ${g.awayScore} at ${g.home} ${g.homeScore}` : `${g.away} at ${g.home}`,
    subtitle: `${g.state === 'final' ? 'Final' : g.state === 'live' ? 'Live' : 'Scheduled'} · ${shortDay(g.date)}`,
    href: g.href,
  }
}
