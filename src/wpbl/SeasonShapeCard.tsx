import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { standingsAt, biggestRun, leadStory, type SeasonShape, type SeasonPreview } from './derive/seasonShape'
import { useChartScrub } from './chartScrub'
import { wpblAccent, wpblFullName } from './constants'
import { SectionCard, chromePx, pressable, FOCUS_RING, useWpblDark, CARD_BORDER } from './ui'
import { prefersReducedMotion } from '../lib/motion'

// The standings plotted against the calendar.
//
// The table above this card is the season's last row of numbers. This is every earlier one:
// four lines from level on opening day to wherever each club stands, and a scrubber that puts
// the league back the way it was on any date. Everything it draws comes from the same
// `standingsFinals` the table folds, so the last column of the chart and the table above it
// cannot disagree.
//
// WHY A PLAY BUTTON AND NOT AN AUTOPLAY. The chart is legible standing still: it is four lines
// and a zero rule, and a reader who never touches it has still seen the shape of the season.
// Motion here buys one extra thing, which is the ORDER events happened in, and that is worth a
// deliberate press rather than something that starts moving under somebody trying to read the
// table above. It also means the reduced-motion path is not a degraded version of the feature:
// it is the same chart with the cursor jumping instead of sliding, and the scrubber does
// everything the button does.
//
// THE DRAW-IN IS THE ONE PIECE OF DECORATION AND IT IS ON A TIMER, not a scroll trigger. A
// chart that animates every time it re-enters the viewport is a chart you cannot read while
// scrolling past it twice. It plays once per mount, and `prefersReducedMotion` skips it to the
// finished state rather than shortening it.
//
// TWO PIXEL RULES, both from CLAUDE.md and both invisible when broken. The SVG is a unit box
// stretched by CSS, so nothing inside it is a pixel and stroke widths carry
// `vectorEffect="non-scaling-stroke"` (which is what WinProbView learned first). The box AROUND
// it is structure and takes `chromePx`, while anything reserving room for a label is in rem.

/** The chart's own viewBox. Stretched to whatever the card gives it, so these are proportions
 *  rather than pixels: 100 wide by 60 tall is the aspect the four lines read best at, flat
 *  enough that a one-game move is a small step rather than a cliff. */
const VB_W = 100
const VB_H = 60
/** Room at the top and bottom for the outermost line's stroke and its end dot. */
const PAD_Y = 4

/** How long ONE DAY of the season takes, which is the number that decides whether this is
 *  watchable.
 *
 *  IT IS A CADENCE, NOT A TOTAL, and that is a change from the first version. That one spent a
 *  fixed 4.5 seconds on the whole season and divided it by however many playing dates there
 *  were, which gets the relationship backwards: a LONGER season, with more to follow, got less
 *  time per day. It also made the one number anybody can perceive a derived quantity.
 *
 *  260ms is where "a day passed" reads as an event rather than a flicker. At 165ms, which is
 *  what 4.5 seconds over this season's 27 dates worked out to, the days went by faster than a
 *  lead change could be followed, and the row animation is cut to this cadence so the swaps
 *  were being squeezed into the same 165ms. This season now runs about seven seconds, which is
 *  a thing you watch rather than a thing you wait for.
 *
 *  The cap is a guard and not a target: a season with far more playing dates than this one
 *  would otherwise run for half a minute, so past that point the days compress again, down to
 *  the floor below which a swap stops being a movement. */
const STEP_MS = 260
const MAX_PLAY_MS = 9000
const MIN_STEP_MS = 150

/**
 * How long the pointer has to hold still before the TABLE follows it.
 *
 * A reader sweeping across five weeks of a season crosses a dozen different orders, and the
 * table was animating every one of them: four rows changing places twelve times in half a
 * second, which is not information, it is a strobe. It also punishes the ordinary way people
 * find a date, which is to move roughly there and then adjust.
 *
 * So the chart stays live under the finger (the cursor, the dots and the date all track it
 * exactly) and the standings wait for the reader to mean it. 220ms is long enough to swallow a
 * sweep and short enough that a deliberate move never feels like waiting: it is under the
 * ~250ms where a delay stops reading as response and starts reading as lag.
 *
 * IT DOES NOT APPLY TO PLAYBACK, which is already paced, deliberate, and slower than this. Nor
 * to letting go: the table returns to the present the moment the reader leaves, because a delay
 * there is just a stale table.
 */
