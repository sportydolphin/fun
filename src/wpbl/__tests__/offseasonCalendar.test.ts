import { describe, expect, it } from 'vitest'
import { nextOpeningDay, offseasonByCalendar } from '../offseasonCalendar'
import { POSTSEASON_SCHEDULE } from '../derive/bracket'

const last = Object.values(POSTSEASON_SCHEDULE).flat().map(g => g.date).sort().slice(-1)[0]
const day = (iso: string) => Date.parse(`${iso}T18:00:00Z`)
const nextYear = Number(last.slice(0, 4)) + 1

describe('offseasonByCalendar', () => {
  it('is in season up to the last published postseason date', () => {
    expect(offseasonByCalendar(day(last), null)).toBe(false)
  })

  it('is the offseason after it, with no opener known', () => {
    expect(offseasonByCalendar(day(`${nextYear}-01-15`), null)).toBe(true)
    expect(offseasonByCalendar(day(`${nextYear}-07-15`), null)).toBe(true)
  })

  it('ends on the remembered next Opening Day', () => {
    const opener = `${nextYear}-05-02`
    expect(offseasonByCalendar(day(`${nextYear}-05-01`), opener)).toBe(true)
    expect(offseasonByCalendar(day(opener), opener)).toBe(false)
    expect(offseasonByCalendar(day(`${nextYear}-08-20`), opener)).toBe(false)
  })

  it('ignores an opener from before the published final, which is last year\'s', () => {
    const stale = `${Number(last.slice(0, 4))}-05-02`
    expect(offseasonByCalendar(day(`${nextYear}-01-15`), stale)).toBe(true)
  })
})

describe('nextOpeningDay', () => {
  it('is the first game of a later season than the current one', () => {
    const games = [
      { game_date: '2026-08-01' }, { game_date: '2027-05-09' }, { game_date: '2027-05-02' },
    ]
    expect(nextOpeningDay(games, 2026)).toBe('2027-05-02')
    expect(nextOpeningDay(games, 2027)).toBeNull()
    expect(nextOpeningDay(games, null)).toBeNull()
  })
})
