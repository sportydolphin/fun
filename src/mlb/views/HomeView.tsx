import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Typography, InputBase, useTheme } from '@mui/material'
import { Team, Player } from '../types'
import { TEAM_BG, ACCENT, HEADSHOT, CURRENT_SEASON, TEAM_ABBR } from '../constants'
import { searchPlayers, fetchDivisionForTeam } from '../api'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function chipDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${day}`
}

// ─── Team logo ─────────────────────────────────────────────────────────────────

function TeamLogoCircle({ teamId, abbr, size }: { teamId: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  const bg = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {failed ? (
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: size * 0.28, lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: '76%', height: '76%', objectFit: 'contain' }}
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
  const start = new Date(today); start.setDate(start.getDate() - 14)
  const end   = new Date(today); end.setDate(end.getDate() + 21)
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1` +
    `&startDate=${toISO(start)}&endDate=${toISO(end)}&gameType=R` +
    `&fields=dates,date,games,gamePk,gameDate,status,abstractGameState,teams,home,away,team,id,score,isWinner`
  )
  const d = await r.json()

  const games: ScheduleGame[] = []
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const isHome = Number(game.teams?.home?.team?.id) === teamId
      const opp    = isHome ? game.teams.away : game.teams.home
      const mine   = isHome ? game.teams.home : game.teams.away
      const raw    = game.status?.abstractGameState ?? 'Preview'
      const state  = raw === 'Final' ? 'final' : raw === 'Live' ? 'live' : 'preview'
      games.push({
        gamePk:        game.gamePk,
        date:          dateObj.date,
        gameTime:      game.gameDate ? new Date(game.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
        isHome,
        opponentId:    Number(opp?.team?.id ?? 0),
        opponentAbbr:  TEAM_ABBR[Number(opp?.team?.id ?? 0)] ?? '???',
        state:         state as ScheduleGame['state'],
        teamScore:     state !== 'preview' ? Number(mine?.score ?? 0) : null,
        opponentScore: state !== 'preview' ? Number(opp?.score  ?? 0) : null,
        isWin:         state === 'final' ? Boolean(mine?.isWinner) : null,
      })
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Game preview data & fetch ───────────────────────────────────────────────

interface ProbablePitcher {
  id:     number
  name:   string
  era:    string
  wins:   number
  losses: number
  hand:   string   // 'R' | 'L'
  ip:     string   // season IP
}

interface GamePreviewData {
  venue:       string
  weatherDesc: string
  home: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
  away: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
}

async function fetchGamePreview(gamePk: number): Promise<GamePreviewData | null> {
  try {
    // Step 1 — get game info + probable pitcher IDs (no stats hydration here; unreliable)
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?gamePk=${gamePk}` +
      `&hydrate=probablePitcher,venue,weather`
    )
    const d = await r.json()
    const game = d.dates?.[0]?.games?.[0]
    if (!game) return null

    const ht = game.teams?.home
    const at = game.teams?.away

    const homePitcherId = ht?.probablePitcher?.id ? Number(ht.probablePitcher.id) : null
    const awayPitcherId = at?.probablePitcher?.id ? Number(at.probablePitcher.id) : null
    const pitcherIds = [homePitcherId, awayPitcherId].filter((x): x is number => x !== null)

    // Step 2 — fetch hand + season stats from people endpoint (always reliable)
    type PitcherDetails = { hand: string; era: string; ip: string; wins: number; losses: number }
    const pitcherMap: Record<number, PitcherDetails> = {}
    if (pitcherIds.length > 0) {
      try {
        const season = new Date().getFullYear()
        const pr = await fetch(
          `https://statsapi.mlb.com/api/v1/people?personIds=${pitcherIds.join(',')}` +
          `&hydrate=stats(group=pitching,type=season,season=${season})`
        )
        const pd = await pr.json()
        for (const p of pd.people ?? []) {
          const grp  = (p.stats ?? []).find((s: any) => s.group?.displayName === 'pitching')
          const stat = grp?.splits?.[0]?.stat ?? {}
          pitcherMap[Number(p.id)] = {
            hand:   p.pitchHand?.code        ?? '?',
            era:    stat.era                 ?? '—',
            ip:     stat.inningsPitched      ?? '—',
            wins:   Number(stat.wins   ?? 0),
            losses: Number(stat.losses ?? 0),
          }
        }
      } catch { /* non-fatal */ }
    }

    const parsePitcher = (side: any): ProbablePitcher | null => {
      const p = side?.probablePitcher
      if (!p) return null
      const det = pitcherMap[Number(p.id)] ?? {}
      return {
        id:     Number(p.id),
        name:   p.fullName        ?? '—',
        era:    det.era           ?? '—',
        ip:     det.ip            ?? '—',
        wins:   det.wins          ?? 0,
        losses: det.losses        ?? 0,
        hand:   det.hand          ?? '?',
      }
    }

    const w = game.weather
    const weatherDesc = w
      ? [w.condition, w.temp ? `${w.temp}°F` : null, w.wind || null].filter(Boolean).join(' · ')
      : ''

    return {
      venue:       game.venue?.name ?? '',
      weatherDesc,
      home: { teamId: Number(ht?.team?.id ?? 0), abbr: TEAM_ABBR[Number(ht?.team?.id ?? 0)] ?? '?', pitcher: parsePitcher(ht) },
      away: { teamId: Number(at?.team?.id ?? 0), abbr: TEAM_ABBR[Number(at?.team?.id ?? 0)] ?? '?', pitcher: parsePitcher(at) },
    }
  } catch { return null }
}

// ─── Game chip ────────────────────────────────────────────────────────────────

function GameChip({ game, teamColor, highlight, isActualToday, innerRef, onClick }: {
  game:          ScheduleGame
  teamColor:     string
  highlight:     boolean
  isActualToday: boolean
  innerRef?:     React.RefObject<HTMLDivElement>
  onClick?:      () => void
}) {
  const isFinal = game.state === 'final'
  const isLive  = game.state === 'live'
  const isWin   = game.isWin === true

  return (
    <Box
      ref={innerRef}
      onClick={onClick}
      sx={{
        flexShrink: 0, width: 70,
        borderRadius: 2,
        border: `1.5px solid`,
        borderColor: highlight ? `${teamColor}90` : `${teamColor}22`,
        bgcolor: highlight ? `${teamColor}14` : `${teamColor}06`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        py: 1.25, px: 0.75, gap: 0.5,
        position: 'relative', overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.12s, background-color 0.12s',
        '&:hover': onClick ? {
          borderColor: `${teamColor}70`,
          bgcolor: highlight ? `${teamColor}22` : `${teamColor}12`,
        } : {},
      }}
    >
      {/* TODAY / NEXT / LIVE banner */}
      {highlight && (
        <Box sx={{
          position: 'absolute', top: 0, left: 0, right: 0,
          bgcolor: isLive ? '#ef4444' : isActualToday ? teamColor : `${teamColor}90`,
          py: '2.5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{
            fontSize: '0.44rem', fontWeight: 900, letterSpacing: 1.5,
            color: '#fff', textTransform: 'uppercase', lineHeight: 1,
          }}>
            {isLive ? '● LIVE' : isActualToday ? 'TODAY' : 'NEXT'}
          </Typography>
        </Box>
      )}

      {/* Date */}
      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 600,
        color: 'text.disabled', lineHeight: 1,
        mt: highlight ? 1.4 : 0, letterSpacing: 0.3,
      }}>
        {chipDate(game.date)}
      </Typography>

      {/* @ / VS */}
      <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: 'text.disabled', lineHeight: 1, letterSpacing: 0.8 }}>
        {game.isHome ? 'VS' : '@'}
      </Typography>

      {/* Opponent logo */}
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', bgcolor: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${game.opponentId}.svg`}
          alt={game.opponentAbbr}
          sx={{ width: 20, height: 20, objectFit: 'contain' }}
        />
      </Box>

      {/* Opponent abbr */}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.primary', lineHeight: 1 }}>
        {game.opponentAbbr}
      </Typography>

      {/* Score / time / W-L */}
      {isFinal ? (
        <>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.primary', lineHeight: 1 }}>
            {game.teamScore}–{game.opponentScore}
          </Typography>
          <Box sx={{ px: 0.75, py: '2px', borderRadius: 0.75, bgcolor: isWin ? '#22c55e22' : '#ef444422' }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 900, lineHeight: 1, color: isWin ? '#22c55e' : '#ef4444' }}>
              {isWin ? 'W' : 'L'}
            </Typography>
          </Box>
        </>
      ) : isLive ? (
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>
          {game.teamScore}–{game.opponentScore}
        </Typography>
      ) : (
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1, textAlign: 'center' }}>
          {game.gameTime}
        </Typography>
      )}
    </Box>
  )
}

