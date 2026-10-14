import { describe, expect, it } from 'vitest'
import { parseFinderText, type FinderClubAlias } from '../finderParse'

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
    const r = parseFinderText('5 strikeouts', CLUBS)
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

describe('mightBeFinderQuestion', () => {
  it('lets through every count word the parser reads, so the gate never hides a question', async () => {
    const { mightBeFinderQuestion } = await import('../../finderGate')
    const { NUMBER_WORDS } = await import('../finderParse')
    for (const w of [...Object.keys(NUMBER_WORDS), 'without']) {
      expect(mightBeFinderQuestion(`${w} walks`), w).toBe(true)
    }
    expect(mightBeFinderQuestion('Kelsie Whitmore')).toBe(false)
    expect(mightBeFinderQuestion('3+ hits')).toBe(true)
  })
})
