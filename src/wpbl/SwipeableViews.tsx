import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useMediaQuery } from '@mui/material'
import { useSwipeNav } from '../AccessibilityContext'

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
// Scroll model: the app scrolls the window (no inner scroll container). Each tab keeps its
// own scroll position — entering a tab (tap or swipe) restores where you last left it, and
// leaving records the spot. During a drag the incoming pane is pinned (`pinTop`) to the
// exact position the tab will land at, so committing is jump-free: no reset, no jitter. A
// first-visit tab lands at its top, tucked just under the pinned nav (see `freshTarget`).

const LOCK_PX = 10          // movement before we decide horizontal-swipe vs vertical-scroll
const COMMIT_FRACTION = 0.28 // fraction of the width a slow drag must pass to switch tabs
const FLICK_VELOCITY = 0.3  // px/ms — a release faster than this commits the swipe even when it
                            // never crossed COMMIT_FRACTION, so a quick little flick pages the tab
const FLICK_MIN_PX = 12     // but the flick must have travelled at least this far, so a stationary
                            // finger-jitter on release is never mistaken for a flick
const SCROLLER_FLICK_VELOCITY = 0.5 // px/ms — a horizontal flick faster than this pages the tab even
                            // when it starts inside a sideways scroller (the stats table): a hard
                            // flick reads as tab intent, since nobody flicks fast just to nudge a
                            // table over. Slower drags still scroll the table as before.
const ANIM_MS = 260          // a swipe's release (commit or spring-back)
// A nav-tap slide: snappier than a swipe release, and it grows a little with distance so a
// two-tabs-away jump visibly travels PAST the tab between rather than teleporting one screen.
// Capped so a far jump never drags.
const TAP_STEP_MS = 170
const TAP_STEP_ADD = 55
const TAP_MS_CAP = 340
const tapSlideMs = (steps: number) => Math.min(TAP_STEP_MS + (Math.abs(steps) - 1) * TAP_STEP_ADD, TAP_MS_CAP)
const RESIST = 0.3          // rubber-band factor when dragging past the first/last tab
const GAP = 16              // gutter shown between panes while swiping, so they aren't cramped

// Does the touch start inside something that scrolls horizontally on its own (the home
// scoreboard strip, the wide stats table)? If so, that inner scroller owns the gesture —
// leave it be instead of stealing it for a tab swipe — but only while it still has room to
// scroll in the drag's direction (`dir`: 1 = finger moving left toward the next tab, -1 =
// finger moving right toward the previous tab). Once the scroller is pinned against that
// edge, the drag falls through to the tab pager, so an extra flick at the end of the table
// pages on to the next/previous tab. Tab-switching stays available everywhere outside such
// scrollers (and via the nav).
//
// Exception: an element flagged `data-swipe-handle` is a frozen part of a scroller that
// stays put while the rest scrolls under it (the stats table's pinned name/sort columns).
// A horizontal drag there is meant to page tabs, not scroll the table, so we bow out —
// the scroller keeps only its actually-scrolling cells, giving the pager a grab handle.
function ownsHorizontalScroll(from: EventTarget | null, stop: HTMLElement, dir: -1 | 1): boolean {
  let el = from instanceof HTMLElement ? from : null
  if (el?.closest('[data-swipe-handle]')) return false
  while (el && el !== stop) {
    const ox = getComputedStyle(el).overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      // dir 1 reveals content to the right (scrollLeft grows toward its max); dir -1 reveals
      // content to the left (scrollLeft shrinks toward 0). The scroller keeps the gesture only
      // if it can still move that way; at the edge it lets go so the pager can take over.
      const max = el.scrollWidth - el.clientWidth
      const hasRoom = dir > 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1
      if (hasRoom) return true
    }
    el = el.parentElement
  }
  return false
}

