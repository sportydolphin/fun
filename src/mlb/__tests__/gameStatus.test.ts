import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SCHEDULE_GAME_TYPES, SCORED_GAME_TYPES, isUnplayed, unplayedLabel, hasStartTime } from '../gameStatus'
import { isRealClub } from '../constants'

describe('unplayed games', () => {
  // Sep 27, 2026, BAL@NYY, rained out and never to be made up. It rendered as a 0-0 final.
  const cancelled = { abstractGameState: 'Final', codedGameState: 'C', detailedState: 'Cancelled' }
  const postponed = { abstractGameState: 'Final', codedGameState: 'D', detailedState: 'Postponed' }
  const final = { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' }

  it('treats a cancelled game as never played, not as a 0-0 final', () => {
    expect(isUnplayed(cancelled)).toBe(true)
    expect(unplayedLabel(cancelled)).toBe('Cancelled')
  })

  it('still treats a postponement the way it always did', () => {
    expect(isUnplayed(postponed)).toBe(true)
    expect(unplayedLabel(postponed)).toBe('Postponed')
  })

  it('leaves a real final alone', () => {
    expect(isUnplayed(final)).toBe(false)
  })
})

describe('postseason stand-in clubs', () => {
  it('knows the 30 clubs from a series placeholder', () => {
    expect(isRealClub(110)).toBe(true)    // Orioles
    expect(isRealClub(5528)).toBe(false)  // "HOU/CWS", before the Wild Card series is decided
  })
})

describe('start times', () => {
  it('does not trust a placeholder time', () => {
    // An undecided Division Series game is published at 07:33Z, which printed as "12:33 AM".
    expect(hasStartTime({ startTimeTBD: true })).toBe(false)
    expect(hasStartTime({ startTimeTBD: false })).toBe(true)
    expect(hasStartTime({})).toBe(true)
  })
})

describe('schedule reads include the postseason', () => {
  it('asks for every postseason round', () => {
    expect([...SCORED_GAME_TYPES].sort()).toEqual(['D', 'F', 'L', 'R', 'W'])
  })

  // Every schedule read used to pass gameType=R, which is invisible from March to September and
  // then empties the predictor, the game-start push and the reminders for the whole postseason.
  // A schedule read that means "regular season only" has to be listed here, with its reason.
  const REGULAR_SEASON_ON_PURPOSE: Record<string, string> = {
    'src/mlb/api.ts': 'strength of the remaining regular-season schedule, for playoff odds',
    'src/mlb/reportCardData.ts': 'streak report cards count regular-season games',
    'src/mlb/seriesDetail.ts': 'how two playoff clubs met over the regular season',
    'src/mlb/views/Spotlight.tsx': 'byDateRange has no postseason data, so the lookback cannot use it',
    'shared/mlbSeason.js': 'asks whether a regular-season makeup is still to be played',
    'scripts/simulate-playoff-odds.mjs': 'simulates the remaining regular season',
    'scripts/update-streaks.mjs': 'hitting streaks are regular-season records',
  }

  const root = join(__dirname, '..', '..', '..')
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(name) ? [p] : []
  })
  const files = [
    ...walk(join(root, 'src', 'mlb')),
    ...readdirSync(join(root, 'scripts')).filter(n => n.endsWith('.mjs')).map(n => join(root, 'scripts', n)),
    // The calendar both sides share (shared/mlbSeason.js) reads the schedule too.
    ...readdirSync(join(root, 'shared')).filter(n => n.endsWith('.js')).map(n => join(root, 'shared', n)),
  ]

  it('has no regular-season-only schedule read outside the list', () => {
    const offenders = files
      .map(p => ({ rel: p.slice(root.length + 1).split('\\').join('/'), src: readFileSync(p, 'utf8') }))
      // Only files that read the schedule: a stats or leaders read filtered to R is a season total
      // and is right. `gameType=R` followed by `&` or the end of the string is the filter itself,
      // which `gameType=R,F,…` is not.
      // Comments are skipped, since the ones explaining this rule quote the filter.
      .filter(f => f.src.includes('/schedule?') && f.src.split('\n')
        .some(line => !/^\s*(\/\/|\*)/.test(line) && /gameType=R[&`]/.test(line)))
      .map(f => f.rel)
      .filter(rel => !(rel in REGULAR_SEASON_ON_PURPOSE))
    expect(offenders).toEqual([])
  })

  it('offers the same list to the Node jobs', () => {
    expect(SCHEDULE_GAME_TYPES).toBe('R,F,D,L,W')
  })
})
