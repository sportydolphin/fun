import { describe, it, expect } from 'vitest'
import type { RunValuePlay } from '../../../league/types'
import type { WbscBattingLine, WbscGame } from '../game'
import type { PersonLookup } from '../editionLeaders'
import { buildGameFile } from '../gameFile'

// Synthetic rows only (see fixture.ts for why).

const GAME: WbscGame = {
  id: 'wbsc:g:7', wbsc_game_id: 7, event_key: 'ev', game_date: '2024-08-01', status: 'final',
  away_team_id: 'AAA', home_team_id: 'BBB', away_score: 1, home_score: 0, round: 'Final Stage Games', start_local: '',
  timezone: null, innings: 7, venue: 'Park', city: 'Town', attendance: 900, duration_minutes: 100,
  home_hits: 2, away_hits: 3, home_errors: 0, away_errors: 1,
  away_line: [{ inning: 1, runs: 1 }], home_line: [{ inning: 1, runs: 0 }],
}

const bat = (player: string, spot: number, p: Partial<WbscBattingLine> = {}): WbscBattingLine => ({
  id: `b${player}`, game_id: GAME.id, player_id: player, team_id: 'AAA',
  pa: 1, ab: 1, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 0, spot, position: 'cf', ...p,
})

const play = (seq: number, batter: string, first: string, p: Partial<RunValuePlay> = {}): RunValuePlay => ({
  game_id: GAME.id, sequence: seq, team_id: 'AAA', batter_id: null, batter_name: batter, pitcher_id: null, pitcher_name: null,
  event_type: 'single', pitch_sequence: null, inning: 1, half: 'top', outs: 0,
  first_base: first, second_base: '', third_base: '', runs_scored: 0, narrative: 'WBSC WORDS', ...p,
})

const PEOPLE_NAMES: Record<string, string> = { p1: 'Dana Quill', p2: 'Ana Alpha', p3: 'Bea Bravo' }

const PEOPLE: PersonLookup = {
  person: id => id,
  name: id => PEOPLE_NAMES[id] ?? id,
  wpbl: id => (id === 'p1' ? { name: 'Dani Quill', path: '/wpbl/players/dani-quill' } : null),
  eventName: id => PEOPLE_NAMES[id] ?? id,
  path: id => (id === 'p1' ? '/wpbl/players/dani-quill' : `/world-cup/players/${id}`),
}

describe('World Cup game file', () => {
  const file = buildGameFile(GAME, {
    batting: [bat('p2', 2), bat('p1', 1), bat('p3', 1, { position: 'ph' }), { ...bat('p9', 1), game_id: 'other' }],
    pitching: [],
    plays: [play(2, 'Ana Alpha', 'Dana Quill'), play(1, 'Dana Quill', '')],
  }, '2024', 'https://example.test/ev', PEOPLE)

  it('orders the box by lineup spot with the substitute under the starter, this game only', () => {
    expect(file.batting.away.map(b => [b.name, b.spot, b.sub, b.pos])).toEqual([
      ['Dani Quill', 1, false, 'CF'], ['Bea Bravo', 1, true, 'PH'], ['Ana Alpha', 2, false, 'CF'],
    ])
  })

  it("writes the plays in order in our words, under the WPBL player's roster name", () => {
    expect(file.halves).toEqual([{ inning: 1, half: 'top', team: 'AAA', plays: [
      { text: 'Dani Quill singled.', runs: 0 },
      { text: 'Ana Alpha singled.', runs: 0 },
    ] }])
    expect(JSON.stringify(file)).not.toContain('WBSC WORDS')
  })

  it('lists the pitchers in the order they pitched, not the order WBSC wrote them', () => {
    const pit = (player: string) => ({
      id: `p${player}`, game_id: GAME.id, player_id: player, team_id: 'BBB', outs: 3, bf: 3, h: 0, r: 0, er: 0,
      bb: 0, so: 0, hr: 0, pitches: null, hbp: 0, wp: 0, bk: 0,
    })
    const f = buildGameFile(GAME, {
      batting: [], pitching: [pit('p3'), pit('p2')],
      plays: [play(1, 'X', '', { pitcher_id: 'p2' }), play(2, 'Y', '', { pitcher_id: 'p3' })],
    }, '2024', '', PEOPLE)
    expect(f.pitching.home.map(p => p.name)).toEqual(['Ana Alpha', 'Bea Bravo'])
  })

  it('links the WPBL player and the box score on wbsc.org', () => {
    expect(file.batting.away[0].path).toBe('/wpbl/players/dani-quill')
    expect(file.batting.away[2].path).toBe('/world-cup/players/p2')
    expect(file.url).toBe('https://example.test/ev/box-score/7')
  })
})
