import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { Team, TeamSummary, SosEntry } from '../types'
import { TEAM_BG, TEAM_ABBR, CURRENT_SEASON, TEAM_PAYROLLS_2026 } from '../constants'
import {
  fetchDivisionForTeam, fetchTeamSummaryData,
  fetchTeamAverageAges, fetchStrengthOfSchedule,
  fetchStreakLeaders, StreakLeaders,
  fetchPitchesPerPa, PitchPaLeaders,
  fetchTopSalaries, SalaryRow,
} from '../api'
// ~1,400-line schedule module — lazy so the League tab doesn't pull it in.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))
import { SpotlightCard, HotGuyData, fetchSpotlight } from './Spotlight'
import { useIsDark, borderAlpha, cardGradient135, fmtGB, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { TopPerformers } from './TopPerformers'
import { RosterMovesCard } from './RosterMoves'
import { LiveDramaCard } from './LiveDrama'
import { FollowedPlayersSection } from './FollowedPlayers'
import { PredictorWidget } from './Predictor'
import { StreakSurvivorWidget } from './StreakSurvivor'
import { MilestoneWatchCard } from './MilestoneWatch'
import { StandingsSnapshot } from './StandingsSnapshot'
import { FinalGamesSection } from './FinalGames'
import { LeaderboardCard, PlayerLeaderboardCard, LbRow, PlayerLbRow } from '../components/leaderboards'
import {
  AgeEntry, buildFraudRows, buildPayrollRows, buildAgeRows, buildSosRows,
  buildStreakRows, buildPitchPaRows, buildSalaryRows,
} from '../components/reportCardRows'
import { getHomeOverlay, clearOverlayIf } from '../state/homeOverlay'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

async function fetchLiveTeamIds(): Promise<Set<number>> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&date=${today}` +
      `&fields=dates,games,status,abstractGameState,detailedState,teams,home,away,team,id`
    )
    const d = await r.json()
    const ids = new Set<number>()
    for (const dateObj of d.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        // Warmup reports abstractGameState "Live" ~20 min before first pitch — skip it.
        if (game.status?.abstractGameState === 'Live' && game.status?.detailedState !== 'Warmup') {
          const hid = game.teams?.home?.team?.id
          const aid = game.teams?.away?.team?.id
          if (hid) ids.add(Number(hid))
          if (aid) ids.add(Number(aid))
        }
      }
    }
    return ids
  } catch { return new Set() }
}

// ─── Team picker ───────────────────────────────────────────────────────────────

function TeamPicker({ allTeams, onSelect }: { allTeams: Team[]; onSelect: (id: number) => void }) {
  const sorted = [...allTeams].sort((a, b) => a.name.localeCompare(b.name))
  const isDark = useIsDark()
  return (
    <Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.5 }}>Pick Your Team</Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mb: 3 }}>
        Follow a team to make this your home base
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 1 }}>
        {sorted.map(t => {
          const bg = ringColor(t.id, isDark)
          return (
            <Box
              key={t.id}
              onClick={() => onSelect(t.id)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
                p: 1.25, borderRadius: 2,
                border: '1.5px solid', borderColor: 'transparent',
                cursor: 'pointer', userSelect: 'none',
                transition: 'all 0.15s',
                '&:hover': { borderColor: bg, bgcolor: `${bg}20`, transform: 'scale(1.04)' },
              }}
            >
              <Box sx={{
                width: 44, height: 44, borderRadius: '50%',
                bgcolor: teamLogoBg(t.id, isDark), border: `2px solid ${bg}`, boxShadow: `0 0 0 1px ${bg}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={teamLogoSrc(t.id, isDark)}
                  alt={t.abbreviation}
                  sx={{ width: 30, height: 30, objectFit: 'contain', transform: teamLogoCrop(t.id, isDark), transformOrigin: 'center' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'text.primary', textAlign: 'center', lineHeight: 1.2 }}>
                {t.abbreviation}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Standing summary ─────────────────────────────────────────────────────────

interface StandingSummary {
  wins: number; losses: number
  divisionRank: number; divisionName: string
  gamesBack: string; divisionLeader: boolean
}


// ─── HomeView props ───────────────────────────────────────────────────────────

export interface HomeViewProps {
  allTeams:          Team[]
  followedTeamId:    number | null
  onFollowTeam:      (teamId: number) => void
  onUnfollowTeam:    () => void
  followedPlayerIds: number[]
  onFollowPlayer:    (id: number) => void
  onUnfollowPlayer:  (id: number) => void
  onPlayerClick:     (id: number) => void
  onTeamClick?:      (id: number) => void
  onViz?:            () => void
}

// Flex `order` for the personal column. The Predictor takes one of two slots
// depending on whether the user still has picks to make.
const ORDER = {
  teamCard:        0,
  predictorTop:    1,
  followedPlayers: 2,
  standings:       3,
  predictorBottom: 4,
  survivor:        5,
} as const

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick, onTeamClick,
  onViz,
}: HomeViewProps) {

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [standing,         setStanding]         = useState<StandingSummary | null>(null)
  const [hotGuy,           setHotGuy]           = useState<HotGuyData | null>(null)
  const [coldGuy,          setColdGuy]          = useState<HotGuyData | null>(null)
  const [loadingSpotlight, setLoadingSpotlight] = useState(false)
  const [liveTeamIds,      setLiveTeamIds]      = useState<Set<number>>(new Set())
  const [showTeamSchedule, setShowTeamSchedule] = useState(false)
  const [teamSummaries,    setTeamSummaries]    = useState<TeamSummary[]>([])
  const [loadingBoard,     setLoadingBoard]     = useState(true)

  // ── Report-card datasets — fetched lazily, only when the day's pair needs one ──
  const [ages,      setAges]      = useState<AgeEntry[]>([])
  const [sosData,   setSosData]   = useState<SosEntry[]>([])
  const [streaks,   setStreaks]   = useState<StreakLeaders | null>(null)
  const [pitchPa,   setPitchPa]   = useState<PitchPaLeaders | null>(null)
  const [salaries,  setSalaries]  = useState<SalaryRow[]>([])
  const [loadingAges,     setLoadingAges]     = useState(false)
  const [loadingSos,      setLoadingSos]      = useState(false)
  const [loadingStreaks,  setLoadingStreaks]  = useState(false)
  const [loadingPitchPa,  setLoadingPitchPa]  = useState(false)
  const [loadingSalaries, setLoadingSalaries] = useState(false)

  // ── Predictor placement ──────────────────────────────────────────────────────
  // Picks still to make → the card sits right under the team card, where it gets
  // acted on. Nothing left to pick → it drops to the bottom of the feed.
  //
  // Latched on the first settled report and then held for the rest of the session:
  // if it re-ordered live, the card would slide out from under the user the moment
  // they made their last pick. Reordering happens via CSS `order` rather than by
  // moving the element, so the widget never unmounts and refetches.
  //
  // Starts optimistic (top). The slate and picks take a moment to load, and on a
  // fresh visit there are almost always picks outstanding — so assuming "pending"
  // means the common case settles with no visible shift at all.
  const [picksPending, setPicksPending] = useState(true)
  const placementLatched = useRef(false)
  const handlePicksSettled = useCallback((remaining: number) => {
    if (placementLatched.current) return
    placementLatched.current = true
    setPicksPending(remaining > 0)
  }, [])
  const predictorOrder = picksPending ? ORDER.predictorTop : ORDER.predictorBottom

  useEffect(() => {
    setLoadingSpotlight(true)
    fetchSpotlight()
      .then(({ hot, cold }) => { setHotGuy(hot); setColdGuy(cold) })
      .finally(() => setLoadingSpotlight(false))
  }, [])

  useEffect(() => {
    fetchTeamSummaryData(CURRENT_SEASON)
      .then(setTeamSummaries)
      .finally(() => setLoadingBoard(false))
  }, [])

  // Fetch which teams are currently in live games
  useEffect(() => {
    fetchLiveTeamIds().then(setLiveTeamIds)
  }, [])

  // Back-from-Search restore: reopen the full-schedule subwindow the user
  // cross-linked from (the actual FullScheduleModal lives in the team card's
  // ScheduleStrip, opened via the showTeamSchedule prop).
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'teamSchedule') setShowTeamSchedule(true)
  }, [])

  useEffect(() => {
    if (!followedTeamId) { setStanding(null); return }
    fetchDivisionForTeam(followedTeamId, CURRENT_SEASON).then(div => {
      const t = div?.teams.find(t => t.teamId === followedTeamId)
      if (t && div) setStanding({
        wins: t.wins, losses: t.losses,
        divisionRank: t.divisionRank, divisionName: div.divisionName,
        gamesBack: t.gamesBack, divisionLeader: t.divisionLeader,
      })
    }).catch(() => {})
  }, [followedTeamId])

  const isDark = useIsDark()

  // ── Daily report cards ────────────────────────────────────────────────────────
  // Two cards rotate daily: each day picks a distinct pair from the pool, keyed to
  // the day, so the two always differ from each other and both change day to day.
  // The pool is every Report Card board — team boards *and* player boards — so
  // anything featured on the Visualize page can surface here too. Selection is
  // deterministic, so we fetch only the data the day's two boards actually need
  // (see the effects below) instead of loading every dataset up front.
  const nameMap = new Map(allTeams.map(t => [t.id, t.name]))

  type BoardKind = 'team' | 'player'
  type DataDep = 'summaries' | 'payroll' | 'ages' | 'sos' | 'streaks' | 'pitchPa' | 'salaries'
  interface BoardMeta {
    id: string; kind: BoardKind; icon: string; title: string
    subtitle: string; accent: string; dep: DataDep; tooltipText?: string
  }

  const QUALIFIED_NOTE = 'Only counts regulars with enough playing time to qualify for a league leaderboard.'
  const BOARD_POOL: BoardMeta[] = [
    { id: 'fraud',           kind: 'team',   icon: '🚨', title: 'Top Frauds',        subtitle: 'Winning more than their scoring predicts', accent: '#f97316', dep: 'summaries' },
    { id: 'cursed',          kind: 'team',   icon: '💀', title: 'Most Cursed',       subtitle: 'Losing more than their scoring predicts',  accent: '#818cf8', dep: 'summaries' },
    { id: 'highest-payroll', kind: 'team',   icon: '💰', title: 'Highest Payrolls',  subtitle: `${CURRENT_SEASON} estimated payroll spend`, accent: '#eab308', dep: 'payroll' },
    { id: 'lowest-payroll',  kind: 'team',   icon: '🪙', title: 'Lowest Payrolls',   subtitle: `${CURRENT_SEASON} estimated payroll spend`, accent: '#22c55e', dep: 'payroll' },
    { id: 'oldest',          kind: 'team',   icon: '👴', title: 'Oldest Rosters',    subtitle: 'Highest avg roster age',                   accent: '#f97316', dep: 'ages' },
    { id: 'youngest',        kind: 'team',   icon: '🌱', title: 'Youngest Rosters',  subtitle: 'Lowest avg roster age',                    accent: '#22c55e', dep: 'ages' },
    { id: 'hardest',         kind: 'team',   icon: '⚔️', title: 'Hardest Schedules', subtitle: 'Toughest remaining opponents',             accent: '#ef4444', dep: 'sos' },
    { id: 'easiest',         kind: 'team',   icon: '🏖️', title: 'Easiest Schedules', subtitle: 'Softest remaining opponents',              accent: '#22c55e', dep: 'sos' },
    { id: 'hit-streak',      kind: 'player', icon: '🔥', title: 'Hitting Streaks',   subtitle: 'Longest active hitting streaks',           accent: '#f97316', dep: 'streaks', tooltipText: 'Games in a row with at least one hit. A game with no official at-bat (all walks or hit by pitches) doesn\'t break the streak.' },
    { id: 'scoreless',       kind: 'player', icon: '🧊', title: 'Scoreless Streaks', subtitle: 'Longest active scoreless-inning runs',     accent: '#38bdf8', dep: 'streaks', tooltipText: 'Innings a pitcher has thrown since the last run they gave up. Counted in whole outings, so the streak starts at their first clean appearance after it.' },
    { id: 'hitless',         kind: 'player', icon: '🥶', title: 'Hitless Streaks',   subtitle: 'Longest active hitless droughts',          accent: '#a78bfa', dep: 'streaks', tooltipText: 'Trips to the plate a hitter has gone without a hit. The cold flip side of the hitting streaks board. Games with no official at-bat are skipped.' },
    { id: 'games-played',    kind: 'player', icon: '🦾', title: 'Iron Men',          subtitle: 'Longest active games-played streaks',      accent: '#eab308', dep: 'streaks', tooltipText: 'Games a player has appeared in without ever sitting one out, carried across seasons. A trade doesn\'t break it. A "+" means the run reaches back further than we searched, so it\'s even longer than shown.' },
    { id: 'pitches-most',    kind: 'player', icon: '⏳', title: 'Grinders',          subtitle: 'Most pitches seen per plate appearance',   accent: '#14b8a6', dep: 'pitchPa', tooltipText: `Pitches a hitter sees per trip to the plate. These are the guys who foul balls off and work deep counts, wearing pitchers down. ${QUALIFIED_NOTE}` },
    { id: 'pitches-fewest',  kind: 'player', icon: '⚡', title: 'Free Swingers',     subtitle: 'Fewest pitches seen per plate appearance', accent: '#f43f5e', dep: 'pitchPa', tooltipText: `Pitches a hitter sees per trip to the plate, lowest in the league. These guys jump on an early strike instead of working the count. ${QUALIFIED_NOTE}` },
    { id: 'top-salary',      kind: 'player', icon: '🤑', title: 'Top Earners',       subtitle: `Highest ${CURRENT_SEASON} salaries`,       accent: '#10b981', dep: 'salaries', tooltipText: `Each player's salary for the ${CURRENT_SEASON} season, straight from their contract. This is the money paid this year, so a backloaded or deferred deal can rank differently than its headline average annual value.` },
  ]

  const boardPairs: Array<[number, number]> = []
  for (let i = 0; i < BOARD_POOL.length; i++)
    for (let j = i + 1; j < BOARD_POOL.length; j++)
      boardPairs.push([i, j])
  const dayNum       = Math.floor(Date.now() / 86400000)
  // Walk the pair list with a stride coprime to its length (105 = 3·5·7) rather
  // than stepping +1 a day: consecutive pairs in the list share a board, so a
  // plain step would leave the same card camped for up to a dozen days. 47 is
  // prime and hits every pair once across the cycle.
  const [aIdx, bIdx] = boardPairs[(dayNum * 47) % boardPairs.length]
  // Alternate which of the pair sits on top so the ordering feels fresh too.
  const selectedMetas = dayNum % 2 === 0
    ? [BOARD_POOL[aIdx], BOARD_POOL[bIdx]]
    : [BOARD_POOL[bIdx], BOARD_POOL[aIdx]]
  const neededDeps = new Set<DataDep>(selectedMetas.map(m => m.dep))

  // Rows + loading for one board, built from whatever dataset backs it.
  const rowsForBoard = (m: BoardMeta): { rows: LbRow[] | PlayerLbRow[]; loading: boolean } => {
    switch (m.id) {
      case 'fraud':           return { rows: buildFraudRows(teamSummaries, nameMap, 'fraud'),  loading: loadingBoard }
      case 'cursed':          return { rows: buildFraudRows(teamSummaries, nameMap, 'cursed'), loading: loadingBoard }
      case 'highest-payroll': return { rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'highest'), loading: false }
      case 'lowest-payroll':  return { rows: buildPayrollRows(TEAM_PAYROLLS_2026, nameMap, 'lowest'),  loading: false }
      case 'oldest':          return { rows: buildAgeRows(ages, nameMap, 'oldest'),   loading: loadingAges }
      case 'youngest':        return { rows: buildAgeRows(ages, nameMap, 'youngest'), loading: loadingAges }
      case 'hardest':         return { rows: buildSosRows(sosData, 'hardest'), loading: loadingSos }
      case 'easiest':         return { rows: buildSosRows(sosData, 'easiest'), loading: loadingSos }
      case 'hit-streak':      return { rows: buildStreakRows(streaks?.hitting ?? [], 'hitting'),         loading: loadingStreaks }
      case 'scoreless':       return { rows: buildStreakRows(streaks?.scoreless ?? [], 'scoreless'),     loading: loadingStreaks }
      case 'hitless':         return { rows: buildStreakRows(streaks?.hitless ?? [], 'hitless'),         loading: loadingStreaks }
      case 'games-played':    return { rows: buildStreakRows(streaks?.gamesPlayed ?? [], 'gamesPlayed'), loading: loadingStreaks }
      case 'pitches-most':    return { rows: buildPitchPaRows(pitchPa, 'most'),   loading: loadingPitchPa }
      case 'pitches-fewest':  return { rows: buildPitchPaRows(pitchPa, 'fewest'), loading: loadingPitchPa }
      case 'top-salary':      return { rows: buildSalaryRows(salaries), loading: loadingSalaries }
      default:                return { rows: [], loading: false }
    }
  }

  // ── Lazy dataset fetches — each fires only on a day whose pair needs it ────────
  const needAges     = neededDeps.has('ages')
  const needSos      = neededDeps.has('sos')
  const needStreaks  = neededDeps.has('streaks')
  const needPitchPa  = neededDeps.has('pitchPa')
  const needSalaries = neededDeps.has('salaries')

  useEffect(() => {
    if (!needAges || ages.length) return
    let cancelled = false
    setLoadingAges(true)
    fetchTeamAverageAges(CURRENT_SEASON)
      .then(map => {
        if (cancelled) return
        setAges(Object.entries(map)
          .map(([id, avgAge]) => ({ teamId: Number(id), abbr: TEAM_ABBR[Number(id)] ?? '?', avgAge }))
          .filter(e => e.abbr !== '?')
          .sort((a, b) => b.avgAge - a.avgAge))
      })
      .catch(() => { if (!cancelled) setAges([]) })
      .finally(() => { if (!cancelled) setLoadingAges(false) })
    return () => { cancelled = true }
  }, [needAges])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!needSos || sosData.length) return
    let cancelled = false
    setLoadingSos(true)
    fetchStrengthOfSchedule(CURRENT_SEASON)
      .then(d => { if (!cancelled) setSosData(d) })
      .catch(() => { if (!cancelled) setSosData([]) })
      .finally(() => { if (!cancelled) setLoadingSos(false) })
    return () => { cancelled = true }
  }, [needSos])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!needStreaks || streaks) return
    let cancelled = false
    setLoadingStreaks(true)
    fetchStreakLeaders(CURRENT_SEASON)
      .then(d => { if (!cancelled) setStreaks(d) })
      .catch(() => { if (!cancelled) setStreaks(null) })
      .finally(() => { if (!cancelled) setLoadingStreaks(false) })
    return () => { cancelled = true }
  }, [needStreaks])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!needPitchPa || pitchPa) return
    let cancelled = false
    setLoadingPitchPa(true)
    fetchPitchesPerPa(CURRENT_SEASON)
      .then(d => { if (!cancelled) setPitchPa(d) })
      .catch(() => { if (!cancelled) setPitchPa(null) })
      .finally(() => { if (!cancelled) setLoadingPitchPa(false) })
    return () => { cancelled = true }
  }, [needPitchPa])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!needSalaries || salaries.length) return
    let cancelled = false
    setLoadingSalaries(true)
    fetchTopSalaries(CURRENT_SEASON)
      .then(d => { if (!cancelled) setSalaries(d) })
      .catch(() => { if (!cancelled) setSalaries([]) })
      .finally(() => { if (!cancelled) setLoadingSalaries(false) })
    return () => { cancelled = true }
  }, [needSalaries])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived team info ─────────────────────────────────────────────────────────
  const followedTeam = allTeams.find(t => t.id === followedTeamId)
  const bg       = TEAM_BG[followedTeamId ?? 0] ?? '#1a2035'
  const abbr     = followedTeam?.abbreviation ?? '?'
  // Use the full team name directly. `locationName` is the raw municipality
  // (e.g. "Denver" for the Rockies, "Bronx" for the Yankees, "Arlington" for
  // the Rangers), which reads wrong next to the common name — `name` is the
  // authoritative "City Nickname" for all 30 teams.
  const teamLabel = followedTeam?.name ?? followedTeam?.teamName ?? '—'

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${fmtGB(standing.gamesBack)} GB` : null,
  ].filter(Boolean).join(' · ') : null

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Scoreboard — full-width header, always visible ─────────────────────── */}
      <Box sx={{ mb: 2 }}>
        <FinalGamesSection followedTeamId={followedTeamId} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
      </Box>

      {/* ── Happening Now — only renders while live drama is brewing ───────────── */}
      <LiveDramaCard onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

      {/* ── Merged feed ────────────────────────────────────────────────────────
          One scroll: "My Feed" (personal, wider) then "Around the League".
          On md+ these are two columns; on mobile they stack in DOM order,
          separated only by the grid's rowGap (no divider line). */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
        columnGap: 2.5,
        rowGap: { xs: 2, md: 0 },
        alignItems: 'start',
      }}>

        {/* ═══ Personal column — My Feed ═══════════════════════════════════════ */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {followedTeamId ? (
            <>
              {/* Team card */}
              <Box sx={{
                order: ORDER.teamCard,
                borderRadius: 3, overflow: 'hidden',
                border: '1px solid', borderColor: borderAlpha(bg, isDark),
                borderLeft: `4px solid ${bg}`,
                bgcolor: 'background.paper',
                background: cardGradient135(bg, isDark),
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Team header — name+standing | buttons. px matches the schedule
                    strip's 2.5 below so the name/record align with the game text. */}
                <Box sx={{ px: 2.5, pt: 1.25, pb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{
                        fontSize: { xs: '1.05rem', sm: '1.25rem' }, fontWeight: 900,
                        letterSpacing: '-0.5px', lineHeight: 1.25,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {teamLabel}
                      </Typography>
                      {standingLine && (
                        <Typography sx={{ fontSize: { xs: '0.62rem', sm: '0.74rem' }, color: 'text.secondary', mt: 0.35, lineHeight: 1.3 }}>
                          {standingLine}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
                      <Box
                        onClick={() => setShowTeamSchedule(true)}
                        sx={{
                          fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled',
                          cursor: 'pointer', px: 0.9, py: 0.3,
                          borderRadius: 999, border: '1px solid', borderColor: 'divider',
                          whiteSpace: 'nowrap',
                          transition: 'color 0.12s, border-color 0.12s',
                          '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
                        }}
                      >
                        Schedule →
                      </Box>
                      <Box
                        onClick={onUnfollowTeam}
                        sx={{
                          fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled',
                          cursor: 'pointer', px: 0.9, py: 0.3,
                          borderRadius: 999, border: '1px solid', borderColor: 'divider',
                          whiteSpace: 'nowrap',
                          transition: 'color 0.12s, border-color 0.12s',
                          '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
                        }}
                      >
                        Change
                      </Box>
                    </Box>
                  </Box>
                </Box>

                {/* Schedule strip */}
                <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  <Suspense fallback={<Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', px: 1.5, py: 1 }}>Loading schedule…</Typography>}>
                    <TeamScheduleStrip
                      teamId={followedTeamId}
                      teamColor={bg}
                      showSchedule={showTeamSchedule}
                      onScheduleClose={() => { setShowTeamSchedule(false); clearOverlayIf('teamSchedule') }}
                      onPlayerClick={onPlayerClick}
                      onTeamClick={onTeamClick}
                    />
                  </Suspense>
                </Box>
              </Box>

              {/* Your players — capped so a long list doesn't dominate; scrolls internally */}
              <Box sx={{ order: ORDER.followedPlayers, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: { xs: 'none', md: 460 } }}>
                <FollowedPlayersSection
                  followedPlayerIds={followedPlayerIds}
                  onUnfollow={onUnfollowPlayer}
                  onPlayerClick={onPlayerClick}
                  onFollow={onFollowPlayer}
                  liveTeamIds={liveTeamIds}
                  teamId={followedTeamId}
                  compact
                />
              </Box>

              {/* Predictor — under the team card while picks are open, else last */}
              <Box sx={{ order: predictorOrder, minWidth: 0 }}>
                <PredictorWidget onPicksSettled={handlePicksSettled} />
              </Box>

              {/* Standings snapshot — division race if in the hunt, else the wild card */}
              <Box sx={{ order: ORDER.standings, minWidth: 0 }}>
                <StandingsSnapshot followedTeamId={followedTeamId} season={CURRENT_SEASON} onTeamClick={onTeamClick} />
              </Box>

              {/* Streak Survivor — daily hitter-streak game */}
              <Box sx={{ order: ORDER.survivor, minWidth: 0 }}>
                <StreakSurvivorWidget />
              </Box>
            </>
          ) : (
            /* No team followed: picker leads, so the feed always nudges the core action */
            <>
              <Box sx={{ order: ORDER.teamCard, minWidth: 0 }}>
                <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
              </Box>
              <Box sx={{ order: ORDER.followedPlayers, minWidth: 0 }}>
                <FollowedPlayersSection
                  followedPlayerIds={followedPlayerIds}
                  onUnfollow={onUnfollowPlayer}
                  onPlayerClick={onPlayerClick}
                  onFollow={onFollowPlayer}
                  liveTeamIds={liveTeamIds}
                />
              </Box>
              <Box sx={{ order: predictorOrder, minWidth: 0 }}>
                <PredictorWidget onPicksSettled={handlePicksSettled} />
              </Box>

              {/* Standings snapshot — no team followed, so a rotating division */}
              <Box sx={{ order: ORDER.standings, minWidth: 0 }}>
                <StandingsSnapshot followedTeamId={followedTeamId} season={CURRENT_SEASON} onTeamClick={onTeamClick} />
              </Box>

              {/* Streak Survivor — daily hitter-streak game */}
              <Box sx={{ order: ORDER.survivor, minWidth: 0 }}>
                <StreakSurvivorWidget />
              </Box>
            </>
          )}
        </Box>

        {/* ═══ Discovery column — Around the League ════════════════════════════ */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Standout performances */}
          <TopPerformers onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

          {/* Roster moves — trades, DFAs, claims, signings; deadline countdown in July */}
          <RosterMovesCard followedTeamId={followedTeamId} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

          {/* Milestone Watch — players closing in on career/season/record marks */}
          <MilestoneWatchCard season={CURRENT_SEASON} liveTeamIds={liveTeamIds} onPlayerClick={onPlayerClick} />


          {/* Featured spotlight — hot / cold. No floating section title; the
              On Fire / Ice Cold cards below are self-labeling. */}
          <Box>
            {loadingSpotlight && !hotGuy && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading…</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {hotGuy && (
                <SpotlightCard data={hotGuy} mode="hot" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
              )}
              {coldGuy && (
                <SpotlightCard data={coldGuy} mode="cold" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
              )}
            </Box>
          </Box>

          {/* Daily report cards — two cards drawn from the full pool (team + player
              boards), rotating day to day. Each carries its own heading. */}
          {selectedMetas.map(m => {
            const { rows, loading } = rowsForBoard(m)
            return m.kind === 'player' ? (
              <PlayerLeaderboardCard
                key={m.id}
                icon={m.icon} title={m.title} subtitle={m.subtitle} accent={m.accent}
                tooltipText={m.tooltipText}
                rows={rows as PlayerLbRow[]}
                loading={loading}
                onExpand={onViz ?? (() => {})}
                onSelectPlayer={onPlayerClick}
              />
            ) : (
              <LeaderboardCard
                key={m.id}
                icon={m.icon} title={m.title} subtitle={m.subtitle} accent={m.accent}
                rows={rows as LbRow[]}
                loading={loading}
                onExpand={onViz ?? (() => {})}
                expandLabel="View All →"
                onSelectTeam={onTeamClick}
              />
            )
          })}
        </Box>

      </Box>
    </Box>
  )
}
