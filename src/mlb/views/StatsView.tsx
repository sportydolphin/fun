import React, { useEffect, useRef } from 'react'
import { Box, Typography, Paper, CircularProgress } from '@mui/material'
import { LbFullscreenState, LeaderboardEntry } from '../types'
import { ACCENT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED } from '../constants'
import { SegControl, pillActionSx } from '../components/ui'
import { filterQualified } from '../lib/utils'

export interface StatsViewProps {
  lbGroup: 'hitting' | 'pitching'
  setLbGroup: (g: 'hitting' | 'pitching') => void
  vizSeason: number
  setVizSeason: (s: number) => void
  allTime: boolean
  setAllTime: (b: boolean) => void
  lbData: LeaderboardEntry[] | null
  lbFullscreen: LbFullscreenState | null
  setLbFullscreen: (s: LbFullscreenState | null | ((prev: LbFullscreenState | null) => LbFullscreenState | null)) => void
  lbStatsLimit: number
  setLbStatsLimit: (n: number | ((prev: number) => number)) => void
  lbQualified: boolean
  setLbQualified: (q: boolean | ((prev: boolean) => boolean)) => void
  isDesktop: boolean
  canHover: boolean
  handleLbPlayerClick: (playerId: number) => void
  highlightPlayerId?: number | null
  highlightStatKey?: string | null
  setHighlightPlayerId?: (id: number | null) => void
  setHighlightStatKey?: (key: string | null) => void
}

