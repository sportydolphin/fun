import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Box, Typography, InputBase, Tooltip, ClickAwayListener, Popper } from '@mui/material'
import { Player, RecentGameEntry } from '../types'
import {
  TEAM_BG, TEAM_ABBR, ACCENT, HEADSHOT, CURRENT_SEASON,
  MAX_FOLLOWED_PLAYERS, FOLLOWED_PREVIEW_XS, FOLLOWED_PREVIEW_SM,
} from '../constants'
import { searchPlayers, fetchRecentGames, fetchRosterMoves, fetchServedSuspensionIds, RosterMove } from '../api'
import { MOVE_STYLE } from './RosterMoves'
import { parseIP } from '../lib/utils'
import { fetchSuggestions, SuggestionChip, SuggestionPlayer } from './SuggestedPlayers'
import { useIsDark, defaultBorder } from '../lib/colorUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatCell { label: string; value: string }

interface FollowedPlayerInfo {
  id:        number
  fullName:  string
  position:  string
  teamAbbr:  string
  teamId:    number
  isPitcher: boolean
  stats:     StatCell[]
  playedToday: boolean       // true when `stats` is today's game line rather than the season
}

// ─── Game log (shared fetch) ──────────────────────────────────────────────────
//
// Both the sparkline and today's stat line read the same season game log, so it's
// fetched once per player and shared. `fresh` bypasses the cache — used by the
// live poll so an in-progress game's line keeps ticking.

const _gameLogCache = new Map<string, Promise<RecentGameEntry[]>>()

function loadGameLog(id: number, isPitcher: boolean, fresh = false): Promise<RecentGameEntry[]> {
  const key = `${id}:${isPitcher ? 'p' : 'h'}`
  if (fresh || !_gameLogCache.has(key)) {
    _gameLogCache.set(
      key,
      fetchRecentGames(id, [isPitcher ? 'pitching' : 'hitting'], CURRENT_SEASON).catch(() => []),
    )
  }
  return _gameLogCache.get(key)!
}

// Local calendar date — a west-coast night game is still "today" until local midnight.
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Today's line, aggregated across both ends of a doubleheader. Returns null when the
// player hasn't appeared today — callers fall back to season stats.
function todayStatCells(games: RecentGameEntry[], isPitcher: boolean): StatCell[] | null {
  const today = todayISO()
  const todays = games.filter(g => g.date === today && (isPitcher ? g.pitching : g.hitting) != null)
  if (todays.length === 0) return null

  const sum = (pick: (g: RecentGameEntry) => any) => todays.reduce((s, g) => s + Number(pick(g) ?? 0), 0)

  if (isPitcher) {
    const ip = todays.reduce((s, g) => s + parseIP(g.pitching?.inningsPitched ?? '0'), 0)
    // Outs back to the .0/.1/.2 innings notation
    const outs = Math.round(ip * 3)
    return [
      { label: 'IP', value: `${Math.floor(outs / 3)}.${outs % 3}` },
      { label: 'ER', value: String(sum(g => g.pitching?.earnedRuns)) },
      { label: 'K',  value: String(sum(g => g.pitching?.strikeOuts)) },
    ]
  }

  return [
    { label: 'H-AB', value: `${sum(g => g.hitting?.hits)}-${sum(g => g.hitting?.atBats)}` },
    { label: 'HR',   value: String(sum(g => g.hitting?.homeRuns)) },
    { label: 'RBI',  value: String(sum(g => g.hitting?.rbi)) },
  ]
}

// ─── Shared pill button style ─────────────────────────────────────────────────

const pillSx = (color = ACCENT, compact = false) => ({
  flexShrink: 0, cursor: 'pointer',
  fontSize: compact ? '0.62rem' : '0.68rem',
  fontWeight: 700, color,
  px: compact ? 1 : 1.25, py: 0.5,
  borderRadius: 999, border: `1px solid ${color}40`,
  transition: 'background 0.12s',
  '&:hover': { bgcolor: `${color}15` },
  whiteSpace: 'nowrap',
  userSelect: 'none' as const,
})

