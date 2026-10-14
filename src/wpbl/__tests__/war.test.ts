import { describe, it, expect } from 'vitest'
import { runsPerWin, WAR_PER_TEAM_GAME, POSITIONAL_RUNS_MLB } from '../derive/war'
import { isInfieldFly } from '../derive/linearWeights'

// WAR's three constants that are not this league's data. Each one is pinned to the number it is
// supposed to reproduce, because a wrong one is invisible on the page: it scales every row alike.

describe('WAR constants', () => {
  it('reproduces MLB\'s ten runs per win, and prices a WPBL win at its own rate', () => {
    expect(runsPerWin(4.5)).toBeGreaterThan(9.3)
    expect(runsPerWin(4.5)).toBeLessThan(10)
    // The 2026 WPBL scored about 7.9 a team a game: a win costs more runs where runs are cheap.
    expect(runsPerWin(7.92)).toBeCloseTo(14.33, 1)
  })

  it('puts 1,000 WAR across a 2,430-game MLB season, the 2013 shared replacement level', () => {
    expect(WAR_PER_TEAM_GAME * 2430 * 2).toBeCloseTo(1000)
    // The same as a .294 team: (0.5 - 0.294) wins a game above replacement.
    expect(WAR_PER_TEAM_GAME).toBeCloseTo(0.5 - 0.294, 2)
  })

  it('keeps FanGraphs\' positional scale, hardest to easiest', () => {
    const p = POSITIONAL_RUNS_MLB
    expect(p.c).toBeGreaterThan(p.ss)
    expect(p.ss).toBeGreaterThan(p['2b'])
    expect(p['2b']).toBe(p.cf)
    expect(p.lf).toBe(p.rf)
    expect(p.rf).toBeGreaterThan(p['1b'])
    expect(p['1b']).toBeGreaterThan(p.dh)
  })
})

describe('infield flies for ifFIP', () => {
  const p = (event_type: string, narrative: string) => ({ event_type, narrative })
  it('counts pop-ups, fly outs and foul outs to an infielder', () => {
    expect(isInfieldFly(p('popup', 'Skylar Kaplan popped up to ss (0-0).'))).toBe(true)
    expect(isInfieldFly(p('foul_out', 'Kelsie Whitmore fouled out to c (2-2 KBFB).'))).toBe(true)
    expect(isInfieldFly(p('flyout', 'Val Perez flied out to 2b (1-2 FBKF).'))).toBe(true)
  })
  it('leaves out the outfield, and line drives anywhere', () => {
    expect(isInfieldFly(p('popup', 'Caitlin Eynon popped up to rf (1-1 BK).'))).toBe(false)
    expect(isInfieldFly(p('flyout', 'Maggie Foxx flied out to cf (1-2 KBK).'))).toBe(false)
    expect(isInfieldFly(p('lineout', 'Amanda Gianelloni lined out to ss (1-2 FKB).'))).toBe(false)
  })
})
