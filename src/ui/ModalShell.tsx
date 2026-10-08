import React, { createContext, startTransition, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Close } from '@mui/icons-material'
import { HeaderBack, HEADER_EYEBROW_SX, HEADER_ICON_SX, headerChipSx } from './headerBar'
import { createPortal } from 'react-dom'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { ThemeProvider, createTheme, useTheme, type Theme } from '@mui/material/styles'
import { useSwipeNav } from '../AccessibilityContext'
import { pressable } from './interaction'
import { chromePx } from './scale'

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
const DRAG_RELEASE_PX = 8      // back above the start by this much hands the touch to the scroll
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

/** Every scrollable box the finger is inside, innermost first, stopping at the sheet itself. */
function scrollersUnder(target: EventTarget | null, stop: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  let el = target instanceof HTMLElement ? target : null
  while (el && el !== stop.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') out.push(el)
    }
    el = el.parentElement
  }
  return out
}

function useSheetDrag(
  enabled: boolean,
  cardRef: React.RefObject<HTMLDivElement | null>,
  backdropRef: React.RefObject<HTMLDivElement | null>,
  chromeRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const card = cardRef.current
    if (!enabled || !card) return

    let active = false, claimed = false, locked = false, eligible = false
    let startY = 0, startX = 0, dy = 0, lastY = 0, lastT = 0, vel = 0
    // Whether the touchmove being handled is the sheet's, for the claimer below to cancel.
    let ours = false
    // The card's height, read once when a drag locks rather than on every move (each read after
    // a style write is a forced layout), and the frame the next position is waiting for.
    let height = 1, raf = 0
    // Set only for a drag that began on a pinned grab surface over a pane that is NOT at its
    // top. See the handoff in onMove.
    let bandScroller: HTMLElement | null = null

    // The backdrop clears as the sheet falls, so what is behind it is readable on the way
    // out rather than at the end of it. By the backdrop layer's OPACITY, which the compositor
    // can change without a repaint; see the backdrop in DialogShell for why it is its own layer.
    const setBackdrop = (progress: number) => {
      const el = backdropRef.current
      if (!el) return
      el.style.opacity = (1 - progress).toFixed(3)
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
      //
      // THE WALK OVER THE WHOLE CARD ONLY WHERE THERE IS NO OTHER WAY. A finger on the content has
      // its scrollers above it in the tree, a handful of ancestors to check. `visibleScroller`
      // reads every element in the card, which on the player page was about 45ms on a mid-range
      // phone at the start of EVERY swipe, and the first touchmove, which this listener can still
      // cancel, waited for it: a hitch each time a finger landed. Only a finger on pinned chrome,
      // which has no scroller above it, needs the walk.
      const chain = scrollersUnder(e.target, card)
      const local = chain[0] ?? null
      const main = onHandle ? null : chain.length > 0 ? chain[chain.length - 1] : visibleScroller(card)
      const atTop = (s: HTMLElement | null) => !s || s.scrollTop <= 0
      eligible = onHandle || (chain.every(s => s.scrollTop <= 0) && atTop(main))
      // The pane a band drag scrolls: whichever of the two actually has somewhere to go.
      bandScroller = onBand && !eligible ? (local && local.scrollTop > 0 ? local : main) : null
    }

    const onMove = (e: TouchEvent) => {
      ours = false
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
        ours = true
        // Commit, at DRAG_LOCK_PX, on movement big enough to mean something. A gesture that
        // reads sideways or upward on real distance is handed back rather than dragged.
        if (Math.abs(moveY) < DRAG_LOCK_PX && Math.abs(moveX) < DRAG_LOCK_PX) return
        if (Math.abs(moveX) > Math.abs(moveY) || moveY <= 0) { active = false; return }
        locked = true
        height = Math.max(card.offsetHeight, 1)
        card.style.transition = 'none'
        // ON THE COMPOSITOR FOR THE LENGTH OF THE DRAG. Without the hint each new transform
        // repainted the whole card, measured on a Galaxy S24 at two paints and a style recalc per
        // finger movement, three hundred a second, for a card that only needed moving.
        card.style.willChange = 'transform'
        if (backdropRef.current) backdropRef.current.style.willChange = 'opacity'
      }
      // BACK ABOVE WHERE IT STARTED: NOT A DISMISSAL ANY MORE. A drag that began as a pull at the
      // top and turned into a push up is a reader who wants to scroll, and holding the gesture as a
      // drag pinned at zero left the page frozen under the finger for the rest of the touch. The
      // sheet goes back and the touch is handed to the browser from here.
      if (moveY < -DRAG_RELEASE_PX) {
        release()
        card.style.transform = 'translateY(0)'
        setBackdrop(0)
        return
      }
      const now = performance.now()
      if (now > lastT) vel = (t.clientY - lastY) / (now - lastT)
      lastY = t.clientY; lastT = now
      dy = Math.max(0, moveY)
      ours = true
      // One write a frame, however many touchmoves arrive in it.
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0
        if (!locked) return
        card.style.transform = `translateY(${dy}px)`
        setBackdrop(Math.min(1, dy / height))
      })
    }

    /** End the drag without deciding anything: the gesture is no longer the sheet's. */
    const release = () => {
      active = false; locked = false; ours = false
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      card.style.willChange = ''
      if (backdropRef.current) backdropRef.current.style.willChange = ''
    }

    const onEnd = () => {
      syncClaimer()
      if (!active) return
      active = false
      if (!locked) return
      locked = false
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
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
      // The hint comes off once the card has settled, so a sheet at rest is not held as a layer.
      window.setTimeout(() => {
        if (locked) return
        card.style.willChange = ''
        if (backdropRef.current) backdropRef.current.style.willChange = ''
      }, DRAG_ANIM_MS)
    }

    /**
     * THE SHEET NEVER STANDS BETWEEN A FINGER AND THE SCROLL.
     *
     * A touchmove listener that can cancel (`passive: false`) makes the browser wait for the page
     * before it moves the content, every gesture, because it cannot know the listener will not
     * cancel. Spread over a whole sheet of content that is exactly "the page lags behind my finger",
     * and it only shows on a page as busy as the player card. So the logic above is PASSIVE, and
     * the one thing it ever needs from a cancellable listener, taking a downward pull away from the
     * browser, comes from `claimer`, which is attached only while every scroller in the sheet is at
     * its top. That is the one state in which a pull down on the content is the sheet's: anywhere
     * else the content simply scrolls, with nothing of ours in its way. The chrome needs no claimer
     * at any depth: its `touch-action: none` means the browser never scrolls from it.
     *
     * Kept in step by the content's own scroll events (they do not bubble, so a capturing listener),
     * and re-checked at the end of each touch, which catches a pane that went away (the other role
     * of a two-way player) without scrolling back.
     */
    const claimer = (e: TouchEvent) => { if (ours && e.cancelable) e.preventDefault() }
    const scrolled = new Set<HTMLElement>()
    let claimerOn = false
    function syncClaimer() {
      for (const el of scrolled) if (!el.isConnected || el.scrollTop <= 0) scrolled.delete(el)
      const want = scrolled.size === 0
      if (want === claimerOn) return
      claimerOn = want
      // Always added after `onMove`, so on a shared event it runs second and sees `ours`.
      if (want) card!.addEventListener('touchmove', claimer, { passive: false })
      else card!.removeEventListener('touchmove', claimer)
    }
    const onScroll = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      if (el.scrollTop > 0) scrolled.add(el)
      else scrolled.delete(el)
      syncClaimer()
    }

    card.addEventListener('touchstart', onStart, { passive: true })
    card.addEventListener('touchmove', onMove, { passive: true })
    card.addEventListener('touchend', onEnd, { passive: true })
    card.addEventListener('touchcancel', onEnd, { passive: true })
    card.addEventListener('scroll', onScroll, { capture: true, passive: true })
    syncClaimer()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      card.removeEventListener('touchstart', onStart)
      card.removeEventListener('touchmove', onMove)
      card.removeEventListener('touchmove', claimer)
      card.removeEventListener('touchend', onEnd)
      card.removeEventListener('touchcancel', onEnd)
      card.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [enabled, cardRef, backdropRef, chromeRef, onClose])
}

