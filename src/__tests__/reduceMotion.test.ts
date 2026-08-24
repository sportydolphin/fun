import { describe, it, expect, beforeEach } from 'vitest'
import { REDUCE_MOTION_KEY } from '../AccessibilityContext'
import { prefersReducedMotion } from '../lib/motion'

// The Settings toggle writes REDUCE_MOTION_KEY, and lib/motion.ts reads the SAME string to
// honour the choice for JS-driven smooth scrolling (which CSS can't reach). The two hold that
// string independently to keep the util free of React, so this pins them together: if the key
// ever drifts on one side, forcing motion off would silently stop reaching the scroll code.
describe('reduce-motion override', () => {
  beforeEach(() => { localStorage.removeItem(REDUCE_MOTION_KEY) })

  it('prefersReducedMotion honours the Settings key when it is set', () => {
    expect(prefersReducedMotion()).toBe(false)     // jsdom has no reduce-motion media query
    localStorage.setItem(REDUCE_MOTION_KEY, '1')
    expect(prefersReducedMotion()).toBe(true)
  })

  it('a cleared or off key defers to the OS query (false in jsdom)', () => {
    localStorage.setItem(REDUCE_MOTION_KEY, '0')
    expect(prefersReducedMotion()).toBe(false)
  })
})
