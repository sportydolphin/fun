import { describe, expect, it } from 'vitest'
import { nameWords, parseClubPage, parseGameQuery, pickGames, parseCompareText, typedPart, typedSeason, parseFinderText, parseLeaderText, type FinderClubAlias } from '../finderParse'

const CLUBS: FinderClubAlias[] = [
  { id: 'CHC', names: ['Cubs', 'Chicago'] },
  { id: 'CWS', names: ['White Sox', 'Chicago'] },
  { id: 'SF', names: ['SF', 'San Francisco', 'Firebells', 'San Francisco Firebells'] },
  { id: 'BOS', names: ['BOS', 'Boston', 'Hunters'] },
  { id: 'NY', names: ['NY', 'New York', 'Heights'] },
]

const first = (t: string) => parseFinderText(t, CLUBS)[0]

describe('parseFinderText', () => {
  it('reads a bare count as at least, and leans strikeouts toward the pitcher', () => {
    const r = parseFinderText('5 strikeouts', CLUBS).filter(x => x.per === 'game')
    expect(r.map(x => x.side)).toEqual(['pitching', 'hitting'])
    expect(r[0].conditions).toEqual([{ field: 'so', op: 'gte', value: 5 }])
  })

  it('reads zero as exactly zero rather than every line', () => {
    expect(first('5 k no walks').conditions).toEqual([
      { field: 'so', op: 'gte', value: 5 },
      { field: 'bb', op: 'eq', value: 0 },
    ])
    expect(first('10 k without a walk').conditions[1]).toEqual({ field: 'bb', op: 'eq', value: 0 })
  })

  it('turns strict comparisons into the inclusive ones the finder takes', () => {
    expect(first('more than 3 hits').conditions).toEqual([{ field: 'h', op: 'gte', value: 4 }])
    expect(first('fewer than 3 hits allowed').conditions).toEqual([{ field: 'h', op: 'lte', value: 2 }])
    expect(first('2 or fewer walks').conditions).toEqual([{ field: 'bb', op: 'lte', value: 2 }])
    expect(first('3+ hits').conditions).toEqual([{ field: 'h', op: 'gte', value: 3 }])
    expect(first('exactly 2 homers').conditions).toEqual([{ field: 'hr', op: 'eq', value: 2 }])
  })

  it('reads the stat-first spelling, and keeps each number with its own stat', () => {
    expect(first('k >= 8').conditions).toEqual([{ field: 'so', op: 'gte', value: 8 }])
    expect(first('hits 3 walks 0').conditions).toEqual([
      { field: 'h', op: 'gte', value: 3 },
      { field: 'bb', op: 'eq', value: 0 },
    ])
  })

  it('lets a stat only one side records decide the side', () => {
    const rbi = parseFinderText('2 hr 5 rbi', CLUBS)
    expect(rbi).toHaveLength(1)
    expect(rbi[0].side).toBe('hitting')
    const er = parseFinderText('7 innings 0 earned runs', CLUBS)
    expect(er).toHaveLength(1)
    expect(er[0]).toMatchObject({ side: 'pitching', conditions: [
      { field: 'ip', op: 'gte', value: 21 },
      { field: 'er', op: 'eq', value: 0 },
    ] })
  })

  it('reads innings as outs, thirds and all', () => {
    expect(first('6.2 ip').conditions).toEqual([{ field: 'ip', op: 'gte', value: 20 }])
    expect(first('over 6 innings').conditions).toEqual([{ field: 'ip', op: 'gte', value: 19 }])
  })

  it('lets a hint word rule out the other side', () => {
    const r = parseFinderText('pitchers with 2 hits', CLUBS)
    expect(r.map(x => x.side)).toEqual(['pitching'])
    expect(parseFinderText('batters with 3 strikeouts', CLUBS).map(x => x.side)).toEqual(['hitting'])
  })

  it('reads an n-for-m line as exact hits and at-bats, for hitters only', () => {
    const r = parseFinderText('4-for-4', CLUBS)
    expect(r).toHaveLength(1)
    expect(r[0].conditions).toEqual([
      { field: 'h', op: 'eq', value: 4 },
      { field: 'ab', op: 'eq', value: 4 },
    ])
    expect(first('3 for 5 with a homer').conditions).toHaveLength(3)
  })

  it('reads the club, the opponent and where', () => {
    expect(first('3 hits vs SF at home')).toMatchObject({ oppId: 'SF', teamId: null, venue: 'home' })
    expect(first('2 hr for Boston on the road')).toMatchObject({ teamId: 'BOS', oppId: null, venue: 'away' })
    expect(first('8 k at New York')).toMatchObject({ oppId: 'NY', venue: 'away' })
    expect(first('Firebells 3 hits')).toMatchObject({ teamId: 'SF' })
  })

  it('does not take "home runs" for a home game', () => {
    expect(first('2 home runs')).toMatchObject({ venue: 'any', conditions: [{ field: 'hr', op: 'gte', value: 2 }] })
  })

  it('suggests nothing for a name, or a number with no stat beside it', () => {
    expect(parseFinderText('Kelsie Whitmore', CLUBS)).toEqual([])
    expect(parseFinderText('7', CLUBS)).toEqual([])
    expect(parseFinderText('a b', CLUBS)).toEqual([])
    expect(parseFinderText('no hitter', CLUBS)).toEqual([])
    expect(parseFinderText('', CLUBS)).toEqual([])
  })

  it('rejects a decimal count on anything but innings', () => {
    expect(parseFinderText('2.5 hits', CLUBS)).toEqual([])
  })

  it('reports the words it could not place instead of dropping them', () => {
    expect(first('Whitmore 2 hr').ignored).toEqual(['whitmore'])
    expect(first('games with 3 hits vs SF').ignored).toEqual([])
    expect(first('pitchers with 8 k').ignored).toEqual([])
    expect(first('3 hits vs Atlantis').ignored).toEqual(['atlantis'])
  })

  it('offers every club a shared city could mean, one reading each', () => {
    const r = parseFinderText('3 hits vs Chicago', CLUBS)
    expect(r.filter(x => x.side === 'hitting').map(x => x.oppId)).toEqual(['CHC', 'CWS'])
    expect(parseFinderText('3 hits vs Cubs', CLUBS).every(x => x.oppId === 'CHC')).toBe(true)
  })

  it('never pairs a club with itself, and caps the readings', () => {
    const r = parseFinderText('5 strikeouts Chicago vs Chicago', CLUBS)
    expect(r.every(x => x.teamId !== x.oppId)).toBe(true)
    expect(r.length).toBeLessThanOrEqual(4)
  })
})

