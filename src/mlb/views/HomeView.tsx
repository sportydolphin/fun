import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { Team } from '../types'
import { TEAM_BG, TEAM_SECONDARY } from '../constants'

// ─── Team logo (SVG from MLB CDN, falls back to abbr text) ────────────────────

function TeamLogo({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  if (failed) {
    return (
      <Box sx={{
        width: size, height: size, borderRadius: '50%', bgcolor: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: size * 0.28, lineHeight: 1 }}>
          {abbr}
        </Typography>
      </Box>
    )
  }
  return (
    <Box
      component="img"
      src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`}
      alt={abbr}
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.45))' }}
    />
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
          const bg        = TEAM_BG[t.id] ?? '#333'
          const secondary = TEAM_SECONDARY[t.id] ?? '#ffffff'
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
                '&:hover': {
                  borderColor: bg,
                  bgcolor: `${bg}20`,
                  transform: 'scale(1.04)',
                },
              }}
            >
              {/* Colored circle with logo */}
              <Box sx={{
                width: 44, height: 44, borderRadius: '50%', bgcolor: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`}
                  alt={t.abbreviation}
                  sx={{ width: 34, height: 34, objectFit: 'contain' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    const img = e.currentTarget
                    img.style.display = 'none'
                  }}
                />
              </Box>
              <Typography sx={{
                fontSize: '0.62rem', fontWeight: 800,
                color: 'text.primary', textAlign: 'center', lineHeight: 1.2,
              }}>
                {t.abbreviation}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── Schedule types & fetch ───────────────────────────────────────────────────

interface ScheduleGame {
  gamePk:        number
  date:          string
  gameTime:      string
  isHome:        boolean
  opponentId:    number
  opponentAbbr:  string
  state:         'final' | 'live' | 'preview'
  teamScore:     number | null
  opponentScore: number | null
  isWin:         boolean | null
}

async function fetchTeamSchedule(teamId: number): Promise<ScheduleGame[]> {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 14)
  const end = new Date(today)
  end.setDate(end.getDate() + 21)
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1` +
    `&startDate=${toISO(start)}&endDate=${toISO(end)}&gameType=R` +
    `&fields=dates,date,games,gamePk,gameDate,status,abstractGameState,teams,home,away,team,id,abbreviation,score,isWinner`
  )
  const d = await r.json()

  const games: ScheduleGame[] = []
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const homeId = Number(game.teams?.home?.team?.id)
      const isHome = homeId === teamId
      const opp    = isHome ? game.teams.away : game.teams.home
      const mine   = isHome ? game.teams.home : game.teams.away

      const raw   = game.status?.abstractGameState ?? 'Preview'
      const state = raw === 'Final' ? 'final' : raw === 'Live' ? 'live' : 'preview'

      let gameTime = ''
      if (game.gameDate) {
        gameTime = new Date(game.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      }

      games.push({
        gamePk:        game.gamePk,
        date:          dateObj.date,
        gameTime,
        isHome,
        opponentId:    Number(opp?.team?.id ?? 0),
        opponentAbbr:  opp?.team?.abbreviation ?? '???',
        state:         state as ScheduleGame['state'],
        teamScore:     state !== 'preview' ? Number(mine?.score ?? 0) : null,
        opponentScore: state !== 'preview' ? Number(opp?.score  ?? 0) : null,
        isWin:         state === 'final' ? Boolean(mine?.isWinner) : null,
      })
    }
  }

  return games.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Game chip ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function chipDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${day}`
}

function GameChip({ game, teamColor, secondary, highlight, innerRef }: {
  game:      ScheduleGame
  teamColor: string
  secondary: string
  highlight: boolean
  innerRef?: React.RefObject<HTMLDivElement>
}) {
  const isFinal = game.state === 'final'
  const isLive  = game.state === 'live'
  const isWin   = game.isWin === true

  return (
    <Box
      ref={innerRef}
      sx={{
        flexShrink: 0,
        width: 72,
        borderRadius: 2,
        border: `1.5px solid ${highlight ? secondary : `${secondary}28`}`,
        bgcolor: highlight ? `${secondary}14` : `rgba(0,0,0,0.20)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        py: 1.25, px: 0.75,
        gap: 0.5,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* TODAY / LIVE banner at top */}
      {highlight && (
        <Box sx={{
          position: 'absolute', top: 0, left: 0, right: 0,
          bgcolor: isLive ? '#ef4444' : secondary,
          py: '2.5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{
            fontSize: '0.46rem', fontWeight: 900, letterSpacing: 1.5,
            color: isLive ? '#fff' : teamColor,
            textTransform: 'uppercase', lineHeight: 1,
          }}>
            {isLive ? '● LIVE' : 'TODAY'}
          </Typography>
        </Box>
      )}

      {/* Date */}
      <Typography sx={{
        fontSize: '0.58rem', fontWeight: 700,
        color: `${secondary}80`, lineHeight: 1,
        mt: highlight ? 1.4 : 0,
        letterSpacing: 0.3,
      }}>
        {chipDate(game.date)}
      </Typography>

      {/* @ / VS */}
      <Typography sx={{
        fontSize: '0.48rem', fontWeight: 800,
        color: `${secondary}50`, lineHeight: 1, letterSpacing: 1,
      }}>
        {game.isHome ? 'VS' : '@'}
      </Typography>

      {/* Opponent logo */}
      <Box sx={{
        width: 30, height: 30, borderRadius: '50%',
        bgcolor: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${game.opponentId}.svg`}
          alt={game.opponentAbbr}
          sx={{ width: 22, height: 22, objectFit: 'contain' }}
        />
      </Box>

      {/* Opponent abbr */}
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800,
        color: secondary, lineHeight: 1,
      }}>
        {game.opponentAbbr}
      </Typography>

      {/* Score + W/L for final; score for live; time for preview */}
      {isFinal ? (
        <>
          <Typography sx={{
            fontSize: '0.72rem', fontWeight: 700,
            color: secondary, lineHeight: 1,
          }}>
            {game.teamScore}–{game.opponentScore}
          </Typography>
          <Box sx={{
            px: 0.8, py: '2px', borderRadius: 1,
            bgcolor: isWin ? '#22c55e22' : '#ef444422',
          }}>
            <Typography sx={{
              fontSize: '0.6rem', fontWeight: 900, lineHeight: 1,
              color: isWin ? '#22c55e' : '#ef4444',
            }}>
              {isWin ? 'W' : 'L'}
            </Typography>
          </Box>
        </>
      ) : isLive ? (
        <Typography sx={{
          fontSize: '0.72rem', fontWeight: 800,
          color: '#ef4444', lineHeight: 1,
        }}>
          {game.teamScore}–{game.opponentScore}
        </Typography>
      ) : (
        <Typography sx={{
          fontSize: '0.56rem', fontWeight: 600,
          color: `${secondary}65`, lineHeight: 1,
          textAlign: 'center',
        }}>
          {game.gameTime}
        </Typography>
      )}
    </Box>
  )
}