// ─── Recent-form sparkline ──────────────────────────────────────────────────────
//
// A tiny, label-less line of the player's rolling form over their recent games — a
// quick "heating up or cooling off" read that fills the gap between the name and the
// season stats. Hitters: rolling OPS over a trailing 5-game window across their last
// ~15 games. Pitchers: rolling ERA over a trailing 3 outings across their last ~12,
// negated so that — like the hitter line — a rising line always means "performing
// better". Stroke color encodes momentum (recent half vs. earlier half): green
// rising, red falling, gray flat. A faint dashed line marks the league average, so
// the form line reads as above / below the league norm.

const _sparkCache = new Map<number, number[]>()

function computeSparkSeries(games: RecentGameEntry[], isPitcher: boolean): number[] {
  // API returns newest-first; walk chronologically and keep only games the player
  // actually appeared in for the relevant role.
  const chrono = [...games].reverse().filter(g => (isPitcher ? g.pitching : g.hitting) != null)

  const build = (recent: RecentGameEntry[], W: number): number[] => {
    const out: number[] = []
    for (let i = W - 1; i < recent.length; i++) {
      const win = recent.slice(i - W + 1, i + 1)
      if (isPitcher) {
        const er = win.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
        const ip = win.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
        if (ip <= 0) continue
        out.push(-(er * 9) / ip)              // negate: lower ERA plots higher
      } else {
        const h   = win.reduce((s, x) => s + Number(x.hitting?.hits        ?? 0), 0)
        const ab  = win.reduce((s, x) => s + Number(x.hitting?.atBats      ?? 0), 0)
        const bb  = win.reduce((s, x) => s + Number(x.hitting?.baseOnBalls ?? 0), 0)
        const hbp = win.reduce((s, x) => s + Number(x.hitting?.hitByPitch  ?? 0), 0)
        const sf  = win.reduce((s, x) => s + Number(x.hitting?.sacFlies    ?? 0), 0)
        const tb  = win.reduce((s, x) => {
          const hx = x.hitting; if (!hx) return s
          return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2 * Number(hx.triples ?? 0) + 3 * Number(hx.homeRuns ?? 0)
        }, 0)
        if (ab <= 0) continue
        const denom = ab + bb + hbp + sf
        const obp = denom > 0 ? (h + bb + hbp) / denom : 0
        out.push(obp + tb / ab)               // OPS = OBP + SLG
      }
    }
    return out
  }

  const recent = chrono.slice(isPitcher ? -12 : -15)
  let series = build(recent, isPitcher ? 3 : 5)
  if (series.length < 4) series = build(recent, isPitcher ? 2 : 3)  // sparse log: shrink window

  return series
}

// League-average baseline for the sparkline, in the same units/orientation as the
// series (hitter OPS as-is; pitcher ERA negated). Aggregated from all 30 teams' totals
// and fetched once per session, so the gray dashed line reads as "above / below league".
let _leagueAvgPromise: Promise<{ ops: number | null; eraNeg: number | null }> | null = null
function fetchLeagueAverages() {
  if (!_leagueAvgPromise) {
    _leagueAvgPromise = (async () => {
      try {
        const base = `https://statsapi.mlb.com/api/v1/teams/stats?season=${CURRENT_SEASON}&sportId=1&stats=season`
        const [hitRes, pitRes] = await Promise.all([
          fetch(`${base}&group=hitting`).then(r => r.json()),
          fetch(`${base}&group=pitching`).then(r => r.json()),
        ])
        const hitSplits = (hitRes?.stats ?? []).flatMap((s: any) => s.splits ?? [])
        let h = 0, ab = 0, bb = 0, hbp = 0, sf = 0, tb = 0
        hitSplits.forEach((sp: any) => {
          const st = sp.stat ?? {}
          h += Number(st.hits ?? 0);        ab  += Number(st.atBats ?? 0)
          bb += Number(st.baseOnBalls ?? 0); hbp += Number(st.hitByPitch ?? 0)
          sf += Number(st.sacFlies ?? 0);    tb  += Number(st.totalBases ?? 0)
        })
        const denom = ab + bb + hbp + sf
        const ops = ab > 0 ? (denom > 0 ? (h + bb + hbp) / denom : 0) + tb / ab : null

        const pitSplits = (pitRes?.stats ?? []).flatMap((s: any) => s.splits ?? [])
        let er = 0, ip = 0
        pitSplits.forEach((sp: any) => {
          const st = sp.stat ?? {}
          er += Number(st.earnedRuns ?? 0); ip += parseIP(st.inningsPitched ?? '0')
        })
        const eraNeg = ip > 0 ? -(er * 9) / ip : null

        return { ops, eraNeg }
      } catch { return { ops: null, eraNeg: null } }
    })()
  }
  return _leagueAvgPromise
}