describe('parseFinderText, game or season', () => {
  const read = (t: string) => parseFinderText(t, CLUBS).map(r => `${r.side}/${r.per}`)

  it('reads a hyphenated count the way it is said', () => {
    expect(first('3-hit games')).toMatchObject({ side: 'hitting', per: 'game', conditions: [{ field: 'h', op: 'gte', value: 3 }] })
    expect(first('multi-homer games').conditions).toEqual([{ field: 'hr', op: 'gte', value: 2 }])
    expect(first('10-strikeout games')).toMatchObject({ side: 'pitching', per: 'game' })
  })

  it('keeps a night-sized count to games alone', () => {
    expect(read('3 hits')).toEqual(['hitting/game', 'pitching/game'])
    expect(read('5 k no walks')).toEqual(['pitching/game', 'hitting/game'])
  })

  it('reads a count no game can hold as a season, and a rare night as both, the night first', () => {
    expect(first('5 home runs')).toMatchObject({ side: 'hitting', per: 'season', conditions: [{ field: 'hr', op: 'gte', value: 5 }] })
    expect(read('5 home runs')).not.toContain('hitting/game')
    expect(read('3 home runs').slice(0, 2)).toEqual(['hitting/game', 'hitting/season'])
    expect(first('200 strikeouts')).toMatchObject({ side: 'pitching', per: 'season' })
  })

  it('takes a word for the grain over the size of the number', () => {
    expect(read('at least 5 home runs on the season')).toEqual(['hitting/season', 'pitching/season'])
    expect(read('4 hr this season')[0]).toBe('hitting/season')
    expect(read('4 hr this season')).not.toContain('hitting/game')
    expect(read('5 hr in a game')[0]).toBe('hitting/game')
    // The board is one season already, so a small count "this season" is still mostly a night.
    expect(read('3 hits this season').slice(0, 1)).toEqual(['hitting/game'])
  })

  it('reads a rate as a season, in its last printed digit', () => {
    expect(first('.300 hitters')).toMatchObject({ side: 'hitting', per: 'season', conditions: [{ field: 'avg', op: 'gte', value: 300 }] })
    expect(first('hitting over .300').conditions).toEqual([{ field: 'avg', op: 'gte', value: 301 }])
    expect(first('ops over .900 at home')).toMatchObject({ venue: 'home', conditions: [{ field: 'ops', op: 'gte', value: 901 }] })
    expect(first('era under 3').conditions).toEqual([{ field: 'era', op: 'lte', value: 299 }])
    expect(first('sub-3 era').conditions).toEqual([{ field: 'era', op: 'lte', value: 299 }])
    // A bare number on a stat whose good end is low is a ceiling.
    expect(first('a 2.50 era').conditions).toEqual([{ field: 'era', op: 'lte', value: 250 }])
    expect(first('obp .400 50 pa').conditions).toEqual([
      { field: 'obp', op: 'gte', value: 400 },
      { field: 'pa', op: 'gte', value: 50 },
    ])
  })

  it('reads wins, saves and starts, once a game or summed over a season', () => {
    expect(first('10 strikeouts in a win')).toMatchObject({ side: 'pitching', per: 'game', conditions: [
      { field: 'so', op: 'gte', value: 10 },
      { field: 'w', op: 'gte', value: 1 },
    ] })
    expect(first('15 wins')).toMatchObject({ per: 'season', conditions: [{ field: 'w', op: 'gte', value: 15 }] })
    expect(first('30 saves')).toMatchObject({ per: 'season', conditions: [{ field: 'sv', op: 'gte', value: 30 }] })
    expect(first('era under 3 with 20 starts').conditions).toEqual([
      { field: 'era', op: 'lte', value: 299 },
      { field: 'gs', op: 'gte', value: 20 },
    ])
  })

  it('still reads "on base" as times on base, never a percentage', () => {
    expect(first('on base 4+ times')).toMatchObject({ per: 'game', conditions: [{ field: 'ob', op: 'gte', value: 4 }] })
  })

  it('never reads an n-for-m line or a "none" as a season', () => {
    expect(read('4-for-4')).toEqual(['hitting/game'])
    expect(read('10 k no walks')).toEqual(['pitching/game'])
  })
})

