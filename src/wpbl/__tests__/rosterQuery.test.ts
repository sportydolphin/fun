import { describe, expect, it } from 'vitest'
import { ageOn, parsePlayerFact, parseRosterQuery, rosterNote, rosterOrder, type RosterPlayer } from '../rosterQuery'

const base: RosterPlayer = { bats: null, throws: null, birth_date: null, birth_date_source: null, hometown: null, draft_round: null, draft_pick: null, jersey_number: null }
const lefty: RosterPlayer = { ...base, bats: 'L', throws: 'L', birth_date: '2004-05-01', birth_date_source: 'doc', hometown: 'Vancouver, British Columbia, Canada', draft_round: 1, draft_pick: 3, jersey_number: '7' }
const righty: RosterPlayer = { ...base, bats: 'R', throws: 'R', birth_date: '1990-11-22', birth_date_source: 'sheet', hometown: 'San Diego, California, USA', draft_round: 2, draft_pick: 1 }
const switcher: RosterPlayer = { ...base, bats: 'S', throws: 'R', birth_date: '2000-11-20', birth_date_source: 'doc-unsettled', hometown: 'Perth, Australia' }
const TODAY = '2026-11-20'

describe('roster questions', () => {
  it('read "lefties" as pitchers, and a hitter\'s hand when it says hitters', () => {
    const q = parseRosterQuery('lefties')!
    expect(q.keep(lefty, true)).toBe(true)
    expect(q.keep(lefty, false)).toBe(false)
    expect(parseRosterQuery('left-handed hitters')!.keep(lefty, false)).toBe(true)
    expect(parseRosterQuery('right handed pitchers')!.keep(righty, true)).toBe(true)
    expect(parseRosterQuery('switch hitters')!.keep(switcher, false)).toBe(true)
  })

  it('order by age, leaving out a player with no birth date', () => {
    expect(parseRosterQuery('youngest player')).toMatchObject({ order: 'youngest', note: 'age' })
    expect(parseRosterQuery('Who are the oldest players?')).toMatchObject({ order: 'oldest' })
    expect(parseRosterQuery('oldest')!.keep(base, false)).toBe(false)
  })

  it('leave names and stat questions alone', () => {
    expect(parseRosterQuery('Whitmore')).toBeNull()
    expect(parseRosterQuery('hr vs lefties')).toBeNull()
  })

  it('count whole years, the birthday itself included', () => {
    expect(ageOn('2004-05-01', '2026-04-30')).toBe(21)
    expect(ageOn('2004-05-01', '2026-05-01')).toBe(22)
  })

  // The Nov 20, 2026 probe: every one of these offered nothing.
  it('read a hometown by any part of it, a country by its everyday name or its people', () => {
    const from = (t: string) => [lefty, righty, switcher].filter(p => parseRosterQuery(t, TODAY)!.keep(p, false))
    expect(from('players from Canada')).toEqual([lefty])
    expect(from('from california')).toEqual([righty])
    expect(from('born in the United States')).toEqual([righty])
    expect(from('Australians')).toEqual([switcher])
    expect(from('canadian players')).toEqual([lefty])
    expect(parseRosterQuery('from', TODAY)).toBeNull()
  })

  it('read birthdays on a settled date only, soonest first', () => {
    const q = parseRosterQuery('birthdays this week', TODAY)!
    expect([lefty, righty, switcher].filter(p => q.keep(p, false))).toEqual([righty])
    expect(rosterOrder([{ ...lefty, name: 'A' }, { ...righty, name: 'B' }], parseRosterQuery('birthdays', TODAY)!.order, TODAY).map(p => p.name)).toEqual(['B', 'A'])
    expect(parseRosterQuery('born in 2004', TODAY)!.keep(lefty, false)).toBe(true)
    expect(parseRosterQuery('born 2004', TODAY)!.keep(lefty, false)).toBe(true)
    expect(parseRosterQuery('born in november', TODAY)!.keep(switcher, false)).toBe(false)
    expect(rosterNote('birthday', switcher, TODAY)).toBe('Age 26')
    expect(rosterNote('birthday', righty, TODAY)).toBe('Born Nov 22, 1990')
  })

  it('read a draft round and the first pick', () => {
    expect(parseRosterQuery('first round picks', TODAY)!.keep(lefty, false)).toBe(true)
    expect(parseRosterQuery('2nd round', TODAY)!.keep(righty, false)).toBe(true)
    expect(parseRosterQuery('first overall pick', TODAY)!.keep(lefty, false)).toBe(false)
    expect(rosterNote('draft', lefty, TODAY)).toBe('Round 1, pick 3')
  })

  it("read one player's fact with the name wherever it is typed", () => {
    expect(parsePlayerFact('Whitmore hometown')).toEqual({ name: 'whitmore', note: 'hometown' })
    expect(parsePlayerFact("Sato's age")).toEqual({ name: 'sato', note: 'age' })
    expect(parsePlayerFact('where is Lee from?')).toEqual({ name: 'lee', note: 'hometown' })
    expect(parsePlayerFact('how old is Kelsie Whitmore')).toEqual({ name: 'kelsie whitmore', note: 'age' })
    expect(parsePlayerFact('when is Sato birthday')).toEqual({ name: 'sato', note: 'birthday' })
    expect(parsePlayerFact('whitmore jersey number')).toEqual({ name: 'whitmore', note: 'number' })
    expect(parsePlayerFact('whitmore hr')).toBeNull()
    expect(parsePlayerFact('age')).toBeNull()
  })
})
