import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { pressable } from './ui/interaction'
import { Box, Typography, CircularProgress, IconButton } from '@mui/material'
import { Refresh, ExpandMore } from '@mui/icons-material'
import { StatRow, AdminTools, HealthGroup, HealthStrip, useOpsHealth, useOpenFeedback, healthSummary } from './AdminPanel'
import { PageTabs } from './ui/PageTabs'
import { runningBuild } from './lib/staleBuild'
import AdminPhotos from './wpbl/AdminPhotos'
import AdminClips from './wpbl/AdminClips'
import AdminRosterMoves from './wpbl/AdminRosterMoves'
import AdminRoadmap from './AdminRoadmap'
import { PlayerPortrait } from './wpbl/ui'
// The gesture the win probability and standings charts already use. It lives under wpbl/
// because `data-swipe-lock` exists for that section's tab pager, but nothing in it is
// league-specific, and this file already reaches across for PlayerPortrait.
import { useChartScrub } from './ui/chartScrub'
import {
  fetchAnalytics, localTz, deltaPct, formatDelta, formatCount, formatShare,
  trimLeadingEmpty, shortDate, seriesPoints,
  EMPTY_OVERVIEW, EMPTY_GROWTH, EMPTY_STATS_BOARDS, EMPTY_ENTRY_POINTS, EMPTY_SEARCH, EMPTY_PALETTE,
  EMPTY_PAGE_USAGE, groupActions, buildFunnels, eventInfo, PAGE_LABELS, prettyId,
  EMPTY_WEB_VITALS, vitalRating, formatVital, EMPTY_MLB_USAGE, mlbCardLabel,
  EMPTY_AUDIENCE, EMPTY_TRAFFIC_SOURCES, EMPTY_BRIEFING, fetchBriefing, fetchDailyTrend,
  todayPace, formatMultiple, groupSources, rollingMean,
} from './lib/analyticsAdmin'
import type { Audience, Briefing, TrafficSources } from './lib/analyticsAdmin'
import type { LayoutShifts, VitalKey, VitalRating, WebVitalsRow } from './lib/analyticsAdmin'
import type { AnalyticsBundle, LeagueFilter, DayPoint, PaletteStats } from './lib/analyticsAdmin'
import { typePx } from './ui/scale'

/** "1 browser" / "2 browsers": the counts here are small enough that "1 browsers" shows. */
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
// The search box's totals across both sections, for the card's one-line summary.
const paletteOpened = (p: PaletteStats) => p.sections.reduce((n, s) => n + s.opened, 0)
const palettePicked = (p: PaletteStats) => p.sections.reduce((n, s) => n + s.picked, 0)

// The owner's dashboard for what people actually do on the site: the thing that used to
// mean opening the Supabase SQL editor.
//
// Every number is a `security definer` RPC away (see src/lib/analyticsAdmin.ts); nothing
// here reads a table directly, and nothing here is a security boundary. The route gate in
// App.tsx is cosmetic: a non-owner who types /admin gets bounced, and if they didn't, every
// RPC would still refuse them.
//
// Charts are hand-rolled inline SVG. There is no chart library in package.json and this
// doesn't justify adding one: PitchLocation.tsx already sets the precedent that a plot
// here is a viewBox and some polylines.

// The page has three jobs that were previously one 17-card scroll: what the audience did,
// whether the pipelines ran, and the things the owner operates. They share almost nothing:
// the range and league filters below apply to the first and to nothing else, so they are
// three groups rather than three runs of cards separated by nothing but a heading.
type Group = 'audience' | 'health' | 'tools' | 'photos' | 'clips' | 'rosters' | 'roadmap'
const GROUPS: Array<{ value: Group; label: string }> = [
  { value: 'audience', label: 'Audience' },
  { value: 'health',   label: 'Health' },
  { value: 'tools',    label: 'Tools' },
  { value: 'photos',   label: 'Photos' },
  { value: 'clips',    label: 'Clips' },
  { value: 'rosters',  label: 'Rosters' },
  { value: 'roadmap',  label: 'Roadmap' },
]

// How many event rows the card shows before the "show all" tap. Twelve covers everything
// that has ever cleared a hundred events in a window; the tail below it is instrumentation
// that exists to be checked occasionally, not scanned daily.
const EVENT_HEAD = 12

// "What people do" shows each area's top three and keeps the rest behind one tap: thirty-odd
// rows open by default is the scroll this card was written to replace.
const ACTIONS_PER_GROUP = 3

// The stats-board list runs to seventeen rows and most of the bottom half is near-zero (the
// Tracked boards sit at a single event), so it gets the same head-plus-"show all" treatment as
// the events list rather than a long dribble of invisible bars. Ten mirrors the top-players
// card and keeps everything over ~200 events visible without a tap.
const BOARD_HEAD = 10

// `days_back` in every RPC means "this many calendar days back, ending now", so 1 is
// midnight-to-now in the reader's own timezone. It is labeled "Today" rather than "24h"
// because that is what the number is: at 9am it covers nine hours, not twenty-four. A true
// rolling 24h window would mean an hours parameter on all nine RPCs and an hour-bucketed
// series behind the chart, which is a different feature, not a different label.
const RANGES: Array<{ days: number; label: string }> = [
  { days: 1,  label: 'Today' },
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

// THE PAGE'S WIDTH. 860 held one column of cards, which left most of a desktop empty and made the
// Audience group a single 20-card scroll. Audience lays its cards in two columns from md up; the
// groups that are one list (Health, Tools, Rosters, Roadmap) stay at the reading width inside it.
const ADMIN_WIDE = 1180
const ADMIN_NARROW = 860

// Audience's cards in four sections, each a question: who came, what they used on Home and the
// offseason pages, how they found their way around, and how the site itself held up. The sticky
// row links to each on a desktop.
const SECTIONS = [
  { id: 'traffic',  title: 'Traffic' },
  { id: 'used',     title: 'Home and pages' },
  { id: 'finding',  title: 'Navigation and search' },
  { id: 'site',     title: 'Site and accounts' },
] as const
type SectionId = typeof SECTIONS[number]['id']

/** A section's heading, with room above it for the pinned tabs and filters when a link lands on it. */
function SectionHead({ id }: { id: SectionId }) {
  const sec = SECTIONS.find(x => x.id === id)!
  return (
    <Typography id={`admin-${id}`} component="h2" sx={{
      fontSize: '0.74rem', fontWeight: 800, letterSpacing: typePx(0.9), textTransform: 'uppercase',
      color: 'text.secondary', mt: 3.5, mb: 1.25, scrollMarginTop: 'calc(var(--app-header-h, 0px) + 120px)',
    }}>
      {sec.title}
    </Typography>
  )
}

/** Two columns of cards from md up, one on a phone. Cards keep their own height (align start), so
 *  opening one does not stretch its neighbor. */
function SectionGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, columnGap: 1.5, alignItems: 'start' }}>
      {children}
    </Box>
  )
}

/** "in 30 days" / "today": the range as it reads inside a tile's sub-line. */
const rangeLabel = (days: number) => (days === 1 ? 'today so far' : `in ${days} days`)
const LEAGUES: Array<{ value: LeagueFilter; label: string }> = [
  { value: 'all',  label: 'All' },
  { value: 'wpbl', label: 'WPBL' },
  { value: 'mlb',  label: 'MLB' },
]