/**
 * Whether the shell has finished arriving: the phone sheet's rise or the panel's slide.
 *
 * THE SLIDE IS THE ONE THING ON THE SCREEN THAT MUST NOT STUTTER, and it runs on the compositor
 * only for as long as nothing else needs the main thread. A card that mounts everything it has
 * in the same frame spends the slide re-rendering: on a mid-range phone the player card's mount
 * was a 130ms task, and the cached reads it fires resolved into a second 115ms render that landed
 * mid-flight. Content below the first screen can wait the 260ms without anyone seeing it wait,
 * so `AfterShellEnters` holds it until the shell is still. True from the start wherever nothing
 * moves (a desktop dialog, a panel swapped in place), and true outside any shell.
 */
const EnteredContext = createContext(true)
export const useShellEntered = () => useContext(EnteredContext)

/** Render `children` once the shell around it has stopped moving. For content below the first
 *  screen only: anything visible on arrival belongs in the first frame, or it pops in mid-slide. */
export function AfterShellEnters({ children }: { children: React.ReactNode }) {
  return useShellEntered() ? <>{children}</> : null
}

/**
 * Watch `ref`'s own entry animation and report when it has finished.
 *
 * Read off the element's running animations rather than a hard-coded duration, so it follows the
 * keyframes wherever they are tuned, collapses with them under prefers-reduced-motion, and is true
 * at once where the media query gave the element no animation at all. The transition is so the
 * deferred render that this releases is itself time-sliced: a drag that starts the instant the
 * sheet lands still gets the frame.
 */
