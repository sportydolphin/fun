import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { LbFullscreenState, LeaderboardEntry } from '../types'
import { ACCENT, ACCENT_TEXT, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_SEASONS, TABLE_DEFAULT_SORT, CURRENT_SEASON } from '../constants'
import { filterQualified } from '../lib/utils'
import { GAME_SCOPES, GAME_SCOPE_LABEL, CAREER_POST_MIN_PA, CAREER_POST_MIN_IP } from '../lib/gameScope'
import type { GameScope } from '../lib/gameScope'
import { scrollBehavior } from '../../lib/motion'
import { typePx } from '../../ui/scale'
import { PillGroup } from '../../ui/PillGroup'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import { CARD_BORDER } from '../../ui/card'
import { pressable, FOCUS_RING } from '../../ui/interaction'
import { sortBoard, ascFor, isBestFirst, leagueLine } from '../lib/statsBoard'
import { printedRanks } from '../../ui/leaders'
import { ExpandRow, TABLE_CAP } from '../../ui/ExpandRow'
import { StatsBar, STATS_BOARD_ROOT_SX, STATS_BOARD_TOP } from './StatsBar'
import { BOTTOM_NAV_SPACE } from '../../ui/BottomNav'
import { usePanelActive } from '../../lib/panelActive'
import { useAxisLock } from '../../ui/useAxisLock'
import { HEAD_LABEL_SX, HEAD_LEAGUE_SX, HEAD_LEAGUE_TINT } from '../../ui/statsTableHead'
import { fetchSeasonSabermetrics, fetchParkFactors } from '../apiSeasonStats'
import { withAdvanced, advancedLeague, HITTING_ADVANCED_DEFS, PITCHING_ADVANCED_DEFS, ADVANCED_ORDER, SABERMETRIC_KEYS, PARK_ADJUSTED_KEYS } from '../lib/advanced'
import type { Sabermetric, StatsView as TableView } from '../lib/advanced'
import { LogoBubble } from '../components/boxScore'
import { StatsRankedList, StatsSortSheet, StatsFilterSheet, readFullTable, writeFullTable, controlPill } from './StatsRankedList'
import { playerLink, rowClick, LINK_SX } from '../lib/links'
import { TABLE_FRAME_SX, TABLE_MAX_H, NAME_W, NAME_INNER_MAX, ROW_TINT_VAR, ROW_TINT, TABLE_FOOT_SX, FOOT_TEXT_SX, RankMarkText, frozenSx, FROZEN_EDGE } from './statsTable'

export interface StatsViewProps {
  /** The Stats tab's board row, which the pinned bar carries (StatsBar). */
  boardTabs: React.ReactNode
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
  boardTabs, lbGroup, setLbGroup, vizSeason, setVizSeason, allTime, setAllTime, gameScope, setGameScope,
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
  // ── Standard and Advanced, WPBL's two views of the same board ──────────
  // Advanced is computed from the season line already in hand (lib/advanced.ts), except wOBA and
  // wRC+, which only StatsAPI's sabermetrics has and only for a regular season: elsewhere those two
  // columns are not offered at all, rather than offered blank.
  const sabermetricsPossible = lbGroup === 'hitting' && !allTime && shownScopeFor(allTime, gameScope) === 'regular'
  const standardDefs = lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
  const allDefs = [...standardDefs, ...(lbGroup === 'hitting' ? HITTING_ADVANCED_DEFS : PITCHING_ADVANCED_DEFS)
    .filter(d => sabermetricsPossible || !SABERMETRIC_KEYS.has(d.key))]
  const advancedDefs = ADVANCED_ORDER[lbGroup]
    .map(k => allDefs.find(d => d.key === k))
    .filter((d): d is (typeof allDefs)[number] => !!d)
  const defsFor = (v: TableView) => (v === 'advanced' ? advancedDefs : standardDefs)
  // A sort the board cannot show (wOBA on the playoffs, a stale address) falls back to its default.
  const requestedSort = lbFullscreen?.sortKey ?? TABLE_DEFAULT_SORT[lbGroup]
  const sortValid = allDefs.some(d => d.key === requestedSort)
  const sortKey   = sortValid ? requestedSort : TABLE_DEFAULT_SORT[lbGroup]
  const activeDef = allDefs.find(d => d.key === sortKey) ?? allDefs[0]
  const sortAsc   = (sortValid ? lbFullscreen?.sortAsc : undefined) ?? (activeDef.lowerIsBetter ?? false)
  // Not in the address bar: it follows the sort, which is, as WPBL's does. A link sorted by wRC+
  // opens on Advanced because that is the only view with wRC+ in it.
  const [view, setView] = useState<TableView>(() => (defsFor('standard').some(d => d.key === sortKey) ? 'standard' : 'advanced'))
  const shownView: TableView = defsFor(view).some(d => d.key === sortKey) ? view : view === 'standard' ? 'advanced' : 'standard'
  useEffect(() => { if (shownView !== view) setView(shownView) }, [shownView, view])
  // The other way round: choosing a view that does not hold the sort re-sorts on the board's
  // default, which both views carry, rather than bouncing the reader back.
  const switchView = (v: TableView) => {
    if (v === shownView) return
    setView(v)
    if (!defsFor(v).some(d => d.key === sortKey)) setLbFullscreen(null)
  }
  const statDefs = defsFor(shownView)

