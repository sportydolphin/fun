import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { Team } from '../types'
import { TEAM_BG, CURRENT_SEASON } from '../constants'
import { fetchDivisionForTeam } from '../api'
import { TeamScheduleStrip } from './ScheduleStrip'
import { SpotlightCard, HotGuyData, fetchSpotlight } from './Spotlight'
import { FollowedPlayersSection } from './FollowedPlayers'
import { PredictorWidget } from './Predictor'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ─── Team logo ─────────────────────────────────────────────────────────────────

function TeamLogoCircle({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%',
      bgcolor: '#fff',
      border: `2.5px solid ${bg}`,
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
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.5 }}>
        Pick Your Team
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.82rem', mb: 3 }}>
        Follow a team to make this your home base
      </Typography>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
        gap: 1,
      }}>
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

// ─── Standing summary type ─────────────────────────────────────────────────────

interface StandingSummary {
  wins:           number
  losses:         number
  divisionRank:   number
  divisionName:   string
  gamesBack:      string
  divisionLeader: boolean
}

// ─── HomeSubNav — in-page tab switcher ────────────────────────────────────────
// Underline-tab style so it reads as page-internal navigation,
// clearly distinct from the primary SegControl tabs at the top.

function HomeSubNav({ tab, teamLabel, onChange }: {
  tab:       'league' | 'team'
  teamLabel: string
  onChange:  (t: 'league' | 'team') => void
}) {
  const tabs: Array<{ value: 'league' | 'team'; label: string }> = [
    { value: 'league', label: 'Around the League' },
    { value: 'team',   label: teamLabel },
  ]
  return (
    <Box sx={{
      display: 'flex',
      borderBottom: '1px solid',
      borderColor: 'divider',
      mb: 2.5,
      // Bleed to card edges on mobile so it feels full-width
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
              flex: 1,
              py: 0.9,
              textAlign: 'center',
              fontSize: { xs: '0.78rem', sm: '0.84rem' },
              fontWeight: active ? 700 : 500,
              color: active ? 'text.primary' : 'text.secondary',
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: '2.5px solid',
              borderColor: active ? 'text.primary' : 'transparent',
              mb: '-1px',   // overlap the container's bottom border
              transition: 'color 0.15s, border-color 0.15s',
              '&:hover': { color: 'text.primary' },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
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
}

// ─── HomeView ─────────────────────────────────────────────────────────────────

export function HomeView({
  allTeams, followedTeamId, onFollowTeam, onUnfollowTeam,
  followedPlayerIds, onFollowPlayer, onUnfollowPlayer, onPlayerClick, onTeamClick,
}: HomeViewProps) {

  // ── Sub-page state ───────────────────────────────────────────────────────────
  // Default to "team" if a team is already followed, else "league"
  const [homeTab, setHomeTab] = useState<'league' | 'team'>(
    () => followedTeamId ? 'team' : 'league'
  )

  // Automatically switch to "My Team" when a team gets followed
  useEffect(() => {
    if (followedTeamId) setHomeTab('team')
  }, [followedTeamId])

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [standing,         setStanding]         = useState<StandingSummary | null>(null)
  const [hotGuy,           setHotGuy]           = useState<HotGuyData | null>(null)
  const [coldGuy,          setColdGuy]          = useState<HotGuyData | null>(null)
  const [loadingSpotlight, setLoadingSpotlight] = useState(false)

  useEffect(() => {
    setLoadingSpotlight(true)
    fetchSpotlight()
      .then(({ hot, cold }) => { setHotGuy(hot); setColdGuy(cold) })
      .finally(() => setLoadingSpotlight(false))
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
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    // Only fire if clearly horizontal and past 40px threshold
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    setHomeTab(dx < 0 ? 'team' : 'league')
  }, [])

  // ── Derived team info ─────────────────────────────────────────────────────────
  const followedTeam = allTeams.find(t => t.id === followedTeamId)
  const bg       = TEAM_BG[followedTeamId ?? 0] ?? '#1a2035'
  const abbr     = followedTeam?.abbreviation ?? '—'
  const nickname = followedTeam?.teamName     ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w[w.length - 1] })()
  const city     = followedTeam?.locationName ?? (() => { const w = (followedTeam?.name ?? '').split(' '); return w.slice(0, -1).join(' ') })()

  const teamTabLabel = followedTeamId
    ? (followedTeam?.teamName ?? followedTeam?.name?.split(' ').pop() ?? 'My Team')
    : 'My Team'

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${standing.gamesBack} GB` : null,
  ].filter(Boolean).join(' · ') : null

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Box>

      {/* ── In-page tab switcher ─────────────────────────────────────────────── */}
      <HomeSubNav tab={homeTab} teamLabel={teamTabLabel} onChange={setHomeTab} />

      {/* ── Swipeable two-panel layout ───────────────────────────────────────── */}
      {/*
          The outer container clips overflow so only the active panel is visible.
          The inner container is 200% wide; each panel is 50% of that (= 100% of
          the viewport content width). Sliding the inner -50% reveals the right panel.
      */}
      <Box
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        sx={{ overflow: 'hidden' }}
      >
        <Box sx={{
          display: 'flex',
          width: '200%',
          transform: `translateX(${homeTab === 'league' ? '0%' : '-50%'})`,
          transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          alignItems: 'flex-start',
        }}>

          {/* ── Panel 1: Around the League ────────────────────────────────────── */}
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {loadingSpotlight && !hotGuy && !coldGuy && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
                    Loading spotlight…
                  </Typography>
                </Box>
              )}

              {(hotGuy || coldGuy) && (
                <Box sx={{ display: 'flex', gap: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
                  {hotGuy  && <SpotlightCard data={hotGuy}  mode="hot"  />}
                  {coldGuy && <SpotlightCard data={coldGuy} mode="cold" />}
                </Box>
              )}

              {!loadingSpotlight && !hotGuy && !coldGuy && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>
                    No spotlight data available
                  </Typography>
                </Box>
              )}

            </Box>
          </Box>

          {/* ── Panel 2: My Team ──────────────────────────────────────────────── */}
          <Box sx={{ width: '50%', flexShrink: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Team card — or picker if no team followed */}
              {followedTeamId ? (
                <Box sx={{
                  borderRadius: { xs: 0, sm: 3 },
                  mx: { xs: -2, sm: 0 },
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: `${bg}40`,
                  borderLeft: { sm: `4px solid ${bg}` },
                  bgcolor: 'background.paper',
                  background: `linear-gradient(135deg, ${bg}1a 0%, ${bg}0a 45%, transparent 70%)`,
                }}>
                  {/* Team header */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pt: 1.5, pb: 1.25 }}>
                    <TeamLogoCircle teamId={followedTeamId} abbr={abbr} size={44} />

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {city && (
                        <Typography sx={{
                          fontSize: '0.58rem', fontWeight: 700, letterSpacing: '2.5px',
                          textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1, mb: 0.25,
                        }}>
                          {city}
                        </Typography>
                      )}
                      <Typography sx={{
                        fontSize: { xs: '1.2rem', sm: '1.4rem' },
                        fontWeight: 900, textTransform: 'uppercase',
                        letterSpacing: '-0.5px', lineHeight: 1,
                        color: 'text.primary',
                      }}>
                        {nickname}
                      </Typography>
                      {standingLine && (
                        <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.3, lineHeight: 1 }}>
                          {standingLine}
                        </Typography>
                      )}
                    </Box>

                    <Box
                      onClick={onUnfollowTeam}
                      sx={{
                        alignSelf: 'flex-start',
                        fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled',
                        cursor: 'pointer', px: 1.1, py: 0.4,
                        borderRadius: 999, border: '1px solid', borderColor: 'divider',
                        whiteSpace: 'nowrap', flexShrink: 0,
                        transition: 'color 0.12s, border-color 0.12s',
                        '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
                      }}
                    >
                      Change
                    </Box>
                  </Box>

                  {/* Schedule strip */}
                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
                    <TeamScheduleStrip
                      teamId={followedTeamId}
                      teamColor={bg}
                      onPlayerClick={onPlayerClick}
                      onTeamClick={onTeamClick}
                    />
                  </Box>
                </Box>
              ) : (
                <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
              )}

              {/* ── My Predictions ──────────────────────────────────────────── */}
              <PredictorWidget
                onPlayerClick={onPlayerClick}
                onTeamClick={onTeamClick ?? (() => {})}
              />

              {/* ── My Players ──────────────────────────────────────────────── */}
              <FollowedPlayersSection
                followedPlayerIds={followedPlayerIds}
                onUnfollow={onUnfollowPlayer}
                onPlayerClick={onPlayerClick}
                onFollow={onFollowPlayer}
              />

            </Box>
          </Box>

        </Box>
      </Box>

    </Box>
  )
}
