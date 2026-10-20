import { useDark } from '../ui/useDark'
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllPitchPlays, getCachedWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, pitchQualifiers, fmtPct, type PitchCounts } from './derive/pitches'
import type { PitchProfile } from '../league/pitches'
import { BLOCK_GAP } from '../ui/playerCard'
import { wpblQualifiers } from './stats'
import { SectionHead, SECTION_CAPTION_SX, useRankInk } from './cardParts'
import { inSeason, gamesInSeason, type SeasonScope } from './season'
import type { WpblGame, WpblPitchPlay, WpblPlayer, WpblTeam } from './types'
import { typePx } from '../ui/scale'
import { TYPE_SCALE } from '../ui/card'

// The pitch profile on a player page: what the league's pitch-by-pitch log says about how this
// player pitched, or how this player hit. One component, two sides.
//
// FROM EVERY GAME, which is the point of it. The pitch-location plot it replaces on most pages is
// built from the league's radar, which reached the first couple of games and stopped; the
// pitch-by-pitch codes (ball, called strike, whiff, foul, in play) are in the play log for every
// plate appearance of the season. The numbers are the Pitches board's (derive/pitches.ts), read
// for one player.
//
// NOT RANKED. Each tile carried "league 12% · 7th of 16", three facts under one figure, on a card
// that already ranks the season line above it. The league figure is the comparison that explains
// the number; the Pitches board is where a reader goes for the order.
//
// NO BOX AROUND IT. It sits after the game log and the matchups: the whole pitch mix against the
// league, placement by position rather than by rank, since ranking every row would bring back the
// clutter the rows replaced, and the outs in play on the ground.
//
// THE RATES LIVE IN THE SEASON'S TABLES since Oct 2026. The block used to lead with four large
// tiles (walk, strikeout, swing and contact, or the pitcher's four) and a row of extras, in a type
// of their own; they are the Plate discipline table now, in the same cells as every other rate on
// the card, and this file reads the pitches for both (usePitchProfiles).
//
// ONE MEANING PER COLOR. A row notably better than the league is the section's own blue, worse is
// amber, and an outcome with no better direction (a foul, a ball in play) is never colored at all.
// An early version lit a hitter's high whiff rate green, which read as an achievement.
//
// NOTHING HERE USES THE CLUB'S COLOR, because "better" cannot depend on which club you play
// for: the Firebells' color is red, and a pitcher's good walk rate drawn in red read as a warning.

type Side = 'pitching' | 'batting'
type Better = 'high' | 'low' | null

/** The pitch outcomes in the Pitches board's two groups, each with the direction that is good for
 *  a hitter and for a pitcher. Hit by pitch is not a row: it is 0 or 1% for nearly everyone and
 *  never the story, so it only unbalanced the grid. It is still in the counts. */
const MIX: { key: keyof PitchCounts; label: string; swung: boolean; batting: Better; pitching: Better }[] = [
  { key: 'ball', label: 'Ball', swung: false, batting: 'high', pitching: 'low' },
  { key: 'called', label: 'Called strike', swung: false, batting: 'low', pitching: 'high' },
  { key: 'swinging', label: 'Whiff', swung: true, batting: 'low', pitching: 'high' },
  { key: 'foul', label: 'Foul', swung: true, batting: null, pitching: null },
  { key: 'inplay', label: 'In play', swung: true, batting: null, pitching: null },
]

/** How far from the league a row has to be before it is marked. Three points is about where a
 *  difference stops being rounding and one short season's sample. */
const NOTABLE_POINTS = 0.03

/** Worse than the league: amber, the one warning color this section uses, in the shade that
 *  clears contrast on each theme (the light one is text on white). */
const amberFor = (dark: boolean) => (dark ? '#f59e0b' : '#b45309')

type Verdict = 'good' | 'bad' | null
function verdict(v: number | null, league: number | null, better: Better, threshold: number): Verdict {
  if (v == null || league == null || !better || Math.abs(v - league) < threshold) return null
  return (v > league) === (better === 'high') ? 'good' : 'bad'
}

