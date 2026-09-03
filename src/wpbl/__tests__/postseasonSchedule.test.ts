import { describe, it, expect } from 'vitest'
import { computeStandings } from '../api'
import { postseasonScheduleRows } from '../derive/bracket'
import type { WpblGame, WpblTeam } from '../types'

// The postseason rows the schedule prints before the feed has any games for it. The whole
// value of this list is that it says only true things about a bracket nobody has drawn yet, so
// what is pinned here is mostly what it REFUSES to claim: no club in a slot that can still
// move, no "@" it cannot know, no if-necessary game after a series is over, and nothing at all
// on a date the feed has taken over.

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

let day = 0
const date = () => `2026-08-${String((day++ % 28) + 1).padStart(2, '0')}`
const win = (winner: string, loser: string): WpblGame =>
  game({ game_date: date(), home_team_id: winner, away_team_id: loser, home_score: 6, away_score: 1 })

/** SF 1st, LA 2nd, NY 3rd, BOS 4th, on wins alone, with nothing left to play. */
const finished = (): WpblGame[] => [
  win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'NY'),
  win('LA', 'BOS'), win('LA', 'BOS'), win('LA', 'NY'),
  win('NY', 'BOS'), win('BOS', 'NY'),
]

const rowsFor = (games: WpblGame[]) => postseasonScheduleRows(computeStandings(TEAMS, games), games)
/** The same thing, named for what the tiebreak tests are actually asking it. */
const teamSpecsSeeds = rowsFor
const bySeries = (games: WpblGame[], label: string) => rowsFor(games).filter(r => r.label === label)

