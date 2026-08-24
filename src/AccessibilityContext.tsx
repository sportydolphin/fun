import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

// ─── Accessibility preferences ────────────────────────────────────────────────
//
// Three settings, kept in one context because they're one group in Settings and one idea to
// the reader. Two of them (swipe, text size) exist because the browser has no way to ask the
// question for us; the third (reduce motion) exists because the reader asked us directly.
//
//   • Swipe navigation. The section's tab pager owns every horizontal drag, so an accidental
//     swipe (a tremor, a thumb resting on the screen, a mis-grab) throws the reader onto a
//     different tab with no way to prevent it. There is no OS preference for "I didn't mean
//     that gesture", and no code fix short of removing the gesture for everyone.
//
//   • Text size. Browser zoom exists, but it scales the whole layout, which reflows the wide
//     stats and lineup grids into something quite different from what the reader had. This
//     scales the TYPE and leaves the layout alone.
//
//   • Reduce motion. The OS `prefers-reduced-motion` query is still the BASELINE, honoured
//     site-wide in src/styles.css, and nobody who set it there has to touch this. This is the
//     explicit override for the reader who wants motion off regardless — a device that never
//     asks, a shared computer they can't change, or simply a preference the OS setting is too
//     blunt to hold. On, it forces the exact same collapse the OS query does (via the
//     `data-reduce-motion` attribute below and a mirrored rule in styles.css), so there is one
//     behaviour, reachable two ways.
//
// All three live in localStorage, like the units and experiments preferences: no account
// needed, so they work for the signed-out majority.

export type TextScale = 'default' | 'large'

/** Root font-size multiplier per setting. 1.125 is 16px → 18px: a real difference for
 *  anyone over about forty, and the largest step the dense numeric tables hold without
 *  their fixed-width columns clipping. */
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = {
  default: 1,
  large: 1.125,
}

const SWIPE_KEY = 'a11ySwipeNav'
const TEXT_KEY = 'a11yTextScale'
// Exported so lib/motion.ts can read the same flag for JS-driven smooth scrolling, which CSS
// cannot reach. Kept a bare string constant (no React) so that import stays cheap.
export const REDUCE_MOTION_KEY = 'a11yReduceMotion'

function readSwipe(): boolean {
  // Default ON: the gesture is a feature for most people, and this is the opt-out.
  try { return localStorage.getItem(SWIPE_KEY) !== '0' } catch { return true }
}

function readTextScale(): TextScale {
  try { return localStorage.getItem(TEXT_KEY) === 'large' ? 'large' : 'default' } catch { return 'default' }
}

function readReduceMotion(): boolean {
  // Default OFF: the OS query is the baseline, and this only ADDS a reason to reduce motion,
  // never removes one. So `off` here means "defer to the OS", not "force motion on".
  try { return localStorage.getItem(REDUCE_MOTION_KEY) === '1' } catch { return false }
}

interface AccessibilityContextValue {
  swipeNav: boolean
  setSwipeNav: (on: boolean) => void
  textScale: TextScale
  setTextScale: (s: TextScale) => void
  reduceMotion: boolean
  setReduceMotion: (on: boolean) => void
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined)

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [swipeNav, setSwipeState] = useState<boolean>(readSwipe)
  const [textScale, setTextState] = useState<TextScale>(readTextScale)
  const [reduceMotion, setReduceState] = useState<boolean>(readReduceMotion)

  const setSwipeNav = useCallback((on: boolean) => {
    setSwipeState(on)
    try { localStorage.setItem(SWIPE_KEY, on ? '1' : '0') } catch { /* choice just isn't kept */ }
  }, [])

  const setReduceMotion = useCallback((on: boolean) => {
    setReduceState(on)
    try { localStorage.setItem(REDUCE_MOTION_KEY, on ? '1' : '0') } catch { /* choice just isn't kept */ }
  }, [])

  const setTextScale = useCallback((s: TextScale) => {
    setTextState(s)
    try { localStorage.setItem(TEXT_KEY, s) } catch { /* choice just isn't kept */ }
  }, [])

  // Scale the ROOT font size, which is what every `rem` on the site resolves against, so
  // type grows and the px-measured boxes around it don't. Published as a variable too, for
  // the handful of fixed-width numeric columns that have to grow with their contents or clip
  // them (see --sd-text-scale usages).
  useEffect(() => {
    const factor = TEXT_SCALE_FACTOR[textScale]
    const root = document.documentElement
    root.style.setProperty('--sd-text-scale', String(factor))
    // Only touch font-size away from the default, so the browser's own "default font size"
    // setting still wins for anyone who has changed it there.
    if (factor === 1) root.style.removeProperty('font-size')
    else root.style.fontSize = `${factor * 100}%`
  }, [textScale])

  // Mark the document when the reader has forced motion off, so the mirrored rule in
  // styles.css collapses every transition and animation exactly as the OS query does. The
  // attribute is toggled rather than a class added, so it can't collide with any className.
  useEffect(() => {
    const root = document.documentElement
    if (reduceMotion) root.setAttribute('data-reduce-motion', '1')
    else root.removeAttribute('data-reduce-motion')
  }, [reduceMotion])

  // Keep other open tabs in sync when a preference changes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SWIPE_KEY) setSwipeState(e.newValue !== '0')
      if (e.key === TEXT_KEY) setTextState(e.newValue === 'large' ? 'large' : 'default')
      if (e.key === REDUCE_MOTION_KEY) setReduceState(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <AccessibilityContext.Provider value={{ swipeNav, setSwipeNav, textScale, setTextScale, reduceMotion, setReduceMotion }}>
      {children}
    </AccessibilityContext.Provider>
  )
}

/** Reads as "swiping is on" outside a provider: the pager should never break a render
 *  because a preference wasn't mounted. */
export function useSwipeNav(): boolean {
  return useContext(AccessibilityContext)?.swipeNav ?? true
}

export function useAccessibilitySettings(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext)
  if (!ctx) throw new Error('useAccessibilitySettings must be used within an AccessibilityProvider')
  return ctx
}