const EMPTY_BUNDLE: AnalyticsBundle = {
  overview: EMPTY_OVERVIEW, events: [], tabs: [], statsBoards: EMPTY_STATS_BOARDS,
  entryPoints: EMPTY_ENTRY_POINTS, search: EMPTY_SEARCH, palette: EMPTY_PALETTE, players: [],
  growth: EMPTY_GROWTH, pages: EMPTY_PAGE_USAGE, vitals: EMPTY_WEB_VITALS, mlb: EMPTY_MLB_USAGE,
  audience: EMPTY_AUDIENCE, sources: EMPTY_TRAFFIC_SOURCES, funnels: [],
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
      {...pressable(onClick)}
      sx={{
        px: 1.4, py: 0.5, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.5,
        border: '1px solid', borderColor: active ? 'primary.main' : 'outline',
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
/**
 * True until the range's first read lands. Every card below the range chips is drawn from that
 * one read, and before it they rendered the empty bundle as fact: "0 browsers", "No activity in
 * this range", which reads as an outage rather than a page still loading (Nov 12, 2026). The cards
 * keep their place and hide their contents, and each Fold says "Loading" instead.
 */
const RangePending = createContext(false)

function Tile({ label, value, delta, sub }: {
  label: string; value: string; delta?: number | null; sub?: string
}) {
  const pending = useContext(RangePending)
  return (
    <Box aria-busy={pending || undefined} sx={{
      p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'outline',
      bgcolor: 'background.paper', minWidth: 0,
    }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: typePx(0.8), textTransform: 'uppercase', color: 'text.disabled' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.8, mt: 0.3, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{pending ? '—' : value}</Typography>
        {delta !== undefined && !pending && <Delta pct={delta} />}
      </Box>
      {sub && (
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.2, visibility: pending ? 'hidden' : undefined }}>{sub}</Typography>
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

/** One point out of a `seriesPoints` string, as [x, y] in viewBox units.
 *
 *  Reading the drawn geometry back rather than recomputing it is the whole point: the two
 *  series are scaled to their own peaks, so a second copy of that arithmetic would be a second
 *  place for the cursor's dot to disagree with the line it is sitting on. */
function pointAt(points: string, i: number): [number, number] | null {
  if (!points) return null
  const pair = points.split(' ')[i]
  if (!pair) return null
  const [x, y] = pair.split(',').map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

/**
 * Events and unique browsers per day.
 *
 * Two series on one plot with wildly different magnitudes (~2,000 events vs ~400 browsers),
 * so each is scaled to its OWN peak and both peaks are labeled. A shared axis would flatten
 * the browsers line into the baseline and make the panel useless for the number that
 * matters more.
 */
export function ActivityChart({ series, tz }: { series: DayPoint[]; tz: string }) {
  const data = useMemo(() => trimLeadingEmpty(series), [series])
  const W = 640, H = 150, PAD = 6

  const ev = seriesPoints(data.map(d => d.events),   W, H, PAD)
  const br = seriesPoints(data.map(d => d.browsers), W, H, PAD)

  // BEFORE THE EARLY RETURNS, because it is a hook and the two bail-outs below are reachable
  // on the same mount that later has data: the Today range starts at one day and grows.
  const scrub = useChartScrub(data.length,
    'Events and unique browsers per day. Point at the chart, or use the arrow keys, to read any day.')
  const day = scrub.index != null ? data[Math.min(scrub.index, data.length - 1)] : null

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
        {shortDate(data[0].date)}: a trend needs at least two days
      </Typography>
    </Box>
  }

  // Closing the events polyline back along the baseline turns it into a fill.
  const area = ev.points ? `${ev.points} ${W},${H - PAD} 0,${H - PAD}` : ''

  return (
    <Box sx={{ px: 1.5, py: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        {/* THE NUMBER SITS NEXT TO ITS OWN COLOR, which is why the readout is here rather
            than in a floating tooltip: the two series are scaled to their own peaks, so the
            only thing tying a value to a line is the swatch beside it. At rest each shows its
            peak; under the cursor each shows that day, in the series' own color so it is
            obvious which line moved. */}
        {[
          { c: '#60a5fa', label: 'Events',   peak: ev.max, value: day?.events },
          { c: '#f59e0b', label: 'Browsers', peak: br.max, value: day?.browsers },
        ].map(l => (
          <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 9, height: 3, borderRadius: 999, bgcolor: l.c }} />
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontWeight: 600 }}>
              {l.label} {day
                ? <Typography component="span" sx={{
                    fontSize: '0.7rem', fontWeight: 800, color: l.c,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{formatCount(l.value ?? 0)}</Typography>
                : <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                    peak {formatCount(l.peak)}
                  </Typography>}
            </Typography>
          </Box>
        ))}
        {/* The day itself, which neither series can say. `aria-live` because the numbers to its
            left change with it and a screen reader driving this by keyboard needs to be told
            which day it landed on, not just that something moved. */}
        <Typography aria-live="polite" sx={{
          ml: 'auto', fontSize: '0.7rem', fontWeight: 800,
          color: day ? 'text.primary' : 'text.disabled',
        }}>{day ? shortDate(day.date) : ''}</Typography>
      </Box>

      {/* The plot and its cursor share one box, so the overlay below can position in
          percentages of exactly the box the viewBox is stretched across. */}
      <Box {...scrub.props} sx={{
        position: 'relative', width: '100%',
        cursor: 'ew-resize', userSelect: 'none',
        // Sideways belongs to the scrub, vertical to the page. Claimed here rather than argued
        // about in JavaScript, the same way the standings chart does it.
        touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent',
        borderRadius: 1,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}>
      <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        sx={{ width: '100%', height: 150, display: 'block', color: 'text.disabled' }}>
        {/* Quarter gridlines, unlabeled — they give the eye a reference without implying
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

      {/* CURSOR AND DOTS IN THE DOM, NOT THE SVG. The viewBox is stretched horizontally and not
          vertically (`preserveAspectRatio="none"` against a fixed 150px height), so a circle
          drawn inside it comes out an ellipse whose width depends on the panel. The line is
          vertical, so a 1px div is crisp where an SVG stroke would need the non-scaling hint.
          The COORDINATES come from the same strings the polylines are drawn from, parsed rather
          than recomputed: a second copy of the y formula is a second thing to keep in step with
          the fact that each series is scaled to its OWN peak. */}
      {day && scrub.index != null && (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <Box sx={{
            position: 'absolute', top: 0, bottom: 0, width: '1px',
            left: `${(pointAt(ev.points, scrub.index)?.[0] ?? 0) / W * 100}%`,
            bgcolor: 'text.disabled', opacity: 0.55,
          }} />
          {[{ pts: ev.points, c: '#60a5fa' }, { pts: br.points, c: '#f59e0b' }].map(sBar => {
            const pt = pointAt(sBar.pts, scrub.index!)
            if (!pt) return null
            return (
              <Box key={sBar.c} sx={{
                position: 'absolute',
                left: `${pt[0] / W * 100}%`, top: `${pt[1] / H * 100}%`,
                width: 9, height: 9, mt: '-4.5px', ml: '-4.5px',
                borderRadius: '50%', bgcolor: sBar.c,
                border: '2px solid', borderColor: 'background.paper',
              }} />
            )
          })}
        </Box>
      )}
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

// ─── page speed ──────────────────────────────────────────────────────────────
//
// Real readers' page loads (src/lib/webVitals.ts, admin_web_vitals), graded on Google's own lines
// at the 75th percentile, the way Search Console grades them. Led by the phone, because that is
// where the site is slow when it is slow and where three quarters of the traffic is; the desktop
// and tablet rows follow, then each section. LCP carries the color because it is the one that
// moved the most in every lab run; the rest are the line under it.

const RATING_COLOR: Record<VitalRating, string> = { good: '#22c55e', 'needs work': '#f59e0b', poor: '#ef4444' }
const DEVICE_ORDER = ['phone', 'tablet', 'desktop']

function VitalValue({ k, v }: { k: VitalKey; v: number | null }) {
  const r = vitalRating(k, v)
  return <Box component="span" sx={{ color: r ? RATING_COLOR[r] : 'text.disabled', fontWeight: 800 }}>{formatVital(k, v)}</Box>
}

function vitalsLine(r: WebVitalsRow) {
  return (
    <>
      INP <VitalValue k="inp" v={r.inp_p75} /> · CLS <VitalValue k="cls" v={r.cls_p75} /> ·
      First paint <VitalValue k="fcp" v={r.fcp_p75} /> · Server <VitalValue k="ttfb" v={r.ttfb_p75} />
      {' · '}{plural(r.loads, 'load')}
    </>
  )
}

// The elements behind the CLS figures above, so a poor score names what to fix. Ranked by how
// many loads past 0.1 each was the worst shift of, since the p75 moves with that count.
function ShiftRows({ shifts }: { shifts: LayoutShifts }) {
  if (shifts.over === 0) return null
  return (
    <>
      <GroupLabel>Largest layout shifts</GroupLabel>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.45 }}>
        {plural(shifts.over, 'load')} over CLS 0.1; {shifts.named} name the element that moved most.
      </Typography>
      {shifts.rows.map(r => (
        <MetricRow key={`${r.section}|${r.device}|${r.route}|${r.target}`}
          label={`${r.label ?? r.target} · ${prettyId(r.device)}, ${r.route}`}
          value={plural(r.loads, 'load')}
          sub={<>
            <Box component="span" sx={{ fontFamily: 'monospace' }}>{r.target}</Box>
            {r.shift_p50 != null && <> · typical shift {r.shift_p50.toFixed(2)}</>}
            {r.after_load != null && <> · {Math.round(r.after_load * 100)}% after load</>}
          </>} />
      ))}
    </>
  )
}

function PageSpeedCard({ rows, shifts }: { rows: WebVitalsRow[]; shifts?: LayoutShifts }) {
  const all = rows.find(r => r.device == null && r.section == null)
  const devices = rows.filter(r => r.device != null && r.section == null)
    .sort((a, b) => DEVICE_ORDER.indexOf(a.device ?? '') - DEVICE_ORDER.indexOf(b.device ?? ''))
  const bySection = rows.filter(r => r.device != null && r.section != null && r.loads >= 5)
    .sort((a, b) => DEVICE_ORDER.indexOf(a.device ?? '') - DEVICE_ORDER.indexOf(b.device ?? '') || b.loads - a.loads)
  const lead = devices.find(r => r.device === 'phone') ?? all
  const summary = !lead || lead.loads === 0
    ? 'No reports yet (measured from Sep 27, 2026)'
    : `${lead.device === 'phone' ? 'Phones' : 'All loads'}: largest paint ${formatVital('lcp', lead.lcp_p75)} (${vitalRating('lcp', lead.lcp_p75) ?? 'no data'}), ${plural(lead.loads, 'load')}`
  return (
    <Fold title="Page speed" summary={summary}>
      <Box sx={{ px: 1.5, pb: 1 }}>
        {!all || all.loads === 0 ? (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>
            Nothing yet. Every production page load reports its timings when the reader leaves it,
            so this fills in as people visit.
          </Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', pt: 1, lineHeight: 1.45 }}>
              The 75th percentile of real page loads, the figure Google grades on. Largest paint is
              the big number: green under 2.5s, red over 4s.
            </Typography>
            {[...devices, all].map(r => (
              <MetricRow key={`d${r.device ?? 'all'}`} label={r.device == null ? 'All devices' : prettyId(r.device)}
                value={<VitalValue k="lcp" v={r.lcp_p75} />} sub={vitalsLine(r)} />
            ))}
            {bySection.length > 0 && <GroupLabel>By section</GroupLabel>}
            {bySection.map(r => (
              <MetricRow key={`s${r.device}|${r.section}`} label={`${prettyId(r.device ?? '')}, ${(r.section ?? '').toUpperCase()}`}
                value={<VitalValue k="lcp" v={r.lcp_p75} />} sub={vitalsLine(r)} />
            ))}
            {shifts && <ShiftRows shifts={shifts} />}
          </>
        )}
      </Box>
    </Fold>
  )
}

// ─── a card that folds ────────────────────────────────────────────────────────
//
// THE PAGE IS READ ON A PHONE, and nine cards stacked open was a scroll through every table to
// reach the one wanted. Each card now has a header that says its answer in one line (the summary)
// and opens on a tap, so the Audience group reads as a list of headlines first and a set of tables
// second. The first few cards open by default because they are what the page is visited for.
// The whole header is the button, not a chevron in a corner, since it is a thumb that presses it.
function Fold({ title, summary, defaultOpen = false, children }: {
  title: string
  summary?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const pending = useContext(RangePending)
  return (
    <Box aria-busy={pending || undefined} sx={{ mb: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'outline', overflow: 'hidden' }}>
      <Box
        component="button" type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        sx={{
          all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, lineHeight: 1.25 }}>{title}</Typography>
          {summary != null && (
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.35, mt: 0.25 }}>
              {pending ? 'Loading' : summary}
            </Typography>
          )}
        </Box>
        <ExpandMore sx={{
          fontSize: '1.2rem', color: 'text.disabled', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease',
        }} />
      </Box>
      {open && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', visibility: pending ? 'hidden' : undefined }}>{children}</Box>}
    </Box>
  )
}

/** A label on the left, the number that matters on the right, a quieter one under it. The one
 *  row shape the new cards share, sized for a thumb and a phone's width. */
function MetricRow({ label, value, sub, bar }: {
  label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; bar?: React.ReactNode
}) {
  return (
    <Box sx={{ py: 0.8, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, flex: 1, minWidth: 0 }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      </Box>
      {bar && <Box sx={{ mt: 0.5 }}>{bar}</Box>}
      {sub && <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.35 }}>{sub}</Typography>}
    </Box>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.62rem', fontWeight: 800, letterSpacing: typePx(1), textTransform: 'uppercase',
      color: 'text.disabled', mt: 1.25, mb: 0.25,
    }}>{children}</Typography>
  )
}

// ─── today ───────────────────────────────────────────────────────────────────
//
// The first thing on the page, and the only card that answers "is today unusual". Fixed to today
// in the owner's zone, so it sits ABOVE the range chips it ignores. Browsers are judged against the
// same hours of the last seven days (a morning against mornings), and new, returning and engaged
// say what kind of day it is: on Nov 10, 2026, 106 browsers was six times a normal day, and 91 of
// them were new and only 19 did anything. Below that, only what needs the owner: error screens on
// the running deploy, a pipeline that is not green, feedback waiting. A quiet day shows none.

export interface TodayAlert { key: string; label: string; text: string; tone: 'warn' | 'bad' | 'info'; onOpen?: () => void }
// Holds a sub-line's height while there is nothing to put in it, so the card does not move on load.
const NBSP = ' '
const TONE_COLOR: Record<TodayAlert['tone'], string> = { bad: 'error.main', warn: 'warning.main', info: 'primary.main' }

function TodayStat({ label, value, badge, sub }: { label: string; value: string; badge?: React.ReactNode; sub: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: typePx(0.8), textTransform: 'uppercase', color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        {badge}
      </Box>
      <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', mt: 0.2 }}>{sub}</Typography>
    </Box>
  )
}

function TodayCard({ b, ready, alerts }: { b: Briefing; ready: boolean; alerts: TodayAlert[] }) {
  const pace = todayPace(b.browsers, b.pace.median)
  const sources = useMemo(() => groupSources(b.sources).slice(0, 4), [b.sources])
  const n = (v: number) => (ready ? formatCount(v) : '—')
  return (
    <Box sx={{ mb: 2, borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', px: 1.5, pt: 1.1, pb: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.8 }}>
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>Today</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{b.date ? shortDate(b.date) : ''}</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mt: 0.75 }}>
        <TodayStat label="Browsers" value={n(b.browsers)}
          badge={ready && pace ? (
            <Typography component="span" sx={{
              fontSize: '0.72rem', fontWeight: 800,
              color: pace.unusual ? (pace.multiple >= 1 ? 'warning.main' : 'error.main') : 'text.secondary',
            }}>{formatMultiple(pace.multiple)}</Typography>
          ) : undefined}
          sub={b.pace.median != null ? `Median by now: ${Math.round(b.pace.median)}` : NBSP} />
        <TodayStat label="New" value={n(b.new)} sub={ready ? `${formatCount(b.browsers - b.new)} returning` : NBSP} />
        <TodayStat label="Engaged" value={n(b.engaged)} sub={ready ? `${formatShare(b.engaged, b.browsers)} of browsers` : NBSP} />
      </Box>
      <Box sx={{ mt: 1 }}>
        <TodayLine label="Sources" text={!b.sources_since
          ? 'Not recorded yet'
          : sources.length === 0 ? 'No landings yet' : sources.map(s => `${s.label} ${s.browsers}`).join(' · ')} />
        {alerts.map(a => <TodayLine key={a.key} label={a.label} text={a.text} tone={a.tone} onOpen={a.onOpen} />)}
      </Box>
    </Box>
  )
}

function TodayLine({ label, text, tone, onOpen }: { label: string; text: string; tone?: TodayAlert['tone']; onOpen?: () => void }) {
  return (
    <Box {...(onOpen ? pressable(onOpen) : {})} sx={{
      display: 'flex', alignItems: 'baseline', gap: 1, py: 0.6,
      borderTop: '1px solid', borderColor: 'divider',
      cursor: onOpen ? 'pointer' : 'default', '&:hover': onOpen ? { bgcolor: 'action.hover' } : undefined,
    }}>
      {tone && <Box aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TONE_COLOR[tone], flexShrink: 0, alignSelf: 'center' }} />}
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', minWidth: 0, overflowWrap: 'anywhere' }}>{text}</Typography>
      {onOpen && <Typography aria-hidden sx={{ ml: 'auto', fontSize: '0.85rem', color: 'text.secondary' }}>›</Typography>}
    </Box>
  )
}

// ─── since launch ────────────────────────────────────────────────────────────
//
// Every day since the first event, from `events_daily` (whose all-events rows are true distinct
// browsers, counted before the raw rows go at 90 days). The range chips stop at 90 days and at the
// raw rows; this is the one view of the whole history. Days are UTC, as the rollup stores them,
// and it ends yesterday. The faint line is each day, the solid one its 7-day mean.

function TrendChart({ series }: { series: DayPoint[] }) {
  const W = 640, H = 120, PAD = 6
  const vals = series.map(d => d.browsers)
  const mean = rollingMean(vals)
  const max = Math.max(1, ...vals)
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : W / 2)
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - v / max)
  const daily = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const avg = mean.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')
  if (series.length < 2) {
    return <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', px: 1.5, py: 2 }}>No days rolled up yet.</Typography>
  }
  const peak = series[vals.indexOf(Math.max(...vals))]
  return (
    <Box sx={{ px: 1.5, py: 1.25 }}>
      <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`Browsers per day from ${series[0].date} to ${series[series.length - 1].date}, peak ${peak.browsers} on ${peak.date}`}
        sx={{ width: '100%', height: 120, display: 'block', color: 'text.disabled' }}>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} x2={W} y1={PAD + (H - PAD * 2) * f} y2={PAD + (H - PAD * 2) * f}
            stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={daily} fill="none" stroke="#f59e0b" strokeOpacity={0.35} strokeWidth={1.5}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {avg && <polyline points={avg} fill="none" stroke="#f59e0b" strokeWidth={2.5}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{shortDate(series[0].date)}</Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>Browsers per UTC day · 7-day mean · peak {formatCount(peak.browsers)}</Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{shortDate(series[series.length - 1].date)}</Typography>
      </Box>
    </Box>
  )
}

