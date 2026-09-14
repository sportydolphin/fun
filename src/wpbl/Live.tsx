import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { supabase } from '../lib/supabase'
import { fetchWpblGameLive, LIVE_POLL_MS } from './api'
import { settleGame } from './gameOver'
import { useForegroundInterval } from './refresh'
import { wpblAccent, wpblFullName } from './constants'
import { canonicalFeedName } from './feedNames'
import { BaseDiamond, TeamBadge, useWpblDark, hoverOnly } from './ui'
import { betweenInnings, deriveSituation } from './derive/liveSituation'
import type { Situation, LineScores } from './derive/liveSituation'
import type { WpblTeam, WpblGame, WpblLiveState, WpblPlayer } from './types'

// The situation derivation moved to a pure module so the Discord `/live` box score can share
// it (see derive/liveSituation.ts). Re-exported here because the app and the tests import these
// names from './Live', and this is the whole of what they read.
export { betweenInnings, deriveSituation }
export type { Situation, LineScores }

// Feed-driven live views. The official feed's boxscore `status` is mirrored onto the game
// row as `live_state` by wpbl-ingest; these components render it. No hand-scoring — the
// data updates itself as the cron re-ingests, and these hooks poll + subscribe so viewers
// see it within a few seconds.

/** The section's live red. Home's scoreboard chip and the LIVE hero already use it; exported so
 *  Game Center's header can say the same thing in the same colour. */
export const LIVE_RED = '#ef4444'

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
  // Read off the merged row, not the seed, so a game that becomes provably over under the poll
  // stops being polled at once rather than at the next schedule read. See gameOver.ts.
  const live = game.status === 'live'
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
      // Settled after the merge, not before: the delta carries `status` and `live_state`, so
      // the merged row is the raw pair the rule needs, and re-running it here is what lets the
      // call be taken back if the state stops proving it. See gameOver.ts.
      if (delta) setGame(prev => (prev.id === forId ? settleGame({ ...prev, ...delta }) : prev))
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

// ─── Situation UI ──────────────────────────────────────────────────────────────
// `scale: 'none'` and not the ordinary chrome scaling, which is the one decision this call site
// makes. The strip around it is type and two raw-px lengths, with no chrome-scaled art in it at
// all, so growing the diamond alone on a desktop pulls the row apart rather than bringing it
// into line with anything. See BaseDiamond.
const MiniDiamond = (p: { first: boolean; second: boolean; third: boolean; size?: number }) =>
  <BaseDiamond {...p} scale="none" />

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

/**
 * How old the league's own data is, said quietly under the situation.
 *
 * WHY IT EXISTS. Reported from the Sep 11, 2026 semifinal: San Francisco changed pitchers and
 * the strip went on naming Jill Albayati. It was right, in the only sense this page can be
 * right. The league's boxscore still listed her as their one pitcher at 4.0 innings and had not
 * published Niki Eckert at all, so there was nothing to show; the reader was watching the
 * broadcast, which runs ahead of the stats feed. Nothing on screen let them tell "this site is
 * wrong" from "the league is a minute behind", and the first is the one people assume.
 *
 * SO IT NAMES THE FEED, NOT THE FETCH. `source_updated_at` is the league's own stamp, which is
 * the question a reader actually has. Our own `updated_at` would answer "when did we last write
 * a row", which is never what anyone wants to know and would read as fresh while the league sat
 * still.
 *
 * THE AGE HAS TO TICK ON ITS OWN. Nothing re-renders this while the feed is quiet, and a feed
 * going quiet is exactly the case it exists for, so it carries its own clock rather than
 * waiting for data that is not coming.
 */
const FEED_STALE_MS = 3 * 60_000

export function FeedAge({ at }: { at?: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useForegroundInterval(() => setNow(Date.now()), 30_000)
  if (!at) return null
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return null
  const stale = now - t > FEED_STALE_MS
  const clock = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <Typography sx={{
      fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
      color: stale ? 'var(--wpbl-medal-1)' : 'text.disabled',
    }}>
      {/* The wording carries the whole point: it is the LEAGUE that is behind, and this line is
          the only thing on the page in a position to say so. */}
      {stale ? `League feed quiet since ${clock}` : `League feed ${clock}`}
    </Typography>
  )
}

// Situation banner shown atop the Game Center (GameDetail) while a game is live.
export function LiveBanner({ state, away, home, lines, players, sourceUpdatedAt }: {
  state: WpblLiveState; away: WpblTeam; home: WpblTeam; lines?: LineScores
  /** The league's own stamp on this game (`source_updated_at`), for the age line. */
  sourceUpdatedAt?: string | null
  /** The roster, to spell the two names the way the rest of the page does. REQUIRED, and empty
   *  is a legitimate value: the caller passing nothing at all is the failure this shape exists
   *  to stop, because it looks exactly like a player whose name the feed happens to spell our
   *  way. See feedNames.ts. */
  players: WpblPlayer[]
}) {
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
          {s.batterName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(canonicalFeedName(s.batterName, players))}</Box></Typography>}
          {s.pitcherName && <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.3 }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(canonicalFeedName(s.pitcherName, players))}</Box></Typography>}
        </Box>
      )}
      {/* Last, and pushed to the end of the row: it is a caveat on everything to its left, and
          a reader who is not questioning what they see should never be stopped by it. */}
      <Box sx={{ ml: 'auto' }}><FeedAge at={sourceUpdatedAt} /></Box>
    </Box>
  )
}

// ─── Home-page LIVE hero ─────────────────────────────────────────────────────────
export function LiveHero({ game: seed, teams, players, onOpen }: {
  game: WpblGame; teams: WpblTeam[]
  /** The roster, for the same reason and on the same terms as LiveBanner's. */
  players: WpblPlayer[]
  onOpen: () => void
}) {
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
                {s.batterName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>AB </Box><Box component="span" sx={{ fontWeight: 700, color: wpblAccent(s.battingTeam.id, isDark) }}>{shortName(canonicalFeedName(s.batterName, players))}</Box></Typography>}
                {s.pitcherName && <Typography sx={{ fontSize: '0.74rem' }}><Box component="span" sx={{ color: 'text.disabled', fontWeight: 700 }}>P </Box><Box component="span" sx={{ fontWeight: 700 }}>{shortName(canonicalFeedName(s.pitcherName, players))}</Box></Typography>}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
