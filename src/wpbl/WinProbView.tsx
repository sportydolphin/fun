import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays } from './api'
import {
  buildWinProbModel, gameWinProb, fmtWinPct, type GameWinProb, type WinProbPoint,
} from './derive/winProbability'
import { parsePlay } from './derive/playByPlay'
import { wpblAccent } from './constants'
import { CARD_BORDER, TapTip, useWpblDark, useWpblName } from './ui'
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

/** The inning axis: the row of numbers, and the word saying what they are. */
const AXIS_H = 15
const AXIS_LABEL_H = 12

/**
 * The caption's height, reserved from the first paint and never negotiated afterwards.
 *
 * This card sits at the top of the recap, so every pixel it gains late pushes the rest of the
 * tab down, and it gains them a second or two late by construction: it needs the league's
 * whole play log, not this game's. Reserving the chart alone got the jump from 310px down to
 * 101px, which is still the recap visibly lurching once the model lands.
 *
 * So the readout is a fixed box, and it always has something in it: an empty reserved gap
 * reads as something that failed to load.
 *
 * A FIXED height rather than a fitted one, because the text changes under a moving finger and
 * a box that resized as it did would be the one thing this card must never do. That is also
 * why the play is one line and not two: the height has to be the worst case, so every game
 * pays for the longest sentence any game could produce.
 *
 * IN REM, and that is the whole of the bug it used to have. It was 64 raw pixels, "measured at
 * 375px", and it reserves room for three rows of TYPE, which is the one thing CLAUDE.md says
 * must not be sized in px: the section is drawn a quarter larger from `md` up and the reader
 * can add another eighth on top of that, and this box did not move for either. It did not
 * clip, which is why it survived a rebuild. It is a flex column with a fixed height, so what
 * it did instead was CRUSH THE MIDDLE ROW, and the middle row is the play.
 *
 * Measured on the Aug 30 Firebells game, the play's line went from the 25px it needs down to
 * 9px on a desktop, and to 4px with Large text on. Not clipped at the edge, cut in half
 * lengthways: the reader sees the top third of the letters and cannot read the sentence, which
 * is the entire thing the chart is scrubbed for. The label row above it and the note below it
 * both looked perfect throughout, because `mt: auto` on the note pins the two ends and leaves
 * the slack, or the deficit, to whatever is between them.
 *
 * 4.25rem, not 4. The natural height is a shade under 4rem at every scale measured (4.00 on a
 * phone, 3.89 at Large text, 4.00 on a desktop, 3.87 at both), which means 4rem would fit by
 * nothing at all, and fitting by nothing at all is how this got here. The extra quarter is 4px
 * on a phone and it is the difference between a rule and a coincidence.
 */
const CAPTION_H = '4.25rem'

/** The plot's own height. Tall enough for the shape to read, short enough that the recap it
 *  sits inside is still a recap. The phone figure pays for the readout above it: Game Center
 *  is a sheet, and the card only gets about 220px of it before the fold. */
const CHART_H = { xs: 132, sm: 178 }

/**
 * Reading the chart with a finger.
 *
 * A press has to be told apart from the start of a scroll, because this card is 150px of a tab
 * people scroll through, and swallowing that gesture would be a far worse bug than the feature
 * is a feature. So a touch commits to scrubbing only once it has HELD still for `HOLD_MS`, or
 * moved sideways past `SLOP_PX`; a finger heading up or down the page is let go of instantly.
 *
 * `LINGER_MS` is why the readout does not vanish on release: lifting a finger is how you stop
 * covering the chart, not a statement that you are done reading. It also lets a plain tap ask
 * the question, since a tap is a hold that ended early.
 */
const HOLD_MS = 220
const SLOP_PX = 8
const LINGER_MS = 2600

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

  // NOTHING HERE IS ALLOWED TO CHANGE HEIGHT ONCE IT HAS PAINTED. This card sits at the top
  // of the recap, so anything that arrives late pushes the rest of the tab down, and it
  // arrives late by construction: it needs the league's entire play log, not this game's. So
  // the frame is drawn immediately, at exactly the size it will end up, and the chart is
  // filled in underneath it. The alternative, and what this used to do, was render nothing
  // for a second and then shove the whole recap down the screen.
  if (league === null) return <WinProbFrame game={game} teams={teams} />
  if (!wp || wp.points.length < 2) return null
  return <WinProbCard game={game} teams={teams} wp={wp} />
}