/** "24 a day over the last 7, +12% on the 7 before". Null under two weeks of days. */
function trendSummary(series: DayPoint[]): string | null {
  if (series.length < 14) return null
  const sum = (a: DayPoint[]) => a.reduce((n, d) => n + d.browsers, 0)
  const last = sum(series.slice(-7)) / 7, before = sum(series.slice(-14, -7)) / 7
  return `${Math.round(last)} a day over the last 7 · ${formatDelta(deltaPct(last, before))} on the 7 before`
}

// ─── sources ─────────────────────────────────────────────────────────────────
//
// Where page loads came from (the `landed` event, from Nov 11, 2026), each with the share of its
// browsers that went on to do something within half an hour. A source that sends many browsers
// and few that do anything is either the wrong audience or a crawler the filter does not know yet.
// Ignores the league chips: a landing is before the reader has picked a section.

function SourcesCard({ src, days }: { src: TrafficSources; days: number }) {
  const groups = useMemo(() => groupSources(src.sources), [src.sources])
  const maxG = Math.max(1, ...groups.map(g => g.browsers))
  const maxR = Math.max(1, ...src.routes.map(r => r.browsers))
  const lead = groups[0]
  const summary = !src.since
    ? 'Recorded from Nov 11, 2026'
    : !lead ? `No landings ${rangeLabel(days)}`
      : `${lead.label}: ${plural(lead.browsers, 'browser')}, ${formatShare(lead.engaged, lead.browsers)} engaged`
  return (
    <Fold title="Sources" summary={summary}>
      <Box sx={{ px: 1.5, pb: 1 }}>
        {groups.length === 0 ? (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1.5 }}>No landings in this range.</Typography>
        ) : (<>
          {groups.map(g => (
            <MetricRow key={g.label} label={g.label} value={formatCount(g.browsers)}
              bar={<Bar value={g.browsers} max={maxG} color="#60a5fa" />}
              sub={`${plural(g.loads, 'load')} · ${formatCount(g.new)} new · ${formatShare(g.engaged, g.browsers)} engaged`} />
          ))}
          <GroupLabel>Landing pages</GroupLabel>
          {src.routes.map(r => (
            <MetricRow key={r.route} label={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{r.route}</Box>}
              value={formatCount(r.browsers)} bar={<Bar value={r.browsers} max={maxR} color="#a78bfa" />}
              sub={`${plural(r.loads, 'load')} · ${formatShare(r.engaged, r.browsers)} engaged`} />
          ))}
        </>)}
      </Box>
    </Fold>
  )
}