function useEntered(ref: React.RefObject<HTMLElement | null>): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const el = ref.current
    let done = false
    const finish = () => { if (!done) { done = true; startTransition(() => setEntered(true)) } }
    const anims = el && typeof el.getAnimations === 'function'
      ? el.getAnimations().filter(a => a.playState === 'running')
      : []
    if (anims.length === 0) { finish(); return }
    Promise.all(anims.map(a => a.finished)).then(finish, finish)
    // A backstop for an animation that never reports (a hidden tab does not run them).
    const t = window.setTimeout(finish, 600)
    return () => { done = true; window.clearTimeout(t) }
  }, [ref])
  return entered
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

type ModalShellProps = {
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
  /**
   * The same held height between a phone and a desktop, where the shell is a centred dialog: full
   * height from the first frame instead of starting short and re-centring as content lands. The
   * note above calls that growth "settling" and it is fine for a short dialog; for Game Center,
   * which opens on a line score and grows by a whole box score, it moved the card about 300px. Opt
   * in: MLB's Game Center asks for it, nothing else does yet.
   */
  dialogFill?: boolean
  /**
   * On a desktop, open as a side panel down the right edge instead of a centred dialog. Phones are
   * unaffected and still get the sheet. See SidePanelShell for what the panel does differently.
   */
  panel?: boolean
  /**
   * What the panel is showing, for a panel that swaps its content in place (a player panel moving
   * down a leaderboard). Each new value is a new OPENING as far as stacking goes: the panel rises
   * above whatever dialogs are open at that moment. See SidePanelShell's z-index.
   */
  openKey?: unknown
  /**
   * A back control at the left of the panel's header, for a panel opened over another panel (a
   * player opened from Game Center). The two sit in exactly the same place, so to a reader this is
   * one panel that navigated, and "back" is the only honest label for leaving it. Panel only: on a
   * phone the same card is a sheet stacked on a sheet, and its header has no room to spare.
   */
  onBack?: () => void
  backLabel?: string
  children: React.ReactNode
}

