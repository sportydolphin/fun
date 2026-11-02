import { describe, expect, it } from 'vitest'
import { summaryCovered, type StatRow } from '../playerCard'

const row = (...labels: string[]): StatRow => ({ lead: '2026', cols: labels.map(label => ({ label, value: 0 })) })

// With All stats open the summary steps aside only when nothing on it would be lost: drawn over the
// full tables it printed ten figures twice, hidden with a column the others lack it would drop one.
describe('summaryCovered', () => {
  it('is covered when every column is in a full table', () => {
    expect(summaryCovered(row('G', 'PA', 'AVG', 'WAR'), [row('G', 'PA', 'AVG'), row('WAR')])).toBe(true)
  })
  it('reads a record as its two halves', () => {
    expect(summaryCovered(row('W-L', 'ERA'), [row('W', 'L', 'ERA')])).toBe(true)
    expect(summaryCovered(row('W-L'), [row('W')])).toBe(false)
  })
  it('stays when a column is missing from every full table', () => {
    expect(summaryCovered(row('G', 'FIP'), [row('G'), null])).toBe(false)
  })
})