// ─── Game preview modal ───────────────────────────────────────────────────────

function PitcherPanel({ pitcher, teamId, side, onPlayerClick, onTeamClick }: {
  pitcher:       ProbablePitcher | null
  teamId:        number
  side:          'Away' | 'Home'
  onPlayerClick?: () => void
  onTeamClick?:   () => void
}) {
  const col = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      {/* Side label */}
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.disabled', lineHeight: 1 }}>
        {side}
      </Typography>

      {/* Team logo — clickable, white circle + team-color border */}
      <Box
        onClick={onTeamClick}
        sx={{
          width: 38, height: 38, borderRadius: '50%',
          bgcolor: '#fff', border: `2.5px solid ${col}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
          boxShadow: `0 0 0 1px ${col}40`,
          cursor: onTeamClick ? 'pointer' : 'default',
          transition: 'transform 0.12s, box-shadow 0.12s',
          '&:hover': onTeamClick ? { transform: 'scale(1.1)', boxShadow: `0 0 0 2px ${col}80` } : {},
        }}
      >
        <Box component="img"
          src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
          sx={{ width: 26, height: 26, objectFit: 'contain' }}
        />
      </Box>

      {/* Pitcher content — clickable if pitcher known */}
      {pitcher ? (
        <>
          {/* Headshot + name = clickable player link */}
          <Box
            onClick={onPlayerClick}
            sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6,
              cursor: onPlayerClick ? 'pointer' : 'default',
              '&:hover .pitcher-name': onPlayerClick ? { color: ACCENT } : {},
              transition: 'opacity 0.12s',
              '&:hover': onPlayerClick ? { opacity: 0.85 } : {},
            }}
          >
            <Box sx={{ width: 84, height: 100, borderRadius: 2.5, overflow: 'hidden', border: `2px solid ${col}50`, bgcolor: 'action.hover', flexShrink: 0 }}>
              <Box component="img" src={HEADSHOT(pitcher.id)} alt={pitcher.name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }} />
            </Box>
            <Typography className="pitcher-name" sx={{
              fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.25, textAlign: 'center', px: 0.5,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              transition: 'color 0.12s',
            }}>
              {pitcher.name}
            </Typography>
          </Box>

          {/* Handedness — not clickable */}
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', textAlign: 'center', lineHeight: 1, fontWeight: 600 }}>
            {pitcher.hand === 'R' ? 'RHP' : pitcher.hand === 'L' ? 'LHP' : `${pitcher.hand}HP`}
          </Typography>

          {/* Stats: ERA + IP */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 0.25 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, lineHeight: 1, color: 'text.primary' }}>{pitcher.era}</Typography>
              <Typography sx={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1, mt: 0.3 }}>ERA</Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, lineHeight: 1, color: 'text.primary' }}>{pitcher.ip}</Typography>
              <Typography sx={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1, mt: 0.3 }}>IP</Typography>
            </Box>
          </Box>
        </>
      ) : (
        <>
          <Box sx={{ width: 84, height: 100, borderRadius: 2.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 600 }}>TBD</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', fontWeight: 600 }}>Starter TBD</Typography>
        </>
      )}
    </Box>
  )
}

function GamePreviewModal({ game, myTeamId, previewData, loading, onClose, onPlayerClick, onTeamClick }: {
  game:          ScheduleGame
  myTeamId:      number
  previewData:   GamePreviewData | null
  loading:       boolean
  onClose:       () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Wrap callbacks to close modal before navigating
  const handlePlayerClick = useCallback((id: number) => { onClose(); onPlayerClick?.(id) }, [onClose, onPlayerClick])
  const handleTeamClick   = useCallback((id: number) => { onClose(); onTeamClick?.(id)   }, [onClose, onTeamClick])

  const myAbbr  = TEAM_ABBR[myTeamId] ?? '?'
  const oppAbbr = game.opponentAbbr

  // Away @ Home header
  const awayAbbr = game.isHome ? oppAbbr : myAbbr
  const homeAbbr = game.isHome ? myAbbr  : oppAbbr

  // Map API home/away to the visual slots
  const awayTeamId  = previewData?.away.teamId ?? (game.isHome ? game.opponentId : myTeamId)
  const homeTeamId  = previewData?.home.teamId ?? (game.isHome ? myTeamId        : game.opponentId)
  const awayPitcher = previewData?.away.pitcher ?? null
  const homePitcher = previewData?.home.pitcher ?? null

  return (
    // Backdrop — click directly on it to close
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1400,
        bgcolor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: 2,
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 460,
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', lineHeight: 1.2 }}>
              {awayAbbr}
              <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, mx: 1 }}>@</Box>
              {homeAbbr}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.4, lineHeight: 1.3 }}>
              {chipDate(game.date)} · {game.gameTime}
              {previewData?.venue ? ` · ${previewData.venue}` : ''}
            </Typography>
          </Box>
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 30, height: 30, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            <Typography sx={{ fontSize: '0.85rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Body */}
        <Box sx={{ px: 3, py: 2.75 }}>
          {loading ? (
            <Box sx={{ py: 5, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Loading game details…</Typography>
            </Box>
          ) : (
            <>
              <Typography sx={{
                fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'text.disabled', mb: 2.5, textAlign: 'center',
              }}>
                Probable Starters
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <PitcherPanel
                  pitcher={awayPitcher} teamId={awayTeamId} side="Away"
                  onPlayerClick={awayPitcher ? () => handlePlayerClick(awayPitcher.id) : undefined}
                  onTeamClick={() => handleTeamClick(awayTeamId)}
                />

                {/* @ divider — vertically centred with the headshots */}
                <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pt: '66px' }}>
                  <Typography sx={{ fontWeight: 900, fontSize: '0.9rem', color: 'text.disabled', lineHeight: 1 }}>@</Typography>
                </Box>

                <PitcherPanel
                  pitcher={homePitcher} teamId={homeTeamId} side="Home"
                  onPlayerClick={homePitcher ? () => handlePlayerClick(homePitcher.id) : undefined}
                  onTeamClick={() => handleTeamClick(homeTeamId)}
                />
              </Box>

              {/* Weather */}
              {previewData?.weatherDesc && (
                <Box sx={{ mt: 3, pt: 1.75, borderTop: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary' }}>
                    {previewData.weatherDesc}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Schedule strip ───────────────────────────────────────────────────────────

function TeamScheduleStrip({ teamId, teamColor, onPlayerClick, onTeamClick }: {
  teamId:         number
  teamColor:      string
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const theme     = useTheme()
  const paperBg   = theme.palette.background.paper
  const [games, setGames]     = useState<ScheduleGame[]>([])
  const [loading, setLoading] = useState(true)
  const chipRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Preview modal state
  const [selectedGame,   setSelectedGame]   = useState<ScheduleGame | null>(null)
  const [previewData,    setPreviewData]     = useState<GamePreviewData | null>(null)
  const [loadingPreview, setLoadingPreview]  = useState(false)

  // Use local date so we never bleed into the next calendar day via UTC offset
  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    setLoading(true)
    fetchTeamSchedule(teamId).then(setGames).finally(() => setLoading(false))
  }, [teamId])

  useEffect(() => {
    const c = containerRef.current, el = chipRef.current
    if (!c || !el) return
    c.scrollTo({ left: Math.max(0, el.offsetLeft - c.clientWidth / 2 + el.offsetWidth / 2), behavior: 'smooth' })
  }, [games])

  const handleChipClick = useCallback((g: ScheduleGame) => {
    setSelectedGame(g)
    setPreviewData(null)
    setLoadingPreview(true)
    fetchGamePreview(g.gamePk)
      .then(setPreviewData)
      .finally(() => setLoadingPreview(false))
  }, [])

  const handleClosePreview = useCallback(() => {
    setSelectedGame(null)
    setPreviewData(null)
  }, [])

  if (loading) return (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>Loading schedule…</Typography>
    </Box>
  )
  if (!games.length) return null

  const nextGame = games.find(g => g.date >= today) ?? games[games.length - 1]

  return (
    <>
      <Box sx={{ position: 'relative' }}>
        {/* Edge fades */}
        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 8, width: 28, zIndex: 2,
          background: `linear-gradient(to right, ${paperBg}, transparent)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 8, width: 28, zIndex: 2,
          background: `linear-gradient(to left, ${paperBg}, transparent)`, pointerEvents: 'none' }} />

        <Box
          ref={containerRef}
          sx={{
            display: 'flex', gap: 1, overflowX: 'auto', px: 3, pb: 1,
            '&::-webkit-scrollbar': { height: 3 },
            '&::-webkit-scrollbar-thumb': { bgcolor: `${teamColor}30`, borderRadius: 2 },
            scrollbarWidth: 'thin', scrollbarColor: `${teamColor}30 transparent`,
          }}
        >
          {games.map(g => {
            const isHL = g.gamePk === nextGame.gamePk
            return (
              <GameChip
                key={g.gamePk}
                game={g}
                teamColor={teamColor}
                highlight={isHL}
                isActualToday={isHL && nextGame.date === today}
                innerRef={isHL ? chipRef : undefined}
                onClick={g.state === 'preview' ? () => handleChipClick(g) : undefined}
              />
            )
          })}
        </Box>
      </Box>

      {/* Game preview modal */}
      {selectedGame && (
        <GamePreviewModal
          game={selectedGame}
          myTeamId={teamId}
          previewData={previewData}
          loading={loadingPreview}
          onClose={handleClosePreview}
          onPlayerClick={onPlayerClick}
          onTeamClick={onTeamClick}
        />
      )}
    </>
  )
}