function PlayerSparkline({ id, isPitcher }: { id: number; isPitcher: boolean }) {
  const isDark = useIsDark()
  const [series, setSeries] = useState<number[] | null>(() => _sparkCache.get(id) ?? null)
  const [baseline, setBaseline] = useState<number | null>(null)
  const [tipOpen, setTipOpen] = useState(false)   // explainer popup (hover on desktop, tap on mobile)

  useEffect(() => {
    if (_sparkCache.has(id)) { setSeries(_sparkCache.get(id)!); return }
    let cancelled = false
    loadGameLog(id, isPitcher)
      .then(games => {
        const s = computeSparkSeries(games, isPitcher)
        _sparkCache.set(id, s)
        if (!cancelled) setSeries(s)
      })
      .catch(() => { if (!cancelled) setSeries([]) })
    return () => { cancelled = true }
  }, [id, isPitcher])

  // Gray dashed reference = league average (not the player's own), in series units.
  useEffect(() => {
    let cancelled = false
    fetchLeagueAverages().then(la => { if (!cancelled) setBaseline(isPitcher ? la.eraNeg : la.ops) })
    return () => { cancelled = true }
  }, [isPitcher])

  if (!series || series.length < 3) return null
  const n = series.length

  // Momentum uses the series' own spread; the y-range additionally includes the
  // baseline so the reference line never clips when recent form is far from the norm.
  const sMin = Math.min(...series), sMax = Math.max(...series)
  const seriesSpread = (sMax - sMin) || 1
  const min = baseline != null ? Math.min(sMin, baseline) : sMin
  const max = baseline != null ? Math.max(sMax, baseline) : sMax
  const spread = (max - min) || 1

  const W = 100, H = 24, padY = 3
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => padY + (1 - (v - min) / spread) * (H - 2 * padY)
  const d = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  // Momentum: mean of the recent half vs. the earlier half, scaled by the series spread.
  const half = Math.max(1, Math.floor(n / 2))
  const earlyMean = series.slice(0, half).reduce((s, v) => s + v, 0) / half
  const lateMean  = series.slice(n - half).reduce((s, v) => s + v, 0) / half
  const norm = (lateMean - earlyMean) / seriesSpread
  const color = norm > 0.12 ? '#22c55e' : norm < -0.12 ? '#ef4444' : (isDark ? '#64748b' : '#9ca3af')

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: '100%', height: 22, display: 'block', overflow: 'visible' }}>
      {/* League-average baseline — faint dashed reference behind the form line */}
      {baseline != null && (
        <line x1={0} y1={y(baseline)} x2={W} y2={y(baseline)}
          stroke="currentColor" strokeOpacity={0.32} strokeWidth={1}
          strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  // Brief plain-language explainer — opens on hover (desktop) or tap (mobile).
  return (
    <ClickAwayListener onClickAway={() => setTipOpen(false)}>
      <Tooltip
        open={tipOpen}
        onClose={() => setTipOpen(false)}
        placement="top"
        arrow
        disableFocusListener disableHoverListener disableTouchListener
        title="Recent form over the last several games. Green means heating up, red means cooling off. The dashed line is the league average."
        slotProps={{ tooltip: { sx: { maxWidth: 200, fontSize: '0.66rem', lineHeight: 1.45, fontWeight: 500, p: 1 } } }}
      >
        <Box
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
          onClick={e => { e.stopPropagation(); setTipOpen(o => !o) }}
          sx={{ width: '100%', display: 'flex', alignItems: 'center', cursor: 'help' }}
        >
          {svg}
        </Box>
      </Tooltip>
    </ClickAwayListener>
  )
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchFollowedPlayerData(id: number, fresh = false): Promise<FollowedPlayerInfo | null> {
  try {
    const season = CURRENT_SEASON
    const [detRes, hitRes, pitRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`).then(r => r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=hitting&season=${season}`).then(r => r.json()).catch(() => null),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${season}`).then(r => r.json()).catch(() => null),
    ])
    const p = detRes.people?.[0]
    if (!p) return null
    const isPitcher = p.primaryPosition?.code === '1'
    const hitStat   = hitRes?.stats?.[0]?.splits?.[0]?.stat ?? null
    const pitStat   = pitRes?.stats?.[0]?.splits?.[0]?.stat ?? null

    let stats: StatCell[] = []
    if (!isPitcher && hitStat) {
      stats = [
        { label: 'AVG',  value: hitStat.avg ?? '—' },
        { label: 'HR',   value: String(hitStat.homeRuns ?? '—') },
        { label: 'OPS',  value: hitStat.ops ?? '—' },
      ]
    } else if (isPitcher && pitStat) {
      stats = [
        { label: 'ERA',  value: pitStat.era ?? '—' },
        { label: 'K',    value: String(pitStat.strikeOuts ?? '—') },
        { label: 'WHIP', value: pitStat.whip ?? '—' },
      ]
    }

    // If they've played today, that line is the more interesting number — it takes
    // over the stat cells and the season totals step aside until tomorrow.
    const today = todayStatCells(await loadGameLog(id, isPitcher, fresh), isPitcher)
    if (today) stats = today

    return {
      id: p.id,
      fullName:  p.fullName ?? '',
      position:  p.primaryPosition?.abbreviation ?? p.primaryPosition?.code ?? '?',
      teamAbbr:  TEAM_ABBR[Number(p.currentTeam?.id ?? 0)] ?? p.currentTeam?.abbreviation ?? '',
      teamId:    Number(p.currentTeam?.id ?? 0),
      isPitcher,
      stats,
      playedToday: today != null,
    }
  } catch { return null }
}

// "Mookie Betts" → "M. Betts". Used when the full name doesn't fit the row.
function abbreviateFirstName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2 || !parts[0]) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// ─── FollowedPlayerRow ────────────────────────────────────────────────────────

function FollowedPlayerRow({ id, data, isLive, move, editMode, isSelected, onToggleSelect, onClick }: {
  id:             number
  data:           FollowedPlayerInfo | null
  isLive:         boolean
  move:           RosterMove | null
  editMode:       boolean
  isSelected:     boolean
  onToggleSelect: () => void
  onClick:        () => void
}) {
  const teamColor  = TEAM_BG[data?.teamId ?? 0] ?? '#444'
  const subtitle   = data ? [data.position, data.teamAbbr].filter(Boolean).join(' · ') : ''
  const playedToday = !!data?.playedToday
  const statCells  = (data?.stats && data.stats.length > 0)
    ? data.stats
    : [{ label: '···', value: '—' }, { label: '···', value: '—' }, { label: '···', value: '—' }]

  const fullName  = data?.fullName ?? '…'
  const shortName = abbreviateFirstName(fullName)
  // Crop the first name to an initial only when the full name would overflow the row.
  const nameBoxRef  = useRef<HTMLDivElement>(null)
  const fullNameRef = useRef<HTMLSpanElement>(null)
  const [abbrevName, setAbbrevName] = useState(false)
  useLayoutEffect(() => {
    const box = nameBoxRef.current, full = fullNameRef.current
    if (!box || !full) return
    const measure = () => setAbbrevName(full.scrollWidth > box.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [fullName])

  const nameSx = { fontWeight: 700, fontSize: { xs: '0.78rem', sm: '0.82rem' }, lineHeight: 1.2 }

  return (
    <Box
      onClick={editMode ? onToggleSelect : onClick}
      sx={{
        display: 'flex', alignItems: 'center',
        gap: { xs: 1, sm: 1.5 },
        px: 1.5, py: 0.9,
        cursor: 'pointer', borderRadius: 1.5,
        transition: 'background 0.12s',
        bgcolor: isSelected ? `${ACCENT}14` : 'transparent',
        '&:hover': { bgcolor: isSelected ? `${ACCENT}1e` : 'action.hover' },
      }}
    >
      {/* Selection circle — edit mode */}
      {editMode && (
        <Box sx={{
          flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
          border: '2px solid', borderColor: isSelected ? ACCENT : 'text.disabled',
          bgcolor: isSelected ? ACCENT : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
          color: '#fff', fontSize: '0.6rem', fontWeight: 900, lineHeight: 1,
        }}>
          {isSelected && '✓'}
        </Box>
      )}

      {/* Headshot */}
      <Box sx={{
        position: 'relative', flexShrink: 0,
        width: 30, height: 38, borderRadius: 1,
        overflow: 'hidden', bgcolor: 'action.hover',
        border: `2px solid ${teamColor}50`,
      }}>
        <Box
          component="img"
          src={HEADSHOT(id)}
          alt={data?.fullName ?? ''}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        />
        {isLive && (
          <Box sx={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            bgcolor: 'rgba(239,68,68,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            py: '1.5px',
          }}>
            <Typography sx={{ fontSize: '0.37rem', fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '0.5px' }}>
              LIVE
            </Typography>
          </Box>
        )}
      </Box>

      {/* Name + pos/team — grows to absorb the gap so the sparkline can stay narrow */}
      <Box ref={nameBoxRef} sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {/* Hidden full-name measurer — decides whether to crop the first name */}
        <Box component="span" ref={fullNameRef} aria-hidden sx={{
          ...nameSx, position: 'absolute', top: 0, left: 0,
          visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {fullName}
        </Box>
        <Typography sx={{
          ...nameSx,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {abbrevName ? shortName : fullName}
        </Typography>
        {(subtitle || move || playedToday) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, overflow: 'hidden' }}>
            {subtitle && (
              <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                {subtitle}
              </Typography>
            )}
            {/* Flags that the stat cells hold today's game line, not season totals */}
            {playedToday && (
              <Box component="span" sx={{
                px: 0.5, py: '1px', borderRadius: 999, flexShrink: 0,
                bgcolor: `${ACCENT}1c`, border: `1px solid ${ACCENT}55`,
                fontSize: '0.5rem', fontWeight: 800, color: ACCENT,
                letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.4,
                whiteSpace: 'nowrap',
              }}>
                {isLive ? 'Live' : 'Today'}
              </Box>
            )}
            {move && (() => {
              const style = MOVE_STYLE[move.typeCode] ?? { label: move.typeDesc, color: '#94a3b8' }
              // Past tense reads better on a player badge; only the trade label differs
              const label = move.typeCode === 'TR' ? 'Traded' : style.label
              return (
                <Tooltip arrow placement="top" title={move.description || move.typeDesc}>
                  <Box component="span" sx={{
                    px: 0.5, py: '1px', borderRadius: 999, flexShrink: 0,
                    bgcolor: `${style.color}1c`, border: `1px solid ${style.color}55`,
                    fontSize: '0.5rem', fontWeight: 800, color: style.color,
                    letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.4,
                    whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </Box>
                </Tooltip>
              )
            })()}
          </Box>
        )}
      </Box>

      {/* Recent-form sparkline — fixed narrow width so the trend's slope reads clearly.
          Extra right margin sets it apart from the stat columns. */}
      <Box sx={{ flexShrink: 0, width: { xs: 46, sm: 62 }, mr: { xs: 1, sm: 1.5 }, display: 'flex', alignItems: 'center' }}>
        {data && <PlayerSparkline id={id} isPitcher={data.isPitcher} />}
      </Box>

      {/* Stat cells */}
      {statCells.map((s, idx) => (
        <Box key={idx} sx={{ flexShrink: 0, textAlign: 'right', minWidth: { xs: 28, sm: 36 } }}>
          <Typography sx={{
            fontWeight: 800, fontSize: { xs: '0.8rem', sm: '0.88rem' }, lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums', color: 'text.primary',
          }}>
            {s.value}
          </Typography>
          <Typography sx={{
            fontSize: '0.52rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.4,
            color: playedToday ? ACCENT : 'text.disabled', lineHeight: 1,
          }}>
            {s.label}
          </Typography>
        </Box>
      ))}

    </Box>
  )
}

// ─── FollowedPlayersSection ───────────────────────────────────────────────────

export function FollowedPlayersSection({ followedPlayerIds, onUnfollow, onPlayerClick, onFollow, liveTeamIds, compact, teamId }: {
  followedPlayerIds: number[]
  onUnfollow:    (id: number) => void
  onPlayerClick: (id: number) => void
  onFollow:      (id: number) => void
  liveTeamIds?:  Set<number>
  compact?:      boolean
  teamId?:       number
}) {
  const [playerData, setPlayerData]     = useState<Record<number, FollowedPlayerInfo>>({})
  const [adding, setAdding]             = useState(false)

  // Recent notable moves keyed by player — badge source. fetchRosterMoves is
  // module-cached, so this shares the Roster Moves card's single fetch. Moves
  // arrive newest-first; the first one seen per player wins.
  //
  // Unlike the Roster Moves card (a historical log, where "Suspended on Jul 12"
  // stays true forever), this badge reads as the player's *current* state — so
  // suspensions the player has already served are dropped first, letting an
  // older move surface in their place.
  const [playerMoves, setPlayerMoves] = useState<Map<number, RosterMove>>(new Map())
  useEffect(() => {
    fetchRosterMoves().then(async moves => {
      const served = await fetchServedSuspensionIds(moves)
      const byPlayer = new Map<number, RosterMove>()
      for (const m of moves) {
        if (m.typeCode === 'SU' && served.has(m.playerId)) continue
        if (!byPlayer.has(m.playerId)) byPlayer.set(m.playerId, m)
      }
      setPlayerMoves(byPlayer)
    }).catch(() => {})
  }, [])
  const [addQuery, setAddQuery]         = useState('')
  const [addResults, setAddResults]     = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [suggestions, setSuggestions]   = useState<SuggestionPlayer[]>([])
  const [editMode, setEditMode]         = useState(false)
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const [expanded, setExpanded]         = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)   // portaled search/suggestions Popper content
  const isDark = useIsDark()

  // Only a preview of the list shows by default — 3 rows on phones (vertical space is
  // precious) and 5 from sm up — behind a "View all" toggle. Which rows are dropped is
  // decided in CSS per breakpoint rather than by slicing, so the card reflows on resize
  // without a media-query hook. Edit mode force-expands so every player is selectable.
  const showAll     = expanded || editMode
  const overflowsXs = followedPlayerIds.length > FOLLOWED_PREVIEW_XS
  const overflowsSm = followedPlayerIds.length > FOLLOWED_PREVIEW_SM
  const atLimit     = followedPlayerIds.length >= MAX_FOLLOWED_PLAYERS

  useEffect(() => {
    for (const id of followedPlayerIds) {
      if (playerData[id]) continue
      fetchFollowedPlayerData(id).then(data => {
        if (data) setPlayerData(prev => ({ ...prev, [id]: data }))
      }).catch(() => {})
    }
  }, [followedPlayerIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // While a followed player's team is playing, their line is today's box score — so
  // refresh just those players on a slow poll. Read through a ref so new data doesn't
  // restart the timer.
  const playerDataRef = useRef(playerData)
  playerDataRef.current = playerData
  useEffect(() => {
    if (!liveTeamIds || liveTeamIds.size === 0) return
    const t = setInterval(() => {
      for (const id of followedPlayerIds) {
        const d = playerDataRef.current[id]
        if (!d || !liveTeamIds.has(d.teamId)) continue
        fetchFollowedPlayerData(id, true).then(next => {
          if (next) setPlayerData(prev => ({ ...prev, [id]: next }))
        }).catch(() => {})
      }
    }, 60_000)
    return () => clearInterval(t)
  }, [liveTeamIds, followedPlayerIds])

  useEffect(() => {
    if (!adding || !teamId) return
    fetchSuggestions(teamId, followedPlayerIds).then(setSuggestions).catch(() => {})
  }, [adding, teamId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (addQuery.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      setAddSearching(true)
      try { setAddResults((await searchPlayers(addQuery)).slice(0, 6)) }
      finally { setAddSearching(false) }
    }, 320)
    return () => clearTimeout(t)
  }, [addQuery])

  useEffect(() => {
    if (!adding) return
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      // The dropdown is portaled out of the card (to escape overflow:hidden), so a
      // click on a result isn't inside headerRef — check the dropdown too, or the
      // result would unmount on mousedown before its click could register.
      const inHeader   = headerRef.current?.contains(target)
      const inDropdown = dropdownRef.current?.contains(target)
      if (!inHeader && !inDropdown) {
        setAdding(false); setAddQuery(''); setAddResults([])
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [adding])

  const handleAdd = (p: Player) => {
    onFollow(p.id)
    setAdding(false); setAddQuery(''); setAddResults([])
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const exitEditMode = () => { setEditMode(false); setSelected(new Set()) }

  const handleDeleteSelected = () => {
    selected.forEach(id => onUnfollow(id))
    exitEditMode()
  }

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark),
      bgcolor: 'background.paper', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <Box ref={headerRef} sx={{
        px: 1.5, py: compact ? 1.1 : 1.4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid', borderColor: 'divider',
        gap: 0.5, minHeight: 40,
        position: 'relative',
      }}>
        {/* Title — hidden while search is open */}
        {!adding && (
          <Typography sx={{
            fontWeight: 800,
            fontSize: compact ? '0.65rem' : '0.72rem',
            textTransform: 'uppercase', letterSpacing: 1.2,
            color: editMode ? 'text.secondary' : ACCENT,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'color 0.15s',
          }}>
            {editMode
              ? (selected.size > 0 ? `${selected.size} selected` : 'Tap to select')
              : (compact ? '★ Players' : '★ Your Players')}
          </Typography>
        )}

        {/* Inline search input — takes over the title area */}
        {adding && (
          <InputBase
            autoFocus
            placeholder="Search player…"
            value={addQuery}
            onChange={e => setAddQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAdding(false); setAddQuery(''); setAddResults([]) }
            }}
            sx={{
              flex: 1,
              fontSize: compact ? '0.8rem' : '0.875rem',
              '& input': { p: 0 },
            }}
          />
        )}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
          {editMode ? (
            <>
              {selected.size > 0 && (
                <Box onClick={handleDeleteSelected} sx={pillSx('#ef4444', compact)}>
                  Remove {selected.size}
                </Box>
              )}
              <Box onClick={exitEditMode} sx={pillSx(ACCENT, compact)}>
                Done
              </Box>
            </>
          ) : (
            <>
              {!adding && followedPlayerIds.length > 0 && (
                <Box onClick={() => { setEditMode(true); setAdding(false); setAddQuery(''); setAddResults([]) }}
                  sx={pillSx(ACCENT, compact)}>
                  ✎ Edit
                </Box>
              )}
              {atLimit && !adding ? (
                /* Following cap reached — the pill turns into a quiet counter */
                <Tooltip arrow placement="top"
                  title={`You can follow up to ${MAX_FOLLOWED_PLAYERS} players. Remove one to add another.`}>
                  <Box sx={{
                    ...pillSx(ACCENT, compact),
                    color: 'text.disabled', borderColor: 'divider',
                    cursor: 'default', '&:hover': { bgcolor: 'transparent' },
                  }}>
                    {MAX_FOLLOWED_PLAYERS}/{MAX_FOLLOWED_PLAYERS}
                  </Box>
                </Tooltip>
              ) : (
                <Box
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => { setAdding(a => !a); setAddQuery(''); setAddResults([]) }}
                  sx={pillSx(ACCENT, compact)}
                >
                  {adding ? '✕' : '+ Add'}
                </Box>
              )}
            </>
          )}
        </Box>

        {/* Search + suggestions dropdown — portaled via Popper so the card's
            overflow:hidden can't clip it (it used to get cut off on short cards). */}
        <Popper
          open={adding && (addResults.length > 0 || addSearching || (addQuery.length < 2 && suggestions.length > 0))}
          anchorEl={headerRef.current}
          placement="bottom-start"
          style={{ zIndex: 1500 }}
          modifiers={[{
            // Match the dropdown to the header's width. Measured by popper AFTER layout
            // (reading offsetWidth during render returns a stale/transitional value).
            name: 'matchWidth',
            enabled: true,
            phase: 'beforeWrite',
            requires: ['computeStyles'],
            fn: ({ state }) => { state.styles.popper.width = `${state.rects.reference.width}px` },
            effect: ({ state }) => {
              state.elements.popper.style.width = `${(state.elements.reference as HTMLElement).offsetWidth}px`
            },
          }]}
        >
          <Box ref={dropdownRef} sx={{ mt: 0.5 }}>
            {/* Search results */}
            {(addResults.length > 0 || addSearching) && (
              <Box sx={{
                bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                borderRadius: 2, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              }}>
                {addSearching && !addResults.length && (
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Searching…</Typography>
                  </Box>
                )}
                {addResults.map((p, i) => (
                  <Box
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    sx={{
                      px: 1.5, py: 0.9, cursor: 'pointer',
                      borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                      display: 'flex', alignItems: 'center', gap: 1.25,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box sx={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0 }}>
                      <Box component="img" src={HEADSHOT(p.id)}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.fullName}
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                        {p.primaryPosition?.name}{!p.active ? ' · retired' : ''}
                      </Typography>
                    </Box>
                    {followedPlayerIds.includes(p.id) && (
                      <Typography sx={{ fontSize: '0.6rem', color: ACCENT, fontWeight: 700, ml: 'auto', flexShrink: 0 }}>
                        ✓
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {/* Suggestions (empty query) */}
            {addQuery.length < 2 && suggestions.length > 0 && (
              <Box sx={{
                bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75,
              }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled', px: 0.25 }}>
                  Suggested
                </Typography>
                {suggestions.map(p => (
                  <SuggestionChip
                    key={p.id}
                    large
                    player={p}
                    alreadyFollowed={followedPlayerIds.includes(p.id)}
                    onFollow={() => { onFollow(p.id); setAdding(false); setAddQuery(''); setAddResults([]) }}
                    onPlayerClick={onPlayerClick}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Popper>
      </Box>

      {/* ── Player rows ───────────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {followedPlayerIds.length === 0 ? (
          <Box sx={{ py: compact ? 2.5 : 3.5, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.disabled', fontSize: compact ? '0.72rem' : '0.82rem', mb: 0.5, lineHeight: 1.4 }}>
              {compact ? 'No players yet' : 'No players followed yet'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'flex', flexDirection: 'column', py: 0.5, flex: 1, minHeight: 0, overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'transparent transparent',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: 'transparent', borderRadius: 2 },
            '&:hover': {
              scrollbarColor: 'rgba(128,128,128,0.35) transparent',
              '&::-webkit-scrollbar-thumb': { background: 'rgba(128,128,128,0.35)' },
            },
          }}>
            {followedPlayerIds.map((id, i) => {
              const data   = playerData[id] ?? null
              const isLive = !!(liveTeamIds && data?.teamId && liveTeamIds.has(data.teamId))
              return (
                <Box key={id} sx={{
                  display: {
                    xs: !showAll && i >= FOLLOWED_PREVIEW_XS ? 'none' : 'block',
                    sm: !showAll && i >= FOLLOWED_PREVIEW_SM ? 'none' : 'block',
                  },
                }}>
                  {i > 0 && <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.5 }} />}
                  <FollowedPlayerRow
                    id={id}
                    data={data}
                    isLive={isLive}
                    move={playerMoves.get(id) ?? null}
                    editMode={editMode}
                    isSelected={selected.has(id)}
                    onToggleSelect={() => toggleSelect(id)}
                    onClick={() => onPlayerClick(id)}
                  />
                </Box>
              )
            })}
          </Box>
        )}

        {/* View all / show less — hidden at a breakpoint where nothing is being cut off,
            and while editing (edit mode already shows the full list). */}
        {!editMode && overflowsXs && (
          <Box
            onClick={() => setExpanded(e => !e)}
            sx={{
              display: { xs: 'flex', sm: overflowsSm ? 'flex' : 'none' },
              alignItems: 'center', justifyContent: 'center', gap: 0.5,
              px: 1.5, py: 0.75, cursor: 'pointer', flexShrink: 0,
              borderTop: '1px solid', borderColor: 'divider',
              color: ACCENT, fontSize: compact ? '0.62rem' : '0.66rem',
              fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
              userSelect: 'none',
              transition: 'background 0.12s',
              '&:hover': { bgcolor: `${ACCENT}12` },
            }}
          >
            {expanded ? 'Show less' : `View all ${followedPlayerIds.length}`}
            <Box component="span" sx={{
              fontSize: '0.7rem', lineHeight: 1,
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}>
              ▾
            </Box>
          </Box>
        )}

      </Box>
    </Box>
  )
}
