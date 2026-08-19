import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  fetchWpblAllPlayers, fetchWpblAllLines,
  getCachedWpblAllPlayers, getCachedWpblAllLines, wpblStatsCacheAgeMs,
} from './api'
import { WPBL_ACCENT, outsToIp, wpblFullName } from './constants'
import { TeamBadge, CARD_BORDER, pressable, FOCUS_RING, useWpblName } from './ui'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, wpblQualifiers, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'
// Two of the five Stats groups, behind their own chunks. Hitting and Pitching are what the
// tab opens on; Tracking (the TrackMan boards) and Draft (the draft-value model) are each a
// separate sub-tab with its own layout and neither is reachable without a deliberate tap.
const WpblTrackingView = lazy(() => import('./TrackingView'))
const WpblDraftValue = lazy(() => import('./DraftValue'))

// Complete season stat table for the WPBL — a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

// Rate-stat qualifiers come from stats.ts (`wpblQualifiers`) and scale with the season —
// single-sourced with the Home leader boards so the two can't drift apart.

// This tab has two independent axes, not one list of four tabs.
//
// `side` is which half of the game you're looking at. It's the reader's main choice and it
// outlives everything else: the season table splits on it, and so do the tracked boards.
// TrackingView used to carry its own Hitting/Pitching switch, which meant the same question
// was being asked twice one level apart — the clearest sign these were never four peers.
//
// `source` is where the numbers come from — the box scores we aggregate all season, or the
// feed's TrackMan radar. Switching it keeps your side, so "Pitching → Tracked" reads as the
// same subject measured another way rather than a jump somewhere else.
//
// 'draft' sits on neither axis on purpose: it's a one-off analysis of the draft class that
// spans both sides at once, so it's reached from a card under the table instead.
type Side = 'hitting' | 'pitching'
type Source = 'season' | 'tracked' | 'draft'
type Mode = 'players' | 'teams'

// The deep-link contract, unchanged — Home's leader cards ask for 'hitting'/'pitching' with a
// column, and a legacy ?view=tracking URL asks for 'tracking'. Resolved onto the axes above.
type Group = 'hitting' | 'pitching' | 'tracking' | 'draft'

// A tracking link names no side, so it lands on whichever one the reader already had open.
function axesOf(g: Group): { side?: Side; source: Source } {
  if (g === 'tracking') return { source: 'tracked' }
  if (g === 'draft') return { source: 'draft' }
  return { side: g, source: 'season' }
}

interface Col<T> {
  key: string
  label: string
  value: (t: T) => number | null      // sort value (null = sorts to the bottom)
  display?: (t: T) => string          // cell text (defaults to the value)
  rate?: boolean                      // rate stat → dash when null, eligible for the qualified filter
  lowerBetter?: boolean               // ERA/WHIP sort ascending by default
}

// Columns are ordered headline → secondary (not raw box-score order), so the stats a fan
// actually scans sit up front. With the sort column pinned on mobile, this is also the
// left-to-right scroll order right after it: slash line, then power/production, then the
// peripheral/volume tail (AB, G) last.
const HIT_COLS: Col<WpblBattingTotals>[] = [
  { key: 'avg', label: 'AVG', value: t => t.avg, display: t => fmtRate(t.avg), rate: true },
  { key: 'obp', label: 'OBP', value: t => t.obp, display: t => fmtRate(t.obp), rate: true },
  { key: 'slg', label: 'SLG', value: t => t.slg, display: t => fmtRate(t.slg), rate: true },
  { key: 'ops', label: 'OPS', value: t => t.ops, display: t => fmtRate(t.ops), rate: true },
  { key: 'hr',  label: 'HR',  value: t => t.hr },
  { key: 'rbi', label: 'RBI', value: t => t.rbi },
  { key: 'r',   label: 'R',   value: t => t.r },
  { key: 'h',   label: 'H',   value: t => t.h },
  { key: 'sb',  label: 'SB',  value: t => t.sb },
  { key: '2b',  label: '2B',  value: t => t.doubles },
  { key: '3b',  label: '3B',  value: t => t.triples },
  { key: 'bb',  label: 'BB',  value: t => t.bb },
  { key: 'so',  label: 'SO',  value: t => t.so },
  { key: 'ab',  label: 'AB',  value: t => t.ab },
  { key: 'g',   label: 'G',   value: t => t.g },
]

