import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { Team } from '../types'
import { TEAM_BG, CURRENT_SEASON } from '../constants'
import { fetchDivisionForTeam } from '../api'
// ~1,400-line schedule module — lazy so the League tab doesn't pull it in.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))
import { SpotlightCard, HotGuyData, fetchSpotlight } from './Spotlight'
import { TopPerformers } from './TopPerformers'
import { FollowedPlayersSection } from './FollowedPlayers'
import { PredictorWidget } from './Predictor'
import { FinalGamesSection } from './FinalGames'

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
      `&fields=dates,games,status,abstractGameState,teams,home,away,team,id`
    )
    const d = await r.json()
    const ids = new Set<number>()
    for (const dateObj of d.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        if (game.status?.abstractGameState === 'Live') {
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
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick, onTeamClick,
  homeTab, onHomeTabChange,
}: HomeViewProps) {

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [standing,         setStanding]         = useState<StandingSummary | null>(null)
  const [hotGuy,           setHotGuy]           = useState<HotGuyData | null>(null)
  const [coldGuy,          setColdGuy]          = useState<HotGuyData | null>(null)
  const [loadingSpotlight, setLoadingSpotlight] = useState(false)
  const [liveTeamIds,      setLiveTeamIds]      = useState<Set<number>>(new Set())
  const [showTeamSchedule, setShowTeamSchedule] = useState(false)

  useEffect(() => {
    setLoadingSpotlight(true)
    fetchSpotlight()
      .then(({ hot, cold }) => { setHotGuy(hot); setColdGuy(cold) })
      .finally(() => setLoadingSpotlight(false))
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

  // ── Derived team info ─────────────────────────────────────────────────────────
  const followedTeam = allTeams.find(t => t.id === followedTeamId)
  const bg       = TEAM_BG[followedTeamId ?? 0] ?? '#1a2035'
  const abbr     = followedTeam?.abbreviation ?? '?'
  const nickname = followedTeam?.teamName     ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w[w.length - 1] })()
  const city     = followedTeam?.locationName ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w.slice(0, -1).join(' ') })()

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${standing.gamesBack} GB` : null,
  ].filter(Boolean).join(' · ') : null

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Box>
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
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Scoreboard — by-date live/past/future games, click for box score */}
              <FinalGamesSection followedTeamId={followedTeamId} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

              {/* Top performers cycling carousel */}
              <TopPerformers onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />

              {loadingSpotlight && !hotGuy && !coldGuy && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading spotlight…</Typography>
                </Box>
              )}
              {(hotGuy || coldGuy) && (
                <Box sx={{ display: 'flex', gap: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
                  {hotGuy  && <SpotlightCard data={hotGuy}  mode="hot"  onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />}
                  {coldGuy && <SpotlightCard data={coldGuy} mode="cold" onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />}
                </Box>
              )}
              {!loadingSpotlight && !hotGuy && !coldGuy && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>No spotlight data available</Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* ── Panel 2: My Team ──────────────────────────────────────────────── */}
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {followedTeamId ? (
                // Side-by-side on md+, stacked below (avoids cramped ~300px columns on tablets)
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5, alignItems: 'stretch' }}>

                  {/* Compact team card */}
                  <Box sx={{
                    flex: { xs: '1 1 auto', md: '0 0 calc(50% - 6px)' }, minWidth: 0,
                    borderRadius: 3, overflow: 'hidden',
                    border: '1px solid', borderColor: `${bg}40`,
                    borderLeft: `4px solid ${bg}`,
                    bgcolor: 'background.paper',
                    background: `linear-gradient(135deg, ${bg}1a 0%, ${bg}08 50%, transparent 75%)`,
                    display: 'flex', flexDirection: 'column',
                  }}>
                    {/* Team header — compact 2-row layout */}
                    <Box sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
                      {/* Row 1: logo + schedule + change buttons */}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <TeamLogoCircle teamId={followedTeamId} abbr={abbr} size={32} />
                        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                          <Box
                            onClick={() => setShowTeamSchedule(true)}
                            sx={{
                              fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled',
                              cursor: 'pointer', px: 0.9, py: 0.3,
                              borderRadius: 999, border: '1px solid', borderColor: 'divider',
                              whiteSpace: 'nowrap', flexShrink: 0,
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
                              whiteSpace: 'nowrap', flexShrink: 0,
                              transition: 'color 0.12s, border-color 0.12s',
                              '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
                            }}
                          >
                            Change
                          </Box>
                        </Box>
                      </Box>
                      {/* Row 2: city + nickname + standing */}
                      {city && (
                        <Typography sx={{
                          fontSize: { xs: '0.5rem', sm: '0.62rem' }, fontWeight: 700, letterSpacing: '2px',
                          textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1, mb: 0.2,
                        }}>
                          {city}
                        </Typography>
                      )}
                      <Typography sx={{
                        fontSize: { xs: '1rem', sm: '1.2rem' }, fontWeight: 900,
                        textTransform: 'uppercase', letterSpacing: '-0.5px', lineHeight: 1,
                      }}>
                        {nickname}
                      </Typography>
                      {standingLine && (
                        <Typography sx={{ fontSize: { xs: '0.62rem', sm: '0.74rem' }, color: 'text.secondary', mt: 0.3, lineHeight: 1.3 }}>
                          {standingLine}
                        </Typography>
                      )}
                    </Box>

                    {/* Schedule strip */}
                    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
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

                  {/* Followed players — compact mode, stretches to match team card */}
                  <Box sx={{ flex: { xs: '1 1 auto', md: '0 0 calc(50% - 6px)' }, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
                /* No team: full-width picker + full-width players below */
                <>
                  <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
                  <FollowedPlayersSection
                    followedPlayerIds={followedPlayerIds}
                    onUnfollow={onUnfollowPlayer}
                    onPlayerClick={onPlayerClick}
                    onFollow={onFollowPlayer}
                    liveTeamIds={liveTeamIds}
                  />
                </>
              )}

              {/* ── My Predictions ──────────────────────────────────────────── */}
              <PredictorWidget
                onTeamClick={onTeamClick ?? (() => {})}
              />

            </Box>
          </Box>

        </Box>
      </Box>
    </Box>
  )
}
