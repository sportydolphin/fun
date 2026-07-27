import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Typography, Paper, List, ListItemButton, Divider,
  ClickAwayListener, CircularProgress,
} from '@mui/material'
import { Search } from '@mui/icons-material'
import { TeamSummary, SosEntry } from '../types'
import { ACCENT, TEAM_BG, TEAM_ABBR, TEAM_SEASONS, CURRENT_SEASON, TEAM_PAYROLLS_2026 } from '../constants'
import { pillActionSx, InfoTip } from '../components/ui'
import { TeamEraOpsPlot, TeamWinRDPlot, PayrollWinsPlot } from '../components/charts'
import { Board, PlayerBoard, LeaderboardCard, LeaderboardModal, PlayerLeaderboardCard, PlayerLeaderboardModal } from '../components/leaderboards'
import { AgeEntry, buildFraudRows, buildAgeRows, buildSosRows, buildPayrollRows, buildStreakRows, buildPitchPaRows, buildSalaryRows } from '../components/reportCardRows'
import { fetchStrengthOfSchedule, fetchTeamPayrolls, fetchTeamAverageAges, fetchStreakLeaders, StreakLeaders, fetchPitchesPerPa, PitchPaLeaders, fetchTopSalaries, SalaryRow } from '../api'


// ─── VizSubNav — in-page tab switcher ────────────────────────────────────────

type VizTab = 'graphs' | 'report-card'