interface Props {
  index: number
  panels: ReactNode[]
  onIndexChange: (i: number) => void
  minHeight?: string // floors the container so short tabs stay swipeable in their empty space
  stickyNavRef?: RefObject<HTMLElement | null> // the pinned tab menu, to land the new tab just under it
  padX?: number // horizontal inset (px) applied *inside* each pane, so the container can run
                // full-bleed to the screen edge while content keeps its gutter — a pane then
                // slides all the way off-screen instead of clipping at a padded barrier.
  // Which scroll model the pager sits in:
  //   'window' (default) — the page itself scrolls, one shared viewport, per-tab scroll memory
  //     against window.scrollY. The home tabs.
  //   'pane' — the pager fills a fixed-height flex slot and EACH PANE scrolls itself. For the
  //     Game Center, which is a modal: the body is scroll-locked while it's open, so all the
  //     window bookkeeping above (scroll memory, nav pinning, toolbar-clamp guard) is not just
  //     unnecessary but actively wrong. Each pane keeping its own scroller also means a tab
  //     remembers its own depth for free, instead of the single shared scroller carrying a deep
  //     play-by-play's position over onto a short recap.
  mode?: 'window' | 'pane'
}

export default function SwipeableViews({ index, panels, onIndexChange, minHeight, stickyNavRef, padX = 0, mode = 'window' }: Props) {
  const paneMode = mode === 'pane'
  const isMobile = useMediaQuery('(max-width:600px)')
  // Accessibility opt-out. With swiping off, the pager takes exactly the same path desktop
  // already takes (render the active panel and touch nothing else), so there is no second
  // code path to keep working, and no gesture listener bound to steal a drag. Tabs are still
  // reachable by tapping the nav, which was always the primary way in.
  // The hook is called unconditionally and the two are combined after: `isMobile &&
  // useSwipeNav()` would short-circuit the hook away, changing the hook count on the render
  // where the viewport crosses 600px.
  const swipeNav = useSwipeNav()
  const pagerOn = isMobile && swipeNav
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep-alive set: every tab index that has ever been shown (active or swiped-to). Those
  // stay mounted-but-hidden so returning to one is a repaint of already-computed content,
  // not a fresh mount that re-runs the tab's heavy data-shaping mid-swipe (the swipe
  // stutter, worst on the Stats tab). First visit still mounts once; repeat visits don't.
  const visited = useRef<Set<number>>(new Set())

  // Per-tab scroll memory (window scrollY, keyed by panel index) + the last index we were
  // on, so an index change can tell where we came from and where we're going.
  const scrollByIndex = useRef<Map<number, number>>(new Map())

  // The pane actually in flow. It equals `index` at rest, but LAGS it during a nav-tap slide:
  // the parent flips `index` the instant a pill is tapped, and we keep the outgoing pane on
  // screen and slide the two across one screen before letting this catch up. That is what makes
  // a tap animate the same way a swipe does instead of hard-cutting to the new page. A swipe
  // commit sets this itself, so `index` and this move together and the tap path below never
  // fires for a swipe.
  const [activeIndex, setActiveIndex] = useState(index)
  // The pane sliding in: a swipe's neighbour (activeIndex ± 1) or a tap's target (any index,
  // still shown one screen over so a far jump travels the same short distance as a near one).
  const [incoming, setIncoming] = useState(-1)
  const slideTimer = useRef<number | null>(null)
  const animating = useRef(false)
  const prevActive = useRef(index)
  // Scroll depth captured the instant a swipe commits, before React swaps in the new (often
  // shorter) pane. Reading window.scrollY in the restore effect below would be too late: a
  // shorter incoming pane lets the browser clamp scrollY upward first, which pops the
  // scrolled-away app toolbar back into view. The effect restores from this pre-commit value
  // instead, keeping the toolbar tucked exactly as it was.
  const commitScrollY = useRef<number | null>(null)

  // Where a freshly-entered (never-scrolled) tab should land: stay put if we're near the
  // top, otherwise snap up to just below the pinned nav so the tab reads from its start
  // with the app toolbar tucked away. Mirrors the old commit-time reset.
  const freshTarget = (curY: number) => {
    const el = containerRef.current
    if (!el) return curY
    const contentTop = el.getBoundingClientRect().top + window.scrollY
    const stickyOffset = stickyNavRef?.current?.offsetHeight ?? 0
    return Math.min(curY, Math.max(0, contentTop - stickyOffset))
  }
  // Split scroll into two parts so the pill nav never jumps vertically when swiping tabs:
  //   • chrome offset — how far the app toolbar has scrolled away, 0…T (T = the "tucked" line
  //     where the nav is fully pinned). This governs the nav's on-screen position.
  //   • content offset — scroll past T, i.e. how deep into the tab's own content you are.
  // Switching tabs keeps the CURRENT chrome offset (so the nav stays exactly where it is) and
  // applies only the destination tab's remembered content offset beneath it. A tab last left
  // scrolled deep restores that depth; one left at its top lands at its top — but in both
  // cases the nav bar holds still.
  const targetFor = (i: number, curY: number) => {
    const T = freshTarget(Number.POSITIVE_INFINITY) // tucked line (nav pinned, toolbar off)
    const chrome = Math.min(curY, T)                // preserve current toolbar-reveal state
    const remembered = scrollByIndex.current.get(i)
    const content = remembered == null ? 0 : Math.max(0, remembered - T) // that tab's depth past T
    return chrome + content
  }

  // Restore on enter, record on leave — keyed on the pane that actually became active, so a
  // tap slide restores scroll at the END of its animation (when activeIndex catches up), not
  // the instant the tap fired. The incoming pane was pinned to exactly `targetFor`, so
  // scrolling here produces no visible jump.
  useLayoutEffect(() => {
    if (prevActive.current === activeIndex) return
    // Pane mode owns no window scroll — each pane has its own scroller, and the modal above it
    // has the body locked, so there is nothing to save or restore here.
    if (!pagerOn || paneMode) { prevActive.current = activeIndex; return }
    // Prefer the depth captured at commit time (see commitScrollY): window.scrollY here is
    // post-clamp on a swipe into a shorter pane, which would lose the toolbar-hidden state.
    // A tap (no capture) falls back to the live scroll position.
    const fromY = commitScrollY.current ?? window.scrollY
    commitScrollY.current = null
    scrollByIndex.current.set(prevActive.current, fromY)
    const target = targetFor(activeIndex, fromY)
    prevActive.current = activeIndex
    window.scrollTo(0, target)
  }, [activeIndex, pagerOn])

  // End a slide (or a swipe commit): show the destination in flow and reset the track. Reads
  // everything from refs/stable setters so the touch handlers can call a frozen copy of it.
  //
  // Always snapshot the pre-swap scroll depth (see commitScrollY), so a swap into a shorter
  // pane keeps the toolbar-hidden state whichever way the swap was triggered. `notify` tells
  // the parent only on a SWIPE: on a tap the parent already moved `index` (it is what started
  // this slide), so calling onIndexChange again would double-push history.
  const commitTo = (to: number, notify: boolean) => {
    commitScrollY.current = window.scrollY
    if (notify) latest.current.onIndexChange(to)
    setActiveIndex(to)
    setEngaged(false); setAnim(false); setOffset(0); setIncoming(-1); setSlideTarget(null)
    animating.current = false
  }

  // Slide to `to` because the parent changed `index` off the pager (a nav tap). The outgoing
  // pane stays in flow at its current scroll; every pane between it and `to` is laid out in a
  // row one screen apart, and the track slides across all of them so a two-away jump travels
  // past the tab in between. commitTo then swaps `to` into flow. Distance-scaled so it stays
  // snappy near and never drags far.
  const startSlide = (to: number) => {
    const el = containerRef.current
    const from = activeIndex
    if (to === from || !el) { setActiveIndex(to); return }
    const steps = to - from
    const d: 1 | -1 = steps > 0 ? 1 : -1
    const width = el.clientWidth
    const ms = tapSlideMs(steps)
    if (paneMode) setPinTop(0)
    else { const curY = window.scrollY; setPinTop(curY - targetFor(to, curY)) }
    setSlideTarget(to); setSlideMs(ms); setOffset(0); setAnim(false); setEngaged(true)
    animating.current = true
    // Next frame: with the row parked to the side, animate the track the full distance across.
    requestAnimationFrame(() => { setAnim(true); setOffset(-steps * (width + GAP)) })
    if (slideTimer.current) window.clearTimeout(slideTimer.current)
    slideTimer.current = window.setTimeout(() => { slideTimer.current = null; commitTo(to, false) }, ms)
  }

  // The parent moved `index` (a nav tap, a Back, a deep link). Turn it into a slide when the
  // pager is live; otherwise (desktop, or swiping opted out) just show it, as before.
  useLayoutEffect(() => {
    if (index === activeIndex) return
    if (!pagerOn) { setActiveIndex(index); return }
    // A second tap mid-slide: drop the running one and snap to the newest target, so rapid
    // taps always finish on the right tab rather than queueing animations.
    if (animating.current) {
      if (slideTimer.current) { window.clearTimeout(slideTimer.current); slideTimer.current = null }
      commitTo(index, false)
      return
    }
    startSlide(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, activeIndex, pagerOn])

  useEffect(() => () => { if (slideTimer.current) window.clearTimeout(slideTimer.current) }, [])

  const [engaged, setEngaged] = useState(false) // a horizontal drag/animation is in progress
  const [offset, setOffset] = useState(0)        // px the track is translated by
  const [anim, setAnim] = useState(false)        // animate the transform (release) vs track the finger
  const [pinTop, setPinTop] = useState(0)        // neighbour's top, aligned to the current viewport
  // A nav-tap slide's destination (any index; null during a swipe, which only ever moves ±1).
  // When set, the track renders every pane between the active one and this, so the jump slides
  // through them. `slideMs` is the transition length in force — a swipe's ANIM_MS, or the
  // distance-scaled tap length.
  const [slideTarget, setSlideTarget] = useState<number | null>(null)
  const [slideMs, setSlideMs] = useState(ANIM_MS)
  const [, bumpWarm] = useState(0)               // re-render trigger when a neighbour is pre-warmed

  // Pre-warm EVERY other tab during idle time, nearest-first and one per idle tick, once the
  // active tab settles: each is added to the keep-alive set so it mounts hidden now, paying a
  // heavy tab's one-time data-shaping useMemo off-gesture instead of synchronously in the first
  // frame of a gesture. This is what lets a nav TAP start moving the instant it is pressed even
  // for a far tab (Home → Stats): the destination pane, and the ones it slides past, are already
  // mounted, so the engaged render is a reposition rather than a mount. It also removes the old
  // mid-swipe stutter (worst on Stats/Tracking). One per tick spreads the cost so warming never
  // itself janks; nearest-first means the likeliest next tab is ready first. Cheap on the
  // network: Home preloads the shared caches every tab reads, so a warmed tab's fetch-on-mount
  // finds a fresh cache and no-ops. Only ever grows `visited`.
  useEffect(() => {
    if (!pagerOn) return
    let cancelled = false
    const order = [...panels.keys()]
      .filter(j => j !== activeIndex)
      .sort((a, b) => Math.abs(a - activeIndex) - Math.abs(b - activeIndex))
    let k = 0
    const hasRIC = typeof window.requestIdleCallback === 'function'
    let id: number
    const step = () => {
      if (cancelled) return
      while (k < order.length && visited.current.has(order[k])) k++
      if (k >= order.length) return
      visited.current.add(order[k]); k++
      bumpWarm(n => n + 1)
      id = hasRIC ? window.requestIdleCallback(step, { timeout: 1500 }) : window.setTimeout(step, 200) as unknown as number
    }
    id = hasRIC ? window.requestIdleCallback(step, { timeout: 1500 }) : window.setTimeout(step, 500) as unknown as number
    return () => { cancelled = true; if (hasRIC) window.cancelIdleCallback(id); else window.clearTimeout(id) }
  }, [activeIndex, pagerOn, panels.length])

  // Mirrors for the native (non-React) touch handlers, which close over stale state otherwise.
  const animRef = useRef(false); animRef.current = anim
  const latest = useRef({ activeIndex, count: panels.length, onIndexChange })
  latest.current = { activeIndex, count: panels.length, onIndexChange }

  // The gesture's live state lives here (not React state) so the release handler reads the
  // true last offset immediately, independent of when React re-renders.
  const g = useRef({
    tracking: false, lock: null as null | 'h' | 'v',
    startX: 0, startY: 0, width: 0, dir: 0 as -1 | 0 | 1, boundary: false,
    target: null as EventTarget | null, curOffset: 0,
    // Release-velocity tracking for flick-to-commit: a smoothed px/ms speed plus the last
    // sample it was measured from. startT anchors the lock-time flick-speed estimate.
    vel: 0, lastX: 0, lastT: 0, startT: 0,
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el || !pagerOn) return

    const onStart = (e: TouchEvent) => {
      if (animRef.current || e.touches.length !== 1) { g.current.tracking = false; return }
      // Something inside owns horizontal drags outright (the win probability chart, which is
      // scrubbed by dragging along it). Unlike `ownsHorizontalScroll` below, this is not a
      // question of having room left to scroll and it is not overridden by a hard flick:
      // there is no gesture over that element the pager should ever take.
      if (e.target instanceof Element && e.target.closest('[data-swipe-lock]')) {
        g.current.tracking = false; return
      }
      const t = e.touches[0]
      g.current = {
        tracking: true, lock: null, startX: t.clientX, startY: t.clientY,
        width: el.clientWidth, dir: 0, boundary: false, target: e.target, curOffset: 0,
        vel: 0, lastX: t.clientX, lastT: e.timeStamp, startT: e.timeStamp,
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
        // Estimate the flick speed over the drag so far. A fast horizontal flick is a
        // tab-page intent even inside a sideways scroller, so only defer to the scroller for
        // an ordinary, slower drag — a hard flick falls through to the pager below.
        const dt = e.timeStamp - s.startT
        const flickV = dt > 0 ? Math.abs(dx) / dt : 0
        if (flickV < SCROLLER_FLICK_VELOCITY && ownsHorizontalScroll(s.target, el, d)) {
          s.lock = 'v'; s.tracking = false; return
        }
        s.lock = 'h'
        s.dir = d
        const { activeIndex: idx, count } = latest.current
        s.boundary = (d > 0 && idx >= count - 1) || (d < 0 && idx <= 0)
        // Pin the incoming pane so its remembered scroll shows at the current viewport —
        // curY - target — so the layout-effect scroll on commit lands with no jump. In pane
        // mode the panes are stacked to the container's own box, so there is nothing to pin.
        if (paneMode) setPinTop(0)
        else {
          const curY = window.scrollY
          setPinTop(curY - targetFor(idx + d, curY))
        }
        setIncoming(idx + d)
        setSlideTarget(null) // a swipe only ever moves one tab; no multi-pane row
        setSlideMs(ANIM_MS)
        setAnim(false)
        setEngaged(true)
      }

      if (s.lock !== 'h') return
      e.preventDefault() // we own this gesture now — stop the page from also scrolling
      // Smooth the finger's px/ms speed so onEnd knows how hard the release was flicked.
      // Weighted toward the newest sample so a late burst of speed (the flick) dominates.
      const dt = e.timeStamp - s.lastT
      if (dt > 0) {
        const instV = (t.clientX - s.lastX) / dt
        s.vel = s.vel * 0.6 + instV * 0.4
        s.lastX = t.clientX
        s.lastT = e.timeStamp
      }
      s.curOffset = s.boundary ? dx * RESIST : dx
      setOffset(s.curOffset)
    }

    const onEnd = () => {
      const s = g.current
      if (!s.tracking && s.lock !== 'h') return
      s.tracking = false
      if (s.lock !== 'h') return
      // Commit on either a long-enough drag OR a fast flick in the drag's direction. The flick
      // path lets a small, quick swipe page the tab without dragging most of the screen across —
      // vel is signed (left = negative → next tab, right = positive → prev tab), so it must match
      // the drag direction (sign(vel) === -dir) and clear a tiny minimum travel.
      const d = s.dir
      const flick = Math.abs(s.vel) > FLICK_VELOCITY
        && Math.abs(s.curOffset) > FLICK_MIN_PX
        && Math.sign(s.vel) === -d
      const commit = !s.boundary && (Math.abs(s.curOffset) > s.width * COMMIT_FRACTION || flick)
      setAnim(true)
      setOffset(commit ? -d * (s.width + GAP) : 0)
      window.setTimeout(() => {
        // Committing swaps activeIndex to the neighbour; the layout effect above restores that
        // tab's remembered scroll, matching the pinned pane's position (jump-free). commitTo
        // snapshots the pre-swap scroll depth first (viaSwipe), so the restore keeps the
        // toolbar-hidden state even when the incoming pane is shorter and the browser would
        // otherwise clamp upward.
        if (commit) {
          commitTo(latest.current.activeIndex + d, true)
        } else {
          setEngaged(false)
          setAnim(false)
          setOffset(0)
          setIncoming(-1)
        }
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
  }, [pagerOn, paneMode])

  // A pane owns its own vertical scroll in pane mode (in window mode the page scrolls, so the
  // pane must not become a scroll container).
  //
  // `scrollbarGutter: stable` is load-bearing, not polish. The panes differ in height — a
  // recap fits, a box score doesn't — so without it the taller pane grows a scrollbar the
  // shorter one lacks, its content box narrows by the scrollbar's width, and the whole pane
  // visibly jerks sideways as the swipe commits. Reserving the gutter on every pane makes
  // them all the same width whether or not they end up scrolling. (No-op where scrollbars
  // are overlaid, as on most phones; it matters wherever they take real layout space.)
  const paneScroll = paneMode
    ? {
      height: '100%', overflowY: 'auto' as const,
      scrollbarGutter: 'stable' as const,
      WebkitOverflowScrolling: 'touch' as const,
    }
    : {}

  // Desktop, or swiping turned off: no pager, but pane mode still has to supply the
  // scroller the modal relies on.
  if (!pagerOn) {
    return paneMode
      ? <div style={{ flex: 1, minHeight: 0, ...paneScroll }}>{panels[activeIndex]}</div>
      : <>{panels[activeIndex]}</>
  }

  // The panes riding the track besides the active one: a swipe's single neighbour, or, for a
  // multi-tab nav tap, every pane from the active one to the target so the slide travels past
  // the tabs in between rather than teleporting one screen.
  const engagedExtras: number[] = []
  if (engaged) {
    if (slideTarget != null && slideTarget !== activeIndex) {
      const st = slideTarget > activeIndex ? 1 : -1
      for (let i = activeIndex + st; ; i += st) {
        if (i >= 0 && i < panels.length) engagedExtras.push(i)
        if (i === slideTarget) break
      }
    } else if (incoming >= 0 && incoming < panels.length && incoming !== activeIndex) {
      engagedExtras.push(incoming)
    }
  }

  // Record every tab we render so it stays in the keep-alive set (done in render so a
  // freshly-active tab is remembered immediately, with no one-frame lag).
  visited.current.add(activeIndex)
  for (const i of engagedExtras) visited.current.add(i)

  const paneInset = { boxSizing: 'border-box' as const, paddingLeft: padX, paddingRight: padX }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        // `clip` hides the off-screen neighbour without becoming a scroll container the way
        // `hidden` would (which would break the page's window scroll). Only while swiping.
        // Pane mode clips always: the panes scroll themselves, so nothing should ever spill
        // out of the fixed-height slot the pager occupies.
        overflow: paneMode || engaged ? 'clip' : 'visible',
        touchAction: 'pan-y',
        minHeight,
        // Fill the modal's flex slot. This is the one definite height in the chain below —
        // the track and the panes both inherit from it so `height: 100%` resolves.
        ...(paneMode ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      <div
        style={{
          position: 'relative',
          transform: engaged ? `translateX(${offset}px)` : undefined,
          transition: anim ? `transform ${slideMs}ms cubic-bezier(0.25, 0.8, 0.4, 1)` : 'none',
          willChange: engaged ? 'transform' : undefined,
          ...(paneMode ? { height: '100%' } : {}),
        }}
      >
        {panels.map((panel, i) => {
          // Active view: in normal flow so it drives the container's height. `padX` keeps the
          // content inset while the pane itself spans the full (full-bleed) container width.
          if (i === activeIndex) {
            return <div key={i} style={{ position: 'relative', width: '100%', ...paneInset, ...paneScroll }}>{panel}</div>
          }
          // A pane on the track (a swipe neighbour or a step of a multi-tab tap): absolutely
          // placed (i - activeIndex) screens over and pinned to the viewport, so the track's
          // translate slides it — and any panes before it — through the viewport.
          if (engagedExtras.includes(i)) {
            const steps = i - activeIndex
            return (
              <div
                key={i}
                style={{ position: 'absolute', top: pinTop, left: 0, width: '100%', ...paneInset, ...paneScroll, transform: `translateX(calc(${steps * 100}% + ${steps * GAP}px))` }}
              >
                {panel}
              </div>
            )
          }
          // Everything else already visited: kept mounted but hidden (no layout, no repaint),
          // so swiping back to it doesn't remount and re-shape its data.
          if (visited.current.has(i)) {
            return <div key={i} style={{ display: 'none' }} aria-hidden>{panel}</div>
          }
          return null
        })}
      </div>
    </div>
  )
}
