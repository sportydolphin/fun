import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { TEAM_ABBR, ACCENT } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { useScrollLock } from '../lib/useScrollLock'
import { FinalGameSummary } from './FinalGames'
import { GamePreviewModal } from './GamePreview'
import { GameCenterModal } from './LiveGameCenter'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../state/homeOverlay'
import { useDeepLink } from '../state/deepLink'
import { LiveGameCard } from '../components/LiveGameCard'
import {
  chipDate, relativeChipDate, shortName, formatIP, COMPACT_ROW_MAX,
  scheduleGameToPreview, gamesOnDate, gmLabel,
  fetchTeamSchedule, fetchGamePreview, fetchGameFinalDetails, fetchLiveGameData,
  ScheduleGame, ProbablePitcher, GamePreviewData, GameFinalDetails, LiveGameData,
} from './scheduleData'

// ─── GameChip ─────────────────────────────────────────────────────────────────

function GameChip({ game, teamColor, highlight, isActualToday, innerRef, onClick }: {
  game:          ScheduleGame
  teamColor:     string
  highlight:     boolean
  isActualToday: boolean
  innerRef?:     React.RefObject<HTMLDivElement>
  onClick?:      () => void
}) {
  const isFinal     = game.state === 'final'
  const isLive      = game.state === 'live'
  const isPostponed = game.state === 'postponed'
  const isWin       = game.isWin === true
  const isDark      = useIsDark()

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
          bgcolor: isLive       ? '#ef4444'
                 : isPostponed  ? 'rgba(128,128,128,0.5)'
                 : isActualToday ? teamColor
                 : `${teamColor}90`,
          py: '2.5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{
            fontSize: '0.44rem', fontWeight: 900, letterSpacing: 1.5,
            color: '#fff', textTransform: 'uppercase', lineHeight: 1,
          }}>
            {isLive ? '● LIVE' : isPostponed ? 'PPD' : isActualToday ? 'TODAY' : 'NEXT'}
          </Typography>
        </Box>
      )}

      <Typography sx={{
        fontSize: '0.56rem', fontWeight: 600,
        color: 'text.disabled', lineHeight: 1,
        mt: highlight ? 1.4 : 0, letterSpacing: 0.3,
      }}>
        {chipDate(game.date)}{game.gameNumber > 1 ? ' · G2' : ''}
      </Typography>

      <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: 'text.disabled', lineHeight: 1, letterSpacing: 0.8 }}>
        {game.isHome ? 'VS' : '@'}
      </Typography>

      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', bgcolor: teamLogoBg(game.opponentId, isDark),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <Box
          component="img"
          src={teamLogoSrc(game.opponentId, isDark)}
          alt={game.opponentAbbr}
          sx={{ width: 20, height: 20, objectFit: 'contain', transform: teamLogoCrop(game.opponentId, isDark), transformOrigin: 'center' }}
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
      ) : isPostponed ? (
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', lineHeight: 1, letterSpacing: 0.5 }}>
          PPD
        </Typography>
      ) : (
        <Typography sx={{ fontSize: '0.54rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1, textAlign: 'center' }}>
          {game.gameTime}
        </Typography>
      )}
    </Box>
  )
}

// ─── Countdown ────────────────────────────────────────────────────────────────

// Ticks every second — cheap since at most one or two of these mount at a time.
function useCountdownNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function GameCountdown({ iso }: { iso: string }) {
  const targetMs = new Date(iso).getTime()
  const now      = useCountdownNow()
  const diffMs   = targetMs - now

  if (diffMs <= 0) return null

  const totalMin = Math.floor(diffMs / 60_000)
  const days     = Math.floor(totalMin / 1440)
  const hours    = Math.floor((totalMin % 1440) / 60)
  const mins     = totalMin % 60
  const secs     = Math.floor((diffMs % 60_000) / 1000)

  const text =
    days  > 0 ? `${days}d ${hours}h`
    : hours > 0 ? `${hours}h ${mins}m`
    : mins  > 0 ? `${mins}m`
    : `${secs}s`

  // far: >3h away (quiet) · soon: 3h–15m (accent) · imminent: <15m (warm + pulsing)
  const urgency  = diffMs <= 15 * 60_000 ? 'imminent' : diffMs <= 3 * 3_600_000 ? 'soon' : 'far'
  const tint     = urgency === 'imminent' ? '#f59e0b' : urgency === 'soon' ? ACCENT : undefined

  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.4,
      px: 0.6, py: '2px', borderRadius: 999, lineHeight: 1,
      bgcolor: tint ? `${tint}18` : 'action.hover',
      border: '1px solid', borderColor: tint ? `${tint}45` : 'divider',
    }}>
      {urgency === 'imminent' && (
        <Box sx={{
          width: 5, height: 5, borderRadius: '50%', bgcolor: tint, flexShrink: 0,
          animation: 'countdownPulse 1.1s ease-in-out infinite',
          '@keyframes countdownPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
        }} />
      )}
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap',
        color: tint ?? 'text.disabled',
      }}>
        in {text}
      </Typography>
    </Box>
  )
}

