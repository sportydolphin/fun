import { describe, it, expect } from 'vitest'
import { buildFraudRows } from '../components/reportCardRows'
import type { TeamSummary } from '../types'

const team = (id: number, abbr: string, wins: number, losses: number, rs: number, ra: number): TeamSummary =>
  ({ id, abbr, ops: 0.7, era: 4, rs, ra, wins, losses })

describe('Wins Above Expected', () => {
  // The Oct 21, 2026 board: Rays +8 over Reds +10, because the sort weighted the gap by win%.
  it('ranks by the gap printed on the row, not a hidden score', () => {
    const rays = team(1, 'TB', 98, 64, 760, 680)
    const reds = team(2, 'CIN', 75, 87, 620, 720)
    const rows = buildFraudRows([rays, reds], new Map(), 'fraud')
    const gap = (r: { value: string }) => Number(r.value.replace(/[^\d]/g, ''))
    expect(gap(rows[0])).toBeGreaterThanOrEqual(gap(rows[1]))
    expect(rows[0].barFraction).toBe(1)
  })
})
