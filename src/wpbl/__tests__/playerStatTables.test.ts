import { describe, it, expect } from 'vitest'
import { wpblRoleTables, seasonLead, type WpblTablesInput } from '../player/statTables'
import { hittingColumns, pitchingColumns, leagueLine } from '../statColumns'
import { sumBatting, sumPitching, fmtTwo } from '../stats'
import type { WobaWeights } from '../derive/linearWeights'
import type { WpblValueTotals } from '../derive/playerValue'
import type { WpblBoard } from '../searchAnswers'
import type { WpblBattingLine, WpblGame, WpblPitchingLine } from '../types'

// The player card's season tables. What is pinned is what a reader would catch only by holding the
// card against the Stats table: that every figure is the table's own column over the same totals
// and the same league, that WAR is the board's and only on the regular season, and that a figure
// still being read is a sample rather than a dash that turns into a number.

const GAMES = Array.from({ length: 4 }, (_, i) => ({
  id: `g${i}`, game_date: `2026-08-0${i + 1}`, game_type: 'regular', counts_in_standings: true, status: 'final',
})) as unknown as WpblGame[]

const bat = (player_id: string, over: Partial<WpblBattingLine>): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id, team_id: 'SF', batting_order: 1, position: 'CF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...over,
} as WpblBattingLine)
const pit = (player_id: string, over: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g0', player_id, team_id: 'SF',
  outs: 0, bf: null, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: null, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0, ...over,
} as WpblPitchingLine)

const mine = [bat('p1', { ab: 30, h: 12, doubles: 3, hr: 2, bb: 5, r: 8, tb: 21 })]
const leagueBat = [...mine, bat('p2', { ab: 40, h: 10, bb: 4, r: 5, tb: 14 }), bat('p3', { ab: 35, h: 9, hr: 1, bb: 2, r: 4, tb: 13 })]
const minePit = [pit('p1', { outs: 30, er: 4, h: 9, bb: 3, so: 12, hr: 1, gs: 2 })]
const leaguePit = [...minePit, pit('p2', { outs: 27, er: 6, h: 11, bb: 5, so: 8, hr: 2 })]

const W: WobaWeights = { bb: 0.7, hbp: 0.72, single: 0.9, double: 1.25, triple: 1.6, hr: 2.0, n: { bb: 1, hbp: 1, single: 1, double: 1, triple: 1, hr: 1, out: 1 } }
const F = { hr: 13, bb: 3, k: 2 }
const value = { war: 1.234, batWar: 1.0, pitWar: 0.234, bat: 3.2, fld: -0.4, pa: 35, outs: 30 } as unknown as WpblValueTotals
const board = { weights: { woba: W, fip: F }, value: new Map([['p1', value]]) } as unknown as WpblBoard
const fmtEra = (v: number | null) => fmtTwo(v)

const input = (over: Partial<WpblTablesInput> = {}): WpblTablesInput => ({
  bt: sumBatting(mine, GAMES), pt: sumPitching(minePit, GAMES),
  league: leagueLine(leagueBat, leaguePit, GAMES, 'regular'),
  board, playerId: 'p1', scope: 'regular', twoWay: false, value: null, valueOn: false,
  leadsWithSaves: false, rankFor: () => null, fmtEra, eraBasis: 7,
  ...over,
})
const byLabel = (cols: { label: string }[]) => Object.fromEntries(cols.map(c => [c.label, c])) as Record<string, ReturnType<typeof wpblRoleTables>['summary'][number]>

describe('wpblRoleTables', () => {
  it('is the line a reader expects, in that order', () => {
    expect(wpblRoleTables('batting', input()).summary.map(c => c.label))
      .toEqual(['G', 'PA', 'HR', 'AVG', 'OBP', 'SLG', 'OPS', 'wOBA', 'wRC+', 'WAR'])
    expect(wpblRoleTables('pitching', input()).summary.map(c => c.label))
      .toEqual(['G', 'GS', 'IP', 'W-L', 'ERA', 'WHIP', 'SO', 'BB', 'FIP', 'WAR'])
    expect(wpblRoleTables('pitching', input({ leadsWithSaves: true })).summary[3].label).toBe('SV')
  })

  it('prints the Stats table\'s own columns over the same totals and league', () => {
    const i = input()
    const ctx = { league: i.league!, wWeights: W, fWeights: F, fmtEra, eraBasis: 7 as const }
    const h = byLabel(wpblRoleTables('batting', i).summary)
    const cols = hittingColumns(ctx)
    const col = (k: string) => cols.find(c => c.key === k)!
    expect(h['wOBA'].value).toBe(col('woba').display!(i.bt))
    expect(h['wRC+'].value).toBe(col('wrcPlus').display!(i.bt))
    expect(h['wOBA'].value).not.toBe('—')
    const p = byLabel(wpblRoleTables('pitching', i).summary)
    expect(p['FIP'].value).toBe(pitchingColumns(ctx).find(c => c.key === 'fip')!.display!(i.pt))
  })

  it('puts the league on the rates only, where wRC+ is 100 by construction', () => {
    const h = byLabel(wpblRoleTables('batting', input()).summary)
    expect(h['wRC+'].league).toBe('100')
    expect(h['AVG'].league).toMatch(/^\.\d{3}$/)
    expect(h['HR'].league).toBeNull()
    expect(h['WAR'].league).toBeUndefined()
  })

  it('reads WAR off the board, the role\'s own side on a two-way card, regular season only', () => {
    expect(byLabel(wpblRoleTables('batting', input()).summary)['WAR'].value).toBe('1.23')
    const two = byLabel(wpblRoleTables('batting', input({ twoWay: true })).summary)
    expect(two['Pos WAR'].value).toBe('1.00')
    expect(byLabel(wpblRoleTables('pitching', input({ twoWay: true })).summary)['Pit WAR'].value).toBe('0.23')
    expect(byLabel(wpblRoleTables('batting', input({ scope: 'postseason' })).summary)['WAR'].value).toBe('—')
  })

  it('draws a figure still being read as a sample, and one that failed as a dash', () => {
    const reading = byLabel(wpblRoleTables('batting', input({ board: undefined })).summary)
    expect(reading['wOBA'].pending).toBe(true)
    expect(reading['WAR'].pending).toBe(true)
    expect(reading['AVG'].pending).toBe(false)
    const failed = byLabel(wpblRoleTables('batting', input({ board: null })).summary)
    expect(failed['wOBA'].value).toBe('—')
    expect(failed['WAR'].value).toBe('—')
    expect(failed['wOBA'].pending).toBe(false)
  })

  it('passes a rank through only where the card\'s bar let one through', () => {
    const rank = { rank: 1, of: 20 }
    const cols = wpblRoleTables('batting', input({ rankFor: (_r, l) => (l === 'OBP' ? { rank } : null) })).summary
    expect(cols.filter(c => c.rank).map(c => c.label)).toEqual(['OBP'])
  })
})

describe('seasonLead', () => {
  it('names the slice when it is not a plain season', () => {
    expect(seasonLead(2026, false, 'regular')).toBe('2026')
    expect(seasonLead(2026, true, 'regular')).toBe('Career')
    expect(seasonLead(2026, false, 'postseason')).toBe('Playoffs')
    expect(seasonLead(2026, false, 'all')).toBe('Total')
  })
})
