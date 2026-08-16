import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, IconButton, Tooltip } from '@mui/material'
import { Refresh, InfoOutlined } from '@mui/icons-material'
import { Section, StatRow, AdminTools } from './AdminPanel'
import { PlayerPortrait } from './wpbl/ui'
import {
  fetchAnalytics, localTz, deltaPct, formatDelta, formatCount, formatShare,
  trimLeadingEmpty, shortDate, prettyEvent, seriesPoints,
  EMPTY_OVERVIEW, EMPTY_GROWTH,
} from './lib/analyticsAdmin'
import type { AnalyticsBundle, LeagueFilter, DayPoint } from './lib/analyticsAdmin'

/** "1 browser" / "2 browsers" — the counts here are small enough that "1 browsers" shows. */
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

// The owner's dashboard for what people actually do on the site — the thing that used to
// mean opening the Supabase SQL editor.
//
// Every number is a `security definer` RPC away (see src/lib/analyticsAdmin.ts); nothing
// here reads a table directly, and nothing here is a security boundary. The route gate in
// App.tsx is cosmetic: a non-owner who types /admin gets bounced, and if they didn't, every
// RPC would still refuse them.
//
// Charts are hand-rolled inline SVG. There is no chart library in package.json and this
// doesn't justify adding one — PitchLocation.tsx already sets the precedent that a plot
// here is a viewBox and some polylines.

const RANGES = [7, 30, 90] as const
const LEAGUES: Array<{ value: LeagueFilter; label: string }> = [
  { value: 'all',  label: 'All' },
  { value: 'wpbl', label: 'WPBL' },
  { value: 'mlb',  label: 'MLB' },
]

const EMPTY_BUNDLE: AnalyticsBundle = {
  overview: EMPTY_OVERVIEW, events: [], tabs: [], players: [],
  discord: { impressions: 0, shown: 0, joined: 0, dismissed: 0 },
  growth: EMPTY_GROWTH,
}

// How each WPBL tab was reached. Distinct hues rather than shades of one, because the
// question the panel answers is "pill or swipe", not "more or less".
const VIA_COLORS: Record<string, string> = {
  pill: '#60a5fa', swipe: '#f59e0b', link: '#22c55e', '—': '#94a3b8',
}
const viaColor = (v: string) => VIA_COLORS[v] ?? VIA_COLORS['—']

// ─── small shared bits ────────────────────────────────────────────────────────

/** A range/league chip. The page's only control idiom, used by both filter rows. */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1.4, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.5,
        border: '1px solid', borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'primary.main' : 'background.paper',
        color: active ? 'primary.contrastText' : 'text.secondary',
        transition: 'background-color .15s, border-color .15s, color .15s',
        '&:hover': { borderColor: active ? 'primary.main' : 'text.secondary' },
      }}
    >
      {label}
    </Box>
  )
}

/** "+12%" in green, "−5%" in red, "—" muted. Neutral at exactly flat. */
function Delta({ pct }: { pct: number | null }) {
  const s = formatDelta(pct)
  const color = pct == null || Math.round(pct) === 0
    ? 'text.disabled'
    : pct > 0 ? 'success.main' : 'error.main'
  return <Typography component="span" sx={{ fontSize: '0.7rem', fontWeight: 700, color }}>{s}</Typography>
}

/** A headline number with its change against the previous equal window. */
function Tile({ label, value, delta, sub }: {
  label: string; value: string; delta?: number | null; sub?: string
}) {
  return (
    <Box sx={{
      p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider',
      bgcolor: 'background.paper', minWidth: 0,
    }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.disabled' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.8, mt: 0.3, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</Typography>
        {delta !== undefined && <Delta pct={delta} />}
      </Box>
      {sub && (
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.2 }}>{sub}</Typography>
      )}
    </Box>
  )
}

/** A "why this number is what it is" hint, for the counts that are easy to misread. */
function Hint({ text }: { text: string }) {
  return (
    <Tooltip title={text} enterTouchDelay={0} leaveTouchDelay={4000}>
      <InfoOutlined sx={{ fontSize: '0.85rem', color: 'text.disabled', verticalAlign: 'middle', ml: 0.4 }} />
    </Tooltip>
  )
}

