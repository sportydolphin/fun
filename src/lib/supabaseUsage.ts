// Formatting for the admin Health tab's Supabase section (src/AdminUsage.tsx). The data comes from
// the `admin-usage` edge function; its shape is in supabase/functions/admin-usage/normalize.ts.

import type { Addon, DiskInfo } from '../../supabase/functions/admin-usage/normalize'

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** The dashboard's own pages for the org, or the `_` placeholder the dashboard resolves when the slug is unknown. */
export function dashboardLinks(orgSlug: string | null) {
  const org = `https://supabase.com/dashboard/org/${orgSlug ? encodeURIComponent(orgSlug) : '_'}`
  return { billing: `${org}/billing`, usage: `${org}/usage` }
}

/** A meter's pill: amber from 80% of the allowance, red once over it. */
export function shareTone(share: number | null): 'ok' | 'warn' | 'bad' | 'idle' {
  if (share == null) return 'idle'
  return share >= 1 ? 'bad' : share >= 0.8 ? 'warn' : 'ok'
}

export function formatShare(share: number | null): string {
  if (share == null) return '—'
  const pct = share * 100
  return `${pct > 0 && pct < 1 ? '<1' : Math.round(pct)}%`
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', platform: 'Platform',
}

/**
 * What each plan includes, from supabase.com/docs/guides/platform/billing-on-supabase and the
 * compute and disk pages (read Nov 15, 2026). The Management API has no bill a personal access
 * token can read, so these are the source of the estimate: when Supabase changes its prices, the
 * card is wrong until this table is, which is why the card says Estimated and links the real bill.
 * Enterprise is custom, so it has no row and no estimate.
 */
export interface PlanTerms {
  fee: number
  computeCredit: number
  /** gp3 disk each project gets before it is billed; null on Free, which caps database size instead. */
  includedDiskGb: number | null
  databaseQuotaBytes: number | null
  storageQuotaBytes: number
  activeUserQuota: number
}

const PAID: Omit<PlanTerms, 'fee'> = {
  computeCredit: 10, includedDiskGb: 8, databaseQuotaBytes: null, storageQuotaBytes: 100e9, activeUserQuota: 100_000,
}

export const PLAN_TERMS: Record<string, PlanTerms> = {
  free: { fee: 0, computeCredit: 0, includedDiskGb: null, databaseQuotaBytes: 500e6, storageQuotaBytes: 1e9, activeUserQuota: 50_000 },
  pro: { fee: 25, ...PAID },
  team: { fee: 599, ...PAID },
}

/** Supabase bills hourly items over 730 hours in its own monthly examples. */
export const HOURS_PER_MONTH = 730
const GP3_PER_GB = 0.125
const IO2_PER_GB = 0.195

export interface Estimate { total: number; lines: Array<{ label: string; amount: number }> }

/**
 * The month at list prices: the plan, every add-on at its own reported price, the compute credit,
 * and disk past the included size. Usage over a quota (egress, storage, users) is not in it; the
 * quota rows show how close each is.
 */
export function estimate(plan: string, addons: Addon[], disk: DiskInfo | null): Estimate | null {
  const terms = PLAN_TERMS[plan]
  if (!terms) return null
  const lines: Estimate['lines'] = [{ label: `${PLAN_LABELS[plan] ?? plan} plan`, amount: terms.fee }]
  let compute = 0
  for (const a of addons) {
    if (a.amount == null) continue
    const monthly = a.interval === 'hourly' ? a.amount * HOURS_PER_MONTH : a.interval === 'monthly' ? a.amount : null
    if (monthly == null) continue
    if (a.type === 'compute_instance') compute += monthly
    lines.push({ label: a.type === 'compute_instance' ? `Compute, ${a.name}` : a.name, amount: monthly })
  }
  const credit = Math.min(terms.computeCredit, compute)
  if (credit > 0) lines.push({ label: 'Compute credit', amount: -credit })
  if (terms.includedDiskGb != null && disk?.sizeGb != null) {
    const cost = disk.type === 'io2' ? disk.sizeGb * IO2_PER_GB : Math.max(0, disk.sizeGb - terms.includedDiskGb) * GP3_PER_GB
    if (cost > 0) lines.push({ label: `Disk, ${disk.sizeGb} GB ${disk.type ?? ''}`.trim(), amount: cost })
  }
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  return { total, lines }
}
