import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

// Rows changing places, animated.
//
// WHAT THIS IS FOR. The standings table is driven by the chart under it: point at August 12 and
// the four clubs reorder into the order they were in on August 12. Reordered without animation
// that is a flicker, and a flicker is the one thing a reader cannot follow. Four rows swapping
// is a small enough picture that the MOVEMENT is the information: you see New York pass Los
// Angeles rather than seeing a table that is suddenly different.
//
// THE DOM REORDERS, AND THAT IS THE NON-NEGOTIABLE PART. The cheap way to animate a list like
// this is to freeze the DOM order and position every row with a transform, which a CSS
// transition then animates for free and which interrupts perfectly. It is also wrong here: a
// standings table's ORDER IS ITS CONTENT, and a screen reader reads DOM order. Freezing it
// would read the four clubs out in a fixed order while the screen shows another, on the one
// table where the order is the whole point. So React reorders the rows, the semantics stay
// true at every instant, and this puts the movement back.
//
// SO IT IS A FLIP: measure where each row WAS, let the DOM change, then start each row at its
// old position and animate the offset away. Three details make it survive a reader dragging
// along the chart, which fires this several times a second:
//
// 1. MEASURED AGAINST THE ROWS' OWN CONTAINER, never against the page.
//
//    The first cut used `offsetTop`, which is transform-blind and looked like exactly the right
//    tool. It resolves against the nearest POSITIONED ancestor, and on this page there is none,
//    so it was measuring each row's distance from the top of the BODY. The whole page moves for
//    reasons that have nothing to do with the standings: a tab pane mounting beside this one, a
//    card above it finishing its fetch. Every one of those was read as a reorder. Measured live,
//    one hop computed a 330px move in a table whose four rows span 153px, and the next hop
//    inverted the sign, which is the "row sinks and re-enters from above" this was reported as.
//
//    A rect minus the container's rect is the same subtraction the page cannot get into: both
//    are read in the same frame, so scroll position and everything above the table cancel
//    exactly. The rect's one drawback, that it includes any running transform, is handled by
//    subtracting the transform we ourselves applied, which we have to read anyway for (2).
// 2. AN INTERRUPTED ROW CONTINUES FROM WHERE IT IS, not from where it was heading. The
//    in-flight transform is read off the computed style and added to the layout delta, so a
//    row caught halfway between second and third starts its next move from halfway. Without
//    it, every re-target snaps the row to its old slot for one frame and the whole table
//    strobes under a moving finger.
// 3. THE OLD ANIMATION IS CANCELLED, and only after its value has been read. Two animations on
//    one element compose, so leaving the first running makes the second one land somewhere
//    neither of them meant.
//
// Reduced motion turns the whole thing off rather than shortening it: the rows still reorder,
// instantly, which is the correct and honest version of this feature for somebody who has
// asked not to be moved. See lib/motion.ts.

/** Long enough to read as travel, short enough that dragging along the chart does not feel
 *  like wading. Below about 250ms four rows crossing reads as a flicker again.
 *
 *  THE CALLER CAN SHORTEN IT, and playback does. A move that outlasts the interval between two
 *  reorders can never finish, so during playback this is set to the cadence itself and every
 *  row lands exactly as the next day arrives. See `useRowFlip`. */
const MOVE_MS = 340
/** SYMMETRICAL, WHICH IS NOT THE REFLEX AND IS RIGHT HERE. An ease-out is the usual pick for a
 *  thing ARRIVING: it puts the element where it is going and spends the tail settling. Two were
 *  tried and both failed the same way. `cubic-bezier(0.2, 0.8, 0.3, 1)` had carried the row 93%
 *  of the way at the halfway point, and the material standard curve 76%, so a swap read as a
 *  snap followed by a long settle and the crossing was over before the eye found it.
 *
 *  What is being animated is not an arrival. It is two clubs PASSING each other, and a pass
 *  only reads if the travel is spread evenly across the duration. This is easeInOutCubic: 50%
 *  of the distance at 50% of the time, measured.
 *
 *  The cost is a soft start on every re-target while somebody drags along the chart, and it is
 *  the right thing to pay: a drag is watched at the CURSOR, not at the table, and the table is
 *  being re-aimed several times a second anyway. The press of the play button is the moment
 *  this animation exists for, and there it is one clean move at a time. */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)'
