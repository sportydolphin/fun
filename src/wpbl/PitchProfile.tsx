import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllPitchPlays, getCachedWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, pitchQualifiers, rankBy, fmtPct, type PitchProfile, type PitchRates, type PitchCounts } from './derive/pitches'
import { wpblQualifiers } from './stats'
import { ordinal } from './percentiles'
import { useWpblDark } from './ui'
import { SectionHead, SECTION_CAPTION_SX, ShowMoreButton, useRankInk } from './cardParts'
import { inSeason, gamesInSeason, type SeasonScope } from './season'
import type { WpblGame, WpblPitchPlay, WpblPlayer, WpblTeam } from './types'

// The pitch profile on a player page: what the league's pitch-by-pitch log says about how this
// player pitched, or how this player hit. One component, two sides.
//
// FROM EVERY GAME, which is the point of it. The pitch-location plot it replaces on most pages is
// built from the league's radar, which reached the first couple of games and stopped; the
// pitch-by-pitch codes (ball, called strike, whiff, foul, in play) are in the play log for every
// plate appearance of the season. The numbers are the Pitches board's (derive/pitches.ts), read
// for one player.
//
// RANKED AGAINST THE SEASON LINE'S FIELD, NOT THE PITCHES BOARD'S. The board bars a player on
// pitches seen, the card on plate appearances or innings, so the same pitcher read "9th of 16" in
// her season line and "11th of 21" here, and a reader cannot know the two denominators are two
// different bars. On the card every "of N" is now the same N (`rankPool`); the board keeps its own
// bar, where it is the only one on the page.
//
// NO BOX AROUND IT, and only the headline on first sight. It sits after the game log and the
// matchups, set in the season line's own type (a small label, a large figure, a line under it).
// The pitch mix and the figures under it were the tallest block on the card, about 420px on a
// phone, second from the top; they are one tap down now, behind the same control as the tables.
//
// WHAT GOES WHERE, decided by what each part can say that nothing else on the page does:
//   • The headline is the RATES A FAN ALREADY READS, walks and strikeouts per plate appearance,
//     ranked, beside the two pitch rates that explain them. The season line has BB and SO only as
//     counts. A headline figure may never restate the chart under it (swing rate on a pitcher, or
//     strike rate, which is the Ball row subtracted from 100): an early version did, twice.
//   • The rows are the whole pitch mix against the league, placement by position rather than by
//     rank, since ranking every row would bring back the clutter the rows replaced.
//   • The extras are the rest that is worth a figure but not a headline slot, drawn as figures
//     (label, number, league) rather than the sentence of numbers they used to be.
//
// ONE MEANING PER COLOUR. A row notably better than the league is the section's own blue, worse is
// amber, and an outcome with no better direction (a foul, a ball in play) is never coloured at all.
// An early version lit a hitter's high whiff rate green, which read as an achievement.
//
// NOTHING HERE USES THE CLUB'S COLOUR, because "better" cannot depend on which club you play
// for: the Firebells' colour is red, and a pitcher's good walk rate drawn in red read as a warning.
// That now includes the headline ranks, which kept the club's colour until Sep 28, 2026 to match
// the season line; the season line uses the blue too now (see useRankInk), so the two still agree.

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

