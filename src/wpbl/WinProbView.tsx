import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays } from './api'
import {
  buildWinProbModel, gameWinProb, fmtWinPct, type GameWinProb, type WinProbPoint,
} from './derive/winProbability'
import { parsePlay } from './derive/playByPlay'
import { wpblAccent, wpblFullName } from './constants'
import { CARD_BORDER, TapTip, useWpblDark } from './ui'
import { ExperimentalChip } from '../ExperimentsContext'
import type { WpblGame, WpblGamePlay, WpblRunValuePlay, WpblTeam } from './types'

/**
 * The shape of a game: win probability from the first pitch to the last out, and the one play
 * that moved it furthest.
 *
 * WHY A CHART AND NOT A NUMBER. Win probability at a moment is a stat; win probability over a
 * game is a story, and the story is the part a fan wants. A line that sits flat at 80% for
 * six innings and then falls off a cliff needs no explaining to anybody, which is more than
 * can be said for most of what this section computes.
 *
 * The model is in derive/winProbability.ts, built from the league's own plays. It knows
 * nothing about who is pitching, and it is measured on 263 half-innings, both of which the
 * caption says out loud.
 */

/**
 * The model, kept between games.
 *
 * Building it is a few hundred thousand multiply-adds, which is milliseconds and would be
 * fine to redo. What would not be fine is doing it inside a modal that opens and closes all
 * evening while the input never changes: the league's play log is one cached array for the
 * whole session, so its identity is the only cache key needed.
 */
let cachedModel: { plays: unknown; games: unknown; model: ReturnType<typeof buildWinProbModel> } | null = null
function modelFor(plays: WpblRunValuePlay[], games: WpblGame[]) {
  if (cachedModel && cachedModel.plays === plays && cachedModel.games === games) return cachedModel.model
  const model = buildWinProbModel(plays, games)
  cachedModel = { plays, games, model }
  return model
}

/** How far a play has to move the game before it counts as the swing of it. */
const SWING_FLOOR = 0.12

/** The card's own height. Tall enough for the shape to read, short enough that the recap it
 *  sits inside is still a recap. */
const CHART_H = { xs: 150, sm: 178 }

interface Props {
  game: WpblGame
  teams: Map<string, WpblTeam>
  /** This game's plays, already loaded by Game Center. */
  plays: WpblGamePlay[]
  /** The whole schedule, not this game. The model reads the league's plays, and the only way
   *  to keep the postseason out of them is to hand it the schedule that says which is which.
   *  Passing one game would not error: the season filter excludes by the ids it KNOWS are out
   *  (see CLAUDE.md), so a partial schedule quietly lets everything through. */
  games: WpblGame[]
}