// ─── Schedule strip ───────────────────────────────────────────────────────────

function TeamScheduleStrip({ teamId, teamColor, secondary }: {
  teamId:    number
  teamColor: string
  secondary: string
}) {
  const [games, setGames]   = useState<ScheduleGame[]>([])
  const [loading, setLoading] = useState(true)
  const todayChipRef  = useRef<HTMLDivElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    setLoading(true)
    fetchTeamSchedule(teamId)
      .then(setGames)
      .finally(() => setLoading(false))
  }, [teamId])

  // Center the today/next chip after render
  useEffect(() => {
    const container = containerRef.current
    const chip      = todayChipRef.current
    if (!container || !chip) return
    const offset = chip.offsetLeft - container.clientWidth / 2 + chip.offsetWidth / 2
    container.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' })
  }, [games])

  if (loading) return (
    <Box sx={{ mt: 4, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.7rem', color: `${secondary}45`, fontWeight: 600 }}>
        Loading schedule…
      </Typography>
    </Box>
  )
  if (!games.length) return null

  // Highlight the next upcoming (or today's) game
  const nextGame = games.find(g => g.date >= today) ?? games[games.length - 1]

  return (
    <Box sx={{ mt: 4, width: '100%', position: 'relative' }}>
      {/* Section label */}
      <Typography sx={{
        fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 2.5, color: secondary, opacity: 0.45,
        mb: 1.5, textAlign: 'center',
      }}>
        Schedule
      </Typography>

      {/* Fade-out edges */}
      <Box sx={{ position: 'relative' }}>
        <Box sx={{
          position: 'absolute', left: 0, top: 0, bottom: 12, width: 32, zIndex: 2,
          background: `linear-gradient(to right, ${teamColor} 40%, transparent)`,
          pointerEvents: 'none',
        }} />
        <Box sx={{
          position: 'absolute', right: 0, top: 0, bottom: 12, width: 32, zIndex: 2,
          background: `linear-gradient(to left, ${teamColor} 40%, transparent)`,
          pointerEvents: 'none',
        }} />

        {/* Scrollable chip row */}
        <Box
          ref={containerRef}
          sx={{
            display: 'flex', flexDirection: 'row', gap: 1,
            overflowX: 'auto',
            px: 3, pb: 1,
            '&::-webkit-scrollbar': { height: 3 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': { bgcolor: `${secondary}25`, borderRadius: 2 },
            scrollbarWidth: 'thin',
            scrollbarColor: `${secondary}25 transparent`,
          }}
        >
          {games.map(g => {
            const isHighlight = g.gamePk === nextGame.gamePk
            return (
              <GameChip
                key={g.gamePk}
                game={g}
                teamColor={teamColor}
                secondary={secondary}
                highlight={isHighlight}
                innerRef={isHighlight ? todayChipRef : undefined}
              />
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Home screen (shown once a team is followed) ──────────────────────────────

export interface HomeViewProps {
  allTeams: Team[]
  followedTeamId: number | null
  onFollowTeam:   (teamId: number) => void
  onUnfollowTeam: () => void
}

export function HomeView({ allTeams, followedTeamId, onFollowTeam, onUnfollowTeam }: HomeViewProps) {
  // ── No team followed → show picker ──────────────────────────────────────────
  if (!followedTeamId) {
    return <TeamPicker allTeams={allTeams} onSelect={onFollowTeam} />
  }

  const team      = allTeams.find(t => t.id === followedTeamId)
  const bg        = TEAM_BG[followedTeamId]        ?? '#1a2035'
  const secondary = TEAM_SECONDARY[followedTeamId] ?? '#ffffff'
  const abbr      = team?.abbreviation ?? '—'
  const name      = team?.name         ?? '—'

  const words    = name.split(' ')
  const nickname = words[words.length - 1]
  const city     = words.slice(0, -1).join(' ')

  return (
    <Box sx={{
      minHeight: 'calc(100vh - 130px)',
      borderRadius: { xs: 0, sm: 3 },
      bgcolor: bg,
      mx: { xs: -2, sm: 0 },
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      position: 'relative', overflow: 'hidden',
      px: 3, pt: 8, pb: 5,
    }}>

      {/* Subtle radial glow */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 70% 55% at 50% 38%, ${secondary}22 0%, transparent 70%)`,
      }} />

      {/* ★ YOUR TEAM label */}
      <Typography sx={{
        fontSize: '0.68rem', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '3px',
        color: secondary, opacity: 0.65, mb: 2.5,
        position: 'relative',
      }}>
        ★&ensp;Your Team
      </Typography>

      {/* Big logo */}
      <Box sx={{ mb: 4, position: 'relative' }}>
        <TeamLogo teamId={followedTeamId} abbr={abbr} size={130} />
      </Box>

      {/* City name */}
      {city && (
        <Typography sx={{
          fontSize: { xs: '1rem', sm: '1.2rem' },
          fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '4px',
          color: secondary, opacity: 0.75,
          lineHeight: 1, mb: 0.5,
          position: 'relative',
        }}>
          {city}
        </Typography>
      )}

      {/* Nickname */}
      <Typography sx={{
        fontSize: { xs: '2.8rem', sm: '4rem' },
        fontWeight: 900, textTransform: 'uppercase',
        letterSpacing: '-2px', lineHeight: 1,
        color: secondary,
        textShadow: `0 4px 24px rgba(0,0,0,0.35)`,
        mb: 4,
        position: 'relative',
      }}>
        {nickname}
      </Typography>

      {/* Change team button */}
      <Box
        onClick={onUnfollowTeam}
        sx={{
          position: 'relative',
          px: 3, py: '8px',
          borderRadius: 999,
          border: `1.5px solid ${secondary}45`,
          color: secondary, opacity: 0.55,
          fontSize: '0.76rem', fontWeight: 700,
          cursor: 'pointer', userSelect: 'none',
          transition: 'opacity 0.15s, border-color 0.15s',
          '&:hover': { opacity: 1, borderColor: secondary },
        }}
      >
        Change Team
      </Box>

      {/* Schedule strip */}
      <TeamScheduleStrip
        teamId={followedTeamId}
        teamColor={bg}
        secondary={secondary}
      />

    </Box>
  )
}