export function ModalShell(props: ModalShellProps) {
  const desktop = useOpensAsPanel()
  return props.panel && desktop ? <SidePanelShell {...props} /> : <DialogShell {...props} />
}

/**
 * Whether a shell given `panel` opens as the side panel here, by ModalShell's own test, for a caller
 * whose behaviour depends on it (MLB's sheet history swaps panels and stacks dialogs).
 *
 * MUI's `md`, read off the OUTER theme, because the panel's own content is rendered under
 * PANEL_THEME and asking there would always say "phone". Material's `useTheme`, which falls back to
 * the default theme where no provider is mounted (a test harness), rather than a theme callback in
 * `useMediaQuery`, which gets an empty object there and throws.
 */
export function useOpensAsPanel(): boolean {
  return useMediaQuery(useTheme().breakpoints.up('md'))
}

/**
 * Every shell that is open, and where it sits in the stack.
 *
 * DIALOGS STACK BY A FIXED NUMBER and PANELS STACK BY WHEN THEY OPENED, and this is what lets the
 * two meet. Dialogs have always carried their own z-index, chosen per card (Game Center 1500, a
 * player dialog 1600, a photo 1700), which is how a cold link to a game with a player on it draws
 * the player on top whichever of the two happened to load first. A panel cannot work that way: it
 * opens over the page AND over whatever dialog a player was reached from (the series view, Game
 * Center, the ballot), so the only right height for it is "just above what is open right now".
 */
type ShellEntry = { z: number; panel: boolean; el: () => HTMLElement | null }
const openShells = new Map<object, ShellEntry>()

/** Whether any shell, dialog or panel, is open: for background work that should wait while the
 *  reader is in one (see the tab warm-up in SwipeableViews). */
export const anyShellOpen = (): boolean => openShells.size > 0

function useRegisterShell(id: object, z: number, panel: boolean, ref: React.RefObject<HTMLElement | null>) {
  // A layout effect, so every shell committed in the same render is registered before any panel
  // reads the list in its passive effect: a Back that lands on a player over a game mounts both
  // at once, and the panel has to see the game.
  useLayoutEffect(() => {
    openShells.set(id, { z, panel, el: () => ref.current })
    return () => { openShells.delete(id) }
  }, [id, z, panel, ref])
}

/**
 * The z-index a shell is drawn at, for anything it opens that portals out of it. A tooltip is
 * portalled to the body, so a shell's own stacking context does not lift it; it has to be told
 * the number, and a panel's number is not known until it opens. See TapTip.
 */
const ShellZContext = createContext<number | null>(null)
export const useShellZ = () => useContext(ShellZContext)

/**
 * Whether to lay out for a phone: below MUI's `sm`, OR inside a desktop side panel.
 *
 * THE ONE TO REACH FOR, rather than `useMediaQuery('(max-width:600px)')`. A raw query string
 * measures the viewport, and inside the side panel the viewport is a desktop while the column is
 * a phone's, so a component asking that way draws its desktop layout into 420px. This asks the
 * theme, which the panel overrides (see PANEL_THEME), so it is right in both places. A raw query
 * is still the right tool for what is genuinely about the DEVICE (touch, hover, swipe).
 */
export function usePhoneLayout(): boolean {
  return useMediaQuery(useTheme().breakpoints.down('sm'))
}

/** Escape closes the newest shell only. Shared by both shells, so a dialog opened over a panel
 *  takes the key before the panel does. */
function useEscapeToClose(onClose: () => void, escapeId: object) {
  // Registered once, on mount, and separately from the listener: `onClose` is often a fresh
  // function every render, and re-registering with it would move an old shell to the top.
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
}

