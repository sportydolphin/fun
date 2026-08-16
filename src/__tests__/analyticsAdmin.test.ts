import { describe, it, expect } from 'vitest'
import {
  deltaPct, formatDelta, formatCount, formatShare,
  trimLeadingEmpty, prettyEvent, seriesPoints, shortDate,
} from '../lib/analyticsAdmin'

describe('deltaPct', () => {
  it('measures the change against the previous window', () => {
    expect(deltaPct(150, 100)).toBe(50)
    expect(deltaPct(50, 100)).toBe(-50)
    expect(deltaPct(100, 100)).toBe(0)
  })

  it('is null when there is no previous window to compare against', () => {
    // Not 0 (which would claim "flat") and not Infinity (which would render as "+∞%").
    // The events table is 12 days old, so most 30-day comparisons hit this.
    expect(deltaPct(500, 0)).toBeNull()
    expect(deltaPct(0, 0)).toBeNull()
  })
})

describe('formatDelta', () => {
  it('signs the number and marks an unknown baseline', () => {
    expect(formatDelta(12.4)).toBe('+12%')
    expect(formatDelta(-4.6)).toBe('−5%')
    expect(formatDelta(null)).toBe('—')
  })

  it('reads sub-half-percent movement as flat rather than signing noise', () => {
    expect(formatDelta(0.3)).toBe('0%')
    expect(formatDelta(-0.2)).toBe('0%')
  })
})

describe('formatCount', () => {
  it('keeps small counts exact and abbreviates above a thousand', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1200)).toBe('1.2k')
    expect(formatCount(2000)).toBe('2k')
    expect(formatCount(10_973)).toBe('11k')
  })
})

describe('formatShare', () => {
  it('keeps a decimal on the small rates the dashboard actually watches', () => {
    // Discord joins land near 8% and signed-in share near 4%; whole percent would hide
    // exactly the movement these tiles exist to show.
    expect(formatShare(102, 1227)).toBe('8.3%')
    expect(formatShare(54, 1271)).toBe('4.2%')
  })

  it('rounds once the rate is big enough not to need the decimal', () => {
    expect(formatShare(1, 2)).toBe('50%')
  })

  it('does not divide by zero', () => {
    expect(formatShare(0, 0)).toBe('—')
  })
})

describe('trimLeadingEmpty', () => {
  const d = (date: string, events: number) => ({ date, events })

  it('drops the blank stretch before the data starts', () => {
    expect(trimLeadingEmpty([d('a', 0), d('b', 0), d('c', 5), d('d', 7)]))
      .toEqual([d('c', 5), d('d', 7)])
  })

  it('keeps a zero day inside the data — a quiet day is a real reading', () => {
    expect(trimLeadingEmpty([d('a', 5), d('b', 0), d('c', 7)]))
      .toEqual([d('a', 5), d('b', 0), d('c', 7)])
  })

  it('leaves an all-empty series alone rather than returning nothing to draw', () => {
    const all = [d('a', 0), d('b', 0)]
    expect(trimLeadingEmpty(all)).toEqual(all)
    expect(trimLeadingEmpty([])).toEqual([])
  })
})

describe('prettyEvent', () => {
  it('turns a snake_case event name into a label', () => {
    expect(prettyEvent('wpbl_player_opened')).toBe('Wpbl player opened')
    expect(prettyEvent('login')).toBe('Login')
  })
})

describe('shortDate', () => {
  it('reads the date as written, with no timezone shift', () => {
    // Parsing '2026-08-05' via `new Date(iso)` treats it as UTC midnight, which renders as
    // Aug 4 anywhere west of Greenwich — the off-by-one that makes a chart axis lie.
    expect(shortDate('2026-08-05')).toBe('Aug 5')
    expect(shortDate('2026-12-31T00:00:00Z')).toBe('Dec 31')
  })
})

describe('seriesPoints', () => {
  it('scales the peak to the top of the box and the floor to the bottom', () => {
    const { points, max } = seriesPoints([0, 5, 10], 100, 50)
    expect(max).toBe(10)
    expect(points).toBe('0.0,50.0 50.0,25.0 100.0,0.0')
  })

  it('pins a flat series to the floor instead of dividing by its zero range', () => {
    const { points, max } = seriesPoints([0, 0, 0], 100, 50)
    expect(max).toBe(0)
    expect(points).toBe('0.0,50.0 50.0,50.0 100.0,50.0')
    expect(points).not.toContain('NaN')
  })

  it('centres a single point rather than collapsing it onto the y-axis', () => {
    expect(seriesPoints([4], 100, 50).points).toBe('50.0,0.0')
  })

  it('has nothing to draw for an empty series', () => {
    expect(seriesPoints([], 100, 50)).toEqual({ points: '', max: 0 })
  })

  it('insets by the padding so a peak stroke is not clipped at the edge', () => {
    const { points } = seriesPoints([0, 10], 100, 50, 4)
    expect(points).toBe('0.0,46.0 100.0,4.0')
  })
})
