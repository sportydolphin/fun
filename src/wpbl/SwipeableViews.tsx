import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMediaQuery } from '@mui/material'

// Finger-tracking tab pager for touch devices. The active view and, during a drag, the
// one neighbour in the drag direction translate 1:1 with the finger; releasing past a
// threshold commits to that neighbour (animating the rest of the way), otherwise it
// springs back. Desktop is untouched — it renders the active panel as-is.
//
// Why the fuss with keys + a stable track: the neighbour view is a heavy tab (it fetches
// its own data). It's mounted once when the drag starts, and on commit the same keyed cell
// simply switches from "neighbour" to "active" — React reuses its DOM, so it is never
// remounted and never refetches mid-swipe.
//
// Scroll model: the app scrolls the window (no inner scroll container), so a neighbour is
// pinned to the current viewport during the drag (`pinTop`) rather than the container's
// far-off top. On commit we jump the window back to the top so the freshly-selected tab
// reads from its start, matching how tapping a tab behaves.

const LOCK_PX = 10          // movement before we decide horizontal-swipe vs vertical-scroll
const COMMIT_FRACTION = 0.28 // fraction of the width a drag must pass to switch tabs
const ANIM_MS = 260
const RESIST = 0.3          // rubber-band factor when dragging past the first/last tab

// Does the touch start inside something that scrolls horizontally on its own (the home
// scoreboard strip, a wide table) and can still scroll that way? If so, leave the gesture
// to it instead of stealing it for a tab swipe.
function ownsHorizontalScroll(from: EventTarget | null, stop: HTMLElement, dir: number): boolean {
  let el = from instanceof HTMLElement ? from : null
  while (el && el !== stop) {
    const ox = getComputedStyle(el).overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      const maxLeft = el.scrollWidth - el.clientWidth
      if (dir > 0 && el.scrollLeft < maxLeft - 1) return true // room to reveal content on the right
      if (dir < 0 && el.scrollLeft > 1) return true           // room to reveal content on the left
    }
    el = el.parentElement
  }
  return false
}

interface Props {
  index: number
  panels: ReactNode[]
  onIndexChange: (i: number) => void
}

export default function SwipeableViews({ index, panels, onIndexChange }: Props) {
  const isMobile = useMediaQuery('(max-width:600px)')
  const containerRef = useRef<HTMLDivElement>(null)

  const [engaged, setEngaged] = useState(false) // a horizontal drag/animation is in progress
  const [offset, setOffset] = useState(0)        // px the track is translated by
  const [anim, setAnim] = useState(false)        // animate the transform (release) vs track the finger
  const [dir, setDir] = useState<-1 | 0 | 1>(0)  // which neighbour is live (-1 prev, 1 next)
  const [pinTop, setPinTop] = useState(0)        // neighbour's top, aligned to the current viewport

  // Mirrors for the native (non-React) touch handlers, which close over stale state otherwise.
  const animRef = useRef(false); animRef.current = anim
  const latest = useRef({ index, count: panels.length, onIndexChange })
  latest.current = { index, count: panels.length, onIndexChange }

  // The gesture's live state lives here (not React state) so the release handler reads the
  // true last offset immediately, independent of when React re-renders.
  const g = useRef({
    tracking: false, lock: null as null | 'h' | 'v',
    startX: 0, startY: 0, width: 0, dir: 0 as -1 | 0 | 1, boundary: false,
    target: null as EventTarget | null, curOffset: 0,
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el || !isMobile) return

    const onStart = (e: TouchEvent) => {
      if (animRef.current || e.touches.length !== 1) { g.current.tracking = false; return }
      const t = e.touches[0]
      g.current = {
        tracking: true, lock: null, startX: t.clientX, startY: t.clientY,
        width: el.clientWidth, dir: 0, boundary: false, target: e.target, curOffset: 0,
      }
    }

    const onMove = (e: TouchEvent) => {
      const s = g.current
      if (!s.tracking) return
      const t = e.touches[0]
      const dx = t.clientX - s.startX
      const dy = t.clientY - s.startY

      if (s.lock === null) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
        if (Math.abs(dy) >= Math.abs(dx)) { s.lock = 'v'; s.tracking = false; return } // vertical → let it scroll
        const d: 1 | -1 = dx < 0 ? 1 : -1
        if (ownsHorizontalScroll(s.target, el, d)) { s.lock = 'v'; s.tracking = false; return }
        s.lock = 'h'
        s.dir = d
        const { index: idx, count } = latest.current
        s.boundary = (d > 0 && idx >= count - 1) || (d < 0 && idx <= 0)
        setPinTop(Math.max(0, -el.getBoundingClientRect().top))
        setDir(d)
        setAnim(false)
        setEngaged(true)
      }

      if (s.lock !== 'h') return
      e.preventDefault() // we own this gesture now — stop the page from also scrolling
      s.curOffset = s.boundary ? dx * RESIST : dx
      setOffset(s.curOffset)
    }

    const onEnd = () => {
      const s = g.current
      if (!s.tracking && s.lock !== 'h') return
      s.tracking = false
      if (s.lock !== 'h') return
      const commit = !s.boundary && Math.abs(s.curOffset) > s.width * COMMIT_FRACTION
      const d = s.dir
      setAnim(true)
      setOffset(commit ? -d * s.width : 0)
      window.setTimeout(() => {
        if (commit) {
          latest.current.onIndexChange(latest.current.index + d)
          if (window.scrollY > 0) window.scrollTo(0, 0)
        }
        setEngaged(false)
        setAnim(false)
        setOffset(0)
        setDir(0)
      }, ANIM_MS)
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
    }
  }, [isMobile])

  if (!isMobile) return <>{panels[index]}</>

  const neighborIndex = dir === 0 ? -1 : index + dir
  const showNeighbor = engaged && neighborIndex >= 0 && neighborIndex < panels.length

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        // `clip` hides the off-screen neighbour without becoming a scroll container the way
        // `hidden` would (which would break the page's window scroll). Only while swiping.
        overflow: engaged ? 'clip' : 'visible',
        touchAction: 'pan-y',
      }}
    >
      <div
        style={{
          position: 'relative',
          transform: engaged ? `translateX(${offset}px)` : undefined,
          transition: anim ? `transform ${ANIM_MS}ms cubic-bezier(0.25, 0.8, 0.4, 1)` : 'none',
          willChange: engaged ? 'transform' : undefined,
        }}
      >
        {/* Active view: in normal flow so it drives the container's height. */}
        <div key={index} style={{ position: 'relative', width: '100%' }}>{panels[index]}</div>
        {/* Incoming neighbour: absolutely placed one screen over, pinned to the viewport. */}
        {showNeighbor && (
          <div
            key={neighborIndex}
            style={{ position: 'absolute', top: pinTop, left: 0, width: '100%', transform: `translateX(${dir * 100}%)` }}
          >
            {panels[neighborIndex]}
          </div>
        )}
      </div>
    </div>
  )
}
