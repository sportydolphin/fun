import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_ABBR, ACCENT } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { shortName, ScheduleGame, LiveGameData } from '../views/scheduleData'

// The live in-progress game card for the home team schedule strip, plus its two
// visual helpers (the base diamond and the hit/run celebration overlay). Split out
// of ScheduleStrip.tsx (July 2026).

// ─── BaseDiamond ──────────────────────────────────────────────────────────────

function BaseDiamond({ onFirst, onSecond, onThird, size = 9 }: {
  onFirst: boolean; onSecond: boolean; onThird: boolean; size?: number
}) {
  const gap = Math.round(size * 0.08)
  const sq = (occupied: boolean) => (
    <Box sx={{
      width: size, height: size,
      transform: 'rotate(45deg)',
      bgcolor: occupied ? ACCENT : 'transparent',
      border: `${size >= 12 ? 2 : 1.5}px solid`,
      borderColor: occupied ? ACCENT : 'text.disabled',
      borderRadius: '1px',
      transition: 'background-color 0.2s, border-color 0.2s',
    }} />
  )
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(3, ${size}px)`,
      gridTemplateRows: `repeat(2, ${size}px)`,
      gap: `${gap}px`,
      flexShrink: 0,
    }}>
      <Box />{sq(onSecond)}<Box />
      {sq(onThird)}<Box />{sq(onFirst)}
    </Box>
  )
}

// ─── LiveCelebration ──────────────────────────────────────────────────────────
// Overlay that fires when the followed team gets a hit (subtle) or scores (grand).

function LiveCelebration({ type, teamColor }: { type: 'hit' | 'run'; teamColor: string }) {
  const isRun = type === 'run'
  // Confetti only for runs; a burst of team-colored + gold pieces raining down.
  const pieces = React.useMemo(() => {
    if (!isRun) return []
    const cols = [teamColor, '#fbbf24', '#22c55e', '#ffffff', '#f97316']
    return Array.from({ length: 22 }, (_, i) => ({
      left:  Math.random() * 100,
      drift: (Math.random() * 2 - 1) * 40,
      fall:  70 + Math.random() * 60,
      spin:  (Math.random() * 2 - 1) * 540,
      delay: Math.random() * 0.25,
      dur:   1.1 + Math.random() * 0.9,
      size:  5 + Math.random() * 5,
      color: cols[i % cols.length],
      round: Math.random() > 0.5,
    }))
  }, [isRun, teamColor])

  return (
    <Box sx={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
      '@keyframes celebFlash': { '0%': { opacity: 0 }, '18%': { opacity: isRun ? 0.5 : 0.28 }, '100%': { opacity: 0 } },
      '@keyframes celebPop': {
        '0%':   { transform: 'scale(0.3)', opacity: 0 },
        '22%':  { transform: `scale(${isRun ? 1.25 : 1.12})`, opacity: 1 },
        '60%':  { transform: 'scale(1)', opacity: 1 },
        '100%': { transform: 'scale(1)', opacity: 0 },
      },
      '@keyframes celebConfetti': {
        '0%':   { transform: 'translateY(-20%) translateX(0) rotate(0deg)', opacity: 1 },
        '100%': { transform: 'translateY(var(--fall)) translateX(var(--drift)) rotate(var(--spin))', opacity: 0 },
      },
    }}>
      {/* Radial flash */}
      <Box sx={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at center, ${teamColor}, transparent 70%)`,
        animation: `celebFlash ${isRun ? 1 : 0.7}s ease-out forwards`,
      }} />

      {/* Confetti (runs only) */}
      {pieces.map((p, i) => (
        <Box key={i} sx={{
          position: 'absolute', top: 0, left: `${p.left}%`,
          width: p.size, height: p.round ? p.size : p.size * 0.5,
          bgcolor: p.color, borderRadius: p.round ? '50%' : '1px',
          // CSS vars consumed by the celebConfetti keyframe
          ['--fall' as any]: `${p.fall}px`,
          ['--drift' as any]: `${p.drift}px`,
          ['--spin' as any]: `${p.spin}deg`,
          animation: `celebConfetti ${p.dur}s ease-in ${p.delay}s forwards`,
        }} />
      ))}

      {/* Center badge */}
      <Box sx={{
        position: 'relative',
        px: isRun ? 2 : 1.4, py: isRun ? 0.9 : 0.6,
        borderRadius: 999,
        bgcolor: isRun ? teamColor : 'rgba(0,0,0,0.72)',
        border: isRun ? '2px solid #fff' : `1.5px solid ${teamColor}`,
        boxShadow: isRun ? `0 4px 22px ${teamColor}bb` : `0 2px 12px ${teamColor}88`,
        animation: `celebPop ${isRun ? 2.4 : 1.5}s cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
      }}>
        <Typography sx={{
          fontSize: isRun ? '1.15rem' : '0.82rem', fontWeight: 900,
          letterSpacing: isRun ? 1 : 0.5, color: '#fff', lineHeight: 1,
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          textShadow: isRun ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
        }}>
          {isRun ? '🎉 Run Scored!' : '⚾ Base Hit!'}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── LiveGameCard ─────────────────────────────────────────────────────────────

export function LiveGameCard({ game, myTeamId, liveData, loading, onPlayerClick, onTeamClick, onOpenCenter }: {
  game:           ScheduleGame
  myTeamId:       number
  liveData:       LiveGameData | null
  loading:        boolean
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  onOpenCenter?:  () => void
}) {
  const isDark     = useIsDark()
  const awayTeamId = game.isHome ? game.opponentId : myTeamId
  const homeTeamId = game.isHome ? myTeamId        : game.opponentId
  const awayAbbr   = TEAM_ABBR[awayTeamId] ?? '???'
  const homeAbbr   = TEAM_ABBR[homeTeamId] ?? '???'
  const awayCol    = ringColor(awayTeamId, isDark)
  const homeCol    = ringColor(homeTeamId, isDark)

  // Use live feed scores (most current); fall back to schedule-API scores
  const awayRuns = liveData?.awayRuns ?? (game.isHome ? game.opponentScore : game.teamScore) ?? 0
  const homeRuns = liveData?.homeRuns ?? (game.isHome ? game.teamScore     : game.opponentScore) ?? 0

  // Between innings the count/outs/bases don't apply; the feed's batter/pitcher are who's due up.
  const betweenInnings = /^(middle|end)$/i.test(liveData?.inningState ?? '')

  // ── Celebrate the followed team's hits (subtle) & runs (grand) ──────────────
  const myCol = game.isHome ? homeCol : awayCol
  const prevStatsRef = useRef<{ hits: number | null; runs: number | null }>({ hits: null, runs: null })
  const [celebration, setCelebration] = useState<{ type: 'hit' | 'run'; id: number } | null>(null)

  useEffect(() => {
    if (!liveData) return
    const myHits = game.isHome ? liveData.homeHits : liveData.awayHits
    const myRuns = game.isHome ? liveData.homeRuns : liveData.awayRuns
    const prev   = prevStatsRef.current
    // Only fire once a baseline exists (skip the initial load / card mount).
    if (prev.runs !== null && myRuns !== null && myRuns > prev.runs) {
      setCelebration({ type: 'run', id: Date.now() })       // run takes priority over a co-occurring hit
    } else if (prev.hits !== null && myHits !== null && myHits > prev.hits) {
      setCelebration({ type: 'hit', id: Date.now() })
    }
    prevStatsRef.current = { hits: myHits ?? prev.hits, runs: myRuns ?? prev.runs }
  }, [liveData, game.isHome])

  useEffect(() => {
    if (!celebration) return
    const t = setTimeout(() => setCelebration(null), celebration.type === 'run' ? 2600 : 1600)
    return () => clearTimeout(t)
  }, [celebration])

  const logo = (teamId: number, col: string) => (
    <Box
      onClick={() => onTeamClick?.(teamId)}
      sx={{
        width: 32, height: 32, borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
        border: `2px solid ${col}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        boxShadow: `0 0 0 1px ${col}30`,
        cursor: onTeamClick ? 'pointer' : 'default',
        transition: 'transform 0.12s',
        '&:hover': onTeamClick ? { transform: 'scale(1.1)' } : {},
      }}
    >
      <Box component="img"
        src={teamLogoSrc(teamId, isDark)}
        alt={TEAM_ABBR[teamId]}
        sx={{ width: 22, height: 22, objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }} />
    </Box>
  )

  return (
    <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {celebration && (
        <LiveCelebration key={celebration.id} type={celebration.type} teamColor={myCol} />
      )}
      {/* Score row: [away logo] AWAY  X — Y  HOME [home logo]   ● LIVE Game Center */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {logo(awayTeamId, awayCol)}
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', minWidth: 30, textAlign: 'center' }}>
          {awayAbbr}
        </Typography>
        <Typography sx={{ fontSize: '1.75rem', fontWeight: 900, lineHeight: 1, color: '#ef4444', mx: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {awayRuns}
          <Box component="span" sx={{ mx: 0.3, color: 'text.disabled', fontWeight: 400 }}>–</Box>
          {homeRuns}
        </Typography>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary', minWidth: 30, textAlign: 'center' }}>
          {homeAbbr}
        </Typography>
        {logo(homeTeamId, homeCol)}
        {onOpenCenter && (
          <Box
            onClick={onOpenCenter}
            sx={{
              ml: 'auto', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.3, color: '#fff',
              cursor: 'pointer', px: 1, py: 0.4,
              borderRadius: 999, bgcolor: '#ef4444',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 6px #ef444455',
              transition: 'transform 0.12s, box-shadow 0.12s, background-color 0.12s',
              '&:hover': { bgcolor: '#dc2626', transform: 'translateY(-1px)', boxShadow: '0 3px 10px #ef444470' },
            }}
          >
            <Box sx={{
              width: 5, height: 5, borderRadius: '50%', bgcolor: '#fff', flexShrink: 0,
              '@keyframes livepulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.25 }, '100%': { opacity: 1 } },
              animation: 'livepulse 1.5s ease-in-out infinite',
            }} />
            Game Center →
          </Box>
        )}
      </Box>

      {/* Game state: inning · outs · count · diamond */}
      {loading ? (
        <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled', lineHeight: 1 }}>Loading…</Typography>
      ) : liveData ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
          {/* Left column: pitcher/batter, one per line, vertically centered */}
          <Box sx={{ display: 'flex', minWidth: 0, flex: 1 }}>
            {(liveData.pitcher || liveData.batter) && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85, minWidth: 0, width: '100%' }}>
                {liveData.pitcher && (
                  <Box
                    onClick={() => onPlayerClick?.(liveData.pitcher!.id)}
                    sx={{ minWidth: 0, cursor: onPlayerClick ? 'pointer' : 'default', '&:hover .lpn': onPlayerClick ? { color: ACCENT } : {} }}
                  >
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', lineHeight: 1 }}>
                      {betweenInnings ? 'On the Mound' : 'Pitching'}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, mt: 0.2, minWidth: 0 }}>
                      <Typography className="lpn" sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.3, transition: 'color 0.12s', flexShrink: 0 }}>
                        {shortName(liveData.pitcher.name)}
                      </Typography>
                      {liveData.pitcher.line && (
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {liveData.pitcher.line}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}
                {liveData.batter && (
                  <Box
                    onClick={() => onPlayerClick?.(liveData.batter!.id)}
                    sx={{ minWidth: 0, cursor: onPlayerClick ? 'pointer' : 'default', '&:hover .lpn': onPlayerClick ? { color: ACCENT } : {} }}
                  >
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', lineHeight: 1 }}>
                      {betweenInnings ? 'Leading Off' : 'At Bat'}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, mt: 0.2, minWidth: 0 }}>
                      <Typography className="lpn" sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.3, transition: 'color 0.12s', flexShrink: 0 }}>
                        {shortName(liveData.batter.name)}
                      </Typography>
                      {liveData.batter.line && (
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {liveData.batter.line}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
          </Box>

          {/* Right column: inning + diamond + outs/count — the game "situation".
              Between innings none of those apply, so just show "End of the 4th". */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.1, flexShrink: 0 }}>
            {betweenInnings ? (
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, lineHeight: 1.2, color: 'text.secondary', textAlign: 'center' }}>
                {liveData.inningState} of the {liveData.currentInningOrdinal ?? liveData.currentInning}
              </Typography>
            ) : (
              <>
                {/* Only the ordinal centers over the bases; the top/bottom arrow is
                    absolutely positioned to its left so it doesn't shift the centering. */}
                <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
                  {(liveData.inningHalf === 'top' || liveData.inningHalf === 'bottom') && (
                    <Typography component="span" sx={{ position: 'absolute', right: '100%', mr: 0.2, fontSize: '0.6rem', fontWeight: 800, lineHeight: 1 }}>
                      {liveData.inningHalf === 'top' ? '▲' : '▼'}
                    </Typography>
                  )}
                  <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 800, lineHeight: 1 }}>
                    {liveData.currentInningOrdinal ?? liveData.currentInning}
                  </Typography>
                </Box>
                <BaseDiamond
                  onFirst={liveData.onFirst}
                  onSecond={liveData.onSecond}
                  onThird={liveData.onThird}
                  size={22}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                </Box>
              </>
            )}
          </Box>
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>
          IN PROGRESS
        </Typography>
      )}
    </Box>
  )
}