describe('mightBeFinderQuestion', () => {
  it('lets through every count word the parser reads, so the gate never hides a question', async () => {
    const { mightBeFinderQuestion } = await import('../../finderGate')
    const { NUMBER_WORDS } = await import('../finderParse')
    for (const w of [...Object.keys(NUMBER_WORDS), 'without']) {
      expect(mightBeFinderQuestion(`${w} walks`), w).toBe(true)
    }
    expect(mightBeFinderQuestion('Kelsie Whitmore')).toBe(false)
    expect(mightBeFinderQuestion('3+ hits')).toBe(true)
    expect(mightBeFinderQuestion('multi-hit games')).toBe(true)
  })
})

describe('a year in a question', () => {
  it('reads a year as the season to ask about, never as a count', () => {
    const r = first('3 hr games 2025')
    expect(r.season).toBe(2025)
    expect(r.conditions).toEqual([{ field: 'hr', op: 'gte', value: 3 }])
    expect(first('5 strikeouts in 2024').season).toBe(2024)
    expect(first('5 strikeouts').season).toBeNull()
  })

  it('keeps a season count of pitches a count', () => {
    const r = parseFinderText('2500 pitches', CLUBS)
    expect(r[0].season).toBeNull()
    expect(r[0].conditions).toEqual([{ field: 'pitches', op: 'gte', value: 2500 }])
  })
})

