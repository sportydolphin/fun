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
  })
}