/**
 * The pitch outcomes as DOT ROWS against the league: one row per outcome, the player a dot and the
 * league a tick on the same line.
 *
 * NOT A PAIR OF STACKED BARS, which is what this replaced. Two stacked bars only share their left
 * end, so every segment after the first starts somewhere different on each and cannot be compared
 * by eye, and six shades needed a legend to decode. Here every comparison is made in place, on one
 * axis, with the label on the row.
 */
function MixRows({ me, league, side, better, amber }: {
  me: PitchCounts; league: PitchCounts; side: Side; better: string; amber: string
}) {
  // Shares of EVERY pitch, hit-by-pitch included, so a row reads the same as the Pitches board.
  const total = (c: PitchCounts) => c.ball + c.called + c.hbp + c.swinging + c.foul + c.inplay
  const tMe = total(me), tLg = total(league)
  if (tMe === 0 || tLg === 0) return null
  // One scale for every row, set by the largest share on either side, so a row's position means
  // the same thing as its neighbour's. A little headroom keeps the biggest dot off the track's end.
  const max = Math.max(...MIX.flatMap(m => [me[m.key] / tMe, league[m.key] / tLg])) * 1.1
  const group = (swung: boolean) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'text.disabled', mb: 0.25 }}>
        {swung ? 'Swung at' : 'Taken'}
      </Typography>
      {MIX.filter(m => m.swung === swung).map(m => {
        const v = me[m.key] / tMe, lg = league[m.key] / tLg
        const call = verdict(v, lg, m[side], NOTABLE_POINTS)
        const ink = call === 'good' ? better : call === 'bad' ? amber : null
        return (
          <Box key={m.key} role="img"
            aria-label={`${m.label}: ${fmtPct(v, 0)}, league ${fmtPct(lg, 0)}${call === 'good' ? ', better than the league' : call === 'bad' ? ', worse than the league' : ''}`}
            sx={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0, 1fr) 2.25rem', alignItems: 'center', columnGap: 1, height: '1.35rem' }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap' }}>{m.label}</Typography>
            <Box sx={{ position: 'relative', height: '2px', bgcolor: 'divider' }}>
              {/* The league, as a tick the dot can sit on. */}
              <Box sx={{ position: 'absolute', top: '50%', left: `${(lg / max) * 100}%`, width: '2px', height: 12, bgcolor: 'text.disabled', transform: 'translate(-50%, -50%)' }} />
              {/* Worse than the league is a RING, not only a color, so the verdict survives a
                  reader who cannot tell amber from the club's green. */}
              <Box sx={{
                position: 'absolute', top: '50%', left: `${(v / max) * 100}%`, width: 10, height: 10, borderRadius: '50%',
                transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
                ...(call === 'bad'
                  ? { border: `2px solid ${amber}`, bgcolor: 'background.paper' }
                  : { bgcolor: ink ?? 'text.secondary' }),
              }} />
            </Box>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ink ?? 'text.primary' }}>
              {fmtPct(v, 0)}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
  return (
    // Taken and swung side by side from sm up, stacked on a phone.
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3, rowGap: 1 }}>
      {group(false)}
      {group(true)}
    </Box>
  )
}

/** One side of a player's pitch record and the league's, or null below the bar (see usePitchProfiles). */
export interface PitchProfilePair { me: PitchProfile<WpblPlayer>; league: PitchProfile<WpblPlayer> }

/**
 * The player's pitch record from both sides, and the league's, for the slice on the card.
 *
 * ONE READ FOR TWO BLOCKS: the plate discipline table (with the season's other tables) and the pitch
 * mix under the game log. Undefined while the play log is read, null for a side below the bar.
 *
 * THE BAR IS THE PITCHES BOARD'S, a third of it. A profile over a handful of pitches is noise wearing
 * a percentage sign, so a side under it draws neither block. The bar is a SEASON's, so the playoff
 * slice, a handful of games that the reader chose on purpose, only has to clear the 20-pitch floor.
 */