describe('parseLeaderText', () => {
  it('reads "most hr 2026" as the home run board for that year', () => {
    const r = parseLeaderText('most hr 2026')
    expect(r[0]).toEqual({ side: 'hitting', field: 'hr', dir: 'desc', season: 2026, career: false })
    // Home runs allowed is the second reading, not a lost one.
    expect(r.map(x => x.side)).toEqual(['hitting', 'pitching'])
  })

  it("takes leaders and top as the board's own order, and top 10 as no count", () => {
    expect(parseLeaderText('era leaders')).toEqual([{ side: 'pitching', field: 'era', dir: null, season: null, career: false }])
    expect(parseLeaderText('top 10 ops')).toEqual([{ side: 'hitting', field: 'ops', dir: null, season: null, career: false }])
  })

  it("reads most and fewest as the numbers' order, whichever end is good", () => {
    expect(parseLeaderText('lowest era')[0].dir).toBe('asc')
    expect(parseLeaderText('most walks allowed')[0]).toMatchObject({ side: 'pitching', field: 'bb', dir: 'desc' })
    expect(parseLeaderText('worst era')[0].dir).toBe('desc')
  })

  it('offers both sides of a shared stat, the lean first, unless a hint settles it', () => {
    expect(parseLeaderText('most strikeouts').map(r => r.side)).toEqual(['pitching', 'hitting'])
    expect(parseLeaderText('most strikeouts by a batter').map(r => r.side)).toEqual(['hitting'])
  })

  it('leaves counts, names and a lone letter to the other searches', () => {
    expect(parseLeaderText('most 3 hr games')).toEqual([])
    expect(parseLeaderText('whitmore hr')).toEqual([])
    expect(parseLeaderText('k')).toEqual([])
    expect(parseLeaderText('kelsie whitmore')).toEqual([])
  })

  it('reads all time, ever and career as every season, over a year typed beside them', () => {
    for (const q of ['most hr all time', 'most home runs of all time', 'career hr leaders', 'most hr ever', 'all-time saves leaders']) {
      expect(parseLeaderText(q)[0], q).toMatchObject({ career: true, season: null })
    }
    expect(parseLeaderText('career hr 2024')[0]).toMatchObject({ career: true, season: null })
    // A stat alone with a career word is a ranking, as a stat alone with a year is.
    expect(parseLeaderText('career saves')[0]).toMatchObject({ side: 'pitching', field: 'sv', career: true })
  })

  it('keeps a name beside a career word for the name search', () => {
    expect(parseLeaderText('whitmore career')).toEqual([])
    expect(parseLeaderText('whitmore career hr')).toEqual([])
  })
})

describe('nameWords', () => {
  it('pulls the name out of a stat or a year', () => {
    expect(nameWords('Whitmore hr')).toBe('whitmore')
    expect(nameWords('ohtani 2023')).toBe('ohtani')
    expect(nameWords('ohtani career')).toBe('ohtani')
    expect(nameWords('Whitmore all time hr')).toBe('whitmore')
    expect(nameWords('most home runs')).toBeNull()
  })

  it('leaves a plain name, and initials, as typed', () => {
    expect(nameWords('Kelsie Whitmore')).toBeNull()
    expect(nameWords('R.J. Smith')).toBeNull()
  })
})