const SETTLE_MS = 220

/**
 * A value, but only once it has stopped changing for `delayMs`.
 *
 * Trailing, not leading: the point is to know where the reader ENDED UP, so every change
 * restarts the clock and the last one wins. `delayMs` of 0 passes the value straight through,
 * which is how playback opts out without a second code path.
 *
 * The first value is never delayed. A card that renders empty for a fifth of a second on
 * arrival would be paying the cost of a gesture nobody has made yet.
 */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delayMs <= 0) { setSettled(value); return }
    const t = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return delayMs <= 0 ? value : settled
}

export default function SeasonShapeCard({ shape, onPreview }: {
  /** Built by the page, not here, because the standings table above is drawn from the same
   *  object: one `seasonShape` call feeds both, so the table a reader scrubs to and the chart
   *  they scrubbed cannot come from two different reads of the season. */
  shape: SeasonShape
  /** What the reader is pointing at, in the two speeds `SeasonPreview` describes: the figures
   *  follow the cursor exactly, the row order waits for them to hold still. Null on both means
   *  they are not pointing at anything and the table is the present. */
  onPreview: (view: SeasonPreview) => void
}) {
  const dark = useWpblDark()
  const last = shape.columns.length - 1

  // TWO THINGS MOVE THE CURSOR AND THE SCRUB ALWAYS WINS. Playback walks `playCol`; pointing at
  // the chart sets `scrub.index`, which is null the moment the reader lets go. Reading the pair
  // as one value here rather than pushing both into one state is what keeps "where playback got
  // to" from being destroyed by a passing mouse: let go mid-season and the cursor is back where
  // the button left it, not wherever the pointer last was.
  const [playCol, setPlayCol] = useState(last)
  const [playing, setPlaying] = useState(false)
  // NO LINGER. The answer to this chart is the standings table ABOVE it, which the reader's
  // hand is not covering, so holding it open after they let go just leaves August on screen
  // after they have moved on. Lifting a finger puts it back, which is what the mouse already
  // does on its way off the chart. See LINGER_MS in chartScrub.ts.
  const scrub = useChartScrub(shape.columns.length,
    'The standings through every day of the season. Press and hold the chart, or use the arrow keys, to read any date.',
    { lingerMs: 0 })
  // CLAMPED, because `playCol` outlives the shape it was seeded against. The card mounts before
  // the season has loaded, when there is exactly one column, and grows to twenty-odd when the
  // games arrive; nothing about React guarantees a state value and the prop it was derived from
  // move in the same commit. An index past the end reaches `shape.frames[undefined]` and takes
  // the standings table down with it, which is a blank page for a one-line guard.
  const col = Math.min(Math.max(scrub.index ?? playCol, 0), last)

  // Re-seed when the season grows under us (a game goes final while the tab is open), but only
  // for a reader sitting at the end, who is watching the present rather than reading a date.
  const prevLast = useRef(last)
  useEffect(() => {
    if (playCol === prevLast.current) setPlayCol(last)
    prevLast.current = last
  }, [last, playCol])

  // One day of playback, in milliseconds. Declared up here because two things need it: the
  // rAF loop below, and the report to the page, which cuts the table's row animation to it.
  const stepMs = Math.max(MIN_STEP_MS, Math.min(STEP_MS, MAX_PLAY_MS / Math.max(last, 1)))

  // Pointing at the chart stops playback, because two things driving one cursor is a cursor
  // that fights the reader. Playback does not resume on release: the reader has taken over.
  useEffect(() => { if (scrub.index != null) setPlaying(false) }, [scrub.index])

  // THE TABLE ABOVE IS THE READOUT. Reported as an effect rather than from the gesture handlers
  // so it cannot drift from what this card is drawing: whatever `col` is, that is what the page
  // is told, by every route into it including the play button and the arrow keys.
  // The column the row ORDER is told about. The figures get `col`, which is the chart's own and
  // never waits; only the sort settles. See SeasonPreview.
  //
  // CLAMPED TOO, and for a reason the clamp on `col` does not cover: this one is held in state,
  // so it survives a change of shape by construction. A reader on column 20 of a loaded season,
  // in a tab that then remounts against a shorter one, would otherwise have the page ask for a
  // day the season no longer has.
  const settled = Math.min(Math.max(useSettled(col, playing ? 0 : SETTLE_MS), 0), last)
  useEffect(() => {
    const idle = scrub.index == null && !playing
    // Cleared instantly on both channels. "The reader has gone" is true the moment it is true,
    // and holding the order for a fifth of a second longer would leave an August sort under a
    // cursor that is no longer anywhere.
    onPreview(idle
      ? { live: null, settled: null }
      : { live: col, settled, cadenceMs: playing && scrub.index == null ? stepMs : undefined })
  }, [col, settled, scrub.index, playing, stepMs, onPreview])
  // And put it back on the way out, or a reader who scrubs and then leaves the tab comes back
  // to a standings table frozen on a day in August.
  useEffect(() => () => onPreview({ live: null, settled: null }), [onPreview])

  const reduce = prefersReducedMotion()
  // The draw-in, once per mount. `drawn` starts true under reduced motion so the finished
  // chart is the first thing painted rather than a chart that appears a frame later.
  const [drawn, setDrawn] = useState(reduce)
  useEffect(() => {
    if (drawn) return
    const t = setTimeout(() => setDrawn(true), 30)
    return () => clearTimeout(t)
  }, [drawn])

  // Where playback resumes from, read at the start of a run rather than tracked through it: the
  // effect must not restart every time the column advances, or it resets its own clock.
  const playColRef = useRef(playCol)
  playColRef.current = playCol
  // Read by `play`, so the button can ask "are we running" without taking `playing` as a
  // dependency and rebuilding itself on every frame of playback.
  const playingRef = useRef(playing)
  playingRef.current = playing

  // ONE DAY AT A TIME, ON A FRAME, and both halves of that are deliberate.
  //
  // The cursor lands ON a column and never between two: the x-axis is dates, so an interpolated
  // position would put the readout and the standings table on a day that does not exist.
  //
  // But the STEPS are taken from a rAF clock rather than from `setInterval`. A 165ms interval
  // against a 16.7ms frame lands each day on whichever frame is nearest, so days came at 167ms
  // and then 183ms and then 167ms, and a row animation cut to that cadence inherited the
  // wobble. Reading the elapsed time on the frame itself makes every day land on a frame
  // boundary. It also stops dead when the tab is hidden, where `setInterval` keeps firing and
  // the season arrives all at once on the way back.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const from = playColRef.current
    const t0 = performance.now()
    const tick = (now: number) => {
      const next = from + Math.floor((now - t0) / stepMs)
      if (next >= last) { setPlayCol(last); setPlaying(false); return }
      setPlayCol(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, last, stepMs])


  // TWO PLAIN SETS, NOT ONE NESTED IN THE OTHER'S UPDATER.
  //
  // This read `setPlaying(p => { if (p) return false; setPlayCol(...); return true })`, which
  // queues a state update from inside an updater. Updaters run in the RENDER phase, so the
  // inner set was being made during a render rather than from an event, and React is entitled
  // to drop it or apply it to the wrong queue. Dropped, `playCol` stayed at the last column, the
  // loop's first tick found itself already at the end, and playback stopped before it started:
  // pressing Play on a fresh load did nothing, and the state it left behind took the page down
  // with it. It appeared to work after touching the chart only because the scrub had moved
  // `playCol` off the end by then, so losing the reset no longer mattered.
  const play = useCallback(() => {
    if (playingRef.current) { setPlaying(false); return }
    // Pressing play at the end means "again", which is the only thing it can mean there.
    setPlayCol(c => (c >= last ? 0 : c))
    setPlaying(true)
  }, [last])

  const run = biggestRun(shape)
  const lead = leadStory(shape)

  if (shape.games === 0) return null

  const colX = (i: number) => (last === 0 ? 0 : (i / last) * VB_W)
  const overY = (over: number) =>
    VB_H / 2 - (over / shape.span) * (VB_H / 2 - PAD_Y)

  const shown = shape.columns[col]
  const dateLabel = shown.date
    ? new Date(`${shown.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : 'Opening day'

  return (
    <SectionCard
      // NAME THE CHART, DO NOT NARRATE IT. "How the season went" is a caption on a photograph:
      // it tells the reader what they are about to feel rather than what they are looking at,
      // and it sits directly under a table headed "WPBL Standings". A card on a reference page
      // is named the way a column is named. This one plots the standings against the calendar,
      // so that is what it is called, and the line under it says what the axis is and what the
      // chart does. Nothing here is an invitation.
      title="Standings by date"
      subtitle="Games above .500 after every day of the season. Drag the chart, or press play."
      // SAME SURFACE AS THE TABLE IT SITS UNDER. `background.paper` is a LIFTED GREY in dark
      // mode, and the standings table directly above is a bordered box with no fill at all, so
      // the raised card read as a second surface arriving under the first: two panels on a tab
      // that holds one subject. This is the case `bare` was added for, in its own words.
      bare
      action={
        <Box {...pressable(play)} aria-label={playing ? 'Pause' : 'Play the season from the start'} sx={{
          ...FOCUS_RING, cursor: 'pointer', userSelect: 'none', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', gap: 0.5,
          minHeight: chromePx(30), px: 1.25, borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER,
          fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
          // THE PHONE'S WAIT, NOT OURS. `pressable` is an `onClick`, and a browser holds a tap
          // back until it knows the second half of a double-tap-to-zoom is not coming: up to
          // 300ms between lifting a finger and this hearing about it, which on a control whose
          // whole job is to start something reads as the animation being slow rather than the
          // press being late. `manipulation` says this element has no double-tap gesture, and
          // the browser dispatches immediately.
          touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
        }}>
          <Box component="span" aria-hidden>{playing ? '❚❚' : '▶'}</Box>
          {playing ? 'Pause' : 'Play'}
        </Box>
      }
    >
      <Chart
        shape={shape} col={col} scrub={scrub}
        colX={colX} overY={overY} dark={dark} drawn={drawn} reduce={reduce}
      />

      {/* NO SECOND READOUT HERE. This card carried four chips with each club's record at the
          cursor, which was right while it was the only thing the scrub could move; now that the
          standings table directly above updates, they were the same four records printed twice
          a hundred pixels apart. What is left is the DATE, which the table cannot say for
          itself, and which is the one thing a reader needs when the table has scrolled off the
          top of a phone. */}
      {/* "Through" and not the bare date: the column is everything played up to and including
          that day, and a date on its own reads as the day's results rather than the season's.
          The last column says so outright, because a reader who has let go has no other way to
          tell the table above is back to the present. */}
      {/* PART OF THE GESTURE, NOT PROSE, so it does not take a selection. This line is the
          chart's answer and it changes under the finger: a browser that starts selecting it
          mid-drag paints a highlight across a date that is still moving, and the reader gets a
          lit-up box where they wanted a number. The findings below it are ordinary text and
          stay selectable. */}
      <Typography sx={{
        mt: 1.25, fontSize: '0.72rem', color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
        userSelect: 'none', WebkitTapHighlightColor: 'transparent',
      }}>
        Through {dateLabel}
        {col === last && shown.date ? ' · current standings' : ''}
      </Typography>

      {/* THE FINDINGS, RACE FIRST. This card carried only the climb, which is one club measured
          against its own past: a fact that club's own page could tell you, under a chart whose
          whole subject is four lines crossing each other. The race is the part nothing else on
          the site can say, because the standings table is a single frame and a frame cannot
          report that the lead changed hands six times. It is also what the play button was
          starting a motion for and never naming. */}
      {/* STATED, NOT INTRODUCED. The first version opened "The season's longest climb belongs
          to", which spends eight words arriving at a fact that takes four. A label and the
          number is how every other figure on this page is written. */}
      {lead && (
        <Typography sx={{ mt: 1.25, fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.5 }}>
          <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>Days in first</Box>
          {': '}
          {/* CITY, NOT THE FULL NAME, because this one is a LIST. "San Francisco Firebells 20,
              Los Angeles Queens 7" is three lines on a phone to carry two numbers; the climb
              below names one club in a sentence, which is where a club gets its whole name. */}
          {lead.changes === 0
            ? `${lead.days[0].team.city}, all ${lead.dates}. Wire to wire.`
            : `${lead.days.map(d => `${d.team.city} ${d.days}`).join(', ')}. The lead changed hands ${
                lead.changes === 1 ? 'once' : `${lead.changes} times`}.`}
        </Typography>
      )}

      {run && (
        <Typography sx={{ mt: 0.75, fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.5 }}>
          <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>Biggest climb</Box>
          {': '}{wpblFullName(run.team)}, up {run.swing} games since{' '}
          {shape.columns[run.from].date
            ? new Date(`${shape.columns[run.from].date}T00:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })
            : 'opening day'}.
        </Typography>
      )}

    </SectionCard>
  )
}