// ─── Spotlight: On Fire / Ice Cold ───────────────────────────────────────────
//
// HOT (HITTERS, min 15 PA / 14 days)
//   AVG: ≥.400=50  ≥.370=35  ≥.340=22  ≥.310=12  ≥.280=4
//   OPS: ≥1.200=55 ≥1.000=35 ≥.950=25  ≥.900=16  ≥.850=8
//   HR×20  RBI×3  SB×10  XBH×4  BB×3
//
// HOT (PITCHERS, min 3 IP / 14 days)
//   ERA: 0ER=80  ≤1.00=60  ≤2.00=40  ≤3.00=20  ≤3.75=8
//   WHIP: ≤0.60=40  ≤0.80=28  ≤1.00=16  ≤1.15=7
//   K×3  W×20  SV×25  HLD×12  IP volume bonus
//
// COLD (HITTERS, min 15 PA / 14 days)
//   AVG: ≤.080=50  ≤.110=35  ≤.140=22  ≤.170=12  ≤.200=5
//   OPS: ≤.350=55  ≤.450=35  ≤.520=22  ≤.580=14  ≤.650=7
//   K×4  no XBH=+8  no HR=+6  no RBI=+5
//
// COLD (PITCHERS, min 3 IP / 14 days)
//   ERA: ≥12=80  ≥9=60  ≥7=40  ≥6=20  ≥5=8
//   WHIP: ≥3.00=40  ≥2.50=28  ≥2.00=16  ≥1.75=7
//   ER×8  BB×4

interface HotGuyStats {
  // Hitter
  avg?:     string
  ops?:     string
  hr?:      number
  rbi?:     number
  sb?:      number
  hits?:    number
  ab?:      number
  doubles?: number
  bb?:      number
  pa?:      number
  // Pitcher / cold hitter
  era?:     string
  whip?:    string
  k?:       number
  ip?:      string
  wins?:    number
  losses?:  number
  saves?:   number
  holds?:   number
  gs?:      number
  er?:      number
}

