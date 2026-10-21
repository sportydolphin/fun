import React, { useState, useEffect } from 'react'
import { pressable } from '../../ui/interaction'
import { ACCENT_EDGE, TYPE_SCALE } from '../../ui/card'
import {
  Box, Typography, Paper, List, ListItemButton, Divider,
  ClickAwayListener, Skeleton,
} from '@mui/material'
import { Search } from '@mui/icons-material'
import { TeamSummary, SosEntry } from '../types'
import { TEAM_BG, TEAM_ABBR, TEAM_SEASONS, CURRENT_SEASON, TEAM_PAYROLLS_2026 } from '../constants'
import { InfoDot } from '../../ui/InfoDot'
import { TeamEraOpsPlot, TeamWinRDPlot, PayrollWinsPlot } from '../components/charts'
import { Board, PlayerBoard, LeaderboardCard, LeaderboardModal, PlayerLeaderboardCard, PlayerLeaderboardModal } from '../components/leaderboards'
import { AgeEntry, buildFraudRows, buildAgeRows, buildSosRows, buildPayrollRows, buildStreakRows, buildPitchPaRows, buildSalaryRows } from '../components/reportCardRows'
import { fetchStrengthOfSchedule, fetchTeamPayrolls, fetchTeamAverageAges, fetchStreakLeaders, StreakLeaders, fetchPitchesPerPa, PitchPaLeaders, fetchTopSalaries, SalaryRow } from '../api'
import { chromePx, typePx } from '../../ui/scale'
import { FilterSelect } from '../../ui/FilterChip'
import { StatsBar, STATS_BOARD_ROOT_SX } from './StatsBar'


// TWO PAGES, ONE COMPONENT: the graphs are Standings' Charts (/mlb/charts) and the report cards a
// page of their own under More (/mlb/report-cards). Until Oct 2026 they were the two halves of a
// switch on Charts, which put the report cards, the boards Home links to most, three levels down.
// They share the season chip and the clubs' summary read, which is why they are still one view.
type VizShow = 'graphs' | 'report-card'


// ─── Main view ────────────────────────────────────────────────────────────────

export interface VizViewProps {
  /** Which page this is. Fixed for the life of the view: each page mounts its own. */
  show: VizShow
  /** The Stats tab's board row, which the pinned bar carries (StatsBar). */
  boardTabs: React.ReactNode
  isDesktop: boolean
  vizSeason: number
  setVizSeason: (s: number) => void
  teamSummaries: TeamSummary[]
  loadingViz: boolean
  nameMap: Map<number, string>
  handleVizNavigate: (id: number) => void
  handleLbPlayerClick: (id: number) => void
  canHover: boolean
}

/** A plot before its clubs land: the plots' own 560:400 box (charts.tsx), so the panel is its loaded
 *  height from the first frame. A plot drawn over no data divides by an empty range. */
function PlotSkeleton() {
  return <Skeleton variant="rounded" sx={{ width: '100%', height: 'auto', aspectRatio: '560 / 400' }} />
}