/** Under a pixel of travel is not a move, it is a rounding difference between two layouts. */
const MIN_PX = 1
/** The floor under a caller-supplied cadence. A season with a lot of playing dates makes the
 *  play cadence short, and below this a swap stops being a movement and becomes a cut. */
const MIN_MOVE_MS = 110

/** The vertical translation currently applied to an element, in pixels, or 0 for none.
 *  `getComputedStyle` reports `none` rather than an identity matrix when nothing is applied,
 *  and DOMMatrix reads that as identity, so the zero falls out either way. */
function transformY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  try { return new DOMMatrixReadOnly(t).m42 } catch { return 0 }
}

/**
 * Animate rows into their new places whenever `order` changes.
 *
 * Returns the ref callback to put on every row, keyed by the same id the order is made of.
 * Rows are free to mount and unmount: an id this has never seen simply does not animate, which
 * is right, because a row that was not there has not moved.
 */
export function useRowFlip(order: string[], durationMs?: number) {
  const nodes = useRef(new Map<string, HTMLElement>()).current
  const prevTops = useRef<Map<string, number> | null>(null)
  // Held in a ref, not a dependency: a change of cadence is not a reason to run the flip pass,
  // and making it one would fire a whole pass on the frame playback starts.
  const duration = useRef(durationMs)
  duration.current = durationMs

  const rowRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) nodes.set(id, el)
    else nodes.delete(id)
  }, [nodes])

  useLayoutEffect(() => {
    const reduce = prefersReducedMotion()
    // The rows' shared container, read once: every row's position is expressed against it, so
    // whatever the page does above the table cancels out of both sides of the subtraction.
    const base = nodes.get(order[0])?.parentElement?.getBoundingClientRect().top ?? 0
    const tops = new Map<string, number>()
    const carried = new Map<string, number>()
    for (const id of order) {
      const el = nodes.get(id)
      if (!el) continue
      // The transform a running move has already applied. Taken off the rect to get the slot
      // the row BELONGS in, and added back below to say where it currently looks.
      const tf = transformY(el)
      carried.set(id, tf)
      tops.set(id, el.getBoundingClientRect().top - base - tf)
    }
    const prev = prevTops.current
    prevTops.current = tops
    // Nothing to animate from on the first commit, and nothing to animate at all for a reader
    // who has asked for less motion. Both still record the tops, so turning motion back on
    // mid-session does not make the next change animate from a stale layout.
    if (!prev || reduce) return

    for (const id of order) {
      const el = nodes.get(id)
      const was = prev.get(id)
      const now = tops.get(id)
      if (!el || was == null || now == null) continue
      // AND NOTHING WHERE THE PLATFORM CANNOT. jsdom implements neither `animate` nor
      // `getAnimations`, and this hook sits under a table that several tests render, so an
      // unguarded call is a crash in the suite rather than a missing flourish. Asked of the
      // ELEMENT and not of `Element.prototype`, which is the same question in a browser and a
      // different one under a test that stubs the API onto `HTMLElement` instead. The honest
      // answer anywhere without the Web Animations API is the reduced-motion one: the rows
      // reorder, they just do not travel.
      if (typeof el.animate !== 'function') return

      // A ROW WHOSE SLOT DID NOT MOVE IS ALREADY GOING WHERE IT SHOULD. Leave it alone.
      //
      // This is the bug that made playback look broken, and it is the opposite of what it
      // looked like. Play advanced a day every 167ms against a 340ms move, so most of the time
      // a row was still travelling when the next day landed. On a day that did not reorder
      // anything the layout delta is zero, but the code below still read the in-flight offset,
      // cancelled the animation, and started a fresh FULL-LENGTH one from wherever the row had
      // got to. Every tick did that again. The row halved its remaining distance forever and
      // never arrived, so the table permanently trailed the cursor and nothing ever settled.
      //
      // The running animation is already aimed at this exact slot, because the slot has not
      // changed. Touching it can only make it worse.
      const layoutDelta = was - now
      const running = typeof el.getAnimations === 'function' ? el.getAnimations() : []
      // A sub-pixel delta is two layouts rounding differently, not a move. Compared with a
      // tolerance rather than against zero because these are now fractional CSS pixels.
      if (Math.abs(layoutDelta) < MIN_PX && running.length) continue

      // Where it currently LOOKS, expressed against the slot it now occupies: the distance the
      // layout moved it, plus whatever a running animation had already carried it.
      const from = layoutDelta + (carried.get(id) ?? 0)
      for (const a of running) a.cancel()
      if (Math.abs(from) < MIN_PX) continue

      // TWO ROWS SWAPPING PASS THROUGH EACH OTHER, and a table row has no background of its
      // own: the whole table is transparent down to the page. Left alone, the moment of the
      // crossing is both clubs' names printed on top of each other. `data-moving` is what the
      // row's own style hangs an opaque background and a stacking context off, and it is
      // removed the instant the animation is done so a resting table is unchanged.
      //
      // The row moving UP goes over the one moving down. Either way round is legible and this
      // way round matches the sentence a reader is telling themselves, which is about the club
      // that gained rather than the one it passed.
      el.dataset.moving = from > 0 ? 'up' : 'down'
      const anim = el.animate(
        [{ transform: `translateY(${from}px)` }, { transform: 'translateY(0px)' }],
        // Never longer than the caller's cadence, and never so short it is a jump. The clamp
        // matters on a phone as much as a desktop: the cadence is the same on both, but a
        // slower device spends more of it painting, so a duration set beyond the cadence is
        // exactly where a cheap phone starts dropping the frames that make a swap legible.
        { duration: Math.max(MIN_MOVE_MS, Math.min(MOVE_MS, duration.current ?? MOVE_MS)), easing: EASE },
      )
      // `finished` rejects when the animation is cancelled, which is the ordinary case here:
      // the next hop of a drag cancels this one and sets the attribute again itself.
      anim.finished.then(() => { delete el.dataset.moving }, () => {})
    }
  }, [order, nodes])

  return rowRef
}

