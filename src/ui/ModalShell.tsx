import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography } from '@mui/material'
import { useSwipeNav } from '../AccessibilityContext'
import { pressable, hoverOnly, FOCUS_RING } from './interaction'

// The modal shell both league sections open their detail views in: a portalled overlay, a centred
// card on a desktop and, with `sheet`, a bottom sheet on a phone that can be dragged down to close.
// Built for WPBL and moved here on Sep 28, 2026 so MLB's Game Center could stop hand-rolling its
// own overlay (no portal, a background blur, a centred dialog on a phone). WPBL re-exports it from
// src/wpbl/ui.tsx, so its imports did not change.

// Shared modal shell. Mirrors the MLB modal chrome: dimmed + blurred overlay, a
// vertically-centered card on `background.paper` with a soft shadow, Escape-to-close,
// a sticky uppercase eyebrow header, a round ✕ close button, and an optional sticky
// footer (e.g. the entry form's Save/Cancel).
// Ref-counted body scroll lock: while any ModalShell is open, the page behind it
// must not scroll. Counted so stacked modals (e.g. a game → a player) only release
// the lock when the last one closes. Compensates for the removed scrollbar width so
// locking doesn't shift the page sideways. Mirrors what MUI's Dialog does on the MLB
// side (which WPBL's custom shell doesn't get for free).
let scrollLockCount = 0
const savedScroll = { htmlOverflow: '', bodyOverflow: '', bodyPaddingRight: '' }

function lockBodyScroll() {
  if (scrollLockCount++ === 0) {
    // The viewport scroller is <html> here (not <body>), so lock both to cover
    // whichever element actually scrolls. Compensate the removed scrollbar width
    // on <body> so the page doesn't jump sideways when the bar disappears.
    //
    // CLAMPED, BECAUSE `innerWidth - clientWidth` IS NOT ALWAYS THE SCROLLBAR. It is the scrollbar
    // only when both describe the same layout viewport in CSS px. In a scaled context (the desktop
    // preview pane, a mobile webview or installed PWA, browser zoom, or a page wider than the
    // screen) `window.innerWidth` reports a larger number while `clientWidth` stays the real width,
    // so the difference is hundreds of px of nothing, and unclamped it pads the body until the whole
    // app is squeezed into a sliver behind every open sheet. A real scrollbar is at most a couple
    // dozen CSS px, so anything past that is the formula being fooled and there is no bar to
    // compensate for anyway.
    const rawGap = window.innerWidth - document.documentElement.clientWidth
    const gap = rawGap > 0 && rawGap <= 40 ? rawGap : 0
    savedScroll.htmlOverflow = document.documentElement.style.overflow
    savedScroll.bodyOverflow = document.body.style.overflow
    savedScroll.bodyPaddingRight = document.body.style.paddingRight
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
  }
}

function unlockBodyScroll() {
  if (--scrollLockCount <= 0) {
    scrollLockCount = 0
    document.documentElement.style.overflow = savedScroll.htmlOverflow
    document.body.style.overflow = savedScroll.bodyOverflow
    document.body.style.paddingRight = savedScroll.bodyPaddingRight
  }
}

/**
 * Drag a bottom sheet down to dismiss it.
 *
 * WHAT IT HAS TO SHARE THE SCREEN WITH. Game Center is the busiest gesture surface in the
 * app: the tab panes scroll vertically, the tabs page horizontally under a finger, and the box
 * score scrolls sideways inside a pane. Only one of those is a real conflict.
 *
 *   - The horizontal pager settles it itself. `SwipeableViews` locks its axis after 10px and,
 *     on a vertical drag, sets `tracking = false` and hands the gesture back. This picks up
 *     exactly what it refuses, so the two can never both claim a drag.
 *   - Sideways scrollers are on the other axis and never see this.
 *   - Vertical scrolling IS the conflict, and the rule is the standard one: a downward drag
 *     dismisses only when the scroller under the finger is already at its top. Anywhere else
 *     it is a scroll, and this never calls preventDefault, so the browser handles it as usual.
 *
 * The chrome is always draggable, scroller or no scroller: a finger on the grab handle or the
 * title bar has no other possible intent. That half alone is most of the value, because the
 * close button is top-right, which is the hardest place on a phone to reach one-handed.
 *
 * OFF WHEN SWIPE NAVIGATION IS OFF, the same accessibility switch the tab pager honours, and
 * the close button never goes anywhere: a gesture is an extra way out, never the only one.
 */
