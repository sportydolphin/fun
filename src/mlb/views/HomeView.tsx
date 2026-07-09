import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { Team, TeamSummary } from '../types'
import { TEAM_BG, CURRENT_SEASON } from '../constants'
import { fetchDivisionForTeam, fetchTeamSummaryData } from '../api'
// ~1,400-line schedule module — lazy so the League tab doesn't pull it in.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))
import { SpotlightCard, HotGuyData, fetchSpotlight } from './Spotlight'
import { useIsDark, borderAlpha, cardGradient135, fmtGB } from '../colorUtils'
import { TopPerformers } from './TopPerformers'
import { FollowedPlayersSection } from './FollowedPlayers'
import { PredictorWidget } from './Predictor'
import { FinalGamesSection } from './FinalGames'
import { LeaderboardCard, LeaderboardModal, buildFraudRows, LbRow } from './VizView'

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

// ─── Team logo ─────────────────────────────────────────────────────────────────

function TeamLogoCircle({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%',
      bgcolor: '#fff', border: `2.5px solid ${bg}`,
      boxShadow: `0 0 0 1px ${bg}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {failed ? (
        <Typography sx={{ color: bg, fontWeight: 900, fontSize: size * 0.28, lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: '78%', height: '78%', objectFit: 'contain' }}
        />
      )}
    </Box>
  )
}

// ─── Team picker ───────────────────────────────────────────────────────────────

function TeamPicker({ allTeams, onSelect }: { allTeams: Team[]; onSelect: (id: number) => void }) {
  const sorted = [...allTeams].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.5 }}>Pick Your Team</Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mb: 3 }}>
        Follow a team to make this your home base
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 1 }}>
        {sorted.map(t => {
          const bg = TEAM_BG[t.id] ?? '#333'
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
                bgcolor: '#fff', border: `2px solid ${bg}`, boxShadow: `0 0 0 1px ${bg}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={`https://www.mlbstatic.com/team-logos/${t.id}.svg`}
                  alt={t.abbreviation}
                  sx={{ width: 30, height: 30, objectFit: 'contain' }}
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

// ─── HomeSubNav — in-page tab switcher ────────────────────────────────────────
// Underline style keeps it visually distinct from the primary SegControl tabs.

function HomeSubNav({ tab, onChange }: {
  tab: 'league' | 'team'; onChange: (t: 'league' | 'team') => void
}) {
  const tabs: Array<{ value: 'league' | 'team'; label: string }> = [
    { value: 'league', label: 'Around the League' },
    { value: 'team',   label: 'My Stuff' },
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
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {label}
          </Box>
        )
      })}
    </Box>
  )
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
  // Lifted to useMlbState so browser Back can restore the sub-tab — see [[nav-back-stack]]
  homeTab:           'league' | 'team'
  onHomeTabChange:   (t: 'league' | 'team') => void
  onLeaderboard?:    () => void
  onViz?:            () => void
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick, onTeamClick,
  homeTab, onHomeTabChange, onLeaderboard, onViz,
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
  const [featuredExpanded, setFeaturedExpanded] = useState(false)
  const leftColRef  = useRef<HTMLDivElement>(null)
  const [leftColHeight, setLeftColHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = leftColRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setLeftColHeight(entries[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // ── Touch / swipe ─────────────────────────────────────────────────────────────
  const touchStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Walk up the DOM — if the touch originates inside a horizontally-scrollable
    // child (marked data-swipe-ignore="true"), don't use it to switch tabs.
    let ignore = false
    let el: EventTarget | null = e.target
    while (el instanceof Element) {
      if (el.getAttribute('data-swipe-ignore') === 'true') { ignore = true; break }
      el = el.parentElement
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ignore }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || touchStartRef.current.ignore) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    onHomeTabChange(dx < 0 ? 'team' : 'league')
  }, [])

  const isDark = useIsDark()

  // ── Daily rotating report card ────────────────────────────────────────────────
  const nameMap    = new Map(allTeams.map(t => [t.id, t.name]))
  const boardType  = new Date().getDate() % 2 === 0 ? 'fraud' : 'cursed'
  const boardRows: LbRow[] = teamSummaries.length > 0 ? buildFraudRows(teamSummaries, nameMap, boardType) : []
  const boardMeta  = boardType === 'fraud'
    ? { icon: '🚨', title: 'Top Frauds',    subtitle: 'Winning more than their scoring predicts', accent: '#f97316' }
    : { icon: '💀', title: 'Most Cursed',   subtitle: 'Losing more than their scoring predicts',  accent: '#818cf8' }

  // ── Derived team info ─────────────────────────────────────────────────────────
  const followedTeam = allTeams.find(t => t.id === followedTeamId)
  const bg       = TEAM_BG[followedTeamId ?? 0] ?? '#1a2035'
  const abbr     = followedTeam?.abbreviation ?? '?'
  const nickname = followedTeam?.teamName     ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w[w.length - 1] })()
  const city     = followedTeam?.locationName ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w.slice(0, -1).join(' ') })()

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${fmtGB(standing.gamesBack)} GB` : null,
  ].filter(Boolean).join(' · ') : null

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Scoreboard — above tabs, persists on both panels ─────────────────── */}
      <Box sx={{ mb: 2 }}>
        <FinalGamesSection followedTeamId={followedTeamId} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
      </Box>

      {/* ── In-page tab switcher ─────────────────────────────────────────────── */}
      <HomeSubNav tab={homeTab} onChange={onHomeTabChange} />

      {/* ── Swipeable two-panel layout ───────────────────────────────────────── */}
      <Box
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        sx={{ overflow: 'hidden' }}
      >
        <Box sx={{
          display: 'flex',
          width: '200%',
          marginLeft: homeTab === 'league' ? '0%' : '-100%',
          transition: 'margin-left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          alignItems: 'flex-start',
        }}>

          {/* ── Panel 1: Around the League ────────────────────────────────────── */}
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0, overflowX: 'hidden' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>

              {/* Left column: Standout Performances */}
              <TopPerformers onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

              {/* Right column: Featured daily report card */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: 0.3, color: 'text.primary' }}>
                    Featured
                  </Typography>
                  <Box
                    onClick={onLeaderboard}
                    sx={{
                      px: 1, py: '3px', borderRadius: 999,
                      bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                      cursor: onLeaderboard ? 'pointer' : 'default',
                      transition: 'border-color 0.12s',
                      '&:hover': onLeaderboard ? { borderColor: 'text.secondary' } : {},
                    }}
                  >
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3, lineHeight: 1 }}>
                      View All →
                    </Typography>
                  </Box>
                </Box>
                {loadingSpotlight && !hotGuy && (
                  <Box sx={{ py: 4, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading…</Typography>
                  </Box>
                )}
                {hotGuy && (
                  <SpotlightCard data={hotGuy} mode="hot" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
                )}
                {coldGuy && (
                  <SpotlightCard data={coldGuy} mode="cold" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
                )}
              </Box>

            </Box>

            {/* ── Daily report card — full-width below the two columns ─────────── */}
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: 0.3, color: 'text.primary' }}>
                  Featured Report Card
                </Typography>
                <Box
                  onClick={onViz}
                  sx={{
                    px: 1, py: '3px', borderRadius: 999,
                    bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                    cursor: onViz ? 'pointer' : 'default',
                    transition: 'border-color 0.12s',
                    '&:hover': onViz ? { borderColor: 'text.secondary' } : {},
                  }}
                >
                  <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3, lineHeight: 1 }}>
                    View All →
                  </Typography>
                </Box>
              </Box>
              <LeaderboardCard
                {...boardMeta}
                rows={boardRows}
                loading={loadingBoard}
                onExpand={() => setFeaturedExpanded(true)}
                onSelectTeam={onTeamClick}
              />
            </Box>
            <LeaderboardModal
              open={featuredExpanded}
              onClose={() => setFeaturedExpanded(false)}
              {...boardMeta}
              rows={boardRows}
              onSelectTeam={onTeamClick}
            />

          </Box>

          {/* ── Panel 2: My Team ──────────────────────────────────────────────── */}
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0, overflowX: 'hidden' }}>
            {followedTeamId ? (
              /* ── Two-column grid: left col = team + predictor, right col = players ── */
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 1.5,
                alignItems: 'start',
              }}>

                {/* Left column: team card + predictor stacked */}
                <Box ref={leftColRef} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

                  {/* Team card */}
                  <Box sx={{
                    borderRadius: 3, overflow: 'hidden',
                    border: '1px solid', borderColor: borderAlpha(bg, isDark),
                    borderLeft: `4px solid ${bg}`,
                    bgcolor: 'background.paper',
                    background: cardGradient135(bg, isDark),
                    display: 'flex', flexDirection: 'column',
                  }}>
                    {/* Team header — logo | name+standing | buttons */}
                    <Box sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TeamLogoCircle teamId={followedTeamId} abbr={abbr} size={34} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{
                            fontSize: { xs: '1.05rem', sm: '1.25rem' }, fontWeight: 900,
                            letterSpacing: '-0.5px', lineHeight: 1.25,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {city ? `${city} ${nickname}` : nickname}
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
                          onScheduleClose={() => setShowTeamSchedule(false)}
                          onPlayerClick={onPlayerClick}
                          onTeamClick={onTeamClick}
                        />
                      </Suspense>
                    </Box>
                  </Box>

                  {/* Predictor */}
                  <PredictorWidget />

                </Box>

                {/* Right column: players — grows with content, capped at left column height */}
                <Box sx={{
                  display: 'flex', flexDirection: 'column',
                  maxHeight: { xs: 'none', md: leftColHeight ? `${leftColHeight}px` : 'none' },
                }}>
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

              </Box>
            ) : (
              /* No team: full-width picker + players + predictor stacked */
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
                <FollowedPlayersSection
                  followedPlayerIds={followedPlayerIds}
                  onUnfollow={onUnfollowPlayer}
                  onPlayerClick={onPlayerClick}
                  onFollow={onFollowPlayer}
                  liveTeamIds={liveTeamIds}
                />
                <PredictorWidget />
              </Box>
            )}
          </Box>

        </Box>
      </Box>
    </Box>
  )
}
