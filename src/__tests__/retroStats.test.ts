import { describe, it, expect } from 'vitest'
// The .mjs job imported rather than reimplemented: the event grammar IS the check, and a copy
// living here would keep passing while the script it mirrors drifted.
import { batting, parseGames, pairBatters, diffBatters } from '../../scripts/check-wpbl-retro-stats.mjs'

// This audit is only worth having if its reading of a Retrosheet event is right. Every case
// below is a code that actually appears in RetroWPBL's 2026 files, counted over all four of
// them, so these are the plays the check will really meet rather than a tour of the spec.

describe('batting', () => {
  it('reads the four hits', () => {
    expect(batting('S9/G')).toMatchObject({ pa: 1, ab: 1, h: 1, b2: 0, b3: 0, hr: 0 })
    expect(batting('D7/L')).toMatchObject({ ab: 1, h: 1, b2: 1 })
    expect(batting('T8/F')).toMatchObject({ ab: 1, h: 1, b3: 1 })
    expect(batting('HR/F')).toMatchObject({ ab: 1, h: 1, hr: 1 })
  })

  // Their file writes a ground-rule double as DGR, which is a double however it got there.
  it('counts a ground-rule double as a double', () => {
    expect(batting('DGR')).toMatchObject({ ab: 1, h: 1, b2: 1 })
  })

  it('separates the free passes from the at-bats', () => {
    expect(batting('W')).toMatchObject({ pa: 1, ab: 0, bb: 1 })
    expect(batting('I')).toMatchObject({ pa: 1, ab: 0, bb: 1 })
    expect(batting('HP')).toMatchObject({ pa: 1, ab: 0, hbp: 1 })
    expect(batting('C/E2')).toMatchObject({ pa: 1, ab: 0, bb: 0, hbp: 0 })
  })

  it('charges an at-bat for a strikeout, an error and a fielder’s choice', () => {
    expect(batting('K')).toMatchObject({ ab: 1, so: 1 })
    expect(batting('E6/G')).toMatchObject({ ab: 1, h: 0 })
    expect(batting('FC6/G')).toMatchObject({ ab: 1, h: 0 })
    expect(batting('63/G')).toMatchObject({ ab: 1, h: 0, so: 0 })
  })

  // A sacrifice is a plate appearance and not an at-bat. Getting this backwards would show up
  // as a one-per-sacrifice AB gap on every club, which is the shape that hides in plain sight.
  it('does not charge an at-bat for a sacrifice', () => {
    expect(batting('8/SF.3-H(RBI)')).toMatchObject({ pa: 1, ab: 0, sf: 1, rbi: 1 })
    expect(batting('23/SH.1-2')).toMatchObject({ pa: 1, ab: 0, sh: 1 })
  })

  // The batter's half of a compound event is everything before the `+`: the runner's steal on
  // the same pitch is not a second plate appearance.
  it('takes the batter’s half of a strikeout with a steal on the pitch', () => {
    expect(batting('K+SB2')).toMatchObject({ pa: 1, ab: 1, so: 1 })
    expect(batting('W+PO13')).toMatchObject({ pa: 1, ab: 0, bb: 1 })
  })

  it('ignores the events where nobody is batting', () => {
    for (const ev of ['NP', 'SB2', 'CS3(24)', 'PO1(13)', 'POCS2(24)', 'WP', 'PB', 'BK', 'OA']) {
      expect(batting(ev)).toBeNull()
    }
  })

  // Runs are counted off the transcriber's own (RBI) marks, plus the batter's own on a home
  // run, which the advancement never lists. Same rule, same reason, as runsOnPlay() on our side.
  it('counts RBI from the advancement, and adds the batter back on a home run', () => {
    expect(batting('D7/L.3-H(RBI);2-H(RBI);1-3').rbi).toBe(2)
    expect(batting('HR/F.2-H(RBI)').rbi).toBe(2)
    expect(batting('HR/F').rbi).toBe(1)
    expect(batting('S9/G.1-2').rbi).toBe(0)
  })

  // An event this grammar has never seen must SAY so. Scored silently as an out it would push
  // the check toward agreeing with us, which is the direction that teaches nobody anything.
  it('flags an event it does not recognise instead of guessing', () => {
    expect(batting('ZZ9/WHAT')).toMatchObject({ unknown: true })
  })
})

