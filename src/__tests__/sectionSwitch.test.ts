import { describe, it, expect } from 'vitest'
import { otherSectionPath } from '../sectionSwitch'

describe('otherSectionPath', () => {
  it('keeps the tab across the league switch, both ways', () => {
    const pairs: [string, string][] = [
      ['/mlb', '/wpbl'],
      ['/mlb/scores', '/wpbl/schedule'],
      ['/mlb/standings', '/wpbl/standings'],
      ['/mlb/teams', '/wpbl/teams'],
      ['/mlb/glossary', '/wpbl/glossary'],
      ['/mlb/compare', '/wpbl/compare'],
    ]
    for (const [mlb, wpbl] of pairs) {
      expect(otherSectionPath(mlb, false)).toBe(wpbl)
      expect(otherSectionPath(wpbl, true)).toBe(mlb)
    }
  })

  it('keeps the Stats board where both leagues have it', () => {
    expect(otherSectionPath('/mlb/leaders', false)).toBe('/wpbl/stats')
    expect(otherSectionPath('/wpbl/stats', true)).toBe('/mlb/leaders')
    expect(otherSectionPath('/mlb/stats', false)).toBe('/wpbl/stats?board=players')
    expect(otherSectionPath('/wpbl/stats', true, '?board=players&sort=hr')).toBe('/mlb/stats')
    // A board only one league has goes to the other's Leaders.
    expect(otherSectionPath('/wpbl/stats', true, '?board=runs')).toBe('/mlb/leaders')
    // Charts is a mode of MLB's Standings, so it goes to WPBL's.
    expect(otherSectionPath('/mlb/charts', false)).toBe('/wpbl/standings')
  })

  // The two Stats tabs have the same five boards and the same three sides, so the switch keeps both.
  it('keeps the board and the side into WPBL', () => {
    expect(otherSectionPath('/mlb/team-stats', false)).toBe('/wpbl/stats?board=teams')
    expect(otherSectionPath('/mlb/team-stats', false, '?lb=pitching')).toBe('/wpbl/stats?board=teams&side=pitching')
    expect(otherSectionPath('/mlb/team-stats', false, '?lb=fielding')).toBe('/wpbl/stats?board=teams&side=fielding')
    expect(otherSectionPath('/mlb/fielding', false)).toBe('/wpbl/stats?board=players&side=fielding')
    expect(otherSectionPath('/mlb/leaders', false, '?lb=fielding')).toBe('/wpbl/stats?side=fielding')
    expect(otherSectionPath('/mlb/find', false, '?lb=pitching')).toBe('/wpbl/stats?board=find&side=pitching')
  })

  it('keeps the board and the side into MLB', () => {
    expect(otherSectionPath('/wpbl/stats', true, '?board=teams&side=pitching')).toBe('/mlb/team-stats?lb=pitching')
    expect(otherSectionPath('/wpbl/stats', true, '?board=teams&side=fielding')).toBe('/mlb/team-stats?lb=fielding')
    expect(otherSectionPath('/wpbl/stats', true, '?board=players&side=fielding')).toBe('/mlb/fielding')
    expect(otherSectionPath('/wpbl/stats', true, '?board=fielding')).toBe('/mlb/fielding')
    expect(otherSectionPath('/wpbl/stats', true, '?side=fielding')).toBe('/mlb/leaders?lb=fielding')
    expect(otherSectionPath('/wpbl/stats', true, '?board=bests&side=pitching')).toBe('/mlb/bests?lb=pitching')
    expect(otherSectionPath('/wpbl/stats', true, '?board=find')).toBe('/mlb/find')
  })

  it('sends a page with no counterpart to Home, and a club page to Teams', () => {
    expect(otherSectionPath('/mlb/players/shohei-ohtani-660271', false)).toBe('/wpbl')
    expect(otherSectionPath('/mlb/games/776543', false)).toBe('/wpbl')
    expect(otherSectionPath('/mlb/teams/red-sox', false)).toBe('/wpbl/teams')
    expect(otherSectionPath('/wpbl/players/kelsie-whitmore', true)).toBe('/mlb')
    expect(otherSectionPath('/wpbl/api', true)).toBe('/mlb')
  })

  it('ignores a trailing slash', () => {
    expect(otherSectionPath('/mlb/standings/', false)).toBe('/wpbl/standings')
    expect(otherSectionPath('/wpbl/standings/', true)).toBe('/mlb/standings')
  })
})
