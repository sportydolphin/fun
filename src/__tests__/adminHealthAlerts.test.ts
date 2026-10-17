import { describe, it, expect } from 'vitest'
import { healthAlerts, INGEST_STALE_MS, INGEST_STALE_OFFSEASON_MS, VALIDATION_STALE_MS, HEARTBEAT_CHECKS, WORKFLOW_JOB_PREFIX, WORKFLOW_FAILURE_WINDOW_MS, centralStartMs } from '../../shared/adminHealth.js'

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

  it('names the errors when a run failed on them (contract breaks, unmapped clubs)', () => {
    // The ingest sets ok:false on any summary error since Oct 2026, so a failed run is no longer
    // only an outage, and the page has to say which.
    const [alert] = healthAlerts({ ingest: freshIngest({
      ok: false, error_count: 4,
      errors: ['contract /games game_type: Invalid option', 'unmapped team in g1', 'box g2: 502', 'box g3: 502'],
    }) }, NOW)
    expect(alert.key).toBe('ingest-down')
    expect(alert.body).toContain('contract /games game_type')
    expect(alert.body).toContain('(+1 more)')
    expect(alert.signature).toContain('contract /games game_type')
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

  it('off-season, tolerates the six-hourly ingest floor but still pages when that stops', () => {
    const between = freshIngest({ ran_at: ago(6 * 60 * 60_000) })
    expect(healthAlerts({ ingest: between, nearGame: false }, NOW)).toEqual([])
    expect(keys({ ingest: freshIngest({ ran_at: ago(INGEST_STALE_OFFSEASON_MS + 60_000) }), nearGame: false })).toContain('ingest-stale')
  })

  it('keeps the strict window when the caller does not say whether a game is near', () => {
    // Failing toward a page: a broken season read must not silence a real two-minute stall.
    expect(keys({ ingest: freshIngest({ ran_at: ago(INGEST_STALE_MS + 60_000) }), nearGame: undefined })).toContain('ingest-stale')
    expect(keys({ ingest: freshIngest({ ran_at: ago(INGEST_STALE_MS + 60_000) }), nearGame: true })).toContain('ingest-stale')
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

describe('healthAlerts — heartbeat jobs', () => {
  const job = HEARTBEAT_CHECKS[0].job          // wpbl-drift-check, a nightly (staleable) job
  const beat = (over: Record<string, unknown> = {}) => ({ job, ran_at: ago(60 * 60_000), ok: true, ...over })

  it('is silent on a configured job with no heartbeat row (never run, not failed)', () => {
    expect(healthAlerts({ heartbeats: [] }, NOW)).toEqual([])
  })

  it('is silent on a fresh, successful heartbeat', () => {
    expect(healthAlerts({ heartbeats: [beat()] }, NOW)).toEqual([])
  })

  it('pages when a heartbeat reports failure, carrying the detail', () => {
    const [a] = healthAlerts({ heartbeats: [beat({ ok: false, detail: 'db timeout' })] }, NOW)
    expect(a.key).toBe(`${job}:failed`)
    expect(a.body).toContain('db timeout')
  })

  it('pages when a nightly job has gone quiet past its cadence', () => {
    const stale = beat({ ran_at: ago((HEARTBEAT_CHECKS[0].maxAgeMs ?? 0) + 60_000) })
    expect(healthAlerts({ heartbeats: [stale] }, NOW).map(x => x.key)).toContain(`${job}:stale`)
  })
})

describe('healthAlerts: failed workflows', () => {
  const failed = (over: Record<string, unknown> = {}) => ({
    job: `${WORKFLOW_JOB_PREFIX}WPBL Shop Restock Watch`, ran_at: ago(60_000), ok: false,
    detail: 'https://github.com/x/y/actions/runs/1', ...over,
  })

  it('pages a recent failure under the workflow name, with the run link', () => {
    const [a] = healthAlerts({ heartbeats: [failed()] }, NOW)
    expect(a.title).toBe('WPBL Shop Restock Watch failed')
    expect(a.body).toContain('actions/runs/1')
  })

  it('holds one signature across runs, so a job failing every five minutes pages once', () => {
    const a = healthAlerts({ heartbeats: [failed()] }, NOW)[0]
    const b = healthAlerts({ heartbeats: [failed({ detail: 'https://github.com/x/y/actions/runs/2' })] }, NOW)[0]
    expect(a.signature).toBe(b.signature)
  })

  it('lets a failure age out, since nothing ever writes the success that would clear it', () => {
    expect(healthAlerts({ heartbeats: [failed({ ran_at: ago(WORKFLOW_FAILURE_WINDOW_MS + 60_000) })] }, NOW)).toEqual([])
  })

  it('pages only failures', () => {
    expect(healthAlerts({ heartbeats: [failed({ ok: true })] }, NOW)).toEqual([])
  })
})

describe('healthAlerts — nothing to say', () => {
  it('returns no alerts when a table has no row yet', () => {
    expect(healthAlerts({}, NOW)).toEqual([])
    expect(healthAlerts({ ingest: null, validation: null }, NOW)).toEqual([])
  })
})

describe('healthAlerts: game states', () => {
  // NOW is 18:00Z on Sep 12, 2026, which is 1:00 PM Central.
  const game = (over: Record<string, unknown> = {}) => ({
    id: 'g1', game_date: '2026-09-12', start_time: '9:00 AM', status: 'scheduled',
    status_detail: 'Not Started', home_team_id: 'sf', away_team_id: 'bos', ...over,
  })
  const gameKeys = (games: ReturnType<typeof game>[]) => healthAlerts({ games }, NOW).map(a => a.key)

  it('reads the stored Central wall clock, across DST', () => {
    expect(centralStartMs('2026-09-12', '1:00 PM')).toBe(NOW)
    expect(centralStartMs('2026-12-12', '12:30 PM')).toBe(Date.parse('2026-12-12T18:30:00Z'))
  })

  it('pages on a game still scheduled hours after first pitch, the shape of a game the feed hid', () => {
    expect(gameKeys([game()])).toEqual(['game-never-started'])
  })

  it('leaves a game alone inside the window, and one the feed calls postponed or delayed', () => {
    expect(gameKeys([game({ start_time: '11:00 AM' })])).toEqual([])
    expect(gameKeys([game({ status_detail: 'Postponed' })])).toEqual([])
    expect(gameKeys([game({ status_detail: 'Rain Delay' })])).toEqual([])
  })

  it('counts an untimed game from the end of its day, so it can only page late', () => {
    expect(gameKeys([game({ start_time: null })])).toEqual([])
    expect(gameKeys([game({ start_time: null, game_date: '2026-09-11' })])).toEqual(['game-never-started'])
  })

  it('pages on a game stuck live, but not on one in a long afternoon', () => {
    expect(gameKeys([game({ status: 'live', start_time: '7:30 AM' })])).toEqual(['game-stuck-live'])
    expect(gameKeys([game({ status: 'live', start_time: '9:00 AM' })])).toEqual([])
  })

  it('pages on a final with no batting lines, and never when the read could not tell', () => {
    expect(gameKeys([game({ status: 'final', has_lines: false })])).toEqual(['game-final-no-box'])
    expect(gameKeys([game({ status: 'final', has_lines: true })])).toEqual([])
    expect(gameKeys([game({ status: 'final' })])).toEqual([])
  })

  it('signs with the game ids, so a second bad game re-pages and the same one holds', () => {
    const one = healthAlerts({ games: [game()] }, NOW)[0]
    const two = healthAlerts({ games: [game(), game({ id: 'g2' })] }, NOW)[0]
    expect(one.signature).not.toBe(two.signature)
    expect(two.title).toContain('(2)')
    expect(two.body).toContain('bos at sf 2026-09-12')
    expect(healthAlerts({ games: [game()] }, NOW + 60_000)[0].signature).toBe(one.signature)
  })
})
