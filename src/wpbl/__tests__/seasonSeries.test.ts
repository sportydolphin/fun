import { describe, it, expect } from 'vitest'
import { seasonSeries, seriesLeaders, seriesQualifiers } from '../derive/seasonSeries'
import { headToHead } from '../derive/matchups'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

// One pairing's season series, and the ways it could quietly disagree with the rest of the site:
//
//   - a postseason game counted as one more meeting, the leak the standings grid, the club page's
//     chips and headToHead each shipped once (see the postseason trap in CLAUDE.md);
//   - a record that differs from the standings grid's cell for the same pair, so two pages say
//     two different things about one series;
//   - a traded player drawn with the club they play for now rather than the one in these games.

let n = 0
const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${++n}`, status: 'final', game_date: '2026-08-07', start_time: '6:00 PM',
  home_team_id: 'SF', away_team_id: 'BOS', home_score: 5, away_score: 2,
  game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)

const bat = (o: Partial<WpblBattingLine>): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'SF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine>): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'p', team_id: 'SF',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

describe('a season series', () => {
  const schedule = [
    game({ game_date: '2026-08-01', home_team_id: 'SF', away_team_id: 'BOS', home_score: 5, away_score: 2 }),
    game({ game_date: '2026-08-08', home_team_id: 'BOS', away_team_id: 'SF', home_score: 4, away_score: 3 }),
    game({ game_date: '2026-08-15', home_team_id: 'SF', away_team_id: 'BOS', home_score: 6, away_score: 1 }),
    // Another pairing, which must not appear.
    game({ game_date: '2026-08-15', home_team_id: 'LA', away_team_id: 'NY', home_score: 9, away_score: 0 }),
    game({ game_date: '2026-08-22', home_team_id: 'BOS', away_team_id: 'SF', status: 'scheduled', home_score: null, away_score: null }),
    // The semifinal. Note the feed's true flag: the game_type is what holds it out.
    game({ game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', home_score: 3, away_score: 2, game_type: 'postSeason', counts_in_standings: true }),
  ]

  it('keeps the regular-season record apart from the postseason', () => {
    const s = seasonSeries(schedule, 'SF', 'BOS')
    expect(s.regular).toEqual({ aWins: 2, bWins: 1, aRuns: 14, bRuns: 7 })
    expect(s.postseason).toEqual({ aWins: 1, bWins: 0, aRuns: 3, bRuns: 2 })
    expect(s.remaining).toBe(1)
  })

  it('agrees with the standings grid cell for the same pair, from either side', () => {
    const cell = headToHead(schedule).get('SF', 'BOS')!
    const s = seasonSeries(schedule, 'SF', 'BOS')
    expect([s.regular.aWins, s.regular.bWins]).toEqual([cell.wins, cell.losses])
    const r = seasonSeries(schedule, 'BOS', 'SF')
    expect(r.regular).toEqual({ aWins: 1, bWins: 2, aRuns: 7, bRuns: 14 })
  })

  it('lists every meeting in date order, with the running tally only on a result that counts', () => {
    const s = seasonSeries(schedule, 'SF', 'BOS')
    expect(s.meetings.map(m => m.game.game_date)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-09-09'])
    expect(s.meetings.map(m => m.tally)).toEqual([{ a: 1, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 1 }, null, null])
    expect(s.meetings.map(m => m.winnerId)).toEqual(['SF', 'BOS', 'SF', null, 'SF'])
    expect(s.meetings.map(m => m.postseason)).toEqual([false, false, false, false, true])
  })

  it('has no postseason line for a pair that never met there', () => {
    expect(seasonSeries(schedule, 'LA', 'NY').postseason).toBeNull()
  })
})

describe('series leaders', () => {
  const g1 = game({ id: 's1', home_team_id: 'SF', away_team_id: 'BOS' })
  const g2 = game({ id: 's2', home_team_id: 'BOS', away_team_id: 'SF' })
  const other = game({ id: 'o1', home_team_id: 'SF', away_team_id: 'LA' })
  const games = [g1, g2, other]
  // On Los Angeles now; both of the lines below were for Boston.
  const traded = { id: 't', name: 'Diana Ibarra', team_id: 'LA' } as WpblPlayer
  const star = { id: 'a', name: 'Kelsie Whitmore', team_id: 'SF' } as WpblPlayer
  const ace = { id: 'p', name: 'Ayami Sato', team_id: 'SF' } as WpblPlayer
  const players = [traded, star, ace]

  it('ranks only lines from these games, and draws each player with the club they played for in them', () => {
    const batting = [
      bat({ game_id: 's1', player_id: 'a', ab: 4, h: 3, hr: 1 }),
      bat({ game_id: 's2', player_id: 'a', ab: 3, h: 1 }),
      bat({ game_id: 's1', player_id: 't', team_id: 'BOS', ab: 4, h: 1 }),
      bat({ game_id: 's2', player_id: 't', team_id: 'BOS', ab: 4, h: 1 }),
      // A big day against someone else, which must not count here.
      bat({ game_id: 'o1', player_id: 't', team_id: 'BOS', ab: 4, h: 4, hr: 2 }),
    ]
    const { batters, gamesPlayed } = seriesLeaders(players, batting, [], games, 'SF', 'BOS', 'regular')
    expect(gamesPlayed).toBe(2)
    expect(batters.map(b => [b.season.player.id, b.teamId, b.season.totals.h])).toEqual([['a', 'SF', 4], ['t', 'BOS', 2]])
  })

  it('holds a pitcher to the innings bar for the games played', () => {
    const { minOuts } = seriesQualifiers(2)
    const pitching = [
      pit({ game_id: 's1', player_id: 'p', outs: minOuts, er: 1 }),
      pit({ game_id: 's2', player_id: 'a', outs: minOuts - 1, er: 0 }),
    ]
    const { pitchers } = seriesLeaders(players, [], pitching, games, 'SF', 'BOS', 'regular')
    expect(pitchers.map(p => p.season.player.id)).toEqual(['p'])
  })
})
