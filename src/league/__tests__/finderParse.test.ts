import { describe, expect, it } from 'vitest'
import { nameWords, parseClubPage, parseGameQuery, pickGames, parseCompareText, typedSeason, parseFinderText, parseLeaderText, type FinderClubAlias } from '../finderParse'

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