/** A proportional bar for a table row, drawn relative to the biggest row in the table. */
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <Box sx={{ height: 5, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
      <Box sx={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, height: '100%', bgcolor: color, borderRadius: 999 }} />
    </Box>
  )
}

// ─── activity chart ───────────────────────────────────────────────────────────

/**
 * Events and unique browsers per day.
 *
 * Two series on one plot with wildly different magnitudes (~2,000 events vs ~400 browsers),
 * so each is scaled to its OWN peak and both peaks are labelled. A shared axis would flatten
 * the browsers line into the baseline and make the panel useless for the number that
 * matters more.
 */
function ActivityChart({ series, tz }: { series: DayPoint[]; tz: string }) {
  const data = useMemo(() => trimLeadingEmpty(series), [series])
  const W = 640, H = 150, PAD = 6

  const ev = seriesPoints(data.map(d => d.events),   W, H, PAD)
  const br = seriesPoints(data.map(d => d.browsers), W, H, PAD)

  if (data.length === 0) {
    return <Box sx={{ px: 1.5, py: 3, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>No activity in this range.</Typography>
    </Box>
  }

  // Closing the events polyline back along the baseline turns it into a fill.
  const area = ev.points ? `${ev.points} ${W},${H - PAD} 0,${H - PAD}` : ''

  return (
    <Box sx={{ px: 1.5, py: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        {[
          { c: '#60a5fa', label: 'Events',   peak: ev.max },
          { c: '#f59e0b', label: 'Browsers', peak: br.max },
        ].map(l => (
          <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 9, height: 3, borderRadius: 999, bgcolor: l.c }} />
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontWeight: 600 }}>
              {l.label} <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                peak {formatCount(l.peak)}
              </Typography>
            </Typography>
          </Box>
        ))}
      </Box>

      <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        sx={{ width: '100%', height: 150, display: 'block', color: 'text.disabled' }}>
        {/* Quarter gridlines, unlabelled — they give the eye a reference without implying
            a shared scale the two series don't have. */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} x2={W} y1={PAD + (H - PAD * 2) * f} y2={PAD + (H - PAD * 2) * f}
            stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {area && <polygon points={area} fill="#60a5fa" fillOpacity={0.13} />}
        {ev.points && <polyline points={ev.points} fill="none" stroke="#60a5fa" strokeWidth={2}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {br.points && <polyline points={br.points} fill="none" stroke="#f59e0b" strokeWidth={2}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="4 3" />}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }}>{shortDate(data[0].date)}</Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }}>
          days in {tz}
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }}>{shortDate(data[data.length - 1].date)}</Typography>
      </Box>
    </Box>
  )
}

// ─── the page ─────────────────────────────────────────────────────────────────

