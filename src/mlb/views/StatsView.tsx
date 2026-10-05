import React, { useEffect, useRef, useState } from 'react'
import { Box, Typography, Paper, CircularProgress } from '@mui/material'
import { LbFullscreenState, LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, LB_FEATURED, CURRENT_SEASON } from '../constants'
import { pillActionSx } from '../components/ui'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL, CAREER_POST_MIN_PA, CAREER_POST_MIN_IP } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { scrollBehavior } from '../../lib/motion'
import { chromePx, typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { pressable, FOCUS_RING } from '../../ui/interaction'
import { sortBoard, ascFor, isBestFirst } from '../lib/statsBoard'
import { StatsRankedList, StatsSortSheet, StatsFilterSheet, readFullTable, writeFullTable, controlPill } from './StatsRankedList'
import { playerLink, rowClick, LINK_SX } from '../lib/links'

export interface StatsViewProps {
  lbGroup: 'hitting' | 'pitching'
  setLbGroup: (g: 'hitting' | 'pitching') => void
  vizSeason: number
  setVizSeason: (s: number) => void
  allTime: boolean
  setAllTime: (b: boolean) => void
  gameScope: GameScope
  setGameScope: (s: GameScope) => void
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
  lbGroup, setLbGroup, vizSeason, setVizSeason, allTime, setAllTime, gameScope, setGameScope,
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
        highlightColRef.current.scrollIntoView({ behavior: scrollBehavior(), block: 'center', inline: 'center' })
      } else if (highlightRowRef.current) {
        highlightRowRef.current.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
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
  // population, so reversing a sort locally doesn't find the league's worst. It
  // finds the weakest leader, which is a number about nothing.
  //
  // Rate stats escape this: api.ts also fetches the worst-qualified end of each
  // one, so the ascending pool holds the players who belong there.
  // Counting stats don't and can't (the bottom of career home runs is thousands
  // of players tied on zero), so their sort is locked to the leaders' direction.
  const reversible = !allTime || activeDef.isRate
  const effectiveAsc = reversible ? sortAsc : (activeDef.lowerIsBetter ?? false)

  // ── Qualification filter ──────────────────────────────────────────────
  // Only meaningful for rate stats (AVG, ERA…). Counting stats (SB, HR, saves…)
  // must never be qualified: a part-time player can legitimately lead them.
  const qualifiedPool = (() => {
    const all = lbData ?? []
    // All-time rate stats: restrict to the career Qualified pool. Players who
    // arrived via a counting-stat sort carry no PA/IP guarantee, and one of them
    // slipping in would quietly corrupt both ends of the board. filterQualified
    // can't do this job: its thresholds are season-based and would nuke everyone
    // when measured against career totals.
    if (allTime) return activeDef.isRate ? all.filter(e => e.qualified) : all
    return lbQualified && activeDef.isRate ? filterQualified(all, lbGroup, gameScope) : all
  })()

  const rankedAll = sortBoard(qualifiedPool, activeDef, effectiveAsc)
  const sortedEntries = rankedAll.slice(0, lbStatsLimit)

  const MEDALS_FS = ['🥇', '🥈', '🥉']
  const colPx = isDesktop ? chromePx(10) : chromePx(5)
  const stThSx = {
    py: 1, px: colPx,
    fontSize: '0.68rem', fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: typePx(0.5),
    whiteSpace: 'nowrap' as const,
  }
  const stTdSx = {
    py: chromePx(7), px: colPx,
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

  // Total players with a valid value, used for rank numbering and the footer count
  const totalInDataset = rankedAll.length

  // ── Phones get a ranked list, not the grid ────────────────────────────
  // The grid is a spreadsheet in a nested scroller at 375px, ranked by a column that is off the
  // screen. See StatsRankedList. `fullTable` is the reader's way back to it.
  const [fullTable, setFullTable] = useState(readFullTable)
  const [sortOpen, setSortOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const listView = !isDesktop && !fullTable
  const toggleFullTable = () => { const next = !fullTable; setFullTable(next); writeFullTable(next) }
  const pickSort = (def: (typeof statDefs)[number]) => {
    // A new stat is a new board, so it starts at the first page again; the list closes back to
    // ten on its own (it is keyed on sortKey), and a raised limit would make it offer "Show 150".
    if (def.key !== sortKey) { handleColClick(def); setLbStatsLimit(50) }
  }
  const setDirection = (bestFirst: boolean) => {
    const asc = ascFor(activeDef, bestFirst)
    setLbFullscreen(prev => prev
      ? { ...prev, sortAsc: asc }
      : { def: activeDef, group: lbGroup, sortKey, sortAsc: asc, entries: [] })
    setHighlightPlayerId?.(null)
    setHighlightStatKey?.(null)
  }

  const loadingLb = lbData == null
  // Career has no "All" (see fetchAllTimeLeaderboardData): the option is not offered there, and a
  // reader who had it chosen sees the regular season, which is what the board then shows.
  const scopes = allTime ? GAME_SCOPES.filter(s => s !== 'all') : GAME_SCOPES
  const shownScope: GameScope = allTime && gameScope === 'all' ? 'regular' : gameScope
  const scopeNote = shownScope === 'post' ? ' · Playoffs' : shownScope === 'all' ? ' · Regular + playoffs' : ''

  // Say which population this is: an all-time rate board is qualified players only, and reversing
  // it shows the worst of them, not the worst of everyone who ever played.
  const populationNote =
    (allTime && activeDef.isRate
      ? shownScope === 'post' ? ` · Min ${lbGroup === 'hitting' ? `${CAREER_POST_MIN_PA} PA` : `${CAREER_POST_MIN_IP} IP`}` : ' · Qualified'
      : '') +
    (allTime && !activeDef.isRate ? ' · Leaders' : '') +
    (activeDef.lowerIsBetter ? ' · lower = better' : '')
  const boardSubtitle = `${allTime ? 'All-Time · Career' : `${vizSeason} MLB`}${scopeNote}${populationNote}`
  const filtersSet = allTime || vizSeason !== CURRENT_SEASON || shownScope !== 'regular' || (activeDef.isRate && !allTime && !lbQualified)

  const pill = controlPill

  return (
    <Box>
      {/* Phone controls: the two that do the work, stating what they are set to. The grid's
          chips stay on desktop, where there is room for all of them and the headers already sort. */}
      {!isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
          />
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {listView && (
              <Box {...pressable(() => setSortOpen(true))} aria-haspopup="dialog" aria-expanded={sortOpen} sx={pill(true)}>
                {/* Reversed is the state a reader forgets they set, and the pill is the only control
                    they look at again. It replaces "Sort" rather than adding a word: at 375px this row
                    has no room for one, and a wider pill wraps the whole row onto two lines. */}
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 700 }}>{isBestFirst(activeDef, effectiveAsc) ? 'Sort' : 'Worst'}</Box>
                {activeDef.label}
                <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
              </Box>
            )}
            {/* One pill for season, games and the qualifying bar. The dot says only that
                something is off its default, so a filter can never be silently on. */}
            <Box {...pressable(() => setFiltersOpen(true))} aria-haspopup="dialog" aria-expanded={filtersOpen} sx={pill(filtersSet)}>
              Filters
              {filtersSet && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT }} />}
              <Box component="span" sx={{ fontSize: '0.6rem' }}>▾</Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Controls row */}
      {isDesktop && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
          />
          <PillGroup
            options={scopes.map(s => ({ value: s, label: GAME_SCOPE_LABEL[s] }))}
            value={shownScope}
            onChange={v => { setGameScope(v as GameScope); setLbStatsLimit(50) }}
          />
        </Box>
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
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: `${chromePx(6)} ${chromePx(12)}`, borderRadius: 999, fontFamily: 'inherit' }}>
              <option value="all">All-Time</option>
              {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Box>
          {/* Qualified / All toggle, only meaningful for rate stats; the all-time pool
              is already curated per stat, so the toggle is hidden there */}
          {activeDef.isRate && !allTime && (
            <Box
              onClick={() => { setLbQualified(q => !q); setLbStatsLimit(50) }}
              sx={{
                ...pillActionSx,
                borderColor: lbQualified ? ACCENT : 'divider',
                color: lbQualified ? ACCENT_TEXT : 'text.secondary',
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
      </Box>}

      {loadingLb && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingLb && lbData && lbData.length === 0 && shownScope === 'post' && (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          No playoff games in {vizSeason}{vizSeason >= CURRENT_SEASON ? ' yet' : ''}.
        </Typography>
      )}

      {!loadingLb && lbData && lbData.length > 0 && listView && (
        <>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: typePx(1), mb: 0.75 }}>
            {boardSubtitle}
          </Typography>
          {rankedAll.length === 0 ? (
            <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
              {/* Only point at Everyone where the sheet offers it: a rate stat on a season board. */}
              {activeDef.isRate && !allTime && lbQualified
                ? 'Nobody has qualified yet. Filters → Everyone shows the whole roster.'
                : 'Nobody on this board yet.'}
            </Typography>
          ) : (
            // Keyed on everything that reorders or repopulates the board, so "Show 50" closes
            // again when the reader changes what they are looking at.
            <StatsRankedList key={`${lbGroup}|${sortKey}|${effectiveAsc}|${allTime}|${vizSeason}|${shownScope}|${lbQualified}`}
              rows={sortedEntries} def={activeDef} statDefs={statDefs} group={lbGroup} asc={effectiveAsc}
              highlightPlayerId={highlightPlayerId} total={totalInDataset} limit={lbStatsLimit}
              onOpenPlayer={handleLbPlayerClick} onMore={() => setLbStatsLimit(l => l + 50)} />
          )}
        </>
      )}

      {!loadingLb && lbData && lbData.length > 0 && !listView && (
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
            <Typography sx={{ fontWeight: 900, fontSize: { xs: '1rem', sm: '1.15rem' }, letterSpacing: typePx(-0.3) }}>
              {activeDef.leaderLabel ?? activeDef.label}
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: typePx(1) }}>
              {boardSubtitle}
            </Typography>
          </Box>

          {/* Scrollable table, overflow both axes so sticky thead works vertically. The 280 is
              the chrome above it, so it scales with that chrome; 100vh is plain screen height,
              which it is again now that the section has no `zoom` to divide out. */}
          <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: `calc(100vh - ${chromePx(280)})` }}>
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
                    minWidth: isDesktop ? chromePx(180) : chromePx(120), color: 'text.disabled',
                    pl: isDesktop ? chromePx(16) : chromePx(8),
                    pr: isDesktop ? chromePx(12) : chromePx(8),
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
                            : `${def.leaderLabel ?? def.label}. Career leaders only. ` +
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
                          color: isActive ? ACCENT_TEXT : 'text.disabled',
                          '&:hover': { boxShadow: `inset 0 0 0 9999px ${ACCENT}18`, color: ACCENT_TEXT },
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
                      {...rowClick(() => handleLbPlayerClick(e.playerId))}
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
                        pl: isDesktop ? chromePx(16) : chromePx(8),
                        borderRight: isHighlighted ? `2px solid ${ACCENT}` : '1px solid',
                        borderColor: isHighlighted ? ACCENT : 'divider',
                        pr: isDesktop ? chromePx(12) : chromePx(8),
                        'tr:hover > &': { boxShadow: `inset 0 0 0 9999px ${isHighlighted ? ACCENT + '18' : ACCENT + '0e'}` },
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: isDesktop ? 1 : 0.6 }}>
                          <Typography sx={{
                            fontSize: displayRank <= 3 ? '0.9rem' : '0.82rem', fontWeight: 800,
                            color: 'text.disabled',
                            minWidth: isDesktop ? '1.375rem' : '1.75rem',
                            textAlign: 'center', flexShrink: 0, lineHeight: 1,
                          }}>
                            {displayRank <= 3 ? MEDALS_FS[displayRank - 1] : `${displayRank}`}
                          </Typography>
                          {isDesktop && (
                            <Box component="img"
                              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                              alt={e.playerName}
                              sx={{ width: chromePx(28), height: chromePx(28), borderRadius: '50%', objectFit: 'cover', flexShrink: 0, bgcolor: 'action.hover' }}
                            />
                          )}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography {...playerLink(e.playerId, e.playerName, handleLbPlayerClick)} sx={{ ...LINK_SX, display: 'block', fontWeight: 700, fontSize: isDesktop ? '0.82rem' : '0.75rem', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                            color: isFocused ? ACCENT_TEXT : isActive ? ACCENT_TEXT : 'text.primary',
                            // Inset ring (not `outline`): an outline paints in a late phase and
                            // escapes this border-collapse table's stacking, so it bled over the
                            // sticky player-name column when the row scrolled under it. An inset
                            // box-shadow is clipped to the cell and paints at the cell's stacking
                            // level, so the sticky name (z-index 2) stays in front.
                            boxShadow: isFocused ? `inset 0 0 0 2px ${ACCENT}60` : undefined,
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
                  '&:hover': { color: ACCENT_TEXT }, transition: 'color 0.15s',
                }}
              >
                Load 50 more ↓
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Phones only: the way between the list and the grid, under the board where it is not in the
          way of the thing most readers came for. */}
      {!isDesktop && !loadingLb && lbData && lbData.length > 0 && (
        <Box {...pressable(toggleFullTable)} sx={{
          ...FOCUS_RING, mt: 1.5, mx: 'auto', width: 'fit-content', cursor: 'pointer', userSelect: 'none',
          minHeight: 34, px: 1.5, display: 'flex', alignItems: 'center', borderRadius: 999,
          border: '1px solid', borderColor: 'divider', fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        }}>{fullTable ? 'Ranked list' : 'Full table'}</Box>
      )}

      {sortOpen && listView && (
        <StatsSortSheet statDefs={statDefs} group={lbGroup} sortKey={sortKey} asc={effectiveAsc}
          reversible={reversible} onPick={pickSort} onDirection={setDirection}
          onClose={() => setSortOpen(false)} />
      )}
      {filtersOpen && !isDesktop && (
        <StatsFilterSheet
          seasonValue={allTime ? 'all' : String(vizSeason)}
          onSeason={v => {
            if (v === 'all') setAllTime(true)
            else { setAllTime(false); setVizSeason(Number(v)) }
            setLbStatsLimit(50); setLbFullscreen(null)
          }}
          scope={shownScope} scopes={scopes} onScope={s => { setGameScope(s); setLbStatsLimit(50) }}
          canQualify={activeDef.isRate && !allTime} qualified={lbQualified}
          onQualified={() => { setLbQualified(q => !q); setLbStatsLimit(50) }}
          onClose={() => setFiltersOpen(false)} />
      )}
    </Box>
  )
}
