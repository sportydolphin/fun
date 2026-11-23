import { describe, it, expect } from 'vitest'
import { printedRanks } from '../leaders'
import { finderRanks } from '../finderBoard'

describe('the one rank rule', () => {
  it('ties on the number as printed and marks every row in the tie', () => {
    expect(printedRanks(['.412', '.400', '.400', '.388'])).toEqual([
      { rank: 1, tied: false }, { rank: 2, tied: true }, { rank: 2, tied: true }, { rank: 4, tied: false },
    ])
  })

  it('never ties two dashes: a dash is no number at all', () => {
    expect(printedRanks(['3', '—', '—'])).toEqual([
      { rank: 1, tied: false }, { rank: 2, tied: false }, { rank: 3, tied: false },
    ])
  })
})

describe("Find's ranks", () => {
  const rows = [4, 4, 4, 3].map(h => ({ values: { h, ab: 4 } }))

  it('rank on the column the rows are ordered by', () => {
    // Nine lines at 4 H numbered 1 to 9 claimed an order nobody could see.
    expect(finderRanks('hitting', rows, { key: 'h', desc: true }).map(r => r.tied ? `T-${r.rank}` : String(r.rank)))
      .toEqual(['T-1', 'T-1', 'T-1', '4'])
  })

  it('number a date order plainly, since it is a list and not a standing', () => {
    expect(finderRanks('hitting', rows, { key: 'date', desc: true }).map(r => r.rank)).toEqual([1, 2, 3, 4])
  })
})