interface HotGuyData {
  playerId:   number
  playerName: string
  position:   string
  teamId:     number
  teamName:   string
  isPitcher:  boolean
  isStarter:  boolean
  period:     string
  stats:      HotGuyStats
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function parseIP(ip: string | number | undefined): number {
  const s = String(ip ?? '0')
  const [w = '0', f = '0'] = s.split('.')
  return Number(w) + Number(f) / 3
}

function scoreHitter(stat: any): number {
  const pa = Number(stat.plateAppearances ?? 0)
  if (pa < 15) return -1
  let score = 0
  const avg = parseFloat(stat.avg ?? '0')
  const ops = parseFloat(stat.ops ?? '0')
  const hr  = Number(stat.homeRuns ?? 0)
  const sb  = Number(stat.stolenBases ?? 0)
  const xbh = Number(stat.doubles ?? 0) + Number(stat.triples ?? 0) + hr
  if      (avg >= .400) score += 50
  else if (avg >= .370) score += 35
  else if (avg >= .340) score += 22
  else if (avg >= .310) score += 12
  else if (avg >= .280) score += 4
  if      (ops >= 1.200) score += 55
  else if (ops >= 1.000) score += 35
  else if (ops >= .950)  score += 25
  else if (ops >= .900)  score += 16
  else if (ops >= .850)  score += 8
  score += hr * 20 + Number(stat.rbi ?? 0) * 3 + sb * 10 + (xbh - hr) * 4 + Number(stat.baseOnBalls ?? 0) * 3
  return score
}

function scorePitcher(stat: any): number {
  const ip = parseIP(stat.inningsPitched)
  if (ip < 3) return -1
  let score = 0
  const era  = parseFloat(stat.era  ?? '99')
  const whip = parseFloat(stat.whip ?? '99')
  const er   = Number(stat.earnedRuns ?? 0)
  if      (er === 0)    score += 80
  else if (era <= 1.00) score += 60
  else if (era <= 2.00) score += 40
  else if (era <= 3.00) score += 20
  else if (era <= 3.75) score += 8
  if      (whip <= 0.60) score += 40
  else if (whip <= 0.80) score += 28
  else if (whip <= 1.00) score += 16
  else if (whip <= 1.15) score += 7
  score += Number(stat.strikeOuts ?? 0) * 3
  score += Number(stat.wins ?? 0) * 20 + Number(stat.saves ?? 0) * 25 + Number(stat.holds ?? 0) * 12
  if      (ip >= 18) score += 25
  else if (ip >= 14) score += 15
  else if (ip >= 10) score += 8
  return score
}

function scoreColdHitter(stat: any): number {
  const pa = Number(stat.plateAppearances ?? 0)
  if (pa < 15) return -1
  let score = 0
  const avg = parseFloat(stat.avg ?? '1')
  const ops = parseFloat(stat.ops ?? '1')
  const hr  = Number(stat.homeRuns ?? 0)
  const rbi = Number(stat.rbi ?? 0)
  const xbh = Number(stat.doubles ?? 0) + Number(stat.triples ?? 0) + hr
  if      (avg <= .080) score += 50
  else if (avg <= .110) score += 35
  else if (avg <= .140) score += 22
  else if (avg <= .170) score += 12
  else if (avg <= .200) score += 5
  if      (ops <= .350) score += 55
  else if (ops <= .450) score += 35
  else if (ops <= .520) score += 22
  else if (ops <= .580) score += 14
  else if (ops <= .650) score += 7
  score += Number(stat.strikeOuts ?? 0) * 4
  if (xbh === 0) score += 8
  if (hr  === 0) score += 6
  if (rbi === 0) score += 5
  return score
}

function scoreColdPitcher(stat: any): number {
  const ip = parseIP(stat.inningsPitched)
  if (ip < 3) return -1
  let score = 0
  const era  = parseFloat(stat.era  ?? '0')
  const whip = parseFloat(stat.whip ?? '0')
  if      (era >= 12.00) score += 80
  else if (era >= 9.00)  score += 60
  else if (era >= 7.00)  score += 40
  else if (era >= 6.00)  score += 20
  else if (era >= 5.00)  score += 8
  if      (whip >= 3.00) score += 40
  else if (whip >= 2.50) score += 28
  else if (whip >= 2.00) score += 16
  else if (whip >= 1.75) score += 7
  score += Number(stat.earnedRuns ?? 0) * 8 + Number(stat.baseOnBalls ?? 0) * 4
  const gs = Number(stat.gamesStarted ?? 0)
  if (gs >= 1 && Number(stat.strikeOuts ?? 0) < 4) score += 12
  return score
}

// Module-level cache — avoids re-fetching on every tab switch within same day
const _spotlightCache: { date: string; hot: HotGuyData | null; cold: HotGuyData | null } = { date: '', hot: null, cold: null }

async function fetchSpotlight(): Promise<{ hot: HotGuyData | null; cold: HotGuyData | null }> {
  const now   = new Date()
  const today = localDate(now)
  if (_spotlightCache.date === today) return { hot: _spotlightCache.hot, cold: _spotlightCache.cold }

  try {
    const startD = new Date(now); startD.setDate(startD.getDate() - 14)
    const start  = localDate(startD)
    const season = now.getFullYear()
    const period = 'Last 14 days'

    const [hitRes, pitRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${start}&endDate=${today}&group=hitting&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json()).catch(() => null),
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${start}&endDate=${today}&group=pitching&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json()).catch(() => null),
    ])

    const hitSplits: any[] = hitRes?.stats?.[0]?.splits ?? []
    const pitSplits: any[] = pitRes?.stats?.[0]?.splits ?? []

    let best:  { score: number; data: HotGuyData } | null = null
    let worst: { score: number; data: HotGuyData } | null = null

    for (const s of hitSplits) {
      const hotScore  = scoreHitter(s.stat)
      const coldScore = scoreColdHitter(s.stat)
      const base = {
        playerId: Number(s.player?.id), playerName: s.player?.fullName ?? '—',
        position: s.position?.abbreviation ?? s.position?.code ?? 'OF',
        teamId: Number(s.team?.id ?? 0), teamName: s.team?.name ?? '—',
        isPitcher: false, isStarter: false, period,
      }
      if (hotScore > 0 && (!best  || hotScore  > best.score))
        best  = { score: hotScore,  data: { ...base, stats: { avg: s.stat.avg, ops: s.stat.ops, hr: Number(s.stat.homeRuns ?? 0), rbi: Number(s.stat.rbi ?? 0), sb: Number(s.stat.stolenBases ?? 0), hits: Number(s.stat.hits ?? 0), ab: Number(s.stat.atBats ?? 0), doubles: Number(s.stat.doubles ?? 0), bb: Number(s.stat.baseOnBalls ?? 0), pa: Number(s.stat.plateAppearances ?? 0) } } }
      if (coldScore > 0 && (!worst || coldScore > worst.score))
        worst = { score: coldScore, data: { ...base, stats: { avg: s.stat.avg, ops: s.stat.ops, k: Number(s.stat.strikeOuts ?? 0), hits: Number(s.stat.hits ?? 0), ab: Number(s.stat.atBats ?? 0), pa: Number(s.stat.plateAppearances ?? 0), hr: Number(s.stat.homeRuns ?? 0), rbi: Number(s.stat.rbi ?? 0) } } }
    }

    for (const s of pitSplits) {
      const hotScore  = scorePitcher(s.stat)
      const coldScore = scoreColdPitcher(s.stat)
      const gs        = Number(s.stat.gamesStarted ?? 0)
      const isStarter = gs >= 1 && parseIP(s.stat.inningsPitched) >= 9
      const pitPeriod = isStarter ? `Last ${gs} start${gs !== 1 ? 's' : ''}` : period
      const base = {
        playerId: Number(s.player?.id), playerName: s.player?.fullName ?? '—',
        position: s.position?.abbreviation ?? (isStarter ? 'SP' : 'RP'),
        teamId: Number(s.team?.id ?? 0), teamName: s.team?.name ?? '—',
        isPitcher: true, isStarter, period: pitPeriod,
      }
      if (hotScore > 0 && (!best  || hotScore  > best.score))
        best  = { score: hotScore,  data: { ...base, stats: { era: s.stat.era, whip: s.stat.whip, k: Number(s.stat.strikeOuts ?? 0), ip: s.stat.inningsPitched, wins: Number(s.stat.wins ?? 0), losses: Number(s.stat.losses ?? 0), saves: Number(s.stat.saves ?? 0), holds: Number(s.stat.holds ?? 0), gs } } }
      if (coldScore > 0 && (!worst || coldScore > worst.score))
        worst = { score: coldScore, data: { ...base, stats: { era: s.stat.era, whip: s.stat.whip, k: Number(s.stat.strikeOuts ?? 0), ip: s.stat.inningsPitched, er: Number(s.stat.earnedRuns ?? 0), bb: Number(s.stat.baseOnBalls ?? 0), wins: Number(s.stat.wins ?? 0), losses: Number(s.stat.losses ?? 0), gs } } }
    }

    _spotlightCache.date = today
    _spotlightCache.hot  = best?.data  ?? null
    _spotlightCache.cold = worst?.data ?? null
    return { hot: _spotlightCache.hot, cold: _spotlightCache.cold }
  } catch { return { hot: null, cold: null } }
}

// ─── Spotlight card ───────────────────────────────────────────────────────────

const COLD_ACCENT = '#60a5fa'  // fixed ice-blue for cold mode