/** The eyebrow bar both shells share: the uppercase label, the caller's actions, and Close. */
function ShellHeader({ eyebrow, actions, onClose, labelId, onBack, backLabel }: {
  eyebrow: React.ReactNode
  actions?: React.ReactNode
  onClose: () => void
  labelId?: string
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <Box sx={{
      px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0,
    }}>
      {onBack && (
        <HeaderBack onBack={onBack} label={backLabel ?? 'Back'}
          ariaLabel={backLabel ? `Back to ${backLabel.toLowerCase()}` : 'Back'} />
      )}
      {/* In the header bar's one voice, as the full page's bar is: see headerBar. */}
      <Typography id={labelId} sx={HEADER_EYEBROW_SX}>
        {eyebrow}
      </Typography>
      {actions}
      <Box {...pressable(onClose)} aria-label="Close"
        sx={{ ...headerChipSx, width: chromePx(28), px: 0, justifyContent: 'center', mr: -0.5 }}>
        <Close aria-hidden sx={HEADER_ICON_SX} />
      </Box>
    </Box>
  )
}

/**
 * The theme a side panel's content renders under: every breakpoint above `xs` moved out of reach.
 *
 * THE PANEL IS A PHONE-WIDTH COLUMN ON A DESKTOP SCREEN, and the cards that open in it were laid
 * out for exactly that width already, as phone sheets. But every `{ xs, sm, md }` in them is a
 * media query against the VIEWPORT, which here is a desktop, so left alone they would draw their
 * desktop layout (wide tables, a side rail, tablet padding) into 420px and overflow it. Raising
 * the breakpoints makes every one of those objects, in the card and in everything it renders,
 * resolve to its phone value without any of them having to know a panel exists. A hook asking
 * `theme.breakpoints.up('md')` gets the same answer, which is how a card picks which layout to
 * BUILD (see PlayerDetail's `wide`). A raw query string like `useMediaQuery('(max-width:600px)')`
 * does not go through the theme and still sees the desktop; those decide touch and swipe
 * behaviour, which a mouse on a desktop should keep.
 */
const PANEL_BREAKPOINTS = createTheme({
  breakpoints: { values: { xs: 0, sm: 1e6, md: 1e6, lg: 1e6, xl: 1e6 } },
}).breakpoints
const PANEL_THEME = (outer: Theme): Theme => ({ ...outer, breakpoints: PANEL_BREAKPOINTS })

/**
 * The desktop side panel: a card down the right edge, under the toolbar, that leaves the page
 * usable.
 *
 * WHAT IT DOES NOT DO, AND WHY, since each omission is the point. A centred dialog is a poor fit
 * for something a reader opens over and over from a list (a leaderboard, a roster): it dims the
 * list, covers it, and has to be closed before the next row can be opened. So this has no scrim
 * and no click-outside dismissal, it does not lock the page's scroll, and it does not trap focus.
 * The page stays scrollable and clickable beside it, and opening another row swaps the panel's
 * content in place (the caller replaces the history entry rather than pushing one, so Back still
 * closes the panel rather than walking every row the reader looked at).
 *
 * It does not set `data-modal-open` either: that switches off the toolbar's blur on the grounds
 * that a modal has dimmed the bar to nothing, which is not true of a panel.
 *
 * Z-INDEX: ABOVE WHATEVER IS OPEN WHEN IT OPENS. Over the bare page that is PANEL_Z, under the app
 * bar (MUI's 1100), so the bar's search and account dropdowns, which live in the bar's own stacking
 * context, still drop down over it. Opened from a dialog (the semifinal series view, Game Center,
 * the ballot) it goes one above the highest dialog open, so the player the reader just asked for is
 * on top rather than behind that dialog's scrim. Re-measured on every `openKey`, because a panel
 * that is already open can be asked for again from a dialog opened after it: open a player, then
 * the series view from the page, then a player in the series, and the panel has to come up over
 * the series view, not stay where it first opened. Between openings it holds its height, so a clip
 * or a photo opened FROM the panel (see DialogShell's `z`) stays on top of it.
 */
const PANEL_W = 420
/** The panel's width on screen, for a page that moves aside to clear it (see panelShiftSx). */
export const PANEL_WIDTH = `min(${chromePx(PANEL_W)}, 100vw)`

