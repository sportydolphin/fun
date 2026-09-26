import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllPitchPlays, getCachedWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, pitchQualifiers, rankBy, fmtPct, type PitchProfile, type PitchRates, type PitchCounts } from './derive/pitches'
import { wpblQualifiers } from './stats'
import { ordinal } from './percentiles'
import { useWpblDark } from './ui'
import { wpblAccentFg } from './constants'
import type { SeasonScope } from './season'
import type { WpblGame, WpblPitchPlay, WpblPlayer, WpblTeam } from './types'

// The pitch profile on a player page: what the league's pitch-by-pitch log says about how this
// player pitched, or how this player hit. One component, two sides.
//
// FROM EVERY GAME, which is the point of it. The pitch-location plot it replaces on most pages is
// built from the league's radar, which reached the first couple of games and stopped; the
// pitch-by-pitch codes (ball, called strike, whiff, foul, in play) are in the play log for every
// plate appearance of the season. The numbers are the Pitches board's (derive/pitches.ts), read
// for one player, so a rank here and that board can never disagree.
//
// NO BOX AROUND IT. It sits between the season line and the game log, and it is set in the season
// line's own type (a small label, a large figure, a line under it) so it reads as that line
// continuing rather than as a new card on a page that already has plenty.
//
// WHAT GOES WHERE, decided by what each part can say that nothing else on the page does:
//   • The headline is the RATES A FAN ALREADY READS, walks and strikeouts per plate appearance,
//     ranked, beside the two pitch rates that explain them. The season line has BB and SO only as
//     counts. A headline figure may never restate the chart under it (swing rate on a pitcher, or
//     strike rate, which is the Ball row subtracted from 100): an early version did, twice.
//   • The rows are the whole pitch mix against the league, placement by position rather than by
//     rank, since ranking every row would bring back the clutter the rows replaced.
//   • The footnote is the rest that is worth a figure but not a headline slot.
//
// ONE MEANING PER COLOUR. A row notably better than the league is the section's own blue, worse is
// amber, and an outcome with no better direction (a foul, a ball in play) is never coloured at all.
// An early version lit a hitter's high whiff rate green, which read as an achievement.
//
// THE ROWS DO NOT USE THE CLUB'S COLOUR, because "better" cannot depend on which club you play
// for: the Firebells' colour is red, and a pitcher's good walk rate drawn in red read as a warning.
// The headline ranks keep the club's colour, since there it means what the season line above it
// means, a top-five rank, and the two have to agree.

type Side = 'pitching' | 'batting'
type Better = 'high' | 'low' | null

interface RateDef {
  key: keyof PitchRates
  label: string
  /** Which direction is good. Null: not ranked, because neither is (how often a hitter swings is
   *  a style, not a skill). */
  better: Better
  hint: string
}

const PITCHER_RATES: RateDef[] = [
  { key: 'kPct', label: 'Strikeout', better: 'high', hint: 'Strikeouts per batter faced' },
  { key: 'bbPct', label: 'Walk', better: 'low', hint: 'Walks per batter faced' },
  { key: 'firstStrikePct', label: '1st-pitch strike', better: 'high', hint: 'Batters whose first pitch was a strike' },
  { key: 'swStrPct', label: 'Swinging strike', better: 'high', hint: 'Pitches swung at and missed' },
]

const BATTER_RATES: RateDef[] = [
  { key: 'bbPct', label: 'Walk', better: 'high', hint: 'Walks per plate appearance' },
  { key: 'kPct', label: 'Strikeout', better: 'low', hint: 'Strikeouts per plate appearance' },
  { key: 'swingPct', label: 'Swing', better: null, hint: 'Pitches swung at' },
  { key: 'contactPct', label: 'Contact', better: 'high', hint: 'Swings that made contact, foul or fair' },
]

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

/** Worse than the league: amber, the one warning colour this section uses, in the shade that
 *  clears contrast on each theme (the light one is text on white). */