describe('postseasonScheduleRows', () => {
  it('prints the published calendar: two semifinals and a best-of-five final', () => {
    const rows = rowsFor(finished())
    expect(bySeries(finished(), 'Semifinal A')).toHaveLength(3)
    expect(bySeries(finished(), 'Championship')).toHaveLength(5)
    // Date order across all three series, which is how the schedule reads them.
    expect(rows.map(r => r.date)).toEqual([...rows.map(r => r.date)].sort())
    expect(rows[0].date).toBe('2026-09-09')
    expect(rows[rows.length - 1].date).toBe('2026-09-22')
  })

  it('names a club only once that seed can no longer move', () => {
    const rows = rowsFor(finished())
    const g1 = rows.find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team?.id).toBe('SF')
    expect(g1.second.team?.id).toBe('BOS')
  })

  // The reason this is seed-based rather than a projection. Mid-season every slot is still
  // live, and a schedule that named clubs would be naming the wrong ones.
  it('falls back to the seed number while the race is open', () => {
    const open = [win('SF', 'BOS'), win('LA', 'NY'), game({ game_date: '2026-09-06', status: 'scheduled', home_score: null, away_score: null })]
    const g1 = rowsFor(open).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team).toBeNull()
    expect(g1.first.label).toBe('1 seed')
    expect(g1.second.label).toBe('4 seed')
  })

  // The top seed usually locks days before the bottom two stop swapping. Holding every slot
  // vague until the whole bracket settles would say less than we know.
  it('settles one seed at a time rather than waiting for the whole bracket', () => {
    // SF has 4 wins and nobody else can reach 4, but LA/NY/BOS are still tangled.
    const partial = [
      win('SF', 'BOS'), win('SF', 'BOS'), win('SF', 'NY'), win('SF', 'LA'),
      win('LA', 'NY'), win('NY', 'BOS'), win('BOS', 'LA'),
      game({ game_date: '2026-09-05', status: 'scheduled', home_team_id: 'LA', away_team_id: 'NY', home_score: null, away_score: null }),
      game({ game_date: '2026-09-06', status: 'scheduled', home_team_id: 'BOS', away_team_id: 'NY', home_score: null, away_score: null }),
    ]
    const g1 = rowsFor(partial).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!
    expect(g1.first.team?.id).toBe('SF')   // locked
    expect(g1.second.team).toBeNull()      // the 4 seed is still being fought over
    expect(g1.second.label).toBe('4 seed')
  })

  // A published game always wins. This is what lets the constant retire itself instead of
  // needing to be deleted the day the league draws the bracket.
  it('yields the date to a real postseason game from the feed', () => {
    const games = [...finished(), game({
      game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS',
      game_type: 'Semifinal A', counts_in_standings: false, status: 'scheduled',
      home_score: null, away_score: null,
    })]
    expect(rowsFor(games).some(r => r.date === '2026-09-09')).toBe(false)
    expect(rowsFor(games).some(r => r.date === '2026-09-11')).toBe(true)
  })

  // The one way this list can be actively false rather than merely vague.
  it('drops an if-necessary game once the series is decided', () => {
    const swept = [...finished(),
      game({ game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', home_score: 5, away_score: 1, game_type: 'Semifinal A', counts_in_standings: false }),
      game({ game_date: '2026-09-11', home_team_id: 'SF', away_team_id: 'BOS', home_score: 4, away_score: 2, game_type: 'Semifinal A', counts_in_standings: false }),
    ]
    // Sep 13 is Semifinal A game 3, marked if-necessary, and SF have already won 2-0.
    expect(rowsFor(swept).some(r => r.date === '2026-09-13')).toBe(false)
    // Semifinal B is untouched by that, and its own game 3 is still on the board.
    expect(rowsFor(swept).some(r => r.date === '2026-09-14')).toBe(true)
  })

  // THE TWO HALVES OF THE TIEBREAK, on the real table of Sep 3, 2026.
  //
  // A clinch is not a statement about wins alone, because the standings break a tie on head to
  // head. Whether a club that can only DRAW LEVEL with you is a threat depends on who holds that
  // series and whether it is finished, and these two go opposite ways on the same arithmetic.
  //
  // BALANCED, every pair meeting five times so every club plays fifteen. `computeStandings`
  // sorts on win PERCENTAGE, so a fixture with uneven games played can rank a 7-3 club above a
  // 9-5 one, and a draft of this test did exactly that and asked the wrong question.
  //
  //   SF 9-4  LA 7-6  NY 6-7  BOS 4-9, two to play each
  //   SF-LA 3-2 finished · NY-BOS 3-2 to BOS finished · the other four have one left
  const beat = (winner: string, loser: string, n: number) =>
    Array.from({ length: n }, () => win(winner, loser))
  const toPlay = (home: string, away: string) => game({
    game_date: '2026-09-05', home_team_id: home, away_team_id: away,
    status: 'scheduled', home_score: null, away_score: null,
  })
  const season = () => [
    ...beat('SF', 'LA', 3), ...beat('LA', 'SF', 2),
    ...beat('SF', 'NY', 2), ...beat('NY', 'SF', 2), toPlay('NY', 'SF'),
    ...beat('SF', 'BOS', 4), toPlay('SF', 'BOS'),
    ...beat('LA', 'NY', 2), ...beat('NY', 'LA', 2), toPlay('LA', 'NY'),
    ...beat('LA', 'BOS', 3), ...beat('BOS', 'LA', 1), toPlay('BOS', 'LA'),
    ...beat('NY', 'BOS', 2), ...beat('BOS', 'NY', 3),
  ]
  const semiA1 = (games: WpblGame[]) =>
    rowsFor(games).find(r => r.label === 'Semifinal A' && r.gameNumber === 1)!

  // Los Angeles' ceiling is 9 and San Francisco's floor is 9, so the only way LA catch them is a
  // 9-6 tie, and SF hold that series 3-2 with nothing left in it. This list said "1 seed".
  it('names a club that has clinched on a tiebreak it can no longer lose', () => {
    expect(semiA1(season()).first.team?.id).toBe('SF')
  })

  // The mirror. Boston top out at 6 wins, which is exactly New York's total, and Boston hold
  // THAT series 3-2 with none left, so a tie goes their way and third is still reachable.
  it('will not name a club that wins the tie it can still force', () => {
    const g1 = semiA1(season())
    expect(g1.second.team).toBeNull()
    expect(g1.second.label).toBe('4 seed')
  })

  // A series with a game still in it decides nothing: the lead in it can change hands.
  it('will not spend a tiebreak that can still flip', () => {
    const games = season()
    const i = games.findIndex(g => g.home_team_id === 'SF' && g.away_team_id === 'LA')
    games[i] = toPlay('SF', 'LA')
    expect(semiA1(games).first.team).toBeNull()
  })

  it('carries the if-necessary flag so the card can mark it', () => {
    const rows = bySeries(finished(), 'Championship')
    expect(rows.filter(r => r.ifNecessary).map(r => r.gameNumber)).toEqual([4, 5])
  })

  // A partial league is a test fixture and an empty state, not a bracket.
  it('returns nothing when there are not four clubs', () => {
    const two = TEAMS.slice(0, 2)
    expect(postseasonScheduleRows(computeStandings(two, [win('SF', 'LA')]), [win('SF', 'LA')])).toEqual([])
  })
})