/**
 * Whether any side panel is open, for a page that moves aside for it.
 *
 * A STORE, NOT A PROP, because the page and the panel rarely share an owner: on WpblApp's tabs they
 * do, but a standalone page (the season recap, scorigami) is drawn by App.tsx and the panel over it
 * by an overlay host beside it, and neither knows the other exists. The count is kept by the panel
 * itself, so whatever opened it, the page hears about it. A count rather than a flag, because a
 * player panel opened from the Game Center panel is a second one over the first.
 */
let openPanelCount = 0
const panelListeners = new Set<() => void>()
function bumpOpenPanels(by: number) {
  openPanelCount += by
  panelListeners.forEach(l => l())
}
const subscribePanels = (l: () => void) => { panelListeners.add(l); return () => { panelListeners.delete(l) } }
export function useSidePanelOpen(): boolean {
  return useSyncExternalStore(subscribePanels, () => openPanelCount > 0, () => false)
}

/**
 * Slide a centred page column left to clear the side panel: as far as it needs to, and never further
 * than the room on its left allows. The page keeps its width, so nothing in it reflows.
 *
 * WHY THIS AND NOT A NARROWER PAGE. The panel covers the right of whatever the reader came from,
 * which on WPBL's Schedule at 1440px is the score and status of every row they are working down.
 * Sliding the column into the empty gutter on its left uncovers it. Narrowing the page would reflow
 * every row under the reader each time the panel opens and closes, which is worse than covering it.
 * A wide surface (WPBL's Home at 1260px, its stats table at 1540px) has little or no gutter, so the
 * same rule moves it a little or not at all instead of pushing its left edge off the window.
 *
 * `contentW` is the widest thing in the column, as CSS. In CSS rather than measured, so it follows a
 * resize with nothing listening: the first term is how far the content's right edge (plus a gap)
 * reaches under the panel, the second is the gutter on its left less a margin, and clamp() floors
 * the lot at 0 when there is no room at all. 50vw counts a classic scrollbar, which leaves the left
 * margin a few pixels short of its nominal size.
 *
 * `left` on a relative box rather than a transform, which would make the column the containing
 * block of every fixed element inside it. The panel's own slide timing, so the two move as one.
 */
export function panelShiftSx(open: boolean, contentW: string) {
  const gap = chromePx(16)
  const shift = `clamp(0px, calc(${PANEL_WIDTH} + (${contentW}) / 2 + ${gap} - 50vw), calc(50vw - (${contentW}) / 2 - ${gap}))`
  return {
    position: 'relative',
    left: open ? `calc(-1 * ${shift})` : 0,
    transition: 'left 220ms cubic-bezier(0.2, 0, 0, 1)',
  } as const
}
const PANEL_Z = 1050

/** One above every other open shell, never below PANEL_Z. Panels count too: a player opened from
 *  the Game Center panel is a second panel drawn exactly over the first. */
function panelZ(self: object): number {
  let z = PANEL_Z
  for (const [id, s] of openShells) if (id !== self) z = Math.max(z, s.z + 1)
  return z
}

/**
 * When the last panel closed, for telling an OPENING from a SWAP. A card that cannot change what
 * it shows in place (Game Center seeds its tabs and data once) is swapped by remounting it, and
 * the old panel's cleanup runs in the same commit as the new one's mount. Replaying the slide-in
 * there would make every row clicked down a schedule look like a fresh open.
 */
let lastPanelGoneAt = -Infinity

