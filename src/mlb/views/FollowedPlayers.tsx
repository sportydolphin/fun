import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, InputBase } from '@mui/material'
import { Player, RecentGameEntry } from '../types'
import { TEAM_BG, TEAM_ABBR, ACCENT, HEADSHOT, CURRENT_SEASON } from '../constants'
import { searchPlayers, fetchRecentGames } from '../api'
import { parseIP } from '../utils'
import { fetchSuggestions, SuggestionChip, SuggestionPlayer } from './SuggestedPlayers'
import { useIsDark, defaultBorder } from '../colorUtils'

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
// rising, red falling, gray flat. A faint dashed line marks the player's season
// average, so the form line reads as above / below their own norm.

interface SparkData { series: number[]; baseline: number | null }
const _sparkCache = new Map<number, SparkData>()

function computeSparkSeries(games: RecentGameEntry[], isPitcher: boolean): SparkData {
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

  // Season baseline — the player's whole-season norm in the same units/orientation
  // as the series, so the form line can be read as "above / below their average".
  let baseline: number | null = null
  if (isPitcher) {
    const er = chrono.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
    const ip = chrono.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
    if (ip > 0) baseline = -(er * 9) / ip
  } else {
    const h   = chrono.reduce((s, x) => s + Number(x.hitting?.hits        ?? 0), 0)
    const ab  = chrono.reduce((s, x) => s + Number(x.hitting?.atBats      ?? 0), 0)
    const bb  = chrono.reduce((s, x) => s + Number(x.hitting?.baseOnBalls ?? 0), 0)
    const hbp = chrono.reduce((s, x) => s + Number(x.hitting?.hitByPitch  ?? 0), 0)
    const sf  = chrono.reduce((s, x) => s + Number(x.hitting?.sacFlies    ?? 0), 0)
    const tb  = chrono.reduce((s, x) => {
      const hx = x.hitting; if (!hx) return s
      return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2 * Number(hx.triples ?? 0) + 3 * Number(hx.homeRuns ?? 0)
    }, 0)
    if (ab > 0) baseline = (ab + bb + hbp + sf > 0 ? (h + bb + hbp) / (ab + bb + hbp + sf) : 0) + tb / ab
  }

  return { series, baseline }
}

