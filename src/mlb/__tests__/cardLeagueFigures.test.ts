import { describe, it, expect } from 'vitest'
import { cardLeagueFigures } from '../lib/advanced'
import type { LeaderboardEntry } from '../types'

// The player card's League avg row. Pinned: every rate has a figure, the counts have none, and the
// plate discipline rates are the league's pitches, swings and misses, the same for both sides.

const entry = (playerId: number, stat: Record<string, unknown>) => ({ playerId, stat }) as unknown as LeaderboardEntry
const hitters = [
  entry(1, { plateAppearances: 600, atBats: 540, hits: 150, doubles: 30, triples: 3, homeRuns: 25, baseOnBalls: 50, strikeOuts: 120, hitByPitch: 5, sacFlies: 5 }),
  entry(2, { plateAppearances: 500, atBats: 450, hits: 110, doubles: 20, triples: 1, homeRuns: 10, baseOnBalls: 40, strikeOuts: 100, hitByPitch: 5, sacFlies: 5 }),
]
const pitchers = [
  entry(3, { inningsPitched: '180.0', earnedRuns: 70, hits: 160, baseOnBalls: 50, strikeOuts: 190, homeRuns: 20, hitBatsmen: 5, battersFaced: 740, atBats: 670, sacFlies: 5, strikes: 1900, numberOfPitches: 2900 }),
]
const swings = { misses: 2500, swings: 10000, pitches: 21000, pa: 5400 }

describe('cardLeagueFigures', () => {
  it('fills every hitting rate from the pool, and nothing for a count', () => {
    const f = cardLeagueFigures(hitters, 'hitting', { avg: '.263', obp: '.330', slg: '.420', ops: '.750' }, null, swings)
    expect(f.AVG).toBe('.263')
    expect(f.ISO).toMatch(/^\.\d{3}$/)
    expect(f['K%']).toMatch(/%$/)
    expect(f.HR).toBeUndefined()
    // No sabermetrics read (the playoffs): no league wOBA rather than a guessed one.
    expect(f.wOBA).toBeUndefined()
  })

  it('reads plate discipline off the league\'s pitches, swings and misses', () => {
    const f = cardLeagueFigures(hitters, 'hitting', null, null, swings)
    expect(f['P/PA']).toBe('3.89')
    expect(f['Swing%']).toBe('47.6%')
    expect(f['Whiff%']).toBe('25.0%')
    expect(f['Contact%']).toBe('75.0%')
    expect(f['SwStr%']).toBe('11.9%')
    const p = cardLeagueFigures(pitchers, 'pitching', null, null, swings)
    expect(p['Whiff%']).toBe(f['Whiff%'])
    expect(p['Strike%']).toBe('65.5%')
  })

  it('centers FIP and xFIP on the league ERA, and ERA- on 100', () => {
    const p = cardLeagueFigures(pitchers, 'pitching', { era: '3.50', whip: '1.17' }, null, null)
    expect(p.FIP).toBe('3.50')
    expect(p.xFIP).toBe('3.50')
    expect(p['ERA-']).toBe('100')
    expect(p['P/PA']).toBeUndefined()
  })
})
