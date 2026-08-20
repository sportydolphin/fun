import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblGameLive, LIVE_POLL_MS } from './api'
import { wpblAccent, wpblFullName } from './constants'
import { TeamBadge, useWpblDark } from './ui'
import type { WpblTeam, WpblGame, WpblLiveState } from './types'

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
  useEffect(() => { setGame(seed) }, [seed.id, seed.status, seed.updated_at])
  useEffect(() => {
    if (seed.status !== 'live') return
    let cancelled = false
    // Merge rather than replace: the fetch returns only the columns that can move during a
    // game, so everything it omits is already correct in the row we hold.
    const refresh = () => fetchWpblGameLive(seed.id)
      .then(delta => { if (!cancelled && delta) setGame(prev => ({ ...prev, ...delta })) })
    const poll = setInterval(refresh, LIVE_POLL_MS)
    const ch = supabase.channel(`wpbl-game-${seed.id}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_games', filter: `id=eq.${seed.id}` }, refresh)
      .subscribe()
    return () => { cancelled = true; clearInterval(poll); supabase.removeChannel(ch) }
  }, [seed.id, seed.status])
  return game
}

// ─── Situation derivation ──────────────────────────────────────────────────────
interface Situation {
  half: 'top' | 'bottom'; inning: number; outs: number; balls: number; strikes: number
  battingTeam: WpblTeam; batterName: string | null; pitcherName: string | null
  first: boolean; second: boolean; third: boolean
}

export function deriveSituation(state: WpblLiveState, away: WpblTeam, home: WpblTeam): Situation {
  const half = state.half === 'bottom' ? 'bottom' : 'top'
  return {
    half, inning: state.inning || 1, outs: state.outs || 0, balls: state.balls || 0, strikes: state.strikes || 0,
    battingTeam: half === 'top' ? away : home,
    batterName: state.batter_name || null, pitcherName: state.pitcher_name || null,
    first: !!state.first_base, second: !!state.second_base, third: !!state.third_base,
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
export function LiveBanner({ state, away, home }: { state: WpblLiveState; away: WpblTeam; home: WpblTeam }) {
  const isDark = useWpblDark()
  const s = deriveSituation(state, away, home)
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <SituationStrip s={s} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {s.batterName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box></Typography>}
        {s.pitcherName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box></Typography>}
      </Box>
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
  const s = game.live_state ? deriveSituation(game.live_state, away, home) : null

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
          '&:hover': { bgcolor: '#dc2626' },
        }}>Game Center →</Box>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
          {scoreRow(away, game.away_score ?? 0, s?.battingTeam.id === away.id)}
          {scoreRow(home, game.home_score ?? 0, s?.battingTeam.id === home.id)}
        </Box>
        {s && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: { xs: 'flex-start', sm: 'flex-end' }, pl: { sm: 2 }, borderLeft: { sm: '1px solid' }, borderColor: { sm: 'divider' } }}>
            <SituationStrip s={s} />
            <Box sx={{ textAlign: { sm: 'right' } }}>
              {s.batterName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(s.batterName)}</Box></Typography>}
              {s.pitcherName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(s.pitcherName)}</Box></Typography>}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
