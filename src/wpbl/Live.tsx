import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblGameLive, LIVE_POLL_MS } from './api'
import { useForegroundInterval } from './refresh'
import { wpblAccent, wpblFullName } from './constants'
import { TeamBadge, useWpblDark, hoverOnly } from './ui'
import type { WpblTeam, WpblGame, WpblLineScoreEntry, WpblLiveState } from './types'

// Feed-driven live views. The official feed's boxscore `status` is mirrored onto the game
// row as `live_state` by wpbl-ingest; these components render it. No hand-scoring — the
// data updates itself as the cron re-ingests, and these hooks poll + subscribe so viewers
// see it within a few seconds.

const LIVE_RED = '#ef4444'

export const shortName = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  return parts.length < 2 ? name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// Poll + realtime-subscribe one game's row while it is live, so score + situation stay
// fresh. Seeded by the passed-in game; returns the freshest copy.
export function useLiveGame(seed: WpblGame): WpblGame {
  const [game, setGame] = useState(seed)
  // Unique per hook instance: the same game can be observed by two mounted hooks at once
  // (the home LiveHero and the Game Center opened over it). A shared channel topic would
  // make the second `.on(...).subscribe()` throw ("callbacks after subscribe()").
  const uid = useRef(Math.random().toString(36).slice(2)).current
  const live = seed.status === 'live'
  useEffect(() => { setGame(seed) }, [seed.id, seed.status, seed.updated_at])

  // Merge rather than replace: the fetch returns only the columns that can move during a
  // game, so everything it omits is already correct in the row we hold.
  //
  // AND ONLY ONTO THE GAME IT WAS ASKED ABOUT. A read still in flight when the observed game
  // changes used to be dropped by the enclosing effect's `cancelled` flag; a callback that
  // outlives its effect has to check for itself. Comparing against the row in state rather
  // than a ref makes it exact: the delta is only the volatile half of a row, so landing one
  // game's score on another is silent and looks entirely plausible.
  const refresh = useCallback(() => {
    const forId = seed.id
    void fetchWpblGameLive(forId).then(delta => {
      if (delta) setGame(prev => (prev.id === forId ? { ...prev, ...delta } : prev))
    })
  }, [seed.id])

  // The poll is the FALLBACK for a websocket that dropped without saying so, which is why it
  // is safe to stop it while the tab is hidden: a subscription that survives the gap pushes
  // the moment anything moves, and one that did not is caught by the pull this does on the
  // way back. See refresh.ts.
  useForegroundInterval(refresh, live ? LIVE_POLL_MS : null)

  useEffect(() => {
    if (!live) return
    const ch = supabase.channel(`wpbl-game-${seed.id}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_games', filter: `id=eq.${seed.id}` }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [seed.id, live, refresh, uid])
  return game
}

// ─── Situation derivation ──────────────────────────────────────────────────────
interface Situation {
  half: 'top' | 'bottom'; inning: number; outs: number; balls: number; strikes: number
  battingTeam: WpblTeam; batterName: string | null; pitcherName: string | null
  first: boolean; second: boolean; third: boolean
  /** The side is retired and the next one has not come to bat. */
  between: boolean
  /** What to call that gap: "Middle of the 4th" once the top is over, "End of the 4th"
   *  once the bottom is. Null while a half-inning is actually being played. */
  breakLabel: string | null
}

const ORDINAL = (n: number): string => {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * Is the game sitting between half-innings?
 *
 * Worth having because the strip has no honest reading of the break otherwise. The feed sends
 * one situation object and keeps serving the last one it built until something moves, so the
 * count, the outs, the runners and the batter it carries during the gap describe an at-bat
 * that has already finished. Drawn literally they say a game is being played.
 *
 * HOW THE BREAK IS FOUND, AND WHY IT IS NOT THE OBVIOUS WAY. The MLB feed hands over an
 * `inningState` of "Middle" or "End" and src/mlb reads it straight. This one has no such
 * field, and it has none of the substitutes either. Watched through the top of the 4th on
 * 2026-08-20 it went:
 *
 *   17:42:42  In Progress - Top of 4th     top 4   2 out  0-0  Denae Benites
 *   17:43:13  In Progress - Bottom of 4th  bottom 4  0 out  0-0  Suzuka Yamamoto
 *
 * The third out and the flip to the next half arrive in the SAME update. There is no state
 * in which the feed reports three outs, no state in which it blanks `half`, and the status
 * string only ever reads "Top of"/"Bottom of", never "Middle of"/"End of". Every signal the
 * MLB side keys on is absent, and anything built on them would simply never fire.
 *
 * What the feed does instead is announce the next half-inning the moment the last one ends
 * and then sit on it, untouched, for the length of the break: that 17:43:13 state held until
 * 17:45:55, two minutes and forty-two seconds, when the first pitch of the bottom of the 4th
 * finally registered. So the break is not a state the feed names, it is a state the feed
 * leaves EMPTY: the next half-inning is on the board and nothing has happened in it yet.
 *
 * That is what this tests for. Nobody out, no count, nobody on base, and no runs in the
 * batting side's line for the inning.
 *
 * The runs check is what makes the rest of it airtight rather than nearly right. Empty bases
 * with nobody out normally does mean nobody has batted, because every runner who leaves the
 * bases without scoring costs an out. The exception is the leadoff home run, which puts the
 * next batter up on a 0-0 count with the bases clear and no outs, and which without this
 * check would read as a break for as long as it took the next pitch to land.
 */
export function betweenInnings(state: WpblLiveState, lines?: LineScores): boolean {
  if (state.complete) return false
  const half = state.half === 'bottom' ? 'bottom' : state.half === 'top' ? 'top' : null
  if (!half) return false
  const inning = state.inning || 0
  // The top of the 1st with nothing in it is not a break, it is a game that has not started.
  // The ingest only calls a game live once something has actually happened, so this is
  // belt-and-braces, but the label for it would be "End of the 0th".
  if (inning < 1 || (inning === 1 && half === 'top')) return false
  if ((state.outs || 0) !== 0 || (state.balls || 0) !== 0 || (state.strikes || 0) !== 0) return false
  if (state.first_base || state.second_base || state.third_base) return false
  const line = (half === 'top' ? lines?.away : lines?.home) ?? []
  return !line.some(e => e.inning === inning && e.runs > 0)
}

export interface LineScores { away?: WpblLineScoreEntry[] | null; home?: WpblLineScoreEntry[] | null }

/**
 * What to call the break, which is the half-inning BEHIND the one the feed is showing.
 *
 * The feed has already moved the board on to what comes next, so the naming inverts: sitting
 * on an untouched bottom of the 4th means the top of the 4th is what just finished, which is
 * the middle of the 4th. Sitting on an untouched top of the 5th means the bottom of the 4th
 * finished, which is the end of the 4th.
 */
function breakLabelFor(half: 'top' | 'bottom', inning: number): string {
  return half === 'bottom'
    ? `Middle of the ${ORDINAL(inning)}`
    : `End of the ${ORDINAL(inning - 1)}`
}

export function deriveSituation(state: WpblLiveState, away: WpblTeam, home: WpblTeam, lines?: LineScores): Situation {
  // A blank half cannot be read as 'top' the way this used to read it: that named the away
  // team as batting whenever the feed left the half out. Fall back to the batting side the
  // feed names instead, and only then to the top of the inning.
  const half: 'top' | 'bottom' =
    state.half === 'bottom' ? 'bottom'
    : state.half === 'top' ? 'top'
    : state.batting_team_id && state.batting_team_id === home.id ? 'bottom'
    : 'top'
  const between = betweenInnings(state, lines)
  return {
    half, inning: state.inning || 1, outs: state.outs || 0, balls: state.balls || 0, strikes: state.strikes || 0,
    battingTeam: half === 'top' ? away : home,
    batterName: state.batter_name || null, pitcherName: state.pitcher_name || null,
    first: !!state.first_base, second: !!state.second_base, third: !!state.third_base,
    between,
    breakLabel: between ? breakLabelFor(half, state.inning || 1) : null,
  }
}

// ─── Situation UI ──────────────────────────────────────────────────────────────
function MiniDiamond({ first, second, third, size = 34 }: { first: boolean; second: boolean; third: boolean; size?: number }) {
  const sq = (occ: boolean, pos: object) => (
    <Box sx={{ position: 'absolute', ...pos, width: size * 0.3, height: size * 0.3, transform: 'translate(-50%,-50%) rotate(45deg)', bgcolor: occ ? '#60a5fa' : 'transparent', border: '1.5px solid', borderColor: occ ? '#60a5fa' : 'text.disabled', borderRadius: '1px' }} />
  )
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {sq(second, { left: '50%', top: '22%' })}
      {sq(third, { left: '22%', top: '50%' })}
      {sq(first, { left: '78%', top: '50%' })}
    </Box>
  )
}

export function SituationStrip({ s }: { s: Situation }) {
  // Between innings the diamond, the outs and the count are all leftovers from a half-inning
  // that is over, so the strip drops them and says which break it is instead. The arrow and
  // the inning number go with them: they would point at the half just finished, which is the
  // opposite of what a glance at a live game is asking.
  if (s.between) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'text.secondary', lineHeight: 1.2 }}>{s.breakLabel}</Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 900 }}>{s.half === 'top' ? '▲' : '▼'}</Typography>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800 }}>{s.inning}</Typography>
      </Box>
      <MiniDiamond first={s.first} second={s.second} third={s.third} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1 }}>{s.outs} out{s.outs !== 1 ? 's' : ''}</Typography>
        <Box sx={{ px: 0.7, py: '2px', borderRadius: 0.5, bgcolor: 'action.hover' }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, lineHeight: 1 }}>{s.balls}–{s.strikes}</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// Situation banner shown atop the Game Center (GameDetail) while a game is live.
export function LiveBanner({ state, away, home, lines }: { state: WpblLiveState; away: WpblTeam; home: WpblTeam; lines?: LineScores }) {
  const isDark = useWpblDark()
  const s = deriveSituation(state, away, home, lines)
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <SituationStrip s={s} />
      {/* The matchup is dropped for the length of the break rather than relabelled. The feed
          holds `batter_name` and `pitcher_name` across the gap without saying whether they are
          the pair that just finished or the pair due up next, so any label put on them here
          would be a guess, and "AB" on a player who is not batting is the one reading that is
          certainly wrong. */}
      {!s.between && (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {s.batterName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box></Typography>}
          {s.pitcherName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box></Typography>}
        </Box>
      )}
    </Box>
  )
}

// ─── Home-page LIVE hero ─────────────────────────────────────────────────────────
export function LiveHero({ game: seed, teams, onOpen }: { game: WpblGame; teams: WpblTeam[]; onOpen: () => void }) {
  const isDark = useWpblDark()
  const game = useLiveGame(seed)
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const away = byId.get(game.away_team_id)
  const home = byId.get(game.home_team_id)
  if (game.status !== 'live' || !away || !home) return null
  const s = game.live_state ? deriveSituation(game.live_state, away, home, { away: game.away_line, home: game.home_line }) : null

  const scoreRow = (t: WpblTeam, runs: number, batting: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TeamBadge team={t} size={26} />
      <Typography sx={{ flex: 1, fontSize: '0.92rem', fontWeight: 700 }}>{wpblFullName(t)}</Typography>
      {batting && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: LIVE_RED, mr: 0.5, animation: 'wpblpulse 1.5s ease-in-out infinite' }} />}
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{runs}</Typography>
    </Box>
  )

  return (
    <Box sx={{
      mb: 2, borderRadius: 3, overflow: 'hidden', position: 'relative',
      border: '1.5px solid', borderColor: `${LIVE_RED}66`, bgcolor: 'background.paper',
      boxShadow: `0 0 0 1px ${LIVE_RED}18`,
      '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75, bgcolor: `${LIVE_RED}14`, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: LIVE_RED, animation: 'wpblpulse 1.5s ease-in-out infinite' }} />
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 900, letterSpacing: 1, color: LIVE_RED, textTransform: 'uppercase' }}>Live Now</Typography>
        <Box sx={{ flex: 1 }} />
        <Box onClick={onOpen} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
          fontSize: '0.66rem', fontWeight: 800, color: '#fff', px: 1.1, py: 0.35, borderRadius: 999, bgcolor: LIVE_RED,
          ...hoverOnly({ bgcolor: '#dc2626' }),
        }}>Game Center →</Box>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
          {/* The pulsing dot marks the side at bat, so it goes out for the break along with
              the rest of the at-bat. */}
          {scoreRow(away, game.away_score ?? 0, !s?.between && s?.battingTeam.id === away.id)}
          {scoreRow(home, game.home_score ?? 0, !s?.between && s?.battingTeam.id === home.id)}
        </Box>
        {s && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: { xs: 'flex-start', sm: 'flex-end' }, pl: { sm: 2 }, borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' } }}>
            <SituationStrip s={s} />
            {/* Dropped for the length of the break, for the reason given in LiveBanner. */}
            {!s.between && (
              <Box sx={{ textAlign: { sm: 'right' } }}>
                {s.batterName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box></Typography>}
                {s.pitcherName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box></Typography>}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
