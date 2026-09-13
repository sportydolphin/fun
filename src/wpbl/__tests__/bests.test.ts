import { describe, it, expect } from 'vitest'
import { wpblBestGames } from '../derive/bests'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

// The single-game records board, and the four ways it could quietly publish a wrong record.
// Every one of these renders perfectly and is wrong:
//
//   - a postseason line standing as a regular-season league record;
//   - a line from a game still being played, ranked as if it were finished;
//   - a tie numbered 1, 2, which asserts an order the numbers do not support;
//   - a traded player filed under the club they play for NOW rather than the one they played
//     for that night, which is the section's standing identity trap (see CLAUDE.md).

const A = { id: 'a', name: 'Ayami Sato', team_id: 'SF' } as WpblPlayer
const B = { id: 'b', name: 'Jaida Lee', team_id: 'LA' } as WpblPlayer
// Traded: the roster row says LA now, and both of the lines below were thrown for SF.
const C = { id: 'c', name: 'Emi Saiki', team_id: 'LA' } as WpblPlayer

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', status: 'final', game_date: '2026-08-07',
  home_team_id: 'SF', away_team_id: 'LA',
  game_type: 'regular', counts_in_standings: true, ...o,
} as WpblGame)

const bat = (o: Partial<WpblBattingLine> = {}): WpblBattingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'SF',
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, ibb: 0, gdp: 0, tb: 0, lob: 0, ...o,
} as WpblBattingLine)

const pit = (o: Partial<WpblPitchingLine> = {}): WpblPitchingLine => ({
  id: Math.random().toString(36).slice(2), game_id: 'g1', player_id: 'a', team_id: 'SF',
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, pitches: 0, decision: null,
  gs: 0, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 0, doubles: 0, triples: 0, ...o,
} as WpblPitchingLine)

const board = (boards: ReturnType<typeof wpblBestGames>, key: string) => {
  const b = boards.find(x => x.key === key)
  if (!b) throw new Error(`no board ${key}`)
  return b
}

