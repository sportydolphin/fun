// The phrasings the search reads beyond its first grammar: thresholds said aloud, single-game
// records, a ranking among one position or role, and the position filter both boards apply.

import { describe, expect, it } from 'vitest'
import { finderSuggestions, leaderSuggestions, positionRankSuggestions, recordSuggestions } from '../finderSearch'
import { matchesPositionFilter, parsePositionFilter } from '../league/positionFilter'

const findTitles = (t: string) => finderSuggestions('wpbl', t).map(f => f.title)

describe('thresholds as people say them', () => {
  it('reads a batting average without its point', () => {
    expect(findTitles('300 hitters')).toEqual(['Batting average at least .300'])
    expect(findTitles('hitting 300')).toEqual(['Batting average at least .300'])
  })
  it('keeps both ends of a range', () => {
    expect(findTitles('era between 2 and 3')).toEqual(['ERA at least 2.00 and ERA at most 3.00'])
  })
  it('reads double digits as ten or more', () => {
    expect(findTitles('double digit hr')[0]).toBe('Home runs at least 10')
  })
})

describe('single-game records', () => {
  it('opens Bests at the card, and not the season leaders', () => {
    expect(recordSuggestions('mlb', 'most hr in a game')).toEqual([expect.objectContaining({ href: '/mlb/bests', scrollTo: 'best-hr' })])
    expect(leaderSuggestions('mlb', 'most hr in a game')).toEqual([])
    expect(recordSuggestions('wpbl', 'longest scoreless outing')[0]).toMatchObject({ scrollTo: 'best-scoreless' })
  })
  it('offers nothing for a record no card keeps, or for the low end', () => {
    expect(recordSuggestions('mlb', 'most walks in a game')).toEqual([])
    expect(recordSuggestions('mlb', 'fewest hr in a game')).toEqual([])
  })
  it('leaves a season ranking alone', () => {
    expect(recordSuggestions('mlb', 'most hr')).toEqual([])
  })
})

describe('a ranking among one position or role', () => {
  it('narrows the players board', () => {
    expect(positionRankSuggestions('wpbl', 'most hr by a shortstop')[0]).toMatchObject({
      title: 'Most home runs among shortstops', href: '/wpbl/stats?board=players&side=hitting&sort=hr&dir=desc&pos=SS',
    })
    expect(positionRankSuggestions('mlb', 'top relievers')[0]).toMatchObject({ href: '/mlb/stats?lb=pitching&pos=RP' })
  })
  it('needs a word saying it is a ranking, so a roster question stays one', () => {
    expect(positionRankSuggestions('wpbl', 'catchers')).toEqual([])
    expect(positionRankSuggestions('wpbl', 'SF catchers')).toEqual([])
  })
  it('never reads doubles or triples as a base', () => {
    expect(positionRankSuggestions('mlb', 'most 2b')).toEqual([])
  })
})

describe('the position filter', () => {
  it('drops what it does not know', () => {
    expect(parsePositionFilter('ss')).toBe('SS')
    expect(parsePositionFilter('XX')).toBeNull()
  })
  it('groups the outfield and the infield, and reads a split label', () => {
    expect(matchesPositionFilter('OF', 'CF')).toBe(true)
    expect(matchesPositionFilter('IF', 'SS/2B')).toBe(true)
    expect(matchesPositionFilter('2B', 'SS/2B')).toBe(true)
    expect(matchesPositionFilter('C', 'CF')).toBe(false)
  })
  it('tells a starter from a reliever by the season, half or more starts being a starter', () => {
    expect(matchesPositionFilter('SP', 'P', { g: 10, gs: 5 })).toBe(true)
    expect(matchesPositionFilter('RP', 'P', { g: 10, gs: 4 })).toBe(true)
    expect(matchesPositionFilter('RP', 'P', null)).toBe(false)
  })
})
