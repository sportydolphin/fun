import { useCallback, useEffect, useState } from 'react'
import { Box, Typography, IconButton } from '@mui/material'
import { Refresh } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { StatRow, Section, StatusPill, QuickLink } from './AdminPanel'
import {
  dashboardLinks, estimate, formatBytes, formatCount, formatShare, formatUsd, PLAN_LABELS, PLAN_TERMS, shareTone,
} from './lib/supabaseUsage'
import type { Part, UsageReport } from '../supabase/functions/admin-usage/normalize'

// The Supabase plan, bill and usage, from the `admin-usage` edge function, which holds the
// Management API token the browser must never see. Each part arrives on its own, so one failed
// call leaves the rest standing, and the dashboard links below work even when the function is not
// deployed. No API gives a token the real bill, so the cost is an estimate and Billing links it.

type Load = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; report: UsageReport }

const value = (s: string) => <Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{s}</Typography>

const PARTS = ['project', 'plan', 'addons', 'disk', 'database', 'requests', 'quota'] as const

/**
 * The site and the function deploy separately (Pages on merge, the function by hand), so the page
 * can meet a function older or newer than itself. A part it does not send reads Unavailable rather
 * than throwing on `.ok` and blanking the Health tab.
 */
function withAllParts(data: Partial<UsageReport>): UsageReport {
  const out = { ...data } as UsageReport
  for (const k of PARTS) {
    if (!out[k] || typeof out[k] !== 'object') (out as unknown as Record<string, Part<unknown>>)[k] = { ok: false, error: 'Redeploy admin-usage' }
  }
  return out
}

/** A part that failed: its row stays where it would be, with the reason underneath. */
function Unavailable({ label, part }: { label: string; part: Part<unknown> }) {
  return <StatRow label={label} sub={'error' in part ? part.error : undefined} value={<StatusPill tone="idle" label="Unavailable" />} />
}

/** One quota as "40 of 100,000", colored by how much of it is gone; no pill when the plan is unknown. */
function Meter({ label, used, of, format, extra }: { label: string; used: number; of: number | null; format: (n: number) => string; extra?: string }) {
  const share = of ? used / of : null
  return (
    <StatRow label={label}
      sub={[of ? `${format(used)} of ${format(of)}` : format(used), extra].filter(Boolean).join(' · ')}
      value={<StatusPill tone={shareTone(share)} label={formatShare(share)} />} />
  )
}

