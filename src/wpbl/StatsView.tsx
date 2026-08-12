import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  fetchWpblAllPlayers, fetchWpblAllLines,
  getCachedWpblAllPlayers, getCachedWpblAllLines, wpblStatsCacheAgeMs,
} from './api'
import { WPBL_ACCENT, outsToIp, wpblFullName } from './constants'
import { TeamBadge, CARD_BORDER, useWpblName } from './ui'
import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, qualifiersActive, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

// Complete season stat table for the WPBL — a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

const MIN_AB = 5    // rate-stat qualifiers for the short (~6 week) inaugural season
const MIN_OUTS = 9  // 3 IP

type Group = 'hitting' | 'pitching'
type Mode = 'players' | 'teams'

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

// One table row — normalized so the same table renders a player or a whole team.
interface Row {
  key: string
  team: WpblTeam | undefined       // for the badge (a player's club, or the team itself)
  label: string                    // player short name, or full team name
  sublabel?: string                // player position (players only)
  totals: WpblBattingTotals | WpblPitchingTotals
  qualified: boolean
  onClick?: () => void
}

// Break the table out of the 720px page column so every stat column is visible. The page
// is horizontally centered, so centering a viewport-wide box on it reads as full-bleed.
// Zoom-aware: inside the desktop `zoom` wrapper vw units aren't shrunk, so divide by
// --app-zoom (defaults to 1 off desktop). Capped so it doesn't sprawl on huge monitors.
const fullBleedSx = {
  width: 'min(1100px, calc(100vw / var(--app-zoom, 1) - 24px))',
  position: 'relative',
  left: '50%',
  transform: 'translateX(-50%)',
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

export default function WpblStatsView({ teams, games, initialGroup = 'hitting', onOpenPlayer, onOpenTeam }: {
  teams: WpblTeam[]
  games: WpblGame[]
  initialGroup?: Group
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of flashing the spinner.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [loading, setLoading] = useState(() => getCachedWpblAllPlayers() == null || getCachedWpblAllLines() == null)
  const shortName = useWpblName()
  const isNarrow = useMediaQuery('(max-width:600px)')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Horizontal-scroll edges — drive the frozen-column shadow (not at start) and the
  // right-edge fade (not at end), so it's obvious the table scrolls sideways.
  const [scrollX, setScrollX] = useState({ atStart: true, atEnd: true })

  const [group, setGroup] = useState<Group>(initialGroup)
  const [mode, setMode] = useState<Mode>('players')
  const [teamId, setTeamId] = useState<string | null>(null)
  // The 5 AB / 3 IP qualifier only defaults on once every team has played 2+ games;
  // before that it would hide nearly everyone, so the complete table shows by default.
  const [qualified, setQualified] = useState(() => qualifiersActive(teams, games))
  const [sortKey, setSortKey] = useState(initialGroup === 'pitching' ? 'era' : 'ops')
  const [sortAsc, setSortAsc] = useState(initialGroup === 'pitching')

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

  const cols = (group === 'hitting' ? HIT_COLS : PIT_COLS) as Col<WpblBattingTotals | WpblPitchingTotals>[]
  const activeCol = cols.find(c => c.key === sortKey) ?? cols[0]
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // On phones the sorted column is pinned right after the name (a second frozen column) so
  // rank → name → its ranking value are always adjacent and the table can rest at its
  // natural left (G, AB, R, H…). Wide screens keep the plain single-scroll table.
  const pinActive = isNarrow
  const scrollCols = pinActive ? cols.filter(c => c.key !== activeCol.key) : cols

  // Switch the default sort/qualifier sensibly when flipping between hitting and pitching.
  const switchGroup = (g: Group) => {
    setGroup(g)
    if (g === 'hitting') { setSortKey('ops'); setSortAsc(false) }
    else { setSortKey('era'); setSortAsc(true) }
  }
  const clickHeader = (c: Col<WpblBattingTotals | WpblPitchingTotals>) => {
    if (c.key === sortKey) setSortAsc(a => !a)
    else { setSortKey(c.key); setSortAsc(c.lowerBetter ?? false) }
  }

  const rows = useMemo<Row[]>(() => {
    let built: Row[]
    if (mode === 'teams') {
      // One row per team (only four). Team G is the team's games played — the count of
      // distinct game_ids — not the number of player lines that sumBatting/sumPitching add up.
      built = teams.map(team => {
        const src = group === 'hitting'
          ? lines.batting.filter(l => l.team_id === team.id)
          : lines.pitching.filter(l => l.team_id === team.id)
        const totals = group === 'hitting' ? sumBatting(src as WpblBattingLine[]) : sumPitching(src as WpblPitchingLine[])
        totals.g = new Set(src.map(l => l.game_id)).size
        return {
          key: team.id, team, label: wpblFullName(team),
          totals, qualified: true,
          onClick: onOpenTeam ? () => onOpenTeam(team) : undefined,
        }
      })
    } else {
      const seasons = group === 'hitting'
        ? aggregateBatting(players, lines.batting).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.ab >= MIN_AB }))
        : aggregatePitching(players, lines.pitching).map(s => ({ player: s.player, totals: s.totals as WpblBattingTotals | WpblPitchingTotals, qualified: s.totals.outs >= MIN_OUTS }))
      let list = seasons
      if (teamId) list = list.filter(s => s.player.team_id === teamId)
      // The qualifier applies to every sort, counting stats included — a 1-for-1 HR leader
      // shouldn't top the board over a full-season slugger. (Was rate-columns only, which
      // made the lit "✓ Qualified" chip silently do nothing on counting stats.)
      if (qualified) list = list.filter(s => s.qualified)
      built = list.map(s => ({
        key: s.player.id, team: teamById.get(s.player.team_id),
        label: shortName(s.player.name), sublabel: s.player.position ?? undefined,
        totals: s.totals, qualified: s.qualified,
        onClick: () => onOpenPlayer(s.player),
      }))
    }

    const val = (r: Row) => activeCol.value(r.totals)
    // Ties break toward the bigger sample — innings pitched (outs) for pitching, at-bats
    // for hitting — regardless of sort direction (more is always the better tiebreak).
    const sample = (r: Row) => group === 'pitching' ? (r.totals as WpblPitchingTotals).outs : (r.totals as WpblBattingTotals).ab
    return built.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return sample(b) - sample(a)
      if (av == null) return 1          // nulls always sink
      if (bv == null) return -1
      if (av !== bv) return sortAsc ? av - bv : bv - av
      return sample(b) - sample(a)
    })
  }, [mode, group, players, lines, teams, teamById, teamId, qualified, activeCol, sortAsc, onOpenPlayer, onOpenTeam, shortName])

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching Hitting/Pitching — but only if it isn't already visible, so a wide desktop
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
  }, [loading, group, sortKey, rows.length, pinActive])

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
  }, [loading, group, mode, rows.length, pinActive])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }

  return (
    <Box>
      {/* Group switcher — underline tabs, deliberately distinct from the section's pill nav
          so the two don't read as the same control stacked twice. Full-bleed so the tabs +
          filters share the wide table's left edge instead of floating in the 720px column. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, borderBottom: '1px solid', borderColor: 'divider', mb: 1.5, ...fullBleedSx }}>
        <Box sx={{ display: 'flex', gap: 2.5 }}>
          {(['hitting', 'pitching'] as Group[]).map(g => {
            const active = group === g
            return (
              <Box key={g} onClick={() => switchGroup(g)} sx={{
                pb: 1, mb: '-1px', cursor: 'pointer', userSelect: 'none',
                borderBottom: '2px solid', borderColor: active ? WPBL_ACCENT : 'transparent',
                color: active ? 'text.primary' : 'text.secondary',
                fontSize: '0.98rem', fontWeight: active ? 800 : 600, transition: 'color 0.15s',
                '&:hover': { color: 'text.primary' },
              }}>
                {g === 'hitting' ? 'Hitting' : 'Pitching'}
              </Box>
            )
          })}
        </Box>

        {/* Players ⇆ Teams — the entity the table ranks. Distinct from Hitting/Pitching
            (the stat group). In Teams mode the per-player filters below don't apply. */}
        <Box sx={{ display: 'flex', gap: 0.5, pb: 0.75, flexShrink: 0 }}>
          <Chip active={mode === 'players'} onClick={() => setMode('players')}>Players</Chip>
          <Chip active={mode === 'teams'} onClick={() => setMode('teams')}>Teams</Chip>
        </Box>
      </Box>

      {/* Filters on one line (scrolls on narrow screens): team chips, then a divider, then
          the qualified toggle — so the team "All" and the separate "Qualified" filter read
          as two different controls rather than two competing "All"s. Players mode only —
          in Teams mode the table already is the four teams, so neither filter applies. */}
      {mode === 'players' && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, overflowX: 'auto', pb: 0.5,
          '&::-webkit-scrollbar': { display: 'none' }, msOverflowStyle: 'none', scrollbarWidth: 'none',
          ...fullBleedSx,
        }}>
          <Chip active={teamId === null} onClick={() => setTeamId(null)}>All</Chip>
          {teamChips.map(t => (
            <Chip key={t.id} active={teamId === t.id} onClick={() => setTeamId(teamId === t.id ? null : t.id)}>
              <TeamBadge team={t} size={16} />
              <Box component="span" sx={{ ml: 0.5 }}>{t.abbr}</Box>
            </Chip>
          ))}
          <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.5, flexShrink: 0 }} />
          <Chip active={qualified} onClick={() => setQualified(q => !q)}>{qualified ? '✓ Qualified' : 'Qualified'}</Chip>
        </Box>
      )}

      {rows.length === 0 ? (
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
                  <Box component="th" data-swipe-handle="" sx={{ ...thBase, left: 0, zIndex: 4, textAlign: 'left', width: pinActive ? NAME_W : undefined, minWidth: NAME_W, maxWidth: pinActive ? NAME_W : undefined, borderRight: '1px solid', borderColor: 'divider', pl: 1, touchAction: pinActive ? 'pan-y' : undefined }}>
                    {mode === 'teams' ? 'Team' : 'Player'}
                  </Box>
                  {pinActive && (
                    <Box component="th" data-swipe-handle="" onClick={() => clickHeader(activeCol)} sx={{
                      ...thBase, position: 'sticky', left: NAME_W - 2, zIndex: 5, touchAction: 'pan-y',
                      textAlign: 'center', cursor: 'pointer', minWidth: 50, px: 0.5,
                      color: WPBL_ACCENT,
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
                          color: active ? WPBL_ACCENT : 'text.disabled',
                          bgcolor: active ? `${WPBL_ACCENT}24` : 'background.paper',
                          '&:hover': { color: WPBL_ACCENT },
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
                      sx={{ cursor: r.onClick ? 'pointer' : 'default', userSelect: 'none', WebkitTapHighlightColor: 'transparent', '@media (hover: hover)': { '&:hover > td, &:hover > th': r.onClick ? { bgcolor: `${WPBL_ACCENT}0e` } : undefined } }}>
                      <Box component="th" data-swipe-handle="" sx={{
                        position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
                        textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
                        width: pinActive ? NAME_W : undefined, minWidth: NAME_W, maxWidth: pinActive ? NAME_W : undefined,
                        borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                        touchAction: pinActive ? 'pan-y' : undefined,
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ width: 18, textAlign: 'right', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled' }}>{i + 1}</Typography>
                          {r.team && <TeamBadge team={r.team} size={20} />}
                          <Box sx={{ minWidth: 0, maxWidth: pinActive ? NAME_INNER_MAX : undefined }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</Typography>
                            {r.sublabel && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.sublabel}</Typography>}
                          </Box>
                        </Box>
                      </Box>
                      {pinActive && (
                        <Box component="td" data-swipe-handle="" onClick={e => { e.stopPropagation(); clickHeader(activeCol) }} sx={{
                          position: 'sticky', left: NAME_W - 2, zIndex: 3, touchAction: 'pan-y',
                          textAlign: 'center', py: 0.5, px: 0.5,
                          borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                          fontSize: '0.84rem', fontWeight: 800, color: WPBL_ACCENT,
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
                            color: active ? WPBL_ACCENT : 'text.primary', bgcolor: active ? `${WPBL_ACCENT}12` : undefined,
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
    </Box>
  )
}

// Small pill used for the team filter + qualified toggle.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box onClick={onClick} sx={{
      display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      flexShrink: 0, whiteSpace: 'nowrap',
      px: 1, py: 0.4, borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
      border: '1px solid', transition: 'all 0.15s',
      borderColor: active ? WPBL_ACCENT : CARD_BORDER,
      color: active ? WPBL_ACCENT : 'text.secondary',
      bgcolor: active ? `${WPBL_ACCENT}12` : 'transparent',
      '&:hover': { borderColor: WPBL_ACCENT },
    }}>
      {children}
    </Box>
  )
}
