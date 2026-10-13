import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreCard } from '../views/ScoreCard'
import type { FinalGameSummary, FinalTeam } from '../views/FinalGames'
import { mlbUrlFor, mlbSnapshotFromUrl } from '../routes'

// The Scores page's card in each state a day can hold. jsdom has no layout, so the card measures
// no room and draws R H E without the inning columns, which is the phone's narrowest fallback.

const team = (teamId: number, abbr: string, runs: number, extra: Partial<FinalTeam> = {}): FinalTeam =>
  ({ teamId, abbr, name: abbr, runs, hits: runs + 3, errors: 0, isWinner: false, record: '80-70', ...extra })

const base = (over: Partial<FinalGameSummary>): FinalGameSummary => ({
  gamePk: 1, state: 'final', startMs: Date.now(), statusText: 'Final',
  away: team(158, 'MIL', 7, { isWinner: true }), home: team(119, 'LAD', 4),
  winPitcher: null, losePitcher: null, savePitcher: null,
  ...over,
})

describe('ScoreCard', () => {
  it('prints a final with R H E and all three decisions', () => {
    render(<ScoreCard game={base({
      decisions: { win: { id: 1, name: 'Jacob Misiorowski' }, loss: { id: 2, name: 'Tyler Glasnow' }, save: { id: 3, name: 'Trevor Megill' } },
    })} />)
    expect(screen.getByText('R')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()   // MIL's hits
    const text = document.body.textContent ?? ''
    expect(text).toContain('Jacob Misiorowski')
    expect(text).toContain('SV')
  })

  it('draws a live game\'s outs and a count it clamps', () => {
    render(<ScoreCard game={base({
      state: 'live', statusText: '▲ 5th',
      live: { outs: 1, balls: 3, strikes: 2, onFirst: true, onSecond: false, onThird: false, between: false,
        batter: { id: 4, name: 'Christian Yelich' }, pitcher: { id: 5, name: 'Yoshinobu Yamamoto' } },
    })} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('1 out')
    expect(text).toContain('3–2')
    expect(text).toContain('Christian Yelich')
  })

  it('names who is due up between innings rather than a count for an at-bat not started', () => {
    render(<ScoreCard game={base({
      state: 'live', statusText: 'Mid 5th',
      live: { outs: 3, balls: 0, strikes: 0, onFirst: false, onSecond: false, onThird: false, between: true,
        batter: { id: 4, name: 'Christian Yelich' }, pitcher: null },
    })} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Due up')
    expect(text).not.toContain('3 outs')
  })

  it('gives an upcoming game its starters, channel and park', () => {
    render(<ScoreCard game={base({
      state: 'preview', statusText: '7:08 PM', startMs: Date.now() + 3_600_000,
      probables: { away: { id: 6, name: 'Freddy Peralta', hand: 'R', wins: 10, losses: 11, era: '4.42' }, home: null },
      tv: 'TBS', venue: 'Dodger Stadium',
    })} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Freddy Peralta')
    expect(text).toContain('10–11, 4.42')
    expect(text).toContain('TBD')
    expect(text).toContain('TBS')
    expect(text).toContain('Dodger Stadium')
  })

  it('leaves off a starter\'s numbers on a past date, which StatsAPI only has as of today', () => {
    render(<ScoreCard game={base({
      state: 'postponed', statusText: 'Postponed', reason: 'Rain', startMs: Date.now() - 30 * 86_400_000,
      probables: { away: { id: 6, name: 'Chad Patrick', hand: 'R', wins: 9, losses: 4, era: '3.40' }, home: null },
      makeup: '2026-04-04',
    })} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Chad Patrick')
    expect(text).not.toContain('9–4')
    expect(text).toContain('Makeup')
  })

  it('carries the series line in the postseason instead of the records', () => {
    render(<ScoreCard game={base({
      series: { label: 'NLCS Gm 2', decider: false }, seriesResult: 'MIL leads 2-0',
    })} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('NLCS Gm 2 · MIL leads 2–0')
    expect(text).not.toContain('80-70')
  })
})

describe('the Scores page address', () => {
  it('keeps a date other than today, and leaves today off', () => {
    expect(mlbUrlFor({ view: 'scores', date: '2026-08-15' })).toBe('/mlb/scores?date=2026-08-15')
    expect(mlbUrlFor({ view: 'scores', date: null })).toBe('/mlb/scores')
    expect(mlbSnapshotFromUrl('/mlb/scores', '?date=2026-08-15')?.date).toBe('2026-08-15')
  })

  it('reads a malformed date as today', () => {
    expect(mlbSnapshotFromUrl('/mlb/scores', '?date=yesterday')?.date).toBeUndefined()
  })
})
