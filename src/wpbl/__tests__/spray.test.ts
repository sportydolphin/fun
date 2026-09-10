import { describe, it, expect } from 'vitest'
import {
  sprayZone, sprayProfile, spraySide, pullProfile, isBattedBall,
} from '../derive/spray'
import type { WpblSprayPlay } from '../types'

// The spray parser reads the scorer's English, because the feed publishes no hit location at
// all. Every case below is a real narrative shape from the 2026 season, and the ones marked as
// traps are the ones that were actually wrong at some point while this was being written.

const play = (narrative: string, o: Partial<WpblSprayPlay> = {}): WpblSprayPlay => ({
  game_id: 'g1', sequence: 1, team_id: 'SF',
  batter_id: 'p1', batter_name: 'A Batter',
  narrative, event_type: 'single', is_hit: true, ...o,
} as WpblSprayPlay)

describe('reading a direction out of the narrative', () => {
  it('reads the outfield, spelled out or abbreviated', () => {
    expect(sprayZone('Addisyn Baird singled to left field (0-1 F).')).toBe('LF')
    expect(sprayZone('Addisyn Baird flied out to rf (0-0).')).toBe('RF')
    expect(sprayZone('Alexia Jorge homered to left center, RBI (3-2 BBFBK).')).toBe('LCF')
    expect(sprayZone('X flied out to right center (1-1).')).toBe('RCF')
    expect(sprayZone('X flied out to cf (0-0).')).toBe('CF')
  })

  it('reads the infield by position', () => {
    expect(sprayZone('Alexia Jorge popped up to ss (0-1 K).')).toBe('SS')
    expect(sprayZone('Adelaide Frank grounded out to 1b unassisted (3-0 BBB).')).toBe('1B')
    expect(sprayZone('Alexia Jorge fouled out to 3b (3-2 KBFBB).')).toBe('3B')
    expect(sprayZone('X grounded out to shortstop.')).toBe('SS')
  })

  // TRAP. Everything after the first semicolon is a RUNNER. "to second" was the fourth most
  // common "to <x>" fragment in the whole play log, and every one of them is a baserunner.
  it('does not mistake a baserunner for a batted ball', () => {
    expect(sprayZone('Adelaide Frank grounded out p to ss to 1b, RBI (0-0); Ayuri Shimano advanced to second; Jamie M advanced to third.')).toBe('P')
    expect(sprayZone('X walked (3-2 BFKFBBB); Y advanced to second.')).toBeNull()
    expect(sprayZone('X singled to left field (0-0); Y advanced to third base.')).toBe('LF')
  })

  // TRAP. A fielding sequence is a chain and only the first link says where the ball was hit.
  it('takes the first fielder in a relay, not the last', () => {
    expect(sprayZone('X grounded out p to ss to 1b (0-0).')).toBe('P')
    expect(sprayZone('X grounded into a double play ss to 2b to 1b (1-1).')).toBe('SS')
  })

  // TRAP. "down the 3b line" is a ball past third into the corner, not a ball the third
  // baseman fielded: an extra-base hit that would otherwise read as an infield grounder.
  it('reads a foul line as the corner it is', () => {
    expect(sprayZone('Alexia Jorge doubled down the 3b line (2-2 KFBB).')).toBe('LF')
    expect(sprayZone('Alexia Jorge singled down the rf line (0-0).')).toBe('RF')
    expect(sprayZone('Amanda Gianelloni homered down the lf line, RBI (1-1 KB).')).toBe('LF')
  })

  // These name a gap rather than a place, and they are 125 of the season's 454 singles.
  it('reads the gaps', () => {
    expect(sprayZone('Jill Albayati singled up the middle (0-0).')).toBe('CF')
    expect(sprayZone('Gabrielle Haas singled through the left side (0-0); Denver Bryant advanced to second.')).toBe('LF')
    expect(sprayZone('Skylar Kaplan doubled through the right side (0-0).')).toBe('RF')
  })

  // TRAP. The pitch count's letters are the same one-letter codes as the fielders.
  it('does not read the pitch count as a fielder', () => {
    expect(sprayZone('X walked (3-2 BFKFBBB).')).toBeNull()
    expect(sprayZone('X struck out swinging (3-2 KKBBFBFS).')).toBeNull()
  })

  it('does not read the batter\'s own name as a direction', () => {
    expect(sprayZone('Claire Eccles walked (3-2 BBBKFF).')).toBeNull()
    expect(sprayZone('Cf Player walked (0-0).')).toBeNull()
  })

  // The one place the runner's clause is allowed to answer: on a fielder's choice the batter's
  // clause says nothing, but the fielder who started the throw picked the ball up.
  it('places a fielder\'s choice from the throw that retired the runner', () => {
    expect(sprayZone("Val Perez reached on a fielder's choice (2-0 BB); Alyssa Zettlemoyer out at second cf to 2b.")).toBe('CF')
    expect(sprayZone("Edith De Leija reached on a fielder's choice (1-1 BK); Molly Paddison out at second p to ss.")).toBe('P')
  })

  it('says null rather than guessing', () => {
    expect(sprayZone("Claire Eccles reached on a fielder's choice (0-0).")).toBeNull()
    expect(sprayZone("Adelaide Frank out on batter's interference (1-2 FKB).")).toBeNull()
    expect(sprayZone('Suzuka Yamamoto singled (1-0 B); Maïka Dumais advanced to third.')).toBeNull()
    expect(sprayZone(null)).toBeNull()
    expect(sprayZone('')).toBeNull()
  })
})

