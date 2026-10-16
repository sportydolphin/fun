import { describe, it, expect } from 'vitest'
import { ordinal, shortDate } from '../format'

describe('ordinal', () => {
  it('handles the ones that break naive rules', () => {
    expect([0, 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal))
      .toEqual(['0th', '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th'])
  })
})

describe('shortDate', () => {
  it('reads the digits, so no zone moves the day', () => {
    expect(shortDate('2026-08-05')).toBe('Aug 5')
    expect(shortDate('2026-12-31T00:00:00Z')).toBe('Dec 31')
  })
  it('is empty without a date', () => {
    expect(shortDate(null)).toBe('')
    expect(shortDate('')).toBe('')
    expect(shortDate('2026-13-01')).toBe('')
  })
})