export default function WinProbView({ game, teams, plays, games }: Props) {
  // The model is league-wide, so it needs every play of the season, not this game's. The Run
  // value board fetches exactly the same list and caches it for the session, so a reader who
  // has been to Stats pays nothing here.
  const [league, setLeague] = useState<WpblRunValuePlay[] | null>(() => getCachedWpblAllRunValuePlays())
  useEffect(() => {
    if (league) return
    let cancelled = false
    fetchWpblAllRunValuePlays().then(p => { if (!cancelled) setLeague(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [league])

  const wp = useMemo<GameWinProb | null>(() => {
    if (!league || plays.length === 0) return null
    const model = modelFor(league, games.length > 0 ? games : [game])
    return gameWinProb(model, plays as WpblRunValuePlay[], game)
  }, [league, plays, game, games])

  if (!wp || wp.points.length < 2) return null
  return <WinProbCard game={game} teams={teams} wp={wp} />
}

/** Split out so the model work above stays in one place and this stays drawing. */
function WinProbCard({ game, teams, wp }: { game: WpblGame; teams: Map<string, WpblTeam>; wp: GameWinProb }) {
  const home = teams.get(game.home_team_id)
  const away = teams.get(game.away_team_id)
  // The curated foreground colours, not the primaries. Every club in this league is
  // near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), which is fine behind a logo
  // and useless for two areas that have to be told apart: the first draft of this chart drew
  // Los Angeles in pure black at 30% over a dark card. See the note on wpblAccent.
  const dark = useWpblDark()
  const homeColor = wpblAccent(game.home_team_id, dark)
  const awayColor = wpblAccent(game.away_team_id, dark)

  // The line, in a 0..100 box. `preserveAspectRatio="none"` lets it stretch to whatever width
  // the card has; the stroke is told not to stretch with it, which is the whole reason this
  // works as an SVG rather than as a canvas.
  const pts = wp.points
  const x = (i: number) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * 100)
  const y = (p: number) => (1 - p) * 100
  const line = pts.map((pt, i) => `${x(i).toFixed(3)},${y(pt.before).toFixed(3)}`)
  // The last point is the result, not another state, so the line is walked to it explicitly.
  line.push(`100,${y(pts[pts.length - 1].after).toFixed(3)}`)

  const homeFill = `M0,100 L${line.join(' L')} L100,100 Z`
  const awayFill = `M0,0 L${line.join(' L')} L100,0 Z`

  // One span per inning, so the chart can be READ against the game rather than just looked
  // at. A rule every time the inning changes was already here and told a reader nothing: the
  // swing sentence says "in the 6th" and there was no way to find the 6th. Both halves of an
  // inning are consecutive in play order, so grouping by the inning number gives one span.
  const innings: { inning: number; from: number; to: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    const last = innings[innings.length - 1]
    if (last && last.inning === pts[i].play.inning) last.to = x(i)
    else innings.push({ inning: pts[i].play.inning, from: x(i), to: x(i) })
  }
  if (innings.length > 0) innings[innings.length - 1].to = 100

  // The marker sits where the swing LANDED, which is the next play's position. Clamped,
  // because in a game decided on the last play, which is the one worth marking, the next
  // position is off the right edge and the dot would simply not be drawn.
  // The play that won it where there is a winner, and the most volatile one while a game is
  // still being played. The marker and the sentence name the same play, or the dot points at
  // one moment while the text describes another.
  //
  // BOTH GO AWAY IN A ROUT, because in a rout there was no swing. Nothing decided the 17-3 on
  // Aug 14, so the largest play in it moved the game eight points and calling that the swing
  // of the game is dressing up the biggest of a hundred small things. The four games this
  // drops the line from were all decided by five runs or more; every one it keeps was decided
  // by four or fewer. The chart above says "it was over early" perfectly well on its own.
  const decisive = wp.decisive ?? wp.biggest
  const biggest = decisive && Math.abs(decisive.swing) >= SWING_FLOOR ? decisive : null
  const bigIdx = biggest ? pts.indexOf(biggest) : -1
  const bigX = bigIdx >= 0 ? Math.min(x(bigIdx + 1), 100) : 0

  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      {/* One row, and the method is not in it. Three lines of "who is pitching is invisible to
          it" under a 132px chart spent more of a phone screen on a disclaimer than on the
          thing being disclaimed. It is a tap away on the ⓘ, which is where a caveat belongs
          once the chip beside it has already said the board is provisional. */}
      <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>Win probability</Typography>
        <TapTip
          title="Worked out from this league's own play-by-play. It reads the situation only: who is pitching, who is up, and how the two clubs have played all season are invisible to it."
          sx={{
            width: 16, height: 16, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid', borderColor: 'text.disabled', color: 'text.disabled',
            fontSize: '0.6rem', fontWeight: 800, lineHeight: 1,
          }}
        >i</TapTip>
        <Box sx={{ ml: 'auto' }}><ExperimentalChip /></Box>
      </Box>

      <Box sx={{ position: 'relative', height: CHART_H }}>
        <Box component="svg" viewBox="0 0 100 100" preserveAspectRatio="none"
          aria-hidden sx={{ display: 'block', width: '100%', height: '100%' }}>
          {/* The two territories. Whichever side of the line you are on is the share of the
              game that team held, which is the one thing about this chart nobody has to be
              taught. */}
          <path d={awayFill} fill={awayColor} opacity={0.3} />
          <path d={homeFill} fill={homeColor} opacity={0.3} />
          {innings.slice(1).map(iv => (
            <line key={iv.inning} x1={iv.from} x2={iv.from} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
              vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={100} y1={50} y2={50}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke" />
          <polyline points={line.join(' ')} fill="none"
            stroke="currentColor" strokeOpacity={0.85} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </Box>

        {/* The marker is an HTML dot, not an SVG circle, and that is not a preference. The box
            is stretched to the card's width by `preserveAspectRatio="none"`, and while the
            line can opt out of that for its stroke, a circle cannot opt out of it for its
            shape: it comes out an ellipse two and a half times wider than it is tall. Nudged
            off the very corner so a dot on the last play of the game is not half-clipped. */}
        {bigIdx >= 0 && (
          <Box aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(bigX, 2), 98)}%`,
            top: `${Math.min(Math.max(y(pts[bigIdx].after), 6), 94)}%`,
            transform: 'translate(-50%, -50%)',
            width: 9, height: 9, borderRadius: '50%',
            bgcolor: 'var(--wpbl-accent-solid)',
            border: '2px solid', borderColor: 'background.paper',
            pointerEvents: 'none',
          }} />
        )}

        {/* The club names sit on their own halves rather than in a legend, so the chart needs
            no key: the top of the box is the away team's and the bottom is the home team's.
            The midline is labelled once, on the right, where the line has almost always left
            the middle by the end: without it the chart has a shape and no scale. */}
        <Label sx={{ top: 4, left: 6 }}>{away?.abbr ?? 'AWAY'}</Label>
        <Label sx={{ bottom: 4, left: 6 }}>{home?.abbr ?? 'HOME'}</Label>
        <Label sx={{ top: '50%', right: 6, transform: 'translateY(-50%)', opacity: 0.75 }}>50%</Label>
      </Box>

      {/* Innings, under their own stretch of the chart. Numbered wherever two labels will not
          collide, which is a lower bar than it sounds: a digit at this size is about 5px and a
          375px card gives 3.5% of its width 12px to put it in. The first cut at 7% looked
          reasonable and quietly dropped the SEVENTH from a game the home team won without
          batting in it, which is the one inning a reader most wants to find. */}
      <Box aria-hidden sx={{ position: 'relative', height: 15, mt: '2px' }}>
        {innings.filter(iv => iv.to - iv.from >= 3.5).map(iv => (
          <Typography key={iv.inning} sx={{
            position: 'absolute', left: `${(iv.from + iv.to) / 2}%`, transform: 'translateX(-50%)',
            fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1,
          }}>{iv.inning}</Typography>
        ))}
      </Box>

      {biggest && (
        <Box sx={{ px: 1.5, py: 1.25, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{
            fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
            color: 'var(--wpbl-accent-fg)', mb: 0.25,
          }}>Swing of the game</Typography>
          <Typography sx={{ fontSize: '0.85rem', lineHeight: 1.45 }}>{swingSentence(biggest, game, teams)}</Typography>
        </Box>
      )}
    </Box>
  )
}

function Label({ children, sx }: { children: React.ReactNode; sx: object }) {
  return (
    <Typography sx={{
      position: 'absolute', fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.5,
      color: 'text.secondary', pointerEvents: 'none', ...sx,
    }}>{children}</Typography>
  )
}

/**
 * "Los Angeles Queens went from 62% to 89% when Jamie Mackay singled up the middle, 2 RBI."
 *
 * THE SUBJECT IS THE TEAM THIS PLAY WAS GOOD FOR, which is nearly always the team that won,
 * since `decisive` picks the biggest swing their way. Told from the batting team's side
 * instead, a game-ending out came out as "Boston went from 24% to 0%", which is true and
 * reads as an obituary rather than as the play of the game.
 *
 * "When" rather than making the player the subject, because the two do not always share a
 * club: the play that wins a game is sometimes an out made by the team that lost it, and
 * "New York went from 76% to 100% when Geldenhuis grounded out" is a sentence, while
 * "Geldenhuis grounded out and New York went to 100%" reads as though she did it for them.
 */
function swingSentence(pt: WinProbPoint, game: WpblGame, teams: Map<string, WpblTeam>): string {
  const p = pt.play
  // A positive swing is the home team's gain, by the model's convention.
  const gainer = pt.swing >= 0 ? game.home_team_id : game.away_team_id
  const homeSide = gainer === game.home_team_id
  const before = homeSide ? pt.before : 1 - pt.before
  const after = homeSide ? pt.after : 1 - pt.after
  const t = teams.get(gainer)
  const club = t ? wpblFullName(t) : (homeSide ? 'The home team' : 'The visitors')
  const parsed = parsePlay(p.narrative ?? '', p.batter_name, x => x)
  const what = parsed.what || p.narrative || 'the play'
  const who = p.batter_name ?? 'the batter'
  return `${club} went from ${fmtWinPct(before)} to ${fmtWinPct(after)} in the ${ordinal(p.inning)}, when ${who} ${what}.`
}

/** "6th". Innings only, so the teens never come up. */
function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
