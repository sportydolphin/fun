import { describe, it, expect } from 'vitest'
import { countdownLabel } from '../constants'

const now = Date.parse('2026-09-04T12:00:00Z')
const inMs = (ms: number) => countdownLabel(now + ms, now)
const MIN = 60000, HOUR = 3600000, DAY = 86400000

describe('countdownLabel', () => {
  // The whole point of the format: no seconds place, and never a zero-padded digit. The card
  // is glanced at, not counted down from.
  it('never shows seconds', () => {
    for (const ms of [90 * MIN, 5 * HOUR + 52 * MIN + 44000, 3 * DAY]) {
      expect(inMs(ms)).not.toMatch(/s\b|\d\ds/)
    }
  })

  it('reads as a phrase at every range', () => {
    expect(inMs(14 * MIN)).toBe('in 14m')
    expect(inMs(5 * HOUR + 52 * MIN + 44000)).toBe('in 5h 52m')
    expect(inMs(2 * DAY + 5 * HOUR + 41 * MIN)).toBe('in 2d 5h')
  })

  // Two units at most, so the days case drops the minutes rather than reading "in 2d 0h 41m".
  it('caps at two units', () => {
    expect(inMs(2 * DAY + 41 * MIN)).toBe('in 2d')
    expect(inMs(3 * HOUR)).toBe('in 3h 0m')
  })

  // Under a minute and past first pitch are the same message: the stored time is a schedule,
  // not a start, so counting the last seconds of it claims precision we do not have.
  it('stops counting inside the last minute', () => {
    expect(inMs(30000)).toBe('starting soon')
    expect(inMs(0)).toBe('starting soon')
    expect(inMs(-2 * HOUR)).toBe('starting soon')
  })
})