function VizSubNav({ tab, onChange }: { tab: VizTab; onChange: (t: VizTab) => void }) {
  const tabs: Array<{ value: VizTab; label: string }> = [
    { value: 'report-card', label: 'Report Card' },
    { value: 'graphs',      label: 'Graphs' },
  ]
  return (
    <Box sx={{
      display: 'flex',
      borderBottom: '1px solid', borderColor: 'divider',
      mb: 2.5,
      mx: { xs: -2, sm: 0 },
      px: { xs: 2, sm: 0 },
    }}>
      {tabs.map(({ value, label }) => {
        const active = tab === value
        return (
          <Box
            key={value}
            onClick={() => onChange(value)}
            sx={{
              flex: 1, py: 0.9,
              textAlign: 'center',
              fontSize: { xs: '0.78rem', sm: '0.84rem' },
              fontWeight: active ? 700 : 500,
              color: active ? 'text.primary' : 'text.secondary',
              cursor: 'pointer', userSelect: 'none',
              borderBottom: '2.5px solid',
              borderColor: active ? 'text.primary' : 'transparent',
              mb: '-1px',
              transition: 'color 0.15s, border-color 0.15s',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {label}
          </Box>
        )
      })}
    </Box>
  )
}


// ─── Main view ────────────────────────────────────────────────────────────────

export interface VizViewProps {
  vizSeason: number
  setVizSeason: (s: number) => void
  teamSummaries: TeamSummary[]
  loadingViz: boolean
  nameMap: Map<number, string>
  handleVizNavigate: (id: number) => void
  handleLbPlayerClick: (id: number) => void
  canHover: boolean
}

export function VizView({
  vizSeason, setVizSeason, teamSummaries, loadingViz,
  nameMap, handleVizNavigate, handleLbPlayerClick, canHover, defaultTab = 'report-card',
}: VizViewProps & { defaultTab?: VizTab }) {
  const [vizTab, setVizTab]           = useState<VizTab>(defaultTab)
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizHoverId, setVizHoverId]   = useState<number | null>(null)
  const [vizSearch, setVizSearch]     = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  // ─── SOS state ────────────────────────────────────────────────────────────
  const [sosData, setSosData]       = useState<SosEntry[]>([])
  const [loadingSos, setLoadingSos] = useState(false)

  // ─── Report Card fullscreen state — one board open at a time ─────────────
  const [expandedBoard, setExpandedBoard] = useState<string | null>(null)

  // ─── Team age state ───────────────────────────────────────────────────────
  const [ageEntries, setAgeEntries]   = useState<AgeEntry[]>([])
  const [loadingAges, setLoadingAges] = useState(false)

  // ─── Payroll state — live from Supabase, falls back to hardcoded constant ─
  const [payrolls, setPayrolls] = useState<Record<number, number>>(TEAM_PAYROLLS_2026)

  // ─── Active-streak state — the player report cards (computed from game logs) ─
  const [streaks, setStreaks]             = useState<StreakLeaders | null>(null)
  const [loadingStreaks, setLoadingStreaks] = useState(false)
  const [expandedPlayerBoard, setExpandedPlayerBoard] = useState<string | null>(null)

  // ─── Pitches per PA — a season rate, so it loads for any season ────────────
  const [pitchPa, setPitchPa]             = useState<PitchPaLeaders | null>(null)
  const [loadingPitchPa, setLoadingPitchPa] = useState(false)

  // ─── Top salaries — from player_contracts, so current season only ──────────
  const [salaries, setSalaries]             = useState<SalaryRow[]>([])
  const [loadingSalaries, setLoadingSalaries] = useState(false)

  // Only load SOS / payrolls for the current season (past seasons have no data)
  const showSos = vizSeason === CURRENT_SEASON

  useEffect(() => {
    if (!showSos) { setPayrolls(TEAM_PAYROLLS_2026); return }
    fetchTeamPayrolls(vizSeason).then(live => {
      if (Object.keys(live).length >= 28) setPayrolls(live)
    })
  }, [vizSeason, showSos])

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
  }, [vizSeason, showSos])

  // Active streaks only make sense for the live season — past seasons are over,
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
    let cancelled = false
    setLoadingPitchPa(true)
    fetchPitchesPerPa(vizSeason)
      .then(d => { if (!cancelled) setPitchPa(d) })
      .catch(() => { if (!cancelled) setPitchPa(null) })
      .finally(() => { if (!cancelled) setLoadingPitchPa(false) })
    return () => { cancelled = true }
  }, [vizSeason])

  // Salaries come from the current-season contract scrape, so gate on showSos
  // like team payrolls — a past year has no per-player salary data to show.
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

  // ─── Swipe to switch tabs ─────────────────────────────────────────────────
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    setVizTab(dx < 0 ? 'graphs' : 'report-card')
  }, [])

  const fraudTooltip = 'How many more games a team has won than its scoring says it should. The bar weighs the standings in too, so a contender getting lucky ranks above a last-place team with the same gap. They\'re fooling more people.'
  const cursedTooltip = 'How many fewer games a team has won than its scoring says it should. The bar weighs the standings in too, so a last-place team getting robbed ranks above a contender with the same gap. A contender is still fine.'

  // ─── Report Card boards — every leaderboard follows the same shape ────────
  const boards: Board[] = [
    {
      id: 'fraud', icon: '🚨', title: 'Top Frauds', accent: '#f97316',
      subtitle: 'Winning more than their scoring predicts', tooltipText: fraudTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'fraud'), loading: loadingViz,
    },
    {
      id: 'cursed', icon: '💀', title: 'Most Cursed', accent: '#818cf8',
      subtitle: 'Losing more than their scoring predicts', tooltipText: cursedTooltip,
      rows: buildFraudRows(teamSummaries, nameMap, 'cursed'), loading: loadingViz,
    },
    ...(showSos ? [
      {
        id: 'oldest', icon: '👴', title: 'Oldest Rosters', accent: '#f97316',
        subtitle: 'Highest avg roster age',
        rows: buildAgeRows(ageEntries, nameMap, 'oldest'), loading: loadingAges,
      },
      {
        id: 'youngest', icon: '🌱', title: 'Youngest Rosters', accent: '#22c55e',
        subtitle: 'Lowest avg roster age',
        rows: buildAgeRows(ageEntries, nameMap, 'youngest'), loading: loadingAges,
      },
      {
        id: 'hardest', icon: '⚔️', title: 'Hardest Schedules', accent: '#ef4444',
        subtitle: 'Toughest remaining opponents',
        rows: buildSosRows(sosData, 'hardest'), loading: loadingSos,
      },
      {
        id: 'easiest', icon: '🏖️', title: 'Easiest Schedules', accent: '#22c55e',
        subtitle: 'Softest remaining opponents',
        rows: buildSosRows(sosData, 'easiest'), loading: loadingSos,
      },
    ] : []),
    // Payroll boards only for the current season — we don't have historical payroll
    // data, so a past year would otherwise show today's numbers.
    ...(showSos ? [
      {
        id: 'highest-payroll', icon: '💰', title: 'Highest Payrolls', accent: '#eab308',
        subtitle: '2026 estimated payroll spend',
        rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'highest'), loading: false,
      },
      {
        id: 'lowest-payroll', icon: '🪙', title: 'Lowest Payrolls', accent: '#22c55e',
        subtitle: '2026 estimated payroll spend',
        rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'lowest'), loading: false,
      },
    ] : []),
  ]

  const activeBoard = boards.find(b => b.id === expandedBoard) ?? null

  // ─── Player report cards — active streaks (current season only) ────────────
  // Both pitch boards share the "who counts as qualified" line
  const QUALIFIED_NOTE = 'Only counts regulars with enough playing time to qualify for a league leaderboard.'

  const playerBoards: PlayerBoard[] = [
    ...(showSos ? [{
      id: 'hit-streak', icon: '🔥', title: 'Hitting Streaks', accent: '#f97316',
      subtitle: 'Longest active hitting streaks',
      tooltipText: 'Games in a row with at least one hit. A game with no official at-bat (all walks or hit by pitches) doesn\'t break the streak.',
      rows: buildStreakRows(streaks?.hitting ?? [], 'hitting'), loading: loadingStreaks,
    },
    {
      id: 'scoreless', icon: '🧊', title: 'Scoreless Streaks', accent: '#38bdf8',
      subtitle: 'Longest active scoreless-inning runs',
      tooltipText: 'Innings a pitcher has thrown since the last run they gave up. Counted in whole outings, so the streak starts at their first clean appearance after it.',
      rows: buildStreakRows(streaks?.scoreless ?? [], 'scoreless'), loading: loadingStreaks,
    },
    {
      id: 'hitless', icon: '🥶', title: 'Hitless Streaks', accent: '#a78bfa',
      subtitle: 'Longest active hitless droughts',
      tooltipText: 'Trips to the plate a hitter has gone without a hit. The cold flip side of the hitting streaks board. Games with no official at-bat are skipped.',
      rows: buildStreakRows(streaks?.hitless ?? [], 'hitless'), loading: loadingStreaks,
    },
    {
      id: 'games-played', icon: '🦾', title: 'Iron Men', accent: '#eab308',
      subtitle: 'Longest active games-played streaks',
      tooltipText: 'Games a player has appeared in without ever sitting one out, carried across seasons. A trade doesn\'t break it. A "+" means the run reaches back further than we searched, so it\'s even longer than shown.',
      rows: buildStreakRows(streaks?.gamesPlayed ?? [], 'gamesPlayed'), loading: loadingStreaks,
    },
    {
      id: 'top-salary', icon: '🤑', title: 'Top Earners', accent: '#10b981',
      subtitle: `Highest ${vizSeason} salaries`,
      tooltipText: `Each player's salary for the ${vizSeason} season, straight from their contract. This is the money paid this year, so a backloaded or deferred deal can rank differently than its headline average annual value.`,
      rows: buildSalaryRows(salaries), loading: loadingSalaries,
    }] : []),
    // Plain season rates, so unlike the streak boards these render for past seasons too
    {
      id: 'pitches-most', icon: '⏳', title: 'Grinders', accent: '#14b8a6',
      subtitle: 'Most pitches seen per plate appearance',
      tooltipText: `Pitches a hitter sees per trip to the plate. These are the guys who foul balls off and work deep counts, wearing pitchers down. ${QUALIFIED_NOTE}`,
      rows: buildPitchPaRows(pitchPa, 'most'), loading: loadingPitchPa,
    },
    {
      id: 'pitches-fewest', icon: '⚡', title: 'Free Swingers', accent: '#f43f5e',
      subtitle: 'Fewest pitches seen per plate appearance',
      tooltipText: `Pitches a hitter sees per trip to the plate, lowest in the league. These guys jump on an early strike instead of working the count. ${QUALIFIED_NOTE}`,
      rows: buildPitchPaRows(pitchPa, 'fewest'), loading: loadingPitchPa,
    },
  ]

  const activePlayerBoard = playerBoards.find(b => b.id === expandedPlayerBoard) ?? null

  return (
    <Box>
      {/* ── Top controls: season picker + team search ─────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            All 30 teams · click to focus · hover to inspect
          </Typography>

          {vizHighlightId != null ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
              <Typography sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
              </Typography>
              <Box onClick={() => { setVizHighlightId(null); setVizSearch('') }}
                sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}>×</Box>
            </Box>
          ) : (
            <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
              <Box sx={{ position: 'relative', minWidth: { xs: 0, sm: 180 }, flex: { xs: 1, sm: 'none' } }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.6, borderRadius: 999,
                  border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                  transition: 'border-color 0.15s', '&:focus-within': { borderColor: ACCENT },
                }}>
                  <Search sx={{ fontSize: '0.85rem', color: 'text.disabled', flexShrink: 0 }} />
                  <Box component="input" value={vizSearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                    onFocus={() => setVizSearchOpen(true)}
                    placeholder="Highlight a team…"
                    sx={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent', fontSize: '0.8rem', color: 'text.primary', p: 0, fontFamily: 'inherit', '&::placeholder': { color: 'text.disabled' } }}
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
                              <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? '0.52rem' : '0.62rem', lineHeight: 1 }}>{t.abbr}</Typography>
                              </Box>
                              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
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
        </Box>

        <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
          <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
            {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Box>
      </Box>

      {/* ── Tab switcher ──────────────────────────────────────────────────── */}
      <VizSubNav tab={vizTab} onChange={setVizTab} />

      {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingViz && teamSummaries.length > 0 && (
        <Box onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} sx={{ overflow: 'hidden' }}>
          <Box sx={{
            display: 'flex',
            width: '200%',
            marginLeft: vizTab === 'report-card' ? '0%' : '-100%',
            transition: 'margin-left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
            alignItems: 'flex-start',
          }}>

            {/* ── Graphs panel (shown second; flex order places it on the right) ─ */}
            <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0, order: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 5 }, rowGap: 0 }}
                onMouseLeave={() => setVizHoverId(null)}>

                {/* ERA vs OPS */}
                <Box sx={{ pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Pitching vs Hitting</Typography>
                    <InfoTip size={0.95} text={
                      <>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                        <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team plotted by their pitching quality (ERA, vertical) vs their hitting power (OPS, horizontal). Lower ERA = better pitching, so the top of the chart is elite pitching. Higher OPS = better hitting, so the right side is elite offense. The quadrants label each team style, so top-right teams have both elite pitching and elite hitting.</Typography>
                      </>
                    } />
                  </Box>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>How good a team's pitching and hitting are · top-right = best of both</Typography>
                  <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                </Box>

                {/* Wins vs Run Margin */}
                <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Wins vs Run Margin</Typography>
                    <InfoTip size={0.95} text={
                      <>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                        <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team's actual win% plotted against their run margin (runs scored minus runs allowed). The blue dashed curve is the expected win rate. Teams above the curve are winning more than their scoring predicts. Teams below are underperforming. Hover a team to see their actual record vs expected W-L.</Typography>
                      </>
                    } />
                  </Box>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>Actual record vs expected W-L based on scoring · above the curve = outperforming</Typography>
                  <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                </Box>

                {/* Payroll vs Performance — current season only */}
                {showSos && (
                  <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                        <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Payroll vs. Performance</Typography>
                        <InfoTip size={0.95} text={
                          <>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                            <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>Each bubble is a team's estimated payroll plotted against their current win percentage. The purple dashed line is the league's average efficiency. Teams above the line are outperforming their payroll. The quadrants show Moneyball (low spend, winning), All-In (high spend, winning), Rebuilding (low spend, losing), and Burning $$$ (high spend, losing).</Typography>
                          </>
                        } />
                      </Box>
                      <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>{vizSeason} estimated payroll vs current win% · above the dashed line = best value</Typography>
                      <PayrollWinsPlot data={teamSummaries} payrolls={payrolls} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
                    </Box>
                )}
              </Box>
            </Box>

            {/* ── Report Card panel (shown first; flex order places it on the left) ─ */}
            <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0, order: 1 }}>
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
            </Box>

          </Box>
        </Box>
      )}

      {!loadingViz && teamSummaries.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
      )}

      {/* ── Report Card fullscreen modal — shared by every board ──────────── */}
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
