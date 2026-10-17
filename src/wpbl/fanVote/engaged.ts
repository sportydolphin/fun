import { useSyncExternalStore } from 'react'

// ─── has this reader dealt with the ballot yet ───────────────────────────────────

/**
 * ONE BIT: has this browser opened the ballot or voted in it.
 *
 * It exists for the strip at the top of Home, which is an invitation, and an invitation that
 * keeps arriving after you have accepted it is nagging. Once you have been in, the ballot card
 * further down the page is the surface that tells you where your five answers stand; the strip
 * has nothing left to say and takes the first line of a phone screen to say it.
 *
 * A LOCAL FLAG RATHER THAN A READ OF THE BALLOT, deliberately. The strip runs no hooks and
 * makes no query on purpose (see FanAwardsCta), and asking the server whether you have voted
 * would mean the strip paints, waits, and then vanishes under the reader's thumb on every load
 * for the rest of the week. This answers before first paint or not at all. The cost is that it
 * is per browser: voting on a phone does not take the strip off a laptop, which is the right
 * way round for a piece of chrome that only ever appears on a phone anyway.
 *
 * A MODULE SINGLETON because the writer (the sheet, the vote) and the reader (the strip) are
 * in different trees, so this has to cross Home without either of them owning it. Same shape as
 * lib/notifications.ts.
 *
 * NOT A DISMISSAL. There is no way back once it is set, and there does not need to be: the
 * thing it hides is a shortcut to a card that is still on the same page, and voting closes on
 * its own a few days later.
 */
const AWARDS_ENGAGED_KEY = 'wpbl.awards.engaged'

let awardsEngaged = (() => {
  try { return localStorage.getItem(AWARDS_ENGAGED_KEY) === '1' } catch { return false }
})()
const engagedListeners = new Set<() => void>()

/** Opened the ballot, or answered a question in it. Idempotent: the second call is free. */
export function markFanAwardsEngaged(): void {
  if (awardsEngaged) return
  awardsEngaged = true
  try { localStorage.setItem(AWARDS_ENGAGED_KEY, '1') } catch { /* private mode / quota: the
    strip simply comes back next load, which is the harmless direction to fail in */ }
  for (const fn of engagedListeners) fn()
}

const subscribeEngaged = (fn: () => void) => { engagedListeners.add(fn); return () => { engagedListeners.delete(fn) } }
const engagedSnapshot = () => awardsEngaged

/** Reads the bit and re-renders when it flips, so the strip goes the moment the sheet opens
 *  under it rather than on the next load. */
export function useFanAwardsEngaged(): boolean {
  return useSyncExternalStore(subscribeEngaged, engagedSnapshot, engagedSnapshot)
}
