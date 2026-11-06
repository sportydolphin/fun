import { describe, it, expect } from 'vitest'
import { groupMoreRows } from '../MoreMenu'

describe('groupMoreRows', () => {
  // The footer appends Data sources (Reference) after the dev-only World Cup row (International).
  // Grouped by consecutive runs, that made two Reference columns sharing one React key.
  it('puts a group’s rows under one heading wherever they sit', () => {
    const rows = [
      { group: 'Reference', href: 'a' }, { group: 'International', href: 'b' }, { group: 'Reference', href: 'c' },
    ]
    expect(groupMoreRows(rows).map(g => [g.group, g.rows.map(r => r.href)]))
      .toEqual([['Reference', ['a', 'c']], ['International', ['b']]])
  })
})