export default function PitchProfileBlock({ player, side, players, teams, games, season, scope, rankPool, accent }: {
  player: WpblPlayer
  side: Side
  players: WpblPlayer[]
  teams: WpblTeam[]
  /** The whole schedule, every year: `inSeason` needs it to place a play in its year. */
  games: WpblGame[]
  /** The year on the card. Plays from any other year stay out of the profile and of its league.
   *  Null only with no schedule at all, when there is no year to cut to. */
  season: number | null
  /** The page's Regular / Playoffs / Both control. Ranks only in the regular season, like the
   *  season line's: a rank over a four-game postseason is a rank over nobody. */
  scope: SeasonScope
  /** The players the season line's rate ranks are taken against, for this side. Every rank here
   *  is taken against exactly these, so the card has one "of N" (see the header). Null until the
   *  league's lines arrive, when nothing is ranked yet anyway. */
  rankPool: ReadonlySet<string> | null
  /** The card's control colour, for the disclosure. Never used on a number. */
  accent: string
}) {
  const dark = useWpblDark()
  const amber = amberFor(dark)
  // Better than the league, and a top-five rank: the section's own blue, the same for every club.
  const better = useRankInk()
  const [open, setOpen] = useState(false)
  const [plays, setPlays] = useState<WpblPitchPlay[] | null>(() => getCachedWpblAllPitchPlays())
  useEffect(() => {
    let cancelled = false
    // Cached app-wide and shared with the Stats tab's Pitches board, so a reader who has opened
    // either pays for the season's plate appearances once.
    fetchWpblAllPitchPlays().then(p => { if (!cancelled) setPlays(p) }).catch(() => { /* renders nothing */ })
    return () => { cancelled = true }
  }, [])

  const seasonGames = useMemo(() => (season == null ? games : gamesInSeason(games, season)), [games, season])
  const board = useMemo(
    () => (plays ? aggregatePitchCodes(season == null ? plays : inSeason(plays, games, season), players, seasonGames, scope) : null),
    [plays, players, games, season, seasonGames, scope])
  const pool = board ? (side === 'pitching' ? board.pitchers : board.batters) : []
  const me = pool.find(p => p.player?.id === player.id) ?? null
  const league = board?.league ?? null

  // The Pitches board's bar, spent here only on whether to draw at all.
  const minPitches = useMemo(() => {
    const q = wpblQualifiers(teams, seasonGames)
    const mins = pitchQualifiers(q.active ? q.teamGames : 0)
    return side === 'pitching' ? mins.minPitcher : mins.minBatter
  }, [teams, seasonGames, side])

  // A profile over a handful of pitches is noise wearing a percentage sign. Under a third of the
  // pitch bar the block does not draw at all. The bar is a SEASON's, so the playoff slice, a
  // handful of games that the reader chose on purpose, only has to clear the 20-pitch floor.
  const floor = scope === 'postseason' ? 20 : Math.max(20, minPitches / 3)
  if (!me || !league || me.pitches < floor) return null

  const rates = side === 'pitching' ? PITCHER_RATES : BATTER_RATES
  // Ranked when she is in the season line's qualified field. Below it the season block already
  // says how far short she is, so this adds no second note about a second bar.
  const ranked = scope === 'regular' && rankPool != null && rankPool.has(player.id)
  const field = ranked ? pool.filter(p => p.player != null && rankPool!.has(p.player.id)) : []
  const rankOf = (d: RateDef): { rank: number; of: number } | null => {
    if (!ranked || !d.better) return null
    const list = rankBy(field, d.key, 0, d.better === 'low')
    const i = list.findIndex(p => p.player?.id === player.id)
    return i < 0 ? null : { rank: i + 1, of: list.length }
  }
  const outs = me.groundOuts + me.airOuts
  const coverage = `${me.pitches} pitches ${side === 'pitching' ? 'to' : 'across'} ${me.pa} ${side === 'pitching' ? 'batters' : 'plate appearances'}`
  // The figures that are worth a number but not a headline slot. Drawn as the tiles are, one step
  // smaller and never ranked, so the whole block is one format.
  const extras: { label: string; value: string; league: string; note?: string }[] = [
    ...(side === 'pitching'
      ? [{ label: 'Two-strike putaway', value: fmtPct(me.putawayPct, 0), league: fmtPct(league.putawayPct, 0) }]
      : []),
    {
      label: side === 'pitching' ? 'Pitches per batter' : 'Pitches per PA',
      value: fmtRateFor('pitchesPerPa', me.pitchesPerPa), league: fmtRateFor('pitchesPerPa', league.pitchesPerPa),
    },
    // OUTS IN PLAY, AND IT SAYS SO. A hit in the play text reads "singled to center field"
    // whatever it was, so only the outs can be sorted into ground and air. See battedOutKind.
    ...(outs >= 10
      ? [{ label: 'Outs on the ground', value: fmtPct(me.groundOutPct, 0), league: fmtPct(league.groundOutPct, 0), note: `${me.groundOuts} of ${outs}` }]
      : []),
  ]

  return (
    <Box sx={{ mt: 2.5 }}>
      <SectionHead title={side === 'pitching' ? 'Pitch profile' : 'Plate discipline'} caption={coverage} />

      {/* Four across from sm up, two by two on a phone. A top-five rank is drawn in the rank blue
          and bold, the season line's rule, and nothing else: the headline praises, it does not
          warn. The rank reads "Nth of N" whichever way is better, as ERA does: "1st" is always
          the best, so no "fewest". */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, rowGap: 1.5, columnGap: 1 }}>
        {rates.map(d => {
          const r = rankOf(d)
          const lit = r != null && r.rank <= 5
          return (
            <Box key={d.key} title={d.hint} sx={{ textAlign: 'center', minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.label}
              </Typography>
              <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: lit ? better : 'text.primary' }}>
                {fmtRateFor(d.key, me[d.key])}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                league {fmtRateFor(d.key, league[d.key])}
                {r && <Box component="span" sx={{ color: lit ? better : 'text.secondary', fontWeight: lit ? 800 : 700 }}>
                  {' · '}{ordinal(r.rank)} of {r.of}
                </Box>}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {open && (
        <>
          <Box sx={{ mt: 1.75 }}>
            <MixRows me={me.counts} league={league.counts} side={side} better={better} amber={amber} />
            <Typography sx={{ mt: 0.5, fontSize: '0.6rem', color: 'text.disabled' }}>
              Share of every pitch {side === 'pitching' ? 'thrown' : 'seen'}; the tick is the league.
              {' '}<Box component="span" sx={{ color: better, fontWeight: 700 }}>Blue</Box> is better than the league,
              {' '}<Box component="span" sx={{ color: amber, fontWeight: 700 }}>amber</Box> is worse.
            </Typography>
          </Box>
          <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: `repeat(${extras.length}, minmax(0, 1fr))`, columnGap: 1 }}>
            {extras.map(x => (
              <Box key={x.label} sx={{ textAlign: 'center', minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled' }}>
                  {x.label}
                </Typography>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
                  {x.value}
                </Typography>
                <Typography sx={SECTION_CAPTION_SX}>
                  league {x.league}{x.note ? ` · ${x.note}` : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
      <ShowMoreButton expanded={open} onClick={() => setOpen(o => !o)} accent={accent}>
        {open ? 'Hide pitch mix' : 'Show pitch mix'}
      </ShowMoreButton>
    </Box>
  )
}

export type { PitchProfile }
