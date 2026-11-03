import { describe, it, expect } from 'vitest'
import type { PitchingGameLine } from '../../../league/types'
import type { WbscBattingLine, WbscGame } from '../game'
import { editionLeaders, type PersonLookup } from '../editionLeaders'

// Synthetic rows only (see fixture.ts for why). One edition of two events: AAA plays five games,
// BBB one. Player 1 is one person under two WBSC ids, and a WPBL player.

const game = (n: number, away = 'BBB', home = 'AAA'): WbscGame => ({
  id: `g${n}`, wbsc_game_id: n, event_key: '', game_date: '2024-08-01', status: 'final',
  away_team_id: away, home_team_id: home, away_score: 0, home_score: 1, round: null, start_local: `2024-08-0${n} 10:00:00`,
  timezone: null, innings: 7, venue: null, city: null, attendance: null, duration_minutes: null,
  home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
})

const bat = (player: string, g: number, team: string, p: Partial<WbscBattingLine> = {}): WbscBattingLine => ({
  id: `b${g}${player}`, game_id: `g${g}`, player_id: player, team_id: team,
  pa: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 0, spot: 1, position: 'CF', ...p,
})

const pitch = (player: string, g: number, team: string, p: Partial<PitchingGameLine> = {}): PitchingGameLine => ({
  id: `p${g}${player}`, game_id: `g${g}`, player_id: player, team_id: team,
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, strikes: 0, hbp: 0, wp: 0, bk: 0,
  gs: 0, decision: null, ...p,
})

const PEOPLE_NAMES: Record<string, string> = { 'wbsc:p:1:1': 'Dana Quill', 'wbsc:p:2:1': 'Dana Quill', 'wbsc:p:1:2': 'Ana Alpha', 'wbsc:p:1:3': 'Bea Bravo' }

const PEOPLE: PersonLookup = {
  person: id => (id === 'wbsc:p:2:1' ? 'wbsc:p:1:1' : id),
  name: id => PEOPLE_NAMES[id] ?? id,
  wpbl: id => (id === 'wbsc:p:2:1' ? { name: 'Dana Q. Quill', path: '/wpbl/players/dana-quill' } : null),
  eventName: id => PEOPLE_NAMES[id] ?? id,
  path: id => (id === 'wbsc:p:2:1' ? '/wpbl/players/dana-quill' : `/world-cup/players/${id}`),
}

const GAMES = [1, 2, 3, 4].map(n => game(n, 'CCC')).concat(game(5))

describe('World Cup edition leaders', () => {
  it('sums one person across the events of an edition, under their WPBL name', () => {
    const { leaders } = editionLeaders({
      games: GAMES,
      batting: [
        bat('wbsc:p:1:1', 1, 'AAA', { pa: 6, ab: 6, h: 3, tb: 6, hr: 1, rbi: 2 }),
        bat('wbsc:p:2:1', 5, 'AAA', { pa: 7, ab: 6, h: 3, bb: 1, tb: 3, hr: 1, rbi: 1 }),
      ],
      pitching: [],
    }, PEOPLE)
    const hr = leaders.batting.find(b => b.stat === 'HR')!
    expect(hr.rows).toEqual([{ name: 'Dana Q. Quill', team: 'AAA', path: '/wpbl/players/dana-quill', wpbl: true, value: 2 }])
    expect(leaders.batting.find(b => b.stat === 'AVG')!.rows[0].value).toBe(0.5)
  })

  it("holds a rate title to the player's own team's games", () => {
    // AAA played 5 games, so 12 plate appearances; BBB one, so the floor of 6.
    const { leaders } = editionLeaders({
      games: GAMES,
      batting: [
        bat('wbsc:p:1:2', 1, 'AAA', { pa: 11, ab: 11, h: 9, tb: 9 }),
        bat('wbsc:p:1:3', 5, 'BBB', { pa: 6, ab: 6, h: 2, tb: 2 }),
      ],
      pitching: [],
    }, PEOPLE)
    expect(leaders.batting.find(b => b.stat === 'AVG')!.rows.map(r => r.name)).toEqual(['Bea Bravo'])
  })

  it('sorts ERA low, keeps a zero ERA, and drops a zero from a counting board', () => {
    const { leaders } = editionLeaders({
      games: GAMES,
      batting: [],
      pitching: [
        pitch('wbsc:p:1:2', 1, 'AAA', { outs: 12, er: 2, so: 0 }),
        pitch('wbsc:p:1:3', 5, 'BBB', { outs: 9, er: 0, so: 4, decision: 'W' }),
      ],
    }, PEOPLE)
    const era = leaders.pitching.find(b => b.stat === 'ERA')!.rows
    expect(era.map(r => [r.name, r.value])).toEqual([['Bea Bravo', 0], ['Ana Alpha', 3.5]])
    expect(leaders.pitching.find(b => b.stat === 'SO')!.rows.map(r => r.name)).toEqual(['Bea Bravo'])
  })

  it('lists the WPBL players in the field by team', () => {
    const { wpbl } = editionLeaders({ games: GAMES, batting: [bat('wbsc:p:2:1', 5, 'AAA', { pa: 1 }), bat('wbsc:p:1:3', 5, 'BBB', { pa: 1 })], pitching: [] }, PEOPLE)
    expect(wpbl).toEqual([{ team: 'AAA', players: [{ name: 'Dana Q. Quill', path: '/wpbl/players/dana-quill' }] }])
  })
})
