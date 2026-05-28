import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT, ACCENT } from '../constants'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function chipDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${day}`
}

function shortName(name: string) {
  const parts = name.trim().split(' ')
  return parts.length <= 1 ? name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleGame {
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

export interface ProbablePitcher {
  id:     number
  name:   string
  era:    string
  wins:   number
  losses: number
  hand:   string
  ip:     string
}

export interface GamePreviewData {
  venue:       string
  weatherDesc: string
  home: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
  away: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
}

// ─── Schedule fetch ───────────────────────────────────────────────────────────

export async function fetchTeamSchedule(teamId: number): Promise<ScheduleGame[]> {
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

// ─── Game preview fetch ───────────────────────────────────────────────────────

export async function fetchGamePreview(gamePk: number): Promise<GamePreviewData | null> {
  try {
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
      const det = pitcherMap[Number(p.id)]
      return {
        id:     Number(p.id),
        name:   p.fullName   ?? '—',
        era:    det?.era     ?? '—',
        ip:     det?.ip      ?? '—',
        wins:   det?.wins    ?? 0,
        losses: det?.losses  ?? 0,
        hand:   det?.hand    ?? '?',
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

// ─── Live game fetch ──────────────────────────────────────────────────────────

interface LiveGameData {
  currentInning:        number | null
  currentInningOrdinal: string | null
  inningHalf:           'top' | 'bottom' | null
  outs:                 number | null
  balls:                number | null
  strikes:              number | null
  batter:               { id: number; name: string } | null
  pitcher:              { id: number; name: string } | null
  onFirst:              boolean
  onSecond:             boolean
  onThird:              boolean
  homeRuns:             number | null
  awayRuns:             number | null
}

async function fetchLiveGameData(gamePk: number): Promise<LiveGameData | null> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live` +
      `?fields=liveData,linescore,currentInning,currentInningOrdinal,inningHalf,outs,balls,strikes,offense,defense,batter,pitcher,first,second,third,id,fullName,teams,home,away,runs`
    )
    const d = await r.json()
    const ls = d.liveData?.linescore
    if (!ls) return null
    const half = String(ls.inningHalf ?? '').toLowerCase()
    const off  = ls.offense ?? {}
    const def  = ls.defense ?? {}
    const pp   = (p: any) => p?.id ? { id: Number(p.id), name: String(p.fullName ?? p.id) } : null
    return {
      currentInning:        ls.currentInning        ?? null,
      currentInningOrdinal: ls.currentInningOrdinal ?? null,
      inningHalf:           half === 'top' ? 'top' : half === 'bottom' ? 'bottom' : null,
      outs:                 ls.outs                 ?? null,
      balls:                ls.balls                ?? null,
      strikes:              ls.strikes              ?? null,
      batter:               pp(off.batter),
      pitcher:              pp(def.pitcher),
      onFirst:              Boolean(off.first),
      onSecond:             Boolean(off.second),
      onThird:              Boolean(off.third),
      homeRuns:             ls.teams?.home?.runs    ?? null,
      awayRuns:             ls.teams?.away?.runs    ?? null,
    }
  } catch { return null }
}

// ─── GameChip ─────────────────────────────────────────────────────────────────

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

      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 600,
        color: 'text.disabled', lineHeight: 1,
        mt: highlight ? 1.4 : 0, letterSpacing: 0.3,
      }}>
        {chipDate(game.date)}
      </Typography>

      <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: 'text.disabled', lineHeight: 1, letterSpacing: 0.8 }}>
        {game.isHome ? 'VS' : '@'}
      </Typography>

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

      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.primary', lineHeight: 1 }}>
        {game.opponentAbbr}
      </Typography>

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

// ─── PitcherPanel ─────────────────────────────────────────────────────────────

