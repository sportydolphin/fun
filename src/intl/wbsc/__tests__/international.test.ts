import { describe, it, expect } from 'vitest'
import type { PitchingGameLine } from '../../../league/types'
import type { Crosswalk, Link } from '../crosswalk'
import type { WbscBattingLine, WbscGame } from '../game'
import { buildInternational, isWbscBattingGame, type InternationalEventInput } from '../international'

// Synthetic rows only (see fixture.ts for why): two events, one player in both, a two-way player,
// a pitcher who never batted, and a roster spot with no game.

const game = (id: number, date: string, away: string, home: string): WbscGame => ({
  id: `wbsc:g:${id}`, wbsc_game_id: id, event_key: '', game_date: date, status: 'final',
  away_team_id: away, home_team_id: home, away_score: 1, home_score: 2, round: null, start_local: '',
  timezone: null, innings: 7, venue: null, city: null, attendance: null, duration_minutes: null,
  home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
})

const bat = (player: string, g: number, team: string, p: Partial<WbscBattingLine> = {}): WbscBattingLine => ({
  id: `wbsc:b:${g}:${player}`, game_id: `wbsc:g:${g}`, player_id: player, team_id: team,
  pa: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 0, spot: 1, position: 'CF', ...p,
})

const pitch = (player: string, g: number, team: string, p: Partial<PitchingGameLine> = {}): PitchingGameLine => ({
  id: `wbsc:pi:${g}:${player}`, game_id: `wbsc:g:${g}`, player_id: player, team_id: team,
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, strikes: 0, hbp: 0, wp: 0, bk: 0,
  gs: 0, decision: null, ...p,
})

const SRC = 'https://www.wbsc.org/en/events'

function events(): InternationalEventInput[] {
  return [
    {
      key: 'late', name: 'Late event', year: 2024, source: `${SRC}/late/schedule-and-results`,
      games: [game(30, '2024-08-01', 'AAA', 'BBB')],
      players: new Map([['wbsc:p:2:1', 'Some Player']]),
      batting: [bat('wbsc:p:2:1', 30, 'AAA', { pa: 4, ab: 4, h: 1, hr: 1, tb: 4, rbi: 1 })],
      pitching: [],
    },
    {
      key: 'early', name: 'Early event', year: 2018, source: `${SRC}/early/schedule-and-results`,
      games: [game(11, '2018-08-02', 'CCC', 'AAA'), game(10, '2018-08-01', 'AAA', 'BBB'), game(12, '2018-08-03', 'AAA', 'DDD')],
      players: new Map([['wbsc:p:1:1', 'x'], ['wbsc:p:1:2', 'x'], ['wbsc:p:1:3', 'x'], ['wbsc:p:1:4', 'x']]),
      batting: [
        bat('wbsc:p:1:1', 10, 'AAA', { pa: 3, ab: 2, h: 1, doubles: 1, tb: 2, bb: 1 }),
        bat('wbsc:p:1:1', 11, 'AAA', { pa: 4, ab: 4, h: 2, tb: 2, so: 1 }),
        // A pinch runner who never came up is a game played.
        bat('wbsc:p:1:1', 12, 'AAA', { position: 'PR/LF', r: 1 }),
        // A pitcher's empty batting line is a pitching game only.
        bat('wbsc:p:1:2', 10, 'AAA', { position: 'P' }),
        bat('wbsc:p:1:3', 11, 'AAA', { pa: 2, ab: 2, position: 'p/1b' }),
      ],
      pitching: [
        pitch('wbsc:p:1:2', 10, 'AAA', { outs: 14, bf: 20, er: 2, so: 5, gs: 1, decision: 'W', pitches: 70, strikes: 44 }),
        pitch('wbsc:p:1:2', 12, 'AAA', { outs: 3, bf: 4, decision: 'S', pitches: null, strikes: null }),
        pitch('wbsc:p:1:3', 11, 'AAA', { outs: 6, bf: 9, decision: 'L', pitches: 30, strikes: 18 }),
      ],
    },
  ]
}

const link = (wbsc: string, event: string, wpbl: string, name = 'Some Player'): Link =>
  ({ wbsc_id: wbsc, event_key: event, wbsc_name: name, wpbl_id: wpbl, wpbl_name: name, checked_by: 'test', checked_at: '2026-11-02' })

const crosswalk = (links: Link[]): Crosswalk => ({ links, rejected: [] })
const ROSTER = new Set(['w1', 'w2', 'w3', 'w4'])

