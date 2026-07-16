import React, { useState, useEffect, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { Team, TeamSummary } from '../types'
import { TEAM_BG, CURRENT_SEASON } from '../constants'
import { fetchDivisionForTeam, fetchTeamSummaryData } from '../api'
// ~1,400-line schedule module — lazy so the League tab doesn't pull it in.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))
import { SpotlightCard, HotGuyData, fetchSpotlight } from './Spotlight'
import { useIsDark, borderAlpha, cardGradient135, fmtGB, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../colorUtils'
import { TopPerformers } from './TopPerformers'
import { FollowedPlayersSection } from './FollowedPlayers'
import { PredictorWidget } from './Predictor'
import { FinalGamesSection } from './FinalGames'
import { LeaderboardCard, LeaderboardModal, buildFraudRows, LbRow } from './VizView'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../homeOverlay'

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

// ─── SectionDivider — quiet rule between the two families on mobile ────────────
// On md+ the two families sit side by side as columns, so this drops out of
// the grid entirely (display:none) and leaves exactly two column tracks.

function SectionDivider() {
  return (
    <Box sx={{ display: { xs: 'block', md: 'none' }, height: '1px', bgcolor: 'divider', my: 1 }} />
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
  onLeaderboard?:    () => void
  onViz?:            () => void
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick, onTeamClick,
  onLeaderboard, onViz,
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

  // Back-from-Search restore: reopen the report card or full-schedule subwindow
  // the user cross-linked from (the actual FullScheduleModal lives in the team
  // card's ScheduleStrip, opened via the showTeamSchedule prop).
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'reportCard')   setFeaturedExpanded(true)
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
      {/* ── Scoreboard — full-width header, always visible ─────────────────────── */}
      <Box sx={{ mb: 2 }}>
        <FinalGamesSection followedTeamId={followedTeamId} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
      </Box>

      {/* ── Merged feed ────────────────────────────────────────────────────────
          One scroll: "My Feed" (personal, wider) then "Around the League".
          On md+ these are two columns; on mobile they stack in DOM order with
          the SectionDivider between them. The divider is display:none on md, so
          it drops out of the grid and leaves exactly two column tracks. */}
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
                borderRadius: 3, overflow: 'hidden',
                border: '1px solid', borderColor: borderAlpha(bg, isDark),
                borderLeft: `4px solid ${bg}`,
                bgcolor: 'background.paper',
                background: cardGradient135(bg, isDark),
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Team header — name+standing | buttons */}
                <Box sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                      onScheduleClose={() => { setShowTeamSchedule(false); clearOverlayIf('teamSchedule') }}
                      onPlayerClick={onPlayerClick}
                      onTeamClick={onTeamClick}
                    />
                  </Suspense>
                </Box>
              </Box>

              {/* Your players — capped so a long list doesn't dominate; scrolls internally */}
              <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: { xs: 'none', md: 460 } }}>
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

              {/* Predictor */}
              <PredictorWidget />
            </>
          ) : (
            /* No team followed: picker leads, so the feed always nudges the core action */
            <>
              <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
              <FollowedPlayersSection
                followedPlayerIds={followedPlayerIds}
                onUnfollow={onUnfollowPlayer}
                onPlayerClick={onPlayerClick}
                onFollow={onFollowPlayer}
                liveTeamIds={liveTeamIds}
              />
              <PredictorWidget />
            </>
          )}
        </Box>

        {/* ═══ Mobile-only family divider (removed from the grid on md) ════════ */}
        <SectionDivider />

        {/* ═══ Discovery column — Around the League ════════════════════════════ */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Standout performances */}
          <TopPerformers onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

          {/* Featured spotlight — hot / cold. No floating section title; the
              On Fire / Ice Cold cards below are self-labeling. */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1.25 }}>
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
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {hotGuy && (
                <SpotlightCard data={hotGuy} mode="hot" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
              )}
              {coldGuy && (
                <SpotlightCard data={coldGuy} mode="cold" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
              )}
            </Box>
          </Box>

          {/* Daily report card. No floating section title; the card carries its
              own heading. */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1.25 }}>
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
        </Box>

      </Box>

      <LeaderboardModal
        open={featuredExpanded}
        onClose={() => { setFeaturedExpanded(false); clearOverlayIf('reportCard') }}
        {...boardMeta}
        rows={boardRows}
        onSelectTeam={stampOverlay({ kind: 'reportCard' }, onTeamClick)}
      />
    </Box>
  )
}