// ─── CompactGameCard ──────────────────────────────────────────────────────────
// Compact single-game summary (last game OR next game header)

function CompactGameCard({ game, myTeamId, label, labelColor, actionLabel, onAction, onTeamClick, rightSlot, scoreRef, scoreMinWidth, gmLabel, hideDate }: {
  game:         ScheduleGame
  myTeamId?:    number
  label?:       string
  labelColor?:  string
  actionLabel?: string
  onAction?:    () => void
  onTeamClick?: (id: number) => void
  rightSlot?:   React.ReactNode                 // mobile-only: fills the empty space right of the score
  scoreRef?:    React.Ref<HTMLDivElement>        // measure the score/time block for cross-card alignment
  scoreMinWidth?: number                         // mobile: min width so stacked cards' rightSlots line up
  gmLabel?:     string                           // "GM 1"/"GM 2" badge for doubleheader days
  hideDate?:    boolean                          // 2nd+ game of a doubleheader — the date is already above
}) {
  const isFinal = game.state === 'final'
  const isLive  = game.state === 'live'
  const isWin   = game.isWin === true

  // Derive away/home team IDs and per-side scores
  const awayTeamId = myTeamId ? (game.isHome ? game.opponentId : myTeamId) : game.opponentId
  const homeTeamId = myTeamId ? (game.isHome ? myTeamId        : game.opponentId) : game.opponentId
  const awayScore  = game.isHome ? game.opponentScore : game.teamScore
  const homeScore  = game.isHome ? game.teamScore     : game.opponentScore
  const isDark     = useIsDark()
  const awayCol    = ringColor(awayTeamId, isDark)
  const homeCol    = ringColor(homeTeamId, isDark)
  const oppCol     = ringColor(game.opponentId, isDark)

  // Small clickable logo circle — ringCol overrides border for W/L ring on the followed team
  const logoCircle = (teamId: number, col: string, size: number, ringCol?: string) => (
    <Box
      onClick={e => { e.stopPropagation(); onTeamClick?.(teamId) }}
      sx={{
        width: size, height: size, borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
        border: ringCol ? `2.5px solid ${ringCol}` : `1.5px solid ${col}`,
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        boxShadow: ringCol ? `0 0 0 1px ${ringCol}50` : `0 0 0 1px ${col}30`,
        cursor: onTeamClick ? 'pointer' : 'default',
        transition: 'transform 0.12s, box-shadow 0.12s',
        '&:hover': onTeamClick ? { transform: 'scale(1.1)', boxShadow: ringCol ? `0 0 0 2px ${ringCol}80` : `0 0 0 2px ${col}60` } : {},
      }}
    >
      <Box component="img"
        src={teamLogoSrc(teamId, isDark)}
        alt={TEAM_ABBR[teamId] ?? ''}
        sx={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7), objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )

  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: { xs: 0.35, sm: 0.75 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography component="div" sx={{ lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 0.7, minWidth: 0 }}>
          {!hideDate && (
            <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: 800, color: 'text.primary' }}>
              {relativeChipDate(game.date)}
            </Box>
          )}
          {gmLabel && (
            <Box component="span" sx={{
              fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.5, color: 'text.disabled',
              px: 0.55, py: 0.2, borderRadius: 999, border: '1px solid', borderColor: 'divider',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {gmLabel}
            </Box>
          )}
        </Typography>
        {actionLabel && onAction && (
          <Box
            onClick={e => { e.stopPropagation(); onAction() }}
            sx={{
              flexShrink: 0,
              fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled',
              cursor: 'pointer', px: 0.9, py: 0.3,
              borderRadius: 999, border: '1px solid', borderColor: 'divider',
              whiteSpace: 'nowrap',
              transition: 'color 0.12s, border-color 0.12s',
              '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
            }}
          >
            {actionLabel}
          </Box>
        )}
      </Box>

      {/* Score / time row — fixed minHeight so both FINAL and NEXT GAME rows are the same height.
          On mobile, rightSlot (the pitcher lines) sits just to the right of the score. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: { xs: 0, sm: 0.25 }, minHeight: { xs: 26, sm: 32 } }}>
        <Box ref={scoreRef} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: COMPACT_ROW_MAX, flexShrink: 0, minWidth: scoreMinWidth ? { xs: `${scoreMinWidth}px`, sm: 0 } : 0 }}>
        {(isFinal || isLive) && myTeamId ? (
          // Scoreboard-style, mirrored around the dash: away team → score – score ← home team,
          // so the two scores sit adjacent to the dash instead of a logo sitting next to it.
          <>
            {(() => {
              const awayWon = awayTeamId === myTeamId ? isWin : !isWin
              const scoreTxt = (score: number | null) => (
                <Typography sx={{
                  fontSize: { xs: '0.95rem', sm: '1.05rem' }, fontWeight: 800, lineHeight: 1,
                  color: isLive ? '#ef4444' : 'text.primary',
                }}>
                  {score ?? 0}
                </Typography>
              )
              const logo = (teamId: number, col: string, won: boolean) =>
                logoCircle(teamId, col, 26, isFinal ? (won ? '#22c55e' : '#ef4444') : undefined)
              return (
                <>
                  <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {logo(awayTeamId, awayCol, awayWon)}
                    {scoreTxt(awayScore)}
                  </Box>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 400, color: 'text.disabled', flexShrink: 0 }}>–</Typography>
                  <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {scoreTxt(homeScore)}
                    {logo(homeTeamId, homeCol, !awayWon)}
                  </Box>
                </>
              )
            })()}
          </>
        ) : (isFinal || isLive) ? (
          // Fallback: single opponent logo + score (no myTeamId context)
          <>
            {logoCircle(game.opponentId, oppCol, 32)}
            <Typography sx={{
              fontSize: '1.05rem', fontWeight: 800, lineHeight: 1,
              color: isLive ? '#ef4444' : 'text.primary',
            }}>
              {game.teamScore}–{game.opponentScore}
            </Typography>
          </>
        ) : (
          // Preview / postponed: game time (+ live countdown) — team logos live in CompactPitcherRow below
          <>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: game.state === 'postponed' ? 'text.disabled' : 'text.primary', lineHeight: 1 }}>
              {game.state === 'postponed' ? 'PPD' : game.gameTime}
            </Typography>
            {game.state === 'preview' && game.gameDateISO && (
              <GameCountdown iso={game.gameDateISO} />
            )}
          </>
        )}
        {/* Status (FINAL) sits beside the score; the winner ring already carries the W/L color */}
        {label && (
          <Box component="span" sx={{
            ml: 1, flexShrink: 0, alignSelf: 'center',
            fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
            color: labelColor ?? 'text.secondary', lineHeight: 1,
          }}>
            {label}
          </Box>
        )}
        </Box>
        {rightSlot && (
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
            {rightSlot}
          </Box>
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
  useScrollLock()
  const theme   = useTheme()
  const paperBg = theme.palette.background.paper

  const chipRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [selectedGame,   setSelectedGame]   = useState<ScheduleGame | null>(null)
  const [canScrollLeft,  setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight]  = useState(true)

  // The chip to highlight: the next game still to be played. On a doubleheader day
  // whose opener is already final, that's the nightcap — not the finished game.
  const nextGame = games.find(g => g.date >= today && g.state !== 'final')
    ?? games.find(g => g.date >= today)
    ?? games[games.length - 1]

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

  // The shared preview modal fetches its own probable-starter data by gamePk, so opening
  // a game is just selecting it.
  const handleChipClick = useCallback((g: ScheduleGame) => { setSelectedGame(g) }, [])

  const handleClosePreview = useCallback(() => { setSelectedGame(null) }, [])

  // Index of the open game in the schedule, so the preview's ‹ › arrows can step to the
  // adjacent (previous / next) scheduled game.
  const selectedIdx = selectedGame ? games.findIndex(g => g.gamePk === selectedGame.gamePk) : -1

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
                    // A postponed game keeps its original date *and* the makeup date's
                    // gamePk, so the pk alone isn't unique across the strip.
                    key={`${g.date}-${g.gamePk}`}
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
          game={scheduleGameToPreview(selectedGame, myTeamId)}
          onClose={handleClosePreview}
          onPlayerClick={id => { onClose(); onPlayerClick?.(id) }}
          onTeamClick={id => { onClose(); onTeamClick?.(id) }}
          onPrev={selectedIdx > 0 ? () => handleChipClick(games[selectedIdx - 1]) : undefined}
          onNext={selectedIdx >= 0 && selectedIdx < games.length - 1 ? () => handleChipClick(games[selectedIdx + 1]) : undefined}
        />
      )}
    </>
  )
}

