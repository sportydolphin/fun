// ─── Reduced motion ───────────────────────────────────────────────────────────
//
// The CSS half of this lives in src/styles.css, which collapses every transition and
// animation on the page when the reader has asked their OS for less motion.
//
// This is the half CSS can't do. `scroll-behavior: auto` in a stylesheet is overridden by an
// explicit `element.scrollTo({ behavior: 'smooth' })`, because the option wins over the property,
// so every programmatic smooth scroll has to ask the question itself. That's what this is
// for: `scrollBehavior()` returns what to pass, and reads correctly on browsers with no
// matchMedia at all (old Safari, SSR, jsdom in tests).

export function prefersReducedMotion(): boolean {
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