// ─── return rate ─────────────────────────────────────────────────────────────
//
// Each week's new browsers, and how many came back on another day within 7 days. Only complete
// weeks (every browser in it has had its 7 days), and none within two weeks of the 90-day history
// line, where "first seen" mostly means "first seen since the raw rows began". "Engaged" here is
// the share that did something on their first day, which is what separates a reader from a page
// that was only rendered.

function ReturnCard({ a }: { a: Audience }) {
  const rows = a.cohorts
  const total = rows.reduce((n, c) => n + c.new, 0)
  const back = rows.reduce((n, c) => n + c.back, 0)
  const summary = rows.length === 0
    ? 'No complete weeks yet'
    : `${formatShare(back, total)} back within 7 days · ${formatCount(total)} new browsers over ${plural(rows.length, 'week')}`
  const maxShare = Math.max(0.01, ...rows.map(c => (c.new ? c.back / c.new : 0)))
  return (
    <Fold title="Return rate" summary={summary}>
      <Box sx={{ px: 1.5, pb: 1 }}>
        {rows.length === 0 ? (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1.5 }}>No complete weeks yet.</Typography>
        ) : [...rows].reverse().map(c => (
          <MetricRow key={c.week} label={`Week of ${shortDate(c.week)}`}
            value={formatShare(c.back, c.new)}
            bar={<Bar value={c.new ? c.back / c.new : 0} max={maxShare} color="#22c55e" />}
            sub={`${formatCount(c.back)} of ${formatCount(c.new)} new · ${formatShare(c.engaged, c.new)} engaged on day one`} />
        ))}
      </Box>
    </Fold>
  )
}

// ─── the page ─────────────────────────────────────────────────────────────────

/**
 * The group, range and league live in the address (`/admin?tab=health`, `?range=7&league=wpbl`),
 * so a refresh, or a link from a Discord alert, opens where it means to rather than on Audience at
 * 30 days. Replaced, never pushed: Back leaves the panel instead of stepping through filters.
 */
function readAdminQuery(): { group: Group; days: number; league: LeagueFilter } {
  const q = new URLSearchParams(window.location.search)
  const g = q.get('tab')
  const d = Number(q.get('range'))
  const l = q.get('league')
  return {
    group: GROUPS.some(x => x.value === g) ? g as Group : 'audience',
    days: RANGES.some(r => r.days === d) ? d : 30,
    league: LEAGUES.some(x => x.value === l) ? l as LeagueFilter : 'all',
  }
}

