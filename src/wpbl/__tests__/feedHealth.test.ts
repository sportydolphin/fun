import { describe, it, expect } from 'vitest'
import {
  feedHealth, describeGap, boxScoreRevision, FIRST_PITCH_GRACE_MS, FEED_STALE_MS, INGEST_STALE_MS,
  type FeedHealthGame,
} from '../derive/feedHealth'
import { gameStartMs } from '../constants'

// The stale-feed notice, pinned on the one thing it must never get wrong: WHOSE silence it is
// reporting. Every case here is a page that looks identical to the reader and has a different
// cause, and the notice is only worth shipping if it can tell them apart.

const DATE = '2026-08-30'
const TIME = '6:30 PM'
/** First pitch, in the league's own timezone. Taken from `gameStartMs` rather than written
 *  down, so this file is testing the notice and not re-deriving the feed's timezone. */
const START = gameStartMs(DATE, TIME)!

const game = (over: Partial<FeedHealthGame> = {}): FeedHealthGame => ({
  game_date: DATE,
  start_time: TIME,
  status: 'scheduled',
  updated_at: new Date(START).toISOString(),
  source_updated_at: new Date(START).toISOString(),
  ...over,
})

/** A clock `mins` past first pitch. */
const at = (mins: number) => START + mins * 60_000
/** An ISO stamp `mins` before that clock. */
const ago = (now: number, mins: number) => new Date(now - mins * 60_000).toISOString()

describe('nothing worth saying', () => {
  it('says nothing about a finished game, which is allowed to stop changing', () => {
    const now = at(600)
    expect(feedHealth(game({ status: 'final', updated_at: ago(now, 300), source_updated_at: ago(now, 300) }), now))
      .toEqual({ kind: 'ok' })
  })

  // THE GATE IS THE POINT. `source_updated_at` on a game three days out is a month old by
  // construction: nothing has touched the row since the schedule was published. Without the
  // first-pitch gate every future game on the calendar reports a broken feed.
  it('says nothing before first pitch, however old the upstream stamp is', () => {
    const now = START - 60_000
    expect(feedHealth(game({ source_updated_at: '2026-07-25T01:43:37Z', updated_at: ago(now, 1) }), now))
      .toEqual({ kind: 'ok' })
  })

  it('still says nothing inside the grace window', () => {
    const now = at(10) // grace is 15
    expect(feedHealth(game({ source_updated_at: '2026-07-25T01:43:37Z', updated_at: ago(now, 1) }), now).kind)
      .toBe('ok')
  })

  it('says nothing when both clocks are moving', () => {
    const now = at(60)
    expect(feedHealth(game({ status: 'live', updated_at: ago(now, 1), source_updated_at: ago(now, 2) }), now))
      .toEqual({ kind: 'ok' })
  })

  // No start time, no gate, and without the gate a quiet feed cannot be told from a game that
  // is not due yet.
  it('says nothing when the game has no start time to measure against', () => {
    expect(feedHealth(game({ start_time: null, source_updated_at: '2026-01-01T00:00:00Z' }), at(600)))
      .toEqual({ kind: 'ok' })
  })
})

describe('whose silence it is', () => {
  it('blames the feed only when our own writes prove we are still polling', () => {
    const now = at(30)
    const h = feedHealth(game({ updated_at: ago(now, 1), source_updated_at: ago(now, 120) }), now)
    expect(h.kind).toBe('feed-stale')
    if (h.kind === 'feed-stale') {
      expect(h.lateBy).toBe(30 * 60_000)
      expect(h.since).toBe(Date.parse(ago(now, 120)))
    }
  })

  // THE ORDERING TEST, and the reason this module exists. When the ingest dies the league's
  // stamp goes stale as a CONSEQUENCE and says nothing whatever about the league. Checking
  // upstream first would report a feed outage every time our own cron stopped: confidently
  // wrong, aimed at somebody else, and reassuring to the one person who could fix it.
  it('blames us, not the league, when both clocks are stale', () => {
    const now = at(60)
    expect(feedHealth(game({ updated_at: ago(now, 45), source_updated_at: ago(now, 45) }), now).kind)
      .toBe('ingest-stale')
  })

  it('blames us when our clock is stale even though theirs is fresh', () => {
    const now = at(60)
    expect(feedHealth(game({ updated_at: ago(now, 45), source_updated_at: ago(now, 1) }), now).kind)
      .toBe('ingest-stale')
  })

  it('treats a missing upstream stamp as the feed being quiet, not as our fault', () => {
    const now = at(30)
    expect(feedHealth(game({ updated_at: ago(now, 1), source_updated_at: null }), now).kind)
      .toBe('feed-stale')
  })

  it('treats an unparseable stamp the same as a missing one', () => {
    const now = at(30)
    expect(feedHealth(game({ updated_at: ago(now, 1), source_updated_at: 'not a date' }), now).kind)
      .toBe('feed-stale')
  })

  it('reports a feed that froze mid-game, not just one that never started', () => {
    const now = at(90)
    expect(feedHealth(game({ status: 'live', updated_at: ago(now, 1), source_updated_at: ago(now, 40) }), now).kind)
      .toBe('feed-stale')
  })
})

