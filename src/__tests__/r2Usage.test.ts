import { describe, expect, it } from 'vitest'
import {
  accountUsage, alertKey, formatBytes, monthStart, operationClass, sumOperations,
} from '../../shared/r2Usage.js'

describe('operationClass', () => {
  it('sorts reads into B, deletes into free and everything else into A', () => {
    expect(operationClass('GetObject')).toBe('B')
    expect(operationClass('HeadObject')).toBe('B')
    expect(operationClass('PutObject')).toBe('A')
    expect(operationClass('ListObjects')).toBe('A')
    expect(operationClass('DeleteObject')).toBe('free')
  })

  it('counts an action it has never seen as a write, so a new one over-counts rather than vanishes', () => {
    expect(operationClass('SomeFutureAction')).toBe('A')
  })
})

describe('sumOperations', () => {
  it('sums per bucket and drops free actions', () => {
    const m = sumOperations([
      { bucket: 'pub', action: 'PutObject', requests: 4 },
      { bucket: 'pub', action: 'GetObject', requests: 100 },
      { bucket: 'pub', action: 'ListObjects', requests: 1 },
      { bucket: 'pub', action: 'DeleteObject', requests: 50 },
      { bucket: 'priv', action: 'PutObject', requests: 2 },
    ])
    expect(m.get('pub')).toEqual({ classA: 5, classB: 100 })
    expect(m.get('priv')).toEqual({ classA: 2, classB: 0 })
  })
})

describe('accountUsage', () => {
  const row = (gb: number, a = 0, b = 0) =>
    ({ payload_bytes: gb * 1e9, metadata_bytes: 0, class_a_month: a, class_b_month: b })

  it('adds every bucket, since the free tier is per account', () => {
    const u = accountUsage([row(3), row(2)])
    expect(u.storageBytes).toBe(5e9)
    expect(u.shares.storage).toBeCloseTo(0.5)
    expect(u.over).toEqual([])
  })

  it('flags each allowance at or past 80%', () => {
    const u = accountUsage([row(8, 900_000, 1_000)])
    expect(u.over).toEqual(['storage', 'classA'])
  })
})

describe('dates and bytes', () => {
  it('keys an alert by allowance and UTC month', () => {
    expect(alertKey('storage', new Date('2026-11-30T23:59:00Z'))).toBe('storage:2026-11')
  })

  it('starts the billing window at the UTC month', () => {
    expect(monthStart(new Date('2026-11-12T08:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('prints bytes the way the card does', () => {
    expect(formatBytes(225_400_000)).toBe('225 MB')
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB')
    expect(formatBytes(512)).toBe('512 B')
  })
})
