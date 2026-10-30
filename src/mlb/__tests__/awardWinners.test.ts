import { describe, it, expect } from 'vitest'
import { AWARDS, parseAwardWinners, isSettled, awardCardRows, positionCounts, awardSections } from '../awardWinners'
import type { AwardWinner } from '../awardWinners'

const def = (code: string) => AWARDS.find(d => d.code === code)!

function feed(code: string, ...people: Array<[number, string, string, number, string]>) {
  return parseAwardWinners(def(code), {
    awards: people.map(([id, name, pos, team, date]) => ({
      date, team: { id: team }, player: { id, nameFirstLast: name, primaryPosition: { abbreviation: pos } },
    })),
  })
}

const skubal = feed('ALCY', [669373, 'Tarik Skubal', 'P', 116, '2025-11-12'])
const skenes = feed('NLCY', [694973, 'Paul Skenes', 'P', 134, '2025-11-12'])
const vogt = feed('ALMOY', [1, 'Stephen Vogt', 'X', 114, '2025-11-11'])
const contreras = feed('WSMVP', [661388, 'William Contreras', 'C', 158, '2026-10-28'])
const gloves = feed('ALGG',
  [677951, 'Bobby Witt Jr.', 'SS', 118, '2025-11-02'],
  [543877, 'Christian Vazquez', 'C', 142, '2025-11-02'],
)

describe('parseAwardWinners', () => {
  it('reads an award the feed has not given as nobody', () => {
    expect(parseAwardWinners(def('ALMVP'), { awards: [] })).toEqual([])
    expect(parseAwardWinners(def('ALMVP'), null)).toEqual([])
  })

  it('gives a manager no player page and no position', () => {
    expect(vogt[0]).toMatchObject({ playerId: null, position: null, name: 'Stephen Vogt', teamId: 114 })
    expect(skubal[0]).toMatchObject({ playerId: 669373, position: 'P' })
  })
})

describe('isSettled', () => {
  it('rereads an award for three days, in case its class is still being published', () => {
    expect(isSettled(gloves, '2025-11-04')).toBe(false)
    expect(isSettled(gloves, '2025-11-05')).toBe(true)
  })

  it('never settles nothing, or a winner with no date', () => {
    expect(isSettled([], '2026-01-01')).toBe(false)
    expect(isSettled([{ ...skubal[0], date: '' }], '2026-01-01')).toBe(false)
  })
})

describe('awardCardRows', () => {
  const all: AwardWinner[] = [...vogt, ...skenes, ...skubal, ...contreras, ...gloves]
  const names = (rows: AwardWinner[]) => rows.map(r => r.name)

  it('puts the newest first, AL above NL on the same day', () => {
    expect(names(awardCardRows([...vogt, ...skenes, ...skubal], null, false)))
      .toEqual(['Tarik Skubal', 'Paul Skenes', 'Stephen Vogt'])
  })

  it('holds the World Series MVP back while the champion card names it', () => {
    expect(names(awardCardRows(all, null, false))).not.toContain('William Contreras')
    expect(names(awardCardRows(all, null, true))).toContain('William Contreras')
  })

  it('lists a position class only for the followed club', () => {
    expect(names(awardCardRows(all, null, false))).not.toContain('Bobby Witt Jr.')
    expect(names(awardCardRows(all, 118, false))).toContain('Bobby Witt Jr.')
    expect(names(awardCardRows(all, 118, false))).not.toContain('Christian Vazquez')
  })
})

describe('positionCounts and awardSections', () => {
  it('counts each class, and shows none before one is given', () => {
    expect(positionCounts(gloves)).toEqual([{ group: 'Gold Glove', count: 2 }])
    expect(positionCounts(skubal)).toEqual([])
  })

  it('sorts a class around the diamond and drops awards not given', () => {
    const sections = awardSections([...gloves, ...skubal])
    expect(sections.map(s => s.label)).toEqual(['AL Cy Young', 'AL Gold Glove'])
    expect(sections[1].winners.map(w => w.position)).toEqual(['C', 'SS'])
  })
})