// ─── CompactPitcherRow ────────────────────────────────────────────────────────
// Two-pitcher inline bar for the home card — much smaller than PitcherPanel

function CompactPitcherRow({ awayPitcher, homePitcher, awayTeamId, homeTeamId, loading, onPlayerClick, inline }: {
  awayPitcher:   ProbablePitcher | null
  homePitcher:   ProbablePitcher | null
  awayTeamId:    number
  homeTeamId:    number
  loading:       boolean
  onPlayerClick?: (id: number) => void
  inline?:       boolean   // sit inline to the right of the time (no top margin / width cap)
}) {
  const isDark = useIsDark()
  const awayCol = ringColor(awayTeamId, isDark)
  const homeCol = ringColor(homeTeamId, isDark)

  if (loading) return (
    <Box sx={{ mt: 0.75 }}>
      <Typography sx={{ fontSize: '0.64rem', color: 'text.disabled' }}>Loading starters…</Typography>
    </Box>
  )

  const PitcherChip = ({ pitcher, teamId }: { pitcher: ProbablePitcher | null; teamId: number }) => {
    const col = ringColor(teamId, isDark)
    return (
      <Box
        onClick={e => { e.stopPropagation(); pitcher && onPlayerClick?.(pitcher.id) }}
        sx={{
          minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75,
          cursor: pitcher && onPlayerClick ? 'pointer' : 'default',
          '&:hover .pmn': pitcher && onPlayerClick ? { color: ACCENT } : {},
        }}
      >
        <Box sx={{
          width: 22, height: 22, borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
          border: `1.5px solid ${col}`, display: { xs: 'none', sm: 'flex' }, alignItems: 'center',
          justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        }}>
          <Box component="img"
            src={teamLogoSrc(teamId, isDark)}
            sx={{ width: 15, height: 15, objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
          />
        </Box>
        <Box sx={{ minWidth: 0, maxWidth: 96 }}>
          <Typography className="pmn" sx={{
            fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'color 0.12s',
          }}>
            {pitcher ? shortName(pitcher.name) : 'TBD'}
          </Typography>
          {pitcher && (
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1 }}>
              {pitcher.era} ERA
            </Typography>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
      mt: inline ? 0 : { xs: 0.4, sm: 0.75 },
      maxWidth: inline ? 'none' : COMPACT_ROW_MAX,
    }}>
      <PitcherChip pitcher={awayPitcher} teamId={awayTeamId} />
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', flexShrink: 0 }}>vs</Typography>
      <PitcherChip pitcher={homePitcher} teamId={homeTeamId} />
    </Box>
  )
}

// ─── CompactPerformerRow ──────────────────────────────────────────────────────
// Featured performers from a completed game — mirrors CompactPitcherRow layout

function CompactPerformerRow({ finalDetails, awayTeamId, onPlayerClick, inline }: {
  finalDetails:   GameFinalDetails
  awayTeamId?:    number   // when set, order pitchers away → home so logos align with the score row above
  onPlayerClick?: (id: number) => void
  inline?:        boolean  // sit inline to the right of the score (no top margin / width cap)
}) {
  const isDark = useIsDark()
  let first  = finalDetails.winnerPitcher
  let second = finalDetails.loserPitcher
  if (!first && !second) return null
  if (awayTeamId != null && first && second && second.teamId === awayTeamId) {
    [first, second] = [second, first]
  }

  const PlayerCard = ({ player }: { player: NonNullable<GameFinalDetails['winnerPitcher']> }) => {
    const col = ringColor(player.teamId, isDark)
    return (
      <Box
        onClick={e => { e.stopPropagation(); onPlayerClick?.(player.id) }}
        sx={{
          minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75,
          cursor: onPlayerClick ? 'pointer' : 'default',
          '&:hover .pmn': onPlayerClick ? { color: ACCENT } : {},
        }}
      >
        {/* 26px frame matches the score-row logo width so the circles share a center line */}
        <Box sx={{
          width: 26, display: { xs: 'none', sm: 'flex' }, alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <Box sx={{
            width: 22, height: 22, borderRadius: '50%', bgcolor: teamLogoBg(player.teamId, isDark),
            border: `1.5px solid ${col}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
          }}>
            <Box component="img"
              src={teamLogoSrc(player.teamId, isDark)}
              sx={{ width: 15, height: 15, objectFit: 'contain', transform: teamLogoCrop(player.teamId, isDark), transformOrigin: 'center' }}
            />
          </Box>
        </Box>
        <Box sx={{ minWidth: 0, maxWidth: 96 }}>
          <Typography className="pmn" sx={{
            fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'color 0.12s',
          }}>
            {shortName(player.name)}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1 }}>
            {formatIP(player.ip)} IP · {player.er}ER
          </Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
      mt: inline ? 0 : { xs: 0.4, sm: 0.75 },
      maxWidth: inline ? 'none' : COMPACT_ROW_MAX,
    }}>
      {first && <PlayerCard player={first} />}
      {first && second && (
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: 'text.disabled', flexShrink: 0 }}>·</Typography>
      )}
      {second && <PlayerCard player={second} />}
    </Box>
  )
}

// ─── gameToFinalSummary ───────────────────────────────────────────────────────
// Build the minimal FinalGameSummary needed to open GameCenterModal from a ScheduleGame.
// The modal fetches R/H/E and batting/pitching tables itself; we only supply the header.

function gameToFinalSummary(game: ScheduleGame, myTeamId: number): FinalGameSummary {
  const awayId  = game.isHome ? game.opponentId : myTeamId
  const homeId  = game.isHome ? myTeamId        : game.opponentId
  const homeWon = game.isHome ? (game.isWin ?? false) : !(game.isWin ?? false)
  const isLive  = game.state === 'live'
  const startMs = game.gameDateISO ? new Date(game.gameDateISO).getTime() : NaN
  return {
    gamePk:     game.gamePk,
    state:      isLive ? 'live' : 'final',
    startMs:    Number.isNaN(startMs) ? Number.MAX_SAFE_INTEGER : startMs,
    statusText: isLive ? 'Live' : 'Final',
    away:  { teamId: awayId, abbr: TEAM_ABBR[awayId] ?? '???', name: '', runs: game.isHome ? (game.opponentScore ?? 0) : (game.teamScore ?? 0), hits: 0, errors: 0, isWinner: !homeWon },
    home:  { teamId: homeId, abbr: TEAM_ABBR[homeId] ?? '???', name: '', runs: game.isHome ? (game.teamScore ?? 0) : (game.opponentScore ?? 0), hits: 0, errors: 0, isWinner: homeWon },
    winPitcher:  null,
    losePitcher: null,
    savePitcher: null,
  }
}

// ─── TeamScheduleStrip ────────────────────────────────────────────────────────

export function TeamScheduleStrip({ teamId, teamColor, showSchedule, onScheduleClose, onPlayerClick, onTeamClick }: {
  teamId:           number
  teamColor:        string
  showSchedule?:    boolean
  onScheduleClose?: () => void
  onPlayerClick?:   (id: number) => void
  onTeamClick?:     (id: number) => void
}) {
  const [games,        setGames]        = useState<ScheduleGame[]>([])
  const [loading,      setLoading]      = useState(true)
  const [liveInfo,     setLiveInfo]     = useState<LiveGameData | null>(null)
  const [loadingLive,  setLoadingLive]  = useState(false)
  const [liveGamePk,   setLiveGamePk]   = useState<number | null>(null)
  // Modal state for tapping a game card
  const [modalGame,    setModalGame]    = useState<ScheduleGame | null>(null)
  const [boxScoreGame, setBoxScoreGame] = useState<FinalGameSummary | null>(null)

  // Supporting detail is keyed by gamePk rather than by slot: on a doubleheader day
  // a single slot renders two games, and each needs its own recap / probable starters.
  const [finalDetails, setFinalDetails] = useState<Record<number, GameFinalDetails>>({})
  const [previewData,  setPreviewData]  = useState<Record<number, GamePreviewData>>({})
  const [pendingPks,   setPendingPks]   = useState<Record<number, boolean>>({})
  // Every "<gamePk>:<state>" we've already kicked off a fetch for, so the effect below
  // can re-run freely (on poll, on new schedule) without refiring requests. State is
  // part of the key so a game flipping preview → final refetches as a recap.
  const requestedPks = useRef<Set<string>>(new Set())

  // Cross-card alignment (mobile): the primary and upcoming game cards stack, and their
  // inline pitcher matchups should start at the same x. Measure both score/time blocks
  // and give both a min width equal to the wider one so the pitchers line up.
  const primaryScoreRef  = useRef<HTMLDivElement>(null)
  const upcomingScoreRef = useRef<HTMLDivElement>(null)
  const [scoreAlignW, setScoreAlignW] = useState(0)
  useLayoutEffect(() => {
    const els = [primaryScoreRef.current, upcomingScoreRef.current].filter(Boolean) as HTMLDivElement[]
    if (els.length < 2) { setScoreAlignW(0); return }   // only align when both cards are present
    const measure = () => {
      const max = Math.max(...els.map(el => el.scrollWidth))
      setScoreAlignW(prev => (max > 0 && max !== prev ? max : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    els.forEach(el => ro.observe(el))
    return () => ro.disconnect()
  }, [games])

  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Open a game in the preview popup. The shared modal fetches its own probable-starter
  // data by gamePk, so this is just selecting it. Shared by the tap handlers and the
  // popup's ‹ › day-to-day arrows.
  const openGameModal = useCallback((g: ScheduleGame) => { setModalGame(g) }, [])

  // Back-from-Search restore: reopen the team-card modal the user cross-linked from.
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'teamRecap') {
      setBoxScoreGame(o.game)
    } else if (o?.kind === 'teamPreview') {
      setModalGame(o.game)
    }
  }, [])

  // A "game starting soon" notification names a gamePk; open that game here.
  // Held until the schedule has loaded, since we need the game to open it.
  const [pendingGamePk, setPendingGamePk] = useState<number | null>(null)
  useDeepLink('game', link => setPendingGamePk(link.gamePk))
  useEffect(() => {
    if (pendingGamePk === null) return
    const g = games.find(x => x.gamePk === pendingGamePk)
    if (!g) {
      // Not this team's game (the user switched teams since the reminder fired) —
      // drop it rather than leaving it queued to fire at some unrelated moment.
      if (games.length) setPendingGamePk(null)
      return
    }
    // First pitch may have arrived between the reminder and the click, so pick the
    // modal that matches where the game actually is now.
    if (g.state === 'preview' || g.state === 'postponed') setModalGame(g)
    else setBoxScoreGame(gameToFinalSummary(g, teamId))
    setPendingGamePk(null)
  }, [pendingGamePk, games, teamId])

  useEffect(() => {
    setLoading(true)
    setGames([])
    setLiveInfo(null)
    setLiveGamePk(null)
    setFinalDetails({})
    setPreviewData({})
    setPendingPks({})
    requestedPks.current = new Set()
    fetchTeamSchedule(teamId)
      .then(setGames)
      .finally(() => setLoading(false))
  }, [teamId])

  // ── Slot selection ────────────────────────────────────────────────────────
  // Three slots, each holding a whole day so doubleheaders stay intact:
  //   primary  — the current day (first date on/after today, else the last played)
  //   last     — the most recent completed day before it (shown only when the
  //              primary day still has a game to come)
  //   upcoming — the next day with games (shown only once the primary day is done)
  const slots = useMemo(() => {
    const empty = { primary: [] as ScheduleGame[], last: [] as ScheduleGame[], upcoming: [] as ScheduleGame[] }
    if (!games.length) return empty

    const primaryDate = (games.find(g => g.date >= today) ?? games[games.length - 1]).date
    const primary     = gamesOnDate(games, primaryDate)
    // A day is "done" only when every one of its games is over — a doubleheader
    // with the nightcap still to play keeps today as the primary focus.
    const primaryDone = primary.every(g => g.state === 'final' || g.state === 'postponed')

    if (primaryDone) {
      const nextDate = games.find(g => g.date > primaryDate && g.state === 'preview')?.date
      return { primary, last: [], upcoming: nextDate ? gamesOnDate(games, nextDate) : [] }
    }
    const lastDate = [...games].reverse().find(g => g.date < primaryDate && g.state === 'final')?.date
    return {
      primary,
      last: lastDate ? gamesOnDate(games, lastDate).filter(g => g.state === 'final') : [],
      upcoming: [],
    }
  }, [games, today])

  const liveGame = slots.primary.find(g => g.state === 'live') ?? null
  const isLive   = liveGame !== null

  // Fetch the supporting detail (recap performers / probable starters) for every
  // game currently on screen — both halves of a doubleheader, not just the first.
  useEffect(() => {
    const shown = [...slots.last, ...slots.primary, ...slots.upcoming]
    for (const g of shown) {
      if (g.state !== 'final' && g.state !== 'preview') continue
      const key = `${g.gamePk}:${g.state}`
      if (requestedPks.current.has(key)) continue
      requestedPks.current.add(key)
      setPendingPks(p => ({ ...p, [g.gamePk]: true }))
      const done = () => setPendingPks(p => ({ ...p, [g.gamePk]: false }))
      if (g.state === 'final') {
        fetchGameFinalDetails(g.gamePk, teamId)
          .then(d => { if (d) setFinalDetails(m => ({ ...m, [g.gamePk]: d })) })
          .finally(done)
      } else {
        fetchGamePreview(g.gamePk)
          .then(d => { if (d) setPreviewData(m => ({ ...m, [g.gamePk]: d })) })
          .finally(done)
      }
    }
  }, [slots, teamId])

  // Start / stop live polling as the primary day's live game comes and goes.
  useEffect(() => {
    if (liveGame && liveGame.gamePk !== liveGamePk) {
      setLiveGamePk(liveGame.gamePk)
      setLoadingLive(true)
      fetchLiveGameData(liveGame.gamePk).then(setLiveInfo).finally(() => setLoadingLive(false))
    } else if (!liveGame && liveGamePk !== null) {
      setLiveGamePk(null)
      setLiveInfo(null)
    }
  }, [liveGame, liveGamePk])

  useEffect(() => {
    if (!liveGamePk) return
    const pollLive = setInterval(() => {
      fetchLiveGameData(liveGamePk).then(data => { if (data) setLiveInfo(data) })
    }, 10_000)
    // Refresh the schedule too: it's what flips the live game to final (and, on a
    // doubleheader, hands the live slot over to the nightcap).
    const pollSchedule = setInterval(() => {
      fetchTeamSchedule(teamId).then(setGames)
    }, 90_000)
    return () => { clearInterval(pollLive); clearInterval(pollSchedule) }
  }, [liveGamePk, teamId])

  if (loading) return (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>Loading schedule…</Typography>
    </Box>
  )
  if (!games.length) return null

  const showLast     = slots.last.length > 0
  const showUpcoming = slots.upcoming.length > 0
  // The primary day is "done" whenever there's an upcoming day beside it — that's
  // the same condition, and it drives the mobile score alignment between the two.
  const alignScores  = showUpcoming

  // One game inside a day column. `first` owns the date chip and the alignment ref;
  // the rest sit under it with just a GM badge, so a doubleheader reads as one day.
  const renderGameRow = (
    g:    ScheduleGame,
    day:  ScheduleGame[],
    opts: { first: boolean; scoreRef?: React.Ref<HTMLDivElement>; scoreMinWidth?: number },
  ) => {
    const isFinal   = g.state === 'final'
    const isPreview = g.state === 'preview'
    const open      = isPreview ? () => setModalGame(g)
                    : isFinal   ? () => setBoxScoreGame(gameToFinalSummary(g, teamId))
                    : undefined
    const details   = finalDetails[g.gamePk]
    const preview   = previewData[g.gamePk]
    const pending   = Boolean(pendingPks[g.gamePk])
    const awayId    = preview?.away.teamId ?? (g.isHome ? g.opponentId : teamId)
    const homeId    = preview?.home.teamId ?? (g.isHome ? teamId : g.opponentId)

    // Recap performers (final) or probable starters (preview). Rendered twice —
    // inline beside the score on mobile, on its own line from sm up.
    const detailRow = (inline: boolean) => isFinal && details ? (
      <CompactPerformerRow
        finalDetails={details}
        awayTeamId={g.isHome ? g.opponentId : teamId}
        onPlayerClick={onPlayerClick}
        inline={inline}
      />
    ) : isPreview ? (
      <CompactPitcherRow
        awayPitcher={preview?.away.pitcher ?? null}
        homePitcher={preview?.home.pitcher ?? null}
        awayTeamId={awayId}
        homeTeamId={homeId}
        loading={pending}
        onPlayerClick={onPlayerClick}
        inline={inline}
      />
    ) : null
    const hasDetail = (isFinal && details) || isPreview

    return (
      <Box
        key={g.gamePk}
        onClick={open}
        sx={{
          cursor: open ? 'pointer' : 'default',
          // Hairline between the two halves of a doubleheader.
          ...(opts.first ? {} : { mt: 0.75, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }),
        }}
      >
        <CompactGameCard
          game={g}
          myTeamId={teamId}
          label={isFinal ? 'FINAL' : undefined}
          labelColor={isFinal ? (g.isWin === true ? '#22c55e' : g.isWin === false ? '#ef4444' : undefined) : undefined}
          actionLabel={isPreview ? 'Preview →' : isFinal ? 'Recap →' : undefined}
          onAction={open}
          onTeamClick={onTeamClick}
          gmLabel={gmLabel(day, g)}
          hideDate={!opts.first}
          rightSlot={hasDetail ? detailRow(true) : undefined}
          scoreRef={opts.scoreRef}
          scoreMinWidth={opts.scoreMinWidth}
        />
        {hasDetail && <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{detailRow(false)}</Box>}
      </Box>
    )
  }

  // A whole day as one column: date chip once at the top, then its games stacked.
  const renderDayColumn = (
    day:  ScheduleGame[],
    opts: { padLeft: boolean; padRight: boolean; scoreRef?: React.Ref<HTMLDivElement>; scoreMinWidth?: number },
  ) => (
    <Box sx={{
      flex: 1, minWidth: 0,
      pl: { xs: 2.5, sm: opts.padLeft ? 2.5 : 1.5 },
      pr: { xs: 2.5, sm: opts.padRight ? 2.5 : 1.5 },
      pt: { xs: 0.75, sm: 1.25 }, pb: { xs: 0.75, sm: 1.5 },
      transition: 'background-color 0.12s',
      // A postponed-only day has nothing to open, so it gets no hover affordance.
      '&:hover': day.some(g => g.state === 'final' || g.state === 'preview') ? { bgcolor: 'action.hover' } : {},
    }}>
      {day.map((g, i) => renderGameRow(g, day, {
        first: i === 0,
        scoreRef: i === 0 ? opts.scoreRef : undefined,   // one row per column is enough to measure
        scoreMinWidth: opts.scoreMinWidth,
      }))}
    </Box>
  )

  const columnDivider = (
    <Box sx={{ width: { xs: 'auto', sm: '1px' }, height: { xs: '1px', sm: 'auto' }, bgcolor: 'divider', flexShrink: 0 }} />
  )

  return (
    <>
      {/* ── Game section: live = full-width card; else last + next ──────── */}
      {isLive && liveGame ? (
        <Box sx={{ px: 2.5, pt: 1.25, pb: 1.5 }}>
          {/* Doubleheader: the completed opener sits above the live nightcap. */}
          {slots.primary.filter(g => g.state === 'final').map(g => (
            <Box
              key={g.gamePk}
              onClick={() => setBoxScoreGame(gameToFinalSummary(g, teamId))}
              sx={{ cursor: 'pointer', mb: 1.25, pb: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <CompactGameCard
                game={g}
                myTeamId={teamId}
                label="FINAL"
                labelColor={g.isWin === true ? '#22c55e' : g.isWin === false ? '#ef4444' : undefined}
                actionLabel="Recap →"
                onAction={() => setBoxScoreGame(gameToFinalSummary(g, teamId))}
                onTeamClick={onTeamClick}
                gmLabel={gmLabel(slots.primary, g)}
              />
            </Box>
          ))}
          <LiveGameCard
            game={liveGame}
            myTeamId={teamId}
            liveData={liveInfo}
            loading={loadingLive}
            onPlayerClick={onPlayerClick}
            onTeamClick={onTeamClick}
            onOpenCenter={() => setBoxScoreGame(gameToFinalSummary(liveGame, teamId))}
          />
        </Box>
      ) : (
        // Each column owns its own padding so the hover bg fills edge-to-edge
        // (top flush with the divider, bottom flush with the card bottom).
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'stretch' }}>
          {showLast && (
            <>
              {renderDayColumn(slots.last, { padLeft: true, padRight: false })}
              {columnDivider}
            </>
          )}

          {renderDayColumn(slots.primary, {
            padLeft:  !showLast,
            padRight: !showUpcoming,
            scoreRef: primaryScoreRef,
            scoreMinWidth: alignScores ? scoreAlignW : undefined,
          })}

          {/* When the current day is done, show the next day's games on the right */}
          {showUpcoming && (
            <>
              {columnDivider}
              {renderDayColumn(slots.upcoming, {
                padLeft: false, padRight: true,
                scoreRef: upcomingScoreRef,
                scoreMinWidth: scoreAlignW,
              })}
            </>
          )}
        </Box>
      )}

      {showSchedule && (
        <FullScheduleModal
          games={games}
          myTeamId={teamId}
          teamColor={teamColor}
          today={today}
          onPlayerClick={stampOverlay({ kind: 'teamSchedule' }, onPlayerClick)}
          onTeamClick={stampOverlay({ kind: 'teamSchedule' }, onTeamClick)}
          onClose={() => onScheduleClose?.()}
        />
      )}

      {modalGame && (() => {
        const idx = games.findIndex(g => g.gamePk === modalGame.gamePk)
        return (
          <GamePreviewModal
            game={scheduleGameToPreview(modalGame, teamId)}
            onClose={() => { setModalGame(null); clearOverlayIf('teamPreview') }}
            onPlayerClick={stampOverlay({ kind: 'teamPreview', game: modalGame }, onPlayerClick)}
            onTeamClick={stampOverlay({ kind: 'teamPreview', game: modalGame }, onTeamClick)}
            onPrev={idx > 0 ? () => openGameModal(games[idx - 1]) : undefined}
            onNext={idx >= 0 && idx < games.length - 1 ? () => openGameModal(games[idx + 1]) : undefined}
          />
        )
      })()}

      {boxScoreGame && (
        <GameCenterModal
          game={boxScoreGame}
          onClose={() => { setBoxScoreGame(null); clearOverlayIf('teamRecap') }}
          onPlayerClick={stampOverlay({ kind: 'teamRecap', game: boxScoreGame }, onPlayerClick)}
          onTeamClick={stampOverlay({ kind: 'teamRecap', game: boxScoreGame }, onTeamClick)}
        />
      )}
    </>
  )
}
