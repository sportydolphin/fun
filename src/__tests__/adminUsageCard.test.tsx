import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { UsageReport } from '../../supabase/functions/admin-usage/normalize'

// The card draws parts that arrive on their own, from a function deployed apart from the page, so
// the cases that matter are a full answer and an answer from an older function. The full one is
// the real report from Nov 15, 2026, trimmed to two tables.

const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: () => invoke() } } }))

const REPORT: UsageReport = {
  fetchedAt: '2026-11-16T07:54:36.654Z',
  project: { ok: true, data: { ref: 'jyqswdnbwwkmgvfkexiw', name: 'fun', region: 'us-east-1', status: 'ACTIVE_HEALTHY', orgSlug: 'kpwuexhtbdopxofhxmbm', postgres: '17.6' } },
  plan: { ok: true, data: 'pro' },
  addons: { ok: true, data: [{ type: 'compute_instance', name: 'Small', amount: 0.0206, interval: 'hourly' }] },
  disk: { ok: true, data: { sizeGb: 2, type: 'gp3', usedBytes: 629755904, totalBytes: 2077073408 } },
  database: { ok: true, data: { bytes: 168676499, tables: [{ name: 'public.events', bytes: 93683712 }, { name: 'cron.job_run_details', bytes: 6594560 }] } },
  requests: { ok: true, data: { rest: 117942, auth: 416, storage: 0, realtime: 30 } },
  quota: { ok: true, data: { storageBytes: 0, storageObjects: 0, activeUsers: 52 } },
}

afterEach(() => { cleanup(); invoke.mockReset() })

describe('SupabaseUsage card', () => {
  it('draws the estimate, the quotas and the tables from a full report', async () => {
    invoke.mockResolvedValue({ data: REPORT, error: null })
    const { SupabaseUsage } = await import('../AdminUsage')
    render(<SupabaseUsage />)
    expect(await screen.findByText('$30.04')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    expect(screen.getByText('Compute, Small')).toBeTruthy()
    expect(screen.getByText('52 of 100,000')).toBeTruthy()
    expect(screen.getByText('0 B of 100 GB · 0 files')).toBeTruthy()
    expect(screen.getByText('events')).toBeTruthy()
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it('keeps the rest when an older function sends no quota', async () => {
    const { quota: _quota, ...older } = REPORT
    invoke.mockResolvedValue({ data: older, error: null })
    const { SupabaseUsage } = await import('../AdminUsage')
    render(<SupabaseUsage />)
    expect(await screen.findByText('Redeploy admin-usage')).toBeTruthy()
    expect(screen.getByText('$30.04')).toBeTruthy()
  })
})
