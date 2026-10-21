import { describe, it, expect } from 'vitest'
import { sumBatting, sumPitching, type WpblBatSeason, type WpblPitSeason } from '../stats'
import { eraFipChart, obpSlgChart, twoWayChart } from '../derive/charts'
import type { PlayerValueSeason, WpblValueTotals } from '../derive/playerValue'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

// The Charts board's points. What they must get right: the playing-time bar is plate appearances
// (never at-bats), nobody without a sample is drawn, ERA and FIP move together with the reader's
// basis, and the two-way chart holds only players who did both.

const G = 'g1'
const games: WpblGame[] = [{ id: G, game_type: 'regular', counts_in_standings: true } as WpblGame]
const player = (id: string) => ({ id, name: `Player ${id}` } as WpblPlayer)

const bat = (id: string, o: Partial<WpblBattingLine>): WpblBatSeason => ({
  player: player(id),
  totals: sumBatting([{
    id, game_id: G, player_id: id, team_id: 'SF',
    ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, cs: 0, hbp: 0, sf: 0, sh: 0, ...o,
  } as WpblBattingLine], games),
})

describe('obpSlgChart', () => {
  // Twelve trips, eight of them walks: four at-bats, so an at-bat bar would wrongly leave them out.
  const walker = bat('walker', { ab: 4, h: 1, bb: 8 })
  const slugger = bat('slugger', { ab: 12, h: 5, hr: 3 })
  const cameo = bat('cameo', { ab: 2, h: 1 })
  const benched = bat('benched', {})
  const chart = obpSlgChart([walker, slugger, cameo, benched], { obp: 0.35, slg: 0.4 }, 10)

  it('gates on plate appearances, not at-bats', () => {
    expect(chart.points.find(p => p.player.id === 'walker')?.qualified).toBe(true)
    expect(chart.points.find(p => p.player.id === 'cameo')?.qualified).toBe(false)
  })

  it('leaves out a player with no plate appearance', () => {
    expect(chart.points.map(p => p.player.id)).not.toContain('benched')
  })

  it('places each hitter at their OBP and SLG', () => {
    const s = chart.points.find(p => p.player.id === 'slugger')!
    expect(s.x).toBeCloseTo(slugger.totals.obp!)
    expect(s.y).toBeCloseTo(slugger.totals.slg!)
    expect(chart.avg).toEqual({ x: 0.35, y: 0.4 })
  })

  it('labels the best OPS first, from the qualified hitters', () => {
    expect(chart.notable[0]).toBe('slugger')
    expect(chart.notable).not.toContain('cameo')
  })
})

describe('eraFipChart', () => {
  const pit = (id: string, o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
    id, game_id: G, player_id: id, team_id: 'SF',
    outs: 45, bf: 70, h: 15, r: 8, er: 8, bb: 5, so: 10, hr: 1, hbp: 0, pitches: 250, decision: null, ...o,
  } as WpblPitchingLine)
  const lines = [pit('a', {}), pit('b', { er: 2, so: 20 }), pit('c', { outs: 0, er: 0 })]
  const league = sumPitching(lines, games)
  const seasons: WpblPitSeason[] = lines.map(l => ({ player: player(l.player_id), totals: sumPitching([l], games) }))
  const w = { hr: 13 / 9, bb: 3 / 9, k: -2 / 9 }

  it('is empty until the league has its FIP weights', () => {
    expect(eraFipChart(seasons, league, null, 0, 7).points).toEqual([])
  })

  it('rescales ERA and FIP together, so the diagonal still means equal', () => {
    const seven = eraFipChart(seasons, league, w, 0, 7).points
    const nine = eraFipChart(seasons, league, w, 0, 9).points
    expect(seven.map(p => p.player.id)).toEqual(['a', 'b'])
    for (let i = 0; i < seven.length; i++) {
      expect(nine[i].x / seven[i].x).toBeCloseTo(9 / 7)
      expect(nine[i].y / seven[i].y).toBeCloseTo(9 / 7)
    }
  })
})

describe('twoWayChart', () => {
  const value = (id: string, t: Partial<WpblValueTotals>): PlayerValueSeason<WpblPlayer> =>
    ({ player: player(id), totals: { pa: 0, outs: 0, batWar: 0, pitWar: 0, ...t } as WpblValueTotals })

  it('holds only players who both batted and pitched', () => {
    const chart = twoWayChart([
      value('both', { pa: 40, outs: 60, batWar: 0.8, pitWar: 1.1 }),
      value('hitter', { pa: 120, batWar: 2 }),
      value('pitcher', { outs: 90, pitWar: 1.5 }),
    ], 30, 45)
    expect(chart.points.map(p => p.player.id)).toEqual(['both'])
    expect(chart.points[0]).toMatchObject({ x: 0.8, y: 1.1, qualified: true })
  })

  it('counts a regular on either side as a regular', () => {
    const chart = twoWayChart([value('ace', { pa: 6, outs: 90 })], 30, 45)
    expect(chart.points[0].qualified).toBe(true)
  })
})