describe('parseCompareText', () => {
  it('reads two names, any of the usual joins, and a year', () => {
    expect(parseCompareText('Whitmore vs Ibarra')).toEqual({ a: 'whitmore', b: 'ibarra', season: null })
    expect(parseCompareText('judge or ohtani 2024')).toEqual({ a: 'judge', b: 'ohtani', season: 2024 })
    expect(parseCompareText('compare Kelsie Whitmore and Diana Ibarra')).toEqual({ a: 'kelsie whitmore', b: 'diana ibarra', season: null })
  })

  it('leaves a line question against a club, and a plain "and", to the other searches', () => {
    expect(parseCompareText('3 hits vs SF')).toBeNull()
    expect(parseCompareText('home runs vs Boston')).toBeNull()
    expect(parseCompareText('whitmore and ibarra')).toBeNull()
    expect(parseCompareText('kelsie whitmore')).toBeNull()
  })
})

describe('typedSeason', () => {
  it('reads the year typed beside a name, and nothing else', () => {
    expect(typedSeason('Ohtani 2023')).toBe(2023)
    expect(typedSeason('Ohtani career')).toBe('career')
    expect(typedSeason('Ohtani career 2023')).toBe('career')
  })
})

describe('typedPart', () => {
  it('reads a part of the card beside a name, and takes it out of the name search', () => {
    expect(typedPart('Ohtani splits')).toBe('splits')
    expect(typedPart('Whitmore game log')).toBe('log')
    expect(typedPart('ohtani pitch mix 2023')).toBe('pitches')
    expect(nameWords('Whitmore game log')).toBe('whitmore')
    expect(nameWords('ohtani splits 2023')).toBe('ohtani')
  })

  it('wants a name: a part word alone, or a Find question with games in it, is no player to open', () => {
    expect(typedPart('splits')).toBeNull()
    expect(typedPart('3 hit games')).toBeNull()
    expect(typedPart('Logan Webb')).toBeNull()
    expect(typedSeason('Ohtani')).toBeNull()
    expect(typedSeason('2500 pitches')).toBeNull()
  })
})

describe('a slip in a stat word', () => {
  it('puts the stat right and reads the question', () => {
    expect(first('5 strikeuots no walks').conditions).toEqual([
      { field: 'so', op: 'gte', value: 5 },
      { field: 'bb', op: 'eq', value: 0 },
    ])
    expect(first('2 homres').conditions).toEqual([{ field: 'hr', op: 'gte', value: 2 }])
    expect(parseLeaderText('most doubels')[0]).toMatchObject({ side: 'hitting', field: '2b' })
  })

  it('leaves club names, short words and names alone', () => {
    const clubs: FinderClubAlias[] = [{ id: 'MIN', names: ['Twins', 'Minnesota'] }, { id: 'ATL', names: ['Braves', 'Atlanta'] }]
    expect(parseFinderText('5 hr vs twins', clubs)[0].oppId).toBe('MIN')
    expect(parseFinderText('3 hits vs braves', clubs)[0].oppId).toBe('ATL')
    expect(parseLeaderText('twins')).toEqual([])
    expect(nameWords('whitmore homres')).toBe('whitmore')
    expect(nameWords('Kelsie Whitmore')).toBeNull()
  })
})

describe('parseClubPage', () => {
  it('reads a club and a part of its page, in either order', () => {
    expect(parseClubPage('SF schedule', CLUBS)).toEqual([{ clubId: 'SF', part: 'schedule' }])
    expect(parseClubPage('roster for the Hunters', CLUBS)).toEqual([{ clubId: 'BOS', part: 'roster' }])
    expect(parseClubPage("Boston's standings", CLUBS)).toEqual([{ clubId: 'BOS', part: 'standings' }])
  })

  it('offers each club a shared city could mean', () => {
    expect(parseClubPage('Chicago roster', CLUBS).map(r => r.clubId)).toEqual(['CHC', 'CWS'])
  })

  it('leaves a club alone, a stat question and a stray word to the other searches', () => {
    expect(parseClubPage('SF', CLUBS)).toEqual([])
    expect(parseClubPage('3 hits vs SF', CLUBS)).toEqual([])
    expect(parseClubPage('Whitmore SF stats', CLUBS)).toEqual([])
  })
})