/**
 * The viewport the sheet styling itself is keyed to.
 *
 * Checked LIVE, at touchstart, rather than held in a `useMediaQuery` beside the component.
 * Whether the card LOOKS like a sheet (bottom-anchored, rounded top corners, grab handle) is
 * decided by MUI's `xs`/`sm` breakpoint in `sx`, which is a real CSS media query. A separate
 * `useMediaQuery` deciding whether it can be DRAGGED would be a second source of truth for one
 * question, and when the two disagree the failure is silent in exactly one direction: the sheet
 * still looks like a sheet, still shows a grab handle, and cannot be grabbed. They can disagree,
 * because `useMediaQuery` is JS state that has to be told to update and does not always re-run
 * on a live viewport change. Reading `matchMedia` at the moment the finger lands cannot go stale
 * and costs nothing on a gesture that happens a few times a session.
 */
const SHEET_MQ = '(max-width:600px)'

/**
 * Two thresholds, not one, and the small one is the whole reason a drag that starts on the
 * CONTENT works on a real phone.
 *
 * A touch that lands inside a scrollable pane belongs to the browser until something takes
 * it: once the finger passes the platform's slop (about 8px on Android, similar on iOS) the
 * gesture goes to the compositor as a scroll, every later `touchmove` arrives
 * `cancelable: false`, and a `touchcancel` ends the sequence. Deciding at 10px is deciding one
 * pixel too late, every time, which works against synthetic touch events and does nothing on a
 * device.
 *
 * So the claim is split from the commit. At DRAG_CLAIM_PX the handler only asks "could this be
 * a dismissal" (downward, vertical-dominant, and over a scroller that is already at its top)
 * and if so starts calling `preventDefault`, which takes the touch off the browser while it is
 * still cancelable. Nothing is lost by claiming early in exactly that case: a downward drag at
 * scrollTop 0 has nowhere to scroll to. At DRAG_LOCK_PX it re-runs the same axis test on real
 * movement and either commits or releases, and a released gesture is only ever one the browser
 * could not have scrolled anyway. Horizontal paging is unharmed because `SwipeableViews` moves
 * in JS, which `preventDefault` does not touch.
 *
 * This is what the sheet's `touch-action: none` chrome buys structurally: the same race, but
 * removed rather than won. Content cannot use that, because the pane it sits in has to scroll.
 */
const DRAG_CLAIM_PX = 4        // movement before the touch is taken off the browser
const DRAG_LOCK_PX = 10        // movement before deciding dismiss-drag vs scroll
const DRAG_DISMISS_FRACTION = 0.25 // of the sheet's height, for a slow drag
const DRAG_FLICK_VELOCITY = 0.5    // px/ms downward, which commits from anywhere
const DRAG_FLICK_MIN_PX = 24
const DRAG_ANIM_MS = 220

/**
 * The scroller the sheet's content is actually in, for a finger that is NOT inside it.
 *
 * A grab surface declared with `data-sheet-drag` is pinned chrome: on a phone the player
 * card's identity band sits ABOVE the pager rather than inside it, because the pager needs a
 * definite height. So a finger on the band has no scrollable ancestor at all, and
 * `scrollerUnder` correctly returns null for it. This finds the pane the band is pinned over,
 * so a drag there can scroll it.
 *
 * THE HORIZONTAL TEST IS WHAT PICKS THE RIGHT PANE. A tab pager keeps its neighbours mounted
 * and translated off to the sides, so several panes match "overflows vertically" at once.
 * Only the one the card's centre line passes through is on screen.
 */
