import React, { useState, useEffect } from 'react'
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

// ─── Team picker (shown when no team is followed) ─────────────────────────────

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

// ─── Standing summary type ────────────────────────────────────────────────────

interface StandingSummary {
  wins:           number
  losses:         number
  divisionRank:   number
  divisionName:   string
  gamesBack:      string
  divisionLeader: boolean
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
  const [standing, setStanding]           = useState<StandingSummary | null>(null)
  const [hotGuy,   setHotGuy]             = useState<HotGuyData | null>(null)
  const [coldGuy,  setColdGuy]            = useState<HotGuyData | null>(null)
  const [loadingSpotlight, setLoadingSpotlight] = useState(false)

  useEffect(() => {
    setLoadingSpotlight(true)
    fetchSpotlight().then(({ hot, cold }) => { setHotGuy(hot); setColdGuy(cold) })
      .finally(() => setLoadingSpotlight(false))
  }, [])

  useEffect(() => {
    if (!followedTeamId) return
    setStanding(null)
    fetchDivisionForTeam(followedTeamId, CURRENT_SEASON).then(div => {
      const t = div?.teams.find(t => t.teamId === followedTeamId)
      if (t && div) setStanding({
        wins: t.wins, losses: t.losses,
        divisionRank: t.divisionRank, divisionName: div.divisionName,
        gamesBack: t.gamesBack, divisionLeader: t.divisionLeader,
      })
    }).catch(() => {})
  }, [followedTeamId])

  if (!followedTeamId) {
    return <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
  }

  const team     = allTeams.find(t => t.id === followedTeamId)
  const bg       = TEAM_BG[followedTeamId] ?? '#1a2035'
  const abbr     = team?.abbreviation ?? '—'
  // Prefer the API's dedicated location/team fields; fall back to naive word-split
  const nickname = team?.teamName     ?? (() => { const w = (team?.name ?? '').split(' '); return w[w.length - 1] })()
  const city     = team?.locationName ?? (() => { const w = (team?.name ?? '').split(' '); return w.slice(0, -1).join(' ') })()

  const standingLine = standing ? [
    `${standing.wins}–${standing.losses}`,
    `${ordinal(standing.divisionRank)} ${standing.divisionName}`,
    !standing.divisionLeader && standing.gamesBack !== '-' ? `${standing.gamesBack} GB` : null,
  ].filter(Boolean).join(' · ') : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Team card ─────────────────────────────────────────────────────────── */}
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

        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
          <TeamScheduleStrip teamId={followedTeamId} teamColor={bg} onPlayerClick={onPlayerClick} onTeamClick={onTeamClick} />
        </Box>
      </Box>

      {/* ── On Fire / Ice Cold ───────────────────────────────────────────────── */}
      {loadingSpotlight && !hotGuy && !coldGuy && (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading spotlight…</Typography>
        </Box>
      )}
      {(hotGuy || coldGuy) && (
        <Box sx={{ display: 'flex', gap: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
          {hotGuy  && <SpotlightCard data={hotGuy}  mode="hot"  />}
          {coldGuy && <SpotlightCard data={coldGuy} mode="cold" />}
        </Box>
      )}

      {/* ── Today's Picks predictor ─────────────────────────────────────────── */}
      <PredictorWidget
        onPlayerClick={onPlayerClick}
        onTeamClick={onTeamClick ?? (() => {})}
      />

      {/* ── Followed players ──────────────────────────────────────────────────── */}
      <FollowedPlayersSection
        followedPlayerIds={followedPlayerIds}
        onUnfollow={onUnfollowPlayer}
        onPlayerClick={onPlayerClick}
        onFollow={onFollowPlayer}
      />

    </Box>
  )
}