/**
 * The divider lines between clubs, drawn as their own layer over the rows.
 *
 * A SEPARATOR BELONGS TO THE TABLE, NOT TO THE CLUB. It marks where one slot ends, and slots do
 * not move; a border on a `<tr>` travels with whoever is standing in it. That alone would be
 * survivable, but the table is `border-collapse: collapse`, so those borders are painted by the
 * table UNDERNEATH the opaque backing a moving row needs (see `data-moving` above). The two
 * together mean that the moment any club changes places, EVERY line in the table disappears for
 * the length of the animation and comes back somewhere else. Four rows crossing stops looking
 * like a table and starts looking like loose text sliding around.
 *
 * A border-bottom on the moving rows does not fix it, for the same painting-order reason: it is
 * covered by the very backing that makes the crossing legible.
 *
 * So the rows keep their border for its GEOMETRY and paint it transparent, and the lines are
 * drawn once, above everything, at the slots. A club now passes under the divider instead of
 * taking it along.
 *
 * `offsetTop` IS THE RIGHT TOOL HERE AND THE WRONG ONE FORTY LINES UP, for the same property:
 * it is transform-blind. The FLIP needs to know where a row currently LOOKS, which is why it
 * reads rects; a static line needs the slot the row belongs in no matter where it has slid to,
 * which is exactly what `offsetTop` reports. It resolves against the nearest POSITIONED
 * ancestor, so the element this ref goes on must be `position: relative` — which is what the
 * overlay needs anyway.
 *
 * Re-measured on resize, which is the only thing that can move a slot: a wider viewport, a
 * font arriving, or the reader's text scale. Without the observer the lines are right until the
 * first of those and then silently wrong, which is the shape of bug this whole file is about.
 */
export function useRowDividers(rowCount: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [tops, setTops] = useState<number[]>([])

  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const measure = () => {
      const rows = Array.from(host.querySelectorAll('tbody tr')) as HTMLElement[]
      const next = rows.map(r => r.offsetTop)
      // Same values, same array: the observer fires on every resize tick, and a fresh array
      // each time would re-render the whole table for nothing.
      setTops(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
    }
    measure()
    // jsdom has no ResizeObserver, and this sits under a table several tests render. The
    // measurement above has already run, so a test gets the lines, just not the updates.
    if (typeof ResizeObserver !== 'function') return
    // Safe against a feedback loop: the overlay is absolutely positioned, so what it draws can
    // never change the height being observed.
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [rowCount])

  return { ref, tops }
}