function visibleScroller(card: HTMLElement): HTMLElement | null {
  const box = card.getBoundingClientRect()
  const cx = box.left + box.width / 2
  let onCentre: HTMLElement | null = null, onCentreH = 0
  let tallest: HTMLElement | null = null, tallestH = 0
  for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
    // THE CHEAP TEST FIRST, and it is not a micro-optimisation. This runs at touchstart, and
    // `getComputedStyle` on every node of a card that can hold a thousand of them is tens of
    // milliseconds on a mid-range phone: paid at the exact moment the reader expects the sheet
    // to start moving, which is the one place in a gesture that lag is felt as a broken
    // control. Almost nothing overflows, so this skips the style read for nearly every node.
    if (el.scrollHeight <= el.clientHeight + 1) continue
    const oy = getComputedStyle(el).overflowY
    if (oy !== 'auto' && oy !== 'scroll') continue
    if (el.clientHeight > tallestH) { tallest = el; tallestH = el.clientHeight }
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || cx < r.left || cx > r.right) continue
    if (r.height > onCentreH) { onCentre = el; onCentreH = r.height }
  }
  // THE CENTRE-LINE TEST IS A PREFERENCE, NOT A REQUIREMENT, and that distinction is the
  // difference between this working and dismissing the card by mistake. It exists to pick the
  // on-screen pane out of a pager that keeps its neighbours mounted and translated aside, and
  // it is right whenever it matches. But rects are measured mid-gesture and mid-animation, and
  // any layout this has not met that puts them somewhere unexpected would return null here.
  // Null then reads as "there is nothing to scroll, so a drag must be a dismissal", which is
  // exactly the wrong answer to guess on a card that plainly does scroll.
  return onCentre ?? tallest
}

/** The scrollable box the finger is inside, if any, stopping at the sheet itself. */
function scrollerUnder(target: EventTarget | null, stop: HTMLElement): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null
  while (el && el !== stop.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return null
}