function PlayerSparkline({ id, isPitcher }: { id: number; isPitcher: boolean }) {
  const isDark = useIsDark()
  const [data, setData] = useState<SparkData | null>(() => _sparkCache.get(id) ?? null)

  useEffect(() => {
    if (_sparkCache.has(id)) { setData(_sparkCache.get(id)!); return }
    let cancelled = false
    fetchRecentGames(id, [isPitcher ? 'pitching' : 'hitting'], CURRENT_SEASON)
      .then(games => {
        const d = computeSparkSeries(games, isPitcher)
        _sparkCache.set(id, d)
        if (!cancelled) setData(d)
      })
      .catch(() => { if (!cancelled) setData({ series: [], baseline: null }) })
    return () => { cancelled = true }
  }, [id, isPitcher])

  if (!data || data.series.length < 3) return null
  const { series, baseline } = data
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: '100%', height: 22, display: 'block', overflow: 'visible' }}>
      {/* Season-average baseline — faint dashed reference behind the form line */}
      {baseline != null && (
        <line x1={0} y1={y(baseline)} x2={W} y2={y(baseline)}
          stroke="currentColor" strokeOpacity={0.32} strokeWidth={1}
          strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchFollowedPlayerData(id: number): Promise<FollowedPlayerInfo | null> {
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

    return {
      id: p.id,
      fullName:  p.fullName ?? '',
      position:  p.primaryPosition?.abbreviation ?? p.primaryPosition?.code ?? '?',
      teamAbbr:  TEAM_ABBR[Number(p.currentTeam?.id ?? 0)] ?? p.currentTeam?.abbreviation ?? '',
      teamId:    Number(p.currentTeam?.id ?? 0),
      isPitcher,
      stats,
    }
  } catch { return null }
}

// ─── FollowedPlayerRow ────────────────────────────────────────────────────────

function FollowedPlayerRow({ id, data, isLive, editMode, isSelected, onRemove, onToggleSelect, onClick }: {
  id:             number
  data:           FollowedPlayerInfo | null
  isLive:         boolean
  editMode:       boolean
  isSelected:     boolean
  onRemove:       () => void
  onToggleSelect: () => void
  onClick:        () => void
}) {
  const teamColor  = TEAM_BG[data?.teamId ?? 0] ?? '#444'
  const subtitle   = data ? [data.position, data.teamAbbr].filter(Boolean).join(' · ') : ''
  const statCells  = (data?.stats && data.stats.length > 0)
    ? data.stats
    : [{ label: '···', value: '—' }, { label: '···', value: '—' }, { label: '···', value: '—' }]

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
        ...(!editMode && { '&:hover .fp-remove': { opacity: 1 } }),
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
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontWeight: 700, fontSize: { xs: '0.78rem', sm: '0.82rem' }, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {data?.fullName ?? '…'}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1.3 }}>
            {subtitle}
          </Typography>
        )}
      </Box>

      {/* Recent-form sparkline — fixed narrow width so the trend's slope reads clearly */}
      <Box sx={{ flexShrink: 0, width: { xs: 46, sm: 62 }, display: 'flex', alignItems: 'center' }}>
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
            color: 'text.disabled', lineHeight: 1,
          }}>
            {s.label}
          </Typography>
        </Box>
      ))}

      {/* Remove button — normal mode */}
      {!editMode && (
        <Box
          className="fp-remove"
          onClick={e => { e.stopPropagation(); onRemove() }}
          sx={{
            flexShrink: 0,
            width: 20, height: 20, borderRadius: '50%',
            bgcolor: 'transparent', color: 'text.disabled',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer',
            opacity: 0, transition: 'opacity 0.12s',
            '&:hover': { bgcolor: 'error.main', color: '#fff' },
          }}
        >
          ✕
        </Box>
      )}
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
  const [addQuery, setAddQuery]         = useState('')
  const [addResults, setAddResults]     = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [suggestions, setSuggestions]   = useState<SuggestionPlayer[]>([])
  const [editMode, setEditMode]         = useState(false)
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const headerRef = useRef<HTMLDivElement>(null)
  const isDark = useIsDark()

  useEffect(() => {
    for (const id of followedPlayerIds) {
      if (playerData[id]) continue
      fetchFollowedPlayerData(id).then(data => {
        if (data) setPlayerData(prev => ({ ...prev, [id]: data }))
      }).catch(() => {})
    }
  }, [followedPlayerIds]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
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
              <Box
                onMouseDown={e => e.stopPropagation()}
                onClick={() => { setAdding(a => !a); setAddQuery(''); setAddResults([]) }}
                sx={pillSx(ACCENT, compact)}
              >
                {adding ? '✕' : '+ Add'}
              </Box>
            </>
          )}
        </Box>

        {/* Search results dropdown */}
        {adding && (addResults.length > 0 || addSearching) && (
          <Box sx={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
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

        {/* Suggestions dropdown */}
        {adding && addQuery.length < 2 && suggestions.length > 0 && (
          <Box sx={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
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
                player={p}
                alreadyFollowed={followedPlayerIds.includes(p.id)}
                onFollow={() => { onFollow(p.id); setAdding(false); setAddQuery(''); setAddResults([]) }}
                onPlayerClick={onPlayerClick}
              />
            ))}
          </Box>
        )}
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
                <React.Fragment key={id}>
                  {i > 0 && <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.5 }} />}
                  <FollowedPlayerRow
                    id={id}
                    data={data}
                    isLive={isLive}
                    editMode={editMode}
                    isSelected={selected.has(id)}
                    onRemove={() => onUnfollow(id)}
                    onToggleSelect={() => toggleSelect(id)}
                    onClick={() => onPlayerClick(id)}
                  />
                </React.Fragment>
              )
            })}
          </Box>
        )}

        {/* Wide add button — always visible below last player, hidden while search or edit is open */}
        {!editMode && !adding && (
          <Box
            onClick={() => { setAdding(true); setAddQuery(''); setAddResults([]) }}
            sx={{
              mx: 1.5, mt: 0.5, mb: 1,
              py: 0.85,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 2,
              border: '1.5px dashed', borderColor: 'divider',
              cursor: 'pointer', color: 'text.disabled',
              fontSize: '0.75rem', fontWeight: 600,
              transition: 'border-color 0.15s, color 0.15s, background 0.15s',
              '&:hover': { borderColor: ACCENT, color: ACCENT, bgcolor: `${ACCENT}08` },
            }}
          >
            + Add Player
          </Box>
        )}
      </Box>
    </Box>
  )
}
