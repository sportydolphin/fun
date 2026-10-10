import React, { useEffect, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { LbFullscreenState, LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, TABLE_DEFAULT_SORT, CURRENT_SEASON } from '../constants'
import { pillActionSx } from '../components/ui'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL, CAREER_POST_MIN_PA, CAREER_POST_MIN_IP } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { scrollBehavior } from '../../lib/motion'
import { chromePx, typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { FilterChip } from '../../ui/FilterChip'
import { CARD_BORDER } from '../../ui/card'
import { pressable, FOCUS_RING } from '../../ui/interaction'
import { sortBoard, ascFor, isBestFirst, leagueLine } from '../lib/statsBoard'
import { printedRanks } from '../../ui/leaders'
import { LogoBubble } from '../components/boxScore'
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
  setLbStatsLimit,
  lbQualified, setLbQualified,
  isDesktop, handleLbPlayerClick,
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
  const sortKey   = lbFullscreen?.sortKey   ?? TABLE_DEFAULT_SORT[lbGroup]
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
  // Every row on both: the grid in a scroll box with its headers pinned, the phone's list ten at a
  // time and then all of them, as WPBL's do. Both paged by fifty until Oct 9, 2026.
  // Over the WHOLE pool rather than the qualified rows: the league's average is everyone's, and a
  // qualified-only figure would move when the reader flips the chip. Season boards only; see
  // leagueLine for why a career board has none.
  const league = !allTime && lbData ? leagueLine(lbData, lbGroup) : null

  // Competition ranks on the sorted column AS PRINTED, with ties marked, as WPBL's table numbers
  // its rows. They were positions with medals on the first three, which put a gold and a silver
  // between two players on the same 45 home runs.
  const ranks = printedRanks(rankedAll.map(e => activeDef.format(activeDef.getValue(e.stat))))
  const colPx = isDesktop ? chromePx(10) : chromePx(5)
  // WPBL's header: small heavy labels with the league's figure on a second line under each.
  const stThSx = {
    py: 0.75, px: colPx,
    fontSize: '0.6rem', fontWeight: 800,
    letterSpacing: typePx(0.4),
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'top' as const,
  }
  // THE LEAGUE AVERAGE, FOLDED INTO THE HEADER, as WPBL's table does it: the one line that never
  // scrolls away, so the average stays beside the label down the whole board. Every cell gets the
  // second line, blank or not, or the labels would sit at two heights.
  const headLeague = (text: string, align?: 'right') => (
    <Box data-league-head="" sx={{
      fontSize: '0.58rem', fontWeight: 600, letterSpacing: 0, lineHeight: 1.1, minHeight: '1.1em',
      mt: 0.25, color: 'text.secondary', textTransform: 'none', textAlign: align,
    }}>{text}</Box>
  )
  const leagueCell = (def: (typeof statDefs)[number]) =>
    league && def.isRate ? def.format(def.getValue(league)) : ''
  // WPBL's row: half a unit of padding, so a row is its text plus a 20px badge, about 42px.
  const stTdSx = {
    py: 0.5, px: colPx,
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
  // THE FOOT'S WORDS, in WPBL's words and order (its footWords): the count, who is counted, then
  // which games. Lower case and joined by dots, so a switch between the leagues reads one sentence.
  const scopeWord = allTime
    ? (shownScope === 'post' ? 'career playoffs' : 'career')
    : shownScope === 'post' ? `${vizSeason} playoffs` : shownScope === 'all' ? `${vizSeason} season + playoffs` : `${vizSeason} season`
  // Who is on the board. An all-time rate board is qualified players only (or a minimum we set, on
  // career playoffs), and a counting one is the leaders StatsAPI ranks, not everyone who played.
  const whoWord = allTime
    ? (activeDef.isRate
      ? (shownScope === 'post' ? `min ${lbGroup === 'hitting' ? `${CAREER_POST_MIN_PA} PA` : `${CAREER_POST_MIN_IP} IP`}` : 'qualified only')
      : 'leaders only')
    : activeDef.isRate && lbQualified ? 'qualified only' : null
  // `n` is null while loading, when the words need no data and the count does; `shown` is the
  // phone list's ten before it opens ("10 of 124 players").
  const footText = (n: number | null, shown?: number) =>
    [n == null ? null : shown != null && shown < n ? `${shown} of ${n} players` : `${n} players`, whoWord, scopeWord]
      .filter(Boolean).join(' · ')
    + (listView ? '' : ' · sort by any column heading')
  // THE BOARD'S LAST ROW, inside its frame, as WPBL's boardFooter is: what the board is counted from,
  // and on a phone the way between the list and the grid. The words were a caption above the list
  // and the switch a pill under the frame.
  const boardFoot = (n: number | null, shown?: number) => (
    <Box sx={TABLE_FOOT_SX}>
      <Typography sx={FOOT_TEXT_SX}>{footText(n, shown)}</Typography>
      {!isDesktop && (
        <Box {...pressable(toggleFullTable)} sx={{
          ...FOCUS_RING, ml: 'auto', flexShrink: 0, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
          minHeight: 34, px: 1.25, display: 'inline-flex', alignItems: 'center', borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER, fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        }}>{fullTable ? 'Ranked list' : 'Full table'}</Box>
      )}
    </Box>
  )
  const filtersSet = allTime || vizSeason !== CURRENT_SEASON || shownScope !== 'regular' || (activeDef.isRate && !allTime && !lbQualified)

  const pill = controlPill

  return (
    <Box>
      {/* Phone controls: the two that do the work, stating what they are set to. The grid's
          chips stay on desktop, where there is room for all of them and the headers already sort. */}
      {!isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
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
      {isDesktop && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
          />
          {/* Filters, so chips (src/ui/FilterChip), as WPBL's season / playoffs choice is. */}
          {scopes.map(sc => (
            <FilterChip key={sc} active={shownScope === sc} onClick={() => { setGameScope(sc); setLbStatsLimit(50) }}>
              {GAME_SCOPE_LABEL[sc]}
            </FilterChip>
          ))}
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
          {/* The qualifying bar, WPBL's "✓ Qualified" chip. Only meaningful for rate stats; the
              all-time pool is already curated per stat, so it is not offered there. */}
          {activeDef.isRate && !allTime && (
            <>
              <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
              <FilterChip active={lbQualified} onClick={() => { setLbQualified(q => !q); setLbStatsLimit(50) }}>
                {lbQualified ? '✓ Qualified' : 'Qualified'}
              </FilterChip>
            </>
          )}
        </Box>
      </Box>}

      {/* LOADING IS THE BOARD DRAWN EMPTY: its real title and subtitle, which need no data, over
          empty rows. It was a centred spinner, which left the footer in view on a phone. */}
      {loadingLb && listView && (
        <Box aria-hidden>
          <StatsRankedList skeleton rows={[]} def={activeDef} statDefs={statDefs} group={lbGroup} asc={effectiveAsc}
            onOpenPlayer={() => {}} footer={() => boardFoot(null)} />
        </Box>
      )}
      {loadingLb && !listView && (
        <Box aria-hidden sx={TABLE_FRAME_SX}>
          {/* The scroller at its cap, which a season's rows always fill. */}
          <Box sx={{ height: TABLE_MAX_H, px: 2, pt: 1 }}>
            {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} sx={{ fontSize: '1.6rem' }} />)}
          </Box>
          {boardFoot(null)}
        </Box>
      )}

      {!loadingLb && lbData && lbData.length === 0 && shownScope === 'post' && (
        <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
          No playoff games in {vizSeason}{vizSeason >= CURRENT_SEASON ? ' yet' : ''}.
        </Typography>
      )}

      {!loadingLb && lbData && lbData.length > 0 && listView && (
        <>
          {rankedAll.length === 0 ? (
            <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
              {/* Only point at Everyone where the sheet offers it: a rate stat on a season board. */}
              {activeDef.isRate && !allTime && lbQualified
                ? 'Nobody has qualified yet. Filters → Everyone shows the whole roster.'
                : 'Nobody on this board yet.'}
            </Typography>
          ) : (
            // Keyed on everything that reorders or repopulates the board, so "Show all" closes
            // again when the reader changes what they are looking at.
            <StatsRankedList key={`${lbGroup}|${sortKey}|${effectiveAsc}|${allTime}|${vizSeason}|${shownScope}|${lbQualified}`}
              rows={rankedAll} def={activeDef} statDefs={statDefs} group={lbGroup} asc={effectiveAsc}
              highlightPlayerId={highlightPlayerId} league={leagueCell(activeDef) || null}
              onOpenPlayer={handleLbPlayerClick} footer={shown => boardFoot(totalInDataset, shown)} />
          )}
        </>
      )}

      {!loadingLb && lbData && lbData.length > 0 && !listView && (
        <Box sx={TABLE_FRAME_SX}>

          {/* Scrollable table, overflow both axes so sticky thead works vertically. The 280 is
              the chrome above it, so it scales with that chrome; 100vh is plain screen height,
              which it is again now that the section has no `zoom` to divide out. */}
          <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: TABLE_MAX_H }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
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
                    PLAYER
                    {headLeague(league ? 'League avg' : '', 'right')}
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
                          textAlign: 'center', cursor: 'pointer',
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
                            <Box component="span" sx={{ fontSize: '0.62rem' }}>
                              {effectiveAsc ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                        {headLeague(leagueCell(def))}
                      </Box>
                    )
                  })}
                </Box>
              </Box>

              <Box component="tbody">
                {rankedAll.map((e, idx) => {
                  const stat = e.stat
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {/* Flex-end so a wide tied rank ("T-24") overflows into the padding on
                              its left rather than into the badge. */}
                          <Typography sx={{ width: '1.5rem', display: 'flex', justifyContent: 'flex-end', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            {ranks[idx].tied ? `T-${ranks[idx].rank}` : ranks[idx].rank}
                          </Typography>
                          {/* The club's mark where the headshot was, as WPBL's table draws it: a
                              face per row made every row 56px against WPBL's 42, and the player
                              card behind the tap already has the face. */}
                          {e.teamId > 0 && <LogoBubble teamId={e.teamId} abbr={e.teamAbbr} size={20} ring={1} />}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography {...playerLink(e.playerId, e.playerName, handleLbPlayerClick)} sx={{ ...LINK_SX, display: 'block', fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isDesktop ? e.playerName : abbrevName(e.playerName)}
                            </Typography>
                            <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>
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
                            ...stTdSx, textAlign: 'center',
                            // WPBL's cell: the sorted column a step bigger, heavier and tinted.
                            bgcolor: isFocused ? `${ACCENT}28` : isActive ? `${ACCENT}12` : undefined,
                            fontSize: isActive || isFocused ? '0.84rem' : '0.8rem',
                            fontWeight: isActive || isFocused ? 800 : 500,
                            color: isFocused || isActive ? 'var(--wpbl-accent-fg)' : 'text.primary',
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

          {boardFoot(totalInDataset)}
        </Box>
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

// WPBL's board frame: a hairline card, no raised paper and no title strip. Edge to edge on a
// phone's full table, where the gutter is worth a column.
const TABLE_FRAME_SX = {
  border: '1px solid', borderColor: CARD_BORDER, borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden',
  bgcolor: 'background.paper', mx: { xs: -2, sm: 0 }, borderLeftWidth: { xs: 0, sm: 1 }, borderRightWidth: { xs: 0, sm: 1 },
} as const
/** The scroll box's cap, WPBL's own (its season table's desktop measure), so the two tables are the
 *  same height on a switch: they were 593 and 683 at 1440x900. One value for the board and its
 *  skeleton. */
const TABLE_MAX_H = 'calc(100dvh - 260px)'
const TABLE_FOOT_SX = { px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 } as const
const FOOT_TEXT_SX = { fontSize: '0.66rem', color: 'text.disabled', fontWeight: 600, minWidth: 0 } as const