const PIT_COLS: Col<WpblPitchingTotals>[] = [
  { key: 'era',  label: 'ERA',  value: t => t.era,  display: t => fmtTwo(t.era),  rate: true, lowerBetter: true },
  { key: 'whip', label: 'WHIP', value: t => t.whip, display: t => fmtTwo(t.whip), rate: true, lowerBetter: true },
  { key: 'w',    label: 'W',    value: t => t.w },
  { key: 'l',    label: 'L',    value: t => t.l },
  { key: 'sv',   label: 'SV',   value: t => t.s },
  { key: 'so',   label: 'SO',   value: t => t.so },
  { key: 'ip',   label: 'IP',   value: t => t.outs, display: t => outsToIp(t.outs) },
  { key: 'h',    label: 'H',    value: t => t.h },
  { key: 'r',    label: 'R',    value: t => t.r },
  { key: 'er',   label: 'ER',   value: t => t.er },
  { key: 'bb',   label: 'BB',   value: t => t.bb },
  { key: 'hr',   label: 'HR',   value: t => t.hr },
  { key: 'g',    label: 'G',    value: t => t.g },
]

// Resolve a requested column into the sort state the table should adopt. Direction comes from
// the column itself (`lowerBetter` → ascending, so ERA/WHIP lead with the best), which is why
// a leader card only has to name a column and never a direction. An unknown or absent key
// falls back to the group's headline column — the first in each list.
function defaultSort(side: Side, key?: string): { key: string; asc: boolean } {
  const cols: Col<never>[] = (side === 'pitching' ? PIT_COLS : HIT_COLS) as unknown as Col<never>[]
  const col = (key ? cols.find(c => c.key === key) : undefined) ?? cols[0]
  return { key: col.key, asc: !!col.lowerBetter }
}

// One table row — normalized so the same table renders a player or a whole team.
interface Row {
  key: string
  team: WpblTeam | undefined       // for the badge (a player's club, or the team itself)
  label: string                    // player short name, or full team name
  shortLabel?: string              // teams mode on a phone: the nickname alone ('Firebells')
  sublabel?: string                // player position (players only)
  totals: WpblBattingTotals | WpblPitchingTotals
  qualified: boolean
  onClick?: () => void
}

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Zoom-aware: inside the desktop `zoom` wrapper vw units aren't shrunk, so divide by
// --app-zoom (defaults to 1 off desktop). Capped so it doesn't sprawl on huge monitors.
const FULL_BLEED_W = 'min(1100px, calc(100vw / var(--app-zoom, 1) - 24px))'
const fullBleedSx = {
  width: FULL_BLEED_W,
  position: 'relative',
  left: '50%',
  transform: 'translateX(-50%)',
} as const

// The same width, centred with a margin rather than left + transform. The control bar is the
// one full-bleed block here that also has to stick, and those two can't share a box: sticky
// spends `left` on its own threshold, and a transformed ancestor becomes the containing block
// for anything positioned inside it.
const fullBleedStickySx = {
  width: FULL_BLEED_W,
  marginLeft: `calc(50% - (${FULL_BLEED_W}) / 2)`,
} as const

// Shadow the frozen columns cast rightward onto the scrolling stats once you've scrolled
// off the left edge — the "these columns float over the rest" cue. The divider border
// carries the separation in dark mode where the shadow is faint.
const FROZEN_SHADOW = '6px 0 6px -4px rgba(0,0,0,0.25)'

// Fixed width of the frozen Player column on mobile, so the pinned sort-value column can
// sit flush against it with a constant `left` — no measurement to drift and let the two
// frozen columns overlap the name when scrolled. Names ellipsize within it.
const NAME_W = 150
const NAME_INNER_MAX = 84 // NAME_W minus rank + badge + gaps + padding, so the column can't grow past NAME_W
// Teams mode gets a narrower frozen column. There are only four rows, each with a distinct
// badge, and the nickname alone identifies them — so the width a player's full name needs is
// dead space here, and every pixel of it is a stat column pushed off a phone screen.
// No rank number in this mode (see the row), so the budget is padding + badge + gap + label.
const TEAM_NAME_W = 104
const TEAM_NAME_INNER_MAX = 62

/** What the table should be showing, when it's opened from somewhere else (a Home leader
 *  card's "View all"). `token` increments on every such jump — see the effect below. */
export interface WpblStatsFocus {
  group: Group
  sortKey?: string  // a HIT_COLS / PIT_COLS key; falls back to the group's default column
  /** 'teams' opens the four-team comparison instead of the player board. */
  mode?: Mode
  /** Pre-select the team filter chip (players mode only). null clears it. */
  teamId?: string | null
  token: number     // 0 = nothing requested yet
}

// Placeholder while a sub-tab's chunk arrives. These views render in place under the group
// bar, so a centred spinner in the content area is what the reader already sees while their
// data loads — the switch reads as slow rather than broken.
function SubViewFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={26} sx={{ color: 'var(--wpbl-accent-fg)' }} />
    </Box>
  )
}

