import { describe, it, expect } from 'vitest'
import raw2026 from './fixtures/postseason-2026.json'
import { buildBracket, championPath, postseasonLikelyOver } from '../postseason'
import { postseasonBoards, AVG_MIN_PA, ERA_MIN_IP } from '../postseasonLeaders'

const split = (id: number, stat: Record<string, unknown>) => ({ player: { id, fullName: `Player ${id}` }, team: { id: 158 }, stat })
const read = (...splits: unknown[]) => ({ stats: [{ splits }] })

describe('postseasonBoards', () => {
  const none = read()

  it('ranks counting stats high to low, and leaves out players with none', () => {
    const hr = postseasonBoards(read(split(1, { homeRuns: 1 }), split(2, { homeRuns: 4 }), split(3, { homeRuns: 0 })), none)
      .find(b => b.key === 'hr')!
    expect(hr.rows.map(r => [r.id, r.value])).toEqual([[2, '4'], [1, '1']])
  })

  it('holds a batting average to its minimum', () => {
    const avg = postseasonBoards(read(
      split(1, { avg: '1.000', plateAppearances: AVG_MIN_PA - 1 }),
      split(2, { avg: '.300', plateAppearances: AVG_MIN_PA }),
    ), none).find(b => b.key === 'avg')!
    expect(avg.rows.map(r => r.id)).toEqual([2])
    expect(avg.info).toContain(String(AVG_MIN_PA))
  })

  // Zero is the best ERA there is, so it must rank first rather than count as nothing.
  it('ranks ERA low to high, with a scoreless pitcher first', () => {
    const era = postseasonBoards(none, read(
      split(1, { era: '2.16', inningsPitched: '16.2' }),
      split(2, { era: '0.00', inningsPitched: String(ERA_MIN_IP) }),
      split(3, { era: '0.00', inningsPitched: '9.2' }),
    )).find(b => b.key === 'era')!
    expect(era.rows.map(r => r.id)).toEqual([2, 1])
  })

  it('stops at five rows', () => {
    const k = postseasonBoards(none, read(...[1, 2, 3, 4, 5, 6].map(i => split(i, { strikeOuts: i })))).find(b => b.key === 'k')!
    expect(k.rows.map(r => r.id)).toEqual([6, 5, 4, 3, 2])
  })

  it('draws six empty boards from a read with no splits', () => {
    expect(postseasonBoards(none, none).map(b => b.rows.length)).toEqual([0, 0, 0, 0, 0, 0])
    expect(postseasonBoards({}, {}).map(b => b.key)).toEqual(['hr', 'rbi', 'avg', 'k', 'era', 'sv'])
  })
})

describe('championPath', () => {
  it('is empty before there is a champion', () => {
    const b = buildBracket(2026, raw2026)!
    const noWinner = { ...b, series: { ...b.series, W_1: { ...b.series.W_1, winnerId: null } } }
    expect(championPath(noWinner)).toEqual([])
  })

  it('walks the champion through its rounds in order, wins first', () => {
    const b = buildBracket(2026, raw2026)!
    const champ = b.series.L_1.top.id
    const series = Object.fromEntries(Object.entries(b.series).map(([id, s]) => [id, { ...s, winnerId: null as number | null }])) as typeof b.series
    series.D_1 = { ...series.D_1, top: { ...series.D_1.top, id: champ }, winnerId: champ, winsTop: 3, winsBottom: 1 }
    series.L_1 = { ...series.L_1, winnerId: champ, winsTop: 4, winsBottom: 2 }
    series.W_1 = { ...series.W_1, top: { ...series.W_1.top, id: champ }, winnerId: champ, winsTop: 4, winsBottom: 3 }
    const path = championPath({ ...b, series })
    expect(path.map(p => [p.series.id, p.wins, p.losses])).toEqual([['D_1', 3, 1], ['L_1', 4, 2], ['W_1', 4, 3]])
  })
})

describe('postseasonLikelyOver', () => {
  const at = (s: string) => new Date(`${s}T12:00:00`)
  it('follows the calendar for the current season', () => {
    expect(postseasonLikelyOver(2026, 2026, at('2026-10-14'))).toBe(false)
    expect(postseasonLikelyOver(2026, 2026, at('2026-10-30'))).toBe(true)
    expect(postseasonLikelyOver(2026, 2026, at('2027-01-15'))).toBe(true)
  })
  it('knows an earlier season is over and a later one is not', () => {
    expect(postseasonLikelyOver(2025, 2026, at('2026-06-01'))).toBe(true)
    expect(postseasonLikelyOver(2027, 2026, at('2026-12-01'))).toBe(false)
  })
})
