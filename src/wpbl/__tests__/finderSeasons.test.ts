import { describe, it, expect } from 'vitest'
import { runWpblFinder, EMPTY_FINDER_QUERY, encodeFinderQuery, type FinderQuery } from '../derive/finder'
import { decodeFinderCuts, describeFinderCuts, finderAnswerText } from '../../league/finder'
import { findAskFromHref } from '../findAnswer'
import { wpblFinderHref } from '../finderLink'
import { wpblFinderQualify } from '../finderQualify'
import type { WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from '../types'

// FIND OVER MORE THAN ONE SEASON. Every bulk read holds every year, so the day the first 2027 line
// lands, a board handed both years must keep a season a season. Summed across them, "most home runs
// in a season" would crown a total no season ever had, and nothing would look wrong.

const A = { id: 'a', name: 'Jaida Lee', team_id: 'NY' } as WpblPlayer
const B = { id: 'b', name: 'Ayami Sato', team_id: 'LA' } as WpblPlayer
const PLAYERS = [A, B]

const game = (id: string, date: string): WpblGame => ({
  id, status: 'final', game_date: date, home_team_id: 'NY', away_team_id: 'LA',
  game_type: 'regular', counts_in_standings: true,
} as WpblGame)

const bat = (o: Partial<WpblBattingLine>): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
  ab: 4, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 1, lob: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'b', team_id: 'LA',
  outs: 15, bf: 20, h: 4, r: 1, er: 1, bb: 1, so: 5, hr: 0, pitches: 80, decision: null,
  gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 50, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

const fld = (o: Partial<WpblFieldingLine>): WpblFieldingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'NY',
  po: 2, a: 1, e: 0, dp: 0, pb: 0, sba: 0, cs: 0, ci: 0, ...o,
} as WpblFieldingLine)

const q = (o: Partial<FinderQuery> = {}): FinderQuery => ({ ...EMPTY_FINDER_QUERY, per: 'season', ...o })

const GAMES = [
  game('g1', '2026-07-01'), game('g2', '2026-07-02'), game('g3', '2026-07-03'),
  game('h1', '2027-06-01'), game('h2', '2027-06-02'),
]
// Lee: 3 HR in 2026, 4 in 2027. Sato: 5 in 2026 alone.
const BATTING = [
  bat({ game_id: 'g1', hr: 2 }), bat({ game_id: 'g2', hr: 1 }), bat({ game_id: 'g3', hr: 0 }),
  bat({ game_id: 'h1', hr: 2 }), bat({ game_id: 'h2', hr: 2 }),
  bat({ game_id: 'g1', player_id: 'b', team_id: 'LA', hr: 3 }), bat({ game_id: 'g2', player_id: 'b', team_id: 'LA', hr: 2 }),
]
const HR = [{ field: 'hr', op: 'gte' as const, value: 1 }]