export default function AdminPage() {
  const [initial] = useState(readAdminQuery)
  const [group, setGroup]   = useState<Group>(initial.group)
  const [days, setDays]     = useState<number>(initial.days)
  const [league, setLeague] = useState<LeagueFilter>(initial.league)
  useEffect(() => {
    const q = new URLSearchParams()
    if (group !== 'audience') q.set('tab', group)
    if (group === 'audience' && days !== 30) q.set('range', String(days))
    if (group === 'audience' && league !== 'all') q.set('league', league)
    const search = q.toString()
    const next = window.location.pathname + (search ? `?${search}` : '') + window.location.hash
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [group, days, league])
  const [data, setData]     = useState<AnalyticsBundle>(EMPTY_BUNDLE)
  const [loading, setLoading] = useState(true)
  // Long tail: 28 event names and counting, most of them near-zero. Show the head, and keep
  // the rest one tap away rather than making the card scroll past everything else on the page.
  const [allEvents, setAllEvents] = useState(false)
  const [allBoards, setAllBoards] = useState(false)
  const tz = useMemo(() => localTz(), [])
  // Read once for the whole page, not per group: the header strip summarizes it from
  // wherever you are, so it cannot wait for the Health group to mount.
  const health = useOpsHealth()
  const feedbackNew = useOpenFeedback()
  const healthTone = health.loading ? 'ok' : healthSummary(health).worst

  const load = useCallback(() => {
    setLoading(true)
    let live = true
    fetchAnalytics(days, league, tz).then(d => { if (live) { setData(d); setLoading(false) } })
    return () => { live = false }
  }, [days, league, tz])

  useEffect(() => load(), [load])

  // Today and the since-launch trend ignore the range chips, so they load on their own: changing
  // the range must not re-read them, and Refresh must.
  const [briefing, setBriefing] = useState<Briefing>(EMPTY_BRIEFING)
  const [briefingReady, setBriefingReady] = useState(false)
  const [briefingNonce, setBriefingNonce] = useState(0)
  useEffect(() => {
    let live = true
    fetchBriefing(tz, runningBuild()).then(b => { if (live) { setBriefing(b); setBriefingReady(true) } })
    return () => { live = false }
  }, [tz, briefingNonce])
  const [trend, setTrend] = useState<DayPoint[]>([])
  useEffect(() => {
    let live = true
    fetchDailyTrend(league).then(t => { if (live) setTrend(t) })
    return () => { live = false }
  }, [league, briefingNonce])

  // What needs the owner, in the order it does. Only what is true today is listed.
  const alerts = useMemo<TodayAlert[]>(() => {
    const out: TodayAlert[] = []
    const e = briefing.errors
    if ((e.on_build ?? 0) > 0 || e.today > 0) {
      const parts = [
        e.on_build ? `${e.on_build} on this deploy` : null,
        e.today ? `${e.today} today, ${plural(e.today_browsers, 'browser')}` : null,
        e.last_message ? `"${e.last_message.slice(0, 80)}"` : null,
      ].filter(Boolean)
      out.push({ key: 'errors', label: 'Error screens', text: parts.join(' · '), tone: 'bad' })
    }
    // Pipelines are not repeated here: the strip above every group names the ones that need a look.
    if (feedbackNew) out.push({ key: 'feedback', label: 'Feedback', text: `${feedbackNew} new`, tone: 'info', onOpen: () => setGroup('tools') })
    return out
  }, [briefing.errors, feedbackNew])

  const { overview, events, tabs, statsBoards, entryPoints, search, palette, players, growth, pages, vitals, mlb, audience, sources, funnels: funnelCounts } = data
  const t = overview.totals, p = overview.prev
  const at = audience.totals, ap = audience.prev
  // Raw rows go at 90 days, so a range that starts within two weeks of the oldest one counts
  // anyone last seen before it as new. The Returning tile says so rather than reading low.
  const firstSeenSince = audience.history_from
    && (Date.now() - new Date(`${audience.history_from}T00:00:00`).getTime()) / 86_400_000 < days + 14
    ? audience.history_from : null

  // A range that reaches back before the first event would otherwise pad the chart with
  // blank days and quietly overstate how long we've been measuring.
  const firstEvent = overview.first_event
  const shortHistory = firstEvent
    ? (Date.now() - new Date(`${firstEvent}T00:00:00`).getTime()) / 86_400_000 < days
    : false

  // Whether the previous-window deltas are worth drawing at all. See the note beside the
  // tiles. Only the Today range is partial enough for them to mislead.
  const comparable = days > 1

  const maxPlayer = Math.max(1, ...players.map(x => x.opens))
  const maxBoard = Math.max(1, ...statsBoards.boards.map(b => b.events))
  // Entry points are grouped by destination, and each group gets its OWN scale: the three
  // destinations differ by an order of magnitude, so a shared one would flatten the smaller
  // two into empty tracks and hide the only thing this card is for, which is the mix inside
  // each destination rather than the sizes of the three against each other.
  const entrySources = entryPoints.sources
  const entryByDest = useMemo(() => {
    const m = new Map<string, typeof entrySources>()
    for (const r of entrySources) m.set(r.dest, [...(m.get(r.dest) ?? []), r])
    return m
  }, [entrySources])
  // Tab views are grouped into one stacked bar per tab, so the segments share a scale: the
  // busiest tab's TOTAL. Scaling each segment to the largest single segment instead would
  // let a three-way split (stats: 472 + 190 + 113) add up past the full width of its track.
  const tabTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tabs) m.set(t.view, (m.get(t.view) ?? 0) + t.events)
    return m
  }, [tabs])
  const maxTab = Math.max(1, ...tabTotals.values())

  const funnels = useMemo(() => buildFunnels(funnelCounts).sort((a, b) => b.seen - a.seen), [funnelCounts])
  // The card's headline is the card that CONVERTS best, not the one seen most: reach is mostly a
  // function of where on Home a card sits, and the rate is what a change to a card can move.
  const bestFunnel = useMemo(() => [...funnels].sort((a, b) => b.used / b.seen - a.used / a.seen)[0], [funnels])
  const [allActions, setAllActions] = useState(false)
  const actions = useMemo(() => groupActions(events), [events])
  // The offseason pages card, one block per page, pages ordered by how many browsers reached any
  // section of them. Built here so the card's own summary line can name the busiest page.
  const pageBlocks = useMemo(() => {
    const ids = new Set([...pages.sections, ...pages.opens, ...pages.controls].map(r => r.page))
    return [...ids].map(page => {
      const sections = pages.sections.filter(r => r.page === page)
      const opens = pages.opens.filter(r => r.page === page)
      const controls = pages.controls.filter(r => r.page === page)
      const reach = Math.max(0, ...sections.map(r => r.browsers), ...opens.map(r => r.browsers), ...controls.map(r => r.browsers))
      return { page, label: PAGE_LABELS[page] ?? prettyId(page), sections, opens, controls, reach }
    }).sort((a, b) => b.reach - a.reach)
  }, [pages])
  // MLB cards ordered by how many browsers USED them: reach is mostly where a card sits on Home,
  // and the question the alignment asks is which ones earn their place.
  const mlbCards = useMemo(() => [...mlb.cards].sort((a, b) => b.used - a.used || b.seen - a.seen), [mlb.cards])
  const mlbTabs = mlb.tabs
  const mlbTabViews = useMemo(() => {
    const m = new Map<string, { total: number; rows: typeof mlbTabs }>()
    for (const r of mlbTabs) {
      const cur = m.get(r.view) ?? { total: 0, rows: [] }
      m.set(r.view, { total: cur.total + r.events, rows: [...cur.rows, r] })
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [mlbTabs])
  const busiestTabs = useMemo(() => [...tabTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), [tabTotals])

  return (
    <Box sx={{ maxWidth: ADMIN_WIDE, mx: 'auto', px: { xs: 1.5, sm: 3 }, pb: 6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography component="h1" sx={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: typePx(-0.2) }}>Admin</Typography>
        <Box sx={{ px: 0.9, py: 0.15, borderRadius: 999, border: '1px solid', borderColor: 'outline' }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary', letterSpacing: typePx(0.6) }}>OWNER</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {(loading || health.loading) && <CircularProgress size={14} aria-label="Loading" />}
          <IconButton size="small" onClick={() => { load(); health.reload(); setBriefingNonce(x => x + 1) }} sx={{ color: 'text.secondary' }} aria-label="Refresh">
            <Refresh sx={{ fontSize: '1.1rem' }} />
          </IconButton>
        </Box>
      </Box>

      {/* THE TABS, AND ON AUDIENCE ITS FILTERS, PINNED. The range and the league decide every
          number below them, and on a 20-card page they used to scroll away after the first
          screen, so a reader three cards down could not see which range they were reading. */}
      <Box sx={{
        position: 'sticky', top: 'var(--app-header-h, 0px)', zIndex: 6, mb: 2,
        bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box>
          <Box>
            <PageTabs mb={0} value={group} onChange={v => setGroup(v as Group)} options={GROUPS.map(g => ({
              value: g.value, label: g.label,
              ...(g.value === 'health' && healthTone !== 'ok' ? {
                adornment: <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 7, height: 7, ml: 0.6, borderRadius: '50%', bgcolor: healthTone === 'bad' ? 'error.main' : 'warning.main', verticalAlign: 'middle' }} />,
                ariaLabel: `Health, ${healthTone === 'bad' ? 'a pipeline failed' : 'a pipeline needs a look'}`,
              } : {}),
              ...(g.value === 'tools' && feedbackNew ? {
                adornment: <Box component="span" aria-hidden sx={{ ml: 0.6, px: 0.6, borderRadius: 999, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: '0.62rem', fontWeight: 800, verticalAlign: 'middle' }}>{feedbackNew}</Box>,
                ariaLabel: `Tools, ${feedbackNew} new feedback`,
              } : {}),
            }))} />
          </Box>
        </Box>
        {group === 'audience' && (
          // One row that scrolls sideways on a phone rather than wrapping: two rows of chips
          // pinned over a phone's page is a fifth of the screen.
          <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'center', py: 1, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
            {RANGES.map(r => (
              <Chip key={r.days} label={r.label} active={days === r.days} onClick={() => setDays(r.days)} />
            ))}
            <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.5, mx: 0.5, bgcolor: 'divider', flexShrink: 0 }} />
            {LEAGUES.map(l => (
              <Chip key={l.value} label={l.label} active={league === l.value} onClick={() => setLeague(l.value)} />
            ))}
            <Box sx={{ ml: 'auto', display: { xs: 'none', md: 'flex' }, gap: 1.5, pl: 2, flexShrink: 0 }}>
              {SECTIONS.map(sec => (
                <Box key={sec.id} component="a" href={`#admin-${sec.id}`}
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); document.getElementById(`admin-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                  sx={{ fontSize: '0.74rem', fontWeight: 700, color: 'text.secondary', textDecoration: 'none', whiteSpace: 'nowrap', '&:hover': { color: 'text.primary' } }}>
                  {sec.title}
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* Pipeline health follows you across groups. It is the only thing on this page that is
          ever urgent. Redundant on the Health group, which is the same states with their detail,
          so it steps aside there. */}
      {group !== 'health' && <HealthStrip health={health} onOpen={() => setGroup('health')} />}

      {group === 'audience' && (<>
      <TodayCard b={briefing} ready={briefingReady} alerts={alerts} />

      <RangePending.Provider value={loading && data === EMPTY_BUNDLE}>

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
          Events only go back to {shortDate(firstEvent)}. The chart starts where the data does,
          and the previous-window deltas have nothing to compare against yet.
        </Typography>
      )}

      {/* ── headline tiles ─────────────────────────────────────────────── */}
      {/* Three, each a different question about the range: how many, how many came back, how
          many did anything. "Signed in" sat here until Nov 11, 2026; at 0 to 5 users a day it
          moved with nothing anyone did, and it is under Accounts now. "Active browsers" was the
          fixed today / 7d / 30d read, which the Today card above answers better. Events are not
          a headline either: a deploy that adds event names moves them. */}
      <Box sx={{
        display: 'grid', gap: 1, mb: 2.5,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
      }}>
        <Tile label="Browsers" value={formatCount(t.browsers)}
          delta={comparable ? deltaPct(t.browsers, p.browsers) : undefined}
          sub={rangeLabel(days)} />
        <Tile label="Returning" value={formatCount(at.browsers - at.new)}
          delta={comparable ? deltaPct(at.browsers - at.new, ap.browsers - ap.new) : undefined}
          sub={firstSeenSince ? `${formatCount(at.new)} new · first seen since ${shortDate(firstSeenSince)}` : `${formatCount(at.new)} new`} />
        <Box sx={{ gridColumn: { xs: 'span 2', sm: 'auto' }, display: 'grid' }}>
        <Tile label="Engaged" value={formatCount(at.engaged)}
          delta={comparable ? deltaPct(at.engaged, ap.engaged) : undefined}
          sub={`${formatShare(at.engaged, at.browsers)} of browsers`} />
        </Box>
      </Box>

      <SectionHead id="traffic" />
      {/* ── activity ───────────────────────────────────────────────────── */}
      <Fold title="Activity" defaultOpen
        summary={`${formatCount(t.browsers)} browsers, ${formatCount(t.events)} events ${rangeLabel(days)}`}>
        <ActivityChart series={overview.series} tz={overview.tz || tz} />
      </Fold>

      <SectionGrid>
      <Fold title="Since launch" summary={trendSummary(trend) ?? 'Fills in as days are rolled up'}>
        <TrendChart series={trend} />
      </Fold>

      <SourcesCard src={sources} days={days} />

      <ReturnCard a={audience} />

      </SectionGrid>

      <SectionHead id="used" />
      <SectionGrid>
      {/* ── Home cards: seen, then used ──────────────────────────────────── */}
      {/* The six impressions that used to head the Events card, each read against the action
          that says its card worked. See HOME_FUNNELS for what counts as a use. */}
      <Fold title="Home cards: seen, then used" defaultOpen
        summary={!bestFunnel ? 'Nothing shown in this range'
          : `Best: ${bestFunnel.label}, ${formatShare(bestFunnel.used, bestFunnel.seen)} of those who saw it`}>
        <Box sx={{ px: 1.5, py: 0.5 }}>
          {funnels.length === 0 ? (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>No Home cards shown in this range.</Typography>
          ) : funnels.map(f => (
            <MetricRow key={f.label} label={f.label}
              value={formatShare(f.used, f.seen)}
              bar={<Bar value={f.used} max={f.seen} color="#22c55e" />}
              sub={`${f.used.toLocaleString()} of ${f.seen.toLocaleString()} browsers that saw it ${f.verb}`} />
          ))}
        </Box>
      </Fold>


      {/* ── what people do ───────────────────────────────────────────────── */}
      <Fold title="What people do" defaultOpen
        summary={actions.length === 0 ? 'No actions in this range'
          : `${actions[0].rows[0].label}: ${formatCount(actions[0].rows[0].browsers)} browsers`}>
        <Box sx={{ px: 1.5, pb: 1 }}>
          {actions.length === 0 ? (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>No actions in this range.</Typography>
          ) : actions.map(g => (
            <Box key={g.group}>
              <GroupLabel>{g.group}</GroupLabel>
              {(allActions ? g.rows : g.rows.slice(0, ACTIONS_PER_GROUP)).map(r => (
                <MetricRow key={r.event} label={r.label}
                  value={<>
                    {formatCount(r.browsers)}
                    {comparable && <Box component="span" sx={{ display: 'inline-block', minWidth: 42, textAlign: 'right' }}>
                      <Delta pct={deltaPct(r.browsers, r.prev_browsers)} />
                    </Box>}
                  </>}
                  sub={`${plural(r.browsers, 'browser')} · ${plural(r.events, 'time')}`} />
              ))}
            </Box>
          ))}
          {actions.some(g => g.rows.length > ACTIONS_PER_GROUP) && (
            <Box
              onClick={() => setAllActions(v => !v)}
              role="button" tabIndex={0}
              onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setAllActions(v => !v) } }}
              sx={{
                mt: 0.5, py: 0.9, textAlign: 'center', cursor: 'pointer', userSelect: 'none',
                borderTop: '1px solid', borderColor: 'divider',
                fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', '&:hover': { color: 'text.primary' },
              }}
            >
              {allActions ? 'Top three per area' : `Show all ${actions.reduce((n, g) => n + g.rows.length, 0)} actions`}
            </Box>
          )}
        </Box>
      </Fold>

      {/* ── offseason pages ──────────────────────────────────────────────── */}
      {/* The standalone pages, where the offseason's readers are. Instrumented Sep 25, 2026. */}
      <Fold title="Offseason pages" defaultOpen
        summary={pageBlocks.length === 0 ? 'No page activity yet (tracked from Sep 25, 2026)'
          : `${pageBlocks[0].label} leads, ${plural(pageBlocks[0].reach, 'browser')}`}>
        <Box sx={{ px: 1.5, pb: 1 }}>
          {pageBlocks.length === 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>
              Nothing yet. Sections reached, links followed and controls used on the season recap,
              gallery, Scorigami, About the league, Reading and the players page show here.
            </Typography>
          )}
          {pageBlocks.map(b => (
            <Box key={b.page}>
              <GroupLabel>{b.label}</GroupLabel>
              {b.sections.length > 0 && (
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 0.5 }}>Reached</Typography>
              )}
              {b.sections.map(r => (
                <MetricRow key={`s${r.section}`} label={prettyId(r.section)} value={formatCount(r.browsers)}
                  bar={<Bar value={r.browsers} max={b.reach} color="#60a5fa" />} />
              ))}
              {b.opens.length > 0 && (
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1 }}>Left for</Typography>
              )}
              {b.opens.map(r => (
                <MetricRow key={`o${r.section}|${r.kind}`} label={r.section === '—' ? prettyId(r.kind) : `${prettyId(r.section)} → ${r.kind}`}
                  value={formatCount(r.browsers)} sub={plural(r.events, 'time')} />
              ))}
              {b.controls.length > 0 && (
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1 }}>Used</Typography>
              )}
              {b.controls.map(r => (
                <MetricRow key={`c${r.control}`} label={prettyId(r.control)}
                  value={formatCount(r.browsers)} sub={plural(r.events, 'time')} />
              ))}
            </Box>
          ))}
        </Box>
      </Fold>

      {/* ── MLB ──────────────────────────────────────────────────────────── */}
      {/* What the MLB section's readers use, instrumented Sep 28, 2026 to decide what MLB keeps as
          it is aligned with WPBL (ROADMAP.md). Ignores the league chips: it is MLB by definition. */}
      <Fold title="MLB: what gets used"
        summary={mlbCards.length === 0 && mlbTabViews.length === 0 ? 'Nothing yet (tracked from Sep 28, 2026)'
          : mlbCards.length > 0 ? `${mlbCardLabel(mlbCards[0].card)} is the most used card, ${plural(mlbCards[0].used, 'browser')}`
          : `${mlbTabViews[0][0]} is the most visited tab`}>
        <Box sx={{ px: 1.5, pb: 1 }}>
          {mlbCards.length === 0 && mlbTabViews.length === 0 && mlb.opens.length === 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>
              Nothing yet. Home cards seen and used, how tabs are reached, and where players and teams
              are opened from show here.
            </Typography>
          )}
          {mlbCards.length > 0 && <GroupLabel>Home cards: used / seen, in browsers</GroupLabel>}
          {mlbCards.map(r => (
            <MetricRow key={r.card} label={mlbCardLabel(r.card)}
              value={`${formatCount(r.used)} / ${formatCount(r.seen)}`}
              sub={r.seen > 0 ? `${Math.round((r.used / r.seen) * 100)}% of those who saw it` : 'used without a recorded view'}
              bar={<Bar value={r.used} max={Math.max(1, r.seen)} color="#22c55e" />} />
          ))}
          {mlbTabViews.length > 0 && <GroupLabel>Tabs: how they're reached</GroupLabel>}
          {mlbTabViews.map(([view, v]) => (
            <MetricRow key={view} label={view} value={formatCount(v.total)}
              sub={v.rows.map(r => `${r.via} ${r.events}`).join(' · ')} />
          ))}
          {mlb.opens.length > 0 && <GroupLabel>Players and teams: opened from</GroupLabel>}
          {mlb.opens.map(r => (
            <MetricRow key={`${r.kind}|${r.from}`} label={`${r.kind === 'player' ? 'Player' : 'Team'} from ${r.from}`}
              value={formatCount(r.browsers)} sub={plural(r.events, 'time')} />
          ))}
        </Box>
      </Fold>

      </SectionGrid>

      <SectionHead id="finding" />
      <SectionGrid>
      {/* ── WPBL tabs ──────────────────────────────────────────────────── */}
      <Fold title="Tabs: how they're reached"
        summary={busiestTabs.length === 0 ? 'No tab switches in this range'
          : busiestTabs.map(([v, n]) => `${v} ${formatCount(n)}`).join(' · ')}>
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
      </Fold>

      {/* ── WPBL stats boards ──────────────────────────────────────────── */}
      {/* The tab above says people arrive at Stats; this says what they read once they're
          there. The axes are component state and never reach the URL, so this panel is the
          only place the answer exists. Cloudflare's path counts see one /wpbl either way. */}
      <Fold title="Stats: which board"
        summary={statsBoards.boards.length === 0 ? 'No board views in this range'
          : `${prettyBoard(statsBoards.boards[0].board)} leads, ${plural(statsBoards.boards[0].browsers, 'browser')}`}>
        {statsBoards.boards.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              No board views in this range. Instrumented Aug 20, 2026, so ranges reaching back
              past that are empty rather than quiet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 1 }}>
            {(allBoards ? statsBoards.boards : statsBoards.boards.slice(0, BOARD_HEAD)).map(b => (
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
            {statsBoards.boards.length > BOARD_HEAD && (
              <Box
                onClick={() => setAllBoards(v => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setAllBoards(v => !v) } }}
                sx={{
                  py: 0.9, textAlign: 'center', cursor: 'pointer', userSelect: 'none',
                  borderTop: '1px solid', borderColor: 'divider',
                  fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {allBoards ? 'Show fewer' : `Show all ${statsBoards.boards.length}`}
              </Box>
            )}

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
      </Fold>

      {/* ── how readers reach a page ───────────────────────────────────── */}
      {/* Player opens are the retention event and team pages are the deepest surface in the
          section, and both used to be one flat number. This is the `from` breakdown: which
          surface actually feeds each destination, and which ones are decoration. */}
      <Fold title="How readers reach games, players and teams"
        summary={entryPoints.sources.length === 0 ? 'No opens in this range'
          : `Top route: ${entryPoints.sources[0].dest}s from ${entryPoints.sources[0].from} (${formatCount(entryPoints.sources[0].events)})`}>
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
      </Fold>

      {/* ── header search ──────────────────────────────────────────────── */}
      {/* Search is in the header on every page in the section and produced no rows at all
          until Aug 25, 2026. The number that earns this card is `missed`: a query that found
          nothing is a reader who came for something specific and left without it, and it is
          the only list on this page that names a thing to go and fix. */}
      <Fold title="Search"
        summary={search.totals.searched === 0 ? 'No searches in this range'
          : `${formatCount(search.totals.searched)} searches, ${search.totals.empty} found nothing`}>
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
            {/* Picks are not a subset of searches: one query can lead to several result clicks,
                and a pick from the recent-searches list counts with no query at all. So the ratio
                can pass 100%, where a "%" reads like a bug ("Picked a result 111%"). Above parity
                it is shown as a multiple, which is what it actually is. */}
            <StatRow label="Picked a result" value={formatCount(search.totals.picked)}
              sub={search.totals.picked > search.totals.searched
                ? `${(search.totals.picked / search.totals.searched).toFixed(1)}× searches`
                : formatShare(search.totals.picked, search.totals.searched)} />

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
      </Fold>

      {/* ── the search box, both sections ─────────────────────────────── */}
      {/* Since Oct 14, 2026 the toolbar field opens the palette (CommandPalette.tsx) in both
          sections, and this is its funnel: how it is reached, what is taken from it and from how
          far down, and how often it is closed with nothing. The card above still counts WPBL's
          searches and picks, which the palette's rows fire unchanged. */}
      <Fold title="Search box"
        summary={palettePicked(palette) === 0 && paletteOpened(palette) === 0 ? 'Not opened in this range'
          : `${formatCount(paletteOpened(palette))} opens, ${formatShare(palettePicked(palette), paletteOpened(palette))} ended in a pick`}>
        {palette.sections.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
              Not opened in this range. The search became this box on Oct 14, 2026, so ranges
              reaching back past that are empty rather than quiet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 0.5 }}>
            {palette.sections.map(sec => {
              const via = palette.via.filter(v => v.section === sec.section)
              const picks = palette.picks.filter(p => p.section === sec.section)
              const finder = palette.finder.filter(f => f.section === sec.section)
              const missed = (palette.missed ?? []).filter(m => m.section === sec.section)
              return (
                <Box key={sec.section} sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 0.5, mb: 0.25, textTransform: 'uppercase' }}>
                    {sec.section}
                  </Typography>
                  <StatRow label="Opened" value={formatCount(sec.opened)} sub={plural(sec.opened_browsers, 'browser')} />
                  <StatRow label="Ended in a pick" value={formatCount(sec.picked)}
                    sub={`${formatShare(sec.picked, sec.opened)} · ${formatShare(sec.picked_browsers, sec.opened_browsers)} of browsers`} />
                  {/* Typed something and left anyway is the number to watch; offered nothing at
                      all is the subset where the search had no answer to give. */}
                  <StatRow label="Closed with nothing" value={formatCount(sec.dismissed)}
                    sub={`${sec.dismissed_typed} after typing, ${sec.dismissed_empty} offered nothing`} />
                  {sec.recents_cleared > 0 && (
                    <StatRow label="Cleared recents" value={formatCount(sec.recents_cleared)} />
                  )}
                  {via.length > 0 && (
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.75 }}>
                      opened from {via.map(v => `${v.via} ${v.events}`).join(' · ')}
                    </Typography>
                  )}
                  {/* `rank` counts from the top row as 0, so a low average says the ordering is
                      doing its job and a high one says readers scroll past something to reach it. */}
                  {picks.length > 0 && (
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                      picked {picks.map(p => `${p.kind} ${p.events} (row ${p.avg_rank ?? '—'} avg, top ${formatShare(p.top, p.events)})`).join(' · ')}
                    </Typography>
                  )}
                  {/* Searches a typo would have lost, found by the forgiving pass (lib/fuzzyName.ts). */}
                  {picks.some(p => p.forgiving) && (
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                      saved by typo matching {picks.reduce((n, p) => n + (p.forgiving ?? 0), 0)} of {picks.filter(p => p.kind === 'result').reduce((n, p) => n + p.events, 0)} player and club picks
                    </Typography>
                  )}
                  {finder.length > 0 && (
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                      stat questions {finder.map(f => `${f.side} ${f.events}${f.clubs ? `, ${f.clubs} with a club` : ''}${f.ignored ? `, ${f.ignored} dropped a word` : ''}`).join(' · ')}
                    </Typography>
                  )}
                  {sec.section === 'wpbl' && palette.wpbl_questions.events > 0 && (
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                      {formatCount(palette.wpbl_questions.events)} searches read as a stat question, kept out of "Matched nothing"
                    </Typography>
                  )}
                  {/* The text is kept only for a close that was offered nothing, in both sections,
                      so each chip is a name or a spelling the search could not reach. */}
                  {missed.length > 0 && (
                    <>
                      <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', mt: 0.75, mb: 0.5 }}>
                        Offered nothing for
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                        {missed.map(x => (
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
              )
            })}
          </Box>
        )}
      </Fold>

      {/* ── top players ────────────────────────────────────────────────── */}
      <Fold title="Most-opened players"
        summary={players.length === 0 ? 'No player pages opened' : `${players[0].name} leads with ${players[0].opens}`}>
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
      </Fold>

      {/* The Discord invite funnel card lived here until Aug 25, 2026. The promo card it
          measured was retired from Home on Aug 19: impressions and dismissals froze that day
          while joins kept accruing from the footer link, so its rates were already drifting
          toward a "joined" share that would eventually pass 100%. A card that has to open by
          telling you not to read it is not a card. The run it recorded (8.3% of sessions that
          saw it joined) is in the WPBL roadmap's shipped log, and `admin_discord_funnel` is
          still there if the numbers are ever wanted again — it is just no longer a round trip
          on every load of this page. */}

      </SectionGrid>

      <SectionHead id="site" />
      <SectionGrid>
      <PageSpeedCard rows={vitals.rows} shifts={vitals.shifts} />

      {/* ── growth & notifications ─────────────────────────────────────── */}
      <Fold title="Accounts & notifications"
        summary={`${growth.total_users} users · ${growth.signups_window} signups ${rangeLabel(days)} · ${growth.push_users} on push`}>
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <StatRow label="Total users" sub={growth.deleted_users > 0 ? `${growth.deleted_users} deactivated` : undefined}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{growth.total_users}</Typography>} />
          <StatRow label="Signed-in browsers" sub={`${plural(t.users, 'user')} ${rangeLabel(days)}`}
            value={<Typography sx={{ fontSize: '0.88rem', fontWeight: 800 }}>{formatShare(t.signed_in_browsers, t.browsers)}</Typography>} />
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
      </Fold>

      {/* ── every event, raw ─────────────────────────────────────────────── */}
      {/* Everything the table holds, impressions and retired names included, for when a number
          above needs checking against its source. Closed by default: it is the long tail. */}
      <Fold title="All events" summary={`${events.length} names, including impressions and retired ones`}>
        <Box sx={{ px: 1.5, py: 0.5 }}>
          {events.length === 0 ? (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', py: 1.5 }}>No events in this range.</Typography>
          ) : (allEvents ? events : events.slice(0, EVENT_HEAD)).map(e => {
            const info = eventInfo(e.event)
            return (
              <MetricRow key={e.event}
                label={<>{info.label}{info.kind !== 'action' && (
                  <Box component="span" sx={{ ml: 0.75, fontSize: '0.6rem', fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase' }}>
                    {info.kind}
                  </Box>
                )}</>}
                value={<>{e.events.toLocaleString()}{comparable && (
                  <Box component="span" sx={{ display: 'inline-block', minWidth: 42, textAlign: 'right' }}>
                    <Delta pct={deltaPct(e.events, e.prev_events)} />
                  </Box>
                )}</>}
                sub={`${e.event} · ${plural(e.browsers, 'browser')} · ${plural(e.users, 'signed-in user')}`} />
            )
          })}
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
      </Fold>
      </SectionGrid>

      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', mt: 2 }}>
        "Browsers" counts distinct localStorage ids, not people: one person on a phone and a
        laptop is two, and clearing site data starts a new one. Day buckets are in {overview.tz || tz}.
        An event's count can also jump on the day it was instrumented rather than on the day
        behavior changed: search, team opens and the Game Center tabs all start Aug 25, 2026,
        and a window spanning that date is comparing a surface against its own silence.
      </Typography>
      </RangePending.Provider>
      </>)}

      {group === 'health' && <Box sx={{ maxWidth: ADMIN_NARROW }}><HealthGroup health={health} /></Box>}

      {group === 'tools' && <Box sx={{ maxWidth: ADMIN_NARROW }}><AdminTools /></Box>}

      {group === 'photos' && <AdminPhotos />}

      {group === 'clips' && <AdminClips />}

      {group === 'rosters' && <Box sx={{ maxWidth: ADMIN_NARROW }}><AdminRosterMoves /></Box>}

      {group === 'roadmap' && <Box sx={{ maxWidth: ADMIN_NARROW }}><AdminRoadmap /></Box>}
    </Box>
  )
}