// ── The drawing ──────────────────────────────────────────────────────────────────
//
// The gesture is `useChartScrub`, the one the win probability chart on Game Center already
// uses. Three things it settles here and none of them are obvious:
//
// A TOUCH HAS TO BE TOLD APART FROM A SCROLL, because this is 190px of a page people scroll
// through. It commits only after a hold or a sideways move past the slop, so a finger heading
// down the page is let go of instantly.
//
// AND FROM A TAB SWIPE. `/wpbl` pages between Home, Schedule, Standings, Stats and Teams on a
// horizontal drag, which is exactly the gesture this chart wants. `data-swipe-lock`, which the
// hook sets, is what hands it back: SwipeableViews checks for that attribute on touchstart and
// does not track the gesture at all. Without it, scrubbing the chart pages to Stats.
//
// AND A MOUSE IS NOT A FINGER. Hover reads the chart with no press at all, which is what a
// desktop reader expects and what a hold-to-engage rule would make worse; the hook routes
// pointer events by `pointerType` for exactly that.
function Chart({ shape, col, scrub, colX, overY, dark, drawn, reduce }: {
  shape: SeasonShape
  col: number
  scrub: ReturnType<typeof useChartScrub>
  colX: (i: number) => number
  overY: (over: number) => number
  dark: boolean
  drawn: boolean
  reduce: boolean
}) {
  const last = shape.columns.length - 1

  return (
    <Box
      {...scrub.props}
      sx={{
        ...FOCUS_RING,
        position: 'relative', width: '100%',
        // Structure, so chromePx. Tall enough that the gap between two clubs one game apart is
        // still a visible step at the season's widest spread.
        height: chromePx(190),
        // VERTICAL BELONGS TO THE PAGE, sideways is the scrub's. Claimed here rather than
        // argued about in JavaScript: `pan-y` tells the browser not to start a horizontal
        // scroll of its own, which is what lets the move handler call preventDefault at all.
        touchAction: 'pan-y', WebkitTapHighlightColor: 'transparent',
        cursor: 'ew-resize', userSelect: 'none',
        borderRadius: 2,
      }}
    >
      <Box component="svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none"
        aria-hidden sx={{
          display: 'block', width: '100%', height: '100%', overflow: 'visible',
          // THE DRAW-IN IS A WIPE, not four lines drawing themselves. A dash offset needs a
          // normalised `pathLength` to make lines of different lengths finish together, and
          // `pathLength` is exactly the thing the non-uniform stretch above makes unreliable.
          // A wipe also says something truer: the season is revealed left to right, in the
          // order it happened, which is the same thing the play button does.
          clipPath: drawn ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
          ...(reduce ? null : { transition: 'clip-path 1100ms ease-out' }),
        }}>
        {/* .500. The one gridline, because it is the only value on this axis that means
            something without being read off a scale. Horizontal, so its dashes stretch along
            its own length and stay even. */}
        <line x1={0} x2={VB_W} y1={overY(0)} y2={overY(0)}
          stroke="currentColor" strokeOpacity={0.28} strokeWidth={1} strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke" />

        {shape.tracks.map(track => (
          <polyline
            key={track.team.id}
            points={track.points.map((p, i) => `${colX(i)},${overY(p.over)}`).join(' ')}
            fill="none"
            stroke={wpblAccent(track.team.id, dark)}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>

      {/* Where the cursor is, and where each club stands there. In the DOM over the chart for
          the reason given above, and positioned in percentages of the same box the viewBox
          describes, so the two coordinate systems cannot drift apart. */}
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0, width: '1px',
          left: `${(colX(col) / VB_W) * 100}%`,
          bgcolor: 'currentColor', opacity: 0.4,
        }} />
        {shape.tracks.map(track => (
          <Box
            key={track.team.id}
            sx={{
              position: 'absolute',
              left: `${(colX(col) / VB_W) * 100}%`,
              top: `${(overY(track.points[col].over) / VB_H) * 100}%`,
              // Ornament: a dot marking a position, carrying no type and reserving room for
              // none, so raw px is the right unit and it stays the same size on every device.
              width: 9, height: 9, mt: '-4.5px', ml: '-4.5px',
              borderRadius: '50%',
              bgcolor: wpblAccent(track.team.id, dark),
              border: '2px solid', borderColor: 'background.paper',
              opacity: drawn ? 1 : 0,
              ...(reduce ? null : { transition: 'opacity 400ms ease-out 900ms' }),
            }}
          />
        ))}
      </Box>
    </Box>
  )
}