/** The card before its data: the real header, and an empty chart of the real height. */
function WinProbFrame({ game, teams }: { game: WpblGame; teams: Map<string, WpblTeam> }) {
  const home = teams.get(game.home_team_id)
  const away = teams.get(game.away_team_id)
  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      <CardHeader />
      {/* Same order and the same boxes as the real card, or the recap moves when the model
          lands. The readout's box is reserved even though the frame has nothing to put in it. */}
      <Box sx={{ height: CAPTION_H, mb: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
      <Box sx={{ position: 'relative', height: CHART_H }}>
        <Box aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          borderTop: '1px dashed', borderColor: 'divider', opacity: 0.6,
        }} />
        <Label sx={{ top: 4, left: 6 }}>{away?.abbr ?? 'AWAY'}</Label>
        <Label sx={{ bottom: 4, left: 6 }}>{home?.abbr ?? 'HOME'}</Label>
      </Box>
      <Box sx={{ height: AXIS_H, mt: '2px' }} />
      <Box sx={{ height: AXIS_LABEL_H }} />
    </Box>
  )
}

/** Shared by the frame and the card, so the two can never disagree about the header. */
function CardHeader() {
  return (
    <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>Win probability</Typography>
      <TapTip
        title="Each team's chance of winning from the current inning, score, outs and runners. Built from this league's own plays. It doesn't know who's pitching, who's up, or how the clubs have played all season."
        sx={{
          width: 16, height: 16, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid', borderColor: 'text.disabled', color: 'text.disabled',
          fontSize: '0.6rem', fontWeight: 800, lineHeight: 1,
        }}
      >i</TapTip>
    </Box>
  )
}

/**
 * Which play the reader is pointing at, or null when they are not pointing at one.
 *
 * TOUCH IS HAND-ROLLED AND NATIVE, for two reasons that both matter. React registers
 * `touchmove` on its root as PASSIVE, so `preventDefault` from an `onTouchMove` prop is
 * ignored with a console warning, and once the scrub has engaged it must stop the pane
 * scrolling under the finger. And the gesture has to be claimed before the browser starts
 * scrolling: after a native scroll is under way, nothing can call it back.
 *
 * The tab pager is the other half of this. It owns horizontal drags everywhere inside Game
 * Center, so a drag across the chart used to page to the box score; `data-swipe-lock` on the
 * plot (see SwipeableViews) is what hands this gesture back.
 *
 * Mouse and keyboard come in as ordinary React props, since neither needs any of the above:
 * a pointer is already unambiguous, and arrow keys make the chart readable without a
 * pointer at all.
 */
