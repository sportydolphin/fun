import { describe, it, expect } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented:
// describeChange IS the job. A copy living in the test would keep passing while the script
// it mirrors drifted, which is the failure mode this whole watcher exists to avoid.
import { describeChange } from '../../scripts/watch-wpbl-tracking.mjs'

// The league published TrackMan for two games and then stopped. The Home card that used to
// show it hid itself automatically once publishing fell behind, so nothing was left watching
// for the feed's return. This function is what replaced that card, and it has exactly two
// ways to be useless: stay quiet when the feed wakes up, or shout on a night when nothing
// happened (a daily job that cries wolf gets muted, and a muted job reports nothing at all).

type Snap = { trackedThrough: string | null; trackedGames: number; finalThrough?: string | null }
const snap = (trackedThrough: string | null, trackedGames: number, finalThrough: string | null = '2026-08-16'): Snap =>
  ({ trackedThrough, trackedGames, finalThrough })

describe('describeChange', () => {
  it('says nothing when neither the front edge nor the count moved', () => {
    expect(describeChange(snap('2026-08-02', 2), snap('2026-08-02', 2))).toBeNull()
  })

  it('announces a batch that pushes the front edge forward', () => {
    const msg = describeChange(snap('2026-08-02', 2), snap('2026-08-14', 9))
    expect(msg).toContain('TrackMan data has landed')
    expect(msg).toContain('7 more games now carry pitch tracking (2 to 9)')
    expect(msg).toContain('reaches 2026-08-14, up from 2026-08-02')
  })

  // A backfill can fill in games BEHIND the front edge, which leaves the newest tracked date
  // untouched. That is still the feed waking up, and watching only the date would miss it.
  it('announces a backfill that adds games without extending the front edge', () => {
    const msg = describeChange(snap('2026-08-02', 2), snap('2026-08-02', 6))
    expect(msg).not.toBeNull()
    expect(msg).toContain('4 more games now carry pitch tracking (2 to 6)')
  })

  it('agrees on number when exactly one game is added', () => {
    const msg = describeChange(snap('2026-08-01', 1), snap('2026-08-02', 2))
    expect(msg).toContain('1 more game now carries pitch tracking')
    expect(msg).not.toContain('game now carry')
  })

  // The front edge can move without the count changing when a tracked game is re-dated, or
  // when one is dropped as another lands. Rare, but the message must not claim "0 more games".
  it('reports a later reach without inventing an added-game count', () => {
    const msg = describeChange(snap('2026-08-02', 2), snap('2026-08-09', 2))
    expect(msg).toContain('Still 2 tracked games, but the data now reaches a later game')
    expect(msg).not.toContain('0 more')
  })

  it('handles the first data ever arriving against an empty baseline', () => {
    const msg = describeChange(snap(null, 0), snap('2026-08-02', 2))
    expect(msg).toContain('Tracking now reaches 2026-08-02.')
    expect(msg).not.toContain('up from')
  })

  // The lag is what decides whether a wake-up is worth acting on: a feed that moved and is
  // still three weeks behind is a different situation from one that has caught up.
  it('reports how far behind the schedule the feed still is', () => {
    const msg = describeChange(snap('2026-08-01', 1), snap('2026-08-02', 2))
    expect(msg).toContain('still 14 days behind')
  })

  it('says the feed is current when it reaches the last final', () => {
    const msg = describeChange(snap('2026-08-01', 1), snap('2026-08-16', 12))
    expect(msg).toContain('level with the last final')
  })

  // Tracking can legitimately run ahead of the last FINAL: a game in progress carries pitch
  // data before it is final. That must read as current, not as a negative lag.
  it('treats tracking ahead of the last final as current', () => {
    const msg = describeChange(snap('2026-08-14', 9), snap('2026-08-17', 11))
    expect(msg).toContain('level with the last final')
    expect(msg).not.toContain('-1 days')
  })

  it('does not crash when the schedule has no finals yet', () => {
    const msg = describeChange(snap(null, 0), snap('2026-08-02', 2, null))
    expect(msg).toContain('TrackMan data has landed')
    expect(msg).not.toContain('behind')
  })
})