function PitcherPanel({ pitcher, teamId, side, onPlayerClick, onTeamClick }: {
  pitcher:        ProbablePitcher | null
  teamId:         number
  side:           'Away' | 'Home'
  onPlayerClick?: () => void
  onTeamClick?:   () => void
}) {
  const col = TEAM_BG[teamId] ?? '#444'
  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.disabled', lineHeight: 1 }}>
        {side}
      </Typography>

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

      {pitcher ? (
        <>
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
            <Box sx={{ width: 72, height: 86, borderRadius: 2.5, overflow: 'hidden', border: `2px solid ${col}50`, bgcolor: 'action.hover', flexShrink: 0 }}>
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

          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', textAlign: 'center', lineHeight: 1, fontWeight: 600 }}>
            {pitcher.hand === 'R' ? 'RHP' : pitcher.hand === 'L' ? 'LHP' : `${pitcher.hand}HP`}
          </Typography>

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
          <Box sx={{ width: 72, height: 86, borderRadius: 2.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 600 }}>TBD</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', fontWeight: 600 }}>Starter TBD</Typography>
        </>
      )}
    </Box>
  )
}

// ─── GamePreviewModal ─────────────────────────────────────────────────────────

function GamePreviewModal({ game, myTeamId, previewData, loading, onClose, onPlayerClick, onTeamClick }: {
  game:           ScheduleGame
  myTeamId:       number
  previewData:    GamePreviewData | null
  loading:        boolean
  onClose:        () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handlePlayerClick = useCallback((id: number) => { onClose(); onPlayerClick?.(id) }, [onClose, onPlayerClick])
  const handleTeamClick   = useCallback((id: number) => { onClose(); onTeamClick?.(id)   }, [onClose, onTeamClick])

  const myAbbr  = TEAM_ABBR[myTeamId] ?? '?'
  const oppAbbr = game.opponentAbbr
  const awayAbbr = game.isHome ? oppAbbr : myAbbr
  const homeAbbr = game.isHome ? myAbbr  : oppAbbr

  const awayTeamId  = previewData?.away.teamId ?? (game.isHome ? game.opponentId : myTeamId)
  const homeTeamId  = previewData?.home.teamId ?? (game.isHome ? myTeamId        : game.opponentId)
  const awayPitcher = previewData?.away.pitcher ?? null
  const homePitcher = previewData?.home.pitcher ?? null

  return (
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

                <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pt: '66px' }}>
                  <Typography sx={{ fontWeight: 900, fontSize: '0.9rem', color: 'text.disabled', lineHeight: 1 }}>@</Typography>
                </Box>

                <PitcherPanel
                  pitcher={homePitcher} teamId={homeTeamId} side="Home"
                  onPlayerClick={homePitcher ? () => handlePlayerClick(homePitcher.id) : undefined}
                  onTeamClick={() => handleTeamClick(homeTeamId)}
                />
              </Box>

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

// ─── CompactGameCard ──────────────────────────────────────────────────────────
// Compact single-game summary (last game OR next game header)

function CompactGameCard({ game, label, labelColor, onTeamClick }: {
  game:        ScheduleGame
  label:       string
  labelColor?: string
  onTeamClick?: (id: number) => void
}) {
  const isFinal = game.state === 'final'
  const isLive  = game.state === 'live'
  const isWin   = game.isWin === true
  const col     = TEAM_BG[game.opponentId] ?? '#444'

  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{
        fontSize: '0.52rem', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 1.5, color: labelColor ?? 'text.disabled', lineHeight: 1,
      }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1, fontWeight: 500 }}>
        {chipDate(game.date)} · {game.isHome ? 'vs' : '@'} {game.opponentAbbr}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
        <Box
          onClick={() => onTeamClick?.(game.opponentId)}
          sx={{
            width: 32, height: 32, borderRadius: '50%', bgcolor: '#fff',
            border: `2px solid ${col}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
            boxShadow: `0 0 0 1px ${col}30`,
            cursor: onTeamClick ? 'pointer' : 'default',
            transition: 'transform 0.12s, box-shadow 0.12s',
            '&:hover': onTeamClick ? { transform: 'scale(1.1)', boxShadow: `0 0 0 2px ${col}60` } : {},
          }}
        >
          <Box
            component="img"
            src={`https://www.mlbstatic.com/team-logos/${game.opponentId}.svg`}
            alt={game.opponentAbbr}
            sx={{ width: 22, height: 22, objectFit: 'contain' }}
          />
        </Box>

        {(isFinal || isLive) ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{
              fontSize: '1.05rem', fontWeight: 800, lineHeight: 1,
              color: isLive ? '#ef4444' : 'text.primary',
            }}>
              {game.teamScore}–{game.opponentScore}
            </Typography>
            {isFinal && (
              <Box sx={{ px: 0.6, py: '2px', borderRadius: 0.5, bgcolor: isWin ? '#22c55e22' : '#ef444422' }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 900, lineHeight: 1, color: isWin ? '#22c55e' : '#ef4444' }}>
                  {isWin ? 'W' : 'L'}
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1 }}>
            {game.gameTime}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// ─── FullScheduleModal ────────────────────────────────────────────────────────

function FullScheduleModal({ games, myTeamId, teamColor, today, onPlayerClick, onTeamClick, onClose }: {
  games:          ScheduleGame[]
  myTeamId:       number
  teamColor:      string
  today:          string
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  onClose:        () => void
}) {
  const theme   = useTheme()
  const paperBg = theme.palette.background.paper

  const chipRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [selectedGame,   setSelectedGame]   = useState<ScheduleGame | null>(null)
  const [previewData,    setPreviewData]     = useState<GamePreviewData | null>(null)
  const [loadingPreview, setLoadingPreview]  = useState(false)
  const [canScrollLeft,  setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight]  = useState(true)

  const nextGame = games.find(g => g.date >= today) ?? games[games.length - 1]

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    const c = containerRef.current, el = chipRef.current
    if (!c || !el) return
    const t = setTimeout(() => {
      c.scrollTo({ left: Math.max(0, el.offsetLeft - c.clientWidth / 2 + el.offsetWidth / 2), behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(t)
  }, [games])

  const handleScroll = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    setCanScrollLeft(c.scrollLeft > 8)
    setCanScrollRight(c.scrollLeft < c.scrollWidth - c.clientWidth - 8)
  }, [])

  const scrollStrip = useCallback((dir: 'left' | 'right') => {
    containerRef.current?.scrollBy({ left: dir === 'right' ? 280 : -280, behavior: 'smooth' })
  }, [])

  const handleChipClick = useCallback((g: ScheduleGame) => {
    setSelectedGame(g)
    setPreviewData(null)
    setLoadingPreview(true)
    fetchGamePreview(g.gamePk).then(setPreviewData).finally(() => setLoadingPreview(false))
  }, [])

  const handleClosePreview = useCallback(() => { setSelectedGame(null); setPreviewData(null) }, [])

  // Arrow button style shared by both sides
  const arrowBtn = (visible: boolean) => ({
    position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)',
    zIndex: 3, width: 30, height: 30, borderRadius: '50%',
    bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 0.15s, background-color 0.12s',
    '&:hover': { bgcolor: 'action.hover' },
    // only show on pointer:fine (mouse) devices
    '@media (pointer: coarse)': { display: 'none' },
  } as const)

  return (
    <>
      <Box
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
        sx={{
          position: 'fixed', inset: 0, zIndex: 1300,
          bgcolor: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          p: 2,
        }}
      >
        <Box sx={{
          bgcolor: 'background.paper', borderRadius: 3,
          border: '1px solid', borderColor: 'divider',
          width: '100%', maxWidth: 560,
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <Box sx={{
            px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider',
            display: 'flex', alignItems: 'center', gap: 1.5,
          }}>
            <Typography sx={{ flex: 1, fontWeight: 800, fontSize: '1rem' }}>
              Full Schedule
            </Typography>
            <Box
              onClick={onClose}
              sx={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.disabled',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <Typography sx={{ fontSize: '0.85rem', lineHeight: 1 }}>✕</Typography>
            </Box>
          </Box>

          {/* Chip strip with desktop scroll arrows */}
          <Box sx={{ py: 2.5, position: 'relative' }}>
            {/* Fade gradients */}
            <Box sx={{
              position: 'absolute', left: 0, top: 0, bottom: 8, width: 40, zIndex: 2,
              background: `linear-gradient(to right, ${paperBg} 40%, transparent)`, pointerEvents: 'none',
            }} />
            <Box sx={{
              position: 'absolute', right: 0, top: 0, bottom: 8, width: 40, zIndex: 2,
              background: `linear-gradient(to left, ${paperBg} 40%, transparent)`, pointerEvents: 'none',
            }} />

            {/* ◀ scroll button */}
            <Box onClick={() => scrollStrip('left')} sx={{ ...arrowBtn(canScrollLeft), left: 6 }}>
              <Typography sx={{ fontSize: '0.7rem', lineHeight: 1, color: 'text.secondary', mt: '-1px' }}>◀</Typography>
            </Box>
            {/* ▶ scroll button */}
            <Box onClick={() => scrollStrip('right')} sx={{ ...arrowBtn(canScrollRight), right: 6 }}>
              <Typography sx={{ fontSize: '0.7rem', lineHeight: 1, color: 'text.secondary', mt: '-1px' }}>▶</Typography>
            </Box>

            <Box
              ref={containerRef}
              onScroll={handleScroll}
              sx={{
                display: 'flex', gap: 1, overflowX: 'auto', px: 5, pb: 1,
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
                    onClick={() => handleChipClick(g)}
                  />
                )
              })}
            </Box>
          </Box>

          <Box sx={{ px: 3, pb: 2.5 }}>
            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', textAlign: 'center' }}>
              Tap any game to see matchup details & probable starters
            </Typography>
          </Box>
        </Box>
      </Box>

      {selectedGame && (
        <GamePreviewModal
          game={selectedGame}
          myTeamId={myTeamId}
          previewData={previewData}
          loading={loadingPreview}
          onClose={handleClosePreview}
          onPlayerClick={id => { onClose(); onPlayerClick?.(id) }}
          onTeamClick={id => { onClose(); onTeamClick?.(id) }}
        />
      )}
    </>
  )
}

// ─── CompactPitcherRow ────────────────────────────────────────────────────────
// Two-pitcher inline bar for the home card — much smaller than PitcherPanel

function CompactPitcherRow({ awayPitcher, homePitcher, awayTeamId, homeTeamId, loading, onPlayerClick }: {
  awayPitcher:   ProbablePitcher | null
  homePitcher:   ProbablePitcher | null
  awayTeamId:    number
  homeTeamId:    number
  loading:       boolean
  onPlayerClick?: (id: number) => void
}) {
  const awayCol = TEAM_BG[awayTeamId] ?? '#444'
  const homeCol = TEAM_BG[homeTeamId] ?? '#444'

  if (loading) return (
    <Box sx={{ pt: 1.25, mt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled' }}>Loading starters…</Typography>
    </Box>
  )

  const PitcherChip = ({ pitcher, col, align }: { pitcher: ProbablePitcher | null; col: string; align: 'left' | 'right' }) => (
    <Box
      onClick={() => pitcher && onPlayerClick?.(pitcher.id)}
      sx={{
        flex: 1, minWidth: 0,
        display: 'flex', alignItems: 'center',
        gap: 0.75,
        flexDirection: align === 'right' ? 'row-reverse' : 'row',
        cursor: pitcher && onPlayerClick ? 'pointer' : 'default',
        '&:hover .pmn': pitcher && onPlayerClick ? { color: ACCENT } : {},
      }}
    >
      {/* Headshot */}
      <Box sx={{
        width: 34, height: 42, borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
        border: `1.5px solid ${col}40`, bgcolor: 'action.hover',
      }}>
        {pitcher && (
          <Box component="img" src={HEADSHOT(pitcher.id)} alt={pitcher.name}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%', display: 'block' }} />
        )}
      </Box>
      {/* Name + stats */}
      <Box sx={{ minWidth: 0, textAlign: align }}>
        <Typography className="pmn" sx={{
          fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.12s',
        }}>
          {pitcher ? shortName(pitcher.name) : 'TBD'}
        </Typography>
        {pitcher && (
          <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1 }}>
            {pitcher.hand === 'R' ? 'RHP' : 'LHP'} · {pitcher.era} ERA
          </Typography>
        )}
      </Box>
    </Box>
  )

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      pt: 1.25, mt: 0.75, borderTop: '1px solid', borderColor: 'divider',
    }}>
      <PitcherChip pitcher={awayPitcher} col={awayCol} align="left" />
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', flexShrink: 0 }}>vs</Typography>
      <PitcherChip pitcher={homePitcher} col={homeCol} align="right" />
    </Box>
  )
}

