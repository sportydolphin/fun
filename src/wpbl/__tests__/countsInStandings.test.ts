import { describe, it, expect } from 'vitest'
import { countsInStandings, computeStandings } from '../api'
import type { WpblGame, WpblTeam } from '../types'

// The postseason (Sep 9 to Sep 22, 2026: two best-of-three semifinals, then a best-of-five
// championship) produces real finals with real scores. Every one of them would otherwise land
// in the standings, run differential, streaks, last-10 and the head-to-head tiebreak, so a club
// that finished 3-4 could be shown 6-5 and nothing would look broken.
//
// These pin the fail-open contract as much as the filtering. The feed has not sent a postseason
// row yet, so which signal it will use is a guess: the tests cover both, AND cover the case
// where it uses neither recognisable value, because that one must keep counting rather than
// empty the table.

const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: Math.random().toString(36).slice(2),
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'BOS', away_team_id: 'SF',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 9, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

describe('countsInStandings', () => {
  it('counts a regular-season game as the feed sends it today', () => {
    expect(countsInStandings(game())).toBe(true)
  })

  it('drops a game the feed flags out of the standings', () => {
    expect(countsInStandings(game({ counts_in_standings: false }))).toBe(false)
  })

  it('drops the postseason round names the published schedule uses', () => {
    for (const t of ['semifinal', 'Semifinal A', 'championship', 'Championship Game 5', 'postseason', 'playoff']) {
      expect(countsInStandings(game({ game_type: t, counts_in_standings: true }))).toBe(false)
    }
  })

  // The important one. A game type nobody anticipated must COUNT, not vanish: being wrong by a
  // couple of games is visible and recoverable, while a filter that silently excludes
  // everything renders four clubs at 0-0 and looks like a data outage.
  it('counts a game whose type it does not recognise', () => {
    expect(countsInStandings(game({ game_type: 'exhibition-ish', counts_in_standings: null }))).toBe(true)
  })

  it('counts a hand-entered row that states neither signal', () => {
    expect(countsInStandings(game({ game_type: undefined, counts_in_standings: undefined }))).toBe(true)
  })

  // "final" appears in every completed game's status and in "Semifinal"/"Championship". The
  // pattern must not key on the bare word, or every regular-season game would drop out.
  it('does not treat the word "final" as a postseason marker', () => {
    expect(countsInStandings(game({ game_type: 'regular', status: 'final' }))).toBe(true)
  })
})

describe('computeStandings with a postseason', () => {
  const teams: WpblTeam[] = (['BOS', 'SF'] as const).map(id => ({
    id, city: id, name: id, abbr: id, color: null, color_secondary: null,
    logo_url: null, sort_order: 0, api_id: null, created_at: '',
  }))

  it('leaves the regular-season record untouched when a championship is played', () => {
    const regular = [
      game({ game_date: '2026-08-01', home_score: 5, away_score: 2 }),   // BOS beats SF
      game({ game_date: '2026-08-02', home_score: 1, away_score: 4 }),   // SF beats BOS
    ]
    const before = computeStandings(teams, regular)
    const bosBefore = before.find(r => r.team.id === 'BOS')!

    // SF sweeps a best-of-three semifinal a month later.
    const withPlayoffs = [...regular,
      game({ game_date: '2026-09-09', game_type: 'Semifinal A', counts_in_standings: false, home_score: 0, away_score: 9 }),
      game({ game_date: '2026-09-11', game_type: 'Semifinal A', counts_in_standings: false, home_score: 1, away_score: 8 }),
    ]
    const after = computeStandings(teams, withPlayoffs)
    const bosAfter = after.find(r => r.team.id === 'BOS')!

    expect(bosAfter.wins).toBe(bosBefore.wins)
    expect(bosAfter.losses).toBe(bosBefore.losses)
    // Run differential is the quiet one: two blowouts would swing it by 16 without the filter.
    expect(bosAfter.runsFor - bosAfter.runsAgainst).toBe(bosBefore.runsFor - bosBefore.runsAgainst)
    expect(bosAfter.streak).toEqual(bosBefore.streak)
  })
})