describe('parseGameQuery', () => {
  const NOW = new Date(2026, 9, 14) // Oct 14, 2026
  const q = (t: string) => parseGameQuery(t, CLUBS, NOW)

  it('reads two clubs and a day, written any of the usual ways', () => {
    expect(q('SF vs NY sep 9')).toEqual({ clubs: [['SF'], ['NY']], when: { date: '2026-09-09' } })
    expect(q('NY at SF 9/9/2025')).toEqual({ clubs: [['NY'], ['SF']], when: { date: '2025-09-09' } })
    expect(q('Boston 2026-08-30')).toEqual({ clubs: [['BOS']], when: { date: '2026-08-30' } })
    expect(q('Hunters sep 9 2025')?.when).toEqual({ date: '2025-09-09' })
  })

  it('takes a day with no year as the latest one, never one still to come', () => {
    expect(q('SF dec 25')?.when).toEqual({ date: '2025-12-25' })
  })

  it('reads yesterday, last and next', () => {
    expect(q('Boston last night')?.when).toEqual({ date: '2026-10-13' })
    expect(q('Hunters next game')?.when).toBe('next')
    expect(q('the Heights latest')?.when).toBe('last')
  })

  it('reads two clubs alone as their meetings, and a shared city as both its clubs', () => {
    expect(q('Firebells Hunters')).toEqual({ clubs: [['SF'], ['BOS']], when: null })
    expect(q('Chicago tomorrow')?.clubs).toEqual([['CHC', 'CWS']])
  })

  it('leaves a club alone, a stat question and a stray word to the other searches', () => {
    expect(q('SF')).toBeNull()
    expect(q('3 hits vs SF')).toBeNull()
    expect(q('Whitmore SF last night')).toBeNull()
  })
})

describe('pickGames', () => {
  const G = [
    { d: '2026-09-07', played: true }, { d: '2026-09-09', played: true },
    { d: '2026-09-09', played: true }, { d: '2026-09-20', played: false },
  ]
  const pick = (when: Parameters<typeof pickGames>[1]) =>
    pickGames(G, when, '2026-09-10', g => g.d, g => g.played).map(g => g.d)

  it('gives every game on a day, the latest played, the next, or one of each', () => {
    expect(pick({ date: '2026-09-09' })).toEqual(['2026-09-09', '2026-09-09'])
    expect(pick('last')).toEqual(['2026-09-09'])
    expect(pick('next')).toEqual(['2026-09-20'])
    expect(pick(null)).toEqual(['2026-09-09', '2026-09-20'])
  })
})

describe('parseFinderText on a section with a Fielding side', () => {
  const SIDES = ['hitting', 'pitching', 'fielding'] as const
  const read = (t: string) => parseFinderText(t, CLUBS, SIDES)

  it('reads a fielding stat as the fielding side, and only where the section has one', () => {
    expect(read('2 errors')[0]).toMatchObject({ side: 'fielding', per: 'game', conditions: [{ field: 'e', op: 'gte', value: 2 }] })
    expect(read('10 putouts 0 errors vs SF')[0]).toMatchObject({
      side: 'fielding', oppId: 'SF',
      conditions: [{ field: 'po', op: 'gte', value: 10 }, { field: 'e', op: 'eq', value: 0 }],
    })
    // MLB stores no fielding lines, so its parser is never handed the side and offers nothing.
    expect(parseFinderText('2 errors', CLUBS)).toEqual([])
  })

  it('reads a season of errors or a fielding percentage as a season', () => {
    expect(read('10 errors')[0]).toMatchObject({ side: 'fielding', per: 'season' })
    expect(read('fielding percentage over .980')[0]).toMatchObject({
      side: 'fielding', per: 'season', conditions: [{ field: 'fpct', op: 'gte', value: 981 }],
    })
  })

  it('gives a double play to the batter unless a word says the fielder turned it', () => {
    expect(read('2 double plays').map(r => r.side)).toEqual(['hitting', 'fielding'])
    expect(read('fielders with 2 double plays').map(r => r.side)).toEqual(['fielding'])
    expect(read('turned 2 double plays')[0]).toMatchObject({ side: 'fielding', ignored: [] })
  })

  it('leaves the hitting and pitching readings as they were', () => {
    expect(read('5 strikeouts').filter(x => x.per === 'game').map(x => x.side)).toEqual(['pitching', 'hitting'])
    expect(read('4-for-4').map(x => x.side)).toEqual(['hitting'])
  })
})

