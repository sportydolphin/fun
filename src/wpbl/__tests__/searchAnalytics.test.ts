import { describe, expect, it } from 'vitest'
import { wpblSearchedProps } from '../searchAnalytics'

describe('wpblSearchedProps', () => {
  it('keeps the typed text only when nothing at all answered', () => {
    expect(wpblSearchedProps('zzyzx', 0, 0)).toEqual({ length: 5, players: 0, teams: 0, finder: 0, q: 'zzyzx' })
    expect(wpblSearchedProps('whit', 2, 0)).toEqual({ length: 4, players: 2, teams: 0, finder: 0 })
  })

  it('does not count a stat question as a miss', () => {
    const props = wpblSearchedProps('5 strikeouts no walks', 0, 0)
    expect(props).not.toHaveProperty('q')
    expect(props.finder).toBe(2)
  })

  it('still counts a number with no stat beside it as a miss', () => {
    expect(wpblSearchedProps('99', 0, 0)).toMatchObject({ finder: 0, q: '99' })
  })

  it('caps the stored text at 40 characters', () => {
    expect(String(wpblSearchedProps('x'.repeat(60), 0, 0).q)).toHaveLength(40)
  })
})
