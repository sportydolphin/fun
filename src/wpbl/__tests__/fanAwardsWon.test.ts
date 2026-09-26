import { describe, it, expect, vi } from 'vitest'

// The tally helpers are pure; the module's supabase import is not what is under test.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const { fanAwardsWon } = await import('../awardVotes')
const { awardById } = await import('../awards')

const AFTER = Date.parse('2026-10-15T00:00:00Z')
const closesAt = (id: string) => Date.parse(awardById(id)!.closesAt)

describe('fanAwardsWon', () => {
  it('names the player categories this player topped once voting closed', () => {
    const results = { mvp: { p1: 40, p2: 12 }, pitcher: { p2: 30, p1: 3 }, aura: { p1: 9 } }
    expect(fanAwardsWon(results, 'p1', AFTER).map(a => a.id)).toEqual(['mvp', 'aura'])
    expect(fanAwardsWon(results, 'p2', AFTER).map(a => a.id)).toEqual(['pitcher'])
  })

  it('says nothing while a category is still open: a running leader is not a winner', () => {
    const results = { mvp: { p1: 40 } }
    expect(fanAwardsWon(results, 'p1', closesAt('mvp') - 1)).toEqual([])
  })

  it('breaks a tie the way the results sheet does, by choice key', () => {
    expect(fanAwardsWon({ mvp: { b: 5, a: 5 } }, 'a', AFTER).map(a => a.id)).toEqual(['mvp'])
    expect(fanAwardsWon({ mvp: { b: 5, a: 5 } }, 'b', AFTER)).toEqual([])
  })

  it('never hands a player the manager award, whose choices are not players', () => {
    expect(fanAwardsWon({ manager: { p1: 99 } }, 'p1', AFTER)).toEqual([])
  })

  it('ignores a category nobody voted in', () => {
    expect(fanAwardsWon({ mvp: { p1: 0 } }, 'p1', AFTER)).toEqual([])
    expect(fanAwardsWon({}, 'p1', AFTER)).toEqual([])
  })
})
