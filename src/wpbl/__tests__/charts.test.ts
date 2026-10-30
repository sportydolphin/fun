import { describe, it, expect } from 'vitest'
import { sumBatting, sumPitching, type WpblBatSeason, type WpblPitSeason } from '../stats'
import { averagePowerChart, eraFipChart, obpSlgChart, pitcherStrikeoutWalkChart, twoWayChart, walkStrikeoutChart } from '../derive/charts'
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

  it('names the odd dot out as well as the leaders', () => {
    // Eight hitters bunched around .330 / .400 and one who walks and never hits for power: no
    // leader ordering reaches the ninth first, but it is the dot a reader asks about.
    const bunch = Array.from({ length: 8 }, (_, i) => bat(`b${i}`, { ab: 30, h: 9 + (i % 3), doubles: 2, bb: 3 + (i % 2) }))
    const odd = bat('odd', { ab: 20, h: 2, bb: 14 })
    const c = obpSlgChart([...bunch, odd], { obp: 0.35, slg: 0.4 }, 10)
    expect(c.notable).toContain('odd')
    expect(c.notable.length).toBeLessThanOrEqual(12)
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

describe('walkStrikeoutChart and averagePowerChart', () => {
  // Ten trips with eight walks: four at-bats, so an at-bat bar would wrongly leave them out.
  const walker = bat('walker', { ab: 4, h: 1, bb: 8, so: 1 })
  const slugger = bat('slugger', { ab: 12, h: 5, hr: 3, so: 4 })
  const benched = bat('benched', {})

  it('places a hitter at BB% and K% per plate appearance, gated on plate appearances', () => {
    const c = walkStrikeoutChart([walker, slugger, benched], { bbPct: 0.1, kPct: 0.2 }, 10)
    expect(c.points.map(p => p.player.id)).toEqual(['walker', 'slugger'])
    expect(c.points[0]).toMatchObject({ x: 8 / 12, y: 1 / 12, qualified: true })
  })

  it('places a hitter at AVG and ISO', () => {
    const c = averagePowerChart([slugger], { avg: 0.25, iso: 0.1 }, 10)
    expect(c.points[0].x).toBeCloseTo(5 / 12)
    expect(c.points[0].y).toBeCloseTo((5 + 3 * 3) / 12 - 5 / 12)
  })
})

describe('pitcherStrikeoutWalkChart', () => {
  const line = (id: string, o: Partial<WpblPitchingLine>): WpblPitSeason => ({
    player: player(id),
    totals: sumPitching([{
      id, game_id: G, player_id: id, team_id: 'SF',
      outs: 30, bf: 50, h: 10, r: 5, er: 5, bb: 5, so: 10, hr: 1, hbp: 0, pitches: 200, decision: null, ...o,
    } as WpblPitchingLine], games),
  })

  it('places a pitcher per batter faced and leaves out one who faced nobody', () => {
    const lines = [line('a', {}), line('b', { outs: 0, bf: 0, so: 0, bb: 0, h: 0, r: 0, er: 0, hr: 0 })]
    const c = pitcherStrikeoutWalkChart(lines, lines[0].totals, 9)
    expect(c.points.map(p => p.player.id)).toEqual(['a'])
    expect(c.points[0]).toMatchObject({ x: 0.2, y: 0.1, qualified: true })
  })
})
