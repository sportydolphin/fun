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
    expect(otherSectionPath('/mlb/stats', false)).toBe('/wpbl/stats')
    expect(otherSectionPath('/wpbl/stats', true, '?board=players&sort=hr')).toBe('/mlb/stats')
    // A board only one league has goes to the other's Leaders.
    expect(otherSectionPath('/mlb/charts', false)).toBe('/wpbl/stats')
    expect(otherSectionPath('/wpbl/stats', true, '?board=runs')).toBe('/mlb/leaders')
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