describe('Find over every season', () => {
  it('keeps one row per player per season, each with its year', () => {
    const r = runWpblFinder('hitting', BATTING, [], PLAYERS, GAMES, q({ conditions: HR }))
    expect(r.rows.map(x => [x.name, x.season, x.headline])).toEqual([
      ['Ayami Sato', 2026, 5], ['Jaida Lee', 2027, 4], ['Jaida Lee', 2026, 3],
    ])
    expect(new Set(r.rows.map(x => x.key)).size).toBe(3)
    expect(r.rows.find(x => x.season === 2027)?.values.g).toBe(2)
  })

  it('sums every season into one row for a career', () => {
    const r = runWpblFinder('hitting', BATTING, [], PLAYERS, GAMES, q({ conditions: HR, career: true }))
    expect(r.rows.map(x => [x.name, x.headline, x.values.g])).toEqual([['Jaida Lee', 7, 5], ['Ayami Sato', 5, 2]])
    expect(r.rows.every(x => x.season === undefined)).toBe(true)
  })

  it('leaves one season exactly as it was: no year on the row, the player as the key', () => {
    const one = BATTING.filter(l => l.game_id.startsWith('g'))
    const r = runWpblFinder('hitting', one, [], PLAYERS, GAMES, q({ conditions: HR }))
    expect(r.rows.map(x => [x.key, x.season])).toEqual([['b', undefined], ['a', undefined]])
  })

  it('keeps a stretch inside one season, and lets a career run across two', () => {
    // Lee's best two games in a row: 3 inside 2026, 4 inside 2027, and 2 + 0 or 0 + 2 across the break.
    const stretch = (career: boolean) => runWpblFinder('hitting', BATTING, [], PLAYERS, GAMES,
      q({ conditions: HR, stretch: 2, playerId: 'a', career }))
    expect(stretch(false).rows.map(x => [x.season, x.headline])).toEqual([[2027, 4], [2026, 3]])
    const career = stretch(true).rows
    expect(career.map(x => x.headline)).toEqual([4])
    expect(career[0].stretch?.first.id).toBe('h1')
  })

  it('splits a pitcher by season too', () => {
    const lines = [pit({ game_id: 'g1', so: 6 }), pit({ game_id: 'h1', so: 9 }), pit({ game_id: 'h2', so: 2 })]
    const r = runWpblFinder('pitching', [], lines, PLAYERS, GAMES, q({ conditions: [{ field: 'so', op: 'gte', value: 1 }] }))
    expect(r.rows.map(x => [x.season, x.headline])).toEqual([[2027, 11], [2026, 6]])
  })

  it("counts a fielder's games in each season, not in every season", () => {
    const fielding = [fld({ game_id: 'g1' }), fld({ game_id: 'h1' }), fld({ game_id: 'h2' })]
    const r = runWpblFinder('fielding', BATTING.filter(l => l.player_id === 'a'), [], PLAYERS, GAMES,
      q({ conditions: [{ field: 'po', op: 'gte', value: 1 }] }), 50, null, { fielding })
    expect(r.rows.map(x => [x.season, x.values.g])).toEqual([[2027, 2], [2026, 3]])
  })

  it('carries a career in the address, and names it on a season question only', () => {
    const encoded = encodeFinderQuery(q({ conditions: HR, career: true }))
    expect(encoded).toBe('season~career.1~hr.gte.1')
    expect(decodeFinderCuts(encoded).career).toBe(true)
    expect(describeFinderCuts('hitting', { career: true, per: 'season' })).toEqual([{ key: 'career', text: 'Career' }])
    expect(describeFinderCuts('hitting', { career: true, per: 'game' })).toEqual([])
  })

  it("holds a season row to its own year's bar, and a career to every season's", () => {
    // A rate asked over every season: the bar handed in is a career's (10 PA here), which no single
    // season of 4 or 8 PA reaches, so each year's row is held to its own bar (4 PA) instead.
    const avg = [{ field: 'avg', op: 'gte' as const, value: 1 }]
    const lines = [bat({ game_id: 'g1', h: 4 }), bat({ game_id: 'h1', h: 4 }), bat({ game_id: 'h2', h: 4 })]
    const opts = { qualify: { minPa: 10, minOuts: 30 }, qualifyFor: () => ({ minPa: 4, minOuts: 12 }) }
    const each = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, q({ conditions: avg }), 50, null, opts)
    expect(each.rows.map(x => x.season)).toEqual([2027, 2026])
    const career = runWpblFinder('hitting', lines, [], PLAYERS, GAMES, q({ conditions: avg, career: true }), 50, null, opts)
    expect(career.rows).toHaveLength(1)
    expect(career.rows[0].values.pa).toBe(12)
  })

  it('names the year of a season, and of a date, in the answer line', () => {
    const r = runWpblFinder('hitting', BATTING, [], PLAYERS, GAMES, q({ conditions: HR }))
    expect(finderAnswerText(r, 'hitting', q({ conditions: HR }))).toBe('Leader 5 · Ayami Sato, 2026')
    const games = runWpblFinder('hitting', BATTING, [], PLAYERS, GAMES, { ...q({ conditions: HR }), per: 'game' })
    expect(finderAnswerText(games, 'hitting', { per: 'game', conditions: HR })).toBe('Record 3 · Ayami Sato, Jul 1, 2026')
  })

  it('carries every season in a Find link and reads it back', () => {
    const href = wpblFinderHref({ side: 'hitting', per: 'season', conditions: HR, teamId: null, oppId: null, venue: 'any', season: 'all', career: true })
    expect(href).toContain('season=all')
    const ask = findAskFromHref(href)
    expect(ask?.season).toBe('all')
    expect(ask?.query.career).toBe(true)
  })

  it("gives each year its own bar over every season, and a career the whole schedule's", () => {
    const teams = [{ id: 'NY' }, { id: 'LA' }] as WpblTeam[]
    const each = wpblFinderQualify(teams, GAMES, 'all', 'regular', false)
    const career = wpblFinderQualify(teams, GAMES, 'all', 'regular', true)
    const y2026 = wpblFinderQualify(teams, GAMES, 2026, 'regular', false)
    expect(each.qualifyFor?.(2026)).toEqual(y2026.qualify)
    expect(career.qualifyFor).toBeUndefined()
    expect(career.qualify!.minPa).toBeGreaterThan(y2026.qualify!.minPa)
  })
})