function useSheetDrag(
  enabled: boolean,
  cardRef: React.RefObject<HTMLDivElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  chromeRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const card = cardRef.current
    if (!enabled || !card) return

    let active = false, claimed = false, locked = false, eligible = false
    let startY = 0, startX = 0, dy = 0, lastY = 0, lastT = 0, vel = 0
    // Set only for a drag that began on a pinned grab surface over a pane that is NOT at its
    // top. See the handoff in onMove.
    let bandScroller: HTMLElement | null = null

    // The backdrop clears as the sheet falls, so what is behind it is readable on the way
    // out rather than at the end of it. Both halves of it: the dim AND the blur, since a
    // sheet sliding off a page that is still frosted looks like the page is broken.
    //
    // By its own alpha and filter, never by `opacity`: the sheet is a child of the overlay,
    // so fading the element would take the sheet down with it.
    const setBackdrop = (progress: number) => {
      const el = overlayRef.current
      if (!el) return
      const left = 1 - progress
      el.style.backgroundColor = `rgba(0,0,0,${(0.6 * left).toFixed(3)})`
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      // Live, not cached: above this width the card is an ordinary centred dialog and there is
      // nothing to push down. See SHEET_MQ.
      if (!window.matchMedia(SHEET_MQ).matches) return
      const t = e.touches[0]
      active = true; claimed = false; locked = false; dy = 0; vel = 0
      startY = lastY = t.clientY; startX = t.clientX
      lastT = performance.now()
      const el = e.target instanceof Element ? e.target : null
      // `data-sheet-drag` is how a card says "this block is my title, not my content": the
      // player page's identity band is the obvious thing to grab and pull, and it is not
      // something anyone scrolls to read. ModalShell gives anything carrying it the same
      // `touch-action: none` as the chrome, so grabbing there never enters the race above.
      // THE HANDLE AND THE EYEBROW ARE ALWAYS A DISMISSAL. They are small, they are unmistakably
      // chrome, and a finger there has no other possible intent.
      const onHandle = !!chromeRef.current && chromeRef.current.contains(e.target as Node)
      // A `data-sheet-drag` BAND IS NOT THE SAME THING, and treating it as though it were closes the
      // card when a reader is only trying to scroll back up. The player card's band is ~90px of
      // portrait and name pinned above the content at every scroll depth, directly under the thumb,
      // so "a finger here means dismiss" would fire constantly by accident. It earns the dismissal
      // only once the pane beneath it is already at its top, exactly like a finger on the content
      // does; below that it scrolls that pane instead.
      const onBand = !onHandle && !!el?.closest('[data-sheet-drag]')
      // TWO SCROLLERS ARE CONSULTED, AND EITHER ONE CAN VETO. `local` is whatever the finger is
      // actually inside, which is what governs a touch on the content; `main` is the card's own
      // pane, which is what governs a touch on a band pinned outside it. Requiring BOTH to be
      // at their top is what stops a drag dismissing the sheet while anything on screen still
      // has somewhere to scroll, without this having to correctly guess which one the reader
      // meant.
      const local = scrollerUnder(e.target, card)
      const main = onHandle ? null : visibleScroller(card)
      const atTop = (s: HTMLElement | null) => !s || s.scrollTop <= 0
      eligible = onHandle || (atTop(local) && atTop(main))
      // The pane a band drag scrolls: whichever of the two actually has somewhere to go.
      bandScroller = onBand && !eligible ? (local && local.scrollTop > 0 ? local : main) : null
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]

      // ONE CONTINUOUS GESTURE: SCROLL TO THE TOP, THEN KEEP PULLING TO DISMISS.
      //
      // The band has `touch-action: none`, so the browser will never scroll from it, and the
      // pane is not its ancestor so there is nothing for it to scroll anyway. Left alone this
      // is a dead strip a reader cannot scroll with, which is only marginally better than one
      // that closes the card by mistake. Forwarding the movement makes the band behave like
      // the content it sits on, and the drag becomes a dismissal at the moment the pane runs
      // out of travel, which is the same rule a finger on the content already follows.
      if (bandScroller) {
        const step = t.clientY - lastY
        lastY = t.clientY
        // Still somewhere to scroll, or the finger is going up: this is a scroll, not a
        // dismissal. `startY` follows the finger so that if a dismissal ever does begin, it
        // begins from where the pane ran out rather than from where the finger landed.
        if (bandScroller.scrollTop > 0 || step < 0) {
          bandScroller.scrollTop = Math.max(0, bandScroller.scrollTop - step)
          startY = t.clientY
          e.preventDefault()
          return
        }
        // At the top and still pulling down. Hand over.
        bandScroller = null
        eligible = true
        startY = lastY = t.clientY
        lastT = performance.now()
      }

      const moveY = t.clientY - startY
      const moveX = t.clientX - startX
      if (!locked) {
        // Claim, at DRAG_CLAIM_PX. Sideways, upward, or over a scroller that has somewhere to
        // go: not ours, and left alone so the browser handles it as usual. See DRAG_CLAIM_PX
        // for why this cannot wait for the lock threshold.
        if (!claimed) {
          if (Math.abs(moveY) < DRAG_CLAIM_PX && Math.abs(moveX) < DRAG_CLAIM_PX) return
          if (Math.abs(moveX) > Math.abs(moveY) || moveY <= 0 || !eligible) { active = false; return }
          claimed = true
        }
        // Held from here on, so the touch stays ours and stays cancelable while the axis
        // settles. This is a no-op for the gesture itself: nothing here could have scrolled.
        e.preventDefault()
        // Commit, at DRAG_LOCK_PX, on movement big enough to mean something. A gesture that
        // reads sideways or upward on real distance is handed back rather than dragged.
        if (Math.abs(moveY) < DRAG_LOCK_PX && Math.abs(moveX) < DRAG_LOCK_PX) return
        if (Math.abs(moveX) > Math.abs(moveY) || moveY <= 0) { active = false; return }
        locked = true
        card.style.transition = 'none'
      }
      const now = performance.now()
      if (now > lastT) vel = (t.clientY - lastY) / (now - lastT)
      lastY = t.clientY; lastT = now
      dy = Math.max(0, moveY)
      e.preventDefault()
      card.style.transform = `translateY(${dy}px)`
      setBackdrop(Math.min(1, dy / Math.max(card.offsetHeight, 1)))
    }

    const onEnd = () => {
      if (!active) return
      active = false
      if (!locked) return
      locked = false
      const height = Math.max(card.offsetHeight, 1)
      const go = dy > height * DRAG_DISMISS_FRACTION
        || (vel > DRAG_FLICK_VELOCITY && dy > DRAG_FLICK_MIN_PX)
      card.style.transition = `transform ${DRAG_ANIM_MS}ms ease-out`
      if (go) {
        card.style.transform = `translateY(${height}px)`
        setBackdrop(1)
        window.setTimeout(onClose, DRAG_ANIM_MS - 20)
      } else {
        card.style.transform = 'translateY(0)'
        setBackdrop(0)
      }
    }

    card.addEventListener('touchstart', onStart, { passive: true })
    card.addEventListener('touchmove', onMove, { passive: false })
    card.addEventListener('touchend', onEnd)
    card.addEventListener('touchcancel', onEnd)
    return () => {
      card.removeEventListener('touchstart', onStart)
      card.removeEventListener('touchmove', onMove)
      card.removeEventListener('touchend', onEnd)
      card.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, cardRef, overlayRef, chromeRef, onClose])
}

/** How many ModalShells are mounted. See the effect in ModalShell for what it is for. */
let modalDepth = 0

