import React, { useState, useEffect, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR } from '../constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveGameSummary {
  gamePk:      number
  home:        { teamId: number; abbr: string; name: string; runs: number }
  away:        { teamId: number; abbr: string; name: string; runs: number }
  inning:      number
  inningOrd:   string   // "1st", "2nd", etc.
  inningHalf:  'Top' | 'Bottom'
  outs:        number
}

interface LiveGameDetail extends LiveGameSummary {
  balls:       number
  strikes:     number
  batter:      { id: number; name: string } | null
  pitcher:     { id: number; name: string } | null
  onFirst:     boolean
  onSecond:    boolean
  onThird:     boolean
  lastPlay:    string | null
  pitchCount:  number   // pitches in current at-bat
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function fetchLiveGameSummaries(): Promise<LiveGameSummary[]> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&date=${today}` +
      `&hydrate=linescore`
    )
    const d = await r.json()
    const results: LiveGameSummary[] = []
    for (const dateObj of d.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        if (game.status?.abstractGameState !== 'Live') continue
        const ls = game.linescore
        if (!ls) continue
        const homeId = Number(game.teams?.home?.team?.id ?? 0)
        const awayId = Number(game.teams?.away?.team?.id ?? 0)
        results.push({
          gamePk: game.gamePk,
          home: {
            teamId: homeId,
            abbr:   TEAM_ABBR[homeId] ?? game.teams?.home?.team?.abbreviation ?? '???',
            name:   game.teams?.home?.team?.name ?? '???',
            runs:   ls.teams?.home?.runs ?? 0,
          },
          away: {
            teamId: awayId,
            abbr:   TEAM_ABBR[awayId] ?? game.teams?.away?.team?.abbreviation ?? '???',
            name:   game.teams?.away?.team?.name ?? '???',
            runs:   ls.teams?.away?.runs ?? 0,
          },
          inning:     ls.currentInning ?? 1,
          inningOrd:  ls.currentInningOrdinal ?? `${ls.currentInning}`,
          inningHalf: ls.inningHalf === 'Bottom' ? 'Bottom' : 'Top',
          outs:       ls.outs ?? 0,
        })
      }
    }
    return results
  } catch { return [] }
}

async function fetchLiveGameDetail(gamePk: number): Promise<LiveGameDetail | null> {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
    const d = await r.json()
    const ld  = d.liveData
    const ls  = ld?.linescore
    const gd  = d.gameData
    const homeId = Number(gd?.teams?.home?.id ?? 0)
    const awayId = Number(gd?.teams?.away?.id ?? 0)
    const offense = ls?.offense ?? {}
    const defense = ls?.defense ?? {}
    const cp = ld?.plays?.currentPlay
    return {
      gamePk,
      home: {
        teamId: homeId,
        abbr:   TEAM_ABBR[homeId] ?? gd?.teams?.home?.abbreviation ?? '???',
        name:   gd?.teams?.home?.name ?? '???',
        runs:   ls?.teams?.home?.runs ?? 0,
      },
      away: {
        teamId: awayId,
        abbr:   TEAM_ABBR[awayId] ?? gd?.teams?.away?.abbreviation ?? '???',
        name:   gd?.teams?.away?.name ?? '???',
        runs:   ls?.teams?.away?.runs ?? 0,
      },
      inning:     ls?.currentInning ?? 1,
      inningOrd:  ls?.currentInningOrdinal ?? `${ls?.currentInning ?? 1}`,
      inningHalf: ls?.inningHalf === 'Bottom' ? 'Bottom' : 'Top',
      outs:       ls?.outs ?? 0,
      balls:      ls?.balls ?? 0,
      strikes:    ls?.strikes ?? 0,
      batter:     offense.batter  ? { id: Number(offense.batter.id),  name: offense.batter.fullName  ?? '?' } : null,
      pitcher:    defense.pitcher ? { id: Number(defense.pitcher.id), name: defense.pitcher.fullName ?? '?' } : null,
      onFirst:    !!offense.first,
      onSecond:   !!offense.second,
      onThird:    !!offense.third,
      lastPlay:   cp?.result?.description ?? null,
      pitchCount: cp?.count?.pitches ?? 0,
    }
  } catch { return null }
}

// ─── Base diamond ─────────────────────────────────────────────────────────────

function BaseDiamond({ onFirst, onSecond, onThird, size = 72 }: {
  onFirst: boolean; onSecond: boolean; onThird: boolean; size?: number
}) {
  const bs   = Math.round(size * 0.225)   // base square side length
  const half = size / 2
  const pad  = Math.round(size * 0.08)

  const mkBase = (occupied: boolean, cx: number, cy: number, isHome = false) => (
    <Box sx={{
      position: 'absolute',
      left: cx - bs / 2,
      top:  cy - bs / 2,
      width: bs, height: bs,
      transform: 'rotate(45deg)',
      bgcolor: occupied ? '#f59e0b' : isHome ? 'rgba(255,255,255,0.12)' : 'transparent',
      border: isHome ? 'none' : '1.5px solid',
      borderColor: occupied ? '#f59e0b' : 'rgba(255,255,255,0.22)',
      borderRadius: '2px',
      boxShadow: occupied ? `0 0 6px #f59e0b80` : 'none',
      transition: 'background-color 0.25s, border-color 0.25s, box-shadow 0.25s',
    }} />
  )

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {/* 2nd base — top center */}
      {mkBase(onSecond,  half,            pad + bs / 2)}
      {/* 3rd base — left middle */}
      {mkBase(onThird,   pad + bs / 2,    half)}
      {/* 1st base — right middle */}
      {mkBase(onFirst,   size - pad - bs / 2, half)}
      {/* Home plate — bottom center, always shown as a small pentagon-ish shape */}
      {mkBase(false, half, size - pad - bs / 2, true)}
    </Box>
  )
}