export function VizView({
  boardTabs, isDesktop, vizSeason, setVizSeason, teamSummaries, loadingViz,
  nameMap, handleVizNavigate, handleLbPlayerClick, canHover, show,
}: VizViewProps) {
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizHoverId, setVizHoverId]   = useState<number | null>(null)
  const [vizSearch, setVizSearch]     = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  // Only load SOS / payrolls for the current season (past seasons have no data)
  const current = vizSeason === CURRENT_SEASON
  // Each page reads only what it draws: the payrolls are the graphs', everything else the cards'.
  const cards = show === 'report-card'
  const showSos = cards && current

  // Each `loading` below starts as "will this read run", never a bare false. The effects that set
  // it can run after the first paint (they do when the view mounts out of a cold lazy chunk, as on
  // CI's runner), and a false there draws every card's empty state, "No active streaks" a third the
  // height of the skeleton, for a frame before growing it: the layout sweep's 141px jump of the
  // whole second row of cards on /mlb/charts.

  // ─── SOS state ────────────────────────────────────────────────────────────
  const [sosData, setSosData]       = useState<SosEntry[]>([])
  const [loadingSos, setLoadingSos] = useState(showSos)

  // ─── Report Card fullscreen state: one board open at a time ─────────────
  const [expandedBoard, setExpandedBoard] = useState<string | null>(null)

  // ─── Team age state ───────────────────────────────────────────────────────
  const [ageEntries, setAgeEntries]   = useState<AgeEntry[]>([])
  const [loadingAges, setLoadingAges] = useState(showSos)

  // ─── Payroll state: live from Supabase, falls back to hardcoded constant ─
  const [payrolls, setPayrolls] = useState<Record<number, number>>(TEAM_PAYROLLS_2026)

  // ─── Active-streak state: the player report cards (computed from game logs) ─
  const [streaks, setStreaks]             = useState<StreakLeaders | null>(null)
  const [loadingStreaks, setLoadingStreaks] = useState(showSos)
  const [expandedPlayerBoard, setExpandedPlayerBoard] = useState<string | null>(null)

  // ─── Pitches per PA: a season rate, so it loads for any season ────────────
  const [pitchPa, setPitchPa]             = useState<PitchPaLeaders | null>(null)
  const [loadingPitchPa, setLoadingPitchPa] = useState(cards)

  // ─── Top salaries: from player_contracts, so current season only ──────────
  const [salaries, setSalaries]             = useState<SalaryRow[]>([])
  const [loadingSalaries, setLoadingSalaries] = useState(showSos)

  useEffect(() => {
    if (cards || !current) { setPayrolls(TEAM_PAYROLLS_2026); return }
    fetchTeamPayrolls(vizSeason).then(live => {
      if (Object.keys(live).length >= 28) setPayrolls(live)
    })
  }, [vizSeason, cards, current])

  useEffect(() => {
    if (!showSos) { setSosData([]); setExpandedBoard(null); return }
    if (sosData.length > 0) return
    let cancelled = false
    setLoadingSos(true)
    fetchStrengthOfSchedule(vizSeason)
      .then(d => { if (!cancelled) setSosData(d) })
      .catch(() => { if (!cancelled) setSosData([]) })
      .finally(() => { if (!cancelled) setLoadingSos(false) })
    return () => { cancelled = true }
    // NOT sosData.length: it is the "already have it" guard, and a failed read leaves it at 0,
    // so watching it would refetch for ever against a source that is down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vizSeason, showSos])

  useEffect(() => {
    if (!showSos) { setAgeEntries([]); return }
    if (ageEntries.length > 0) return
    let cancelled = false
    setLoadingAges(true)
    fetchTeamAverageAges(vizSeason)
      .then(ages => {
        if (cancelled) return
        const entries: AgeEntry[] = Object.entries(ages)
          .map(([id, avgAge]) => ({ teamId: Number(id), abbr: TEAM_ABBR[Number(id)] ?? '?', avgAge }))
          .filter(e => e.abbr !== '?')
          .sort((a, b) => b.avgAge - a.avgAge)
        setAgeEntries(entries)
      })
      .catch(() => { if (!cancelled) setAgeEntries([]) })
      .finally(() => { if (!cancelled) setLoadingAges(false) })
    return () => { cancelled = true }
    // NOT ageEntries.length, for the same reason as the read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vizSeason, showSos])

  // Active streaks only make sense for the live season. Past seasons are over,
  // so their "current" streak is just wherever the player finished the year.
  useEffect(() => {
    if (!showSos) { setStreaks(null); setExpandedPlayerBoard(null); return }
    let cancelled = false
    setLoadingStreaks(true)
    fetchStreakLeaders(vizSeason)
      .then(d => { if (!cancelled) setStreaks(d) })
      .catch(() => { if (!cancelled) setStreaks(null) })
      .finally(() => { if (!cancelled) setLoadingStreaks(false) })
    return () => { cancelled = true }
  }, [vizSeason, showSos])

  useEffect(() => {
    if (!cards) return
    let cancelled = false
    setLoadingPitchPa(true)
    fetchPitchesPerPa(vizSeason)
      .then(d => { if (!cancelled) setPitchPa(d) })
      .catch(() => { if (!cancelled) setPitchPa(null) })
      .finally(() => { if (!cancelled) setLoadingPitchPa(false) })
    return () => { cancelled = true }
  }, [vizSeason, cards])

  // Salaries come from the current-season contract scrape, so gate on showSos
  // like team payrolls: a past year has no per-player salary data to show.
  useEffect(() => {
    if (!showSos) { setSalaries([]); return }
    let cancelled = false
    setLoadingSalaries(true)
    fetchTopSalaries(vizSeason)
      .then(d => { if (!cancelled) setSalaries(d) })
      .catch(() => { if (!cancelled) setSalaries([]) })
      .finally(() => { if (!cancelled) setLoadingSalaries(false) })
    return () => { cancelled = true }
  }, [vizSeason, showSos])

  const fraudTooltip = 'Wins above the Pythagorean record: the wins a team\'s runs scored and allowed predict. Ranked by that gap times win%, so a contender ranks above a last-place team with the same gap.'
  const cursedTooltip = 'Wins below the Pythagorean record: the wins a team\'s runs scored and allowed predict. Ranked by that gap times losing %, so a last-place team ranks above a contender with the same gap.'

  // ─── Report Card boards: every leaderboard follows the same shape ────────
  const boards: Board[] = [
    {
      id: 'fraud', icon: '📈', title: 'Wins Above Expected', accent: '#f97316',
      subtitle: 'vs Pythagorean record', tooltipText: fraudTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'fraud'), loading: loadingViz,
    },
    {
      id: 'cursed', icon: '📉', title: 'Wins Below Expected', accent: '#818cf8',
      subtitle: 'vs Pythagorean record', tooltipText: cursedTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'cursed'), loading: loadingViz,
    },
    ...(showSos ? [
      {
        id: 'oldest', icon: '👴', title: 'Oldest Rosters', accent: '#f97316',
        subtitle: 'Avg age',
        rows: buildAgeRows(ageEntries, nameMap, 'oldest'), loading: loadingAges,
      },
      {
        id: 'youngest', icon: '🌱', title: 'Youngest Rosters', accent: '#22c55e',
        subtitle: 'Avg age',
        rows: buildAgeRows(ageEntries, nameMap, 'youngest'), loading: loadingAges,
      },
      {
        id: 'hardest', icon: '⚔️', title: 'Hardest Schedules', accent: '#ef4444',
        subtitle: 'Remaining opp. win%',
        rows: buildSosRows(sosData, 'hardest'), loading: loadingSos,
      },
      {
        id: 'easiest', icon: '🏖️', title: 'Easiest Schedules', accent: '#22c55e',
        subtitle: 'Remaining opp. win%',
        rows: buildSosRows(sosData, 'easiest'), loading: loadingSos,
      },
    ] : []),
    // Payroll boards only for the current season. We don't have historical payroll
    // data, so a past year would otherwise show today's numbers.
    ...(showSos ? [
      {
        id: 'highest-payroll', icon: '💰', title: 'Highest Payrolls', accent: '#eab308',
        subtitle: '2026 est. payroll',
        rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'highest'), loading: false,
      },
      {
        id: 'lowest-payroll', icon: '🪙', title: 'Lowest Payrolls', accent: '#22c55e',
        subtitle: '2026 est. payroll',
        rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'lowest'), loading: false,
      },
    ] : []),
  ]

  const activeBoard = boards.find(b => b.id === expandedBoard) ?? null

  // ─── Player report cards: active streaks (current season only) ────────────
  // Both pitch boards share the "who counts as qualified" line
  const QUALIFIED_NOTE = 'Qualified hitters only.'

  const playerBoards: PlayerBoard[] = [
    ...(showSos ? [{
      id: 'hit-streak', icon: '🔥', title: 'Hitting Streaks', accent: '#f97316',
      subtitle: 'Active',
      tooltipText: 'Games in a row with at least one hit. A game with no official at-bat (all walks or hit by pitches) doesn\'t break the streak.',
      rows: buildStreakRows(streaks?.hitting ?? [], 'hitting'), loading: loadingStreaks,
    },
    {
      id: 'scoreless', icon: '🧊', title: 'Scoreless Streaks', accent: '#38bdf8',
      subtitle: 'Active',
      tooltipText: 'Innings a pitcher has thrown since the last run they gave up. Counted in whole outings, so the streak starts at their first clean appearance after it.',
      rows: buildStreakRows(streaks?.scoreless ?? [], 'scoreless'), loading: loadingStreaks,
    },
    {
      id: 'hitless', icon: '🥶', title: 'Hitless Streaks', accent: '#a78bfa',
      subtitle: 'Active',
      tooltipText: 'Trips to the plate a hitter has gone without a hit. Games with no official at-bat are skipped.',
      rows: buildStreakRows(streaks?.hitless ?? [], 'hitless'), loading: loadingStreaks,
    },
    {
      id: 'games-played', icon: '🦾', title: 'Games-Played Streaks', accent: '#eab308',
      subtitle: 'Active',
      tooltipText: 'Games a player has appeared in without ever sitting one out, carried across seasons. A trade doesn\'t break it. A "+" means the streak reaches back past the seasons searched, so the real streak is longer.',
      rows: buildStreakRows(streaks?.gamesPlayed ?? [], 'gamesPlayed'), loading: loadingStreaks,
    },
    {
      id: 'top-salary', icon: '🤑', title: 'Highest Salaries', accent: '#10b981',
      subtitle: `${vizSeason}`,
      tooltipText: `Each player's salary for the ${vizSeason} season, straight from their contract. This is the money paid this year, so a backloaded or deferred deal can rank differently than its headline average annual value.`,
      rows: buildSalaryRows(salaries), loading: loadingSalaries,
    }] : []),
    // Plain season rates, so unlike the streak boards these render for past seasons too
    {
      id: 'pitches-most', icon: '⏳', title: 'Most Pitches per PA', accent: '#14b8a6',
      subtitle: 'Qualified',
      tooltipText: `Pitches a hitter sees per trip to the plate. ${QUALIFIED_NOTE}`,
      rows: buildPitchPaRows(pitchPa, 'most'), loading: loadingPitchPa,
    },
    {
      id: 'pitches-fewest', icon: '⚡', title: 'Fewest Pitches per PA', accent: '#f43f5e',
      subtitle: 'Qualified',
      tooltipText: `Pitches a hitter sees per trip to the plate, lowest first. ${QUALIFIED_NOTE}`,
      rows: buildPitchPaRows(pitchPa, 'fewest'), loading: loadingPitchPa,
    },
  ]

  const activePlayerBoard = playerBoards.find(b => b.id === expandedPlayerBoard) ?? null

  return (
    <Box sx={STATS_BOARD_ROOT_SX}>
      <StatsBar tabs={boardTabs} isDesktop={isDesktop}>
      {/* ── Top controls: season picker + team search ─────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {!cards && <>
          <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            All 30 teams
          </Typography>

          {vizHighlightId != null ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
              <Typography sx={{ color: '#fff', fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1 }}>
                {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
              </Typography>
              <Box {...pressable(() => { setVizHighlightId(null); setVizSearch('') })}
                sx={{ color: 'rgba(255,255,255,0.75)', fontSize: TYPE_SCALE.heading, lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}>×</Box>
            </Box>
          ) : (
            <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
              <Box sx={{ position: 'relative', minWidth: { xs: 0, sm: chromePx(180) }, flex: { xs: 1, sm: 'none' } }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.6, borderRadius: 999,
                  border: '1.5px solid', borderColor: 'outline', bgcolor: 'background.paper',
                  transition: 'border-color 0.15s', '&:focus-within': { borderColor: ACCENT_EDGE },
                }}>
                  <Search sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', flexShrink: 0 }} />
                  <Box component="input" value={vizSearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                    onFocus={() => setVizSearchOpen(true)}
                    placeholder="Highlight a team…"
                    sx={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent', fontSize: TYPE_SCALE.body, color: 'text.primary', p: 0, fontFamily: 'inherit', '&::placeholder': { color: 'text.disabled' } }}
                  />
                </Box>
                {vizSearchOpen && (() => {
                  const q = vizSearch.toLowerCase()
                  const matches = vizSearch.length > 0
                    ? teamSummaries.filter(t => { const name = nameMap.get(t.id) ?? ''; return name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) })
                    : [...teamSummaries].sort((a, b) => (nameMap.get(a.id) ?? a.abbr).localeCompare(nameMap.get(b.id) ?? b.abbr))
                  if (matches.length === 0) return null
                  return (
                    <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
                      <List dense disablePadding>
                        {matches.map((t, i) => (
                          <React.Fragment key={t.id}>
                            {i > 0 && <Divider />}
                            <ListItemButton onClick={() => { setVizHighlightId(t.id); setVizSearch(''); setVizSearchOpen(false) }} sx={{ gap: 1.25, py: 0.6 }}>
                              <Box sx={{ width: chromePx(26), height: chromePx(26), borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? TYPE_SCALE.nano : TYPE_SCALE.caption, lineHeight: 1 }}>{t.abbr}</Typography>
                              </Box>
                              <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
                            </ListItemButton>
                          </React.Fragment>
                        ))}
                      </List>
                    </Paper>
                  )
                })()}
              </Box>
            </ClickAwayListener>
          )}
          </>}
        </Box>

        {/* The other two boards' season chip (src/ui/FilterChip). */}
        <FilterSelect
          ariaLabel="Season"
          value={String(vizSeason)}
          options={TEAM_SEASONS.map(y => ({ value: String(y), label: String(y) }))}
          onChange={v => setVizSeason(Number(v))}
          active={vizSeason !== CURRENT_SEASON}
        />
      </Box>
      </StatsBar>

      {/* DRAWN WHILE LOADING TOO: every card holds its own rows' room while its read is out
          (`loading` on each board), so the page is its loaded height from the first frame. It was a
          28px spinner, which left the site footer on a phone's first screen and threw it 3,300px
          down when the cards landed (the layout sweep, Oct 2026). */}
      {(loadingViz || teamSummaries.length > 0) && (cards ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 3 }, rowGap: 3 }}>
          {playerBoards.map(board => (
            <Box key={board.id} sx={{ minWidth: 0 }}>
              <PlayerLeaderboardCard
                {...board}
                onExpand={() => setExpandedPlayerBoard(board.id)}
                onSelectPlayer={handleLbPlayerClick}
              />
            </Box>
          ))}
            {boards.map(board => (
              <Box key={board.id} sx={{ minWidth: 0 }}>
                <LeaderboardCard
                  {...board}
                  onExpand={() => setExpandedBoard(board.id)}
                  onSelectTeam={handleVizNavigate}
                />
              </Box>
            ))}
          </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 5 }, rowGap: 0 }}
          onMouseLeave={() => setVizHoverId(null)}>

          {/* ERA vs OPS */}
          <Box sx={{ pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.heading, letterSpacing: typePx(-0.3) }}>ERA vs OPS</Typography>
              <InfoDot label="What this shows" text="One bubble per team: team ERA up the side, inverted so lower is higher, and team OPS across. The dashed lines are the league averages, so top right is better than average at both." />
            </Box>
            {teamSummaries.length ? <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} /> : <PlotSkeleton />}
          </Box>

          {/* Wins vs Run Margin */}
          <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.heading, letterSpacing: typePx(-0.3) }}>Win% vs Run Differential</Typography>
              <InfoDot label="What this shows" text="One bubble per team: win% up the side, run differential (runs scored minus runs allowed) across. The blue dashed curve is the Pythagorean win%, the record that run differential predicts; above it is more wins than predicted." />
            </Box>
            {teamSummaries.length ? <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} /> : <PlotSkeleton />}
          </Box>

          {/* Payroll vs Performance, current season only */}
          {current && (
            <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: TYPE_SCALE.heading, letterSpacing: typePx(-0.3) }}>Payroll vs Win%</Typography>
                  <InfoDot label="What this shows" text="One bubble per team: win% up the side, estimated payroll across. The dashed lines are the median payroll and .500; the purple line is the league's trend, the win% a payroll predicts, so above it is more wins than the payroll predicts." />
                </Box>
                {teamSummaries.length ? <PayrollWinsPlot data={teamSummaries} payrolls={payrolls} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} /> : <PlotSkeleton />}
              </Box>
          )}
        </Box>
      ))}

      {!loadingViz && teamSummaries.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No data</Typography>
      )}

      {/* ── Report Card fullscreen modal, shared by every board ──────────── */}
      <LeaderboardModal
        open={activeBoard != null}
        onClose={() => setExpandedBoard(null)}
        icon={activeBoard?.icon}
        title={activeBoard ? `${activeBoard.title}: All ${activeBoard.rows.length} Teams` : undefined}
        subtitle={activeBoard?.subtitle}
        accent={activeBoard?.accent}
        rows={activeBoard?.rows ?? []}
        onSelectTeam={id => { setExpandedBoard(null); handleVizNavigate(id) }}
      />

      {/* ── Player streak fullscreen modal ────────────────────────────────── */}
      <PlayerLeaderboardModal
        open={activePlayerBoard != null}
        onClose={() => setExpandedPlayerBoard(null)}
        icon={activePlayerBoard?.icon}
        title={activePlayerBoard ? `${activePlayerBoard.title}: Top ${activePlayerBoard.rows.length}` : undefined}
        subtitle={activePlayerBoard?.subtitle}
        accent={activePlayerBoard?.accent}
        rows={activePlayerBoard?.rows ?? []}
        onSelectPlayer={id => { setExpandedPlayerBoard(null); handleLbPlayerClick(id) }}
      />
    </Box>
  )
}
