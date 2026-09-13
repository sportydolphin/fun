import { describe, it, expect } from 'vitest'
import { healthAlerts, INGEST_STALE_MS, VALIDATION_STALE_MS } from '../../shared/adminHealth.js'

// The thresholds ARE the feature: a job that quietly broke while still looking fine is the
// whole failure mode, and paging on an expected state (a "behind" TrackMan feed, a nightly
// finding) is how the owner learns to swipe the alert away. Both directions are pinned here.

const NOW = Date.parse('2026-09-12T18:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const keys = (rows: Parameters<typeof healthAlerts>[0]) => healthAlerts(rows, NOW).map(a => a.key)

const freshIngest = (over: Record<string, unknown> = {}) => ({
  ran_at: ago(60_000), ok: true, error_count: 0, errors: null, ...over,
})
const freshValidation = (over: Record<string, unknown> = {}) => ({
  ran_at: ago(6 * 60 * 60_000), ok: true, new_findings: 0, ...over,
})

describe('healthAlerts — ingest', () => {
  it('is silent on a fresh, clean run', () => {
    expect(healthAlerts({ ingest: freshIngest() }, NOW)).toEqual([])
  })

  it('pages when a run failed outright', () => {
    expect(keys({ ingest: freshIngest({ ok: false }) })).toContain('ingest-down')
  })

  it('pages on ok:true with per-game errors (the unmapped-team trap) and carries the detail', () => {
    const [alert] = healthAlerts({ ingest: freshIngest({
      error_count: 2, errors: ['unmapped team in g1', 'unmapped team in g2'],
    }) }, NOW)
    expect(alert.key).toBe('ingest-errors')
    expect(alert.body).toContain('unmapped team in g1')
    // The error text rides in the signature so a NEW kind of error re-pages, the recurring ones don't.
    expect(alert.signature).toContain('unmapped team in g1')
  })

  it('pages when the mirror has gone quiet past the stale window', () => {
    expect(keys({ ingest: freshIngest({ ran_at: ago(INGEST_STALE_MS + 60_000) }) })).toContain('ingest-stale')
  })

  it('tolerates a single slipped tick (under the stale window)', () => {
    expect(healthAlerts({ ingest: freshIngest({ ran_at: ago(INGEST_STALE_MS - 60_000) }) }, NOW)).toEqual([])
  })

  it('holds one signature across a streak of failures, so an outage pages once', () => {
    const a = healthAlerts({ ingest: freshIngest({ ok: false, ran_at: ago(60_000) }) }, NOW)[0]
    const b = healthAlerts({ ingest: freshIngest({ ok: false, ran_at: ago(30_000) }) }, NOW)[0]
    expect(a.signature).toBe(b.signature)
  })
})

describe('healthAlerts — scoring', () => {
  it('is silent on a fresh run, even with new findings', () => {
    // Findings are expected and mostly known — the panel shows them, a phone must not buzz for them.
    expect(healthAlerts({ validation: freshValidation({ new_findings: 9 }) }, NOW)).toEqual([])
  })

  it('pages when the nightly run failed', () => {
    expect(keys({ validation: freshValidation({ ok: false }) })).toContain('scoring-down')
  })

  it('pages when the nightly run has gone missing', () => {
    expect(keys({ validation: freshValidation({ ran_at: ago(VALIDATION_STALE_MS + 60_000) }) }))
      .toContain('scoring-stale')
  })
})

describe('healthAlerts — nothing to say', () => {
  it('returns no alerts when a table has no row yet', () => {
    expect(healthAlerts({}, NOW)).toEqual([])
    expect(healthAlerts({ ingest: null, validation: null }, NOW)).toEqual([])
  })
})
