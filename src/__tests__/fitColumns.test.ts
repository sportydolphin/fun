import { describe, expect, it } from 'vitest'
import { dropSequence } from '../ui/fitColumns'

describe('dropSequence', () => {
  it('drops unnamed rarities before the counts, and never H before HBP', () => {
    const standard = ['G', 'PA', 'R', 'H', '2B', 'HR', 'RBI', 'BB', 'SO', 'SB', 'CS', 'AVG', 'OBP', 'SLG', 'OPS', 'HBP', 'SH']
    const seq = dropSequence(standard)
    expect(seq.slice(0, 3)).toEqual(['SH', 'HBP', 'CS'])
    expect(seq.indexOf('H')).toBe(seq.length - 1)
  })
  it('never drops the slash line, PA, HR or WAR', () => {
    const seq = dropSequence(['G', 'PA', 'HR', 'AVG', 'OBP', 'SLG', 'OPS', 'wOBA', 'wRC+', 'Pos WAR'])
    expect(seq).toEqual(['G'])
  })
  it('takes a column no list names from the right', () => {
    expect(dropSequence(['OPS+', 'ISO', 'BABIP', 'WAR', 'Bat', 'BsR']).slice(0, 2)).toEqual(['BsR', 'Bat'])
  })
})