export function SupabaseUsage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchReport = useCallback(async () => {
    setLoad({ state: 'loading' })
    const { data, error } = await supabase.functions.invoke('admin-usage')
    if (error || !data) {
      let msg = 'admin-usage not deployed, or MGMT_API_TOKEN not set'
      try {
        const body = await (error as { context?: Response })?.context?.json()
        if (body?.error) msg = body.error
      } catch { /* keep the default */ }
      setLoad({ state: 'error', error: msg })
      return
    }
    setLoad({ state: 'ready', report: withAllParts(data as Partial<UsageReport>) })
  }, [])

  useEffect(() => { void fetchReport() }, [fetchReport])

  const r = load.state === 'ready' ? load.report : null
  const slug = r?.project.ok ? r.project.data.orgSlug : null
  const links = dashboardLinks(slug)
  const terms = r?.plan.ok ? PLAN_TERMS[r.plan.data] ?? null : null
  const dash = '—'

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" aria-label="Refresh Supabase usage" onClick={() => void fetchReport()}
          disabled={load.state === 'loading'} sx={{ mb: 0.5 }}>
          <Refresh fontSize="small" />
        </IconButton>
      </Box>

      <Section title="Supabase plan">
        <Box sx={{ px: 1.5 }}>
          {load.state === 'error' ? (
            <StatRow label="Supabase" sub={load.error} value={<StatusPill tone="idle" label="Unavailable" />} />
          ) : !r ? (
            <>
              <StatRow label="Plan" sub={dash} value={value(dash)} />
              <StatRow label="Estimated monthly" sub={dash} value={value(dash)} />
              <StatRow label="Database" sub={dash} value={value(dash)} />
              <StatRow label="Disk" sub={dash} value={value(dash)} />
            </>
          ) : (
            <>
              {r.plan.ok ? (
                <StatRow label="Plan"
                  sub={r.project.ok ? `${r.project.data.name} · ${r.project.data.region} · ${r.project.data.status.replace(/_/g, ' ').toLowerCase()}` : undefined}
                  value={value(PLAN_LABELS[r.plan.data] ?? r.plan.data)} />
              ) : <Unavailable label="Plan" part={r.plan} />}

              {(() => {
                if (!r.plan.ok) return <Unavailable label="Estimated monthly" part={{ ok: false, error: 'Needs the plan' }} />
                if (!r.addons.ok) return <Unavailable label="Estimated monthly" part={r.addons} />
                const e = estimate(r.plan.data, r.addons.data, r.disk.ok ? r.disk.data : null)
                if (!e) return <Unavailable label="Estimated monthly" part={{ ok: false, error: 'Custom pricing' }} />
                return (<>
                  <StatRow label="Estimated monthly" sub="List prices, before overage" value={value(formatUsd(e.total))} />
                  {e.lines.filter(l => l.amount !== 0).map(l => (
                    <StatRow key={l.label} label={<Box component="span" sx={{ pl: 1.5, fontWeight: 500 }}>{l.label}</Box>}
                      value={<Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatUsd(l.amount)}</Typography>} />
                  ))}
                </>)
              })()}

              {r.database.ok ? (
                <StatRow label="Database"
                  sub={r.disk.ok && r.disk.data.totalBytes ? `${formatShare(r.database.data.bytes / r.disk.data.totalBytes)} of the disk` : undefined}
                  value={terms?.databaseQuotaBytes
                    ? <StatusPill tone={shareTone(r.database.data.bytes / terms.databaseQuotaBytes)} label={`${formatBytes(r.database.data.bytes)} of ${formatBytes(terms.databaseQuotaBytes)}`} />
                    : value(formatBytes(r.database.data.bytes))} />
              ) : <Unavailable label="Database" part={r.database} />}

              {r.disk.ok ? (() => {
                const { usedBytes, totalBytes, sizeGb, type } = r.disk.data
                const share = usedBytes != null && totalBytes ? usedBytes / totalBytes : null
                return (
                  <StatRow label="Disk"
                    sub={`${formatBytes(usedBytes)} of ${totalBytes ? formatBytes(totalBytes) : sizeGb != null ? `${sizeGb} GB` : dash}${type ? ` · ${type}` : ''}`}
                    value={<StatusPill tone={shareTone(share)} label={formatShare(share)} />} />
                )
              })() : <Unavailable label="Disk" part={r.disk} />}

            </>
          )}
        </Box>
      </Section>

      {r && (
        <Section title="Supabase usage">
          <Box sx={{ px: 1.5 }}>
            {r.quota.ok ? (<>
              <Meter label="Storage size" used={r.quota.data.storageBytes} of={terms?.storageQuotaBytes ?? null} format={formatBytes}
                extra={`${formatCount(r.quota.data.storageObjects)} files`} />
              <Meter label="Monthly active users" used={r.quota.data.activeUsers} of={terms?.activeUserQuota ?? null} format={formatCount} />
            </>) : <Unavailable label="Storage and users" part={r.quota} />}

            {r.requests.ok ? (
              <StatRow label="API requests, 7 days"
                sub={`REST ${formatCount(r.requests.data.rest)} · Auth ${formatCount(r.requests.data.auth)} · Storage ${formatCount(r.requests.data.storage)} · Realtime ${formatCount(r.requests.data.realtime)}`}
                value={value(formatCount(r.requests.data.rest + r.requests.data.auth + r.requests.data.storage + r.requests.data.realtime))} />
            ) : <Unavailable label="API requests, 7 days" part={r.requests} />}
          </Box>
        </Section>
      )}

      {r?.database.ok && r.database.data.tables.length > 0 && (
        <Section title="Largest tables">
          <Box sx={{ px: 1.5 }}>
            {r.database.data.tables.map(t => (
              <StatRow key={t.name} label={t.name.replace(/^public\./, '')}
                value={<Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatBytes(t.bytes)}</Typography>} />
            ))}
          </Box>
        </Section>
      )}

      <Section title="Supabase dashboard">
        <QuickLink emoji="💳" label="Billing" href={links.billing} />
        <QuickLink emoji="📊" label="Usage" href={links.usage} />
      </Section>
    </>
  )
}
