import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, IconButton } from '@mui/material'
import { Refresh } from '@mui/icons-material'
import { Section, StatRow, AdminTools, HealthGroup, HealthStrip, useOpsHealth } from './AdminPanel'
import { PlayerPortrait } from './wpbl/ui'
import {
  fetchAnalytics, localTz, deltaPct, formatDelta, formatCount, formatShare,
  trimLeadingEmpty, shortDate, prettyEvent, seriesPoints,
  EMPTY_OVERVIEW, EMPTY_GROWTH, EMPTY_STATS_BOARDS, EMPTY_ENTRY_POINTS, EMPTY_SEARCH,
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

// The page has three jobs that were previously one 17-card scroll: what the audience did,
// whether the pipelines ran, and the things the owner operates. They share almost nothing:
// the range and league filters below apply to the first and to nothing else, so they are
// three groups rather than three runs of cards separated by nothing but a heading.
type Group = 'audience' | 'health' | 'tools'
const GROUPS: Array<{ value: Group; label: string }> = [
  { value: 'audience', label: 'Audience' },
  { value: 'health',   label: 'Health' },
  { value: 'tools',    label: 'Tools' },
]

// How many event rows the card shows before the "show all" tap. Twelve covers everything
// that has ever cleared a hundred events in a window; the tail below it is instrumentation
// that exists to be checked occasionally, not scanned daily.
const EVENT_HEAD = 12

// `days_back` in every RPC means "this many calendar days back, ending now", so 1 is
// midnight-to-now in the reader's own timezone. It is labelled "Today" rather than "24h"
// because that is what the number is: at 9am it covers nine hours, not twenty-four. A true
// rolling 24h window would mean an hours parameter on all nine RPCs and an hour-bucketed
// series behind the chart, which is a different feature, not a different label.
const RANGES: Array<{ days: number; label: string }> = [
  { days: 1,  label: 'Today' },
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

/** "in 30 days" / "today" — the range as it reads inside a tile's sub-line. */
const rangeLabel = (days: number) => (days === 1 ? 'today so far' : `in ${days} days`)
const LEAGUES: Array<{ value: LeagueFilter; label: string }> = [
  { value: 'all',  label: 'All' },
  { value: 'wpbl', label: 'WPBL' },
  { value: 'mlb',  label: 'MLB' },
]

const EMPTY_BUNDLE: AnalyticsBundle = {
  overview: EMPTY_OVERVIEW, events: [], tabs: [], statsBoards: EMPTY_STATS_BOARDS,
  entryPoints: EMPTY_ENTRY_POINTS, search: EMPTY_SEARCH, players: [],
  growth: EMPTY_GROWTH,
}

// The three destinations the entry-point card reports, in the order they are worth reading:
// a player page is the section's retention event, a team page is its deepest surface, and
// Game Center is its busiest modal. Fixed rather than sorted by volume, so the card does not
// reshuffle between ranges.
const DESTS: Array<{ key: string; label: string; color: string }> = [
  { key: 'player', label: 'Player pages', color: '#22c55e' },
  { key: 'team',   label: 'Team pages',   color: '#a78bfa' },
  { key: 'game',   label: 'Game Center',  color: '#60a5fa' },
]

// How each WPBL tab was reached. Distinct hues rather than shades of one, because the
// question the panel answers is "pill or swipe", not "more or less".
const VIA_COLORS: Record<string, string> = {
  pill: '#60a5fa', swipe: '#f59e0b', link: '#22c55e', '—': '#94a3b8',
}
const viaColor = (v: string) => VIA_COLORS[v] ?? VIA_COLORS['—']

/** 'season hitting' → 'Season · Hitting'; the bare 'draft' stays one word. */
const prettyBoard = (b: string) =>
  b.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' · ')

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

  // One day is not a shape. A single point renders as an invisible polyline over a triangular
  // fill, with the same date printed at both ends of the axis: 150px of chrome saying nothing.
  // The Today range hits this every time, and so does the second day of any new instrument.
  if (data.length < 2) {
    return <Box sx={{ px: 1.5, py: 2.5, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>
        {formatCount(data[0].events)} events · {formatCount(data[0].browsers)} browsers
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mt: 0.3 }}>
        {shortDate(data[0].date)} — a trend needs at least two days
      </Typography>
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
  const [group, setGroup]   = useState<Group>('audience')
  const [days, setDays]     = useState<number>(30)
  const [league, setLeague] = useState<LeagueFilter>('all')
  const [data, setData]     = useState<AnalyticsBundle>(EMPTY_BUNDLE)
  const [loading, setLoading] = useState(true)
  // Long tail: 28 event names and counting, most of them near-zero. Show the head, and keep
  // the rest one tap away rather than making the card scroll past everything else on the page.
  const [allEvents, setAllEvents] = useState(false)
  const tz = useMemo(() => localTz(), [])
  // Read once for the whole page, not per group: the header strip summarises it from
  // wherever you are, so it cannot wait for the Health group to mount.
  const health = useOpsHealth()

  const load = useCallback(() => {
    setLoading(true)
    let live = true
    fetchAnalytics(days, league, tz).then(d => { if (live) { setData(d); setLoading(false) } })
    return () => { live = false }
  }, [days, league, tz])

  useEffect(() => load(), [load])

  const { overview, events, tabs, statsBoards, entryPoints, search, players, growth } = data
  const t = overview.totals, p = overview.prev

  // A range that reaches back before the first event would otherwise pad the chart with
  // blank days and quietly overstate how long we've been measuring.
  const firstEvent = overview.first_event
  const shortHistory = firstEvent
    ? (Date.now() - new Date(`${firstEvent}T00:00:00`).getTime()) / 86_400_000 < days
    : false

  // Whether the previous-window deltas are worth drawing at all — see the note beside the
  // tiles. Only the Today range is partial enough for them to mislead.
  const comparable = days > 1

  const maxEvent = Math.max(1, ...events.map(e => e.events))
  const maxPlayer = Math.max(1, ...players.map(x => x.opens))
  const maxBoard = Math.max(1, ...statsBoards.boards.map(b => b.events))
  // Entry points are grouped by destination, and each group gets its OWN scale: the three
  // destinations differ by an order of magnitude, so a shared one would flatten the smaller
  // two into empty tracks and hide the only thing this card is for, which is the mix inside
  // each destination rather than the sizes of the three against each other.
  const entryByDest = useMemo(() => {
    const m = new Map<string, typeof entryPoints.sources>()
    for (const r of entryPoints.sources) m.set(r.dest, [...(m.get(r.dest) ?? []), r])
    return m
  }, [entryPoints.sources])
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
          {(loading || health.loading) && <CircularProgress size={14} />}
          <IconButton size="small" onClick={() => { load(); health.reload() }} sx={{ color: 'text.secondary' }} aria-label="Refresh">
            <Refresh sx={{ fontSize: '1.05rem' }} />
          </IconButton>
        </Box>
      </Box>

      {/* ── group nav ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 0.6, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {GROUPS.map(g => (
          <Chip key={g.value} label={g.label} active={group === g.value} onClick={() => setGroup(g.value)} />
        ))}
      </Box>

      {/* Pipeline health follows you across groups. It is the only thing on this page that is
          ever urgent, and it used to be the furthest from the top. Redundant on the Health
          group, which is the same four states with their detail, so it steps aside there. */}
      {group !== 'health' && <HealthStrip health={health} onOpen={() => setGroup('health')} />}

      {group === 'audience' && (<>
      <Box sx={{ display: 'flex', gap: 0.6, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {RANGES.map(r => (
          <Chip key={r.days} label={r.label} active={days === r.days} onClick={() => setDays(r.days)} />
        ))}
        <Box sx={{ width: 10 }} />
        {LEAGUES.map(l => (
          <Chip key={l.value} label={l.label} active={league === l.value} onClick={() => setLeague(l.value)} />
        ))}
      </Box>

      {/* Today-so-far against ALL of yesterday is a comparison that reads negative every
          morning and only catches up around midnight, so the Today range shows counts without
          delta chips rather than a red arrow that means nothing. The same bias exists at the
          longer ranges (a 7d window is six full days plus a partial one) but at 1/7th and
          1/30th of the weight, which is why they keep theirs. */}
      {!comparable && (
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mb: 1.5 }}>
          Today runs from midnight in {overview.tz || tz} to now, so it is a partial day.
          Change arrows are hidden here: yesterday is a full day and the comparison would read
          negative until late evening.
        </Typography>
      )}

      {shortHistory && firstEvent && (
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mb: 1.5 }}>
          Events only go back to {shortDate(firstEvent)} — the chart starts where the data does,
          and the previous-window deltas have nothing to compare against yet.
        </Typography>
      )}

      {/* ── headline tiles ─────────────────────────────────────────────── */}
      {/* Three, and each answers a different question. This row used to be five, which put two
          different window semantics side by side under one range filter: Browsers/Events/Signed
          in follow the chips above, while Active today / Active 30d are FIXED and ignore them.
          Two of the five are gone:

          - "Events" was a headline that instrumentation moves. Adding seven event names on Aug
            25 lifts it about a fifth with no change in what anyone did, and the number is
            already on the page twice (the chart plots it per day, the Events card breaks it
            down). A volume count that a deploy can move is not a headline.
          - "Active 30d" and "Active today" were two tiles carrying three numbers between them.
            They are one fixed-window answer and now read as one tile that says so. */}
      <Box sx={{
        display: 'grid', gap: 1, mb: 2.5,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
      }}>
        <Tile label="Browsers" value={formatCount(t.browsers)}
          delta={comparable ? deltaPct(t.browsers, p.browsers) : undefined}
          sub={rangeLabel(days)} />
        <Tile label="Signed in" value={formatShare(t.signed_in_browsers, t.browsers)}
          delta={comparable ? deltaPct(t.signed_in_browsers, p.signed_in_browsers) : undefined}
          sub={`${t.users} users, ${t.signed_in_browsers} browsers`} />
        {/* Fixed windows, deliberately: these are the only numbers on the page the range chips
            do not touch, so the sub-line names all three rather than letting the tile look like
            it moved when the reader changed the range. */}
        <Tile label="Active browsers" value={formatCount(overview.active.today)}
          sub={`today · ${formatCount(overview.active.week)} in 7d · ${formatCount(overview.active.month)} in 30d`} />
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
            {(allEvents ? events : events.slice(0, EVENT_HEAD)).map(e => (
              <Box key={e.event} sx={{ py: 0.8, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, minWidth: 0, flex: 1 }}>
                    {prettyEvent(e.event)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{e.events.toLocaleString()}</Typography>
                  {comparable && (
                    <Box sx={{ minWidth: 42, textAlign: 'right' }}>
                      <Delta pct={deltaPct(e.events, e.prev_events)} />
                    </Box>
                  )}
                </Box>
                <Bar value={e.events} max={maxEvent} color="#60a5fa" />
                <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.4 }}>
                  {plural(e.browsers, 'browser')} · {plural(e.users, 'signed-in user')}
                </Typography>
              </Box>
            ))}
            {events.length > EVENT_HEAD && (
              <Box
                onClick={() => setAllEvents(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setAllEvents(v => !v) } }}
                sx={{
                  py: 0.9, textAlign: 'center', cursor: 'pointer', userSelect: 'none',
                  borderTop: '1px solid', borderColor: 'divider',
                  fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {allEvents ? 'Show fewer' : `Show all ${events.length}`}
              </Box>
            )}
          </Box>
        )}
      </Section>

      {/* ── WPBL tabs ──────────────────────────────────────────────────── */}
      <Section title="WPBL Tabs: how they're reached">
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

      {/* ── WPBL stats boards ──────────────────────────────────────────── */}
      {/* The tab above says people arrive at Stats; this says what they read once they're
          there. The axes are component state and never reach the URL, so this panel is the
          only place the answer exists. Cloudflare's path counts see one /wpbl either way. */}
      <Section title="WPBL Stats: which board">
        {statsBoards.boards.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              No board views in this range. Instrumented Aug 20, 2026, so ranges reaching back
              past that are empty rather than quiet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 1 }}>
            {statsBoards.boards.map(b => (
              <Box key={`${b.board}|${b.mode}`} sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, py: 0.7,
                '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
              }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    {prettyBoard(b.board)}{b.mode !== '—' && b.mode !== 'players' ? ` · ${b.mode}` : ''}
                  </Typography>
                  <Box sx={{ mt: 0.4 }}><Bar value={b.events} max={maxBoard} color="#a78bfa" /></Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{b.events.toLocaleString()}</Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{b.browsers} br</Typography>
                </Box>
              </Box>
            ))}

            {/* Arrivals (open/return, the board they already had) against deliberate
                switches. A board nobody ever switches *to* is one the defaults chose. */}
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1 }}>
              reached by {statsBoards.via.map(v => `${v.via} ${v.events}`).join(' · ')}
            </Typography>

            {statsBoards.sorts.length > 0 && (
              <>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1.5, mb: 0.5 }}>
                  Sorted by
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {statsBoards.sorts.slice(0, 10).map(x => (
                    <Box key={`${x.key}|${x.side}|${x.asc}`} sx={{
                      px: 0.9, py: 0.3, borderRadius: 999, bgcolor: 'action.hover',
                      fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
                    }}>
                      {x.key.toUpperCase()} {x.asc ? '↑' : '↓'} {x.events}
                    </Box>
                  ))}
                </Box>
              </>
            )}

            {statsBoards.filters.length > 0 && (
              <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1.25 }}>
                filters {statsBoards.filters.map(f => `${f.filter} ${f.on ? 'on' : 'off'} ${f.events}`).join(' · ')}
              </Typography>
            )}
          </Box>
        )}
      </Section>

      {/* ── how readers reach a page ───────────────────────────────────── */}
      {/* Player opens are the retention event and team pages are the deepest surface in the
          section, and both used to be one flat number. This is the `from` breakdown: which
          surface actually feeds each destination, and which ones are decoration. */}
      <Section title="WPBL: how readers get there">
        {entryPoints.sources.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              No page opens in this range. Team opens and the Game Center `from` label were
              instrumented Aug 25, 2026, so earlier rows show as "—" rather than as a surface.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 1 }}>
            {DESTS.map(d => {
              const rows = entryByDest.get(d.key) ?? []
              if (rows.length === 0) return null
              const total = rows.reduce((n, r) => n + r.events, 0)
              const max = Math.max(1, ...rows.map(r => r.events))
              return (
                <Box key={d.key} sx={{ py: 0.9, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.6 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, flex: 1 }}>{d.label}</Typography>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>{total.toLocaleString()}</Typography>
                  </Box>
                  {rows.map(r => (
                    <Box key={r.from} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.3 }}>
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: 'text.secondary', width: 84, flexShrink: 0 }}>
                        {r.from}
                      </Typography>
                      <Box sx={{ flex: 1, minWidth: 0 }}><Bar value={r.events} max={max} color={d.color} /></Box>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, width: 48, textAlign: 'right', flexShrink: 0 }}>
                        {r.events.toLocaleString()}
                      </Typography>
                      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', width: 40, textAlign: 'right', flexShrink: 0 }}>
                        {r.browsers} br
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )
            })}

            {entryPoints.game_tabs.length > 0 && (
              <>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1.5, mb: 0.5 }}>
                  Game Center tabs
                </Typography>
                {/* 'open' is the tab the modal picked; 'pill' and 'swipe' are the reader
                    choosing. A tab that only ever appears as 'open' was never wanted. */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {entryPoints.game_tabs.slice(0, 12).map(x => (
                    <Box key={`${x.tab}|${x.via}|${x.status}`} sx={{
                      px: 0.9, py: 0.3, borderRadius: 999, bgcolor: 'action.hover',
                      fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
                    }}>
                      {x.tab} · {x.via} {x.events}
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </Box>
        )}
      </Section>

      {/* ── header search ──────────────────────────────────────────────── */}
      {/* Search is in the header on every page in the section and produced no rows at all
          until Aug 25, 2026. The number that earns this card is `missed`: a query that found
          nothing is a reader who came for something specific and left without it, and it is
          the only list on this page that names a thing to go and fix. */}
      <Section title="WPBL search">
        {search.totals.searched === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              No searches in this range. Instrumented Aug 25, 2026, so ranges reaching back
              past that are empty rather than quiet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <StatRow label="Searches" value={formatCount(search.totals.searched)}
              sub={plural(search.totals.searched_browsers, 'browser')} />
            <StatRow label="Found nothing" value={formatCount(search.totals.empty)}
              sub={formatShare(search.totals.empty, search.totals.searched)} />
            <StatRow label="Picked a result" value={formatCount(search.totals.picked)}
              sub={formatShare(search.totals.picked, search.totals.searched)} />

            {search.picks.length > 0 && (
              <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 1 }}>
                picks {search.picks.map(x => `${x.type} via ${x.source} ${x.events}`).join(' · ')}
              </Typography>
            )}

            {search.missed.length > 0 && (
              <>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1.5, mb: 0.5 }}>
                  Matched nothing
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {search.missed.map(x => (
                    <Box key={x.q} title={plural(x.browsers, 'browser')} sx={{
                      px: 0.9, py: 0.3, borderRadius: 999, bgcolor: 'action.hover',
                      fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
                    }}>
                      {x.q}{x.events > 1 ? ` ×${x.events}` : ''}
                    </Box>
                  ))}
                </Box>
              </>
            )}
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

      {/* The Discord invite funnel card lived here until Aug 25, 2026. The promo card it
          measured was retired from Home on Aug 19: impressions and dismissals froze that day
          while joins kept accruing from the footer link, so its rates were already drifting
          toward a "joined" share that would eventually pass 100%. A card that has to open by
          telling you not to read it is not a card. The run it recorded (8.3% of sessions that
          saw it joined) is in the WPBL roadmap's shipped log, and `admin_discord_funnel` is
          still there if the numbers are ever wanted again — it is just no longer a round trip
          on every load of this page. */}

      {/* ── growth & notifications ─────────────────────────────────────── */}
      <Section title="Accounts & notifications">
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <StatRow label="Total users" sub={growth.deleted_users > 0 ? `${growth.deleted_users} deactivated` : undefined}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.total_users}</Typography>} />
          <StatRow label={`Signups ${rangeLabel(days)}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.signups_window}</Typography>} />
          <StatRow label="Push subscribers" sub={plural(growth.push_devices, 'device')}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.push_users}</Typography>} />
          <StatRow label="Game-start reminders" sub={`${growth.notify_wpbl_all} on every WPBL game · ${plural(growth.notify_picks, 'pick reminder')}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.notify_game_start}</Typography>} />
          <StatRow label="Per-game WPBL reminders" sub={`${plural(growth.game_reminder_users, 'user')}, upcoming games only`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.game_reminder_rows}</Typography>} />
          {/* Was a Section of its own holding this one number. It is a usage count, so it
              belongs with the other usage counts rather than with the pipeline health. */}
          <StatRow label="MLB predictions" sub="all time, across every player and bot"
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>
              {health.predictions?.toLocaleString() ?? '—'}
            </Typography>} />
        </Box>
      </Section>

      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', mt: 2 }}>
        "Browsers" counts distinct localStorage ids, not people — one person on a phone and a
        laptop is two, and clearing site data starts a new one. Day buckets are in {overview.tz || tz}.
        An event's count can also jump on the day it was instrumented rather than on the day
        behaviour changed: search, team opens and the Game Center tabs all start Aug 25, 2026,
        and a window spanning that date is comparing a surface against its own silence.
      </Typography>
      </>)}

      {group === 'health' && <HealthGroup health={health} />}

      {group === 'tools' && <AdminTools apps={apps} isAppLocked={isAppLocked} onOpenApp={onOpenApp} />}
    </Box>
  )
}