// ─── Outs indicator ───────────────────────────────────────────────────────────

function OutsDots({ outs, size = 7 }: { outs: number; size?: number }) {
  return (
    <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width: size, height: size, borderRadius: '50%',
          bgcolor:     i < outs ? '#f59e0b' : 'transparent',
          border:      '1.5px solid',
          borderColor: i < outs ? '#f59e0b' : 'rgba(255,255,255,0.18)',
          transition:  'all 0.2s',
        }} />
      ))}
    </Box>
  )
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────

function LiveDot({ size = 6 }: { size?: number }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
      animation: 'livePulse 1.6s ease-in-out infinite',
      '@keyframes livePulse': { '0%,100%': { opacity: 1, transform: 'scale(1)' }, '50%': { opacity: 0.45, transform: 'scale(0.8)' } },
    }} />
  )
}

// ─── Mini scoreboard card ─────────────────────────────────────────────────────

function LiveGameMiniCard({ game, onClick }: { game: LiveGameSummary; onClick: () => void }) {
  const awayCol    = TEAM_BG[game.away.teamId] ?? '#555'
  const homeCol    = TEAM_BG[game.home.teamId] ?? '#555'
  const awayAhead  = game.away.runs > game.home.runs
  const homeAhead  = game.home.runs > game.away.runs
  const halfArrow  = game.inningHalf === 'Top' ? '▲' : '▼'

  const teamRow = (
    teamId: number, abbr: string, runs: number, col: string, ahead: boolean
  ) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{
        width: 20, height: 20, borderRadius: '50%', bgcolor: '#fff',
        border: `1.5px solid ${col}`, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        <Box
          component="img"
          src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
          alt={abbr}
          sx={{ width: 14, height: 14, objectFit: 'contain' }}
        />
      </Box>
      <Typography sx={{
        flex: 1, fontSize: '0.74rem', fontWeight: ahead ? 800 : 500, lineHeight: 1,
        color: ahead ? 'text.primary' : 'text.secondary',
      }}>
        {abbr}
      </Typography>
      <Typography sx={{
        fontSize: '0.9rem', fontWeight: ahead ? 800 : 500, lineHeight: 1,
        color: ahead ? 'text.primary' : 'text.secondary', minWidth: 16, textAlign: 'right',
      }}>
        {runs}
      </Typography>
    </Box>
  )

  return (
    <Box
      onClick={onClick}
      sx={{
        flexShrink: 0, width: 118,
        borderRadius: 2, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
        cursor: 'pointer', userSelect: 'none',
        transition: 'all 0.15s',
        '&:hover': { borderColor: 'text.secondary', transform: 'translateY(-2px)', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' },
      }}
    >
      {/* Top row: live dot + inning */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 0.8, pb: 0.4 }}>
        <LiveDot size={5} />
        <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, color: '#ef4444', letterSpacing: 0.4, lineHeight: 1 }}>
          LIVE
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', ml: 'auto', lineHeight: 1 }}>
          {halfArrow} {game.inningOrd}
        </Typography>
      </Box>

      {/* Scores */}
      <Box sx={{ px: 1, display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {teamRow(game.away.teamId, game.away.abbr, game.away.runs, awayCol, awayAhead)}
        {teamRow(game.home.teamId, game.home.abbr, game.home.runs, homeCol, homeAhead)}
      </Box>

      {/* Outs */}
      <Box sx={{ px: 1, pt: 0.6, pb: 0.8, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <OutsDots outs={game.outs} size={6} />
        <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', lineHeight: 1 }}>
          {game.outs} {game.outs === 1 ? 'out' : 'outs'}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Detailed live game modal ──────────────────────────────────────────────────

function LiveGameDetailModal({ gamePk, onClose }: { gamePk: number; onClose: () => void }) {
  const [detail,       setDetail]       = useState<LiveGameDetail | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null)

  const refresh = useCallback(() => {
    fetchLiveGameDetail(gamePk)
      .then(d => { setDetail(d); setLastRefresh(new Date()) })
      .finally(() => setLoading(false))
  }, [gamePk])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 20_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const backdrop = (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1500,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    />
  )

  if (loading && !detail) return (
    <Box onClick={onClose} sx={{
      position: 'fixed', inset: 0, zIndex: 1500, bgcolor: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.82rem' }}>Loading game…</Typography>
    </Box>
  )

  if (!detail) return null

  const awayCol    = TEAM_BG[detail.away.teamId] ?? '#555'
  const homeCol    = TEAM_BG[detail.home.teamId] ?? '#555'
  const awayAhead  = detail.away.runs > detail.home.runs
  const homeAhead  = detail.home.runs > detail.away.runs
  const halfArrow  = detail.inningHalf === 'Top' ? '▲' : '▼'

  const teamCol = (col: any) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 0,
  }) as const

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1500,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 420,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <LiveDot size={7} />
          <Typography sx={{ flex: 1, fontWeight: 700, fontSize: '0.78rem', color: '#ef4444', lineHeight: 1 }}>
            LIVE · {halfArrow} {detail.inningHalf} {detail.inningOrd}
          </Typography>
          {/* Outs in header */}
          <OutsDots outs={detail.outs} size={7} />
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', ml: 0.25, mr: 0.75 }}>
            {detail.outs} {detail.outs === 1 ? 'out' : 'outs'}
          </Typography>
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* ── Score + diamond ────────────────────────────────────────────── */}
        <Box sx={{ px: 2, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>

          {/* Away team */}
          <Box sx={teamCol(awayCol)}>
            <Box sx={{
              width: 52, height: 52, borderRadius: '50%', bgcolor: '#fff',
              border: `2.5px solid ${awayCol}`, boxShadow: `0 0 0 1px ${awayCol}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <Box component="img"
                src={`https://www.mlbstatic.com/team-logos/${detail.away.teamId}.svg`}
                alt={detail.away.abbr}
                sx={{ width: 38, height: 38, objectFit: 'contain' }}
              />
            </Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
              {detail.away.abbr}
            </Typography>
            <Typography sx={{
              fontSize: '2.4rem', fontWeight: awayAhead ? 900 : 600, lineHeight: 1,
              color: awayAhead ? 'text.primary' : 'text.secondary',
            }}>
              {detail.away.runs}
            </Typography>
            <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>AWAY</Typography>
          </Box>

          {/* Center: diamond + count */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, px: 0.5 }}>
            <BaseDiamond onFirst={detail.onFirst} onSecond={detail.onSecond} onThird={detail.onThird} size={76} />

            {/* Count: B · S */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.52rem', color: 'text.disabled', lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Balls
                </Typography>
                <Typography sx={{
                  fontSize: '1.1rem', fontWeight: 800, lineHeight: 1.1,
                  color: detail.balls >= 3 ? '#22c55e' : 'text.primary',
                }}>
                  {detail.balls}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mb: 0.25 }}>-</Typography>
              <Box sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.52rem', color: 'text.disabled', lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Strikes
                </Typography>
                <Typography sx={{
                  fontSize: '1.1rem', fontWeight: 800, lineHeight: 1.1,
                  color: detail.strikes >= 2 ? '#ef4444' : 'text.primary',
                }}>
                  {detail.strikes}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Home team */}
          <Box sx={teamCol(homeCol)}>
            <Box sx={{
              width: 52, height: 52, borderRadius: '50%', bgcolor: '#fff',
              border: `2.5px solid ${homeCol}`, boxShadow: `0 0 0 1px ${homeCol}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <Box component="img"
                src={`https://www.mlbstatic.com/team-logos/${detail.home.teamId}.svg`}
                alt={detail.home.abbr}
                sx={{ width: 38, height: 38, objectFit: 'contain' }}
              />
            </Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
              {detail.home.abbr}
            </Typography>
            <Typography sx={{
              fontSize: '2.4rem', fontWeight: homeAhead ? 900 : 600, lineHeight: 1,
              color: homeAhead ? 'text.primary' : 'text.secondary',
            }}>
              {detail.home.runs}
            </Typography>
            <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>HOME</Typography>
          </Box>
        </Box>

        {/* ── At bat / Pitching ──────────────────────────────────────────── */}
        {(detail.batter || detail.pitcher) && (
          <>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mx: 0 }} />
            <Box sx={{ px: 2.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.batter && (
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography sx={{
                    fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
                    textTransform: 'uppercase', letterSpacing: 0.8, minWidth: 56, lineHeight: 1,
                  }}>
                    At Bat
                  </Typography>
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.2 }}>
                    {detail.batter.name}
                  </Typography>
                </Box>
              )}
              {detail.pitcher && (
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography sx={{
                    fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
                    textTransform: 'uppercase', letterSpacing: 0.8, minWidth: 56, lineHeight: 1,
                  }}>
                    Pitching
                  </Typography>
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.2 }}>
                    {detail.pitcher.name}
                  </Typography>
                </Box>
              )}
              {detail.pitchCount > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography sx={{
                    fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
                    textTransform: 'uppercase', letterSpacing: 0.8, minWidth: 56, lineHeight: 1,
                  }}>
                    Pitch #
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1 }}>
                    {detail.pitchCount} in at-bat
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* ── Last play ─────────────────────────────────────────────────── */}
        {detail.lastPlay && (
          <>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mx: 0 }} />
            <Box sx={{ px: 2.5, py: 1.5 }}>
              <Typography sx={{
                fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
                textTransform: 'uppercase', letterSpacing: 0.8, mb: 0.5, lineHeight: 1,
              }}>
                Last Play
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.55 }}>
                {detail.lastPlay}
              </Typography>
            </Box>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <LiveDot size={5} />
          <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>
            Updates every 20s
            {lastRefresh && ` · Last: ${lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}
          </Typography>
        </Box>

      </Box>
    </Box>
  )
}

// ─── LiveGamesSection ─────────────────────────────────────────────────────────

export function LiveGamesSection() {
  const [games,      setGames]      = useState<LiveGameSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [openGamePk, setOpenGamePk] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchLiveGameSummaries().then(setGames).finally(() => setLoading(false))
    // Refresh every 60 s to pick up new live games or score changes
    const id = setInterval(() => fetchLiveGameSummaries().then(setGames), 60_000)
    return () => clearInterval(id)
  }, [])

  if (loading || games.length === 0) return null

  return (
    <>
      <Box sx={{
        borderRadius: 3, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{
          px: 2, py: 1.1, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <LiveDot size={7} />
          <Typography sx={{
            fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase',
            letterSpacing: 1.4, color: '#ef4444', lineHeight: 1,
          }}>
            Live Now
          </Typography>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', lineHeight: 1 }}>
            · {games.length} {games.length === 1 ? 'game' : 'games'}
          </Typography>
        </Box>

        {/* Horizontally scrollable strip of mini cards */}
        <Box data-swipe-ignore="true" sx={{
          display: 'flex', gap: 1, p: 1.25,
          overflowX: 'auto',
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {games.map(game => (
            <LiveGameMiniCard
              key={game.gamePk}
              game={game}
              onClick={() => setOpenGamePk(game.gamePk)}
            />
          ))}
        </Box>
      </Box>

      {openGamePk !== null && (
        <LiveGameDetailModal
          gamePk={openGamePk}
          onClose={() => setOpenGamePk(null)}
        />
      )}
    </>
  )
}
