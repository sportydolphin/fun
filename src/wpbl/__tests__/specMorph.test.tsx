import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMorphedScores, MORPH_MS } from '../TeamSpecRadar'

// The spec chart tweens from one club's hexagon to the next. Six spokes in the same order on
// every club, so the whole animation is six lerps, and the only thing that can really go wrong
// is that it never arrives.

const SF = [78, 66, 53, 5, 50, 93]
const BOS = [5, 5, 71, 100, 20, 5]

/** A hand-driven `requestAnimationFrame`, so a test decides when frames happen and whether
 *  they happen at all. `performance.now` is pinned so the hook's own start stamp is known. */
function stubRaf() {
  const queue: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  return {
    /** Run the one pending frame at `t` ms into the tween. */
    frame(t: number) {
      const cb = queue.shift()
      if (cb) act(() => { cb(1000 + t) })
    },
    pending: () => queue.length,
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('useMorphedScores', () => {
  it('starts on the target, so a first paint is not an animation from nowhere', () => {
    stubRaf()
    const { result } = renderHook(({ t }) => useMorphedScores(t, true), { initialProps: { t: SF } })
    expect(result.current).toEqual(SF)
  })

  it('moves through the gap rather than jumping', () => {
    const raf = stubRaf()
    const { result, rerender } = renderHook(({ t }) => useMorphedScores(t, true), { initialProps: { t: SF } })
    rerender({ t: BOS })
    // Still on the old shape until a frame runs: that is where the tween sets off from.
    expect(result.current).toEqual(SF)

    raf.frame(MORPH_MS / 2)
    const mid = result.current!
    // Every spoke is strictly between the two clubs, on whichever side of its own gap.
    for (let i = 0; i < SF.length; i++) {
      const [lo, hi] = SF[i] < BOS[i] ? [SF[i], BOS[i]] : [BOS[i], SF[i]]
      expect(mid[i]).toBeGreaterThan(lo)
      expect(mid[i]).toBeLessThan(hi)
    }

    raf.frame(MORPH_MS)
    expect(result.current).toEqual(BOS)
  })

  it('sets off from where it currently IS when interrupted', () => {
    const raf = stubRaf()
    const { result, rerender } = renderHook(({ t }) => useMorphedScores(t, true), { initialProps: { t: SF } })
    rerender({ t: BOS })
    raf.frame(MORPH_MS / 2)
    const mid = result.current!
    // A third club tapped mid-flight. The next tween has to start from the half-drawn shape,
    // not from Boston: starting from the target would snap the polygon forward to a shape the
    // reader never saw before setting out again.
    rerender({ t: SF })
    expect(result.current).toEqual(mid)
  })

  // THE BUG THIS FILE EXISTS FOR. A hidden or backgrounded tab does not throttle
  // requestAnimationFrame, it stops calling it, so a version driven by frames alone left the
  // polygon frozen on the previous club under the new club's name and numbers. Found by the
  // browser harness, which runs the page in a hidden pane and so never fires a frame at all.
  it('still arrives when no frame ever runs', () => {
    const raf = stubRaf()
    const { result, rerender } = renderHook(({ t }) => useMorphedScores(t, true), { initialProps: { t: SF } })
    rerender({ t: BOS })
    expect(raf.pending()).toBe(1)   // a frame was asked for
    act(() => { vi.advanceTimersByTime(MORPH_MS + 200) })  // and never came
    expect(result.current).toEqual(BOS)
  })

  it('cuts straight to the target when motion is not wanted', () => {
    const raf = stubRaf()
    const { result, rerender } = renderHook(({ t }) => useMorphedScores(t, false), { initialProps: { t: SF } })
    rerender({ t: BOS })
    expect(result.current).toEqual(BOS)
    expect(raf.pending()).toBe(0)
  })
})
