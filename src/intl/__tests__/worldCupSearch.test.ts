import { describe, it, expect } from 'vitest'
import { matchWorldCup } from '../worldCupSearch'
import type { WorldCupIndexEntry } from '../wbsc/editions'
import type { WorldCupSearchPerson } from '../wbsc/personFile'

// Synthetic names only (see wbsc/__tests__/fixture.ts for why).
const people: WorldCupSearchPerson[] = [
  { slug: 'dana-quill', name: 'Dana Quill', country: 'CAN', editions: ['2018', '2024'] },
  { slug: 'quinn-dale', name: 'Quinn Dale', country: 'AUS', editions: ['2024'] },
  { slug: 'mara-quillon', name: 'Mara Quillon', country: 'FRA', editions: ['2016'] },
]
const edition = (slug: string, years: number[]): WorldCupIndexEntry => ({
  slug, title: `${slug} World Cup`, years, hosts: [], teams: 12, games: 30, medals: null,
  team_ids: slug === '2016' ? ['CAN', 'USA', 'KOR'] : ['CAN', 'USA', 'TPE'],
})
// Shuffled, so the order is the matcher's and not the file's.
const editions = [edition('2018', [2018]), edition('2016', [2016]), edition('2024', [2023, 2024])]

describe('World Cup search', () => {
  it('ranks a surname match above one inside a word, and narrows to a typed year', () => {
    expect(matchWorldCup(people, editions, 'quill', null).people.map(p => p.slug)).toEqual(['dana-quill', 'mara-quillon'])
    expect(matchWorldCup(people, editions, 'quill', 2016).people.map(p => p.slug)).toEqual(['mara-quillon'])
  })

  it('answers the competition with its editions, newest first, and a year with that one', () => {
    expect(matchWorldCup(people, editions, 'world cup', null).editions.map(e => e.slug)).toEqual(['2024', '2018', '2016'])
    expect(matchWorldCup(people, editions, 'world', 2023).editions.map(e => e.slug)).toEqual(['2024'])
    expect(matchWorldCup(people, editions, 'wbsc', null).people).toEqual([])
  })

  it('forgives a slip only when nothing matched as typed', () => {
    const m = matchWorldCup(people, editions, 'quil dana', null)
    expect(m.forgiving).toBe(true)
    expect(m.people[0]?.slug).toBe('dana-quill')
    expect(matchWorldCup(people, editions, 'q', null).people).toEqual([])
  })

  it('finds a team by its name, an everyday alias or its whole code, and a year typed alone', () => {
    expect(matchWorldCup(people, editions, 'canada', null).teams).toEqual(['CAN'])
    expect(matchWorldCup(people, editions, 'united states', null).teams).toEqual(['USA'])
    expect(matchWorldCup(people, editions, 'taiwan', null).teams).toEqual(['TPE'])
    expect(matchWorldCup(people, editions, 'korea', 2024).teams).toEqual([])
    expect(matchWorldCup(people, editions, 'tpe', null).teams).toEqual(['TPE'])
    expect(matchWorldCup(people, editions, 'ca', null).teams).toEqual([])
    expect(matchWorldCup(people, editions, '', 2023).editions.map(e => e.slug)).toEqual(['2024'])
  })
})
