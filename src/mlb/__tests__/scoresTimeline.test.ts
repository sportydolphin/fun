import { describe, it, expect } from 'vitest'
import { anchorIndex, indexOnOrAfter, nextChunk, prevChunk, activeDay, CHUNK } from '../scoresTimeline'

const DAYS = ['2026-10-03', '2026-10-04', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']

describe('the day the Scores page opens on', () => {
  it('is today once a game has started, so the latest result is the first thing on screen', () => {
    expect(DAYS[anchorIndex(DAYS, '2026-10-12', true)]).toBe('2026-10-12')
  })

  it('is the last game day before today when nothing today has started: last night\'s finals, then today below', () => {
    expect(DAYS[anchorIndex(DAYS, '2026-10-12', false)]).toBe('2026-10-09')
  })

  it('is the last game day before an off day', () => {
    expect(DAYS[anchorIndex(DAYS, '2026-10-11', false)]).toBe('2026-10-09')
  })

  it('is opening day before the season, and the last day after it', () => {
    expect(anchorIndex(DAYS, '2026-03-01', false)).toBe(0)
    expect(DAYS[anchorIndex(DAYS, '2026-12-01', false)]).toBe('2026-10-13')
  })

  it('is nothing without a schedule', () => {
    expect(anchorIndex([], '2026-10-12', true)).toBe(-1)
  })
})

describe('a jump to a date', () => {
  it('lands on that day, or the next game day after an off day', () => {
    expect(DAYS[indexOnOrAfter(DAYS, '2026-10-06')]).toBe('2026-10-06')
    expect(DAYS[indexOnOrAfter(DAYS, '2026-10-05')]).toBe('2026-10-06')
  })

  it('lands on the last day for a date past the season', () => {
    expect(DAYS[indexOnOrAfter(DAYS, '2026-11-20')]).toBe('2026-10-13')
  })
})

describe('loading more days', () => {
  it('fetches the next run below, and stops at the end of the schedule', () => {
    expect(nextChunk(DAYS, 1)).toEqual([2, Math.min(DAYS.length - 1, 1 + CHUNK)])
    expect(nextChunk(DAYS, DAYS.length - 1)).toBeNull()
  })

  it('fetches the run above, and stops at opening day', () => {
    expect(prevChunk(5)).toEqual([Math.max(0, 5 - CHUNK), 4])
    expect(prevChunk(2)).toEqual([0, 1])
    expect(prevChunk(0)).toBeNull()
  })
})

describe('the day being read', () => {
  it('is the last section whose top has passed under the pinned bar', () => {
    const tops = [{ day: 'a', top: -400 }, { day: 'b', top: 90 }, { day: 'c', top: 600 }]
    expect(activeDay(tops, 120)).toBe('b')
    expect(activeDay(tops, 60)).toBe('a')
  })

  it('is the first section before any has reached the bar', () => {
    expect(activeDay([{ day: 'a', top: 300 }], 120)).toBe('a')
  })
})
