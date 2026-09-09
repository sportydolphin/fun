import { describe, it, expect } from 'vitest'
// The .mjs job imported rather than reimplemented, the same rule retroStats.test.ts follows:
// the event grammar IS the job, and a copy here would keep passing while the script drifted.
import {
  splitEvent, advances, runnersHome, batterText, runnerText, eventType, trackBases, planCorrections,
} from '../../scripts/fill-wpbl-play-gaps.mjs'

// Every event below is one RetroWPBL actually wrote in a 2026 file, most of them in the Aug 20
// NY at BOS game this job exists for.

describe('reading one event', () => {
  it('separates the primary, the modifiers and the advancement', () => {
    const e = splitEvent('S8/L.3-H(RBI);2-3')
    expect(e.primary).toBe('S8')
    expect(e.mods).toEqual(['L'])
    expect(advances(e.advance).map(a => `${a.from}${a.to}`)).toEqual(['3H', '23'])
  })

  // The trap this shares with the rest of the section: runs_scored never counts the batter, so
  // a solo home run is 0 and a bases-loaded walk that forces one in is 1.
  it('counts the runners who crossed and never the batter', () => {
    expect(runnersHome('HR/F')).toBe(0)
    expect(runnersHome('HR/F.2-H(RBI);1-H(RBI)')).toBe(2)
    expect(runnersHome('HP.3-H(RBI);2-3;1-2')).toBe(1)
    // A runner thrown out at the plate did not score.
    expect(runnersHome('S7/G.3XH(72)')).toBe(0)
  })
})

describe('the sentence', () => {
  it('writes a hit the way the feed writes one', () => {
    expect(batterText('S8/L', 'Claire Eccles')?.sentence).toBe('Claire Eccles singled to center field.')
    expect(batterText('S6/L', 'Katherine Murphy')?.sentence).toBe('Katherine Murphy singled to shortstop.')
    expect(batterText('D7/L.3-H(RBI);2-H(RBI)', 'Caitlin Eynon')?.sentence)
      .toBe('Caitlin Eynon doubled to left field, 2 RBI.')
  })

  it('writes an out with the scorer’s abbreviations, and a hit with the full place', () => {
    expect(batterText('8/F', 'Denae Benites')?.sentence).toBe('Denae Benites flied out to cf.')
    expect(batterText('2/P/FL', 'Natsuki Yonetani')?.sentence).toBe('Natsuki Yonetani fouled out to c.')
    expect(batterText('63/G', 'Jaida Lee')?.sentence).toBe('Jaida Lee grounded out to ss.')
    expect(batterText('64(1)3/GDP/G', 'London Studer')?.sentence)
      .toBe('London Studer grounded into double play ss to 2b to 1b.')
  })

  it('says only what was written down about a strikeout', () => {
    // Their file marks the called one and nothing else, so the bare K stays unqualified rather
    // than claiming she swung.
    expect(batterText('K', 'Elodie Ciamarro')?.sentence).toBe('Elodie Ciamarro struck out.')
    expect(batterText('K/C', 'Mo’ne Davis')?.sentence).toBe('Mo’ne Davis struck out looking.')
  })

  it('counts the batter’s own run in the RBI and not in the runs', () => {
    const hr = batterText('HR/F89D.3-H(RBI);2-H(RBI);1-H(RBI)', 'Sarah Edwards')
    expect(hr?.sentence).toBe('Sarah Edwards homered, 4 RBI.')
    expect(hr?.runs).toBe(3)
  })

  it('refuses an event it cannot read instead of guessing', () => {
    expect(batterText('ZZ9/Q', 'Nobody')).toBeNull()
  })
})

describe('a runner event', () => {
  const bases = { 1: 'Katherine Murphy', 2: null, 3: 'Claire O’Sullivan' }

  it('names the runner the base state knows', () => {
    expect(runnerText('SB2', { 1: 'Claire O’Sullivan', 2: null, 3: null }))
      .toBe('Claire O’Sullivan stole second.')
    expect(runnerText('CS2(26)', bases))
      .toBe('Katherine Murphy out at second c to ss, caught stealing.')
  })

  // A wrong name is worse than no name: it is a fact the reader has no reason to doubt.
  it('falls back to “A runner” when the state is unknown', () => {
    expect(runnerText('SB2', null)).toBe('A runner stole second.')
  })
})

describe('classifying for the derived surfaces', () => {
  it('uses only values the feed itself uses', () => {
    expect(eventType('S8/L')).toBe('single')
    expect(eventType('HR/F')).toBe('home_run')
    expect(eventType('W')).toBe('walk')
    expect(eventType('K')).toBe('strikeout')
    expect(eventType('8/F')).toBe('flyout')
    expect(eventType('2/P/FL')).toBe('foul_out')
    expect(eventType('SB2')).toBe('stolen_base')
    expect(eventType('CS2(26)')).toBe('caught_stealing')
  })

  it('leaves an event it cannot map unclassified', () => {
    expect(eventType('ZZ9/Q')).toBeNull()
  })
})