const amberFor = (dark: boolean) => (dark ? '#f59e0b' : '#b45309')

type Verdict = 'good' | 'bad' | null
function verdict(v: number | null, league: number | null, better: Better, threshold: number): Verdict {
  if (v == null || league == null || !better || Math.abs(v - league) < threshold) return null
  return (v > league) === (better === 'high') ? 'good' : 'bad'
}

const fmtRateFor = (key: keyof PitchRates, v: number | null) =>
  key === 'pitchesPerPa' ? (v == null ? '—' : v.toFixed(2)) : fmtPct(v, key === 'swStrPct' ? 1 : 0)

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
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.disabled', mb: 0.25 }}>
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
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>{m.label}</Typography>
            <Box sx={{ position: 'relative', height: '2px', bgcolor: 'divider' }}>
              {/* The league, as a tick the dot can sit on. */}
              <Box sx={{ position: 'absolute', top: '50%', left: `${(lg / max) * 100}%`, width: '2px', height: 12, bgcolor: 'text.disabled', transform: 'translate(-50%, -50%)' }} />
              {/* Worse than the league is a RING, not only a colour, so the verdict survives a
                  reader who cannot tell amber from the club's green. */}
              <Box sx={{
                position: 'absolute', top: '50%', left: `${(v / max) * 100}%`, width: 10, height: 10, borderRadius: '50%',
                transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
                ...(call === 'bad'
                  ? { border: `2px solid ${amber}`, bgcolor: 'background.paper' }
                  : { bgcolor: ink ?? 'text.secondary' }),
              }} />
            </Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ink ?? 'text.primary' }}>
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

