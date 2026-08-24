// ─── Reduced motion ───────────────────────────────────────────────────────────
//
// The CSS half of this lives in src/styles.css, which collapses every transition and
// animation on the page when the reader has asked their OS for less motion, or has forced it
// on from Settings (the `data-reduce-motion` attribute).
//
// This is the half CSS can't do. `scroll-behavior: auto` in a stylesheet is overridden by an
// explicit `element.scrollTo({ behavior: 'smooth' })`, because the option wins over the property,
// so every programmatic smooth scroll has to ask the question itself. That's what this is
// for: `scrollBehavior()` returns what to pass, and reads correctly on browsers with no
// matchMedia at all (old Safari, SSR, jsdom in tests).

// The in-app Settings toggle's localStorage key. Duplicated as a bare string rather than
// imported from AccessibilityContext so this util stays free of any React dependency; the two
// are pinned together by src/__tests__ so they cannot drift.
const REDUCE_MOTION_KEY = 'a11yReduceMotion'

export function prefersReducedMotion(): boolean {
  // The explicit override wins first: someone who set it wants it honoured even on a device
  // whose OS never asks the question.
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(REDUCE_MOTION_KEY) === '1') return true
  } catch {
    /* storage blocked (private mode) — fall through to the OS query */
  }
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Drop-in for the `behavior` option of scrollTo / scrollBy / scrollIntoView. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
