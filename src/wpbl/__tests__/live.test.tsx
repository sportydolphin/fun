import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { betweenInnings, deriveSituation, LiveBanner } from '../Live'
import type { WpblLiveState, WpblTeam } from '../types'

// The break between half-innings is the one live state the strip cannot render literally, and
// this feed makes it awkward to find. It publishes no "Middle"/"End" inning state, never
// reports three outs, and never blanks the half: the third out and the flip to the next
// half-inning land in the same update. What it does is put the next half-inning on the board
// and then leave it untouched for the length of the break.
//
// So the break is an EMPTY half-inning, not a named one, and the label has to look one
// half-inning backwards from what the feed is showing. Both of those are easy to get subtly
// wrong, which is what these pin down. The transition below is real, captured from the league
// feed during NY @ BOS on 2026-08-20.

const AWAY: WpblTeam = { id: 'ny', name: 'Heights' } as WpblTeam
const HOME: WpblTeam = { id: 'bos', name: 'Hunters' } as WpblTeam

// 17:43:13, the top of the 4th has just ended and the feed has moved to the bottom of the
// 4th. It sat exactly here, unchanged, until the first pitch registered at 17:45:55.
const BREAK: WpblLiveState = {
  complete: false, inning: 4, half: 'bottom', batting_team_id: 'bos',
  outs: 0, balls: 0, strikes: 0,
  batter_name: 'Suzuka Yamamoto', pitcher_name: 'Claire Eccles',
  first_base: '', second_base: '', third_base: '',
  bases_occupied: [], bases_loaded: false, away_runs: 1, home_runs: 1,
}

// 17:41:50, a live at-bat in the top of the same inning, two out, three and one.
const LIVE: WpblLiveState = {
  ...BREAK, half: 'top', batting_team_id: 'ny',
  outs: 2, balls: 3, strikes: 1,
  batter_name: 'Natsuki Yonetani', pitcher_name: 'Alli Schroder',
}

const at = (base: WpblLiveState, patch: Partial<WpblLiveState>): WpblLiveState => ({ ...base, ...patch })

// Through three and a half innings both sides had scored once, in the 2nd.
const LINES = {
  away: [{ inning: 1, runs: 0 }, { inning: 2, runs: 1 }, { inning: 3, runs: 0 }, { inning: 4, runs: 0 }],
  home: [{ inning: 1, runs: 0 }, { inning: 2, runs: 1 }, { inning: 3, runs: 0 }, { inning: 4, runs: 0 }],
}

describe('betweenInnings', () => {
  it('finds the break the feed does not name', () => {
    expect(betweenInnings(BREAK, LINES)).toBe(true)
  })

  it('is false during an at-bat', () => {
    expect(betweenInnings(LIVE, LINES)).toBe(false)
  })

  it('ends the break on the first pitch', () => {
    // 17:45:55, the state that actually followed: one ball on Yamamoto and nothing else moved.
    expect(betweenInnings(at(BREAK, { balls: 1, strikes: 1 }), LINES)).toBe(false)
  })

  it('ends the break on the first out', () => {
    expect(betweenInnings(at(BREAK, { outs: 1 }), LINES)).toBe(false)
  })

  it('ends the break on the first baserunner', () => {
    expect(betweenInnings(at(BREAK, { first_base: 'B. Greenwood' }), LINES)).toBe(false)
  })

  it('is not fooled by a leadoff home run', () => {
    // The one way to be back at nobody out, nobody on and a fresh count with the half-inning
    // already under way: the runner is gone because she scored. Every other way a runner
    // leaves the bases costs an out. Without the runs check this reads as a break.
    const scored = { ...LINES, home: [...LINES.home.slice(0, 3), { inning: 4, runs: 1 }] }
    expect(betweenInnings(BREAK, scored)).toBe(false)
  })

  it('is never true of a finished game', () => {
    // A final zeroes the whole situation out, which is the exact shape of a break.
    const final = at(BREAK, { complete: true, half: '', inning: 0, outs: 0, balls: 0, strikes: 0 })
    expect(betweenInnings(final, LINES)).toBe(false)
  })

  it('is not true before the first pitch of the game', () => {
    // An untouched top of the 1st is a game that has not started, and the label for it would
    // be "End of the 0th".
    expect(betweenInnings(at(BREAK, { inning: 1, half: 'top' }), LINES)).toBe(false)
    // The top of any later inning is a real break. Not the 2nd: the away side scored in it,
    // so its line already says that half-inning was played.
    expect(betweenInnings(at(BREAK, { inning: 3, half: 'top' }), LINES)).toBe(true)
    expect(betweenInnings(at(BREAK, { inning: 2, half: 'top' }), LINES)).toBe(false)
  })
})