// Games back is now on the home page as well as the Standings tab, and it had no test at all.
// It is the one standings figure that is not a plain count: it is derived from the LEADER's
// record as well as the club's own, so it is the one that silently goes wrong when the sort
// order changes or a game is filtered out from under it.
describe('games back', () => {
  const teams: WpblTeam[] = (['BOS', 'SF'] as const).map(id => ({
    id, city: id, name: id, abbr: id, color: null, color_secondary: null,
    logo_url: null, sort_order: 0, api_id: null, created_at: '',
  }))

  // BOS wins `bos` of the games, SF wins the rest, one per day so the order is unambiguous.
  const series = (bos: number, sf: number): WpblGame[] => [
    ...Array.from({ length: bos }, (_, i) =>
      game({ game_date: `2026-08-${String(i + 1).padStart(2, '0')}`, home_score: 5, away_score: 2 })),
    ...Array.from({ length: sf }, (_, i) =>
      game({ game_date: `2026-08-${String(i + 11).padStart(2, '0')}`, home_score: 2, away_score: 5 })),
  ]

  it('is zero for the leader and half a game per game of separation', () => {
    // Head to head only, so every BOS win is also an SF loss: 3-1 against 1-3 is two games.
    const rows = computeStandings(teams, series(3, 1))
    expect(rows[0].team.id).toBe('BOS')
    expect(rows[0].gamesBack).toBe(0)
    expect(rows[1].gamesBack).toBe(2)
  })

  it('is zero for both clubs when they are level', () => {
    const rows = computeStandings(teams, series(2, 2))
    expect(rows.map(r => r.gamesBack)).toEqual([0, 0])
  })

  it('produces the half game that unequal games played makes', () => {
    // The half game cannot come from these two alone: playing only each other, every BOS win
    // is an SF loss, so the two halves of the formula always add to a whole number. It takes a
    // third club, and a pair who have not played the same number of games. This is the real
    // table on 2026-08-20, where the Firebells were 5-3 and the Queens 4-3: one fewer win but
    // one fewer loss too, which is half a game, and the reason the column is formatted to a
    // decimal place at all.
    const three: WpblTeam[] = (['BOS', 'SF', 'NY'] as const).map(id => ({
      id, city: id, name: id, abbr: id, color: null, color_secondary: null,
      logo_url: null, sort_order: 0, api_id: null, created_at: '',
    }))
    const g = (date: string, home: string, away: string, hs: number, as_: number) =>
      game({ game_date: date, home_team_id: home, away_team_id: away, home_score: hs, away_score: as_ })
    const rows = computeStandings(three, [
      // BOS finishes 5-3, SF finishes 4-3, all of it against NY so neither result touches the
      // other's record.
      ...Array.from({ length: 5 }, (_, i) => g(`2026-08-0${i + 1}`, 'BOS', 'NY', 9, 0)),
      ...Array.from({ length: 3 }, (_, i) => g(`2026-08-1${i}`, 'BOS', 'NY', 0, 9)),
      ...Array.from({ length: 4 }, (_, i) => g(`2026-08-2${i}`, 'SF', 'NY', 9, 0)),
      ...Array.from({ length: 3 }, (_, i) => g(`2026-07-0${i + 1}`, 'SF', 'NY', 0, 9)),
    ])
    const bos = rows.find(r => r.team.id === 'BOS')!
    const sf  = rows.find(r => r.team.id === 'SF')!
    expect([bos.wins, bos.losses]).toEqual([5, 3])
    expect([sf.wins, sf.losses]).toEqual([4, 3])
    expect(bos.gamesBack).toBe(0)
    expect(sf.gamesBack).toBe(0.5)
    expect(sf.gamesBack.toFixed(1)).toBe('0.5')
  })

  it('counts a whole game per result when the two have played the same number', () => {
    // 2-1 against 1-2 is one game clear, not two: ((2-1) + (2-1)) / 2.
    expect(computeStandings(teams, series(2, 1))[1].gamesBack).toBe(1)
  })

  it('is zero for everyone before a game has been played', () => {
    // Nothing to be behind by, and a leaderless table must not produce NaN.
    const rows = computeStandings(teams, [])
    expect(rows.map(r => r.gamesBack)).toEqual([0, 0])
  })

  it('ignores the postseason, like every other standings figure', () => {
    const regular = series(3, 1)
    const withPlayoffs = [...regular,
      game({ game_date: '2026-09-09', game_type: 'Semifinal A', counts_in_standings: false, home_score: 0, away_score: 9 }),
      game({ game_date: '2026-09-11', game_type: 'Semifinal A', counts_in_standings: false, home_score: 0, away_score: 8 }),
    ]
    expect(computeStandings(teams, withPlayoffs)[1].gamesBack).toBe(2)
  })
})