  const needSabermetrics = sabermetricsPossible && (shownView === 'advanced' || SABERMETRIC_KEYS.has(sortKey))
  const [sabermetrics, setSabermetrics] = useState<{ season: number; map: Map<number, Sabermetric> } | null>(null)
  useEffect(() => {
    if (!needSabermetrics) return
    let live = true
    fetchSeasonSabermetrics(vizSeason).then(map => { if (live) setSabermetrics({ season: vizSeason, map }) })
    return () => { live = false }
  }, [needSabermetrics, vizSeason])
  const saberMap = sabermetricsPossible && sabermetrics?.season === vizSeason ? sabermetrics.map : null
  // OPS+ and ERA+ take the season's park factors, read on the same terms as sabermetrics: only once
  // a view or a sort shows one. A career board has no season to take them from and stays unadjusted.
  const needParks = !allTime && (shownView === 'advanced' || PARK_ADJUSTED_KEYS.has(sortKey))
  const [parks, setParks] = useState<{ season: number; map: Map<number, number> } | null>(null)
  useEffect(() => {
    if (!needParks) return
    let live = true
    fetchParkFactors(vizSeason).then(map => { if (live) setParks({ season: vizSeason, map }) })
    return () => { live = false }
  }, [needParks, vizSeason])
  const parkMap = allTime ? null : parks?.season === vizSeason ? parks.map : 'pending'
  // Every row with its advanced figures beside StatsAPI's, so a sort on either reads one line.
  const rows = useMemo(() => (lbData ? withAdvanced(lbData, lbGroup, saberMap, parkMap) : null), [lbData, lbGroup, saberMap, parkMap])

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
    const all = rows ?? []
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
  const league = !allTime && lbData
    ? (() => { const l = leagueLine(lbData, lbGroup); return l && { ...l, ...advancedLeague(lbData, lbGroup, saberMap) } })()
    : null

