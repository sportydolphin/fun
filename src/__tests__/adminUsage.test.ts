import { describe, it, expect } from 'vitest'
import * as N from '../../supabase/functions/admin-usage/normalize'
import { dashboardLinks, estimate, formatBytes, formatShare, shareTone } from '../lib/supabaseUsage'

// The normalizers are the guard on the Management API's answers: a changed shape must come back as
// one part's error, not a throw that blanks the whole card, and never as a wrong number. The
// estimate is the bill, since no API gives a token the real one, so its arithmetic is pinned here.

describe('admin-usage normalizers', () => {
  it('reads the project, preferring organization_slug over the deprecated id', () => {
    const p = N.project({ ref: 'abcdefghijklmnopqrst', name: 'fun', region: 'us-east-1', status: 'ACTIVE_HEALTHY', organization_id: 'old', organization_slug: 'new', database: { version: '17.4' } })
    expect(p).toEqual({ ok: true, data: { ref: 'abcdefghijklmnopqrst', name: 'fun', region: 'us-east-1', status: 'ACTIVE_HEALTHY', orgSlug: 'new', postgres: '17.4' } })
    expect(N.project({ ref: 'abcdefghijklmnopqrst', organization_id: 'old' })).toMatchObject({ ok: true, data: { orgSlug: 'old' } })
    expect(N.project('nope').ok).toBe(false)
  })

  it('sums a week of request buckets and surfaces an analytics error', () => {
    const r = N.requests({ result: [
      { timestamp: 'a', total_rest_requests: 10, total_auth_requests: 2, total_storage_requests: 0, total_realtime_requests: 1 },
      { timestamp: 'b', total_rest_requests: 5, total_auth_requests: 1, total_storage_requests: 3, total_realtime_requests: 0 },
    ] })
    expect(r).toEqual({ ok: true, data: { rest: 15, auth: 3, storage: 3, realtime: 1 } })
    expect(N.requests({ error: { message: 'quota', code: 1, errors: [], status: 'x' } })).toEqual({ ok: false, error: 'quota' })
  })

  it('reads the database query row, with sizes that arrive as strings', () => {
    const d = N.database([{ bytes: '167772160', tables: [{ name: 'public.events', bytes: 93323264 }, { name: 'bad' }] }])
    expect(d).toEqual({ ok: true, data: { bytes: 167772160, tables: [{ name: 'public.events', bytes: 93323264 }] } })
    expect(N.database([]).ok).toBe(false)
  })

  it('keeps disk when only one of its two calls answered', () => {
    expect(N.disk(null, { metrics: { fs_used_bytes: 1, fs_size_bytes: 8 } })).toEqual({ ok: true, data: { sizeGb: null, type: null, usedBytes: 1, totalBytes: 8 } })
    expect(N.disk(null, null).ok).toBe(false)
  })

  it('reads add-on prices', () => {
    const a = N.addons({ selected_addons: [{ type: 'compute_instance', variant: { id: 'ci_micro', name: 'Micro', price: { amount: 0.01344, interval: 'hourly', type: 'usage', description: '' } } }] })
    expect(a).toEqual({ ok: true, data: [{ type: 'compute_instance', name: 'Micro', amount: 0.01344, interval: 'hourly' }] })
  })

  it('reads storage and active users, and fails rather than guess a zero', () => {
    expect(N.quota([{ storage_bytes: '0', storage_objects: 0, active_users: '52' }])).toEqual({ ok: true, data: { storageBytes: 0, storageObjects: 0, activeUsers: 52 } })
    expect(N.quota([{ storage_bytes: 5 }]).ok).toBe(false)
    expect(N.quota('x').ok).toBe(false)
  })
})

describe('Supabase usage formatting', () => {
  it('formats bytes in decimal units, as Supabase bills them', () => {
    expect(formatBytes(160_000_000)).toBe('160 MB')
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB')
    expect(formatBytes(null)).toBe('—')
  })

  it('estimates Pro on Small compute as the docs bill it', () => {
    // Supabase's own example: Pro $25 + Small $15 - $10 credit = $30, with the 8 GB disk free.
    const small = { type: 'compute_instance', name: 'Small', amount: 0.0206, interval: 'hourly' }
    const e = estimate('pro', [small], { sizeGb: 8, type: 'gp3', usedBytes: null, totalBytes: null })
    expect(e?.total).toBe(30.04)
    expect(e?.lines.map(l => l.label)).toEqual(['Pro plan', 'Compute, Small', 'Compute credit'])
  })

  it('bills disk past 8 GB, caps the credit at the compute, and has no estimate for custom plans', () => {
    const micro = { type: 'compute_instance', name: 'Micro', amount: 0.01344, interval: 'hourly' }
    const e = estimate('pro', [micro], { sizeGb: 50, type: 'gp3', usedBytes: null, totalBytes: null })
    expect(e?.lines.find(l => l.label === 'Compute credit')?.amount).toBeCloseTo(-9.81)
    expect(e?.lines.find(l => l.label.startsWith('Disk'))?.amount).toBe(5.25)
    expect(estimate('enterprise', [], null)).toBeNull()
    expect(estimate('free', [], null)).toEqual({ total: 0, lines: [{ label: 'Free plan', amount: 0 }] })
  })

  it('colors a meter by its share of the allowance', () => {
    expect([shareTone(0.5), shareTone(0.8), shareTone(1.2), shareTone(null)]).toEqual(['ok', 'warn', 'bad', 'idle'])
    expect([formatShare(0.004), formatShare(0.24), formatShare(null)]).toEqual(['<1%', '24%', '—'])
  })

  it('links the dashboard with the slug, or its placeholder', () => {
    expect(dashboardLinks('my-org').billing).toBe('https://supabase.com/dashboard/org/my-org/billing')
    expect(dashboardLinks(null).usage).toBe('https://supabase.com/dashboard/org/_/usage')
  })
})
