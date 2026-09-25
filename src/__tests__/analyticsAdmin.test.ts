import { describe, it, expect } from 'vitest'
import {
  groupActions, buildFunnels, eventInfo, EVENT_INFO,
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

  it('switches a near-zero-baseline blowup to a multiple instead of a five-digit percent', () => {
    // 15207% is the bracket card the day the fan-awards ballot was shared: prev was tiny, so
    // the percent is noise. cur/prev ≈ 153x reads as "brand new", which is the truth.
    expect(formatDelta(15207)).toBe('×153')
    expect(formatDelta(900)).toBe('+900%') // still a percent just under the switch
    expect(formatDelta(1000)).toBe('×11')  // the switch itself
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

describe('the event catalog', () => {
  const ev = (event: string, events: number, browsers: number) =>
    ({ event, events, browsers, users: 0, prev_events: 0, prev_browsers: 0 })

  it('labels every name the client can send', async () => {
    // A name added to EVENTS and not to the catalog still shows (under Other), so this is a
    // nudge rather than a guard: it fails the day someone forgets, while the page keeps working.
    const { EVENTS } = await import('../lib/analytics')
    const missing = Object.values(EVENTS).filter(n => !(n in EVENT_INFO))
    expect(missing).toEqual([])
  })

  it('groups actions by area, busiest first, leaving out impressions, retired names and zeros', () => {
    const groups = groupActions([
      ev('wpbl_team_opened', 300, 80), ev('wpbl_player_opened', 700, 140),
      ev('wpbl_bracket_shown', 3000, 820), ev('wpbl_mvp_shown', 7, 3), ev('wpbl_searched', 0, 0),
      ev('something_new', 4, 2),
    ])
    expect(groups.map(g => g.group)).toEqual(['Players & teams', 'Other'])
    expect(groups[0].rows.map(r => r.event)).toEqual(['wpbl_player_opened', 'wpbl_team_opened'])
    expect(groups[1].rows[0].label).toBe(eventInfo('something_new').label)
  })

  it('reads each Home card as browsers that saw it against browsers that used it', () => {
    const rows = buildFunnels([
      ev('wpbl_bracket_shown', 3000, 820), ev('wpbl_bracket_series', 48, 29), ev('wpbl_bracket_team', 27, 22),
      ev('discord_joined', 13, 13),
    ])
    // Two ways to use the bracket: the larger browser count stands in, never a sum.
    expect(rows).toEqual([{ label: 'Bracket', verb: 'opened a series or club', seen: 820, used: 29 }])
  })
})
