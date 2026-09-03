import { describe, it, expect } from 'vitest'
import { isSettled } from '../derive/blueskyRecap'

// A Bluesky post cannot be edited, so the settle window is the ONLY thing standing between a
// late scoring correction and a permanent public post of numbers the site itself no longer
// agrees with. It is also the thing that decides whether a recap lands the same evening as the
// game or the following afternoon, so both directions are worth pinning.

const NOW = Date.parse('2026-09-03T04:00:00Z')
const SETTLE = 45
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

describe('isSettled', () => {
  it('publishes once the league\'s stamp is old enough', () => {
    expect(isSettled({ source_updated_at: minsAgo(46) }, null, SETTLE, NOW)).toBe(true)
  })

  it('holds a game the league only just finalised', () => {
    expect(isSettled({ source_updated_at: minsAgo(44) }, null, SETTLE, NOW)).toBe(false)
  })

  // The whole point of the change. On the old rule the run that first SAW a game wrote
  // first_final_at = now and then measured zero minutes against it, so publishing always cost a
  // second run. GitHub runs this repo's workflows hours late, which turned 45 minutes into 5 to
  // 12 hours. A game the league stamped an hour ago is due on the first run that sees it, even
  // though we have held it for no time at all.
  it('does not need a previous run to have seen the game', () => {
    expect(isSettled({ source_updated_at: minsAgo(60) }, minsAgo(0), SETTLE, NOW)).toBe(true)
  })

  // The other direction: our own clock must never be able to publish something the league
  // stamped seconds ago, however long we have been sitting on the row.
  it('lets the league\'s clock override how long we have held it', () => {
    expect(isSettled({ source_updated_at: minsAgo(2) }, minsAgo(600), SETTLE, NOW)).toBe(false)
  })

  it('falls back to when we first saw it when the feed never stamped the game', () => {
    expect(isSettled({ source_updated_at: null }, minsAgo(46), SETTLE, NOW)).toBe(true)
    expect(isSettled({ source_updated_at: null }, minsAgo(44), SETTLE, NOW)).toBe(false)
  })

  // Fails CLOSED, unlike most of this codebase, and deliberately: with no basis at all there is
  // no evidence the game has settled, and the cost of waiting is a late post while the cost of
  // publishing is permanent.
  it('refuses to publish when it has no timestamp at all', () => {
    expect(isSettled({ source_updated_at: null }, null, SETTLE, NOW)).toBe(false)
    expect(isSettled({ source_updated_at: 'not a date' }, null, SETTLE, NOW)).toBe(false)
  })
})