describe('parseFinderText: the inning grain', () => {
  const inn = (t: string) => parseFinderText(t, CLUBS, ['hitting', 'pitching', 'fielding'], { plays: true })

  it('reads "in an inning" as one pitcher half-inning, and only that', () => {
    for (const t of ['3 strikeouts in an inning', '3 k in one inning', 'pitchers with 3 strikeouts in a single inning', '3+ ks per inning']) {
      const r = inn(t)
      expect(r.map(x => [x.side, x.per]), t).toEqual([['pitching', 'inning']])
      expect(r[0].conditions, t).toEqual([{ field: 'so', op: 'gte', value: 3 }])
    }
  })

  it('leaves innings pitched alone', () => {
    const r = inn('5 innings no walks')
    expect(r[0]).toMatchObject({ side: 'pitching', per: 'game' })
    expect(r[0].conditions).toContainEqual({ field: 'ip', op: 'gte', value: 15 })
    expect(inn('one inning no hits').every(x => x.per !== 'inning')).toBe(true)
  })

  it('reads the named innings as their conditions', () => {
    expect(inn('immaculate inning')[0]).toMatchObject({ per: 'inning', conditions: [{ field: 'so', op: 'gte', value: 3 }, { field: 'pitches', op: 'lte', value: 9 }] })
    expect(inn('immaculate innings vs SF')[0]).toMatchObject({ per: 'inning', oppId: 'SF' })
    expect(inn('1-2-3 innings')[0].conditions.map(c => c.field)).toEqual(['bf', 'outs', 'baserunners'])
    expect(inn('1 2 3 hits')).not.toContainEqual(expect.objectContaining({ per: 'inning' }))
  })

  it('offers nothing an inning cannot hold, and nothing to a section without the grain', () => {
    // A batter has no inning grain, so three hits in an inning is the pitcher's three hits allowed.
    expect(inn('3 hits in an inning').map(x => [x.side, x.per])).toEqual([['pitching', 'inning']])
    expect(inn('era under 2 in an inning')).toEqual([])
    expect(parseFinderText('3 strikeouts in an inning', CLUBS)).toEqual([])
  })
})