describe('parseGames', () => {
  const file = [
    'id,LAQ202608290',
    'info,hometeam,LAQ',
    'info,date,2026/08/29',
    'start,eynoc201,"Caitlin Eynon",1,3,4',
    'play,1,1,eynoc201,02,CFFX,D7/L.3-H(RBI)',
    'com,"$Fast liner just to the left-handed fielding Izumi\'s right"',
    'sub,mackj201,"Jamie Mackay",1,3,11',
    'play,2,1,mackj201,00,X,S9/L',
  ].join('\n')

  it('keeps the id, the info block, the names and the plays', () => {
    const [g] = parseGames(file)
    expect(g.id).toBe('LAQ202608290')
    expect(g.info.date).toBe('2026/08/29')
    expect(g.names.get('eynoc201')).toBe('Caitlin Eynon')
    expect(g.names.get('mackj201')).toBe('Jamie Mackay')   // a `sub` names people too
    expect(g.plays).toHaveLength(2)
  })

  // The event field can carry commas inside its parentheses, so it is everything from the
  // seventh field on rather than the seventh field.
  it('keeps an event that contains a comma', () => {
    const [g] = parseGames('id,X\nplay,7,1,foo101,00,X,64(1)3/GDP.2-3,B-1')
    expect(g.plays[0].event).toBe('64(1)3/GDP.2-3,B-1')
  })
})

describe('pairBatters', () => {
  const theirs = (over = {}) => new Map([['addie frank', { name: 'Addie Frank', pa: 3, ab: 3, h: 1, b2: 0, b3: 0, hr: 0, bb: 0, so: 1, hbp: 0, rbi: 0, ...over }]])
  const ours = (over = {}) => new Map([['adelaide frank', { name: 'Adelaide Frank', pa: 3, ab: 3, h: 1, b2: 0, b3: 0, hr: 0, bb: 0, so: 1, hbp: 0, rbi: 0, ...over }]])

  // The transcriber writes the name people use. Matching on the full string reported one player
  // TWICE, once as missing from each side, which looks like two errors instead of none.
  it('pairs a nickname with the roster name', () => {
    expect(diffBatters(theirs(), ours())).toEqual([])
  })

  it('still reports a real disagreement through a nickname', () => {
    expect(diffBatters(theirs(), ours({ h: 2 }))[0].issue).toContain('H theirs 1 ours 2')
  })

  // Our box score carries a line for anyone with a lineup spot, pitchers and unused substitutes
  // included. They cannot appear in a transcription of the plays, and calling them missing
  // batters produced thirty findings a night that were all the same non-fact.
  it('ignores anyone who never came to the plate on our side', () => {
    const bench = new Map([...ours(), ['olivia bricker', { name: 'Olivia Bricker', pa: 0, ab: 0, h: 0, b2: 0, b3: 0, hr: 0, bb: 0, so: 0, hbp: 0, rbi: 0 }]])
    expect(diffBatters(theirs(), bench)).toEqual([])
  })

  it('reports a batter their transcription has and our box score does not', () => {
    expect(diffBatters(theirs(), new Map())[0].issue).toContain('not in our box score')
  })

  it('reports a batter who batted for us and is absent from theirs', () => {
    expect(diffBatters(new Map(), ours())[0].issue).toContain('absent from their transcription')
  })

  // Surname plus initial exists to survive a nickname, not to guess between two people.
  it('refuses the initial fallback when two players would share it', () => {
    const twoFranks = new Map([
      ['adelaide frank', { name: 'Adelaide Frank', pa: 3, ab: 3, h: 1, b2: 0, b3: 0, hr: 0, bb: 0, so: 1, hbp: 0, rbi: 0 }],
      ['annie frank', { name: 'Annie Frank', pa: 2, ab: 2, h: 0, b2: 0, b3: 0, hr: 0, bb: 0, so: 0, hbp: 0, rbi: 0 }],
    ])
    const out = diffBatters(theirs(), twoFranks)
    expect(out.some(f => /not in our box score/.test(f.issue))).toBe(true)
  })
})