export default function WpblStatsView({ teams, games, focus, onOpenPlayer, onOpenTeam }: {
  teams: WpblTeam[]
  games: WpblGame[]
  focus?: WpblStatsFocus
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of flashing the spinner.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [loading, setLoading] = useState(() => getCachedWpblAllPlayers() == null || getCachedWpblAllLines() == null)
  // The name column is a fixed 84px, so the default character threshold is the wrong test —
  // it let a 12-character "Jamie Mackay" through whole to be cut to "Jamie Mac…" while a
  // 13-character "Denae Benites" became "D. Benites". 0 abbreviates every phone row alike.
  const shortName = useWpblName(0)
  const isNarrow = useMediaQuery('(max-width:600px)')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Horizontal-scroll edges — drive the frozen-column shadow (not at start) and the
  // right-edge fade (not at end), so it's obvious the table scrolls sideways.
  const [scrollX, setScrollX] = useState({ atStart: true, atEnd: true })

  // A deep link picks the starting axes; everything else defaults to the season hitting table.
  const seedAxes = axesOf(focus?.group ?? 'hitting')
  // A tracking link names no side, so in-session it keeps whichever one the reader had. On a
  // cold load there's nothing to keep, and an old ?view=tracking bookmark used to open on the
  // velocity boards — so seed those rather than dropping it somewhere it has never been.
  const [side, setSide] = useState<Side>(seedAxes.side ?? (seedAxes.source === 'tracked' ? 'pitching' : 'hitting'))
  const [source, setSource] = useState<Source>(seedAxes.source)
  const [mode, setMode] = useState<Mode>('players')
  const [teamId, setTeamId] = useState<string | null>(null)
  // The 5 AB / 3 IP qualifier only defaults on once every team has played 2+ games;
  // before that it would hide nearly everyone, so the complete table shows by default.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  // The position each player has actually been playing, for the leaderboard sublabels.
  const positionIndex = useMemo(() => buildPositionIndex(lines.batting), [lines.batting])
  const [qualified, setQualified] = useState(() => qual.active)
  const [sortKey, setSortKey] = useState(() => defaultSort(seedAxes.side ?? 'hitting', focus?.sortKey).key)
  const [sortAsc, setSortAsc] = useState(() => defaultSort(seedAxes.side ?? 'hitting', focus?.sortKey).asc)

  // Re-focus the table whenever a leader card sends us here. Keyed on `token`, NOT on the
  // group/column values: this panel stays mounted once visited, so seeding state at mount is
  // not enough (a second "View all" used to be a no-op), while reacting to the values alone
  // would fight the reader's own sorting on every unrelated re-render. A token bump means
  // "the reader just asked for this view" and nothing else does.
  const requested = focus?.token ?? 0
  useEffect(() => {
    if (!focus || requested === 0) return
    const axes = axesOf(focus.group)
    if (axes.side) setSide(axes.side)
    setSource(axes.source)
    // A link can also ask for the teams board, or for the player board already narrowed to
    // one club — the two states the team page links into. Both are left alone when the link
    // doesn't mention them, so an ordinary leader-card jump behaves exactly as before.
    if (focus.mode) setMode(focus.mode)
    if (focus.teamId !== undefined) setTeamId(focus.teamId)
    if (axes.source !== 'season') return // the tracked boards and draft have nothing to sort
    const next = defaultSort(axes.side ?? 'hitting', focus.sortKey)
    setSortKey(next.key)
    setSortAsc(next.asc)
  }, [requested])

  // Revalidate on mount, but skip the DB round trip entirely when the shared cache is
  // still fresh — so a quick swipe out and back is instant and silent. Box scores move
  // as games are played, so a stale cache (or a live game) still refreshes in the
  // background without gating the already-painted table behind the spinner.
  useEffect(() => {
    const STATS_STALE_MS = 30_000
    if (wpblStatsCacheAgeMs() < STATS_STALE_MS) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines()]).then(([p, l]) => {
      if (cancelled) return
      setPlayers(p); setLines(l); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // OPS+ normalizes a hitter's OBP+SLG to the league (100 = league average, 150 = 50%
  // better). It needs league-wide rate context, so build the hitting columns in-component
  // with the league OBP/SLG closed over — computed from every batting line regardless of the
  // team/qualified filters, since the baseline is the whole league. No park factors: the
  // classic formula includes them, but this league's single-season, unmeasured parks give no
  // reliable adjustment, so we omit it (implicitly 1.0). Sits right after OPS.
  const hitCols = useMemo<Col<WpblBattingTotals>[]>(() => {
    const lg = sumBatting(lines.batting)
    const lgObp = lg.obp, lgSlg = lg.slg
    const opsPlus = (t: WpblBattingTotals): number | null =>
      t.obp != null && t.slg != null && lgObp != null && lgObp > 0 && lgSlg != null && lgSlg > 0
        ? 100 * (t.obp / lgObp + t.slg / lgSlg - 1)
        : null
    const cols = [...HIT_COLS]
    // Team rows only. Player LOB isn't reported by the feed, so on the player board this
    // column would be a solid stripe of dashes pretending to be a stat.
    if (mode === 'teams') {
      cols.splice(cols.findIndex(c => c.key === 'g'), 0, {
        key: 'lob', label: 'LOB',
        value: t => t.lob,
        // Never the default `String(v ?? 0)` — an unreported LOB must read as "unknown",
        // not as "nobody was left on".
        display: t => (t.lob == null ? '—' : String(t.lob)),
      })
    }
    const opsIdx = cols.findIndex(c => c.key === 'ops')
    cols.splice(opsIdx + 1, 0, {
      key: 'opsPlus', label: 'OPS+',
      value: opsPlus,
      display: t => { const v = opsPlus(t); return v == null ? '—' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.batting, mode])

  // ERA+ mirrors OPS+ for pitchers: league ERA over the pitcher's ERA, ×100 (100 = league
  // average, higher is better — note it inverts ERA, so unlike ERA it sorts descending). No
  // park factor, same reasoning as OPS+. A 0.00 ERA has no finite ratio, so it reads "∞" and
  // sorts to the top rather than dashing to the bottom. Sits right after ERA.
  const pitCols = useMemo<Col<WpblPitchingTotals>[]>(() => {
    const lgEra = sumPitching(lines.pitching).era
    const eraPlus = (t: WpblPitchingTotals): number | null => {
      if (t.era == null || lgEra == null || lgEra <= 0) return null
      return t.era === 0 ? Infinity : 100 * lgEra / t.era
    }
    const cols = [...PIT_COLS]
    const eraIdx = cols.findIndex(c => c.key === 'era')
    cols.splice(eraIdx + 1, 0, {
      key: 'eraPlus', label: 'ERA+',
      value: eraPlus,
      display: t => { const v = eraPlus(t); return v == null ? '—' : !isFinite(v) ? '∞' : String(Math.round(v)) },
      rate: true,
    })
    return cols
  }, [lines.pitching])

  const cols = (side === 'hitting' ? hitCols : pitCols) as Col<WpblBattingTotals | WpblPitchingTotals>[]
  const activeCol = cols.find(c => c.key === sortKey) ?? cols[0]
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // On phones the sorted column is pinned right after the name (a second frozen column) so
  // rank → name → its ranking value are always adjacent and the table can rest at its
  // natural left (G, AB, R, H…). Wide screens keep the plain single-scroll table.
  const pinActive = isNarrow
  // Teams mode only narrows on a phone; a wide screen has room for the full club name.
  const teamsNarrow = pinActive && mode === 'teams'
  const nameW = teamsNarrow ? TEAM_NAME_W : NAME_W
  const nameInnerMax = teamsNarrow ? TEAM_NAME_INNER_MAX : NAME_INNER_MAX
  const scrollCols = pinActive ? cols.filter(c => c.key !== activeCol.key) : cols

  // Flipping sides re-sorts on that side's headline stat. Safe to do even while the tracked
  // boards are showing: it leaves the table sorted sensibly for when the reader switches back.
  const switchSide = (s: Side) => {
    setSide(s)
    if (s === 'hitting') { setSortKey('ops'); setSortAsc(false) }
    else { setSortKey('era'); setSortAsc(true) }
  }
  const clickHeader = (c: Col<WpblBattingTotals | WpblPitchingTotals>) => {
    if (c.key === sortKey) setSortAsc(a => !a)
    else { setSortKey(c.key); setSortAsc(c.lowerBetter ?? false) }
  }

  // Team LOB, keyed `${gameId}|${teamId}`. It has to come off the game row: the feed sends a
  // per-player `lob` but never fills it in, and summing the players wouldn't give the team
  // total anyway (see the note in sumBatting).
  const lobByGameTeam = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) {
      if (g.home_lob != null) m.set(`${g.id}|${g.home_team_id}`, g.home_lob)
      if (g.away_lob != null) m.set(`${g.id}|${g.away_team_id}`, g.away_lob)
    }
    return m
  }, [games])

  const rows = useMemo<Row[]>(() => {
    let built: Row[]
    if (mode === 'teams') {
      // One row per team (only four). Team G is the team's games played — the count of
      // distinct game_ids — not the number of player lines that sumBatting/sumPitching add up.
      built = teams.map(team => {
        const src = side === 'hitting'
          ? lines.batting.filter(l => l.team_id === team.id)
          : lines.pitching.filter(l => l.team_id === team.id)
        const totals = side === 'hitting' ? sumBatting(src as WpblBattingLine[]) : sumPitching(src as WpblPitchingLine[])
        const gameIds = new Set(src.map(l => l.game_id))
        totals.g = gameIds.size
        if (side === 'hitting') {
          // Summed over exactly the games this team has box-score lines for, so LOB covers
          // the same games as the rest of the row rather than drifting ahead of it when a
          // game's score lands before its boxscore does. Left null when none of them
          // reported one, so the cell dashes instead of claiming a tidy zero.
          let lob = 0, any = false
          for (const gid of gameIds) {
            const v = lobByGameTeam.get(`${gid}|${team.id}`)
            if (v != null) { lob += v; any = true }
          }
          ;(totals as WpblBattingTotals).lob = any ? lob : null
        }
        return {
          key: team.id, team, label: wpblFullName(team), shortLabel: team.name,
          totals, qualified: true,
          onClick: onOpenTeam ? () => onOpenTeam(team) : undefined,
        }
      })
    } else {
      const seasons = side === 'hitting'
        ? aggregateBatting(players, lines.batting).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.ab >= qual.minAb }))
        : aggregatePitching(players, lines.pitching).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.outs >= qual.minOuts }))
      let list = seasons
      if (teamId) list = list.filter(s => s.player.team_id === teamId)
      // The qualifier applies to every sort, counting stats included — a 1-for-1 HR leader
      // shouldn't top the board over a full-season slugger. (Was rate-columns only, which
      // made the lit "✓ Qualified" chip silently do nothing on counting stats.)
      if (qualified) list = list.filter(s => s.qualified)
      built = list.map(s => ({
        key: s.player.id, team: teamById.get(s.player.team_id),
        label: shortName(s.player.name), sublabel: displayPositionFromIndex(s.player, positionIndex).label ?? undefined,
        totals: s.totals, qualified: s.qualified,
        onClick: () => onOpenPlayer(s.player),
      }))
    }

    const val = (r: Row) => activeCol.value(r.totals)
    // Ties break toward the bigger sample — innings pitched (outs) for pitching, at-bats
    // for hitting — regardless of sort direction (more is always the better tiebreak).
    const sample = (r: Row) => side === 'pitching' ? (r.totals as WpblPitchingTotals).outs : (r.totals as WpblBattingTotals).ab
    return built.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return sample(b) - sample(a)
      if (av == null) return 1          // nulls always sink
      if (bv == null) return -1
      if (av !== bv) return sortAsc ? av - bv : bv - av
      return sample(b) - sample(a)
    })
  }, [mode, side, players, lines, teams, teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, shortName, lobByGameTeam])

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching sides — but only if it isn't already visible, so a wide desktop
  // table (all columns shown) or a user who's scrolled elsewhere is left alone.
  useLayoutEffect(() => {
    if (loading || pinActive) return // pinned: the sorted column is always in view (frozen)
    const c = scrollRef.current
    if (!c) return
    const th = c.querySelector('th[data-active="true"]') as HTMLElement | null
    if (!th) return
    const cRect = c.getBoundingClientRect()
    const tRect = th.getBoundingClientRect()
    const rightInView = tRect.right - cRect.left
    const leftInView = tRect.left - cRect.left
    if (rightInView > c.clientWidth) c.scrollLeft += rightInView - c.clientWidth + 12
    else if (leftInView < 0) c.scrollLeft += leftInView - 12
  }, [loading, side, sortKey, rows.length, pinActive])

  // Track horizontal scroll position to toggle the edge affordances.
  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    const update = () => {
      const max = c.scrollWidth - c.clientWidth
      setScrollX({ atStart: c.scrollLeft <= 1, atEnd: max <= 1 || c.scrollLeft >= max - 1 })
    }
    update()
    c.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(c)
    return () => { c.removeEventListener('scroll', update); ro.disconnect() }
  }, [loading, side, mode, rows.length, pinActive])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  // Draft takes the whole panel rather than sitting in a bar as a fourth tab. It's one
  // analysis covering hitters and pitchers at once, so a side switch above it would be inert
  // and a source switch meaningless — every control would be a control that does nothing.
  if (source === 'draft') {
    return (
      <Box>
        <Box onClick={() => setSource('season')} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1.75, cursor: 'pointer',
          userSelect: 'none', color: 'text.secondary', fontSize: '0.82rem', fontWeight: 700,
          '&:hover': { color: 'text.primary' },
        }}>
          <Box component="span" sx={{ fontSize: '0.95rem', lineHeight: 1 }}>←</Box> Stats
        </Box>
        <Suspense fallback={<SubViewFallback />}>
          <WpblDraftValue players={players} batting={lines.batting} pitching={lines.pitching}
            onOpenPlayer={onOpenPlayer} />
        </Suspense>
      </Box>
    )
  }

  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }

  return (
    <Box>
      {/* The control bar, pinned. A 36-row table used to scroll every control off the top,
          leaving no way to change side, source or filter without scrolling back up. It offsets
          by --app-header-h + --wpbl-nav-h: exactly one of those is non-zero at a time (the
          toolbar is sticky only on desktop, the section nav only on mobile), so the sum lands
          it just below the chrome on both without either breakpoint being special-cased here.
          Above the table's own sticky header, which pins inside the scroll box below it. */}
      <Box sx={{
        position: 'sticky',
        top: 'calc(var(--app-header-h, 0px) + var(--wpbl-nav-h, 0px))',
        zIndex: 6,
        bgcolor: 'background.default',
        pt: 1,
        ...fullBleedStickySx,
      }}>
      {/* Side of the ball — underline tabs, deliberately distinct from the section's pill nav
          so the two don't read as the same control stacked twice. Two items now instead of
          four, which is what lets Players ⇆ Teams share this row and still fit a phone: it
          used to be shoved off the right edge by the tab set and was invisible until you
          swiped a nav bar sideways. Full-bleed so the bars share the wide table's left edge
          instead of floating in the 720px column. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, borderBottom: '1px solid', borderColor: 'divider', mb: 1.25 }}>
        <Box sx={{ display: 'flex', gap: 2.5 }}>
          {(['hitting', 'pitching'] as Side[]).map(sd => {
            const active = side === sd
            return (
              <Box key={sd} onClick={() => switchSide(sd)} sx={{
                pb: 1, mb: '-1px', cursor: 'pointer', userSelect: 'none',
                borderBottom: '2px solid', borderColor: active ? WPBL_ACCENT : 'transparent',
                color: active ? 'text.primary' : 'text.secondary',
                fontSize: '0.98rem', fontWeight: active ? 800 : 600, transition: 'color 0.15s',
                '&:hover': { color: 'text.primary' },
              }}>
                {sd === 'hitting' ? 'Hitting' : 'Pitching'}
              </Box>
            )
          })}
        </Box>

        {/* Players ⇆ Teams — the entity the table ranks, not a stat group. Season only: the
            tracked boards rank individual players and have no team cut. */}
        {source === 'season' && (
          <Box sx={{ display: 'flex', gap: 0.5, pb: 0.75, flexShrink: 0 }}>
            <Chip active={mode === 'players'} onClick={() => setMode('players')}>Players</Chip>
            <Chip active={mode === 'teams'} onClick={() => setMode('teams')}>Teams</Chip>
          </Box>
        )}
      </Box>

      {/* Source, team filter and Qualified share one wrapping row, reordered by width rather
          than duplicated per breakpoint. A phone puts the team chips on their own line below
          (flex-basis 100%) with Qualified pulled right beside the source toggle, which is what
          lets each line fit 375px without scrolling sideways. Desktop has room for all three
          at once, so the chips ride up onto the same line and the bar costs two rows instead
          of three. `order` is what swaps them; the markup stays single-source. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, rowGap: 1, pb: 1.5 }}>
        <Box sx={{ order: 1, display: 'flex', gap: 0.5, flexShrink: 0 }}>
          <Chip active={source === 'season'} onClick={() => setSource('season')}>Season</Chip>
          <Chip active={source === 'tracked'} onClick={() => setSource('tracked')}>Tracked</Chip>
        </Box>

        {/* Players mode only — in Teams mode the table already is the four teams. */}
        {source === 'season' && mode === 'players' && (
          <Box sx={{
            order: { xs: 3, sm: 2 }, flexBasis: { xs: '100%', sm: 'auto' }, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 0.75, overflowX: 'auto',
            '&::-webkit-scrollbar': { display: 'none' }, msOverflowStyle: 'none', scrollbarWidth: 'none',
          }}>
            {/* Separates the filter from the source toggle once they share a line. */}
            <Box sx={{ display: { xs: 'none', sm: 'block' }, width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mr: 0.25, flexShrink: 0 }} />
            <Chip active={teamId === null} onClick={() => setTeamId(null)}>All</Chip>
            {teamChips.map(t => (
              <Chip key={t.id} active={teamId === t.id} onClick={() => setTeamId(teamId === t.id ? null : t.id)}>
                <TeamBadge team={t} size={16} />
                <Box component="span" sx={{ ml: 0.5 }}>{t.abbr}</Box>
              </Chip>
            ))}
          </Box>
        )}

        {/* The one filter that changes what the table *is* rather than which team it shows. */}
        {source === 'season' && mode === 'players' && (
          <Box sx={{ order: { xs: 2, sm: 3 }, ml: 'auto', flexShrink: 0 }}>
            <Chip active={qualified} onClick={() => setQualified(q => !q)}>{qualified ? '✓ Qualified' : 'Qualified'}</Chip>
          </Box>
        )}
      </Box>
      </Box>

      {/* Tracked renders its own boards (league-best tiles + velocity / exit-velo leaders)
          rather than the shared table — a different shape of data, not more columns — but it
          reads the same `side` as the table, so switching Hitting/Pitching above carries
          straight through instead of being asked again inside it. */}
      {source === 'tracked' ? (
        <Suspense fallback={<SubViewFallback />}>
          <WpblTrackingView side={side} onOpenPlayer={onOpenPlayer} />
        </Suspense>
      ) : rows.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
            {qualified ? 'No qualified players yet — try “All players”.' : 'Stats fill in as games are played.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden', ...fullBleedSx }}>
          <Box sx={{ position: 'relative' }}>
          {/* Capped inner scroll so the column headers stay sticky (top:0) as you scroll the
              rows. `overscroll-behavior: contain` stops the scroll from chaining out to the
              page at the ends, so it reads as one list rather than a scroll-box fighting the
              page. `dvh` tracks the mobile browser chrome so the cap doesn't overshoot. */}
          <Box ref={scrollRef} sx={{
            overflowX: 'auto', overflowY: 'auto', overscrollBehavior: 'contain',
            maxHeight: 'calc(100dvh / var(--app-zoom, 1) - 260px)',
          }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" data-swipe-handle="" sx={{ ...thBase, left: 0, zIndex: 4, textAlign: 'left', width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined, borderRight: '1px solid', borderColor: 'divider', pl: 1, touchAction: pinActive ? 'pan-y' : undefined }}>
                    {mode === 'teams' ? 'Team' : 'Player'}
                  </Box>
                  {pinActive && (
                    <Box component="th" data-swipe-handle="" onClick={() => clickHeader(activeCol)} sx={{
                      ...thBase, position: 'sticky', left: nameW - 2, zIndex: 5, touchAction: 'pan-y',
                      textAlign: 'center', cursor: 'pointer', minWidth: 50, px: 0.5,
                      color: 'var(--wpbl-accent-fg)',
                      backgroundImage: `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)`,
                      borderRight: '1px solid', borderColor: 'divider',
                      boxShadow: scrollX.atStart ? 'none' : FROZEN_SHADOW,
                    }}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                        {activeCol.label}
                        <Box component="span" sx={{ fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>
                      </Box>
                    </Box>
                  )}
                  {scrollCols.map(c => {
                    const active = c.key === sortKey
                    return (
                      <Box component="th" key={c.key} onClick={() => clickHeader(c)}
                        data-active={active ? 'true' : undefined}
                        sx={{
                          ...thBase, textAlign: 'center', cursor: 'pointer', minWidth: 38,
                          color: active ? 'var(--wpbl-accent-fg)' : 'text.disabled',
                          // The sorted column's tint rides on backgroundImage over the opaque
                          // paper thBase already sets. As a bgcolor it *replaced* that paper
                          // with a 14%-alpha accent, so this one header cell went see-through
                          // and the rows scrolling under the sticky header showed through it.
                          // Same layering the frozen column beside it already uses.
                          backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)` : undefined,
                          '&:hover': { color: 'var(--wpbl-accent-fg)' },
                        }}>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                          {c.label}
                          {active && <Box component="span" sx={{ fontSize: '0.62rem' }}>{sortAsc ? '↑' : '↓'}</Box>}
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((r, i) => {
                  return (
                    <Box component="tr" key={r.key} onClick={r.onClick}
                      sx={{
                        cursor: r.onClick ? 'pointer' : 'default', userSelect: 'none',
                        WebkitTapHighlightColor: 'transparent',
                        // Hover tints via backgroundImage for the same reason as the header:
                        // the row's frozen name cell — and, on a phone, its pinned sort cell —
                        // are sticky and rely on an opaque backgroundColor. Overwriting that
                        // made the hovered row's name cell transparent, so the stat columns
                        // scrolling beneath it showed through.
                        '@media (hover: hover)': {
                          '&:hover > td, &:hover > th': r.onClick
                            ? { backgroundImage: `linear-gradient(${WPBL_ACCENT}0e, ${WPBL_ACCENT}0e)` }
                            : undefined,
                        },
                      }}>
                      <Box component="th" data-swipe-handle="" sx={{
                        position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
                        textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
                        width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined,
                        borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                        touchAction: pinActive ? 'pan-y' : undefined,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {/* Four rows, already in sorted order, with the sorted column
                              arrowed in the header — the rank digit restates all of that and
                              costs 24px that a nickname needs to render whole. */}
                          {!teamsNarrow && (
                            <Typography sx={{ width: 18, textAlign: 'right', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled' }}>{i + 1}</Typography>
                          )}
                          {r.team && <TeamBadge team={r.team} size={20} />}
                          <Box sx={{ minWidth: 0, maxWidth: pinActive ? nameInnerMax : undefined }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {teamsNarrow && r.shortLabel ? r.shortLabel : r.label}
                            </Typography>
                            {r.sublabel && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.sublabel}</Typography>}
                          </Box>
                        </Box>
                      </Box>
                      {pinActive && (
                        <Box component="td" data-swipe-handle="" onClick={e => { e.stopPropagation(); clickHeader(activeCol) }} sx={{
                          position: 'sticky', left: nameW - 2, zIndex: 3, touchAction: 'pan-y',
                          textAlign: 'center', py: 0.5, px: 0.5,
                          borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                          fontSize: '0.84rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                          backgroundColor: 'background.paper',
                          backgroundImage: `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)`,
                          boxShadow: scrollX.atStart ? 'none' : FROZEN_SHADOW,
                          whiteSpace: 'nowrap',
                        }}>
                          {activeCol.display ? activeCol.display(r.totals) : (activeCol.rate ? fmtRate(activeCol.value(r.totals)) : String(activeCol.value(r.totals) ?? 0))}
                        </Box>
                      )}
                      {scrollCols.map(c => {
                        const active = c.key === sortKey
                        const v = c.value(r.totals)
                        const txt = c.display ? c.display(r.totals) : (c.rate ? fmtRate(v) : String(v ?? 0))
                        return (
                          <Box component="td" key={c.key} onClick={e => { e.stopPropagation(); clickHeader(c) }} sx={{
                            textAlign: 'center', py: 0.5, px: 0.5, borderTop: '1px solid', borderColor: 'divider',
                            fontSize: active ? '0.84rem' : '0.8rem', fontWeight: active ? 800 : 500,
                            color: active ? 'var(--wpbl-accent-fg)' : 'text.primary',
                            // Layered like the header, so a hovered row and the sorted column
                            // compose instead of one of them winning outright.
                            backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)` : undefined,
                            whiteSpace: 'nowrap',
                          }}>
                            {txt}
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>
          {/* Right-edge fade — "more stats this way" — hidden once you've scrolled to the end. */}
          <Box aria-hidden sx={theme => ({
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none', zIndex: 6,
            background: `linear-gradient(to right, ${alpha(theme.palette.background.paper, 0)}, ${theme.palette.background.paper})`,
            opacity: scrollX.atEnd ? 0 : 1, transition: 'opacity 0.2s',
          })} />
          </Box>
          <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600 }}>
              {rows.length} {mode === 'teams' ? (rows.length === 1 ? 'team' : 'teams') : (rows.length === 1 ? 'player' : 'players')} · 2026 season · tap a column to sort
            </Typography>
          </Box>
        </Box>
      )}

      {/* Draft value — still inside Stats, but under the table rather than beside Hitting and
          Pitching in the bar. It's an analysis a reader takes in once, not a board they check
          weekly, and it spans both sides of the ball so it belongs on neither axis. The table
          above is a fixed-height scroller, so this sits on screen rather than below the fold. */}
      {source === 'season' && (
        <Box onClick={() => setSource('draft')} sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, mt: 1.5, px: 1.5, py: 1.25,
          border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2,
          cursor: 'pointer', userSelect: 'none', transition: 'border-color 0.15s, background-color 0.15s',
          '&:hover': { borderColor: WPBL_ACCENT, bgcolor: `${WPBL_ACCENT}0a` },
          ...fullBleedSx,
        }}>
          <Box sx={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0 }}>📈</Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, lineHeight: 1.2 }}>Draft value</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', lineHeight: 1.3 }}>
              Do earlier picks produce better players?
            </Typography>
          </Box>
          <Box sx={{ ml: 'auto', flexShrink: 0, color: 'text.disabled', fontSize: '0.9rem' }}>→</Box>
        </Box>
      )}
    </Box>
  )
}

// Small pill used for the team filter + qualified toggle.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box {...pressable(onClick)} aria-pressed={active} sx={{
      ...FOCUS_RING,
      display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      flexShrink: 0, whiteSpace: 'nowrap',
      px: 1, py: 0.4, borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
      border: '1px solid', transition: 'all 0.15s',
      borderColor: active ? WPBL_ACCENT : CARD_BORDER,
      color: active ? 'var(--wpbl-accent-fg)' : 'text.secondary',
      bgcolor: active ? `${WPBL_ACCENT}12` : 'transparent',
      '&:hover': { borderColor: WPBL_ACCENT },
    }}>
      {children}
    </Box>
  )
}
