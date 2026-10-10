import { describe, it, expect, vi, afterEach } from 'vitest'
import { withAdvanced } from '../lib/advanced'
import { fetchParkFactors } from '../apiSeasonStats'
import type { LeaderboardEntry } from '../types'

const hitter = (playerId: number, teamId: number, stat: object): LeaderboardEntry =>
  ({ playerId, playerName: String(playerId), teamAbbr: '', teamId, stat })
const line = { plateAppearances: 600, atBats: 520, hits: 150, doubles: 30, triples: 3, homeRuns: 25, baseOnBalls: 60, hitByPitch: 5, sacFlies: 5, strikeOuts: 120 }

describe('park-adjusted OPS+ and ERA+', () => {
  it('divides OPS+ and multiplies ERA+ by the club factor, and a missing club is neutral', () => {
    const pool = [hitter(1, 115, line), hitter(2, 136, line)]
    const raw = withAdvanced(pool, 'hitting', null, null)
    const adj = withAdvanced(pool, 'hitting', null, new Map([[115, 1.12]]))
    expect(adj[0].stat.opsPlus).toBeCloseTo(raw[0].stat.opsPlus / 1.12, 9)
    expect(adj[1].stat.opsPlus).toBe(raw[1].stat.opsPlus)

    const arm = (id: number, team: number, era: string) => hitter(id, team, { era, inningsPitched: '100.0', earnedRuns: Number(era) * 100 / 9 })
    const arms = [arm(3, 115, '3.00'), arm(4, 136, '5.00')]
    const rawP = withAdvanced(arms, 'pitching', null, null)
    const adjP = withAdvanced(arms, 'pitching', null, new Map([[115, 1.12]]))
    expect(adjP[0].stat.eraPlus).toBeCloseTo(rawP[0].stat.eraPlus * 1.12, 9)
  })

  // Painted unadjusted and then replaced is a number that changes under the reader.
  it('leaves both indexes blank while the factors are pending', () => {
    const [h] = withAdvanced([hitter(1, 115, line)], 'hitting', null, 'pending')
    expect(h.stat.opsPlus).toBeUndefined()
    expect(h.stat.iso).toBeDefined()
  })
})

describe('fetchParkFactors', () => {
  afterEach(() => vi.unstubAllGlobals())
  const split = (id: number, code: 'h' | 'a', runs: number) => ({ team: { id }, split: { code }, stat: { runs, gamesPlayed: 81 } })

  it('halves the home/road run ratio, summed over three years', async () => {
    // Club 1 scores and allows 6 a game at home against 4 on the road: PF 1.5, halved 1.25.
    const body = { stats: [{ totalSplits: 2, splits: [split(1, 'h', 243), split(1, 'a', 162)] }] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => body })))
    const map = await fetchParkFactors(2101)
    expect(map.get(1)).toBeCloseTo(1.25, 9)
  })

  // StatsAPI's silent 50-row cap: a read that does not match its own total is not a year of data.
  it('drops a year whose splits fall short of the total', async () => {
    const good = { stats: [{ totalSplits: 2, splits: [split(1, 'h', 243), split(1, 'a', 162)] }] }
    const short = { stats: [{ totalSplits: 60, splits: [split(1, 'h', 999)] }] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ json: async () => (url.includes('season=2201') ? good : short) })))
    const map = await fetchParkFactors(2201)
    expect(map.get(1)).toBeCloseTo(1.25, 9)
  })
})