function SidePanelShell({ eyebrow, onClose, actions, footer, openKey, onBack, backLabel, children }: ModalShellProps) {
  const id = useRef({}).current
  useEscapeToClose(onClose, id)
  const panelRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const entered = useEntered(panelRef)

  // Seeded at render, so a panel opened over an already-open dialog is never painted under it for
  // a frame; settled again after commit, once every shell mounted alongside it has registered.
  const [z, setZ] = useState(() => panelZ(id))
  useRegisterShell(id, z, true, panelRef)
  // Tell any page that moves aside (see useSidePanelOpen). A layout effect, so a swap's unmount and
  // mount land in one commit and the page never sees a frame with no panel and slides back.
  useLayoutEffect(() => { bumpOpenPanels(1); return () => bumpOpenPanels(-1) }, [])
  // A swap, not an opening: no slide. Before paint, so the first frame is already still.
  useLayoutEffect(() => {
    if (performance.now() - lastPanelGoneAt < 50 && panelRef.current) panelRef.current.style.animation = 'none'
    return () => { lastPanelGoneAt = performance.now() }
  }, [])
  const firstOpen = useRef(true)
  useEffect(() => {
    setZ(panelZ(id))
    // Coming to the top of the stack means coming to the top of Escape's stack as well, or the key
    // would close the dialog underneath first. Not on the first run: mounting already pushed it.
    if (firstOpen.current) { firstOpen.current = false; return }
    const i = escapeStack.indexOf(id)
    if (i >= 0) { escapeStack.splice(i, 1); escapeStack.push(id) }
  }, [openKey, id])

  /**
   * Focus moves INTO the panel when it opens and goes back where it came from when it closes, the
   * same as a dialog, but nothing holds it there: Tab can still leave for the page, which is what
   * nonmodal means. "Where it came from" is the last thing focused OUTSIDE the panel, tracked live,
   * because the reader may have clicked three different rows while it was open and the one to
   * return to is the latest. Restored only if focus is in the panel or nowhere as it closes: if the
   * reader has already moved on to something on the page, taking focus back would be a jump.
   */
  useEffect(() => {
    const panel = panelRef.current
    const active = document.activeElement
    let lastOutside: HTMLElement | null = active instanceof HTMLElement && active !== document.body ? active : null
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && panel && !panel.contains(e.target)) lastOutside = e.target
    }
    document.addEventListener('focusin', onFocusIn)
    panel?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      const now = document.activeElement
      const lost = !now || now === document.body || (!!panel && panel.contains(now))
      if (lost && lastOutside?.isConnected) lastOutside.focus({ preventScroll: true })
    }
  }, [])

  return createPortal((
    <Box
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelId}
      tabIndex={-1}
      sx={{
        position: 'fixed', right: 0, bottom: 0, zIndex: z,
        // Under the sticky toolbar, which publishes its height (0 when it is not pinned).
        top: 'var(--app-header-h, 0px)',
        width: PANEL_WIDTH,
        bgcolor: 'background.paper',
        borderLeft: '1px solid', borderColor: 'divider',
        // Shadow on the page side only: the panel is a layer over the page, not a slot in it.
        boxShadow: '-16px 0 40px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column',
        outline: 'none',
        // Slides in from the edge it is anchored to, the desktop twin of the sheet coming up from
        // the bottom. Only on open: swapping the player keeps this element mounted, so moving down
        // a list does not replay it. Collapsed under prefers-reduced-motion by styles.css.
        animation: 'sdPanelIn 220ms cubic-bezier(0.2, 0, 0, 1)',
        '@keyframes sdPanelIn': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      }}
    >
      <ShellHeader eyebrow={eyebrow} actions={actions} onClose={onClose} labelId={labelId} onBack={onBack} backLabel={backLabel} />
      {/* A flex column with a definite height, which is what the phone sheet gives its content
          too (see DialogShell's body), so the same chain resolves here: a card that fills it with
          `flex: 1` gets a real height and its panes can scroll themselves. */}
      <Box sx={{
        flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
        display: 'flex', flexDirection: 'column',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>
        <ShellZContext.Provider value={z}>
          <EnteredContext.Provider value={entered}>
            <ThemeProvider theme={PANEL_THEME}>{children}</ThemeProvider>
          </EnteredContext.Provider>
        </ShellZContext.Provider>
      </Box>
      {footer && (
        <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
          {footer}
        </Box>
      )}
    </Box>
  ), document.body)
}

