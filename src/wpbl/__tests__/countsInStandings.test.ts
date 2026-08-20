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
