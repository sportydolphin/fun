import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AccessibilityProvider, useAccessibilitySettings, useReducedMotion, REDUCE_MOTION_KEY } from '../AccessibilityContext'

// Anything that keeps moving in JS (the Home photo rail's drift) has to stop the moment the reader
// turns Reduce motion on, not on the next page load. The rail read the setting once at mount, so
// switching it on in Settings with the rail on screen behind the dialog left it drifting.
describe('useReducedMotion', () => {
  beforeEach(() => { localStorage.removeItem(REDUCE_MOTION_KEY) })

  const wrapper = ({ children }: { children: ReactNode }) => <AccessibilityProvider>{children}</AccessibilityProvider>

  it('follows the Settings toggle while mounted', () => {
    const { result } = renderHook(() => ({ reduced: useReducedMotion(), settings: useAccessibilitySettings() }), { wrapper })
    expect(result.current.reduced).toBe(false)
    act(() => result.current.settings.setReduceMotion(true))
    expect(result.current.reduced).toBe(true)
    act(() => result.current.settings.setReduceMotion(false))
    expect(result.current.reduced).toBe(false)
  })

  it('reads the stored choice outside a provider', () => {
    localStorage.setItem(REDUCE_MOTION_KEY, '1')
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })
})
