import { describe, it, expect } from 'vitest'
import { niceDomain, niceTicks, placeLabels, sharedDomain, sumLevels, sumSegment } from '../charts/scale'

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