describe('the thresholds hold their shape', () => {
  it('does not trip one minute under either limit, and does one minute over', () => {
    const now = at(FIRST_PITCH_GRACE_MS / 60_000 + 60)
    const under = FEED_STALE_MS / 60_000 - 1
    expect(feedHealth(game({ updated_at: ago(now, 1), source_updated_at: ago(now, under) }), now).kind).toBe('ok')
    expect(feedHealth(game({ updated_at: ago(now, 1), source_updated_at: ago(now, under + 2) }), now).kind).toBe('feed-stale')

    const ourUnder = INGEST_STALE_MS / 60_000 - 1
    expect(feedHealth(game({ updated_at: ago(now, ourUnder), source_updated_at: ago(now, 1) }), now).kind).toBe('ok')
    expect(feedHealth(game({ updated_at: ago(now, ourUnder + 2), source_updated_at: ago(now, 1) }), now).kind).toBe('ingest-stale')
  })
})

describe('describeGap', () => {
  it('reads as prose rather than as a stopwatch', () => {
    expect(describeGap(18 * 60_000)).toBe('18m')
    expect(describeGap(60 * 60_000)).toBe('1h 00m')
    expect(describeGap(112 * 60_000)).toBe('1h 52m')
    expect(describeGap(0)).toBe('0m')
  })

  it('does not render a negative gap from a clock skew', () => {
    expect(describeGap(-5000)).toBe('0m')
  })
})

// ─── When the league last changed a finished game ────────────────────────────
//
// A reader asked for this, to find scoring changes on past games. The league revises box scores
// for weeks: 23 of the 30 regular-season games carry a stamp two or more days after they were
// played, one of them nineteen days later, and this timestamp is the only record of it anywhere.

describe('boxScoreRevision', () => {
  const revised = (over: Partial<FeedHealthGame> = {}) =>
    boxScoreRevision({ game_date: '2026-08-21', status: 'final', source_updated_at: null, ...over })

  // The real Aug 21 game, with the real stamp off the row. 03:04 UTC is the evening BEFORE in
  // Springfield, which is the whole reason the league's day is the one that gets printed: a
  // reader's own midnight moves the date on six of the eight games marked the day this shipped.
  it('reports the league’s calendar day, not UTC and not the reader’s', () => {
    expect(revised({ source_updated_at: '2026-09-02T03:04:49+00:00' }))
      .toEqual({ at: Date.parse('2026-09-02T03:04:49+00:00'), on: '2026-09-01', days: 11 })
  })

  // Every final is stamped within an hour or so of the last out. Marking those would put a flag
  // on all 30 games meaning nothing but "the game ended".
  it('says nothing about a game stamped the night it was played', () => {
    // 22:30 Central on the day of the game, which is the next day in UTC.
    expect(revised({ source_updated_at: '2026-08-22T03:30:00+00:00' })).toBeNull()
  })

  // On anything not final the stamp is "when it last moved", which is every couple of minutes.
  it('says nothing about a game still being played, however old the stamp', () => {
    expect(revised({ status: 'live', source_updated_at: '2026-09-02T03:04:49+00:00' })).toBeNull()
    expect(revised({ status: 'scheduled', source_updated_at: '2026-09-02T03:04:49+00:00' })).toBeNull()
  })

  it('survives a row with no stamp, or an unreadable one', () => {
    expect(revised()).toBeNull()
    expect(revised({ source_updated_at: 'not a date' })).toBeNull()
  })
})