describe('the break label looks one half-inning back', () => {
  it('calls an untouched bottom half the middle of that inning', () => {
    // The feed shows the bottom of the 4th; what just ended is the top of the 4th.
    const s = deriveSituation(BREAK, AWAY, HOME, LINES)
    expect(s.between).toBe(true)
    expect(s.breakLabel).toBe('Middle of the 4th')
  })

  it('calls an untouched top half the end of the inning before it', () => {
    // The feed shows the top of the 5th; what just ended is the bottom of the 4th.
    const s = deriveSituation(at(BREAK, { inning: 5, half: 'top' }), AWAY, HOME, LINES)
    expect(s.breakLabel).toBe('End of the 4th')
  })

  it('gets the ordinal right in the teens', () => {
    // 11th, 12th and 13th are the ones a naive suffix table renders "11st" and "12nd", and
    // the top-half case reaches for inning - 1, so both sides of the boundary are checked.
    for (const [inning, label] of [[11, '11th'], [12, '12th'], [13, '13th'], [21, '21st']] as const) {
      expect(deriveSituation(at(BREAK, { inning }), AWAY, HOME, LINES).breakLabel).toBe(`Middle of the ${label}`)
    }
    for (const [inning, label] of [[12, '11th'], [13, '12th'], [14, '13th'], [22, '21st']] as const) {
      expect(deriveSituation(at(BREAK, { inning, half: 'top' }), AWAY, HOME, LINES).breakLabel).toBe(`End of the ${label}`)
    }
  })

  it('leaves a live at-bat unlabelled', () => {
    const s = deriveSituation(LIVE, AWAY, HOME, LINES)
    expect(s.breakLabel).toBeNull()
    expect(s.battingTeam.id).toBe('ny')
  })

  it('does not read a blank half as the top of the inning', () => {
    // The old derivation coerced anything that was not 'bottom' to 'top', which on a blank
    // half named the away team as batting no matter who was actually due.
    const s = deriveSituation(at(BREAK, { half: '', batting_team_id: 'bos' }), AWAY, HOME, LINES)
    expect(s.half).toBe('bottom')
    expect(s.battingTeam.id).toBe('bos')
  })
})

describe('LiveBanner during the break', () => {
  it('replaces the count, the bases and the at-bat with the break', () => {
    render(<LiveBanner state={BREAK} away={AWAY} home={HOME} lines={LINES} />)
    expect(screen.getByText('Middle of the 4th')).toBeTruthy()
    // None of the stale half-inning may survive: not the out total, not the count, and not
    // the batter the feed is already showing for a half-inning nobody has played.
    expect(screen.queryByText(/out/)).toBeNull()
    expect(screen.queryByText(/0–0/)).toBeNull()
    expect(screen.queryByText(/Yamamoto/)).toBeNull()
  })

  it('still shows the full situation while a side is batting', () => {
    render(<LiveBanner state={LIVE} away={AWAY} home={HOME} lines={LINES} />)
    expect(screen.getByText('2 outs')).toBeTruthy()
    expect(screen.getByText('3–1')).toBeTruthy()
    expect(screen.getByText('N. Yonetani')).toBeTruthy()
    expect(screen.queryByText(/Middle of|End of/)).toBeNull()
  })
})