export function usePitchProfiles({ player, players, teams, games, season, scope }: {
  player: WpblPlayer
  players: WpblPlayer[]
  teams: WpblTeam[]
  /** The whole schedule, every year: `inSeason` needs it to place a play in its year. */
  games: WpblGame[]
  /** The year on the card, or null for every season (a career). */
  season: number | null
  scope: SeasonScope
}): Record<Side, PitchProfilePair | null> | undefined {
  // The card's season alone, or every season for a career. Cached app-wide and shared with the
  // Stats tab's Pitches board, so a reader who has opened either pays once.
  const [read, setRead] = useState<{ season: number | null; plays: WpblPitchPlay[] } | null>(() => {
    const cached = getCachedWpblAllPitchPlays(season)
    return cached ? { season, plays: cached } : null
  })
  useEffect(() => {
    let cancelled = false
    fetchWpblAllPitchPlays(season)
      .then(p => { if (!cancelled) setRead({ season, plays: p }) })
      // A failed read draws neither block, as a thin record does.
      .catch(() => { if (!cancelled) setRead({ season, plays: [] }) })
    return () => { cancelled = true }
  }, [season])
  const plays = read && read.season === season ? read.plays : null

  const seasonGames = useMemo(() => (season == null ? games : gamesInSeason(games, season)), [games, season])
  const board = useMemo(
    () => (plays ? aggregatePitchCodes(season == null ? plays : inSeason(plays, games, season), players, seasonGames, scope) : null),
    [plays, players, games, season, seasonGames, scope])
  const mins = useMemo(() => {
    const q = wpblQualifiers(teams, seasonGames)
    return pitchQualifiers(q.active ? q.teamGames : 0)
  }, [teams, seasonGames])

  return useMemo(() => {
    if (!board) return undefined
    const pair = (side: Side): PitchProfilePair | null => {
      const me = (side === 'pitching' ? board.pitchers : board.batters).find(p => p.player?.id === player.id)
      const min = side === 'pitching' ? mins.minPitcher : mins.minBatter
      const floor = scope === 'postseason' ? 20 : Math.max(20, min / 3)
      return me && me.pitches >= floor ? { me, league: board.league } : null
    }
    return { batting: pair('batting'), pitching: pair('pitching') }
  }, [board, mins, player.id, scope])
}

/**
 * THE PITCH MIX: every pitch seen or thrown, by outcome, against the league, and the outs in play
 * on the ground. What is left of the pitch profile once its headline rates moved into the season's
 * Plate discipline table, where they sit in the same table as every other rate on the card.
 */
export default function PitchProfileBlock({ side, profile }: {
  side: Side
  profile: PitchProfilePair | null | undefined
}) {
  const dark = useDark()
  const amber = amberFor(dark)
  // Better than the league: the section's own blue, the same for every club.
  const better = useRankInk()
  if (!profile) return null
  const { me, league } = profile
  const outs = me.groundOuts + me.airOuts
  const coverage = `${me.pitches} pitches ${side === 'pitching' ? 'to' : 'across'} ${me.pa} ${side === 'pitching' ? 'batters' : 'plate appearances'}`

  return (
    <Box sx={{ mt: BLOCK_GAP }}>
      <SectionHead title="Pitch mix" part="pitches" caption={coverage} />
      <MixRows me={me.counts} league={league.counts} side={side} better={better} amber={amber} />
      <Typography sx={{ mt: 0.5, fontSize: TYPE_SCALE.caption, color: 'text.disabled' }}>
        Share of every pitch {side === 'pitching' ? 'thrown' : 'seen'}; the tick is the league.
        {' '}<Box component="span" sx={{ color: better, fontWeight: 700 }}>Blue</Box> is better than the league,
        {' '}<Box component="span" sx={{ color: amber, fontWeight: 700 }}>amber</Box> is worse.
      </Typography>
      {/* OUTS IN PLAY, AND IT SAYS SO. A hit in the play text reads "singled to center field"
          whatever it was, so only the outs can be sorted into ground and air. See battedOutKind. */}
      {outs >= 10 && (
        <Typography sx={{ mt: 1, ...SECTION_CAPTION_SX, color: 'text.secondary' }}>
          Outs on the ground: {fmtPct(me.groundOutPct, 0)} ({me.groundOuts} of {outs}), league {fmtPct(league.groundOutPct, 0)}
        </Typography>
      )}
    </Box>
  )
}
