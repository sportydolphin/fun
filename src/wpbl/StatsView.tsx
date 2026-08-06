import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblAllPlayers, fetchWpblAllLines } from './api'
import { WPBL_ACCENT, outsToIp } from './constants'
import { TeamBadge, CARD_BORDER, useWpblName } from './ui'
import {
  aggregateBatting, aggregatePitching, qualifiersActive, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

// Complete season stat table for the WPBL — a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

const MIN_AB = 5    // rate-stat qualifiers for the short (~6 week) inaugural season
const MIN_OUTS = 9  // 3 IP

type Group = 'hitting' | 'pitching'

interface Col<T> {
  key: string
  label: string
  value: (t: T) => number | null      // sort value (null = sorts to the bottom)
  display?: (t: T) => string          // cell text (defaults to the value)
  rate?: boolean                      // rate stat → dash when null, eligible for the qualified filter
  lowerBetter?: boolean               // ERA/WHIP sort ascending by default
}

const HIT_COLS: Col<WpblBattingTotals>[] = [
  { key: 'g',   label: 'G',   value: t => t.g },
  { key: 'ab',  label: 'AB',  value: t => t.ab },
  { key: 'r',   label: 'R',   value: t => t.r },
  { key: 'h',   label: 'H',   value: t => t.h },
  { key: '2b',  label: '2B',  value: t => t.doubles },
  { key: '3b',  label: '3B',  value: t => t.triples },
  { key: 'hr',  label: 'HR',  value: t => t.hr },
  { key: 'rbi', label: 'RBI', value: t => t.rbi },
  { key: 'bb',  label: 'BB',  value: t => t.bb },
  { key: 'so',  label: 'SO',  value: t => t.so },
  { key: 'sb',  label: 'SB',  value: t => t.sb },
  { key: 'avg', label: 'AVG', value: t => t.avg, display: t => fmtRate(t.avg), rate: true },
  { key: 'obp', label: 'OBP', value: t => t.obp, display: t => fmtRate(t.obp), rate: true },
  { key: 'slg', label: 'SLG', value: t => t.slg, display: t => fmtRate(t.slg), rate: true },
  { key: 'ops', label: 'OPS', value: t => t.ops, display: t => fmtRate(t.ops), rate: true },
]

const PIT_COLS: Col<WpblPitchingTotals>[] = [
  { key: 'g',    label: 'G',    value: t => t.g },
  { key: 'ip',   label: 'IP',   value: t => t.outs, display: t => outsToIp(t.outs) },
  { key: 'w',    label: 'W',    value: t => t.w },
  { key: 'l',    label: 'L',    value: t => t.l },
  { key: 'sv',   label: 'SV',   value: t => t.s },
  { key: 'h',    label: 'H',    value: t => t.h },
  { key: 'r',    label: 'R',    value: t => t.r },
  { key: 'er',   label: 'ER',   value: t => t.er },
  { key: 'bb',   label: 'BB',   value: t => t.bb },
  { key: 'so',   label: 'SO',   value: t => t.so },
  { key: 'hr',   label: 'HR',   value: t => t.hr },
  { key: 'era',  label: 'ERA',  value: t => t.era,  display: t => fmtTwo(t.era),  rate: true, lowerBetter: true },
  { key: 'whip', label: 'WHIP', value: t => t.whip, display: t => fmtTwo(t.whip), rate: true, lowerBetter: true },
]

interface Row { player: WpblPlayer; totals: WpblBattingTotals | WpblPitchingTotals; qualified: boolean }

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

export default function WpblStatsView({ teams, games, initialGroup = 'hitting', onOpenPlayer }: {
  teams: WpblTeam[]
  games: WpblGame[]
  initialGroup?: Group
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>({ batting: [], pitching: [] })
  const [loading, setLoading] = useState(true)
  const shortName = useWpblName()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [group, setGroup] = useState<Group>(initialGroup)
  const [teamId, setTeamId] = useState<string | null>(null)
  // The 5 AB / 3 IP qualifier only defaults on once every team has played 2+ games;
  // before that it would hide nearly everyone, so the complete table shows by default.
  const [qualified, setQualified] = useState(() => qualifiersActive(teams, games))
  const [sortKey, setSortKey] = useState(initialGroup === 'pitching' ? 'era' : 'ops')
  const [sortAsc, setSortAsc] = useState(initialGroup === 'pitching')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines()]).then(([p, l]) => {
      if (cancelled) return
      setPlayers(p); setLines(l); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const cols = (group === 'hitting' ? HIT_COLS : PIT_COLS) as Col<WpblBattingTotals | WpblPitchingTotals>[]
  const activeCol = cols.find(c => c.key === sortKey) ?? cols[0]

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
    const seasons = group === 'hitting'
      ? aggregateBatting(players, lines.batting).map(s => ({ player: s.player, totals: s.totals, qualified: s.totals.ab >= MIN_AB }))
      : aggregatePitching(players, lines.pitching).map(s => ({ player: s.player, totals: s.totals, qualified: s.totals.outs >= MIN_OUTS }))
    let list = seasons as Row[]
    if (teamId) list = list.filter(r => r.player.team_id === teamId)
    if (qualified && activeCol.rate) list = list.filter(r => r.qualified)

    const val = (r: Row) => activeCol.value(r.totals)
    // Ties break toward the bigger sample — innings pitched (outs) for pitching, at-bats
    // for hitting — regardless of sort direction (more is always the better tiebreak).
    const sample = (r: Row) => group === 'pitching' ? (r.totals as WpblPitchingTotals).outs : (r.totals as WpblBattingTotals).ab
    return [...list].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return sample(b) - sample(a)
      if (av == null) return 1          // nulls always sink
      if (bv == null) return -1
      if (av !== bv) return sortAsc ? av - bv : bv - av
      return sample(b) - sample(a)
    })
  }, [group, players, lines, teamId, qualified, activeCol, sortAsc])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // The sorted column (OPS / ERA by default) is at the far right, off-screen on a phone
  // where the table scrolls horizontally. Bring the highlighted column into view on load and
  // when switching Hitting/Pitching — but only if it isn't already visible, so a wide desktop
  // table (all columns shown) or a user who's scrolled elsewhere is left alone.
  useLayoutEffect(() => {
    if (loading) return
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
  }, [loading, group, sortKey, rows.length])

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
      <Box sx={{ display: 'flex', gap: 2.5, borderBottom: '1px solid', borderColor: 'divider', mb: 1.5, ...fullBleedSx }}>
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

      {/* Filters on one line (scrolls on narrow screens): team chips, then a divider, then
          the qualified toggle — so the team "All" and the separate "Qualified" filter read
          as two different controls rather than two competing "All"s. */}
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

      {rows.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
            {qualified ? 'No qualified players yet — try “All players”.' : 'Stats fill in as games are played.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden', ...fullBleedSx }}>
          <Box ref={scrollRef} sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh / var(--app-zoom, 1) - 260px)' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ ...thBase, left: 0, zIndex: 4, textAlign: 'left', minWidth: 150, borderRight: '1px solid', borderColor: 'divider', pl: 1 }}>
                    Player
                  </Box>
                  {cols.map(c => {
                    const active = c.key === sortKey
                    return (
                      <Box component="th" key={c.key} onClick={() => clickHeader(c)}
                        data-active={active ? 'true' : undefined}
                        sx={{
                          ...thBase, textAlign: 'right', cursor: 'pointer', minWidth: 38,
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
                  const t = teamById.get(r.player.team_id)
                  return (
                    <Box component="tr" key={r.player.id} onClick={() => onOpenPlayer(r.player)}
                      sx={{ cursor: 'pointer', '&:hover > td, &:hover > th': { bgcolor: `${WPBL_ACCENT}0e` } }}>
                      <Box component="th" sx={{
                        position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
                        textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
                        borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ width: 18, textAlign: 'right', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled' }}>{i + 1}</Typography>
                          {t && <TeamBadge team={t} size={20} />}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(r.player.name)}</Typography>
                            {r.player.position && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>{r.player.position}</Typography>}
                          </Box>
                        </Box>
                      </Box>
                      {cols.map(c => {
                        const active = c.key === sortKey
                        const v = c.value(r.totals)
                        const txt = c.display ? c.display(r.totals) : (c.rate ? fmtRate(v) : String(v ?? 0))
                        return (
                          <Box component="td" key={c.key} sx={{
                            textAlign: 'right', py: 0.5, px: 0.5, borderTop: '1px solid', borderColor: 'divider',
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
          <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600 }}>
              {rows.length} {rows.length === 1 ? 'player' : 'players'} · 2026 season · tap a column to sort
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