function SpotlightCard({ data, mode }: { data: HotGuyData; mode: 'hot' | 'cold' }) {
  const teamColor = TEAM_BG[data.teamId] ?? '#444'
  const abbr      = TEAM_ABBR[data.teamId] ?? '—'
  const accent    = mode === 'hot' ? teamColor : COLD_ACCENT

  interface StatItem { label: string; value: string; hero: boolean }

  const statItems: StatItem[] = (() => {
    if (mode === 'cold') {
      if (!data.isPitcher) {
        return [
          { label: 'AVG', value: data.stats.avg ?? '—',         hero: true  },
          { label: 'OPS', value: data.stats.ops ?? '—',         hero: false },
          { label: 'K',   value: String(data.stats.k   ?? 0),   hero: false },
        ]
      }
      return [
        { label: 'ERA',  value: data.stats.era  ?? '—',         hero: true  },
        { label: 'WHIP', value: data.stats.whip ?? '—',         hero: false },
        { label: 'ER',   value: String(data.stats.er   ?? 0),   hero: false },
      ]
    }
    // Hot mode — pick hero then show supporting stats (no duplicate summary line)
    const heroStat = (() => {
      if (!data.isPitcher) {
        const avg = parseFloat(data.stats.avg ?? '0')
        const hr  = data.stats.hr ?? 0
        const sb  = data.stats.sb ?? 0
        if (avg >= .380) return 'avg'
        if (hr  >= 4)    return 'hr'
        if (sb  >= 5)    return 'sb'
        return 'ops'
      }
      return (data.stats.saves ?? 0) >= 3 ? 'saves' : 'era'
    })()
    if (!data.isPitcher) {
      return ([
        { label: 'AVG', value: data.stats.avg ?? '—',       hero: heroStat === 'avg' },
        { label: 'OPS', value: data.stats.ops ?? '—',       hero: heroStat === 'ops' },
        { label: 'HR',  value: String(data.stats.hr  ?? 0), hero: heroStat === 'hr'  },
        { label: 'RBI', value: String(data.stats.rbi ?? 0), hero: false              },
      ] as StatItem[]).sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
    }
    return ([
      { label: 'ERA',  value: data.stats.era  ?? '—',                                          hero: heroStat === 'era'   },
      { label: 'WHIP', value: data.stats.whip ?? '—',                                          hero: false                },
      { label: 'K',    value: String(data.stats.k ?? 0),                                       hero: false                },
      ...(data.isStarter
        ? [{ label: 'W-L', value: `${data.stats.wins ?? 0}-${data.stats.losses ?? 0}`,         hero: false }]
        : data.stats.saves ? [{ label: 'SV', value: String(data.stats.saves),                  hero: heroStat === 'saves' }] : []
      ),
    ] as StatItem[]).sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
  })()

  return (
    <Box sx={{
      flex: 1, minWidth: 0, borderRadius: 2.5, overflow: 'hidden',
      border: '1px solid', borderColor: `${accent}45`,
      bgcolor: 'background.paper',
      background: `linear-gradient(155deg, ${accent}18 0%, ${accent}08 55%, transparent 80%)`,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <Box sx={{
        px: 1.75, py: 1,
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 0.75,
      }}>
        <Typography sx={{
          fontWeight: 900, fontSize: '0.68rem', textTransform: 'uppercase',
          letterSpacing: 1.2, color: accent, flex: 1, lineHeight: 1,
        }}>
          {mode === 'hot' ? '🔥 On Fire' : '🥶 Ice Cold'}
        </Typography>
        {/* Period pill — prominently visible */}
        <Box sx={{
          px: 1, py: '3px', borderRadius: 999,
          bgcolor: `${accent}20`, border: `1px solid ${accent}40`, flexShrink: 0,
        }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: accent, letterSpacing: 0.3, lineHeight: 1 }}>
            {data.period}
          </Typography>
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ px: 1.75, pt: 1.5, pb: 1.75, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        {/* Headshot */}
        <Box sx={{
          flexShrink: 0, width: 58, height: 70,
          borderRadius: 2, overflow: 'hidden',
          border: `2px solid ${accent}40`,
          bgcolor: 'action.hover',
        }}>
          <Box
            component="img"
            src={HEADSHOT(data.playerId)}
            alt={data.playerName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }}
          />
        </Box>

        {/* Info + stats */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Name */}
          <Typography sx={{
            fontWeight: 800, fontSize: '0.85rem', lineHeight: 1.15, mb: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {data.playerName}
          </Typography>

          {/* Position · Team with mini logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 1.25 }}>
            <Box sx={{
              width: 14, height: 14, borderRadius: '50%', bgcolor: teamColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              <Box component="img"
                src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${data.teamId}.svg`}
                sx={{ width: 11, height: 11, objectFit: 'contain' }}
              />
            </Box>
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1 }}>
              {data.position} · {abbr}
            </Typography>
          </Box>

          {/* Stat grid — no summary line, no duplication */}
          <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.75 }, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {statItems.map(s => (
              <Box key={s.label}>
                <Typography sx={{
                  fontSize:   s.hero ? { xs: '1.35rem', sm: '1.5rem' } : { xs: '0.88rem', sm: '1rem' },
                  fontWeight: 900, lineHeight: 1,
                  color:      s.hero ? accent : 'text.primary',
                  letterSpacing: s.hero ? '-0.3px' : 0,
                }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: '0.6rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  color: 'text.secondary',   // readable, not faded
                  lineHeight: 1, mt: 0.2,
                }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Followed player data & fetch ─────────────────────────────────────────────

interface FollowedPlayerInfo {
  id:        number
  fullName:  string
  position:  string
  teamAbbr:  string
  teamId:    number
  isPitcher: boolean
  keyLabel:  string
  keyValue:  string
}

async function fetchFollowedPlayerData(id: number): Promise<FollowedPlayerInfo | null> {
  try {
    const season = CURRENT_SEASON
    const [detRes, hitRes, pitRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`).then(r => r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=hitting&season=${season}`).then(r => r.json()).catch(() => null),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${season}`).then(r => r.json()).catch(() => null),
    ])
    const p = detRes.people?.[0]
    if (!p) return null
    const isPitcher = p.primaryPosition?.code === '1'
    const hitStat   = hitRes?.stats?.[0]?.splits?.[0]?.stat ?? null
    const pitStat   = pitRes?.stats?.[0]?.splits?.[0]?.stat ?? null
    let keyLabel = '', keyValue = '—'
    if (!isPitcher && hitStat?.ops)  { keyLabel = 'OPS'; keyValue = hitStat.ops }
    else if (!isPitcher && hitStat?.avg) { keyLabel = 'AVG'; keyValue = hitStat.avg }
    else if (isPitcher && pitStat?.era)  { keyLabel = 'ERA'; keyValue = pitStat.era }
    return {
      id: p.id,
      fullName: p.fullName ?? '',
      position: p.primaryPosition?.abbreviation ?? p.primaryPosition?.code ?? '?',
      teamAbbr: p.currentTeam?.abbreviation ?? '—',
      teamId: Number(p.currentTeam?.id ?? 0),
      isPitcher,
      keyLabel,
      keyValue,
    }
  } catch { return null }
}

// ─── Followed player card ─────────────────────────────────────────────────────

function FollowedPlayerCard({ id, data, onRemove, onClick }: {
  id:       number
  data:     FollowedPlayerInfo | null
  onRemove: () => void
  onClick:  () => void
}) {
  const teamColor = TEAM_BG[data?.teamId ?? 0] ?? '#444'

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative', flexShrink: 0,
        width: 86, borderRadius: 2.5,
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}40` },
        '&:hover .remove-btn': { opacity: 1 },
      }}
    >
      {/* Remove button (appears on hover) */}
      <Box
        className="remove-btn"
        onClick={e => { e.stopPropagation(); onRemove() }}
        sx={{
          position: 'absolute', top: 22, right: 4, zIndex: 3,
          width: 18, height: 18, borderRadius: '50%',
          bgcolor: 'rgba(0,0,0,0.65)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer',
          opacity: 0, transition: 'opacity 0.12s',
          lineHeight: 1,
        }}
      >
        ✕
      </Box>

      {/* Team color bar at top */}
      <Box sx={{ height: 3, bgcolor: teamColor }} />

      <Box sx={{ px: 1, pt: 1, pb: 1.25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        {/* Headshot */}
        <Box sx={{
          width: 54, height: 62, borderRadius: 1.5,
          overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0,
        }}>
          <Box
            component="img"
            src={HEADSHOT(id)}
            alt={data?.fullName ?? ''}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }}
          />
        </Box>

        {/* Name */}
        <Typography sx={{
          fontWeight: 700, fontSize: '0.65rem', lineHeight: 1.2,
          textAlign: 'center', px: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {data?.fullName ?? '…'}
        </Typography>

        {/* Position · Team */}
        <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>
          {data ? `${data.position} · ${data.teamAbbr}` : ''}
        </Typography>

        {/* Key stat */}
        {data?.keyValue && data.keyValue !== '—' && (
          <Box sx={{ textAlign: 'center', mt: 0.25 }}>
            <Typography sx={{ fontSize: '0.48rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 1 }}>
              {data.keyLabel}
            </Typography>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.1 }}>
              {data.keyValue}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── Followed players section ─────────────────────────────────────────────────

function FollowedPlayersSection({ followedPlayerIds, onUnfollow, onPlayerClick, onFollow }: {
  followedPlayerIds: number[]
  onUnfollow:    (id: number) => void
  onPlayerClick: (id: number) => void
  onFollow:      (id: number) => void
}) {
  const [playerData, setPlayerData]   = useState<Record<number, FollowedPlayerInfo>>({})
  const [adding, setAdding]           = useState(false)
  const [addQuery, setAddQuery]       = useState('')
  const [addResults, setAddResults]   = useState<Player[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Fetch data for newly added players
  useEffect(() => {
    for (const id of followedPlayerIds) {
      if (playerData[id]) continue
      fetchFollowedPlayerData(id).then(data => {
        if (data) setPlayerData(prev => ({ ...prev, [id]: data }))
      }).catch(() => {})
    }
  }, [followedPlayerIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced player search
  useEffect(() => {
    if (addQuery.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      setAddSearching(true)
      try { setAddResults((await searchPlayers(addQuery)).slice(0, 6)) }
      finally { setAddSearching(false) }
    }, 320)
    return () => clearTimeout(t)
  }, [addQuery])

  // Close search on outside click
  useEffect(() => {
    if (!adding) return
    const handle = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setAdding(false); setAddQuery(''); setAddResults([])
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [adding])

  const handleAdd = (p: Player) => {
    onFollow(p.id)
    setAdding(false); setAddQuery(''); setAddResults([])
  }

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1.5, color: ACCENT }}>
          ★ Your Players
        </Typography>
        <Box
          onClick={() => { setAdding(a => !a); setAddQuery(''); setAddResults([]) }}
          sx={{
            cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700, color: ACCENT,
            px: 1.5, py: 0.5, borderRadius: 999,
            border: `1px solid ${ACCENT}40`,
            transition: 'background 0.12s',
            '&:hover': { bgcolor: `${ACCENT}15` },
          }}
        >
          {adding ? '✕ Cancel' : '+ Add'}
        </Box>
      </Box>

      <Box sx={{ px: 2.5, pt: 2, pb: 2.5 }}>
        {/* Inline add search */}
        {adding && (
          <Box ref={searchRef} sx={{ mb: 2, position: 'relative' }}>
            <InputBase
              autoFocus
              placeholder="Search player…"
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setAdding(false), setAddQuery(''), setAddResults([]))}
              sx={{
                width: '100%', px: 1.5, py: 0.875,
                bgcolor: 'action.hover', borderRadius: 2,
                fontSize: '0.875rem', border: '1px solid', borderColor: 'divider',
              }}
            />
            {(addResults.length > 0 || addSearching) && (
              <Box sx={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                borderRadius: 2, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              }}>
                {addSearching && !addResults.length && (
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Searching…</Typography>
                  </Box>
                )}
                {addResults.map((p, i) => (
                  <Box
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    sx={{
                      px: 1.5, py: 0.9, cursor: 'pointer',
                      borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                      display: 'flex', alignItems: 'center', gap: 1.25,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box sx={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0 }}>
                      <Box component="img" src={HEADSHOT(p.id)}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%' }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>
                        {p.fullName}
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                        {p.primaryPosition?.name}{!p.active ? ' · retired' : ''}
                      </Typography>
                    </Box>
                    {followedPlayerIds.includes(p.id) && (
                      <Typography sx={{ fontSize: '0.6rem', color: ACCENT, fontWeight: 700, ml: 'auto', flexShrink: 0 }}>
                        ✓ Following
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* Player cards */}
        {followedPlayerIds.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem', mb: 0.5 }}>No players followed yet</Typography>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.72rem' }}>
              Tap <Box component="span" sx={{ color: ACCENT, fontWeight: 700 }}>+ Add</Box> to follow players and track them here
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5,
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}>
            {followedPlayerIds.map(id => (
              <FollowedPlayerCard
                key={id}
                id={id}
                data={playerData[id] ?? null}
                onRemove={() => onUnfollow(id)}
                onClick={() => onPlayerClick(id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ─── Predictor: types ─────────────────────────────────────────────────────────

interface TodayPitcher {
  id:   number
  name: string
  hand: string   // 'R' | 'L' | '?'
  era:  string
  ip:   string
}

interface TodayGame {
  gamePk:   number
  gameTime: string
  state:    'preview' | 'live' | 'final'
  home: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  away: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  winnerId: number | null   // set when state === 'final'
}

// ─── Predictor: API ───────────────────────────────────────────────────────────

async function fetchTodayGames(dateStr: string): Promise<TodayGame[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}` +
      `&gameType=R&hydrate=probablePitcher`
    )
    const d = await r.json()
    const rawGames: TodayGame[] = []
    const pitcherIds: number[] = []

    for (const dateObj of d.dates ?? []) {
      for (const g of dateObj.games ?? []) {
        const ht      = g.teams?.home
        const at      = g.teams?.away
        const rawSt   = g.status?.abstractGameState ?? 'Preview'
        const state   = rawSt === 'Final' ? 'final' : rawSt === 'Live' ? 'live' : 'preview' as TodayGame['state']
        const homeId  = Number(ht?.team?.id ?? 0)
        const awayId  = Number(at?.team?.id ?? 0)
        const homePId = ht?.probablePitcher?.id ? Number(ht.probablePitcher.id) : null
        const awayPId = at?.probablePitcher?.id ? Number(at.probablePitcher.id) : null
        if (homePId && !pitcherIds.includes(homePId)) pitcherIds.push(homePId)
        if (awayPId && !pitcherIds.includes(awayPId)) pitcherIds.push(awayPId)

        let winnerId: number | null = null
        if (state === 'final') {
          if (ht?.isWinner) winnerId = homeId
          else if (at?.isWinner) winnerId = awayId
        }

        rawGames.push({
          gamePk:   g.gamePk,
          gameTime: g.gameDate
            ? new Date(g.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : 'TBD',
          state: state as TodayGame['state'],
          home: { teamId: homeId, abbr: TEAM_ABBR[homeId] ?? '???', name: ht?.team?.name ?? '???',
            pitcher: homePId ? { id: homePId, name: ht.probablePitcher.fullName ?? '—', hand: '?', era: '—', ip: '—' } : null },
          away: { teamId: awayId, abbr: TEAM_ABBR[awayId] ?? '???', name: at?.team?.name ?? '???',
            pitcher: awayPId ? { id: awayPId, name: at.probablePitcher.fullName ?? '—', hand: '?', era: '—', ip: '—' } : null },
          winnerId,
        })
      }
    }

    // Step 2 — reliable pitcher stats from people endpoint
    if (pitcherIds.length > 0) {
      try {
        const season = new Date().getFullYear()
        const pr = await fetch(
          `https://statsapi.mlb.com/api/v1/people?personIds=${pitcherIds.join(',')}` +
          `&hydrate=stats(group=pitching,type=season,season=${season})`
        )
        const pd = await pr.json()
        const pm: Record<number, Partial<TodayPitcher>> = {}
        for (const p of pd.people ?? []) {
          const grp  = (p.stats ?? []).find((s: any) => s.group?.displayName === 'pitching')
          const stat = grp?.splits?.[0]?.stat ?? {}
          pm[Number(p.id)] = { hand: p.pitchHand?.code ?? '?', era: stat.era ?? '—', ip: stat.inningsPitched ?? '—' }
        }
        for (const g of rawGames) {
          if (g.home.pitcher) Object.assign(g.home.pitcher, pm[g.home.pitcher.id] ?? {})
          if (g.away.pitcher) Object.assign(g.away.pitcher, pm[g.away.pitcher.id] ?? {})
        }
      } catch { /* non-fatal */ }
    }
    return rawGames
  } catch { return [] }
}

// ─── Predictor: persistence ───────────────────────────────────────────────────

const predKey = (date: string) => `mlb_preds_${date}`

function loadLocalPreds(date: string): Record<number, number> {
  try { const s = localStorage.getItem(predKey(date)); return s ? JSON.parse(s) : {} }
  catch { return {} }
}
function saveLocalPred(date: string, gamePk: number, teamId: number) {
  try { const p = loadLocalPreds(date); p[gamePk] = teamId; localStorage.setItem(predKey(date), JSON.stringify(p)) }
  catch { /* ignore */ }
}

async function loadPredsFromSb(userId: string, date: string): Promise<Record<number, number>> {
  const { data } = await supabase
    .from('game_predictions')
    .select('game_pk, predicted_team_id')
    .eq('user_id', userId)
    .eq('game_date', date)
  return Object.fromEntries((data ?? []).map((r: any) => [r.game_pk, r.predicted_team_id]))
}

async function savePredToSb(userId: string, date: string, gamePk: number, teamId: number) {
  await supabase.from('game_predictions').upsert(
    { user_id: userId, game_date: date, game_pk: gamePk, predicted_team_id: teamId },
    { onConflict: 'user_id,game_pk' }
  )
}

// ─── Predictor: team side sub-component ──────────────────────────────────────

function PredTeamSide({ side, game, prediction, locked, onPick, onTeamNav, onPlayerNav }: {
  side:        'away' | 'home'
  game:        TodayGame
  prediction:  number | null
  locked:      boolean
  onPick:      (teamId: number) => void
  onTeamNav:   (teamId: number) => void
  onPlayerNav: (pitcherId: number) => void
}) {
  const team    = side === 'away' ? game.away : game.home
  const col     = TEAM_BG[team.teamId] ?? '#444'
  const picked  = prediction === team.teamId
  const isWin   = game.state === 'final' && game.winnerId === team.teamId
  const correct = isWin && picked
  const wrong   = game.state === 'final' && picked && !isWin
  const nickname = team.name.split(' ').pop() ?? team.abbr

  return (
    <Box
      onClick={() => !locked && onPick(team.teamId)}
      sx={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
        py: 1.25, px: 0.5, borderRadius: 2,
        border: '1.5px solid',
        borderColor: picked ? `${col}70` : 'transparent',
        bgcolor: picked ? `${col}12` : 'transparent',
        cursor: locked ? 'default' : 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        '&:hover': locked ? {} : { bgcolor: `${col}0e`, borderColor: `${col}40` },
      }}
    >
      {/* ✓ / ✗ result chip */}
      {(correct || wrong) && (
        <Box sx={{
          position: 'absolute', top: 5, right: 5,
          width: 17, height: 17, borderRadius: '50%',
          bgcolor: correct ? '#22c55e' : '#ef4444',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.62rem', color: '#fff', fontWeight: 900, lineHeight: 1,
          userSelect: 'none',
        }}>
          {correct ? '✓' : '✗'}
        </Box>
      )}

      {/* Team logo — click navigates to team */}
      <Box
        onClick={e => { e.stopPropagation(); onTeamNav(team.teamId) }}
        sx={{
          width: 44, height: 44, borderRadius: '50%',
          bgcolor: '#fff', border: `2px solid ${col}`,
          boxShadow: picked ? `0 0 0 3px ${col}35` : `0 0 0 1px ${col}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0, cursor: 'pointer',
          transition: 'box-shadow 0.15s',
          '&:hover': { boxShadow: `0 0 0 3px ${col}55` },
        }}
      >
        <Box component="img"
          src={`https://www.mlbstatic.com/team-logos/${team.teamId}.svg`}
          alt={team.abbr}
          sx={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block' }}
        />
      </Box>

      {/* Team nickname — click navigates to team */}
      <Typography
        onClick={e => { e.stopPropagation(); onTeamNav(team.teamId) }}
        sx={{
          fontWeight: 700, fontSize: '0.75rem', lineHeight: 1.2, textAlign: 'center',
          cursor: 'pointer', transition: 'color 0.12s',
          '&:hover': { color: ACCENT },
        }}
      >
        {nickname}
      </Typography>

      {/* Pitcher — click navigates to player */}
      {team.pitcher ? (
        <Box sx={{ textAlign: 'center' }}>
          <Typography
            onClick={e => { e.stopPropagation(); onPlayerNav(team.pitcher!.id) }}
            sx={{
              fontSize: '0.65rem', color: 'text.secondary', lineHeight: 1.3,
              cursor: 'pointer', transition: 'color 0.12s',
              '&:hover': { color: ACCENT },
            }}
          >
            {team.pitcher.name.split(' ').slice(-1)[0]}
            {' '}
            <Box component="span" sx={{ color: 'text.disabled' }}>
              {team.pitcher.hand === 'R' ? 'RHP' : team.pitcher.hand === 'L' ? 'LHP' : '—'}
            </Box>
          </Typography>
          <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', lineHeight: 1, mt: '2px' }}>
            {team.pitcher.era} ERA
          </Typography>
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1 }}>TBD</Typography>
      )}
    </Box>
  )
}

// ─── Predictor: game card ─────────────────────────────────────────────────────

function PredictionCard({ game, prediction, onPick, onTeamNav, onPlayerNav }: {
  game:        TodayGame
  prediction:  number | null
  onPick:      (teamId: number) => void
  onTeamNav:   (teamId: number) => void
  onPlayerNav: (pitcherId: number) => void
}) {
  const locked = game.state !== 'preview'
  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
      {/* Time / status header */}
      <Box sx={{
        px: 2, py: '5px', borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
      }}>
        {game.state === 'live' && (
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
        )}
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: 0.5, lineHeight: 1,
          color: game.state === 'live' ? '#ef4444' : 'text.disabled',
          textTransform: 'uppercase',
        }}>
          {game.state === 'live' ? 'Live' : game.state === 'final' ? 'Final' : game.gameTime}
        </Typography>
        {locked && game.state !== 'preview' && game.state !== 'final' && (
          <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled' }}>🔒</Typography>
        )}
      </Box>

      {/* Away @ Home */}
      <Box sx={{ p: 1, display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
        <PredTeamSide side="away" game={game} prediction={prediction} locked={locked} onPick={onPick} onTeamNav={onTeamNav} onPlayerNav={onPlayerNav} />
        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.25 }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1 }}>@</Typography>
        </Box>
        <PredTeamSide side="home" game={game} prediction={prediction} locked={locked} onPick={onPick} onTeamNav={onTeamNav} onPlayerNav={onPlayerNav} />
      </Box>
    </Box>
  )
}

// ─── Predictor: modal ─────────────────────────────────────────────────────────

function PredictorModal({ open, games, predictions, onPick, onClose, onPlayerClick, onTeamClick, isSignedIn }: {
  open:          boolean
  games:         TodayGame[]
  predictions:   Record<number, number>
  onPick:        (gamePk: number, teamId: number) => void
  onClose:       () => void
  onPlayerClick: (id: number) => void
  onTeamClick:   (id: number) => void
  isSignedIn:    boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const pickedCount  = Object.keys(predictions).length
  const finalized    = games.filter(g => g.state === 'final' && predictions[g.gamePk] !== undefined)
  const correctCount = finalized.filter(g => predictions[g.gamePk] === g.winnerId).length
  const pct          = finalized.length ? Math.round(correctCount / finalized.length * 100) : null
  const dateLabel    = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1400,
        bgcolor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 500,
        maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ px: 2.5, pt: 2, pb: 1.75, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }}>
                🎯 {dateLabel} Matchups
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.35, lineHeight: 1.4 }}>
                {pickedCount}/{games.length} picked
                {pct !== null && ` · ${correctCount}/${finalized.length} correct (${pct}%)`}
                {!isSignedIn && ' · Sign in to save picks'}
              </Typography>
            </Box>
            <Box
              onClick={onClose}
              sx={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.disabled',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              <Typography sx={{ fontSize: '0.8rem', lineHeight: 1 }}>✕</Typography>
            </Box>
          </Box>
        </Box>

        {/* Games list */}
        <Box sx={{
          overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {games.length === 0 ? (
            <Box sx={{ py: 5, textAlign: 'center' }}>
              <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>No games scheduled today</Typography>
            </Box>
          ) : games.map(game => (
            <PredictionCard
              key={game.gamePk}
              game={game}
              prediction={predictions[game.gamePk] ?? null}
              onPick={teamId => onPick(game.gamePk, teamId)}
              onTeamNav={id => { onClose(); onTeamClick(id) }}
              onPlayerNav={id => { onClose(); onPlayerClick(id) }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Predictor widget (home card) ─────────────────────────────────────────────

function PredictorWidget({ onPlayerClick, onTeamClick }: {
  onPlayerClick: (id: number) => void
  onTeamClick:   (id: number) => void
}) {
  const { user } = useAuth()
  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

  const [games,       setGames]       = useState<TodayGame[]>([])
  const [predictions, setPredictions] = useState<Record<number, number>>({})
  const [loading,     setLoading]     = useState(true)
  const [modalOpen,   setModalOpen]   = useState(false)

  // Load today's schedule once
  useEffect(() => {
    setLoading(true)
    fetchTodayGames(today).then(setGames).finally(() => setLoading(false))
  }, [today])

  // Load predictions — Supabase if signed in, localStorage otherwise
  useEffect(() => {
    if (user) {
      loadPredsFromSb(user.id, today)
        .then(serverPreds => {
          if (Object.keys(serverPreds).length > 0) {
            setPredictions(serverPreds)
          } else {
            // No server row yet — push any local picks up
            const local = loadLocalPreds(today)
            setPredictions(local)
            Object.entries(local).forEach(([pk, tid]) =>
              savePredToSb(user.id, today, Number(pk), Number(tid))
            )
          }
        })
        .catch(() => setPredictions(loadLocalPreds(today)))
    } else {
      setPredictions(loadLocalPreds(today))
    }
  }, [user?.id, today]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh game states every 3 min while modal is open
  useEffect(() => {
    if (!modalOpen) return
    const id = setInterval(() => {
      fetchTodayGames(today).then(updated =>
        setGames(prev => updated.map(u => ({
          ...u,
          home: { ...u.home, pitcher: u.home.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.home.pitcher ?? null },
          away: { ...u.away, pitcher: u.away.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.away.pitcher ?? null },
        })))
      )
    }, 3 * 60_000)
    return () => clearInterval(id)
  }, [modalOpen, today])

  const handlePick = useCallback((gamePk: number, teamId: number) => {
    const g = games.find(g => g.gamePk === gamePk)
    if (!g || g.state !== 'preview') return
    setPredictions(prev => ({ ...prev, [gamePk]: teamId }))
    saveLocalPred(today, gamePk, teamId)
    if (user) savePredToSb(user.id, today, gamePk, teamId)
  }, [games, today, user])

  // Summary stats
  const pickedCount  = Object.keys(predictions).length
  const finalized    = games.filter(g => g.state === 'final' && predictions[g.gamePk] !== undefined)
  const correctCount = finalized.filter(g => predictions[g.gamePk] === g.winnerId).length
  const pct          = finalized.length ? Math.round(correctCount / finalized.length * 100) : null

  const statLabel = pct !== null
    ? `${correctCount} / ${finalized.length} correct · ${pct}%`
    : pickedCount > 0
    ? `${pickedCount} / ${games.length} games picked`
    : null

  return (
    <>
      <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
        {/* Header */}
        <Box sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1.5, color: ACCENT }}>
              🎯 Predict Today's Games
            </Typography>
            {statLabel && (
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25, lineHeight: 1 }}>
                {statLabel}
              </Typography>
            )}
          </Box>
          <Box
            onClick={() => !loading && games.length > 0 && setModalOpen(true)}
            sx={{
              fontSize: '0.68rem', fontWeight: 700,
              color: loading || games.length === 0 ? 'text.disabled' : ACCENT,
              px: 1.5, py: 0.5, borderRadius: 999,
              border: '1px solid',
              borderColor: loading || games.length === 0 ? 'divider' : `${ACCENT}40`,
              cursor: loading || games.length === 0 ? 'default' : 'pointer',
              transition: 'background 0.12s',
              '&:hover': loading || games.length === 0 ? {} : { bgcolor: `${ACCENT}15` },
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? '…' : pickedCount === 0 ? 'Make Predictions' : 'View Picks'}
          </Box>
        </Box>

        {/* Mini matchup chips */}
        <Box sx={{ px: 2.5, py: 1.25 }}>
          {loading ? (
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading today's schedule…</Typography>
          ) : games.length === 0 ? (
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>No games today</Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {games.map(g => {
                const myPick  = predictions[g.gamePk]
                const correct = g.state === 'final' && myPick !== undefined && myPick === g.winnerId
                const wrong   = g.state === 'final' && myPick !== undefined && myPick !== g.winnerId
                return (
                  <Box
                    key={g.gamePk}
                    onClick={() => setModalOpen(true)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.4,
                      px: 0.75, py: 0.4, borderRadius: 1,
                      border: '1px solid',
                      borderColor: correct ? '#22c55e50' : wrong ? '#ef444450' : 'divider',
                      bgcolor: correct ? '#22c55e10' : wrong ? '#ef444410' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.12s',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, lineHeight: 1, color: myPick === g.away.teamId ? ACCENT : 'text.disabled' }}>
                      {g.away.abbr}
                    </Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: 'text.disabled', lineHeight: 1 }}>@</Typography>
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, lineHeight: 1, color: myPick === g.home.teamId ? ACCENT : 'text.disabled' }}>
                      {g.home.abbr}
                    </Typography>
                    {correct && <Typography sx={{ fontSize: '0.55rem', lineHeight: 1, color: '#22c55e', ml: '1px' }}>✓</Typography>}
                    {wrong   && <Typography sx={{ fontSize: '0.55rem', lineHeight: 1, color: '#ef4444', ml: '1px' }}>✗</Typography>}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>

      <PredictorModal
        open={modalOpen}
        games={games}
        predictions={predictions}
        onPick={handlePick}
        onClose={() => setModalOpen(false)}
        onPlayerClick={id => { setModalOpen(false); onPlayerClick(id) }}
        onTeamClick={id => { setModalOpen(false); onTeamClick(id) }}
        isSignedIn={!!user}
      />
    </>
  )
}

// ─── Standing summary type ────────────────────────────────────────────────────

interface StandingSummary {
  wins:         number
  losses:       number
  divisionRank: number
  divisionName: string
  gamesBack:    string
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

  // Fetch spotlight pair once on mount (league-wide, not team-specific)
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

  const team    = allTeams.find(t => t.id === followedTeamId)
  const bg      = TEAM_BG[followedTeamId] ?? '#1a2035'
  const abbr    = team?.abbreviation ?? '—'
  const name    = team?.name ?? '—'
  const words   = name.split(' ')
  const nickname = words[words.length - 1]
  const city    = words.slice(0, -1).join(' ')

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
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, pt: 2.5, pb: 2 }}>
          {/* Logo in a team-color circle */}
          <TeamLogoCircle teamId={followedTeamId} abbr={abbr} size={62} />

          {/* Name + standing */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {city && (
              <Typography sx={{
                fontSize: '0.6rem', fontWeight: 700, letterSpacing: '3px',
                textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1, mb: 0.3,
              }}>
                {city}
              </Typography>
            )}
            <Typography sx={{
              fontSize: { xs: '1.5rem', sm: '1.9rem' },
              fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-1px', lineHeight: 1,
              color: 'text.primary',
            }}>
              {nickname}
            </Typography>
            {standingLine && (
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.5, lineHeight: 1 }}>
                {standingLine}
              </Typography>
            )}
          </Box>

          {/* Change team */}
          <Box
            onClick={onUnfollowTeam}
            sx={{
              alignSelf: 'flex-start',
              fontSize: '0.62rem', fontWeight: 700, color: 'text.disabled',
              cursor: 'pointer', px: 1.25, py: 0.5,
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
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5, pb: 0.5 }}>
          <Typography sx={{
            fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: 2, color: 'text.disabled', textAlign: 'center', mb: 1.25,
          }}>
            Schedule
          </Typography>
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
