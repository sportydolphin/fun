import { describe, expect, it } from 'vitest'
import { finderSuggestions, leaderSuggestions } from '../finderSearch'

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