describe('international.json', () => {
  it('totals each event separately, oldest first, with the games behind each', () => {
    const { international, errors } = buildInternational(crosswalk([
      link('wbsc:p:2:1', 'late', 'w1'), link('wbsc:p:1:1', 'early', 'w1'),
    ]), events(), ROSTER)
    expect(errors).toEqual([])
    const rows = international.w1.events
    expect(rows.map(e => e.event_key)).toEqual(['early', 'late'])
    expect(rows[0].batting).toMatchObject({ g: 3, pa: 7, ab: 6, h: 3, doubles: 1, tb: 4, bb: 1, so: 1, r: 1 })
    expect(rows[0].pitching).toBeNull()
    expect(rows[1].batting).toMatchObject({ g: 1, pa: 4, hr: 1 })
    expect(rows[0].games.map(g => [g.wbsc_game_id, g.opponent_id, g.home])).toEqual([[10, 'BBB', false], [11, 'CCC', true], [12, 'DDD', false]])
    expect(rows[0].games[0].url).toBe(`${SRC}/early/schedule-and-results/box-score/10`)
    expect(rows[0].team_id).toBe('AAA')
  })

  it('names the row as the site shows the WBSC player, not with every name the crosswalk recorded', () => {
    const { international } = buildInternational(crosswalk([link('wbsc:p:2:1', 'late', 'w1', 'Some Middle Player')]), events(), ROSTER)
    expect(international.w1.events[0].wbsc_name).toBe('Some Player')
  })

  it('gives a pitcher who never batted no batting row, and an unknown pitch count stays unknown', () => {
    const { international } = buildInternational(crosswalk([link('wbsc:p:1:2', 'early', 'w2')]), events(), ROSTER)
    const row = international.w2.events[0]
    expect(row.batting).toBeNull()
    expect(row.pitching).toMatchObject({ g: 2, gs: 1, outs: 17, bf: 24, er: 2, so: 5, w: 1, l: 0, sv: 1, pitches: null, strikes: null })
    expect(row.games.map(g => g.wbsc_game_id)).toEqual([10, 12])
  })

  it('keeps a two-way line on both sides', () => {
    const { international } = buildInternational(crosswalk([link('wbsc:p:1:3', 'early', 'w3')]), events(), ROSTER)
    const row = international.w3.events[0]
    expect(row.batting).toMatchObject({ g: 1, pa: 2 })
    expect(row.pitching).toMatchObject({ g: 1, outs: 6, l: 1, pitches: 30 })
  })

  it('leaves out a roster spot with no game, and says so', () => {
    const { international, errors, unplayed } = buildInternational(crosswalk([link('wbsc:p:1:4', 'early', 'w4', 'Bench Player')]), events(), ROSTER)
    expect(errors).toEqual([])
    expect(international).toEqual({})
    expect(unplayed).toEqual([{ wpbl_name: 'Bench Player', event_key: 'early', wbsc_name: 'Bench Player' }])
  })

  it('builds nothing when any link does not resolve', () => {
    const good = link('wbsc:p:1:1', 'early', 'w1')
    const cases: [Link, RegExp][] = [
      [link('wbsc:p:9:9', 'gone', 'w1'), /gone is not imported/],
      [link('wbsc:p:9:9', 'early', 'w1'), /not in early/],
      [link('wbsc:p:1:2', 'early', 'nobody'), /not on the WPBL roster/],
      [link('wbsc:p:1:3', 'early', 'w1', 'Another'), /already Some Player in early/],
    ]
    for (const [bad, why] of cases) {
      const { international, errors } = buildInternational(crosswalk([good, bad]), events(), ROSTER)
      expect(international).toEqual({})
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatch(why)
    }
  })

  it('is the same bytes whatever order the links come in', () => {
    const links = [link('wbsc:p:1:3', 'early', 'w3'), link('wbsc:p:2:1', 'late', 'w1'), link('wbsc:p:1:1', 'early', 'w1')]
    const a = buildInternational(crosswalk(links), events(), ROSTER).international
    const b = buildInternational(crosswalk([...links].reverse()), events(), ROSTER).international
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(Object.keys(a)).toEqual(['w1', 'w3'])
  })

  it('reads positions in either case', () => {
    expect(isWbscBattingGame({ pa: 0, position: 'P/P' })).toBe(false)
    expect(isWbscBattingGame({ pa: 0, position: 'pr/rf' })).toBe(true)
    expect(isWbscBattingGame({ pa: 0, position: null })).toBe(false)
    expect(isWbscBattingGame({ pa: 1, position: 'P' })).toBe(true)
  })
})