/**
 * Mounted shells, oldest first, so Escape reaches only the newest.
 *
 * Every shell listens on `window`, so with two stacked (Game Center over the scoreboard, a player
 * over a game) one keypress reached both and closed both. Where each close is a `history.back()`,
 * that is two steps of history for one key, and the second lands on whatever was under the first
 * sheet, which in MLB can be another section entirely.
 */
const escapeStack: object[] = []

export function ModalShell({ eyebrow, onClose, maxWidth = 720, zIndex = 1500, actions, footer, fillHeight, sheet, sheetFill, children }: {
  eyebrow: React.ReactNode
  onClose: () => void
  /** Responsive object as well as a plain number, because a modal that is the right size for
   *  a phone sheet is not the right size for a desktop dialog. Handed straight to `sx`. */
  /** px number, or a breakpoint map. Strings allowed so a caller can hand over a
   *  `chromePx()` calc, which is how a structural width is spelled. */
  maxWidth?: number | string | Record<string, number | string>
  zIndex?: number
  actions?: React.ReactNode   // rendered just left of the close button
  footer?: React.ReactNode    // sticky bottom bar
  fillHeight?: boolean        // pin the card to full height (content controls its own scroll)
  /** Come up from the bottom edge on a phone instead of sitting in the middle of the screen,
   *  with a grab handle and square bottom corners. For a modal that is a CONTROL rather than
   *  a document: a centred dialog puts its options where a thumb has to reach across the
   *  screen, and leaves page visible above and below it, so it reads as floating over the
   *  thing you were doing rather than as the thing you are doing now. Above sm it is an
   *  ordinary centred card, which is why this is opt-in and changes nothing for the modals
   *  that do not pass it. */
  sheet?: boolean
  /**
   * Hold a constant share of the screen instead of sizing to the content, on a phone, where
   * `sheet` is in effect.
   *
   * A bottom sheet is anchored by its BOTTOM edge, so every pixel its content gains moves its
   * top edge up the screen: a sheet that opens on a line score and a spinner and then receives a
   * box score finishes sliding up and then leaps most of a phone's height. A centred dialog hides
   * this, because growth there is split between two edges and reads as settling rather than as
   * jumping.
   *
   * It also stops the sheet resizing when you page between tabs, since a recap and a
   * play-by-play are nothing like the same height.
   *
   * Not for every sheet. The Sort and Filter pickers are short and honest about it; holding
   * them at 88% would be 200px of nothing under six options.
   */
  sheetFill?: boolean
  children: React.ReactNode
}) {
  // Registered once, on mount, and separately from the listener: `onClose` is often a fresh
  // function every render, and re-registering with it would move an old shell to the top.
  const escapeId = useRef({}).current
  useEffect(() => {
    escapeStack.push(escapeId)
    return () => {
      const i = escapeStack.indexOf(escapeId)
      if (i >= 0) escapeStack.splice(i, 1)
    }
  }, [escapeId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeStack[escapeStack.length - 1] === escapeId) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, escapeId])

  // Freeze the page behind the modal for as long as it's open.
  useEffect(() => { lockBodyScroll(); return unlockBodyScroll }, [])

  // ANNOUNCE THE MODAL ON <html>, for one consumer: the shared AppBar's desktop blur. That bar
  // is a second full-viewport backdrop filter and it sits UNDER a modal that has already dimmed
  // it to nothing, so while one is open the blur is invisible work, and on a desktop it is real
  // lag. An attribute rather than a context because App.tsx renders the bar and the modals are
  // portalled out of the section: a context would have to wrap both, and the only thing being
  // communicated is one boolean that CSS can read directly.
  //
  // COUNTED, because these nest: the section opens a player card over a game card, and the
  // inner one unmounting must not tell the bar the coast is clear.
  useEffect(() => {
    modalDepth += 1
    document.documentElement.dataset.modalOpen = ''
    return () => {
      modalDepth -= 1
      if (modalDepth <= 0) { modalDepth = 0; delete document.documentElement.dataset.modalOpen }
    }
  }, [])

  // A sheet on a phone can be pushed back down. See useSheetDrag for what that has to avoid
  // colliding with; above sm this is an ordinary centred dialog and none of it is bound.
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  // The phone test lives inside the gesture, where it is read live off `matchMedia` and cannot
  // drift from the CSS breakpoint that decides whether this is a sheet at all. See SHEET_MQ.
  const swipeNav = useSwipeNav()
  useSheetDrag(!!sheet && swipeNav, cardRef, overlayRef, chromeRef, onClose)

  /**
   * PORTALLED TO THE BODY, AND IT HAS TO BE.
   *
   * `position: fixed` is only fixed to the VIEWPORT while no ancestor has a transform, a filter,
   * or a will-change on one: any of those makes that ancestor the containing block for every
   * fixed descendant instead. `SwipeableViews` translates its track on the X axis to show the
   * current pane, which is exactly that, so a modal opened from inside a WPBL tab would be laid
   * out inside its own pane rather than over the page.
   *
   * The damage is invisible on a short dialog and total on a tall one: the overlay takes the
   * pane's height, `maxHeight: 100%` resolves against that instead of the screen, the scroll
   * region never becomes a scroll region, and everything past the fold of the sheet is
   * unreachable, with nothing errored or logged.
   *
   * A portal takes the overlay out of the pane and puts it under `body`, where nothing is
   * transformed. React keeps the tree intact through it, so context, events and the refs below
   * all behave exactly as they did.
   */
  return createPortal((
    <Box
      ref={overlayRef}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex,
        // NO `backdrop-filter` HERE, AND THIS IS A PERFORMANCE RULE RATHER THAN A TASTE ONE. A
        // full-viewport backdrop filter makes the browser rasterise and blur EVERYTHING painted beneath
        // it, which is the whole page, every time anything invalidates the backdrop. Every tappable row
        // in this section changes its background on hover (TAPPABLE), so moving the mouse across a
        // sheet of tiles over a page of large portraits asks for that work on every small change,
        // which is visible lag on a desktop. The dim alone reads the same at a glance. See the AppBar's
        // blur in App.tsx, which is the other half of this and is suppressed while a modal is up.
        bgcolor: 'rgba(0,0,0,0.6)',
        display: 'flex', justifyContent: 'center',
        alignItems: sheet ? { xs: 'flex-end', sm: 'center' } : 'center',
        p: sheet ? { xs: 0, sm: 2 } : { xs: 1, sm: 2 },
        // The dim fades in over the same beat the sheet takes to travel, instead of snapping to
        // full black the instant the card starts moving: a hard cut behind a sliding sheet reads
        // as two unrelated events. Phones and `sheet` only, matching wpblSheetUp on the card, and
        // an `animation` (not a transition) so styles.css's reduced-motion collapse covers it too.
        // No `forwards`: the element's own 0.6 is the resting state the keyframe lands on.
        ...(sheet ? {
          '@media (max-width: 599.95px)': {
            animation: 'wpblBackdropIn 260ms cubic-bezier(0.2, 0, 0, 1)',
            '@keyframes wpblBackdropIn': {
              from: { backgroundColor: 'rgba(0,0,0,0)' },
              to: { backgroundColor: 'rgba(0,0,0,0.6)' },
            },
          },
        } : {}),
      }}
    >
      <Box ref={cardRef} sx={{
        width: '100%', maxWidth,
        bgcolor: 'background.paper',
        borderRadius: sheet ? { xs: '18px 18px 0 0', sm: 3 } : 3,
        border: '1px solid', borderColor: 'divider',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        // `100%` (of the padded fixed overlay), not `vh`: under the desktop `zoom`
        // wrapper viewport units don't shrink, so `92vh` overflows the screen.
        // 96% for a FILLED sheet (the player page and Game Center), 88% for the rest. Those two are
        // long documents read on a phone, where 88% left a 95px strip of page above the sheet on top
        // of the sheet's own pinned header. 96% still leaves a sliver of the page showing, which is
        // what says "this is a sheet, pull it down" rather than "this is a new page". The short
        // pickers keep 88%: they are short, so the cap never binds, and a tall one would look odd.
        maxHeight: sheet ? { xs: sheetFill ? '96%' : '88%', sm: '100%' } : '100%',
        ...(sheet && sheetFill ? { height: { xs: '96%', sm: 'auto' } } : {}),
        ...(fillHeight ? { height: '100%' } : {}),
        display: 'flex', flexDirection: 'column',
        // It comes up from the edge it is anchored to. Without this a "bottom sheet" simply
        // appears, which reads as a dialog that happens to be at the bottom, and it leaves the
        // drag-down dismissal with no opposite gesture to have been the undoing of.
        //
        // It also buys time. Game Center opens on the recap, whose win-probability card needs
        // the league's whole play log before it can draw; 260ms of movement is 260ms in which
        // that arrives, and content that settles while the sheet is still travelling settles
        // invisibly. styles.css collapses this to nothing under prefers-reduced-motion, along
        // with every other animation on the page, so it needs no guard of its own.
        ...(sheet ? {
          '@media (max-width: 599.95px)': {
            animation: 'wpblSheetUp 260ms cubic-bezier(0.2, 0, 0, 1)',
            '@keyframes wpblSheetUp': {
              from: { transform: 'translateY(100%)' },
              to: { transform: 'translateY(0)' },
            },
            // A card's own title block, opted in with `data-sheet-drag`, gets the chrome's
            // deal: the browser never claims a touch that starts there, so useSheetDrag owns
            // it outright instead of racing the scroller it sits inside. Phones only, for the
            // same reason the chrome's is, and the cost is that the pane cannot be scrolled by
            // dragging on the title, which is the trade every bottom sheet makes for its
            // handle. Only opt in a block nobody scrolls to read.
            '& [data-sheet-drag]': { touchAction: 'none' },
          },
        } : {}),
      }}>
        {/* Grab handle. Purely a signal, and it earns its 12px: it says the card came up from
            the bottom edge, which is what tells a thumb that the backdrop left showing above
            it is the way out. */}
        {/* `touch-action: none` across the WHOLE chrome on a phone, not just the 36x4px
            handle, and this is what makes the drag work on a real device at all.

            The gesture handler cannot call `preventDefault` on the first touchmove: it has to
            wait DRAG_LOCK_PX to tell a dismissal from a scroll, and preventing before the axis
            is settled would kill scrolling on every touch that starts near the top. But a real
            browser decides what a gesture is during those same first pixels, and once it has
            handed the touch to the compositor as a scroll or an overscroll, every later
            touchmove arrives with `cancelable: false` and `preventDefault` is a no-op. Without
            this the drag would do nothing on a phone while working perfectly against synthetic
            touch events, which are always cancelable.

            `touch-action: none` removes the race instead of trying to win it: the browser
            never claims a touch that starts here, so the handler still owns it at 10px. It is
            safe on this element for the reason useSheetDrag already gives for treating the
            chrome as always-draggable: a finger on the grab handle or the title bar has no
            other possible intent. Taps are unaffected: touch-action governs panning and
            zooming, not clicks, so Close and Copy link still work.

            Phones only. On desktop this is an ordinary dialog and the property would only
            disable text selection in the header. */}
        <Box ref={chromeRef} sx={{ flexShrink: 0, touchAction: sheet ? { xs: 'none', sm: 'auto' } : undefined }}>
        {sheet && (
          <Box aria-hidden sx={{
            display: { xs: 'block', sm: 'none' }, flexShrink: 0,
            width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1,
          }} />
        )}
        {/* Sticky eyebrow header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {eyebrow}
          </Typography>
          {actions}
          <Box
            {...pressable(onClose)}
            aria-label="Close"
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
              ...FOCUS_RING,
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>
        </Box>

        {/* Scrollable body.
            A flex COLUMN, not a plain block, and that is load-bearing rather than tidy. A
            child of a block box cannot be a flex item, so it can only be sized by content and
            clamped with max-height, and a clamp does not make a height definite: every
            `height: 100%` below it silently falls back to auto, and the tab panes stop
            scrolling. With this, a child that says `flex: 1` gets a definite height and the
            chain under it resolves.

            Phones only, because that is where the sheet has a definite height for the chain to
            resolve FROM. Above sm the modal is content-height on purpose and the block layout
            is right: a flex column there shrinks the scroll region to a small window inside a
            much taller dialog. */}
        <Box sx={{
          flex: 1, overflowY: 'auto',
          // Stop a downward drag at the top of this pane from chaining out to the browser.
          // Without it Android Chrome answers that gesture with pull-to-refresh and iOS with
          // rubber-banding, both of which take ownership of the touch away from useSheetDrag on a
          // real phone. `contain` keeps the overscroll inside this box, so the touch stays
          // cancelable and useSheetDrag can still claim it at DRAG_LOCK_PX.
          overscrollBehavior: 'contain',
          display: { xs: 'flex', sm: 'block' }, flexDirection: 'column',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {children}
        </Box>

        {footer && (
          <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  ), document.body)
}

