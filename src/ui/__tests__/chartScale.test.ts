import { describe, it, expect } from 'vitest'
import { axisValues, labelSpots, leaderLine, niceDomain, niceTicks, placeLabels, sharedDomain, stepDecimals, sumLevels, sumSegment } from '../charts/scale'

describe('niceTicks', () => {
  it('steps on round numbers', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(niceTicks(0.21, 0.49, 4)).toEqual([0.3, 0.4])
  })
})

describe('niceDomain', () => {
  it('widens to whole ticks around the values', () => {
    const d = niceDomain([0.212, 0.455])
    expect(d.lo).toBeLessThanOrEqual(0.212)
    expect(d.hi).toBeGreaterThanOrEqual(0.455)
    expect(d.ticks[0]).toBe(d.lo)
    expect(d.ticks[d.ticks.length - 1]).toBe(d.hi)
  })

  it('never opens a stretch below the floor', () => {
    expect(niceDomain([0.01, 0.3], { floor: 0 }).lo).toBe(0)
  })

  it('never draws a gridline past the ceiling', () => {
    // Contact% padded and rounded out to whole ticks used to print a 110% line.
    const d = niceDomain([0.62, 0.985], { floor: 0, ceil: 1 })
    expect(d.hi).toBe(1)
    expect(Math.max(...d.ticks)).toBeLessThanOrEqual(1)
  })

  it('still holds every value under a ceiling off the tick grid', () => {
    const d = niceDomain([0.1, 0.93], { ceil: 0.95 })
    expect(d.hi).toBeGreaterThanOrEqual(0.93)
    expect(Math.max(...d.ticks)).toBeLessThanOrEqual(0.95)
  })

  it('reaches a value the points do not, for a crosshair', () => {
    expect(niceDomain([0.3, 0.4], { include: [0.1] }).lo).toBeLessThanOrEqual(0.1)
  })

  it('opens a window around a single value rather than dividing by zero', () => {
    const d = niceDomain([2])
    expect(d.lo).toBeLessThan(2)
    expect(d.hi).toBeGreaterThan(2)
  })

  it('shares one domain across two axes', () => {
    const d = sharedDomain([3, 4], [2, 6])
    expect(d.lo).toBeLessThanOrEqual(2)
    expect(d.hi).toBeGreaterThanOrEqual(6)
  })
})

describe('axisValues', () => {
  const regulars = [3.1, 3.4, 3.8, 4.0, 4.2, 4.5, 4.9, 5.3, 9.6].map(v => ({ v, keep: true }))

  it('leaves out a cameo far past the regulars', () => {
    expect(axisValues([...regulars, { v: 27, keep: false }])).not.toContain(27)
  })

  it('keeps a cameo inside the regulars’ spread', () => {
    expect(axisValues([...regulars, { v: 5, keep: false }])).toContain(5)
  })

  it('never cuts a regular, however far out', () => {
    expect(axisValues(regulars)).toContain(9.6)
  })

  it('holds everything when too few are regulars to judge', () => {
    expect(axisValues([{ v: 1, keep: true }, { v: 40, keep: false }])).toEqual([1, 40])
  })
})

describe('stepDecimals', () => {
  it('prints each tick as itself', () => {
    expect(stepDecimals(0.25)).toBe(2)
    expect(stepDecimals(0.5)).toBe(1)
    expect(stepDecimals(2)).toBe(0)
    expect(stepDecimals(0.025)).toBe(3)
    expect(stepDecimals(0.1 + 0.2 - 0.2)).toBe(1)
  })
})

describe('sumSegment', () => {
  const box = { x: { lo: 0.2, hi: 0.5 }, y: { lo: 0.2, hi: 0.7 } }

  it('clips x + y = c to the box', () => {
    const s = sumSegment(0.8, box.x, box.y)!
    expect(s.x1 + s.y1).toBeCloseTo(0.8)
    expect(s.x2 + s.y2).toBeCloseTo(0.8)
    expect(s.x1).toBeCloseTo(0.2)
    expect(s.x2).toBeCloseTo(0.5)
  })

  it('is null for a line that misses the box', () => {
    expect(sumSegment(2, box.x, box.y)).toBeNull()
    expect(sumSegment(0.1, box.x, box.y)).toBeNull()
  })

  it('is null for a line that only touches a corner', () => {
    expect(sumSegment(0.4, box.x, box.y)).toBeNull()
  })

  it('offers only levels that cross the box', () => {
    const levels = sumLevels(box.x, box.y)
    expect(levels.length).toBeGreaterThan(0)
    for (const c of levels) expect(sumSegment(c, box.x, box.y)).not.toBeNull()
  })
})

describe('placeLabels', () => {
  const box = (x: number) => ({ x, y: 0, w: 40, h: 10 })

  it('drops the later of two labels that collide on every side', () => {
    const kept = placeLabels([
      { item: 'a', spots: [box(0)] },
      { item: 'b', spots: [box(20)] },
      { item: 'c', spots: [box(100)] },
    ])
    expect(kept).toEqual([{ item: 'a', spot: 0 }, { item: 'c', spot: 0 }])
  })

  it('moves a label to its other side before dropping it', () => {
    const kept = placeLabels([
      { item: 'a', spots: [box(0)] },
      { item: 'b', spots: [box(20), box(200)] },
    ])
    expect(kept).toEqual([{ item: 'a', spot: 0 }, { item: 'b', spot: 1 }])
  })

  it('never puts a label on another labeled dot, but may touch its own', () => {
    const own = { x: 0, y: 0, w: 8, h: 8 }
    const other = { x: 50, y: 0, w: 8, h: 8 }
    const kept = placeLabels([{ item: 'a', spots: [{ x: 4, y: 0, w: 60, h: 10 }, { x: -70, y: 0, w: 60, h: 10 }], own }], [own, other])
    expect(kept).toEqual([{ item: 'a', spot: 1 }])
  })
})

describe('labelSpots', () => {
  const spots = labelSpots(100, 100, 6, 40, 11)

  it('tries beside the dot first, then above and below, then farther out with a leader', () => {
    expect(spots[0].anchor).toBe('start')
    expect(spots[0].box.x).toBeGreaterThan(106)
    expect(spots[1].anchor).toBe('end')
    expect(spots[1].box.x + spots[1].box.w).toBeLessThan(94)
    expect(spots[2].box.y + spots[2].box.h).toBeLessThanOrEqual(100)
    expect(spots[3].box.y).toBeGreaterThanOrEqual(100)
    expect(spots.slice(0, 8).every(s => !s.leader)).toBe(true)
    expect(spots.slice(8).every(s => s.leader)).toBe(true)
  })

  it("never covers its own dot's center", () => {
    const core = { x: 97, y: 97, w: 6, h: 6 }
    for (const s of spots) expect(s.box.x < core.x + core.w && core.x < s.box.x + s.box.w && s.box.y < core.y + core.h && core.y < s.box.y + s.box.h).toBe(false)
  })

  it("runs a leader from the dot's edge to the label", () => {
    const l = leaderLine(0, 0, 5, { x: 20, y: -5, w: 30, h: 10 })
    expect(l.x1).toBeCloseTo(6)
    expect(l.x2).toBe(20)
    expect(l.y2).toBe(0)
  })
})
