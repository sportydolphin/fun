import { describe, expect, it } from 'vitest'
import { clubPageSuggestions, finderSuggestions, leaderSuggestions, matchupSuggestions } from '../finderSearch'
import { gameRow } from '../lib/gameRow'

describe('leaderSuggestions', () => {
  it('links a WPBL ranking to the Players table sorted on that column', () => {
    const [r] = leaderSuggestions('wpbl', 'most hr 2026')
    expect(r.title).toBe('Most home runs')
    expect(r.href).toBe('/wpbl/stats?board=players&side=hitting&sort=hr&dir=desc&season=2026')
  })

  it('uses the MLB table\'s own column names', () => {
    const [r] = leaderSuggestions('mlb', 'strikeout leaders')
    expect(r.title).toBe('Most strikeouts')
    expect(r.href).toBe('/mlb/stats?lb=pitching&sort=k')
  })

  it('keeps an initialism in capitals', () => {
    expect(leaderSuggestions('wpbl', 'lowest era')[0].title).toBe('Lowest ERA')
  })

  it('offers no row for a stat the table has no column for', () => {
    expect(leaderSuggestions('wpbl', 'most holds')).toEqual([])
  })
})

describe('a year on a Find link', () => {
  it('carries the season to the board', () => {
    expect(finderSuggestions('wpbl', '3 hits 2026')[0].href).toContain('season=2026')
  })
})

describe('clubPageSuggestions', () => {
  it('opens a WPBL club page at the part asked for, and standings on its tab', () => {
    expect(clubPageSuggestions('wpbl', 'Firebells roster')).toEqual([{
      key: 'club-SF-roster', title: 'San Francisco Firebells roster', href: '/wpbl/teams/firebells', scrollTo: 'roster',
    }])
    expect(clubPageSuggestions('wpbl', 'SF standings')[0]).toMatchObject({ href: '/wpbl/standings', scrollTo: null })
  })

  it("sends MLB stats to the club page's leaders, its nearest part", () => {
    expect(clubPageSuggestions('mlb', 'Dodgers stats')[0]).toMatchObject({
      title: 'Los Angeles Dodgers team leaders', href: '/mlb/teams/dodgers', scrollTo: 'leaders',
    })
  })
})

describe('matchupSuggestions', () => {
  it('links two WPBL clubs to their season series page, one URL whichever order', () => {
    expect(matchupSuggestions('wpbl', 'Hunters vs Firebells')).toEqual([
      { key: 'matchup-/wpbl/series/firebells-vs-hunters', title: 'Hunters vs Firebells', href: '/wpbl/series/firebells-vs-hunters' },
    ])
  })

  it('offers none for a single game, or on MLB, which has no such page', () => {
    expect(matchupSuggestions('wpbl', 'Hunters vs Firebells sep 9')).toEqual([])
    expect(matchupSuggestions('mlb', 'Cubs vs Cardinals')).toEqual([])
  })
})

describe('gameRow', () => {
  it('reads a played game with its score and an unplayed one without', () => {
    expect(gameRow({ away: 'SF', home: 'NY', awayScore: 6, homeScore: 4, state: 'final', date: '2026-09-09', href: '/g' }))
      .toEqual({ title: 'SF 6 at NY 4', subtitle: 'Final · Sep 9, 2026', href: '/g' })
    expect(gameRow({ away: 'SF', home: 'NY', awayScore: null, homeScore: null, state: 'scheduled', date: '2027-05-01', href: '/g' }).title)
      .toBe('SF at NY')
  })
})
