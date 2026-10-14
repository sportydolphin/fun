// "Take me to this part of the next page": the search's "Dodgers roster" row opens the club's page
// and asks it to scroll to the roster.
//
// NOT A URL HASH. Both sections write their own address on every navigation (WPBL's urlFor, MLB's
// mlbUrlFor), neither of which knows about a hash, so `#roster` would be gone before the page could
// read it, and putting it into both writers would make every later Back land mid-page. A one-shot
// request is what MLB's requestDeepLink already does for the same reason: the link stays the page's
// plain address, and the scroll is only for the pick that asked for it.
//
// The page may draw the part only once its data lands, so the request waits, for a few seconds,
// for an element with the id to exist. Without the limit a request whose page never drew that part
// (a club with no roster loaded yet) would fire on some unrelated visit much later.

import { useEffect } from 'react'
import { scrollBehavior } from './motion'

const WAIT_MS = 8000
let pending: { id: string; at: number } | null = null

/** The element id a page gives the part, so the two halves cannot drift apart. */
export const sectionAnchorId = (part: string): string => `section-${part}`

export function requestSectionScroll(part: string): void {
  pending = { id: sectionAnchorId(part), at: Date.now() }
}

/** The element id a fresh request is waiting for, or null. For a page that has to change what it
 *  draws before the element can exist (the glossary's term list shows one group at a time). */
export function pendingSectionScroll(): string | null {
  return pending && Date.now() - pending.at <= WAIT_MS ? pending.id : null
}

/**
 * Called by a page that has parts to scroll to, on every render (it is cheap), so the request is
 * met by the first render that draws the part. `onArrive` runs first with the part's id, for a page
 * whose part can be folded shut and must open before it is scrolled to.
 */
export function useSectionScroll(onArrive?: (id: string) => void): void {
  useEffect(() => {
    if (!pending) return
    if (Date.now() - pending.at > WAIT_MS) { pending = null; return }
    const el = document.getElementById(pending.id)
    if (!el) return
    const { id } = pending
    pending = null
    onArrive?.(id)
    el.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
    holdInView(el)
  })
}

// HOW LONG THE PART IS KEPT AT THE TOP after the first scroll. A player's card draws its blocks as
// their data lands, so the game log scrolled to while the season line above it is a skeleton is
// pushed half a screen down when the line arrives; and a sheet that opens on top resets its own
// scroll as it does. Measured on Oct 14, 2026: "Ohtani splits" scrolled, then sat 470px down.
const HOLD_MS = 3000
const HOLD_CHECKS = [400, 900, 1600, 2400, HOLD_MS]

/** Put `el` back at the top whenever it has drifted, until the card settles or the reader moves. */
function holdInView(el: Element): void {
  let stopped = false
  const stop = () => { stopped = true }
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
  for (const e of events) window.addEventListener(e, stop, { once: true, passive: true, capture: true })
  // Where the heading sat after the last scroll this put it in place with. Not a fixed offset: in a
  // sheet the scroller starts below the sheet's own header, so "in place" is lower down the screen.
  // Unknown until the first check, since the opening scroll may still be easing.
  let placed: number | null = null
  for (const ms of HOLD_CHECKS) {
    setTimeout(() => {
      if (!stopped && el.isConnected) {
        const top = el.getBoundingClientRect().top
        if (placed == null || Math.abs(top - placed) > 8) {
          el.scrollIntoView({ block: 'start', behavior: 'auto' })
          placed = el.getBoundingClientRect().top
        }
      }
      if (ms === HOLD_MS) for (const e of events) window.removeEventListener(e, stop, { capture: true })
    }, ms)
  }
}
