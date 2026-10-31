import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreRow } from '../views/ScoreRow'
import type { FinalGameSummary, FinalTeam } from '../views/scoresData'

// The phone's row in each state a day can hold, each detail on its club's own line.

const team = (teamId: number, abbr: string, runs: number, extra: Partial<FinalTeam> = {}): FinalTeam =>
  ({ teamId, abbr, name: abbr, runs, hits: runs + 3, errors: 0, isWinner: false, record: '80-70', ...extra })

const base = (over: Partial<FinalGameSummary>): FinalGameSummary => ({
  gamePk: 1, state: 'final', startMs: Date.now(), statusText: 'Final',
  away: team(158, 'MIL', 7, { isWinner: true }), home: team(119, 'LAD', 4),
  winPitcher: null, losePitcher: null, savePitcher: null,
  ...over,
})
const person = (name: string) => ({ id: 1, name })

describe('ScoreRow', () => {
  it('draws a final with its runs and the decisions, and no line score', () => {
    render(<ScoreRow game={base({ decisions: { win: person('Corbin Burnes'), loss: person('Tyler Glasnow'), save: null } })} />)
    expect(screen.getByText('Final')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('Corbin Burnes')).toBeTruthy()
    expect(screen.getByText('Tyler Glasnow')).toBeTruthy()
    expect(screen.queryByText('R')).toBeNull()
  })

  it('puts the win on the winning club when the home side wins', () => {
    const { container } = render(<ScoreRow game={base({
      away: team(158, 'MIL', 1), home: team(119, 'LAD', 2, { isWinner: true }),
      decisions: { win: person('Home Starter'), loss: person('Away Starter'), save: null },
    })} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('Away Starter')).toBeLessThan(text.indexOf('Home Starter'))
  })

  it('shows the probables and no runs before first pitch', () => {
    render(<ScoreRow game={base({
      state: 'preview', statusText: '7:05 PM',
      away: team(158, 'MIL', 0), home: team(119, 'LAD', 0),
      probables: { away: { id: 1, name: 'Freddy Peralta', hand: 'R', wins: 10, losses: 5, era: '3.10' }, home: null },
    })} />)
    expect(screen.getByText('7:05 PM')).toBeTruthy()
    expect(screen.getByText('Freddy Peralta')).toBeTruthy()
    expect(screen.getByText('TBD')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shortens postponed for the status column and keeps the reason', () => {
    render(<ScoreRow game={base({ state: 'postponed', statusText: 'Postponed', reason: 'Rain' })} />)
    expect(screen.getByText('PPD')).toBeTruthy()
    expect(screen.getByText('Rain')).toBeTruthy()
    expect(screen.getByText('Makeup not set')).toBeTruthy()
  })

  it('draws the live situation', () => {
    render(<ScoreRow game={base({
      state: 'live', statusText: '▲ 5th',
      live: { outs: 2, balls: 1, strikes: 2, onFirst: true, onSecond: false, onThird: false, between: false, batter: person('William Contreras'), pitcher: person('Tyler Glasnow') },
    })} />)
    expect(screen.getByText('2 outs')).toBeTruthy()
    expect(screen.getByText('William Contreras')).toBeTruthy()
  })

  it('carries the series in the postseason', () => {
    render(<ScoreRow game={base({ series: { label: 'WS Gm 5', decider: false }, seriesResult: 'MIL wins 4-1' })} />)
    expect(screen.getByText(/WS Gm 5 · MIL wins 4–1/)).toBeTruthy()
  })
})