describe('tracking the bases through a half-inning', () => {
  const names = new Map([['a', 'Claire O’Sullivan'], ['b', 'London Studer'], ['c', 'Katherine Murphy'], ['d', 'Alyssa Zettlemoyer']])
  const nameOf = (id: string) => names.get(id) ?? id

  // New York's sixth on Aug 20, which is the half-inning this whole job was written for.
  const plays = [
    { batterId: 'a', event: 'W' },
    { batterId: 'b', event: 'SB2' },
    { batterId: 'b', event: '3/G.2-3' },
    { batterId: 'c', event: 'S6/L.3-3' },
    { batterId: 'd', event: 'CS2(26)' },
    { batterId: 'd', event: '8/F' },
  ]

  it('knows who is on which base when a steal happens', () => {
    const states = trackBases(plays, nameOf)
    // The walk is still at the plate when the inning starts.
    expect(states[0]).toEqual({ 1: null, 2: null, 3: null })
    // She is on first for the steal, and on second after it.
    expect(states[1]?.[1]).toBe('Claire O’Sullivan')
    expect(states[2]?.[2]).toBe('Claire O’Sullivan')
    // The groundout moves her to third; the single leaves her there and puts Murphy on first,
    // which is the runner the caught stealing is about.
    expect(states[4]?.[3]).toBe('Claire O’Sullivan')
    expect(states[4]?.[1]).toBe('Katherine Murphy')
  })

  it('stops naming anybody once an event it cannot read goes past', () => {
    const states = trackBases([{ batterId: 'a', event: 'W' }, { batterId: 'b', event: 'ZZ9/Q' }, { batterId: 'c', event: 'SB2' }], nameOf)
    expect(states[2]).toBeNull()
  })
})

describe('a batter the box score rules out', () => {
  // Aug 27, LA at NY. Ayami Sato is 0 for 0 with no walk and no strikeout in the same box score
  // that carries these two plays under her name; Mo'ne Davis has the at-bats, the hit and the
  // strikeout, and no plays at all. RetroWPBL names Davis for both.
  const theirGame = {
    id: 'NYH202608270',
    names: new Map([['davim201', 'Mo’ne Davis'], ['shima201', 'Ayuri Shimano']]),
    plays: [
      { inning: 5, side: 0, batterId: 'shima201', event: 'W' },
      { inning: 5, side: 0, batterId: 'davim201', event: 'K/C' },
    ],
  }
  const roster = new Map([
    ['ayami sato', { id: 'p-sato', name: 'Ayami Sato', pa: 0 }],
    ['mo ne davis', { id: 'p-davis', name: 'Mo’ne Davis', pa: 2 }],
    ['ayuri shimano', { id: 'p-shimano', name: 'Ayuri Shimano', pa: 3 }],
  ])
  // Three of our rows against their two: our log carries a substitution announcement theirs
  // folds away, which is why this rule cannot lean on the plays lining up by position.
  const ourPlays = [
    { game_id: 'g1', sequence: 72, inning: 5, half: 'top', batter_name: 'Ayuri Shimano', batter_id: 'p-shimano', narrative: 'Claire Eccles to p.', event_type: 'unknown' },
    { game_id: 'g1', sequence: 73, inning: 5, half: 'top', batter_name: 'Ayuri Shimano', batter_id: 'p-shimano', narrative: 'Ayuri Shimano walked (3-2 KBKBBFB).', event_type: 'walk' },
    { game_id: 'g1', sequence: 74, inning: 5, half: 'top', batter_name: 'Ayami Sato', batter_id: 'p-sato', narrative: 'Ayami Sato struck out looking (2-2 BBSKK).', event_type: 'strikeout' },
  ]

  it('puts the right batter on the play, and leaves the play alone', () => {
    const { corrections } = planCorrections({ ourPlays, theirGame, roster, existing: new Set() })
    expect(corrections.map(c => c.field).sort()).toEqual(['batter_id', 'batter_name', 'narrative'])
    expect(corrections.every(c => c.sequence === 74)).toBe(true)
    expect(corrections.find(c => c.field === 'batter_name')?.new_value).toBe('Mo’ne Davis')
    // The league's own sentence, its count and its pitch string kept: only the name moves.
    expect(corrections.find(c => c.field === 'narrative')?.new_value)
      .toBe('Mo’ne Davis struck out looking (2-2 BBSKK).')
  })

  // A pinch runner who never batted is the subject of a steal, and her 0-for-0 line is correct.
  it('says nothing about a runner event under a batter with no plate appearance', () => {
    const steal = [{ game_id: 'g1', sequence: 74, inning: 5, half: 'top', batter_name: 'Ayami Sato', batter_id: 'p-sato', narrative: 'Ayami Sato stole second.', event_type: 'stolen_base' }]
    const { corrections } = planCorrections({ ourPlays: steal, theirGame, roster, existing: new Set() })
    expect(corrections).toHaveLength(0)
  })

  it('refuses when more than one of their players could be the batter', () => {
    const twoWays = {
      ...theirGame,
      names: new Map([...theirGame.names, ['other201', 'Isabella Villarreal']]),
      plays: [...theirGame.plays, { inning: 5, side: 0, batterId: 'other201', event: 'K' }],
    }
    const bigger = new Map([...roster, ['isabella villarreal', { id: 'p-villarreal', name: 'Isabella Villarreal', pa: 2 }]])
    const { corrections, skipped } = planCorrections({ ourPlays, theirGame: twoWays, roster: bigger, existing: new Set() })
    expect(corrections).toHaveLength(0)
    expect(skipped[0].why).toContain('2 players')
  })

  // The replacement has to be missing from the whole game, not merely from this half-inning:
  // a player already logged batting elsewhere is accounted for and is not the answer.
  it('refuses when their batter already appears in our log', () => {
    const logged = [...ourPlays, { game_id: 'g1', sequence: 99, inning: 7, half: 'top', batter_name: 'Mo’ne Davis', batter_id: 'p-davis', narrative: 'Mo’ne Davis singled to left field.', event_type: 'single' }]
    const { corrections } = planCorrections({ ourPlays: logged, theirGame, roster, existing: new Set() })
    expect(corrections).toHaveLength(0)
  })
})