describe('what counts as a batted ball', () => {
  it('excludes the plays with no ball in play', () => {
    expect(isBattedBall('walk')).toBe(false)
    expect(isBattedBall('strikeout')).toBe(false)
    expect(isBattedBall('stolen_base')).toBe(false)
    expect(isBattedBall('hit_by_pitch')).toBe(false)
    expect(isBattedBall('unknown')).toBe(false)
    expect(isBattedBall(null)).toBe(false)
  })

  it('includes outs, which are the best-covered category there is', () => {
    expect(isBattedBall('flyout')).toBe(true)
    expect(isBattedBall('groundout')).toBe(true)
    expect(isBattedBall('single')).toBe(true)
  })
})

describe('rolling plays into a profile', () => {
  const plays = [
    play('X singled to left field (0-0).'),
    play('X doubled to left field (0-0).', { event_type: 'double' }),
    play('X flied out to cf (0-0).', { event_type: 'flyout', is_hit: false }),
    play('X walked (3-2 BBBB).', { event_type: 'walk', is_hit: false }),
    play('X singled (1-0 B).'),
  ]

  it('separates hits from outs, per zone', () => {
    const p = sprayProfile(plays)
    expect(p.zones.find(z => z.zone === 'LF')).toEqual({ zone: 'LF', hits: 2, outs: 0, total: 2 })
    expect(p.zones.find(z => z.zone === 'CF')).toEqual({ zone: 'CF', hits: 0, outs: 1, total: 1 })
  })

  // A chart that quietly drops what it could not read claims to show a season it has only
  // seen part of. The unplaced ball is counted and the caller is expected to say so.
  it('counts the balls it could not place rather than dropping them', () => {
    const p = sprayProfile(plays)
    expect(p.placed).toBe(3)
    expect(p.unplaced).toBe(1)
    expect(p.hits + p.outs).toBe(4)   // the walk is not a batted ball at all
  })

  it('ignores plays with no ball in play entirely', () => {
    expect(sprayProfile([play('X walked (0-0).', { event_type: 'walk', is_hit: false })]))
      .toMatchObject({ placed: 0, unplaced: 0, hits: 0, outs: 0 })
  })
})

describe('pull and opposite field', () => {
  it('mirrors for a left-handed batter', () => {
    expect(spraySide('LF', 'R')).toBe('pull')
    expect(spraySide('LF', 'L')).toBe('oppo')
    expect(spraySide('RF', 'R')).toBe('oppo')
    expect(spraySide('RF', 'L')).toBe('pull')
    expect(spraySide('CF', 'R')).toBe('center')
    expect(spraySide('CF', 'L')).toBe('center')
  })

  it('puts the infield on the right sides', () => {
    expect(spraySide('SS', 'R')).toBe('pull')
    expect(spraySide('2B', 'R')).toBe('oppo')
    expect(spraySide('SS', 'L')).toBe('oppo')
    expect(spraySide('P', 'R')).toBe('center')
  })

  // A switch hitter's box is a fact about the plate appearance and the feed records it only on
  // the roster. Guessing from the opposing pitcher would be a model, not a fact, so she gets a
  // spray chart and no pull rate rather than being counted as a righty.
  it('refuses to side a switch hitter', () => {
    expect(spraySide('LF', 'S')).toBeNull()
    expect(spraySide('LF', null)).toBeNull()
    expect(spraySide('LF', '')).toBeNull()
  })

  it('leaves an unsideable batter out of the denominator', () => {
    const plays = [play('X singled to left field (0-0).'), play('X singled to rf (0-0).')]
    expect(pullProfile(plays, 'R')).toMatchObject({ pull: 1, oppo: 1, total: 2, pullPct: 50 })
    expect(pullProfile(plays, 'S')).toMatchObject({ pull: 0, oppo: 0, total: 0, pullPct: null })
  })
})