export function StatsView({
  lbGroup, setLbGroup, vizSeason, setVizSeason, allTime, setAllTime,
  lbData, lbFullscreen, setLbFullscreen,
  lbStatsLimit, setLbStatsLimit,
  lbQualified, setLbQualified,
  isDesktop, canHover, handleLbPlayerClick,
  highlightPlayerId, highlightStatKey,
  setHighlightPlayerId, setHighlightStatKey,
}: StatsViewProps) {
  const highlightRowRef = useRef<HTMLElement | null>(null)
  const highlightColRef = useRef<HTMLElement | null>(null)

  // Scroll the highlighted row+column into view whenever they change or data loads
  useEffect(() => {
    if (!highlightPlayerId) return
    const timer = setTimeout(() => {
      if (highlightColRef.current) {
        // Focused cell: center both row (block) and column (inline)
        highlightColRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      } else if (highlightRowRef.current) {
        highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [highlightPlayerId, highlightStatKey, lbData])
  const statDefs = lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
  const sortKey   = lbFullscreen?.sortKey   ?? LB_FEATURED[lbGroup][0]
  const sortAsc   = lbFullscreen?.sortAsc   ?? (statDefs.find(d => d.key === sortKey)?.lowerIsBetter ?? false)
  const activeDef = statDefs.find(d => d.key === sortKey) ?? statDefs[0]

  // ── What a reversed sort means in all-time mode ───────────────────────
  // The career pool is a union of per-stat *leaders*, not the ~22k-player
  // population, so reversing a sort locally doesn't find the league's worst — it
  // finds the weakest leader, which is a number about nothing.
  //
  // Rate stats escape this: api.ts also fetches the worst-qualified end of each
  // one, so the ascending pool holds the players who genuinely belong there.
  // Counting stats don't and can't — the bottom of career home runs is thousands
  // of players tied on zero — so their sort is locked to the leaders' direction.
  const reversible = !allTime || activeDef.isRate
  const effectiveAsc = reversible ? sortAsc : (activeDef.lowerIsBetter ?? false)

  // ── Qualification filter ──────────────────────────────────────────────
  // Only meaningful for rate stats (AVG, ERA…). Counting stats (SB, HR, saves…)
  // must never be qualified — a part-time player can legitimately lead them.
  const qualifiedPool = (() => {
    const all = lbData ?? []
    // All-time rate stats: restrict to the career Qualified pool. Players who
    // arrived via a counting-stat sort carry no PA/IP guarantee, and one of them
    // slipping in would quietly corrupt both ends of the board. filterQualified
    // can't do this job — its thresholds are season-based and would nuke everyone
    // when measured against career totals.
    if (allTime) return activeDef.isRate ? all.filter(e => e.qualified) : all
    return lbQualified && activeDef.isRate ? filterQualified(all, lbGroup) : all
  })()

  const sortedEntries = qualifiedPool
    .map(e => {
      const v = Number(activeDef.leaderValue ? activeDef.leaderValue(e.stat) : activeDef.getValue(e.stat))
      return { ...e, _v: v }
    })
    .filter(e => !isNaN(e._v))
    .sort((a, b) => effectiveAsc ? a._v - b._v : b._v - a._v)
    .slice(0, lbStatsLimit)

  const MEDALS_FS = ['🥇', '🥈', '🥉']
  const colPx = isDesktop ? '10px' : '5px'
  const stThSx = {
    py: 1, px: colPx,
    fontSize: '0.68rem', fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: '0.5px',
    whiteSpace: 'nowrap' as const,
  }
  const stTdSx = {
    py: '7px', px: colPx,
    borderBottom: '1px solid', borderColor: 'divider',
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'middle' as const,
  }
  const abbrevName = (name: string) => {
    const i = name.indexOf(' ')
    return i < 0 ? name : `${name[0]}. ${name.slice(i + 1)}`
  }
  // A counting stat in all-time mode has only one honest direction, so clicking
  // its header again re-sorts rather than flipping.
  const canReverse = (def: any) => !allTime || def.isRate
  const handleColClick = (def: any) => {
    const natural = def.lowerIsBetter ?? false
    const newAsc = sortKey === def.key && canReverse(def) ? !sortAsc : natural
    setLbFullscreen(prev => prev
      ? { ...prev, sortKey: def.key, sortAsc: newAsc }
      : { def: activeDef, group: lbGroup, sortKey: def.key, sortAsc: newAsc, entries: [] }
    )
    // Clear card-stat highlight when user manually re-sorts
    setHighlightPlayerId?.(null)
    setHighlightStatKey?.(null)
  }

  // Total players with a valid value — used for rank numbering and the footer count
  const totalInDataset = qualifiedPool.filter(e => {
    const v = Number(activeDef.leaderValue ? activeDef.leaderValue(e.stat) : activeDef.getValue(e.stat))
    return !isNaN(v)
  }).length

  const loadingLb = lbData == null

  return (
    <Box>
      {/* Controls row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, gap: 1 }}>
        <SegControl
          options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
          value={lbGroup}
          onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
          <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
            <select
              value={allTime ? 'all' : String(vizSeason)}
              onChange={e => {
                const v = e.target.value
                if (v === 'all') { setAllTime(true); setLbStatsLimit(50) }
                else { setAllTime(false); setVizSeason(Number(v)); setLbStatsLimit(50) }
                setLbFullscreen(null)
              }}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 12px', borderRadius: 999, fontFamily: 'inherit' }}>
              <option value="all">All-Time</option>
              {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Box>
          {/* Qualified / All toggle — only meaningful for rate stats; the all-time pool
              is already curated per stat, so the toggle is hidden there */}
          {activeDef.isRate && !allTime && (
            <Box
              onClick={() => { setLbQualified(q => !q); setLbStatsLimit(50) }}
              sx={{
                ...pillActionSx,
                borderColor: lbQualified ? ACCENT : 'divider',
                color: lbQualified ? ACCENT : 'text.secondary',
                bgcolor: lbQualified ? `${ACCENT}12` : 'transparent',
                cursor: 'pointer', userSelect: 'none',
                display: 'flex', alignItems: 'center', gap: 0.4,
                whiteSpace: 'nowrap',
              }}
            >
              {lbQualified ? '✓ Qual' : 'All'}
            </Box>
          )}
        </Box>
      </Box>

      {loadingLb && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingLb && lbData && (
        <Paper elevation={2} sx={{
          borderRadius: { xs: 0, sm: 3 },
          overflow: 'hidden',
          mx: { xs: -2, sm: 0 },
          boxShadow: { xs: 'none', sm: undefined },
        }}>
          {/* Table header strip */}
          <Box sx={{
            px: { xs: 2, sm: 3 }, py: 1.5,
            background: `linear-gradient(135deg, ${ACCENT}18 0%, transparent 100%)`,
            borderBottom: '1px solid', borderColor: 'divider',
            display: 'flex', alignItems: 'baseline', gap: 1.5,
          }}>
            <Typography sx={{ fontWeight: 900, fontSize: { xs: '1rem', sm: '1.15rem' }, letterSpacing: '-0.3px' }}>
              {activeDef.leaderLabel ?? activeDef.label}
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              {allTime ? 'All-Time · Career' : `${vizSeason} MLB`}
              {/* Say which population this is: an all-time rate board is qualified
                  players only, and reversing it shows the worst of them, not the
                  worst of everyone who ever played. */}
              {allTime && activeDef.isRate ? ' · Qualified' : ''}
              {allTime && !activeDef.isRate ? ' · Leaders' : ''}
              {activeDef.lowerIsBetter ? ' · lower = better' : ''}
            </Typography>
          </Box>

          {/* Scrollable table — overflow both axes so sticky thead works vertically.
              Divide 100vh by --app-zoom: inside the desktop `zoom` wrapper, viewport
              units aren't shrunk, so the visible height in this scaled coordinate
              space is 100vh / zoom. (--app-zoom defaults to 1 → unchanged off desktop.) */}
          <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh / var(--app-zoom, 1) - 280px)' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <Box component="thead">
                <Box component="tr">
                  {/* Sticky player-name column header */}
                  <Box component="th" sx={{
                    ...stThSx,
                    position: 'sticky', top: 0, left: 0, zIndex: 4,
                    bgcolor: 'background.paper',
                    textAlign: 'left',
                    borderBottom: '2px solid', borderColor: 'divider',
                    borderRight: '1px solid',
                    minWidth: isDesktop ? 180 : 120, color: 'text.disabled',
                    pl: isDesktop ? '16px' : '8px',
                    pr: isDesktop ? '12px' : '8px',
                  }}>
                    Player
                  </Box>
                  {/* Stat column headers */}
                  {statDefs.map(def => {
                    const isActive = def.key === sortKey
                    return (
                      <Box component="th" key={def.key}
                        title={
                          canReverse(def)
                            ? (def.leaderLabel ?? def.label)
                            : `${def.leaderLabel ?? def.label} — career leaders only. ` +
                              'The bottom of this stat is thousands of players tied on zero, ' +
                              'so there is no meaningful reverse order.'
                        }
                        onClick={() => handleColClick(def)}
                        sx={{
                          ...stThSx,
                          position: 'sticky', top: 0, zIndex: 3,
                          textAlign: 'right', cursor: 'pointer',
                          bgcolor: 'background.paper',
                          boxShadow: isActive ? `inset 0 0 0 9999px ${ACCENT}14` : 'none',
                          borderBottom: isActive ? `2px solid ${ACCENT}` : '2px solid',
                          borderColor: isActive ? ACCENT : 'divider',
                          color: isActive ? ACCENT : 'text.disabled',
                          '&:hover': { boxShadow: `inset 0 0 0 9999px ${ACCENT}18`, color: ACCENT },
                          transition: 'background 0.15s, color 0.15s',
                          userSelect: 'none',
                        }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
                          {def.label}
                          {isActive && (
                            <Box component="span" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                              {effectiveAsc ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>

              <Box component="tbody">
                {sortedEntries.map((e, idx) => {
                  const stat = e.stat
                  // Rank 1 = best. Descending: row 0 is best → rank 1, 2, 3…
                  // Ascending: row 0 is worst → rank total, total-1, total-2…
                  const displayRank = idx + 1
                  const isHighlighted = e.playerId === highlightPlayerId
                  return (
                    <Box component="tr" key={e.playerId}
                      ref={isHighlighted ? (el: HTMLElement | null) => { highlightRowRef.current = el } : undefined}
                      onClick={() => handleLbPlayerClick(e.playerId)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isHighlighted ? `${ACCENT}10` : undefined,
                        '&:hover > td': { bgcolor: isHighlighted ? `${ACCENT}18` : `${ACCENT}0e` },
                        transition: 'background 0.2s',
                      }}
                    >
                      {/* Sticky player cell */}
                      <Box component="th" sx={{
                        ...stTdSx, textAlign: 'left',
                        position: 'sticky', left: 0, zIndex: 2,
                        bgcolor: 'background.paper',
                        boxShadow: isHighlighted ? `inset 0 0 0 9999px ${ACCENT}10` : 'none',
                        fontWeight: 'normal',
                        pl: isDesktop ? '16px' : '8px',
                        borderRight: isHighlighted ? `2px solid ${ACCENT}` : '1px solid',
                        borderColor: isHighlighted ? ACCENT : 'divider',
                        pr: isDesktop ? '12px' : '8px',
                        'tr:hover > &': { boxShadow: `inset 0 0 0 9999px ${isHighlighted ? ACCENT + '18' : ACCENT + '0e'}` },
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: isDesktop ? 1 : 0.6 }}>
                          <Typography sx={{
                            fontSize: displayRank <= 3 ? '0.9rem' : '0.82rem', fontWeight: 800,
                            color: 'text.disabled',
                            minWidth: isDesktop ? 22 : 28,
                            textAlign: 'center', flexShrink: 0, lineHeight: 1,
                          }}>
                            {displayRank <= 3 ? MEDALS_FS[displayRank - 1] : `${displayRank}`}
                          </Typography>
                          {isDesktop && (
                            <Box component="img"
                              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                              alt={e.playerName}
                              sx={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, bgcolor: 'action.hover' }}
                            />
                          )}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 700, fontSize: isDesktop ? '0.82rem' : '0.75rem', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isDesktop ? e.playerName : abbrevName(e.playerName)}
                            </Typography>
                            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
                              {e.teamAbbr}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>

                      {/* Stat value cells */}
                      {statDefs.map(def => {
                        const isActive   = def.key === sortKey
                        const isFocused  = isHighlighted && def.key === highlightStatKey
                        const val = def.format(def.getValue(stat))
                        return (
                          <Box component="td" key={def.key}
                            ref={isFocused ? (el: HTMLElement | null) => { highlightColRef.current = el } : undefined}
                            sx={{
                            ...stTdSx, textAlign: 'right',
                            bgcolor: isFocused ? `${ACCENT}28` : isActive ? `${ACCENT}08` : undefined,
                            fontSize: isActive || isFocused ? '0.88rem' : '0.78rem',
                            fontWeight: isActive || isFocused ? 800 : 400,
                            color: isFocused ? ACCENT : isActive ? ACCENT : 'text.primary',
                            outline: isFocused ? `2px solid ${ACCENT}60` : undefined,
                            outlineOffset: '-2px',
                          }}>
                            {val}
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>

          {/* Load more / count footer */}
          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', fontWeight: 600 }}>
              Showing {sortedEntries.length} of {totalInDataset}
            </Typography>
            {lbStatsLimit < totalInDataset && (
              <Box
                onClick={() => setLbStatsLimit(l => l + 50)}
                sx={{
                  cursor: 'pointer', userSelect: 'none',
                  fontSize: '0.72rem', fontWeight: 700,
                  color: 'text.disabled',
                  '&:hover': { color: ACCENT }, transition: 'color 0.15s',
                }}
              >
                Load 50 more ↓
              </Box>
            )}
          </Box>
        </Paper>
      )}
    </Box>
  )
}