  // Competition ranks on the sorted column AS PRINTED, with ties marked, as WPBL's table numbers
  // its rows. They were positions with medals on the first three, which put a gold and a silver
  // between two players on the same 45 home runs.
  const ranks = printedRanks(rankedAll.map(e => activeDef.format(activeDef.getValue(e.stat))))
  // WPBL's header (thBase in src/wpbl/StatsView.tsx): small heavy labels, half a unit either side,
  // and no rule of its own: the first row's top border is the line under it. Two rows, the labels
  // and then the league, as src/ui/statsTableHead.ts explains. Until Oct 2026 this one drew a 2px
  // rule, an accent underline on the sorted column and twice WPBL's padding.
  const stThSx = {
    px: 0.5,
    fontSize: '0.6rem', fontWeight: 800,
    letterSpacing: typePx(0.4),
    whiteSpace: 'nowrap' as const,
    bgcolor: 'background.paper',
    ...HEAD_LABEL_SX,
  }
  const leagueCell = (def: (typeof statDefs)[number]) =>
    league && def.isRate ? def.format(def.getValue(league)) : ''
  // WPBL's row: half a unit of padding, so a row is its text plus a 20px badge, about 42px.
  const stTdSx = {
    py: 0.5, px: 0.5,
    borderTop: '1px solid', borderColor: 'divider',
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
  // THE PHONE'S FULL TABLE, WPBL's (pinActive in src/wpbl/StatsView.tsx) in every respect that a
  // reader feels: the sorted column frozen beside the name so the number the board is ranked on
  // never scrolls away, the board fitted between the pinned bar and the bottom nav, and vertical
  // scroll handed to the page until the board has pinned. Until Oct 2026 it was the desktop grid
  // shrunk, which ran under the bottom nav and fought the page for every drag.
  const phoneTable = !isDesktop && fullTable
  // The columns that scroll: on a phone, all but the frozen sorted one.
  const scrollDefs = phoneTable ? statDefs.filter(d => d.key !== activeDef.key) : statDefs
  const panelActive = usePanelActive()
  // Whether the bar is held under the toolbar (StatsBar). Before it is, the table is
  // `overflow-y: hidden`, which passes a drag on it through to the page, which carries the board up
  // until it pins; scrolling back up at the table's top chains to the page again and unpins it. The
  // nested scroll a native app does with a collapsing header. Without it a drag on the table scrolled
  // only the table, and its last rows and its foot sat behind the bottom nav for anyone who never
  // touched outside it.
  const [boardHeld, setBoardHeld] = useState(false)
  // THE SITE FOOTER STEPS ASIDE FOR THE PHONE'S FULL TABLE, as it does for WPBL's: the board has to
  // fit above everything that follows it to stay pinned, and the footer was most of that. Its links
  // are all in the bottom nav's More sheet. Safe for crawling for WPBL's reason: the full table is a
  // stored preference, off by default, so a crawler only ever renders the ranked list.
  useEffect(() => {
    if (!(phoneTable && panelActive)) return
    const root = document.documentElement
    root.setAttribute('data-mlb-stats-table', '')
    return () => root.removeAttribute('data-mlb-stats-table')
  }, [phoneTable, panelActive])
  // The board's foot is the one thing under the scroll box whose height varies (its words wrap, the
  // text size changes it), so it is measured and subtracted from the cap rather than guessed.
  const footRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = footRef.current
    if (!phoneTable || !el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--mlb-board-foot-h', `${el.getBoundingClientRect().height}px`)
    publish()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--mlb-board-foot-h') }
  })
  // The frozen columns' shadow onto the stats, shown once the table is off its left edge.
  const [atStart, setAtStart] = useState(true)

  // THE DESKTOP TABLE STOPS AT TABLE_CAP, as WPBL's does, with the rest one tap away. Open for one
  // board only: keyed on everything that reorders or repopulates it, as the phone list is, so a new
  // sort or season starts capped again. A highlighted player past the cap stretches it to include
  // them. The phone's full table is not capped (see TABLE_CAP).
  const boardKey = `${lbGroup}|${sortKey}|${effectiveAsc}|${allTime}|${vizSeason}|${shownScopeFor(allTime, gameScope)}|${lbQualified}`
  const [openBoard, setOpenBoard] = useState<string | null>(null)
  const tableOpen = openBoard === boardKey
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const hlIdx = highlightPlayerId != null ? rankedAll.findIndex(e => e.playerId === highlightPlayerId) : -1
  const tableCap = Math.max(TABLE_CAP, hlIdx + 1)
  const canCap = isDesktop && rankedAll.length > tableCap
  const tableRows = canCap && !tableOpen ? rankedAll.slice(0, tableCap) : rankedAll
  const closeTable = () => { setOpenBoard(null); tableScrollRef.current?.scrollTo({ top: 0 }) }
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

