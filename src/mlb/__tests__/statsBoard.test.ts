import { describe, it, expect } from 'vitest'
import { HITTING_STAT_DEFS, PITCHING_STAT_DEFS } from '../constants'
import { sortBoard, rankMarks, contextKeys, isBestFirst, ascFor } from '../lib/statsBoard'
import type { LeaderboardEntry } from '../types'

const hit = (key: string) => HITTING_STAT_DEFS.find(d => d.key === key)!
const pit = (key: string) => PITCHING_STAT_DEFS.find(d => d.key === key)!
const entry = (id: number, stat: Record<string, unknown>): LeaderboardEntry =>
  ({ playerId: id, playerName: `Player ${id}`, teamAbbr: 'BOS', teamId: 111, stat })

describe('rankMarks', () => {
  it('shares a place between equal values and skips the places it used', () => {
    const marks = rankMarks([40, 38, 38, 35])
    expect(marks.map(m => m.n)).toEqual([1, 2, 2, 4])
    expect(marks.map(m => m.tied)).toEqual([false, true, true, false])
  })

  it('marks nobody tied on a board with no repeats', () => {
    expect(rankMarks([3, 2, 1]).every(m => !m.tied)).toBe(true)
  })

  it('ties the leaders too, which a list that prints "1" twice would otherwise hide', () => {
    expect(rankMarks([50, 50, 49]).map(m => `${m.tied ? 'T-' : ''}${m.n}`)).toEqual(['T-1', 'T-1', '3'])
  })
})

describe('sortBoard', () => {
  it('puts the high end first by default and drops rows with no value', () => {
    const rows = sortBoard([
      entry(1, { homeRuns: 20 }), entry(2, { homeRuns: 45 }), entry(3, { homeRuns: undefined }), entry(4, { homeRuns: 31 }),
    ], hit('hr'), false)
    expect(rows.map(r => r.playerId)).toEqual([2, 4, 1])
  })

  it('ranks W-L on wins, not on the "12-5" string it displays', () => {
    const rows = sortBoard([
      entry(1, { wins: 9, losses: 2 }), entry(2, { wins: 14, losses: 9 }),
    ], pit('wl'), false)
    expect(rows.map(r => r.playerId)).toEqual([2, 1])
    expect(rows[0]._v).toBe(14)
  })

  it('puts the small end first for ERA when asked for best first', () => {
    const def = pit('era')
    const rows = sortBoard([entry(1, { era: '3.50' }), entry(2, { era: '2.10' })], def, ascFor(def, true))
    expect(rows.map(r => r.playerId)).toEqual([2, 1])
  })
})

describe('direction', () => {
  it('calls the small end best for a lower-is-better stat and the large end best otherwise', () => {
    expect(isBestFirst(pit('era'), true)).toBe(true)
    expect(isBestFirst(pit('era'), false)).toBe(false)
    expect(isBestFirst(hit('ops'), false)).toBe(true)
    expect(isBestFirst(hit('ops'), true)).toBe(false)
  })

  it('round-trips through ascFor', () => {
    for (const def of [...HITTING_STAT_DEFS, ...PITCHING_STAT_DEFS]) {
      for (const best of [true, false]) expect(isBestFirst(def, ascFor(def, best))).toBe(best)
    }
  })
})

describe('contextKeys', () => {
  it('never repeats the stat that is already the big number', () => {
    expect(contextKeys('hitting', 'ops')).not.toContain('ops')
    expect(contextKeys('pitching', 'era')).not.toContain('era')
  })

  it('gives three supporting stats for every sort the sheet offers', () => {
    for (const d of HITTING_STAT_DEFS) expect(contextKeys('hitting', d.key)).toHaveLength(3)
    for (const d of PITCHING_STAT_DEFS) expect(contextKeys('pitching', d.key)).toHaveLength(3)
  })

  it('only names stats the board actually has', () => {
    const hitKeys = new Set(HITTING_STAT_DEFS.map(d => d.key))
    const pitKeys = new Set(PITCHING_STAT_DEFS.map(d => d.key))
    for (const k of contextKeys('hitting', 'avg')) expect(hitKeys.has(k)).toBe(true)
    for (const k of contextKeys('pitching', 'k')) expect(pitKeys.has(k)).toBe(true)
  })
})