function DialogShell({ eyebrow, onClose, maxWidth = 720, zIndex: ownZ = 1500, actions, footer, fillHeight, sheet, sheetFill, dialogFill, children }: ModalShellProps) {
  const id = useRef({}).current
  useEscapeToClose(onClose, id)

  /**
   * A dialog opened FROM a side panel goes above it. The panel can be sitting at any height (see
   * SidePanelShell), and a clip or a photo opened from the player in it at its own fixed 1600
   * could land behind a panel that rose over a 1600 dialog. "From the panel" is read off focus at
   * the moment this opens: clicking anything in the panel, even plain text, leaves focus inside it,
   * because the panel itself is focusable. A dialog opened from the page, or arriving on a cold
   * load with nothing clicked, keeps its own number, which is what still orders a game and the
   * player on it correctly when the two load out of order.
   */
  const [fromPanelZ] = useState(() => {
    const active = document.activeElement
    let z = 0
    for (const s of openShells.values()) {
      const el = s.panel ? s.el() : null
      if (el && active && el.contains(active)) z = Math.max(z, s.z + 1)
    }
    return z
  })
  const zIndex = Math.max(ownZ, fromPanelZ)

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
  const backdropRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  // The phone test lives inside the gesture, where it is read live off `matchMedia` and cannot
  // drift from the CSS breakpoint that decides whether this is a sheet at all. See SHEET_MQ.
  const swipeNav = useSwipeNav()
  useSheetDrag(!!sheet && swipeNav, cardRef, backdropRef, chromeRef, onClose)
  useRegisterShell(id, zIndex, false, overlayRef)
  const entered = useEntered(cardRef)

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
        display: 'flex', justifyContent: 'center',
        alignItems: sheet ? { xs: 'flex-end', sm: 'center' } : 'center',
        p: sheet ? { xs: 0, sm: 2 } : { xs: 1, sm: 2 },
      }}
    >
      {/* THE DIM IS ITS OWN LAYER, AND IT FADES BY OPACITY. It used to be the overlay's own
          background, animated as `background-color`, which is a paint property: every frame of the
          fade repainted the whole viewport on the main thread, the same main thread the card below
          is busy mounting on, so the dim stepped in visible jumps behind a sheet that was meant to
          glide. Opacity is one of the two properties the compositor animates by itself (transform is
          the other, and is what moves the sheet), so the fade now keeps time however busy the page
          is. A sibling of the card rather than its parent, because fading a parent fades the card.

          NO `backdrop-filter`, AND THIS IS A PERFORMANCE RULE RATHER THAN A TASTE ONE. A
          full-viewport backdrop filter makes the browser rasterise and blur EVERYTHING painted beneath
          it, which is the whole page, every time anything invalidates the backdrop. Every tappable row
          in this section changes its background on hover (TAPPABLE), so moving the mouse across a
          sheet of tiles over a page of large portraits asks for that work on every small change,
          which is visible lag on a desktop. The dim alone reads the same at a glance. See the AppBar's
          blur in App.tsx, which is the other half of this and is suppressed while a modal is up.

          The fade runs over the same beat the sheet takes to travel, on phones and `sheet` only, as
          an `animation` so styles.css's reduced-motion collapse covers it. */}
      <Box ref={backdropRef} onClick={onClose} sx={{
        position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)',
        ...(sheet ? {
          '@media (max-width: 599.95px)': {
            animation: 'wpblBackdropIn 260ms cubic-bezier(0.2, 0, 0, 1)',
            '@keyframes wpblBackdropIn': { from: { opacity: 0 }, to: { opacity: 1 } },
          },
        } : {}),
      }} />
      <Box ref={cardRef} sx={{
        // Positioned, so it paints over the absolutely placed dim beside it.
        position: 'relative',
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
        ...(sheet && sheetFill ? { height: { xs: '96%', sm: dialogFill ? '100%' : 'auto' } } : {}),
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
        <ShellHeader eyebrow={eyebrow} actions={actions} onClose={onClose} />
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
          <ShellZContext.Provider value={zIndex}>
            <EnteredContext.Provider value={entered}>{children}</EnteredContext.Provider>
          </ShellZContext.Provider>
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

