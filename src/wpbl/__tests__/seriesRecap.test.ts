import { describe, it, expect } from 'vitest'
import { buildRecap } from '../derive/recap'
import { buildRecapMessage, recapMessageFingerprint } from '../derive/discordRecap'
import { seriesContext } from '../derive/series'
import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblRecapPlay } from '../types'

// The recap engine, once it knows about series.
//
// Two things are being protected here. The first is the reason the work was done: a
// best-of-five clincher used to reach a public Discord channel and a public Bluesky feed
// worded as an ordinary 4-2 win, with nothing anywhere saying a championship had been decided.
//
// The second is quieter and is the one a change here would break by accident. The Discord
// poster decides whether to EDIT an already-posted recap by fingerprinting the whole rendered
// message, so anything that changes the message for a regular-season game re-edits all thirty
// of them on the next pass. Every addition below has to be invisible outside the postseason.

const team = (id: string, city: string, name: string): WpblTeam =>
  ({ id, city, name, abbr: id, color: '#e8412c' } as WpblTeam)

const TEAMS = new Map([
  ['SF', team('SF', 'San Francisco', 'Firebells')],
  ['LA', team('LA', 'Los Angeles', 'Queens')],
  ['NY', team('NY', 'New York', 'Heights')],
  ['BOS', team('BOS', 'Boston', 'Hunters')],
])

let seq = 0
const mkGame = (over: Partial<WpblGame>): WpblGame => ({
  id: `g${++seq}`,
  game_date: '2026-09-09',
  start_time: '6:00 PM',
  home_team_id: 'SF',
  away_team_id: 'BOS',
  venue: null,
  status: 'final',
  home_score: 5,
  away_score: 2,
  innings: 7,
  notes: null,
  home_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [2, 0, 1, 0, 2, 0, 0][i - 1] })),
  away_line: [1, 2, 3, 4, 5, 6, 7].map(i => ({ inning: i, runs: [0, 1, 0, 0, 1, 0, 0][i - 1] })),
  created_at: '', updated_at: '',
  game_type: 'postseason',
  counts_in_standings: false,
  ...over,
} as WpblGame)

const post = (date: string, home: string, away: string, hs: number, as: number) =>
  mkGame({ game_date: date, home_team_id: home, away_team_id: away, home_score: hs, away_score: as })

const batting: WpblBattingLine[] = [
  { player_id: 'p1', team_id: 'SF', ab: 4, h: 3, r: 2, rbi: 3, hr: 1, doubles: 1, triples: 0, bb: 0, so: 0, sb: 0, tb: 7 } as WpblBattingLine,
]
const pitching: WpblPitchingLine[] = [
  { player_id: 'p2', team_id: 'SF', outs: 21, h: 4, r: 2, er: 2, bb: 1, so: 8, hr: 0, decision: 'W', gs: 1, pitches: 95 } as WpblPitchingLine,
]
const nameOf = (id: string) => (id === 'p1' ? 'Rosa Delgado' : 'Amara Boyd')

const recapFor = (game: WpblGame, all: WpblGame[]) =>
  buildRecap(game, TEAMS, batting, pitching, [] as WpblRecapPlay[], nameOf, undefined,
    seriesContext(game, all, TEAMS))!

describe('a series-aware recap', () => {
  it('closes the blurb with where the series stands', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 5, 2)]
    const r = recapFor(all[0], all)
    expect(r.blurb).toContain('Firebells lead the semifinal 1-0.')
  })

  it('says a championship was won, in the blurb and at the top of the feats', () => {
    // The exact case the roadmap filed: "the Firebells won 4-2" with no notion that a
    // championship had just been decided.
    const semiA = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    const semiB = [post('2026-09-10', 'LA', 'NY', 6, 5), post('2026-09-12', 'NY', 'LA', 2, 7)]
    const final = [
      post('2026-09-16', 'SF', 'LA', 3, 1),
      post('2026-09-17', 'SF', 'LA', 4, 2),
      post('2026-09-19', 'LA', 'SF', 1, 5),
    ]
    const all = [...semiA, ...semiB, ...final]
    const r = recapFor(final[2], all)
    expect(r.blurb).toContain('Firebells are WPBL champions, taking the final 3-0.')
    expect(r.feats[0]).toBe('🏆 Firebells win the WPBL championship!')
  })

  it('puts the clincher ahead of a three-homer game, which is the only night it outranks one', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    const bigDay: WpblBattingLine[] = [
      { player_id: 'p1', team_id: 'SF', ab: 4, h: 3, r: 3, rbi: 6, hr: 3, doubles: 0, triples: 0, bb: 0, so: 0, sb: 0, tb: 12 } as WpblBattingLine,
    ]
    const r = buildRecap(all[1], TEAMS, bigDay, pitching, [] as WpblRecapPlay[], nameOf, undefined,
      seriesContext(all[1], all, TEAMS))!
    expect(r.feats[0]).toBe('Firebells win the semifinal 2-0')
    expect(r.feats.some(f => f.includes('3 HR'))).toBe(true)
  })

  it('leaves the game headline alone, because the headline is about the game', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 5, 2)]
    expect(recapFor(all[0], all).headline).toMatch(/^Firebells \w/)
    expect(recapFor(all[0], all).headline).toContain('Hunters')
  })

  it('names the round and the game number in the Discord footer', () => {
    const all = [post('2026-09-09', 'SF', 'BOS', 4, 2), post('2026-09-11', 'BOS', 'SF', 1, 3)]
    const r = recapFor(all[1], all)
    const msg = buildRecapMessage(all[1], r, TEAMS, 'https://sportydolphin.fun/wpbl/games/x')
    expect(msg.embeds[0].footer.text).toContain('Semifinal Game 2 of 3')
  })
})

describe('a regular-season recap is untouched', () => {
  // The whole point: the Discord poster re-sends exactly when a reader would see something
  // different, so anything that changes an ordinary recap edits thirty already-posted
  // messages for nothing.
  const regular = mkGame({
    id: 'reg1', game_date: '2026-08-15', game_type: 'regular', counts_in_standings: true,
  })

  it('has no series at all', () => {
    expect(seriesContext(regular, [regular], TEAMS)).toBeNull()
  })

  it('renders the identical message with and without the series argument', () => {
    const withArg = buildRecap(regular, TEAMS, batting, pitching, [] as WpblRecapPlay[], nameOf, undefined,
      seriesContext(regular, [regular], TEAMS))!
    const without = buildRecap(regular, TEAMS, batting, pitching, [] as WpblRecapPlay[], nameOf)!
    const url = 'https://sportydolphin.fun/wpbl/games/x'
    expect(recapMessageFingerprint(buildRecapMessage(regular, withArg, TEAMS, url)))
      .toBe(recapMessageFingerprint(buildRecapMessage(regular, without, TEAMS, url)))
  })

  it('keeps the footer in the shape it has been posting all season', () => {
    const r = buildRecap(regular, TEAMS, batting, pitching, [] as WpblRecapPlay[], nameOf)!
    const msg = buildRecapMessage(regular, r, TEAMS, 'https://sportydolphin.fun/wpbl/games/x')
    expect(msg.embeds[0].footer.text).toBe('WPBL · 2026-08-15 · sportydolphin.fun')
  })
})
