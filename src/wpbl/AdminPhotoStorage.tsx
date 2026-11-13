import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Section } from '../AdminPanel'
import { TYPE_SCALE } from '../ui/card'
import { fetchR2StorageSnapshots, type R2StorageSnapshot } from './api'
import { accountUsage, formatBytes, ALERT_AT, R2_FREE_TIER, type Allowance } from '../../shared/r2Usage.js'

// /admin → Photos → Storage: R2 against its free tier, from the daily storage watch
// (scripts/watch-r2-storage.mjs). The free tier is per account, so the meters add every bucket;
// the rows below them say which bucket holds what. See docs/FAN_UPLOADS.md.

// The buckets this site made, by the label the owner knows them by. Any other bucket on the
// account shows under its own name.
const BUCKET_LABELS: Record<string, string> = {
  'sportydolphin-wpbl-photos': 'Published photos',
  'sportydolphin-wpbl-photo-submissions': 'Submissions',
}

const METERS: Array<{ key: Allowance; label: string }> = [
  { key: 'storage', label: 'Storage' },
  { key: 'classA', label: 'Writes this month' },
  { key: 'classB', label: 'Reads this month' },
]

const count = (n: number) => n.toLocaleString('en-US')

function meterText(key: Allowance, u: ReturnType<typeof accountUsage> | null): string {
  if (!u) return '—'
  if (key === 'storage') return `${formatBytes(u.storageBytes)} of ${formatBytes(R2_FREE_TIER.storageBytes)}`
  return `${count(key === 'classA' ? u.classA : u.classB)} of ${count(R2_FREE_TIER[key])}`
}

export default function AdminPhotoStorage() {
  const [rows, setRows] = useState<R2StorageSnapshot[] | null>(null)
  useEffect(() => { fetchR2StorageSnapshots().then(setRows) }, [])

  const view = useMemo(() => {
    if (!rows || rows.length === 0) return null
    const latestDay = rows[0].day
    const latest = rows.filter(r => r.day === latestDay)
    const oldestDay = rows[rows.length - 1].day
    const total = (day: string) => rows.filter(r => r.day === day)
      .reduce((n, r) => n + r.payload_bytes + r.metadata_bytes, 0)
    return {
      latestDay, latest, usage: accountUsage(latest),
      change: oldestDay === latestDay ? null : { bytes: total(latestDay) - total(oldestDay), since: oldestDay },
    }
  }, [rows])

  // Drawn whole while loading and with no data alike, so nothing moves when the read lands.
  const empty = rows !== null && view === null
  return (
    <Section title="Storage">
      {METERS.map(m => {
        const share = view ? view.usage.shares[m.key] : 0
        const warn = share >= ALERT_AT
        return (
          <Box key={m.key} sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Typography sx={{ flex: 1, fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{m.label}</Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: warn ? 'warning.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {meterText(m.key, view?.usage ?? null)}
              </Typography>
            </Box>
            <Box role="meter" aria-label={`${m.label}, share of the free tier`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(share, 1) * 100)}
              sx={{ mt: 0.75, height: 8, borderRadius: 4, border: '1px solid', borderColor: 'outline', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${Math.min(share, 1) * 100}%`, bgcolor: warn ? 'warning.main' : 'primary.main' }} />
            </Box>
          </Box>
        )
      })}
      {(view?.latest ?? []).map(b => (
        <Box key={b.bucket} sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'baseline', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {BUCKET_LABELS[b.bucket] ?? b.bucket}
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {count(b.object_count)} objects · {formatBytes(b.payload_bytes + b.metadata_bytes)}
          </Typography>
        </Box>
      ))}
      <Typography sx={{ px: 1.5, py: 1, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
        {empty ? 'No data'
          : !view ? '—'
          : `As of ${view.latestDay}${view.change
            ? ` · ${view.change.bytes >= 0 ? '+' : '−'}${formatBytes(Math.abs(view.change.bytes))} since ${view.change.since}`
            : ''}`}
      </Typography>
    </Section>
  )
}