describe('the single-game records board', () => {
  it('ranks the most strikeouts in a game, and the line it came from', () => {
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', so: 4, outs: 15, h: 4, bb: 0 }),
      pit({ player_id: 'b', so: 6, outs: 11, h: 1, bb: 0 }),
    ]
    const rows = board(wpblBestGames('pitching', [], lines, [A, B], games), 'so').rows
    expect(rows[0].name).toBe('Jaida Lee')
    expect(rows[0].value).toBe(6)
    expect(rows[0].display).toBe('6')
    expect(rows[0].detail).toBe('3.2 IP, 1 H, 0 BB')
  })

  it('draws innings in baseball notation, not in thirds', () => {
    // 16 outs is 5.1, and a board that printed 5.33 would be reporting a number this sport
    // does not use. The stored unit is outs precisely because the display is not decimal.
    const rows = board(
      wpblBestGames('pitching', [], [pit({ outs: 16, h: 4, r: 5, so: 2 })], [A], [game()]),
      'outs').rows
    expect(rows[0].display).toBe('5.1')
    expect(rows[0].value).toBe(16)
  })

  it('gives tied lines the same rank and skips the next one', () => {
    // The strikeout record IS held jointly in this league, so this is the ordinary case and
    // not an edge one. 1, 2, 3 down a column of equal numbers would be the site inventing a
    // winner between two people who did the same thing.
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', so: 6, outs: 15 }),
      pit({ player_id: 'b', so: 6, outs: 11 }),
      pit({ player_id: 'c', so: 3, outs: 9 }),
    ]
    const rows = board(wpblBestGames('pitching', [], lines, [A, B, C], games), 'so').rows
    expect(rows.map(r => r.rank)).toEqual([1, 1, 3])
    // The shorter outing leads among equals: the tiebreak orders the rows without changing
    // either rank.
    expect(rows[0].name).toBe('Jaida Lee')
  })

  it('extends the cut through a tie rather than dropping half of one', () => {
    // Five rows requested, six lines tied at the bottom value. Publishing "the top five" while
    // silently omitting somebody who did exactly what the fifth did is the one error a records
    // board cannot make.
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', so: 9, outs: 15 }),
      ...Array.from({ length: 5 }, () => pit({ player_id: 'b', so: 4, outs: 9 })),
    ]
    const rows = board(wpblBestGames('pitching', [], lines, [A, B], games), 'so').rows
    expect(rows).toHaveLength(6)
    expect(rows.map(r => r.rank)).toEqual([1, 2, 2, 2, 2, 2])
  })

  it('keeps a postseason line out of the regular-season record, and vice versa', () => {
    // The feed sends `counts_in_standings: true` on postseason rows, so `game_type` is the
    // only thing holding these apart. A playoff gem standing as the league's regular-season
    // record would overwrite one book with another.
    const games = [
      game({ id: 'reg', game_date: '2026-08-07' }),
      game({ id: 'post', game_date: '2026-09-12', game_type: 'postseason', counts_in_standings: true }),
    ]
    const lines = [
      pit({ player_id: 'a', game_id: 'reg', so: 5, outs: 15 }),
      pit({ player_id: 'b', game_id: 'post', so: 9, outs: 15 }),
    ]
    const regular = board(wpblBestGames('pitching', [], lines, [A, B], games, 'regular'), 'so').rows
    expect(regular.map(r => r.name)).toEqual(['Ayami Sato'])

    const post = board(wpblBestGames('pitching', [], lines, [A, B], games, 'postseason'), 'so').rows
    expect(post.map(r => r.name)).toEqual(['Jaida Lee'])

    const both = board(wpblBestGames('pitching', [], lines, [A, B], games, 'all'), 'so').rows
    expect(both.map(r => r.name)).toEqual(['Jaida Lee', 'Ayami Sato'])
  })

  it('will not rank a line from a game that is still being played', () => {
    // A pitcher four strikeouts into the third has not set a record; the outing is still going,
    // and a board that ranked that line would move under the reader as the game went on.
    const games = [game({ id: 'done' }), game({ id: 'live', status: 'live' })]
    const lines = [
      pit({ player_id: 'a', game_id: 'done', so: 3, outs: 15 }),
      pit({ player_id: 'b', game_id: 'live', so: 6, outs: 8 }),
    ]
    const rows = board(wpblBestGames('pitching', [], lines, [A, B], games), 'so').rows
    expect(rows.map(r => r.name)).toEqual(['Ayami Sato'])
  })

  it('takes the club off the LINE, never off the roster row', () => {
    // Emi Saiki's roster row says LA. The line below was thrown for SF, and the badge beside a
    // record has to say where that line was played: the league mints a new player id per club
    // and the ingest moves a traded player forward, so the roster only ever means "now".
    const rows = board(
      wpblBestGames('pitching', [], [pit({ player_id: 'c', team_id: 'SF', so: 7, outs: 15 })], [C], [game()]),
      'so').rows
    expect(rows[0].name).toBe('Emi Saiki')
    expect(rows[0].teamId).toBe('SF')
  })

  it('counts total bases the way the feed does, so three home runs beat four singles', () => {
    // The board that separates Kelsie Whitmore's 3-for-4 with three home runs from a
    // four-single afternoon, which is the whole reason total bases leads the hitting side.
    const games = [game()]
    const lines = [
      bat({ player_id: 'a', ab: 4, h: 3, hr: 3, rbi: 6, tb: 12 }),
      bat({ player_id: 'b', ab: 4, h: 4, rbi: 1, tb: 4 }),
    ]
    const boards = wpblBestGames('hitting', lines, [], [A, B], games)
    expect(board(boards, 'tb').rows[0].value).toBe(12)
    expect(board(boards, 'tb').rows[0].detail).toBe('3-for-4, 3 HR, 6 RBI')
    // And the hits board ranks them the other way round, which is the point of having both.
    expect(board(boards, 'h').rows[0].name).toBe('Jaida Lee')
  })

  it('leaves a player off a board they did nothing on', () => {
    // A pitcher is listed in the box score of every game they pitch with an all-zero batting
    // line. Ninety-seven of the season's 610 batting lines have no plate appearance at all, so
    // a board that ranked zeroes would be most of the league tied at the bottom of every one.
    const boards = wpblBestGames('hitting', [bat({ ab: 0 })], [], [A], [game()])
    expect(board(boards, 'hr').rows).toHaveLength(0)
    expect(board(boards, 'sb').rows).toHaveLength(0)
    expect(board(boards, 'ob').rows).toHaveLength(0)
  })

  it('ranks the longest scoreless outing by length, not by tidiness', () => {
    // The board that stands in for a game score. A perfect single inning is not a better
    // outing than five scoreless, and a formula with a 50-point baseline would have said it
    // nearly was: see the note at the top of derive/bests.ts.
    const games = [game()]
    const lines = [
      pit({ player_id: 'a', outs: 15, r: 0, h: 4, bb: 0, so: 4 }),
      pit({ player_id: 'b', outs: 3, r: 0, h: 0, bb: 0, so: 3 }),
      pit({ player_id: 'c', outs: 18, r: 1, er: 0, h: 2, bb: 0, so: 5 }),
    ]
    const rows = board(wpblBestGames('pitching', [], lines, [A, B, C], games), 'scoreless').rows
    expect(rows.map(r => r.name)).toEqual(['Ayami Sato', 'Jaida Lee'])
    expect(rows[0].display).toBe('5.0')
  })

  it('counts an UNEARNED run against a scoreless outing', () => {
    // "Scoreless" is runs, not earned runs. A pitcher who gave up a run on an error did not
    // throw a scoreless outing, whoever the box score charges it to.
    const rows = board(
      wpblBestGames('pitching', [], [pit({ outs: 15, r: 1, er: 0 })], [A], [game()]),
      'scoreless').rows
    expect(rows).toHaveLength(0)
  })
})
