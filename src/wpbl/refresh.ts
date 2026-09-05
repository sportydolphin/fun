import { useEffect, useRef } from 'react'

/**
 * The section's one polling policy: tick only while the page is actually in front, and pull
 * once, immediately, whenever it comes back.
 *
 * WHY IT IS A SHARED HOOK AND NOT FOUR EFFECTS. It was four. The schedule poll in WpblApp
 * stopped its timer while the tab was hidden and refreshed on the way back (a phone throttles
 * a background timer but does not stop it, so it was waking the radio for a screen that is
 * off); the live game poll, the Game Center reload and Home's box-score refresh did none of
 * that and ran flat out against a hidden tab, which is the more expensive half: the Game Center
 * reload is five queries every fifteen seconds for a three-hour game. One of the four had the
 * policy and the other three had never been told about it, which is what a policy living in an
 * effect body looks like a year later.
 *
 * PAGESHOW IS THE PART THAT WAS MISSING EVERYWHERE, and it is the only one of the three
 * listeners that can be the ONLY one to fire. A page restored from the back/forward cache
 * (iOS Safari does this on every back gesture, and it is how the installed PWA resumes) comes
 * back with its timers frozen and, on some restores, without a `visibilitychange` at all.
 * Nothing then restarts the interval, so the page keeps rendering whatever it held when it
 * was frozen, indefinitely, with no error and nothing on screen admitting it is old. That is
 * a whole game shown as "starting soon" on a phone that has had the tab open since lunchtime.
 *
 * The counterpart is `countdownLabel`, which stops asserting a start it cannot confirm: this
 * hook is what keeps the data behind it moving, and that one is what stops a frozen page from
 * sounding confident. Both are needed. A stale page that says nothing is recoverable; a
 * stale page that says "starting soon" is not.
 *
 * THE 1s GUARD ON THE IMMEDIATE PULL is not a nicety. A bfcache restore can fire `pageshow`,
 * `visibilitychange` and `focus` within a few milliseconds of each other, and without it that
 * is three identical reads on a connection that has just woken up.
 *
 * @param fn what to run. Re-read every render, so it may close over fresh state.
 * @param ms interval in ms, or `null` to run nothing at all (a game that is not live).
 */
export function useForegroundInterval(fn: () => void, ms: number | null): void {
  // The latest callback, so changing it does not tear down and rebuild the timer: a poll
  // whose function identity changes every render would otherwise restart on every render and
  // never actually reach its interval.
  const saved = useRef(fn)
  useEffect(() => { saved.current = fn })

  useEffect(() => {
    if (ms == null) return
    let id: ReturnType<typeof setInterval> | undefined
    let lastRun = 0
    const run = () => { lastRun = Date.now(); saved.current() }
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined } }
    const start = () => {
      stop()
      if (document.visibilityState === 'visible') id = setInterval(run, ms)
    }
    // Back in front: pull at once so the first thing the reader sees is current, then resume
    // ticking. Hidden: stop outright rather than tick against a page nobody is looking at.
    const resume = () => {
      if (document.visibilityState !== 'visible') { stop(); return }
      if (Date.now() - lastRun >= 1000) run()
      start()
    }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) resume() }

    start()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [ms])
}