export default function PitchProfileBlock({ player, side, players, teams, games, scope, accent }: {
  player: WpblPlayer
  side: Side
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  /** The page's Regular / Playoffs / Both control. Ranks only in the regular season, like the
   *  season line's: a rank over a four-game postseason is a rank over nobody. */
  scope: SeasonScope
  accent: string
}) {
  const dark = useWpblDark()
  const amber = amberFor(dark)
  // Better than the league: the section's own blue, the same for every club (see the header).
  const better = wpblAccentFg(dark)
  const [plays, setPlays] = useState<WpblPitchPlay[] | null>(() => getCachedWpblAllPitchPlays())
  useEffect(() => {
    let cancelled = false
    // Cached app-wide and shared with the Stats tab's Pitches board, so a reader who has opened
    // either pays for the season's plate appearances once.
    fetchWpblAllPitchPlays().then(p => { if (!cancelled) setPlays(p) }).catch(() => { /* renders nothing */ })
    return () => { cancelled = true }
  }, [])

  const board = useMemo(
    () => (plays ? aggregatePitchCodes(plays, players, games, scope) : null),
    [plays, players, games, scope])
  const pool = board ? (side === 'pitching' ? board.pitchers : board.batters) : []
  const me = pool.find(p => p.player?.id === player.id) ?? null
  const league = board?.league ?? null

  // The Pitches board's own bar, so a player ranked here is ranked there too.
  const minPitches = useMemo(() => {
    const q = wpblQualifiers(teams, games)
    const mins = pitchQualifiers(q.active ? q.teamGames : 0)
    return side === 'pitching' ? mins.minPitcher : mins.minBatter
  }, [teams, games, side])

  // A profile over a handful of pitches is noise wearing a percentage sign. Under a third of the
  // qualifying bar the block does not draw at all; between that and the bar it draws unranked,
  // with a line saying so. The bar is a SEASON's, so the playoff slice, a handful of games that
  // the reader chose on purpose, only has to clear the 20-pitch floor, and is never ranked.
  const floor = scope === 'postseason' ? 20 : Math.max(20, minPitches / 3)
  if (!me || !league || me.pitches < floor) return null

  const rates = side === 'pitching' ? PITCHER_RATES : BATTER_RATES
  const ranked = scope === 'regular' && me.pitches >= minPitches
  // ONE POOL FOR EVERY RANK: the qualified players, so every "of N" in the row is the same N. The
  // Pitches board also bars each rate on its own denominator, which is right for a leaderboard and
  // read here as four different league sizes beside a season line that has one.
  const rankOf = (d: RateDef): { rank: number; of: number } | null => {
    if (!ranked || !d.better) return null
    const list = rankBy(pool, d.key, minPitches, d.better === 'low')
    const i = list.findIndex(p => p.player?.id === player.id)
    return i < 0 ? null : { rank: i + 1, of: list.length }
  }
  const outs = me.groundOuts + me.airOuts
  const coverage = `${me.pitches} pitches ${side === 'pitching' ? 'to' : 'across'} ${me.pa} ${side === 'pitching' ? 'batters' : 'plate appearances'}`
  const footnote = [
    side === 'pitching' ? `${fmtPct(me.putawayPct, 0)} putaway with two strikes (league ${fmtPct(league.putawayPct, 0)})` : null,
    `${fmtRateFor('pitchesPerPa', me.pitchesPerPa)} pitches per ${side === 'pitching' ? 'batter' : 'plate appearance'} (league ${fmtRateFor('pitchesPerPa', league.pitchesPerPa)})`,
    // OUTS IN PLAY, AND IT SAYS SO. A hit in the play text reads "singled to center field"
    // whatever it was, so only the outs can be sorted into ground and air. See battedOutKind.
    outs >= 10 ? `${fmtPct(me.groundOutPct, 0)} of outs in play on the ground, ${me.groundOuts} of ${outs} (league ${fmtPct(league.groundOutPct, 0)})` : null,
  ].filter(Boolean)

  return (
    <Box sx={{ mt: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
          {side === 'pitching' ? 'Pitch profile' : 'Plate discipline'}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {coverage}
        </Typography>
      </Box>

      {/* Four across from sm up, two by two on a phone. Lit in the club's colour for a top-five
          rank, the season line's rule, and nothing else: the headline praises, it does not warn. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, rowGap: 1.5, columnGap: 1 }}>
        {rates.map(d => {
          const r = rankOf(d)
          const lit = r != null && r.rank <= 5
          return (
            <Box key={d.key} title={d.hint} sx={{ textAlign: 'center', minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.label}
              </Typography>
              <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: lit ? accent : 'text.primary' }}>
                {fmtRateFor(d.key, me[d.key])}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                league {fmtRateFor(d.key, league[d.key])}
                {/* "FEWEST" where lower is better: "1st of 36" for walks allowed or strikeouts made
                    otherwise reads as the most of them. */}
                {r && <Box component="span" sx={{ color: lit ? accent : 'text.secondary' }}>
                  {' · '}{ordinal(r.rank)}{d.better === 'low' ? ' fewest' : ''} of {r.of}
                </Box>}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <Box sx={{ mt: 1.75 }}>
        <MixRows me={me.counts} league={league.counts} side={side} better={better} amber={amber} />
        <Typography sx={{ mt: 0.5, fontSize: '0.6rem', color: 'text.disabled' }}>
          Share of every pitch {side === 'pitching' ? 'thrown' : 'seen'}; the tick is the league.
          {' '}<Box component="span" sx={{ color: better, fontWeight: 700 }}>Blue</Box> is better than the league,
          {' '}<Box component="span" sx={{ color: amber, fontWeight: 700 }}>amber</Box> is worse.
        </Typography>
      </Box>

      <Typography sx={{ mt: 1.25, fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1.6 }}>
        {footnote.join(' · ')}
      </Typography>

      {!ranked && scope === 'regular' && (
        <Typography sx={{ mt: 0.5, fontSize: '0.62rem', color: 'text.disabled' }}>
          Not ranked: under the {minPitches}-pitch bar for {side === 'pitching' ? 'pitchers' : 'hitters'}.
        </Typography>
      )}
    </Box>
  )
}

export type { PitchProfile }