function useChartScrub(count: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState<number | null>(null)

  const at = useCallback((clientX: number) => {
    const el = ref.current
    if (!el || count < 2) return
    const r = el.getBoundingClientRect()
    // The inverse of the chart's own x(): the plot spans the full width, evenly per play.
    const i = Math.round(((clientX - r.left) / Math.max(r.width, 1)) * (count - 1))
    setIndex(Math.min(count - 1, Math.max(0, i)))
  }, [count])

  const step = useCallback((by: number) => {
    setIndex(i => {
      if (count < 2) return null
      const next = i == null ? (by > 0 ? 0 : count - 1) : i + by
      return Math.min(count - 1, Math.max(0, next))
    })
  }, [count])

  // The live gesture, in a ref rather than in state: the move handler runs on every frame of
  // a drag and must not wait on a render to know what the last one decided.
  const g = useRef({ x: 0, y: 0, hold: 0, linger: 0, engaged: false, live: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = g.current
    const dropHold = () => { window.clearTimeout(s.hold); s.hold = 0 }

    /**
     * Take the gesture, from the browser AND from the two handlers above this one.
     *
     * `preventDefault` alone only stops the SCROLL. Game Center is a bottom sheet, and
     * `useSheetDrag` reads touchmove on the sheet itself to let a downward drag throw it off
     * the screen: it bails on a horizontal drag and on a scroller that has somewhere to go,
     * neither of which describes a finger held on this chart, so a hold-then-drag-down was
     * dismissing the whole modal while the reader thought they were reading it. Preventing
     * the default does nothing about that, because that handler is JavaScript and not the
     * browser. Stopping the event from reaching it does.
     *
     * Only ever from an ENGAGED scrub, which is a deliberate hold or a sideways drag. A touch
     * that merely passes over the chart on its way down the page never gets here, so the
     * sheet keeps every gesture a reader means for it.
     */
    const claim = (e: TouchEvent) => { e.preventDefault(); e.stopPropagation() }

    const onStart = (e: TouchEvent) => {
      window.clearTimeout(s.linger)
      // A second finger means a pinch-zoom, which is the browser's gesture and not ours.
      if (e.touches.length !== 1) { s.live = false; s.engaged = false; dropHold(); return }
      const t = e.touches[0]
      s.x = t.clientX; s.y = t.clientY; s.live = true; s.engaged = false
      dropHold()
      s.hold = window.setTimeout(() => { s.engaged = true; at(s.x) }, HOLD_MS)
    }

    const onMove = (e: TouchEvent) => {
      if (!s.live) return
      const t = e.touches[0]
      if (s.engaged) { claim(e); at(t.clientX); return }
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) { s.live = false; dropHold(); return }
      if (Math.abs(dx) > SLOP_PX) { dropHold(); s.engaged = true; claim(e); at(t.clientX) }
    }

    const onEnd = () => {
      dropHold()
      if (!s.live) return
      s.live = false
      // A tap that ended before the hold did still asked a question, and it is the same
      // question: read the chart where the finger landed.
      if (!s.engaged) at(s.x)
      s.engaged = false
      s.linger = window.setTimeout(() => setIndex(null), LINGER_MS)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      window.clearTimeout(s.hold)
      window.clearTimeout(s.linger)
    }
  }, [at])

  const clear = useCallback(() => {
    window.clearTimeout(g.current.linger)
    setIndex(null)
  }, [])

  const props = {
    ref,
    // The tab pager keeps out of this box; without it a sideways drag pages to the next tab.
    'data-swipe-lock': true,
    tabIndex: 0,
    role: 'group',
    'aria-label': 'Win probability through the game. Press and hold the chart, or use the arrow keys, to read any moment of it.',
    onPointerMove: (e: React.PointerEvent) => { if (e.pointerType !== 'touch') at(e.clientX) },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType !== 'touch') clear() },
    onBlur: clear,
    onKeyDown: (e: React.KeyboardEvent) => {
      // Shift jumps roughly a half-inning at a time; a game runs to a few hundred plays and
      // walking one at a time from the first pitch is not a way to reach the ninth.
      const by = e.shiftKey ? 10 : 1
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-by) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(by) }
      else if (e.key === 'Home') { e.preventDefault(); step(-1e9) }
      else if (e.key === 'End') { e.preventDefault(); step(1e9) }
      // Escape means "put that readout away" only while there IS one. Game Center is a modal
      // and Escape is how it closes, so swallowing the key unconditionally would trap a
      // reader who had merely tabbed onto the chart. Same reasoning as TapTip.
      else if (e.key === 'Escape' && index != null) { e.stopPropagation(); clear() }
    },
  }

  // Clamped on the way out rather than on the way in: the play list grows during a live game,
  // and an index held across that must never index past the end of the array.
  return { index: index == null ? null : Math.min(index, Math.max(count - 1, 0)), props }
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

  // THE CARD ALWAYS RESTS ON A PLAY. The one that won it where a winner exists, the most
  // volatile one while a game is still being played, and in a rout the biggest of a small
  // lot. The honesty about which of those it is belongs in the LABEL, which is the whole
  // change here: a rout used to drop the play entirely and print a sentence about the absence
  // of one, which answered a question nobody asked while the card had a perfectly good play
  // to show. `SWING_FLOOR` still decides the wording; it no longer decides whether a reader
  // gets a play at all.
  //
  // The marker sits where the swing LANDED, which is the next play's position. Clamped,
  // because in a game decided on the last play, which is the one worth marking, the next
  // position is off the right edge and the dot would simply not be drawn.
  const resting = wp.decisive ?? wp.biggest
  const restIdx = resting ? pts.indexOf(resting) : -1
  const bigX = restIdx >= 0 ? Math.min(x(restIdx + 1), 100) : 0

  // Reading the chart: hold a finger on it, hover it, or arrow along it. The answer goes in
  // the caption box above the plot rather than in a floating tooltip: see the note on it.
  //
  // ONE SHAPE, BOTH STATES. Resting and scrubbing fill the same three rows, so the card is
  // not two different things in one box: a finger landing on the plot moves the readout it
  // was already showing, which is a far better way of teaching the gesture than the hint is.
  const canHover = useMediaQuery('(hover: hover)')
  // One line means the row has a budget, and the name is the part of a play that can be given
  // up without losing what happened. The section's own shortener, so a name degrades here the
  // way it does in every other WPBL list.
  const short = useWpblName(14)
  const scrub = useChartScrub(pts.length)
  const at = scrub.index == null ? null : pts[scrub.index]
  const read = at ? scrubReadout(at, game, teams, short)
    : resting ? restingReadout(resting, game, teams, short, canHover, resting === wp.decisive)
    : null

  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      {/* One row, and the method is not in it. Three lines of "who is pitching is invisible to
          it" under a 132px chart spent more of a phone screen on a disclaimer than on the
          thing being disclaimed. It is a tap away on the ⓘ, which is where a caveat belongs
          for a card whose headline claim a reader can check against the score above it. */}
      <CardHeader />

      {/* The readout, ABOVE the plot, and both halves of that are deliberate.

          It is the caption box rather than a floating tooltip because a tooltip covers the
          chart it is describing and sits under the hand doing the pointing, and because a
          fixed box costs no layout shift.

          It is above rather than below because of where this card lands on a phone. Game
          Center is a sheet, and by the time it has drawn the line score, the highlight reel,
          the tab row and the recap's opening line, the pane gives this card less height than
          the card has: with the readout last, the only part that answers the question was
          below the fold, along with the hint that says the chart can be held at all. Above the
          plot it arrives ~190px earlier in the scroll, and a finger on the chart no longer
          covers it. */}
      <Box sx={{
        px: 1.5, pt: 0.25, pb: 1, mb: 1, height: CAPTION_H, overflow: 'hidden',
        borderBottom: '1px solid', borderColor: 'divider',
        // A column with the note pushed to the floor: the slack a one-line play leaves sits
        // between the play and the note, so the note holds still when the play wraps to two.
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Row 1: what this moment IS, and the win probability at it. The two never swap
            sides, so dragging changes the words in place instead of rearranging the row. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
          <Typography sx={{
            fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
            color: 'var(--wpbl-accent-fg)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{read?.label}</Typography>
          {/* Tabular figures, because this number changes under a moving finger and
              proportional digits make the whole row twitch as it does. */}
          <Typography sx={{
            ml: 'auto', fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums', color: 'text.secondary',
          }}>{read?.pct}</Typography>
        </Box>

        {/* Row 2: the play, on ONE line, whatever the feed writes. A second line costs 20px
            of a card that has to fit above the fold of a sheet, and buys the tail of a
            sentence whose front already carries it. The batter's name gives way first (see
            the shortener passed to the readout), so what survives the width is the play. */}
        <Typography aria-live="polite" sx={{
          fontSize: '0.85rem', lineHeight: 1.45,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{read?.text}</Typography>

        {/* Row 3: the score there, or, at rest, the one thing on the card that says it can be
            read at all. A hold gesture nobody is told about is a feature nobody finds. */}
        <Typography sx={{
          mt: 'auto', pt: 0.25, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.7, color: 'text.disabled', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>{read?.note}</Typography>
      </Box>
      <Box
        {...scrub.props}
        sx={{
          position: 'relative', height: CHART_H,
          // Vertical belongs to the page; sideways is the scrub's, claimed before the browser
          // can start a pan with it.
          touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent',
          userSelect: 'none', WebkitTouchCallout: 'none',
          cursor: 'crosshair', outline: 'none',
          '&:focus-visible': {
            outline: '2px solid', outlineColor: 'var(--wpbl-accent-solid)', outlineOffset: '-2px',
          },
        }}
      >
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
          {scrub.index != null && (
            <line x1={x(scrub.index)} x2={x(scrub.index)} y1={0} y2={100}
              stroke="currentColor" strokeOpacity={0.55} strokeWidth={1}
              vectorEffect="non-scaling-stroke" />
          )}
        </Box>

        {/* The marker is an HTML dot, not an SVG circle, and that is not a preference. The box
            is stretched to the card's width by `preserveAspectRatio="none"`, and while the
            line can opt out of that for its stroke, a circle cannot opt out of it for its
            shape: it comes out an ellipse two and a half times wider than it is tall. Nudged
            off the very corner so a dot on the last play of the game is not half-clipped. */}
        {restIdx >= 0 && (
          <Box aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(bigX, 2), 98)}%`,
            top: `${Math.min(Math.max(y(pts[restIdx].after), 6), 94)}%`,
            transform: 'translate(-50%, -50%)',
            width: 9, height: 9, borderRadius: '50%',
            bgcolor: 'var(--wpbl-accent-solid)',
            border: '2px solid', borderColor: 'background.paper',
            pointerEvents: 'none',
            // It goes as soon as the chart is being read. This dot means "the play in the
            // readout", and the moment a finger lands the readout is somewhere else: leaving
            // it up puts two dots on the plot, one of which is pointing at a play the card is
            // no longer telling you anything about. Faded rather than unmounted, so it does
            // not blink in and out as a linger expires.
            opacity: scrub.index == null ? 1 : 0,
            transition: 'opacity 120ms ease',
          }} />
        )}

        {/* Where the finger is. An HTML dot for the same reason the swing marker is one: the
            box is stretched horizontally, so an SVG circle in it comes out an ellipse. */}
        {at && scrub.index != null && (
          <Box aria-hidden sx={{
            position: 'absolute',
            left: `${Math.min(Math.max(x(scrub.index), 1.5), 98.5)}%`,
            top: `${Math.min(Math.max(y(at.before), 3), 97)}%`,
            transform: 'translate(-50%, -50%)',
            width: 11, height: 11, borderRadius: '50%',
            bgcolor: 'text.primary',
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
      <Box aria-hidden sx={{ position: 'relative', height: AXIS_H, mt: '2px' }}>
        {innings.filter(iv => iv.to - iv.from >= 3.5).map(iv => (
          <Typography key={iv.inning} sx={{
            position: 'absolute', left: `${(iv.from + iv.to) / 2}%`, transform: 'translateX(-50%)',
            fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1,
          }}>{iv.inning}</Typography>
        ))}
      </Box>

      {/* And what those numbers ARE. A bare row of 1 to 7 under a baseball chart is a good
          guess rather than a label, and the axis is worth eleven pixels of saying so. */}
      <Typography aria-hidden sx={{
        height: AXIS_LABEL_H, textAlign: 'center', fontSize: '0.55rem', fontWeight: 700,
        letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1,
      }}>Inning</Typography>

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
 * The three rows the readout box holds, filled the same way whether the card is resting on the
 * play of the game or following a finger. One shape means a reader learns to read it once.
 */
export interface Readout {
  /** Row 1 left: what this moment is. A label at rest, the inning and outs while scrubbing. */
  label: string
  /** Row 1 right: the win probability at it. */
  pct: string
  /** Row 2: the play itself. */
  text: string
  /** Row 3: the score there, or, at rest, the hint that the chart can be read. */
  note: string
}

/**
 * "LA 65% → 69%".
 *
 * THE PERCENTAGES ARE THE TEAM THE PLAY LEFT IN FRONT, not a fixed side, so the second number
 * is always the bigger half of the chart and always over 50%. Pinned to the home team instead,
 * half the chart reads as a club losing, and scrubbing across a game the visitors ran away
 * with is a column of numbers falling toward zero for a team that won. It only ever changes
 * club on a lead change, which is a thing worth seeing happen under your thumb.
 *
 * The two are collapsed to one when rounding makes them equal: "38% → 38%" claims a change the
 * model is not being allowed to print (see fmtWinPct), and most plays of a game are that.
 */
function pctLine(pt: WinProbPoint, game: WpblGame, teams: Map<string, WpblTeam>): string {
  const homeSide = pt.after >= 0.5
  const t = teams.get(homeSide ? game.home_team_id : game.away_team_id)
  const abbr = t?.abbr ?? (homeSide ? 'HOME' : 'AWAY')
  const before = fmtWinPct(homeSide ? pt.before : 1 - pt.before)
  const after = fmtWinPct(homeSide ? pt.after : 1 - pt.after)
  return before === after ? `${abbr} ${after}` : `${abbr} ${before} → ${after}`
}

/** The play, without the runner movements the feed hangs off the end of it: the box has two
 *  lines, and "Benitez advanced to third" is the part a reader can see on the chart anyway. */
function playText(pt: WinProbPoint, short: (name: string) => string): { who: string; what: string } {
  const parsed = parsePlay(pt.play.narrative ?? '', pt.play.batter_name, x => x)
  return {
    who: parsed.who ? `${short(parsed.who)} ` : '',
    what: parsed.what || pt.play.narrative?.trim() || 'No play recorded',
  }
}

/** One moment of the game, as the finger passes over it. */
export function scrubReadout(
  pt: WinProbPoint,
  game: WpblGame,
  teams: Map<string, WpblTeam>,
  short: (name: string) => string,
): Readout {
  const p = pt.play
  const away = teams.get(game.away_team_id)?.abbr ?? 'AWAY'
  const home = teams.get(game.home_team_id)?.abbr ?? 'HOME'
  const { who, what } = playText(pt, short)
  return {
    label: `${p.half === 'bottom' ? 'Bot' : 'Top'} ${ordinal(p.inning)} · ${p.outs ?? 0} out`,
    pct: pctLine(pt, game, teams),
    text: `${who}${what}.`,
    // The scoreboard as the play left it. 60% at 1-0 and 60% at 8-7 are not the same game,
    // and the win figure alone cannot tell them apart.
    note: `${away} ${pt.awayScore}, ${home} ${pt.homeScore}`,
  }
}

/**
 * The play the card rests on, in the same three rows a scrubbed play fills.
 *
 * THE LABEL CARRIES THE HONESTY. "Swing of the game" is a claim, and in a rout it is a false
 * one: nothing decided the 17-3 on Aug 14, where the biggest play moved the game eight points
 * and was merely the largest of a hundred small ones. That used to mean the card showed no
 * play at all and printed a sentence about the absence of one, which is a non-answer in the
 * most valuable 64px on the card. So the play always shows and the label tells the truth about
 * it: the swing of the game where there was one, the biggest moment where there was not, and
 * "so far" while the game is still being played and nothing has been decided yet.
 *
 * The sentence carries the inning, because unlike a scrubbed play this one has no row of its
 * own to say when it happened.
 */
export function restingReadout(
  pt: WinProbPoint,
  game: WpblGame,
  teams: Map<string, WpblTeam>,
  short: (name: string) => string,
  canHover: boolean,
  /** Is this the play that WON it, as opposed to merely the largest swing in it? False for a
   *  game still being played and for a tie, neither of which has a winner to have swung to. */
  decided: boolean,
): Readout {
  const label = decided && Math.abs(pt.swing) >= SWING_FLOOR ? 'Swing of the game'
    : game.status === 'final' ? 'Biggest moment'
    : 'Biggest moment so far'
  const { who, what } = playText(pt, short)
  return {
    // The inning goes where a scrubbed play keeps it, at the end of the label, and not on the
    // sentence: the feed's narratives already end in their own clause ("singled to left field,
    // RBI"), and hanging "in the 1st" off that reads as though the RBI happened in the 1st.
    label: `${label} · ${ordinal(pt.play.inning)}`,
    pct: pctLine(pt, game, teams),
    text: `${who}${what}.`,
    // The affordance, not the score: the final score is on the scoreboard directly above this
    // card, and somebody already holding the chart does not need to be told they can.
    note: `${canHover ? 'Hover' : 'Hold'} the chart for any play`,
  }
}

/** "6th". Innings only, so the teens never come up. */
function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
