import { describe, it, expect } from 'vitest'
import type { Person } from '../../people'
import type { WbscBattingLine, WbscGame } from '../game'
import { buildPersonFile, personSlugs, type PersonEventInput } from '../personFile'

// Synthetic rows only (see fixture.ts for why).

const person = (id: string, name: string, country: string, wbsc: string[], wpbl: string | null = null): Person => ({
  id, name, country, wpbl_id: wpbl,
  wbsc: wbsc.map(w => ({ event_key: `ev-${w.split(':')[2]}`, wbsc_id: w, name: `${name} Middle`, team_id: country })),
})

describe('World Cup player slugs', () => {
  it('are names, told apart by country and then by first tournament id, and none for a WPBL player', () => {
    const slugs = personSlugs([
      person('a', 'Jia Lee', 'KOR', ['wbsc:p:1:10']),
      person('b', 'Jia Lee', 'KOR', ['wbsc:p:2:20']),
      person('c', 'Jia Lee', 'USA', ['wbsc:p:1:30']),
      person('d', 'Zoë O’Hara', 'CAN', ['wbsc:p:1:40']),
      person('e', 'Dana Quill', 'USA', ['wbsc:p:1:50'], 'w1'),
    ])
    expect(Object.fromEntries(slugs)).toEqual({
      a: 'jia-lee-kor-10', b: 'jia-lee-kor-20', c: 'jia-lee-usa', d: 'zoe-ohara',
    })
  })
})

describe('World Cup player file', () => {
  const game = (n: number, away: string, home: string): WbscGame => ({
    id: `wbsc:g:${n}`, wbsc_game_id: n, event_key: '', game_date: `2024-08-0${n}`, status: 'final',
    away_team_id: away, home_team_id: home, away_score: 0, home_score: 1, round: null, start_local: '',
    timezone: null, innings: 7, venue: null, city: null, attendance: null, duration_minutes: null,
    home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
  })
  const bat = (player: string, g: number): WbscBattingLine => ({
    id: `b${g}`, game_id: `wbsc:g:${g}`, player_id: player, team_id: 'KOR',
    pa: 3, ab: 3, r: 0, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
    sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 1, spot: 1, position: 'SS',
  })
  const ev = (key: string, year: number, games: WbscGame[], batting: WbscBattingLine[]): PersonEventInput =>
    ({ key, name: key, year, source: `https://example.test/${key}`, games, batting, pitching: [] })

  it('gives each event a row with its edition, newest last, and drops a roster spot with no game', () => {
    const p = person('a', 'Jia Lee', 'KOR', ['wbsc:p:2:20', 'wbsc:p:1:10', 'wbsc:p:3:30'])
    const events = new Map([
      ['ev-1', ev('ev-1', 2018, [game(1, 'KOR', 'USA')], [bat('wbsc:p:1:10', 1)])],
      ['ev-2', ev('ev-2', 2024, [game(5, 'JPN', 'KOR'), game(6, 'KOR', 'CAN')], [bat('wbsc:p:2:20', 5), bat('wbsc:p:2:20', 6)])],
      ['ev-3', ev('ev-3', 2026, [game(8, 'KOR', 'AUS')], [])],
    ])
    const file = buildPersonFile(p, 'jia-lee', events, k => (k === 'ev-2' ? '2024' : null), (ed, team) => (ed === '2024' && team === 'KOR' ? 'silver' : null))
    expect(file.events.map(e => [e.event_key, e.edition, e.batting?.g, e.wbsc_name])).toEqual([
      ['ev-1', null, 1, 'Jia Lee'], ['ev-2', '2024', 2, 'Jia Lee'],
    ])
    expect(file.events[1].games.map(g => [g.opponent_id, g.home])).toEqual([['JPN', true], ['CAN', false]])
    expect(file.indexable).toBe(true)
    expect(file.position).toBe('SS')
    expect(file.medals).toEqual([{ edition: '2024', medal: 'silver' }])
    expect(file.events[1].log.map(g => [g.opponent_id, g.team_score, g.opponent_score, g.batting?.h, g.pitching])).toEqual([
      ['JPN', 1, 0, 1, null], ['CAN', 0, 1, 1, null],
    ])
  })

  it('keeps a page with one World Cup and under 10 plate appearances out of search engines', () => {
    const p = person('a', 'Jia Lee', 'KOR', ['wbsc:p:2:20'])
    const games = [1, 2, 3, 4].map(n => game(n, 'KOR', 'USA'))
    const played = (n: number) => buildPersonFile(p, 'jia-lee', new Map([
      ['ev-2', ev('ev-2', 2024, games, games.slice(0, n).map(g => bat('wbsc:p:2:20', g.wbsc_game_id)))],
    ]), () => '2024')
    expect(played(3).indexable).toBe(false)
    expect(played(4).indexable).toBe(true)
  })
})
