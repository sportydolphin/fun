import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  payrollStatus, ingestStatus, trackingStatus, validationStatus,
  healthStatuses, HealthStrip, HealthGroup, WpblValidationChip, type OpsHealth,
} from '../AdminPanel'

// The four pipelines report their state through these functions, and the state is the whole
// feature: /admin is the only place any of them is visible, and none of the four jobs fails
// loudly. A threshold that reads "Fresh" for a job that stopped two days ago is indistinguishable
// from a healthy site, which is why these are pure and tested rather than eyeballed in the UI.

const minsAgo  = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60_000).toISOString()

const ingest = (over: Partial<Parameters<typeof ingestStatus>[0]> = {}) => ({
  ran_at: minsAgo(1), ok: true, mode: 'active', games: 3, boxscores: 6, error_count: 0, ...over,
})
const tracking = (over: Partial<Parameters<typeof trackingStatus>[0]> = {}) => ({
  last_tracked_game_date: '2026-08-02', tracked_game_count: 2,
  last_final_game_date: '2026-08-19', last_checked_at: hoursAgo(2), last_advanced_at: null, ...over,
})
const validation = (over: Partial<Parameters<typeof validationStatus>[0]> = {}) => ({
  ran_at: hoursAgo(2), ok: true, new_findings: 0, total_findings: 57, ...over,
})

describe('ingestStatus', () => {
  it('is fresh while the two-minute cron is keeping up', () => {
    expect(ingestStatus(ingest())).toEqual({ tone: 'ok', label: 'Fresh' })
  })

  it('goes stale past six minutes, which is three missed runs', () => {
    expect(ingestStatus(ingest({ ran_at: minsAgo(7) }))).toEqual({ tone: 'warn', label: 'Stale' })
  })

  it('reports per-game errors even on a run that succeeded overall', () => {
    expect(ingestStatus(ingest({ error_count: 2 }))).toEqual({ tone: 'warn', label: 'Errors' })
  })

  it('a failed run outranks everything else', () => {
    expect(ingestStatus(ingest({ ok: false, error_count: 2, ran_at: minsAgo(90) })))
      .toEqual({ tone: 'bad', label: 'Failed' })
  })
})

describe('validationStatus', () => {
  it('is clean with a recent run and nothing new', () => {
    expect(validationStatus(validation())).toEqual({ tone: 'ok', label: 'Clean' })
  })

  it('counts new findings rather than just saying something is wrong', () => {
    expect(validationStatus(validation({ new_findings: 3 }))).toEqual({ tone: 'warn', label: '3 new' })
  })

  it('a missing run outranks new findings: stale is the state that matters', () => {
    expect(validationStatus(validation({ ran_at: hoursAgo(30), new_findings: 3 })))
      .toEqual({ tone: 'warn', label: 'Stale' })
  })

  it('tolerates a cron that slips an hour', () => {
    expect(validationStatus(validation({ ran_at: hoursAgo(25) }))).toEqual({ tone: 'ok', label: 'Clean' })
  })

  it('a failed run outranks findings', () => {
    expect(validationStatus(validation({ ok: false, new_findings: 9 }))).toEqual({ tone: 'bad', label: 'Failed' })
  })

  // The chip is what the state is actually seen through, so one render proves the wiring.
  it('reaches the screen through WpblValidationChip', () => {
    render(<WpblValidationChip run={validation({ new_findings: 3 })} />)
    expect(screen.getByText('3 new')).toBeInTheDocument()
  })
})

describe('trackingStatus', () => {
  it('is deliberately neutral, not red, while the league is behind', () => {
    // Behind is the expected state for weeks. Red here would train the eye to ignore the row.
    expect(trackingStatus(tracking())).toEqual({ tone: 'idle', label: '17d behind' })
  })

  it('turns green when the league catches up, which is the thing being watched for', () => {
    expect(trackingStatus(tracking({ last_tracked_game_date: '2026-08-19' })))
      .toEqual({ tone: 'ok', label: 'Current' })
  })

  it('flags OUR watcher going missing, at a laxer 50h than the nightly validator', () => {
    expect(trackingStatus(tracking({ last_checked_at: hoursAgo(60) })))
      .toEqual({ tone: 'warn', label: 'Watcher stale' })
    expect(trackingStatus(tracking({ last_checked_at: hoursAgo(30) })).label).not.toBe('Watcher stale')
  })
})

describe('payrollStatus', () => {
  it('is fresh inside a day and a bit, stale after', () => {
    expect(payrollStatus(hoursAgo(4))).toEqual({ tone: 'ok', label: 'Fresh' })
    expect(payrollStatus(hoursAgo(48))).toEqual({ tone: 'warn', label: 'Stale' })
  })
})

const EMPTY: OpsHealth = {
  payroll: null, ingest: null, validation: null, tracking: null,
  predictions: null, loading: false, reload: () => {},
}

describe('healthStatuses', () => {
  it('never reports a pipeline that has not run as ok', () => {
    // "Not yet run" and "ran and was fine" are different answers. Collapsing them is how a
    // job that never started would read green.
    const rows = healthStatuses(EMPTY)
    expect(rows).toHaveLength(4)
    expect(rows.every(r => r.tone === 'idle')).toBe(true)
    expect(rows.map(r => r.key)).toEqual(['ingest', 'trackman', 'scoring', 'payrolls'])
  })

  it('carries each pipeline its own state', () => {
    const rows = healthStatuses({ ...EMPTY, ingest: ingest({ ok: false }), validation: validation() })
    expect(rows.find(r => r.key === 'ingest')).toMatchObject({ tone: 'bad', label: 'Failed' })
    expect(rows.find(r => r.key === 'scoring')).toMatchObject({ tone: 'ok', label: 'Clean' })
  })
})

describe('HealthStrip', () => {
  it('renders nothing while the read is in flight, rather than four idle pills', () => {
    // Four grey "Not yet run" pills on every page load would be a lie that resolves itself,
    // and the eye would learn to skip the strip before it ever said anything true.
    const { container } = render(<HealthStrip health={{ ...EMPTY, loading: true }} onOpen={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names every pipeline so the strip is readable without the detail below it', () => {
    render(<HealthStrip health={{ ...EMPTY, ingest: ingest() }} onOpen={() => {}} />)
    for (const name of ['Ingest', 'TrackMan', 'Scoring', 'Payrolls']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('Fresh')).toBeInTheDocument()
  })
})

describe('HealthGroup', () => {
  it('shows every pipeline even when its table is empty', () => {
    render(<HealthGroup health={EMPTY} />)
    for (const label of ['WPBL ingest', 'TrackMan publishing', 'Scoring check', 'MLB payrolls']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
