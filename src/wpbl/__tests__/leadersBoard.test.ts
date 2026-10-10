import { describe, it, expect } from 'vitest'
import { leadersFor, type LeaderCol, type LeaderSeason } from '../LeadersBoard'
import type { WpblBattingTotals } from '../stats'
import type { WpblPlayer } from '../types'

const player = (id: string) => ({ id, name: `Player ${id}`, team_id: 'SF' } as WpblPlayer)
// Only the fields these columns and `plateAppearances` read.
const season = (id: string, t: Partial<WpblBattingTotals>): LeaderSeason<WpblBattingTotals> => ({
  player: player(id),
  totals: { ab: 0, bb: 0, hbp: 0, sf: 0, sh: 0, hr: 0, avg: null, ...t } as WpblBattingTotals,
})
const AVG: LeaderCol<WpblBattingTotals> = { key: 'avg', label: 'AVG', value: t => t.avg, display: t => (t.avg ?? 0).toFixed(3).replace(/^0/, ''), rate: true }
const HR: LeaderCol<WpblBattingTotals> = { key: 'hr', label: 'HR', value: t => t.hr }
const QUAL = { active: true, minPa: 10, minOuts: 30 }

describe('leadersFor', () => {
  it('ranks a rate among qualifiers only, by plate appearances', () => {
    const rows = leadersFor([
      season('cameo', { ab: 2, avg: 1 }),           // 2 PA: under the bar
      season('regular', { ab: 40, avg: 0.3 }),
      season('walker', { ab: 6, bb: 6, avg: 0.5 }), // 12 PA on 6 AB: over a PA bar, under an AB one
    ], AVG, 'hitting', QUAL)
    expect(rows.map(r => r.player.id)).toEqual(['walker', 'regular'])
  })

  it('ranks a counting stat among everyone, and leaves out whoever has none', () => {
    const rows = leadersFor([
      season('cameo', { ab: 2, hr: 2 }),
      season('regular', { ab: 40, hr: 1 }),
      season('none', { ab: 40, hr: 0 }),
    ], HR, 'hitting', QUAL)
    expect(rows.map(r => r.player.id)).toEqual(['cameo', 'regular'])
  })

  it('shares a rank between two values that print the same', () => {
    const rows = leadersFor([
      season('a', { ab: 40, hr: 5 }), season('b', { ab: 30, hr: 5 }), season('c', { ab: 40, hr: 3 }),
    ], HR, 'hitting', QUAL)
    expect(rows.map(r => r.rank)).toEqual([1, 1, 3])
    // The tie breaks toward the bigger sample.
    expect(rows[0].player.id).toBe('a')
  })

  it('shows five', () => {
    const rows = leadersFor(Array.from({ length: 9 }, (_, i) => season(String(i), { ab: 40, hr: i + 1 })), HR, 'hitting', QUAL)
    expect(rows).toHaveLength(5)
  })
})