describe('the alignment gates', () => {
  const theirGame = {
    id: 'BSH202608200',
    names: new Map([['a', 'Claire O’Sullivan'], ['b', 'London Studer']]),
    plays: [
      { inning: 6, side: 0, batterId: 'a', event: 'W' },
      { inning: 6, side: 0, batterId: 'b', event: '8/F' },
    ],
  }
  // The roster map carries the box-score line, not just the id: the plate-appearance count is
  // what the impossible-batter rule reads.
  const roster = new Map([
    ['claire o sullivan', { id: 'p-osullivan', name: 'Claire O’Sullivan', pa: 4 }],
    ['london studer', { id: 'p-studer', name: 'London Studer', pa: 4 }],
  ])
  const ours = (over: Partial<Record<string, unknown>>[] = [{}, {}]) => [
    { game_id: 'g1', sequence: 77, inning: 6, half: 'top', batter_name: null, batter_id: null, narrative: '', event_type: 'unknown', ...over[0] },
    { game_id: 'g1', sequence: 78, inning: 6, half: 'top', batter_name: 'London Studer', batter_id: 'p-studer', narrative: 'London Studer flied out to cf.', event_type: 'flyout', ...over[1] },
  ]

  it('fills the empty row and leaves the one the feed wrote alone', () => {
    const { corrections } = planCorrections({ ourPlays: ours(), theirGame, roster, existing: new Set() })
    expect(corrections.every(c => c.sequence === 77)).toBe(true)
    expect(corrections.find(c => c.field === 'narrative')?.new_value).toBe('Claire O’Sullivan walked.')
    expect(corrections.find(c => c.field === 'batter_id')?.new_value).toBe('p-osullivan')
  })

  // The free checksum. If our non-empty rows do not name their batters, the two lists are not
  // the same half-inning and every fill drawn from the alignment would be wrong.
  it('writes nothing when a row we already have disagrees with theirs', () => {
    const { corrections, skipped } = planCorrections({
      ourPlays: ours([{}, { batter_name: 'Somebody Else' }]), theirGame, roster, existing: new Set(),
    })
    expect(corrections).toHaveLength(0)
    expect(skipped).toHaveLength(1)
  })

  it('writes nothing when the two half-innings are different lengths', () => {
    const short = { ...theirGame, plays: theirGame.plays.slice(0, 1) }
    const { corrections, skipped } = planCorrections({ ourPlays: ours(), theirGame: short, roster, existing: new Set() })
    expect(corrections).toHaveLength(0)
    expect(skipped[0].why).toContain('2 plays here, 1 in theirs')
  })

  // A correction somebody wrote by hand always outranks this job.
  it('never rewrites a correction that already exists', () => {
    const existing = new Set(['g1:77:narrative'])
    const { corrections } = planCorrections({ ourPlays: ours(), theirGame, roster, existing })
    expect(corrections.some(c => c.field === 'narrative')).toBe(false)
    expect(corrections.some(c => c.field === 'batter_name')).toBe(true)
  })
})
