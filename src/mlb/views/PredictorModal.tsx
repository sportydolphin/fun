// The Predictor's full board: every game of the slate as a card, opened from the Home widget.
// Its own module so it loads on that tap. It was half of Predictor.tsx, and Home renders only
// the widget, so every Home landing carried the board for a reader who may never open it.
import React, { useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TONE, FILL } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { MlbSheet } from '../components/MlbSheet'
import { track, EVENTS } from '../../lib/analytics'
import { chromePx, typePx } from '../../ui/scale'
import type { TodayGame } from './Predictor'

// ─── PredTeamSide ─────────────────────────────────────────────────────────────

function PredTeamSide({ side, game, prediction, locked, onPick }: {
  side:        'away' | 'home'
  game:        TodayGame
  prediction:  number | null
  locked:      boolean
  onPick:      (teamId: number) => void
}) {
  const team    = side === 'away' ? game.away : game.home
  const isDark  = useIsDark()
  const col     = ringColor(team.teamId, isDark)
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
      {(correct || wrong) && (
        <Box sx={{
          position: 'absolute', top: chromePx(5), right: chromePx(5),
          width: chromePx(17), height: chromePx(17), borderRadius: '50%',
          bgcolor: correct ? FILL.green : FILL.red,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.62rem', color: '#fff', fontWeight: 900, lineHeight: 1,
          userSelect: 'none',
        }}>
          {correct ? '✓' : '✗'}
        </Box>
      )}

      {/* Team logo — click votes (bubbles to parent) */}
      <Box
        sx={{
          width: { xs: chromePx(44), sm: chromePx(54) }, height: { xs: chromePx(44), sm: chromePx(54) }, borderRadius: '50%',
          bgcolor: teamLogoBg(team.teamId, isDark), border: `2px solid ${col}`,
          boxShadow: picked ? `0 0 0 3px ${col}35` : `0 0 0 1px ${col}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
          transition: 'box-shadow 0.15s',
          '&:hover': { boxShadow: `0 0 0 3px ${col}55` },
        }}
      >
        <Box component="img"
          src={teamLogoSrc(team.teamId, isDark)}
          alt={team.abbr}
          sx={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(team.teamId, isDark), transformOrigin: 'center' }}
        />
      </Box>

      {/* Team nickname */}
      <Typography
        sx={{
          fontWeight: 700, fontSize: { xs: '0.75rem', sm: '0.88rem' }, lineHeight: 1.2, textAlign: 'center',
        }}
      >
        {nickname}
      </Typography>

      {/* Pitcher — display only, whole card half is the pick target */}
      {team.pitcher ? (
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: { xs: '0.66rem', sm: '0.78rem' }, color: 'text.secondary', lineHeight: 1.3 }}>
            {team.pitcher.name.split(' ').slice(-1)[0]}
            {' '}
            <Box component="span" sx={{ color: 'text.disabled' }}>
              {team.pitcher.hand === 'R' ? 'RHP' : team.pitcher.hand === 'L' ? 'LHP' : '—'}
            </Box>
          </Typography>
          <Typography sx={{ fontSize: { xs: '0.6rem', sm: '0.72rem' }, color: 'text.secondary', lineHeight: 1, mt: chromePx(2) }}>
            {team.pitcher.era} ERA
          </Typography>
        </Box>
      ) : (
        <Typography sx={{ fontSize: { xs: '0.6rem', sm: '0.72rem' }, color: 'text.disabled', lineHeight: 1 }}>TBD</Typography>
      )}
    </Box>
  )
}

// ─── PredictionCard ───────────────────────────────────────────────────────────

function PredictionCard({ game, prediction, onPick, gameVotes }: {
  game:       TodayGame
  prediction: number | null
  onPick:     (teamId: number) => void
  gameVotes?: Record<number, number>  // teamId → count
}) {
  const locked    = game.state !== 'preview'
  const awayVotes = gameVotes?.[game.away.teamId] ?? 0
  const homeVotes = gameVotes?.[game.home.teamId] ?? 0
  const totalVotes = awayVotes + homeVotes
  const awayPct   = totalVotes ? Math.round(awayVotes / totalVotes * 100) : null
  const homePct   = awayPct !== null ? 100 - awayPct : null
  const awayCol   = TEAM_BG[game.away.teamId] ?? '#888'
  const homeCol   = TEAM_BG[game.home.teamId] ?? '#888'

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden', flexShrink: 0 }}>
      <Box sx={{
        px: 2, py: chromePx(5), borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
      }}>
        {game.state === 'live' && (
          <Box sx={{ width: chromePx(5), height: chromePx(5), borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
        )}
        <Typography sx={{
          fontSize: { xs: '0.62rem', sm: '0.74rem' }, fontWeight: 700, letterSpacing: typePx(0.5), lineHeight: 1,
          color: game.state === 'live' ? TONE.red : game.state === 'postponed' ? TONE.amber : 'text.secondary',
          textTransform: 'uppercase',
        }}>
          {game.state === 'live' ? 'Live' : game.state === 'final' ? 'Final' : game.state === 'postponed' ? 'PPD' : game.note ? `${game.note} · ${game.gameTime}` : game.gameTime}
        </Typography>
        {game.state === 'live' && (
          <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled' }}>🔒</Typography>
        )}
      </Box>

      <Box sx={{ p: 1, display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
        <PredTeamSide side="away" game={game} prediction={prediction} locked={locked} onPick={onPick} />
        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.25 }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1 }}>@</Typography>
        </Box>
        <PredTeamSide side="home" game={game} prediction={prediction} locked={locked} onPick={onPick} />
      </Box>

      {/* Vote split bar */}
      {awayPct !== null && homePct !== null && (
        <Box sx={{ px: 1.25, pb: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', minWidth: '1.375rem', textAlign: 'right', lineHeight: 1 }}>
              {awayPct}%
            </Typography>
            <Box sx={{ flex: 1, display: 'flex', borderRadius: 999, overflow: 'hidden', height: chromePx(5) }}>
              <Box sx={{ width: `${awayPct}%`, bgcolor: awayCol, opacity: 0.65, transition: 'width 0.4s ease' }} />
              <Box sx={{ flex: 1, bgcolor: homeCol, opacity: 0.65 }} />
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', minWidth: '1.375rem', lineHeight: 1 }}>
              {homePct}%
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textAlign: 'center', mt: 0.4, lineHeight: 1 }}>
            {totalVotes} {totalVotes === 1 ? 'pick' : 'picks'}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Inline quick picks (on the home card) ───────────────────────────────────
// ─── PredictorModal ───────────────────────────────────────────────────────────

export function PredictorModal({ open, slateDate, games, predictions, allVotes, onPick, onClose, isSignedIn }: {
  open:          boolean
  /** YYYY-MM-DD of the slate on screen, which is tomorrow's once today has nothing left to pick. */
  slateDate:     string
  games:         TodayGame[]
  predictions:   Record<number, number>
  allVotes:      Record<number, Record<number, number>>
  onPick:        (gamePk: number, teamId: number) => void
  onClose:       () => void
  isSignedIn:    boolean
}) {
  // The view is logged on OPENING only. It shared an effect with the Escape listener, which also
  // depends on `onClose`, and the parent passes a fresh `onClose` on every render, so the event
  // fired again on each re-render while the board was open: 338 rows from 4 browsers over two
  // weeks, nine in ten of them within five seconds of the last.
  useEffect(() => {
    if (open) track(EVENTS.BOARD_VIEWED, { league: 'mlb' })
  }, [open])

  if (!open) return null

  const pickedCount  = Object.keys(predictions).length
  const finalized    = games.filter(g => g.state === 'final' && predictions[g.gamePk] !== undefined)
  const correctCount = finalized.filter(g => predictions[g.gamePk] === g.winnerId).length
  const pct          = finalized.length ? Math.round(correctCount / finalized.length * 100) : null
  // The SLATE's date, not today's: once today has nothing left to pick the board rolls to
  // tomorrow, and the title went on naming today over tomorrow's games every evening.
  const [sy, sm, sd] = slateDate.split('-').map(Number)
  const dateLabel    = new Date(sy, sm - 1, sd).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <MlbSheet onClose={onClose} maxWidth={chromePx(500)} sheet sheetFill eyebrow={`🎯 ${dateLabel} matchups`}>
        <Typography sx={{ px: 2, pt: 1.25, fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.4, flexShrink: 0 }}>
          {pickedCount}/{games.length} picked
          {pct !== null && ` · ${correctCount}/${finalized.length} correct (${pct}%)`}
          {!isSignedIn && ' · Sign in to save picks'}
        </Typography>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {games.length === 0 ? (
            <Box sx={{ py: 5, textAlign: 'center' }}>
              <Typography sx={{ color: 'text.disabled', fontSize: '0.85rem' }}>No games scheduled</Typography>
            </Box>
          ) : games.map(game => (
            <PredictionCard
              key={game.gamePk}
              game={game}
              prediction={predictions[game.gamePk] ?? null}
              onPick={teamId => onPick(game.gamePk, teamId)}
              gameVotes={allVotes[game.gamePk]}
            />
          ))}
        </Box>
    </MlbSheet>
  )
}