  // Ranked by wOBA or wRC+, or by a park-adjusted index before the factors land, the board waits for
  // them; anything else draws now and fills them in.
  const loadingLb = lbData == null || (needSabermetrics && !saberMap && SABERMETRIC_KEYS.has(sortKey))
    || (parkMap === 'pending' && PARK_ADJUSTED_KEYS.has(sortKey))
  // One axis per drag on the grid (src/ui/useAxisLock). Keyed on what mounts or replaces its scroll box.
  useAxisLock(tableScrollRef, `${listView}|${loadingLb}|${(lbData?.length ?? 0) > 0}`)
  // Career has no "All" (see fetchAllTimeLeaderboardData): the option is not offered there, and a
  // reader who had it chosen sees the regular season, which is what the board then shows.
  const scopes = allTime ? GAME_SCOPES.filter(s => s !== 'all') : GAME_SCOPES
  const shownScope: GameScope = shownScopeFor(allTime, gameScope)
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
  // rows on screen before the list or the table opens ("10 of 124 players", "25 of 124").
  const footText = (n: number | null, shown?: number) =>
    [n == null ? null : shown != null && shown < n ? `${shown} of ${n} players` : `${n} players`, whoWord, scopeWord]
      .filter(Boolean).join(' · ')
    + (listView ? '' : ' · sort by any column heading')
  // THE BOARD'S LAST ROW, inside its frame, as WPBL's boardFooter is: what the board is counted from,
  // and on a phone the way between the list and the grid. The words were a caption above the list
  // and the switch a pill under the frame.
  // THE PHONE'S TABLE SAYS ONLY WHAT IS NOT THE DEFAULT, WPBL's rule: the count is in the first
  // column's heading, and a line of words here is a row of players the capped board cannot show.
  const phoneWords = [
    allTime ? whoWord : activeDef.isRate && !lbQualified ? 'everyone' : null,
    allTime || shownScope !== 'regular' || vizSeason !== CURRENT_SEASON ? scopeWord : null,
  ].filter(Boolean).join(' · ')
  const boardFoot = (n: number | null, shown?: number) => (
    <Box ref={footRef} sx={{ ...TABLE_FOOT_SX, flexWrap: phoneTable ? 'wrap' : undefined }}>
      {phoneTable
        ? phoneWords && <Typography sx={{ ...FOOT_TEXT_SX, flexBasis: '100%' }}>{phoneWords}</Typography>
        : <Typography sx={FOOT_TEXT_SX}>{footText(n, shown)}</Typography>}
      {/* The phone's full table carries the view switch here, as WPBL's does: its bar has no room. */}
      {phoneTable && (
        <Box sx={{ flexShrink: 0 }}>
          <PillGroup options={VIEW_OPTIONS} value={shownView} onChange={v => switchView(v as TableView)} />
        </Box>
      )}
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
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop} onHeld={setBoardHeld}>
      {/* Phone controls: the two that do the work, stating what they are set to. The grid's
          chips stay on desktop, where there is room for all of them and the headers already sort. */}
      {!isDesktop && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
          />
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {!isDesktop && (
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
      {isDesktop && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <PillGroup
            options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
            value={lbGroup}
            onChange={v => { setLbGroup(v as 'hitting' | 'pitching'); setLbFullscreen(null); setLbStatsLimit(50) }}
          />
          {/* Which columns, beside which side, where WPBL's table has it. */}
          <PillGroup options={VIEW_OPTIONS} value={shownView} onChange={v => switchView(v as TableView)} />
          {/* Filters, so chips (src/ui/FilterChip), as WPBL's season / playoffs choice is, and in
              WPBL's tighter group: at the row's 8px gap the three came out 4px wider than WPBL's, and
              at 760 that was the one pixel that wrapped the row and dropped the table 34px below
              WPBL's. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {scopes.map(sc => (
              <FilterChip key={sc} active={shownScope === sc} onClick={() => { setGameScope(sc); setLbStatsLimit(50) }}>
                {GAME_SCOPE_LABEL[sc]}
              </FilterChip>
            ))}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
          {/* A chip, the row's one control language (src/ui/FilterChip). */}
          <FilterSelect
            ariaLabel="Season"
            value={allTime ? 'all' : String(vizSeason)}
            options={[{ value: 'all', label: 'All-Time' }, ...TEAM_SEASONS.map(y => ({ value: String(y), label: String(y) }))]}
            onChange={v => {
              if (v === 'all') { setAllTime(true); setLbStatsLimit(50) }
              else { setAllTime(false); setVizSeason(Number(v)); setLbStatsLimit(50) }
              setLbFullscreen(null)
            }}
            active={allTime || vizSeason !== CURRENT_SEASON}
          />
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
      </StatsBar>

      {/* LOADING IS THE BOARD DRAWN EMPTY: its real title and subtitle, which need no data, over
          empty rows. It was a centred spinner, which left the footer in view on a phone. */}
      {loadingLb && listView && (
        <Box aria-hidden>
          <StatsRankedList skeleton rows={[]} def={activeDef} statDefs={allDefs} group={lbGroup} asc={effectiveAsc}
            onOpenPlayer={() => {}} footer={() => boardFoot(null)} />
        </Box>
      )}
      {loadingLb && !listView && (
        <Box aria-hidden sx={TABLE_FRAME_SX}>
          {/* The scroller at its cap, which a season's rows always fill. */}
          <Box sx={{ height: phoneTable ? PHONE_TABLE_MAX_H : TABLE_MAX_H, px: 2, pt: 1 }}>
            {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} sx={{ fontSize: '1.6rem' }} />)}
          </Box>
          {/* The "Show all" row of the capped table, which a qualified season board always has. */}
          {isDesktop && <Box sx={{ height: 48, borderTop: '1px solid', borderColor: 'divider' }} />}
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
              rows={rankedAll} def={activeDef} statDefs={allDefs} group={lbGroup} asc={effectiveAsc}
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
          <Box ref={tableScrollRef}
            onScroll={phoneTable ? e => setAtStart(e.currentTarget.scrollLeft <= 1) : undefined}
            sx={{
              overflowX: 'auto', overscrollBehaviorX: 'contain',
              // On a phone, vertical scroll waits for the board to pin (boardHeld).
              overflowY: phoneTable && !boardHeld ? 'hidden' : 'auto',
              maxHeight: phoneTable ? PHONE_TABLE_MAX_H : TABLE_MAX_H,
            }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  {/* Sticky player-name column header */}
                  <Box component="th" sx={{
                    ...stThSx,
                    position: 'sticky', top: 0, left: 0, zIndex: 4,
                    borderRight: '1px solid', borderColor: 'divider',
                    // WPBL's NAME_W, so the first stat column starts where it does there. Fixed on a
                    // phone, where the frozen sorted column pins at exactly this offset.
                    minWidth: NAME_W, width: phoneTable ? NAME_W : undefined, maxWidth: phoneTable ? NAME_W : undefined,
                    color: 'text.disabled', px: 1,
                    textAlign: phoneTable ? 'right' : 'left', textTransform: 'uppercase',
                  }}>
                    {/* On a phone the count lives here, since the foot gave up its words for rows. */}
                    {phoneTable ? `${totalInDataset} players` : 'Player'}
                  </Box>
                  {phoneTable && (
                    <Box component="th" onClick={() => handleColClick(activeDef)} sx={{
                      ...stThSx, ...FROZEN_SX, zIndex: 5, top: 0,
                      textAlign: 'center', cursor: 'pointer', minWidth: '3.125rem',
                      color: ACCENT_TEXT, backgroundImage: `linear-gradient(${ACCENT}24, ${ACCENT}24)`,
                      '&::after': atStart ? undefined : FROZEN_EDGE,
                    }}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
                        {activeDef.label}
                        <Box component="span" sx={{ fontSize: '0.62rem' }}>{effectiveAsc ? '↑' : '↓'}</Box>
                      </Box>
                    </Box>
                  )}
                  {/* Stat column headers */}
                  {scrollDefs.map(def => {
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
                          textAlign: 'center', cursor: 'pointer', minWidth: '2.375rem',
                          bgcolor: 'background.paper',
                          // WPBL's sorted header: the tint layered over the opaque paper, so the
                          // rows scrolling under this sticky cell never show through it.
                          backgroundImage: isActive ? `linear-gradient(${ACCENT}24, ${ACCENT}24)` : undefined,
                          color: isActive ? ACCENT_TEXT : 'text.disabled',
                          '&:hover': { color: ACCENT_TEXT },
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
                      </Box>
                    )
                  })}
                </Box>
                {/* Row two: the league, named at its start like the rows under it, and right-aligned
                    there, beside the figures it names. None on a career board (see leagueLine). */}
                {league && (
                  <Box component="tr">
                    <Box component="th" sx={{
                      ...HEAD_LEAGUE_SX, left: 0, zIndex: 4, textAlign: 'right', px: 1,
                      bgcolor: 'background.paper', backgroundImage: HEAD_LEAGUE_TINT,
                      borderRight: '1px solid', borderColor: 'divider',
                    }}><span data-league-head="">League avg</span></Box>
                    {phoneTable && (
                      <Box component="th" sx={{
                        ...HEAD_LEAGUE_SX, ...FROZEN_SX, zIndex: 5, textAlign: 'center', px: 0.5,
                        backgroundImage: `linear-gradient(${ACCENT}24, ${ACCENT}24), ${HEAD_LEAGUE_TINT}`,
                        '&::after': atStart ? undefined : FROZEN_EDGE,
                      }}><span data-league-head="">{leagueCell(activeDef)}</span></Box>
                    )}
                    {scrollDefs.map(def => (
                      <Box component="th" key={def.key} sx={{
                        ...HEAD_LEAGUE_SX, zIndex: 3, textAlign: 'center', px: 0.5,
                        bgcolor: 'background.paper',
                        backgroundImage: def.key === sortKey
                          ? `linear-gradient(${ACCENT}24, ${ACCENT}24), ${HEAD_LEAGUE_TINT}`
                          : HEAD_LEAGUE_TINT,
                      }}><span data-league-head="">{leagueCell(def)}</span></Box>
                    ))}
                  </Box>
                )}
              </Box>

              <Box component="tbody">
                {tableRows.map((e, idx) => {
                  const stat = e.stat
                  const isHighlighted = e.playerId === highlightPlayerId
                  return (
                    <Box component="tr" key={e.playerId}
                      ref={isHighlighted ? (el: HTMLElement | null) => { highlightRowRef.current = el } : undefined}
                      {...rowClick(() => handleLbPlayerClick(e.playerId))}
                      sx={{
                        cursor: 'pointer',
                        // THE ROW'S TINT IS A VARIABLE EVERY CELL LAYERS IN (ROW_TINT), never a
                        // background of its own. As a translucent bgcolor on the cells it replaced
                        // the frozen cells' opaque paper, so on the touched or picked-out row the
                        // stats scrolling under the frozen sorted column showed through it, and it
                        // replaced the sorted column's tint on that row as well. Hover only where
                        // there is a pointer: a tap leaves :hover stuck on a phone.
                        [ROW_TINT_VAR]: isHighlighted ? `${ACCENT}1a` : 'transparent',
                        '@media (hover: hover)': {
                          '&:hover': { [ROW_TINT_VAR]: isHighlighted ? `${ACCENT}26` : `${ACCENT}0e` },
                        },
                      }}
                    >
                      {/* Sticky player cell */}
                      <Box component="th" sx={{
                        ...stTdSx, textAlign: 'left',
                        position: 'sticky', left: 0, zIndex: 2,
                        bgcolor: 'background.paper', backgroundImage: ROW_TINT,
                        fontWeight: 'normal',
                        px: 1,
                        width: phoneTable ? NAME_W : undefined, maxWidth: phoneTable ? NAME_W : undefined,
                        // A plain divider on every row. The picked-out row drew a 2px accent rule
                        // here, which on a phone ran into the frozen column pinned against it.
                        borderRight: '1px solid', borderRightColor: 'divider',
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {/* Flex-end so a wide tied rank ("T-24") overflows into the padding on
                              its left rather than into the badge. */}
                          <Typography sx={{ width: '1.25rem', display: 'flex', justifyContent: 'flex-end', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            <RankMarkText rank={ranks[idx]} />
                          </Typography>
                          {/* The club's mark where the headshot was, as WPBL's table draws it: a
                              face per row made every row 56px against WPBL's 42, and the player
                              card behind the tap already has the face. */}
                          {e.teamId > 0 && <LogoBubble teamId={e.teamId} abbr={e.teamAbbr} size={20} ring={1} />}
                          <Box sx={{ minWidth: 0, maxWidth: phoneTable ? NAME_INNER_MAX : undefined }}>
                            <Typography {...playerLink(e.playerId, e.playerName, handleLbPlayerClick)} sx={{ ...LINK_SX, display: 'block', fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isDesktop ? e.playerName : abbrevName(e.playerName)}
                            </Typography>
                            {/* The position, as WPBL's row says it: the club is already the mark beside it.
                                StatsAPI calls every pitcher "P", so the pitching table says which kind. */}
                            {/* Not on a phone, where the board is capped to the screen and the line
                                costs a sixth of every row: WPBL's table drops it there too. */}
                            {!phoneTable && (lbGroup === 'pitching' || e.position) && (
                              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1 }}>
                                {lbGroup === 'pitching' ? pitcherRole(stat) : e.position}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Box>

                      {phoneTable && (
                        <Box component="td" onClick={ev => { ev.stopPropagation(); handleColClick(activeDef) }} sx={{
                          ...stTdSx, ...FROZEN_SX, zIndex: 3, textAlign: 'center',
                          fontSize: '0.84rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                          backgroundImage: `${ROW_TINT}, linear-gradient(${ACCENT}12, ${ACCENT}12)`,
                          '&::after': atStart ? undefined : FROZEN_EDGE,
                        }}>
                          {activeDef.format(activeDef.getValue(stat))}
                        </Box>
                      )}
                      {/* Stat value cells. A tap on one sorts by its column, as WPBL's do; the name
                          is the way to the player, so the row is no longer one big target for it. */}
                      {scrollDefs.map(def => {
                        const isActive   = def.key === sortKey
                        const isFocused  = isHighlighted && def.key === highlightStatKey
                        const val = def.format(def.getValue(stat))
                        return (
                          <Box component="td" key={def.key}
                            ref={isFocused ? (el: HTMLElement | null) => { highlightColRef.current = el } : undefined}
                            onClick={ev => { ev.stopPropagation(); handleColClick(def) }}
                            sx={{
                            ...stTdSx, textAlign: 'center',
                            // WPBL's cell: the sorted column a step bigger, heavier and tinted, the
                            // row's tint layered over it rather than in place of it.
                            backgroundImage: [
                              isFocused ? `linear-gradient(${ACCENT}28, ${ACCENT}28)` : null,
                              ROW_TINT,
                              isActive ? `linear-gradient(${ACCENT}12, ${ACCENT}12)` : null,
                            ].filter(Boolean).join(', '),
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

          {/* Outside the scroll box, so the way to the rest is on screen without reaching its end. */}
          {canCap && (
            <ExpandRow expanded={tableOpen} moreLabel={`Show all ${totalInDataset} players`}
              onToggle={tableOpen ? closeTable : () => setOpenBoard(boardKey)} />
          )}
          {boardFoot(totalInDataset, tableRows.length)}
        </Box>
      )}

      {sortOpen && !isDesktop && (
        <StatsSortSheet statDefs={allDefs} group={lbGroup} sortKey={sortKey} asc={effectiveAsc}
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

const VIEW_OPTIONS = [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced' }]

/** A starter if at least half their games were starts. */
const pitcherRole = (stat: any): string =>
  Number(stat?.gamesStarted ?? 0) * 2 >= Number(stat?.gamesPlayed ?? 0) && Number(stat?.gamesStarted ?? 0) > 0 ? 'SP' : 'RP'

/** Career has no "All" (see fetchAllTimeLeaderboardData), so a reader who had it chosen sees the
 *  regular season there. */
const shownScopeFor = (allTime: boolean, scope: GameScope): GameScope => allTime && scope === 'all' ? 'regular' : scope

// WPBL's board frame: a hairline card, no raised paper and no title strip. Edge to edge on a
// phone's full table, where the gutter is worth a column.
/** The phone's cap: the screen under the pinned bar, less the board's own foot, the bottom nav and
 *  the home indicator, less PHONE_TABLE_TAIL_PX for what follows the board. Exactly what fits, so
 *  the board stays pinned to the end of the page; a few pixels more and its column headings slide
 *  under the bar for the last stretch of the scroll. Never under 240px, the header and five rows;
 *  WPBL's floor. */
const PHONE_TABLE_TAIL_PX = 20 // the shell's 16px under the section, the frame's 2 borders, 2 of slack
const PHONE_TABLE_MAX_H = `max(240px, calc(100dvh - ${STATS_BOARD_TOP} - var(--mlb-board-foot-h, 0px)`
  + ` - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px) - ${PHONE_TABLE_TAIL_PX}px))`

/** The frozen sorted column on a phone: pinned flush against the name column. */
const FROZEN_SX = frozenSx(NAME_W)