// ─── BaseDiamond ──────────────────────────────────────────────────────────────

function BaseDiamond({ onFirst, onSecond, onThird }: {
  onFirst: boolean; onSecond: boolean; onThird: boolean
}) {
  const sq = (occupied: boolean) => (
    <Box sx={{
      width: 9, height: 9,
      transform: 'rotate(45deg)',
      bgcolor: occupied ? ACCENT : 'transparent',
      border: '1.5px solid',
      borderColor: occupied ? ACCENT : 'text.disabled',
      borderRadius: '1px',
      transition: 'background-color 0.2s, border-color 0.2s',
    }} />
  )
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 9px)',
      gridTemplateRows: 'repeat(2, 9px)',
      gap: '4px',
      flexShrink: 0,
    }}>
      <Box />{sq(onSecond)}<Box />
      {sq(onThird)}<Box />{sq(onFirst)}
    </Box>
  )
}

// ─── LiveGameCard ─────────────────────────────────────────────────────────────

function LiveGameCard({ game, myTeamId, liveData, loading, onPlayerClick, onTeamClick }: {
  game:           ScheduleGame
  myTeamId:       number
  liveData:       LiveGameData | null
  loading:        boolean
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const awayTeamId = game.isHome ? game.opponentId : myTeamId
  const homeTeamId = game.isHome ? myTeamId        : game.opponentId
  const awayAbbr   = TEAM_ABBR[awayTeamId] ?? '???'
  const homeAbbr   = TEAM_ABBR[homeTeamId] ?? '???'
  const awayCol    = TEAM_BG[awayTeamId] ?? '#444'
  const homeCol    = TEAM_BG[homeTeamId] ?? '#444'

  // Use live feed scores (most current); fall back to schedule-API scores
  const awayRuns = liveData?.awayRuns ?? (game.isHome ? game.opponentScore : game.teamScore) ?? 0
  const homeRuns = liveData?.homeRuns ?? (game.isHome ? game.teamScore     : game.opponentScore) ?? 0

  const logo = (teamId: number, col: string) => (
    <Box
      onClick={() => onTeamClick?.(teamId)}
      sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: '#fff',
        border: `2px solid ${col}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        boxShadow: `0 0 0 1px ${col}30`,
        cursor: onTeamClick ? 'pointer' : 'default',
        transition: 'transform 0.12s',
        '&:hover': onTeamClick ? { transform: 'scale(1.1)' } : {},
      }}
    >
      <Box component="img"
        src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
        alt={TEAM_ABBR[teamId]}
        sx={{ width: 22, height: 22, objectFit: 'contain' }} />
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {/* Date + opponent */}
      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1, fontWeight: 500 }}>
        {chipDate(game.date)} · {game.isHome ? 'vs' : '@'} {game.opponentAbbr}
      </Typography>

      {/* Score row: [away logo] AWAY  X — Y  HOME [home logo] */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {logo(awayTeamId, awayCol)}
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', minWidth: 30, textAlign: 'center' }}>
          {awayAbbr}
        </Typography>
        <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, lineHeight: 1, color: '#ef4444', mx: 0.5 }}>
          {awayRuns}
          <Box component="span" sx={{ mx: 0.5, color: 'text.disabled', fontWeight: 300, fontSize: '1.1rem' }}>—</Box>
          {homeRuns}
        </Typography>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', minWidth: 30, textAlign: 'center' }}>
          {homeAbbr}
        </Typography>
        {logo(homeTeamId, homeCol)}
      </Box>

      {/* Game state: inning · outs · count · diamond */}
      {loading ? (
        <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1 }}>Loading…</Typography>
      ) : liveData ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, lineHeight: 1 }}>
              {liveData.inningHalf === 'top' ? '▲' : liveData.inningHalf === 'bottom' ? '▼' : ''}
              {' '}{liveData.currentInningOrdinal ?? liveData.currentInning}
            </Typography>
            {liveData.outs !== null && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1 }}>
                {liveData.outs} out{liveData.outs !== 1 ? 's' : ''}
              </Typography>
            )}
            {liveData.balls !== null && liveData.strikes !== null && (
              <Box sx={{ px: 0.7, py: '2px', borderRadius: 0.5, bgcolor: 'action.hover' }}>
                <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, lineHeight: 1, letterSpacing: 0.2 }}>
                  {liveData.balls}–{liveData.strikes}
                </Typography>
              </Box>
            )}
            <Box sx={{ ml: 'auto' }}>
              <BaseDiamond
                onFirst={liveData.onFirst}
                onSecond={liveData.onSecond}
                onThird={liveData.onThird}
              />
            </Box>
          </Box>

          {/* Pitcher + Batter */}
          {(liveData.pitcher || liveData.batter) && (
            <Box sx={{ display: 'flex', gap: 2.5, pt: 0.25 }}>
              {liveData.pitcher && (
                <Box
                  onClick={() => onPlayerClick?.(liveData.pitcher!.id)}
                  sx={{ cursor: onPlayerClick ? 'pointer' : 'default', '&:hover .lpn': onPlayerClick ? { color: ACCENT } : {} }}
                >
                  <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', lineHeight: 1 }}>
                    Pitching
                  </Typography>
                  <Typography className="lpn" sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.3, transition: 'color 0.12s', mt: 0.2 }}>
                    {shortName(liveData.pitcher.name)}
                  </Typography>
                </Box>
              )}
              {liveData.batter && (
                <Box
                  onClick={() => onPlayerClick?.(liveData.batter!.id)}
                  sx={{ cursor: onPlayerClick ? 'pointer' : 'default', '&:hover .lpn': onPlayerClick ? { color: ACCENT } : {} }}
                >
                  <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', lineHeight: 1 }}>
                    At Bat
                  </Typography>
                  <Typography className="lpn" sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.3, transition: 'color 0.12s', mt: 0.2 }}>
                    {shortName(liveData.batter.name)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </>
      ) : (
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>
          IN PROGRESS
        </Typography>
      )}
    </Box>
  )
}

// ─── TeamScheduleStrip ────────────────────────────────────────────────────────

export function TeamScheduleStrip({ teamId, teamColor, onPlayerClick, onTeamClick }: {
  teamId:         number
  teamColor:      string
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const [games,               setGames]               = useState<ScheduleGame[]>([])
  const [loading,             setLoading]             = useState(true)
  const [previewData,         setPreviewData]         = useState<GamePreviewData | null>(null)
  const [loadingPreview,      setLoadingPreview]      = useState(false)
  const [liveInfo,            setLiveInfo]            = useState<LiveGameData | null>(null)
  const [loadingLive,         setLoadingLive]         = useState(false)
  const [upcomingGame,        setUpcomingGame]        = useState<ScheduleGame | null>(null)
  const [upcomingPreviewData, setUpcomingPreviewData] = useState<GamePreviewData | null>(null)
  const [loadingUpcoming,     setLoadingUpcoming]     = useState(false)
  const [showFullSched,       setShowFullSched]       = useState(false)

  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    setLoading(true)
    setPreviewData(null)
    setLiveInfo(null)
    setUpcomingGame(null)
    setUpcomingPreviewData(null)
    fetchTeamSchedule(teamId).then(g => {
      setGames(g)
      const next = g.find(x => x.date >= today) ?? g[g.length - 1]
      if (next) {
        if (next.state === 'live') {
          setLoadingLive(true)
          fetchLiveGameData(next.gamePk).then(setLiveInfo).finally(() => setLoadingLive(false))
        } else if (next.state === 'preview') {
          setLoadingPreview(true)
          fetchGamePreview(next.gamePk).then(setPreviewData).finally(() => setLoadingPreview(false))
        } else if (next.state === 'final') {
          // Today's game ended — also surface the next upcoming game
          const upcoming = g.find(x => x.state === 'preview')
          if (upcoming) {
            setUpcomingGame(upcoming)
            setLoadingUpcoming(true)
            fetchGamePreview(upcoming.gamePk)
              .then(setUpcomingPreviewData)
              .finally(() => setLoadingUpcoming(false))
          }
        }
      }
    }).finally(() => setLoading(false))
  }, [teamId])

  if (loading) return (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>Loading schedule…</Typography>
    </Box>
  )
  if (!games.length) return null

  const lastGame  = [...games].reverse().find(g => g.state === 'final') ?? null
  const nextGame  = games.find(g => g.date >= today) ?? games[games.length - 1]
  const isFinal   = nextGame.state === 'final'
  const isLive    = nextGame.state === 'live'
  const isPreview = nextGame.state === 'preview'
  const isToday   = nextGame.date === today
  // Only show separate "last game" when it differs from the primary card and isn't itself final-today
  const showLast  = lastGame !== null && lastGame.gamePk !== nextGame.gamePk && !isFinal

  const nextLabel = isLive ? '● LIVE'
    : isFinal ? 'FINAL'
    : isToday  ? 'Today'
    : 'Next Game'
  const nextLabelColor = isLive ? '#ef4444'
    : isFinal ? (nextGame.isWin === true ? '#22c55e' : nextGame.isWin === false ? '#ef4444' : undefined)
    : isToday ? teamColor : undefined

  const awayTeamId  = previewData?.away.teamId ?? (nextGame.isHome ? nextGame.opponentId : teamId)
  const homeTeamId  = previewData?.home.teamId ?? (nextGame.isHome ? teamId : nextGame.opponentId)
  const awayPitcher = previewData?.away.pitcher ?? null
  const homePitcher = previewData?.home.pitcher ?? null

  return (
    <>
      <Box sx={{ px: 2.5, pb: 2, pt: 0.5 }}>

        {/* ── Game section: live = full-width card; else last + next ──────── */}
        {isLive ? (
          <LiveGameCard
            game={nextGame}
            myTeamId={teamId}
            liveData={liveInfo}
            loading={loadingLive}
            onPlayerClick={onPlayerClick}
            onTeamClick={onTeamClick}
          />
        ) : (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            {showLast && (
              <>
                <CompactGameCard game={lastGame!} label="Last Game" onTeamClick={onTeamClick} />
                <Box sx={{ width: '1px', bgcolor: 'divider', alignSelf: 'stretch', my: 0.25, flexShrink: 0 }} />
              </>
            )}

            {/* Primary game column (final result or next preview) */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <CompactGameCard
                game={nextGame}
                label={nextLabel}
                labelColor={nextLabelColor}
                onTeamClick={onTeamClick}
              />
              {isPreview && (
                <CompactPitcherRow
                  awayPitcher={awayPitcher}
                  homePitcher={homePitcher}
                  awayTeamId={awayTeamId}
                  homeTeamId={homeTeamId}
                  loading={loadingPreview}
                  onPlayerClick={onPlayerClick}
                />
              )}
            </Box>

            {/* When today is done, show the next upcoming game on the right */}
            {isFinal && upcomingGame && (
              <>
                <Box sx={{ width: '1px', bgcolor: 'divider', alignSelf: 'stretch', my: 0.25, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <CompactGameCard
                    game={upcomingGame}
                    label="Next Game"
                    onTeamClick={onTeamClick}
                  />
                  <CompactPitcherRow
                    awayPitcher={upcomingPreviewData?.away.pitcher ?? null}
                    homePitcher={upcomingPreviewData?.home.pitcher ?? null}
                    awayTeamId={upcomingPreviewData?.away.teamId ?? (upcomingGame.isHome ? upcomingGame.opponentId : teamId)}
                    homeTeamId={upcomingPreviewData?.home.teamId ?? (upcomingGame.isHome ? teamId : upcomingGame.opponentId)}
                    loading={loadingUpcoming}
                    onPlayerClick={onPlayerClick}
                  />
                </Box>
              </>
            )}
          </Box>
        )}

        {/* ── View Full Schedule ────────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
          <Box
            onClick={() => setShowFullSched(true)}
            sx={{
              fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5,
              px: 1.5, py: 0.6, borderRadius: 999,
              border: '1px solid', borderColor: 'divider',
              transition: 'color 0.12s, border-color 0.12s, background-color 0.12s',
              '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' },
            }}
          >
            View Full Schedule →
          </Box>
        </Box>
      </Box>

      {showFullSched && (
        <FullScheduleModal
          games={games}
          myTeamId={teamId}
          teamColor={teamColor}
          today={today}
          onPlayerClick={onPlayerClick}
          onTeamClick={onTeamClick}
          onClose={() => setShowFullSched(false)}
        />
      )}
    </>
  )
}
