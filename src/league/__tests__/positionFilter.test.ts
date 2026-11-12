import { describe, expect, it } from 'vitest'
import { matchesPositionFilter, parsePositionFilter, positionOnSide, positionOptions } from '../positionFilter'

// The stats boards' Position picker (Nov 11, 2026): which choices each side offers, and a choice made
// on one side kept, not applied, while the reader looks at a side that cannot take it.

describe('the picker', () => {
  it('offers the positions a side can mean', () => {
    expect(positionOptions('hitting').map(d => d.key)).toEqual(['C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'DH'])
    expect(positionOptions('pitching').map(d => d.key)).toEqual(['SP', 'RP'])
    expect(positionOptions('fielding').map(d => d.key)).not.toContain('DH')
    expect(positionOptions('overall').map(d => d.key)).toContain('P')
  })

  it('keeps a choice only on a side that offers it', () => {
    expect(positionOnSide('SP', 'pitching')).toBe('SP')
    expect(positionOnSide('SP', 'hitting')).toBeNull()
    expect(positionOnSide('DH', 'fielding')).toBeNull()
    expect(positionOnSide(null, 'hitting')).toBeNull()
  })

  it('reads the address and matches the label the board prints', () => {
    expect(parsePositionFilter('ss')).toBe('SS')
    expect(parsePositionFilter('shortstop')).toBeNull()
    expect(matchesPositionFilter('IF', 'SS/2B')).toBe(true)
    expect(matchesPositionFilter('OF', 'CF')).toBe(true)
    expect(matchesPositionFilter('SP', 'P', { g: 10, gs: 5 })).toBe(true)
    expect(matchesPositionFilter('RP', 'P', { g: 10, gs: 4 })).toBe(true)
  })
})