export default function AdminPage({ apps, isAppLocked, onOpenApp }: {
  apps: Array<{ label: string; emoji: string; desc: string; path: string; color: string }>
  isAppLocked: (path: string) => boolean
  onOpenApp: (path: string) => void
}) {
  const [days, setDays]     = useState<number>(30)
  const [league, setLeague] = useState<LeagueFilter>('all')
  const [data, setData]     = useState<AnalyticsBundle>(EMPTY_BUNDLE)
  const [loading, setLoading] = useState(true)
  const tz = useMemo(() => localTz(), [])

  const load = useCallback(() => {
    setLoading(true)
    let live = true
    fetchAnalytics(days, league, tz).then(d => { if (live) { setData(d); setLoading(false) } })
    return () => { live = false }
  }, [days, league, tz])

  useEffect(() => load(), [load])

  const { overview, events, tabs, players, discord, growth } = data
  const t = overview.totals, p = overview.prev

  // A range that reaches back before the first event would otherwise pad the chart with
  // blank days and quietly overstate how long we've been measuring.
  const firstEvent = overview.first_event
  const shortHistory = firstEvent
    ? (Date.now() - new Date(`${firstEvent}T00:00:00`).getTime()) / 86_400_000 < days
    : false

  const maxEvent = Math.max(1, ...events.map(e => e.events))
  const maxPlayer = Math.max(1, ...players.map(x => x.opens))
  // Tab views are grouped into one stacked bar per tab, so the segments share a scale: the
  // busiest tab's TOTAL. Scaling each segment to the largest single segment instead would
  // let a three-way split (stats: 472 + 190 + 113) add up past the full width of its track.
  const tabTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tabs) m.set(t.view, (m.get(t.view) ?? 0) + t.events)
    return m
  }, [tabs])
  const maxTab = Math.max(1, ...tabTotals.values())

  return (
    <Box sx={{ maxWidth: 860, mx: 'auto', px: { xs: 1.5, sm: 3 }, pb: 4 }}>
      {/* ── header + filters ───────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800 }}>⚡ Admin</Typography>
        <Box sx={{ px: 1, py: 0.2, borderRadius: 999, bgcolor: 'warning.main', opacity: 0.9 }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#000', letterSpacing: 0.5 }}>OWNER</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {loading && <CircularProgress size={14} />}
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }} aria-label="Refresh">
            <Refresh sx={{ fontSize: '1.05rem' }} />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.6, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {RANGES.map(r => (
          <Chip key={r} label={`${r}d`} active={days === r} onClick={() => setDays(r)} />
        ))}
        <Box sx={{ width: 10 }} />
        {LEAGUES.map(l => (
          <Chip key={l.value} label={l.label} active={league === l.value} onClick={() => setLeague(l.value)} />
        ))}
      </Box>

      {shortHistory && firstEvent && (
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mb: 1.5 }}>
          Events only go back to {shortDate(firstEvent)} — the chart starts where the data does,
          and the previous-window deltas have nothing to compare against yet.
        </Typography>
      )}

      {/* ── headline tiles ─────────────────────────────────────────────── */}
      <Box sx={{
        display: 'grid', gap: 1, mb: 2.5,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
      }}>
        <Tile label="Browsers" value={formatCount(t.browsers)} delta={deltaPct(t.browsers, p.browsers)}
          sub={`in ${days} days`} />
        <Tile label="Events" value={formatCount(t.events)} delta={deltaPct(t.events, p.events)}
          sub={`in ${days} days`} />
        <Tile label="Signed in" value={formatShare(t.signed_in_browsers, t.browsers)}
          delta={deltaPct(t.signed_in_browsers, p.signed_in_browsers)}
          sub={`${t.users} users, ${t.signed_in_browsers} browsers`} />
        <Tile label="Active today" value={formatCount(overview.active.today)} sub="browsers" />
        <Tile label="Active 30d" value={formatCount(overview.active.month)}
          sub={`${formatCount(overview.active.week)} in last 7d`} />
      </Box>

      {/* ── activity ───────────────────────────────────────────────────── */}
      <Section title="Activity">
        <ActivityChart series={overview.series} tz={overview.tz || tz} />
      </Section>

      {/* ── events ─────────────────────────────────────────────────────── */}
      <Section title="Events">
        {events.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>No events in this range.</Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            {events.map(e => (
              <Box key={e.event} sx={{ py: 0.8, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, minWidth: 0, flex: 1 }}>
                    {prettyEvent(e.event)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{e.events.toLocaleString()}</Typography>
                  <Box sx={{ minWidth: 42, textAlign: 'right' }}>
                    <Delta pct={deltaPct(e.events, e.prev_events)} />
                  </Box>
                </Box>
                <Bar value={e.events} max={maxEvent} color="#60a5fa" />
                <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.4 }}>
                  {plural(e.browsers, 'browser')} · {plural(e.users, 'signed-in user')}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      {/* ── WPBL tabs ──────────────────────────────────────────────────── */}
      <Section title="WPBL Tabs — how they're reached">
        {tabs.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>No tab views in this range.</Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 1 }}>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
              {['pill', 'swipe', 'link'].map(v => (
                <Box key={v} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: viaColor(v) }} />
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontWeight: 600 }}>{v}</Typography>
                </Box>
              ))}
            </Box>
            {/* Grouped by tab so the pill/swipe split is a within-row comparison — the
                actionable read is "which tabs do people swipe to", not the raw ranking. */}
            {Array.from(new Set(tabs.map(x => x.view))).map(view => {
              const rows = tabs.filter(x => x.view === view)
              const total = tabTotals.get(view) ?? 0
              return (
                <Box key={view} sx={{ py: 0.7, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, flex: 1 }}>{view}</Typography>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>{total.toLocaleString()}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
                    {rows.map(r => (
                      <Box key={r.via} title={`${r.via}: ${r.events}`}
                        sx={{ width: `${(r.events / maxTab) * 100}%`, bgcolor: viaColor(r.via) }} />
                    ))}
                  </Box>
                  <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.4 }}>
                    {rows.map(r => `${r.via} ${r.events}`).join(' · ')}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
      </Section>

      {/* ── top players ────────────────────────────────────────────────── */}
      <Section title="Most-opened players">
        {players.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>No player pages opened in this range.</Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            {players.map((pl, i) => (
              <Box key={pl.player_id} sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, py: 0.7,
                '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
              }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: 'text.disabled', width: 16 }}>{i + 1}</Typography>
                <PlayerPortrait name={pl.name} teamId={pl.team_id} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{pl.name}</Typography>
                  <Box sx={{ mt: 0.4 }}><Bar value={pl.opens} max={maxPlayer} color="#22c55e" /></Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{pl.opens}</Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{pl.browsers} br</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      {/* ── Discord funnel ─────────────────────────────────────────────── */}
      <Section title="Discord invite">
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <StatRow
            label="Sessions that saw the card"
            sub={`${discord.impressions.toLocaleString()} impressions — the card mounts several times a session`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{discord.shown.toLocaleString()}</Typography>}
          />
          <StatRow
            label={<>Joined<Hint text="Sessions that clicked Join ÷ sessions that saw the card. Measured over raw impressions instead, this rate would read about a third of the truth." /></>}
            sub={`${discord.joined.toLocaleString()} of ${plural(discord.shown, 'session')}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: 'success.main' }}>
              {formatShare(discord.joined, discord.shown)}
            </Typography>}
          />
          <StatRow
            label="Dismissed"
            sub={`${discord.dismissed.toLocaleString()} of ${plural(discord.shown, 'session')}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: 'text.secondary' }}>
              {formatShare(discord.dismissed, discord.shown)}
            </Typography>}
          />
          <Box sx={{ pb: 1 }}>
            <Box sx={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
              <Box sx={{ width: `${discord.shown ? (discord.joined / discord.shown) * 100 : 0}%`, bgcolor: '#22c55e' }} />
              <Box sx={{ width: `${discord.shown ? (discord.dismissed / discord.shown) * 100 : 0}%`, bgcolor: '#ef4444' }} />
            </Box>
          </Box>
        </Box>
      </Section>

      {/* ── growth & notifications ─────────────────────────────────────── */}
      <Section title="Accounts & notifications">
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <StatRow label="Total users" sub={growth.deleted_users > 0 ? `${growth.deleted_users} deactivated` : undefined}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.total_users}</Typography>} />
          <StatRow label={`Signups in ${days} days`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.signups_window}</Typography>} />
          <StatRow label="Push subscribers" sub={plural(growth.push_devices, 'device')}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.push_users}</Typography>} />
          <StatRow label="Game-start reminders" sub={`${growth.notify_wpbl_all} on every WPBL game · ${plural(growth.notify_picks, 'pick reminder')}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.notify_game_start}</Typography>} />
          <StatRow label="Per-game WPBL reminders" sub={`${plural(growth.game_reminder_users, 'user')}, upcoming games only`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.game_reminder_rows}</Typography>} />
        </Box>
      </Section>

      {/* ── the operational half, lifted out of the old Admin dialog ───── */}
      <AdminTools apps={apps} isAppLocked={isAppLocked} onOpenApp={onOpenApp} />

      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', mt: 2 }}>
        "Browsers" counts distinct localStorage ids, not people — one person on a phone and a
        laptop is two, and clearing site data starts a new one. Day buckets are in {overview.tz || tz}.
      </Typography>
    </Box>
  )
}
