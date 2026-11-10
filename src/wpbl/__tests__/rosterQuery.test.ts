import { describe, expect, it } from 'vitest'
import { ageOn, parseRosterQuery } from '../rosterQuery'

const lefty = { bats: 'L', throws: 'L', birth_date: '2004-05-01' }
const righty = { bats: 'R', throws: 'R', birth_date: '1990-01-01' }
const switcher = { bats: 'S', throws: 'R', birth_date: null }

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
    expect(parseRosterQuery('oldest')!.keep(switcher, false)).toBe(false)
  })

  it('leave names and stat questions alone', () => {
    expect(parseRosterQuery('Whitmore')).toBeNull()
    expect(parseRosterQuery('hr vs lefties')).toBeNull()
  })

  it('count whole years, the birthday itself included', () => {
    expect(ageOn('2004-05-01', '2026-04-30')).toBe(21)
    expect(ageOn('2004-05-01', '2026-05-01')).toBe(22)
  })
})
