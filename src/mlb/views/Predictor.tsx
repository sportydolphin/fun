import React, { useState, useEffect, useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, TEAM_NICKNAME, ACCENT } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, defaultBorder } from '../colorUtils'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { PredictionStatsModal } from './PredictionStats'
import { useDevSim } from '../devSim'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayPitcher {
  id:   number
  name: string
  hand: string
  era:  string
  ip:   string
}

export interface TodayGame {
  gamePk:   number
  gameTime: string
  state:    'preview' | 'live' | 'final'
  home: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  away: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  winnerId: number | null
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function fetchTodayGames(dateStr: string): Promise<TodayGame[]> {
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
        const detSt   = g.status?.detailedState ?? ''
        // Warmup reports "Live" ~20 min early — keep it pickable until first pitch.
        const state   = rawSt === 'Final' ? 'final' : rawSt === 'Live' && detSt !== 'Warmup' ? 'live' : 'preview' as TodayGame['state']
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

// ─── Vote totals ──────────────────────────────────────────────────────────────

// Returns: gamePk → teamId → count  (all users, not just current user)
export async function fetchVotesByGame(date: string): Promise<Record<number, Record<number, number>>> {
  try {
    const { data } = await supabase
      .from('game_predictions')
      .select('game_pk, predicted_team_id')
      .eq('game_date', date)
    const result: Record<number, Record<number, number>> = {}
    for (const row of data ?? []) {
      const pk  = Number(row.game_pk)
      const tid = Number(row.predicted_team_id)
      if (!result[pk]) result[pk] = {}
      result[pk][tid] = (result[pk][tid] ?? 0) + 1
    }
    return result
  } catch { return {} }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

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

      {/* Team logo — click votes (bubbles to parent) */}
      <Box
        sx={{
          width: { xs: 44, sm: 54 }, height: { xs: 44, sm: 54 }, borderRadius: '50%',
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
          <Typography sx={{ fontSize: { xs: '0.6rem', sm: '0.72rem' }, color: 'text.secondary', lineHeight: 1, mt: '2px' }}>
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
        px: 2, py: '5px', borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
      }}>
        {game.state === 'live' && (
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
        )}
        <Typography sx={{
          fontSize: { xs: '0.62rem', sm: '0.74rem' }, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1,
          color: game.state === 'live' ? '#ef4444' : 'text.secondary',
          textTransform: 'uppercase',
        }}>
          {game.state === 'live' ? 'Live' : game.state === 'final' ? 'Final' : game.gameTime}
        </Typography>
        {locked && game.state !== 'preview' && game.state !== 'final' && (
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
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', minWidth: 22, textAlign: 'right', lineHeight: 1 }}>
              {awayPct}%
            </Typography>
            <Box sx={{ flex: 1, display: 'flex', borderRadius: 999, overflow: 'hidden', height: 5 }}>
              <Box sx={{ width: `${awayPct}%`, bgcolor: awayCol, opacity: 0.65, transition: 'width 0.4s ease' }} />
              <Box sx={{ flex: 1, bgcolor: homeCol, opacity: 0.65 }} />
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', minWidth: 22, lineHeight: 1 }}>
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
// A compact tappable team button used for making a pick directly on the card,
// without opening the full modal.

function QuickPickTeam({ team, side, picked, dimmed, onPick }: {
  team:   TodayGame['home']
  side:   'away' | 'home'
  picked: boolean
  dimmed: boolean
  onPick: () => void
}) {
  const isDark = useIsDark()
  const col    = ringColor(team.teamId, isDark)
  const away   = side === 'away'
  const label  = TEAM_NICKNAME[team.teamId] ?? team.name

  const logo = (
    <Box sx={{
      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
      bgcolor: teamLogoBg(team.teamId, isDark), border: `2px solid ${col}`,
      boxShadow: picked ? `0 0 0 2px ${col}40` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      transition: 'box-shadow 0.15s',
    }}>
      <Box component="img"
        src={teamLogoSrc(team.teamId, isDark)}
        alt={team.abbr}
        sx={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(team.teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )
  const name = (
    <Typography sx={{
      minWidth: 0, fontSize: '0.82rem', fontWeight: picked ? 800 : 600, lineHeight: 1.1,
      color: picked ? col : 'text.primary',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      textAlign: away ? 'right' : 'left',
    }}>
      {label}
    </Typography>
  )

  return (
    // Hug content (no flex:1) so the row is a tight, centred matchup cluster
    // rather than two half-width halves with empty outer margins.
    <Box
      onClick={onPick}
      sx={{
        flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.7,
        justifyContent: away ? 'flex-end' : 'flex-start',
        px: 0.85, py: 0.55, borderRadius: 1.5, cursor: 'pointer',
        border: '1.5px solid', borderColor: picked ? `${col}70` : 'transparent',
        bgcolor: picked ? `${col}14` : 'transparent',
        opacity: dimmed ? 0.45 : 1,
        transition: 'all 0.15s',
        '&:hover': { bgcolor: `${col}0e`, borderColor: `${col}40` },
      }}
    >
      {away ? <>{name}{logo}</> : <>{logo}{name}</>}
    </Box>
  )
}

// The crowd-vote share on the outer edge of a matchup row. Reserves its column
// width even with no votes (renders blank) so the two teams stay aligned.
function PctLabel({ pct, align }: { pct: number | null; align: 'left' | 'right' }) {
  return (
    <Typography sx={{
      fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      color: 'text.disabled', textAlign: align, lineHeight: 1, whiteSpace: 'nowrap',
      visibility: pct === null ? 'hidden' : 'visible',
    }}>
      {pct ?? 0}%
    </Typography>
  )
}

function QuickPickRow({ game, prediction, gameVotes, onPick }: {
  game:       TodayGame
  prediction: number | null
  gameVotes?: Record<number, number>  // teamId → count
  onPick:     (teamId: number) => void
}) {
  const hasPick    = prediction !== null
  const awayVotes  = gameVotes?.[game.away.teamId] ?? 0
  const homeVotes  = gameVotes?.[game.home.teamId] ?? 0
  const totalVotes = awayVotes + homeVotes
  const awayPct    = totalVotes ? Math.round(awayVotes / totalVotes * 100) : null
  const homePct    = awayPct !== null ? 100 - awayPct : null
  const isDark     = useIsDark()
  // Ring color in dark mode gives the bars maximum contrast; light stays on TEAM_BG.
  const awayCol    = isDark ? ringColor(game.away.teamId, true) : TEAM_BG[game.away.teamId] ?? '#888'
  const homeCol    = isDark ? ringColor(game.home.teamId, true) : TEAM_BG[game.home.teamId] ?? '#888'
  const pickedAway = prediction === game.away.teamId
  const pickedHome = prediction === game.home.teamId

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {/* 5-column grid: vote% · away (hugs centre) · @ · home (hugs centre) · vote%. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(26px,auto) minmax(0,1fr) auto minmax(0,1fr) minmax(26px,auto)',
        alignItems: 'center', columnGap: 0.6,
      }}>
        <PctLabel pct={awayPct} align="left" />
        <QuickPickTeam
          team={game.away}
          side="away"
          picked={pickedAway}
          dimmed={hasPick && !pickedAway}
          onPick={() => onPick(game.away.teamId)}
        />
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled', px: 0.15, lineHeight: 1 }}>@</Typography>
        <QuickPickTeam
          team={game.home}
          side="home"
          picked={pickedHome}
          dimmed={hasPick && !pickedHome}
          onPick={() => onPick(game.home.teamId)}
        />
        <PctLabel pct={homePct} align="right" />
      </Box>

      {/* Tug-of-war meter: crowd split in team colors, scaling with the vote %.
          The side you picked pulls to full strength so the bar shows the crowd
          lean and your call at once. A hairline gap marks the boundary. */}
      {awayPct !== null && (
        <Box sx={{ display: 'flex', alignItems: 'stretch', height: 6, gap: '2px' }}>
          <Box sx={{
            width: `${awayPct}%`, minWidth: awayPct > 0 ? 4 : 0,
            bgcolor: awayCol, opacity: !hasPick ? 0.72 : pickedAway ? 1 : 0.32,
            borderRadius: '999px 3px 3px 999px',
            boxShadow: pickedAway ? `0 0 6px ${awayCol}88` : 'none',
            transition: 'width 0.45s ease, opacity 0.2s',
          }} />
          <Box sx={{
            flex: 1, minWidth: homePct! > 0 ? 4 : 0,
            bgcolor: homeCol, opacity: !hasPick ? 0.72 : pickedHome ? 1 : 0.32,
            borderRadius: '3px 999px 999px 3px',
            boxShadow: pickedHome ? `0 0 6px ${homeCol}88` : 'none',
            transition: 'opacity 0.2s',
          }} />
        </Box>
      )}
    </Box>
  )
}

// ─── PredictorModal ───────────────────────────────────────────────────────────

function PredictorModal({ open, games, predictions, allVotes, onPick, onClose, isSignedIn }: {
  open:          boolean
  games:         TodayGame[]
  predictions:   Record<number, number>
  allVotes:      Record<number, Record<number, number>>
  onPick:        (gamePk: number, teamId: number) => void
  onClose:       () => void
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
        // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
        // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
        maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}>
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

        <Box sx={{
          overflowY: 'auto', flex: 1, minHeight: 0, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25,
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
              gameVotes={allVotes[game.gamePk]}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── PredictorWidget ──────────────────────────────────────────────────────────

export function PredictorWidget() {
  const { user } = useAuth()
  const isDark = useIsDark()
  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

  const [games,       setGames]       = useState<TodayGame[]>([])
  const [predictions, setPredictions] = useState<Record<number, number>>({})
  const [allVotes,    setAllVotes]    = useState<Record<number, Record<number, number>>>({})
  const [loading,     setLoading]     = useState(true)
  const [modalOpen,   setModalOpen]   = useState(false)
  const [statsOpen,   setStatsOpen]   = useState(false)
  const [username,    setUsername]    = useState<string | null>(null)

  // Dev-only: when the simulator is enabled, drive the widget off a fabricated
  // slate instead of the real schedule (see devSim.ts). Inert in production —
  // `import.meta.env.DEV` is false there, so this collapses to the real fetch.
  const devSim    = useDevSim()
  const simActive = import.meta.env.DEV && devSim.enabled

  useEffect(() => {
    if (simActive) { setGames(devSim.games); setLoading(false); return }
    setLoading(true)
    fetchTodayGames(today).then(setGames).finally(() => setLoading(false))
  }, [today, simActive, devSim.games])

  // Load crowd-vote splits up front so the inline quick picks can show
  // percentages (not just when the modal opens). Sim mode uses devSim.votes.
  useEffect(() => {
    if (simActive) return
    fetchVotesByGame(today).then(setAllVotes)
  }, [today, simActive])

  // Votes shown across the widget: the fabricated splits in sim mode, else real.
  const displayVotes = simActive ? devSim.votes : allVotes

  // Look up the user's chosen username (from the `usernames` table) so the
  // predictions leaderboard shows it instead of the email prefix.
  useEffect(() => {
    if (!user) { setUsername(null); return }
    supabase.from('usernames').select('username').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setUsername(data?.username ?? null))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) {
      loadPredsFromSb(user.id, today)
        .then(serverPreds => {
          if (Object.keys(serverPreds).length > 0) {
            setPredictions(serverPreds)
          } else {
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

  useEffect(() => {
    if (!modalOpen) return
    if (simActive) return  // don't let the real schedule/votes clobber the sim slate
    // Fetch votes immediately when modal opens
    fetchVotesByGame(today).then(setAllVotes)
    const id = setInterval(() => {
      fetchTodayGames(today).then(updated =>
        setGames(prev => updated.map(u => ({
          ...u,
          home: { ...u.home, pitcher: u.home.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.home.pitcher ?? null },
          away: { ...u.away, pitcher: u.away.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.away.pitcher ?? null },
        })))
      )
      fetchVotesByGame(today).then(setAllVotes)
    }, 3 * 60_000)
    return () => clearInterval(id)
  }, [modalOpen, today, simActive])

  const handlePick = useCallback((gamePk: number, teamId: number) => {
    const g = games.find(g => g.gamePk === gamePk)
    if (!g || g.state !== 'preview') return
    const prevTeamId = predictions[gamePk]
    setPredictions(prev => ({ ...prev, [gamePk]: teamId }))
    // Optimistically update vote counts
    setAllVotes(prev => {
      const gameV = { ...(prev[gamePk] ?? {}) }
      if (prevTeamId && prevTeamId !== teamId) gameV[prevTeamId] = Math.max(0, (gameV[prevTeamId] ?? 1) - 1)
      if (user) gameV[teamId] = (gameV[teamId] ?? 0) + (prevTeamId ? 0 : 1)  // only add if first pick
      return { ...prev, [gamePk]: gameV }
    })
    saveLocalPred(today, gamePk, teamId)
    if (user) savePredToSb(user.id, today, gamePk, teamId).then(() => fetchVotesByGame(today).then(setAllVotes))
  }, [games, predictions, today, user])

  const pickedCount       = Object.keys(predictions).length
  const finalized         = games.filter(g => g.state === 'final' && predictions[g.gamePk] !== undefined)
  const correctCount      = finalized.filter(g => predictions[g.gamePk] === g.winnerId).length
  const pct               = finalized.length ? Math.round(correctCount / finalized.length * 100) : null
  // Predicted games not yet decided — "N to go" once results start coming in.
  const pendingPicked     = games.filter(g => g.state !== 'final' && predictions[g.gamePk] !== undefined).length
  const previewGames      = games.filter(g => g.state === 'preview')
  const previewCount      = previewGames.length
  const pickedPreviewCount = previewGames.filter(g => predictions[g.gamePk] !== undefined).length
  const remainingCount    = previewCount - pickedPreviewCount
  const allDone           = games.length > 0 && games.every(g => g.state === 'final')
  const canOpen           = !loading && games.length > 0
  const quickPicks        = previewGames.slice(0, 3)   // up to 3 open matchups to pick inline

  return (
    <>
      <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark), bgcolor: 'background.paper', overflow: 'hidden' }}>
        <Box sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {!loading && remainingCount > 0 && (
              <Box sx={{
                width: 7, height: 7, borderRadius: '50%', bgcolor: ACCENT, flexShrink: 0,
                animation: 'predPulse 1.6s ease-in-out infinite',
                '@keyframes predPulse': {
                  '0%, 100%': { boxShadow: `0 0 0 0 ${ACCENT}59`, opacity: 1 },
                  '50%':      { boxShadow: `0 0 0 5px ${ACCENT}00`, opacity: 0.65 },
                },
              }} />
            )}
            <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1.5, color: ACCENT }}>
              🎯 Predictions
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
            {user && (
              <Box
                onClick={() => setStatsOpen(true)}
                sx={{
                  fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
                  px: 1.25, py: 0.5, borderRadius: 999,
                  border: '1px solid', borderColor: 'divider',
                  cursor: 'pointer', transition: 'all 0.12s',
                  '&:hover': { bgcolor: 'action.hover', borderColor: `${ACCENT}40`, color: ACCENT },
                  whiteSpace: 'nowrap',
                }}
              >
                📊 Stats
              </Box>
            )}
            <Box
              onClick={() => canOpen && setModalOpen(true)}
              sx={{
                fontSize: '0.68rem', fontWeight: 700,
                color: canOpen ? ACCENT : 'text.disabled',
                px: 1.5, py: 0.5, borderRadius: 999,
                border: '1px solid',
                borderColor: canOpen ? `${ACCENT}40` : 'divider',
                cursor: canOpen ? 'pointer' : 'default',
                transition: 'background 0.12s',
                '&:hover': canOpen ? { bgcolor: `${ACCENT}15` } : {},
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? '…' : pickedCount === 0 ? 'Make Predictions' : 'View Picks'}
            </Box>
          </Box>
        </Box>

        {/* Summary line — click to open the modal */}
        <Box
          onClick={() => canOpen && setModalOpen(true)}
          sx={{
            px: 2.5, py: 1.5,
            cursor: canOpen ? 'pointer' : 'default',
            transition: 'background 0.12s',
            '&:hover': canOpen ? { bgcolor: 'action.hover' } : {},
          }}
        >
          {loading ? (
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Loading today's schedule…</Typography>
          ) : games.length === 0 ? (
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>No games today</Typography>
          ) : finalized.length > 0 && !allDone ? (
            // Results are coming in — lead with the running record + how many are left.
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: correctCount / finalized.length >= 0.5 ? '#22c55e' : '#ef4444', fontWeight: 800 }}>
                {correctCount} / {finalized.length}
              </Box>
              {' '}correct
              {pendingPicked > 0 && (
                <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, fontSize: '0.78rem' }}>
                  {' '}· {pendingPicked} to go
                </Box>
              )}
            </Typography>
          ) : previewCount > 0 && remainingCount > 0 ? (
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: ACCENT, fontWeight: 800 }}>{remainingCount}</Box>
              {' '}{remainingCount === 1 ? 'game' : 'games'} left to predict
              {pickedPreviewCount > 0 && (
                <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, fontSize: '0.78rem' }}>
                  {' '}· {pickedPreviewCount}/{previewCount} done
                </Box>
              )}
            </Typography>
          ) : previewCount > 0 ? (
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: '#22c55e', fontWeight: 800 }}>✓</Box>
              {' '}All {previewCount === 1 ? 'prediction' : 'predictions'} made
            </Typography>
          ) : allDone && finalized.length > 0 ? (
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: correctCount / finalized.length >= 0.5 ? '#22c55e' : '#ef4444', fontWeight: 800 }}>
                {correctCount} / {finalized.length}
              </Box>
              {' '}correct
              {pct !== null && (
                <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, fontSize: '0.78rem' }}>
                  {' '}· {pct}%
                </Box>
              )}
            </Typography>
          ) : (
            <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>
              {games.some(g => g.state === 'live') ? 'Games in progress' : 'All games finished'}
            </Typography>
          )}
        </Box>

        {/* Inline quick picks — up to 3 open matchups, tap a logo to pick right here */}
        {!loading && quickPicks.length > 0 && (
          <Box sx={{ px: 2.5, pb: 1.75, pt: 0.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {quickPicks.map(g => (
              <QuickPickRow
                key={g.gamePk}
                game={g}
                prediction={predictions[g.gamePk] ?? null}
                gameVotes={displayVotes[g.gamePk]}
                onPick={teamId => handlePick(g.gamePk, teamId)}
              />
            ))}
            {games.length > quickPicks.length && (
              <Box
                onClick={() => canOpen && setModalOpen(true)}
                sx={{
                  alignSelf: 'center', mt: 0.4, px: 1, py: 0.3,
                  fontSize: '0.68rem', fontWeight: 700, color: ACCENT,
                  cursor: 'pointer', borderRadius: 999,
                  '&:hover': { bgcolor: `${ACCENT}12` },
                }}
              >
                View all {games.length} games →
              </Box>
            )}
          </Box>
        )}
      </Box>

      <PredictorModal
        open={modalOpen}
        games={games}
        predictions={predictions}
        allVotes={displayVotes}
        onPick={handlePick}
        onClose={() => setModalOpen(false)}
        isSignedIn={!!user}
      />

      <PredictionStatsModal
        open={statsOpen}
        userId={user?.id}
        displayName={username ?? user?.email?.split('@')[0] ?? 'Anonymous'}
        onClose={() => setStatsOpen(false)}
      />
    </>
  )
}
