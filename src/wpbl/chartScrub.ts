import { useCallback, useEffect, useRef, useState } from 'react'

// Reading a chart by pointing at it, on a phone and on a desktop.
//
// LIFTED OUT OF WinProbView, WHICH IS WHERE ALL OF THIS WAS LEARNED, when the standings chart
// wanted the same gesture. Everything below is that hook unchanged except for the label, which
// is now the caller's to write: two charts about different things cannot share one sentence.
// Re-implementing it was the alternative, and every paragraph in here is a bug that was paid
// for once already.

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
export function useChartScrub(count: number, label: string) {
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
    'aria-label': label,
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