describe('parseFinderText: the plate-appearance grain', () => {
  const pa = (t: string) => parseFinderText(t, CLUBS, ['hitting', 'pitching', 'fielding'], { plays: true })
  const best = (t: string) => pa(t)[0]

  it('reads a count, the bases, the outs and a walk-off as one trip to the plate', () => {
    expect(best('home run on 0-2')).toMatchObject({ side: 'hitting', per: 'pa', conditions: [
      { field: 'balls', op: 'eq', value: 0 }, { field: 'scount', op: 'eq', value: 2 }, { field: 'hr', op: 'gte', value: 1 }] })
    expect(best('strikeouts on a full count')).toMatchObject({ side: 'pitching', per: 'pa' })
    expect(best('bases loaded walks').conditions).toEqual([{ field: 'on', op: 'eq', value: 3 }, { field: 'bb', op: 'gte', value: 1 }])
    expect(best('grand slams').conditions).toEqual([{ field: 'hr', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }])
    expect(best('walk-off hits').conditions).toEqual([{ field: 'walkoff', op: 'eq', value: 1 }, { field: 'h', op: 'gte', value: 1 }])
    expect(best('2-out hits').conditions).toEqual([{ field: 'paouts', op: 'eq', value: 2 }, { field: 'h', op: 'gte', value: 1 }])
  })

  it('reads a pitch count on one at-bat, either side', () => {
    expect(pa('10-pitch at-bats').map(r => [r.side, r.per])).toEqual([['hitting', 'pa'], ['pitching', 'pa']])
    expect(best('10 pitch at bats').conditions).toEqual([{ field: 'pitches', op: 'gte', value: 10 }])
    expect(best('8-pitch walks').conditions).toEqual([{ field: 'pitches', op: 'gte', value: 8 }, { field: 'bb', op: 'gte', value: 1 }])
    expect(best('pitchers allowing 10 pitch at-bats')).toMatchObject({ side: 'pitching' })
  })

  it('leaves the game questions it looks like alone', () => {
    expect(best('100 pitches')).toMatchObject({ side: 'pitching', per: 'game' })
    expect(pa('100 pitches').every(r => r.side === 'pitching')).toBe(true)
    expect(best('2 walks')).toMatchObject({ per: 'game' })
    expect(best('4 for 4')).toMatchObject({ per: 'game' })
  })

  it('offers nothing to a section without the grain, or to the glove', () => {
    expect(parseFinderText('home run on 0-2', CLUBS)).toEqual([])
    // A word it cannot use is said back, as any unread word is, and no fielding reading is offered.
    expect(pa('errors on 0-2').every(r => r.side !== 'fielding' && r.ignored.includes('errors'))).toBe(true)
    expect(pa('home run on 0-2 in an inning')).toEqual([])
  })
})

describe('parseFinderText: situations and the inning in words', () => {
  const wpbl = (t: string) => parseFinderText(t, CLUBS, ['hitting', 'pitching', 'fielding'], { plays: true, regulationInnings: 7 })
  const best = (t: string) => wpbl(t)[0]
  const conds = (t: string) => best(t)?.conditions.map(c => `${c.field}.${c.op}.${c.value}`)

  it('reads runners in scoring position and empty bases', () => {
    expect(best('hits with runners in scoring position')).toMatchObject({ side: 'hitting', per: 'pa' })
    expect(conds('hits with risp')).toEqual(['risp.eq.1', 'h.gte.1'])
    expect(conds('home runs with the bases empty')).toEqual(['on.eq.0', 'hr.gte.1'])
    expect(conds('walks with runners on')).toEqual(['on.gte.1', 'bb.gte.1'])
  })

  it('reads which inning, and picks the grain from what is beside it', () => {
    expect(best('3 strikeouts in the 7th')).toMatchObject({ side: 'pitching', per: 'inning' })
    expect(conds('3 strikeouts in the 7th')).toEqual(['inn.eq.7', 'so.gte.3'])
    expect(best('home runs in the 1st inning')).toMatchObject({ side: 'hitting', per: 'pa' })
    expect(conds('home runs in the first inning')).toEqual(['inn.eq.1', 'hr.gte.1'])
    expect(conds('strikeouts in the 5th or later')).toEqual(['inn.gte.5', 'so.gte.1'])
    expect(conds('hits after the 6th')).toEqual(['inn.gte.7', 'h.gte.1'])
    expect(conds('walks before the 3rd')).toEqual(['inn.lte.2', 'bb.gte.1'])
  })

  it('takes extra innings from the league', () => {
    expect(conds('home runs in extra innings')).toEqual(['inn.gte.8', 'hr.gte.1'])
    expect(parseFinderText('home runs in extras', CLUBS, ['hitting', 'pitching'], { plays: true })[0].conditions[0])
      .toEqual({ field: 'inn', op: 'gte', value: 10 })
  })

  it('leaves innings pitched alone, and offers MLB nothing', () => {
    expect(best('7 innings no walks')).toMatchObject({ per: 'game' })
    expect(parseFinderText('home runs in the 7th', CLUBS)).toEqual([])
  })
})
