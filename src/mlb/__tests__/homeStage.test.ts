import { describe, it, expect } from 'vitest'
import { homeStageOn, CHAMPION_DAYS } from '../seasonPhase'
import { buildBracket, clinchGame, parseSeriesMvp } from '../postseason'
import done2025 from './fixtures/postseason-2025.json'
import open2026 from './fixtures/postseason-2026.json'

// Home's shape follows the last out, not the league's calendar: in 2026 the World Series ended on
// Oct 28 and the calendar said "postseason" to Oct 31.

const over = buildBracket(2025, done2025)!
const open = buildBracket(2026, open2026)!
const clinched = clinchGame(over.series.W_1)!.startMs
const DAY = 86_400_000

describe('homeStageOn', () => {
  it('needs no bracket in the regular season', () => {
    expect(homeStageOn('regular', undefined)).toBe('regular')
    expect(homeStageOn('preseason', undefined)).toBe('winter')
  })

  it('waits for the phase, and for the bracket past the regular season', () => {
    expect(homeStageOn(null, over)).toBeNull()
    expect(homeStageOn('postseason', undefined)).toBeNull()
    expect(homeStageOn('offseason', undefined)).toBeNull()
  })

  it('is the postseason until the bracket has a champion, whatever the calendar still says', () => {
    expect(homeStageOn('postseason', open)).toBe('postseason')
    expect(homeStageOn('postseason', over, clinched + DAY)).toBe('champion')
  })

  it('leads with the champion for a week across Nov 1, then turns to winter', () => {
    expect(homeStageOn('offseason', over, clinched + (CHAMPION_DAYS - 1) * DAY)).toBe('champion')
    expect(homeStageOn('offseason', over, clinched + (CHAMPION_DAYS + 1) * DAY)).toBe('winter')
  })

  it('falls back to the calendar with no bracket to read', () => {
    expect(homeStageOn('postseason', null)).toBe('postseason')
    expect(homeStageOn('offseason', null)).toBe('winter')
  })

  it('reads an unfinished bracket as winter once the calendar is past the postseason', () => {
    expect(homeStageOn('offseason', open)).toBe('winter')
  })
})

describe('clinchGame', () => {
  it('is the last final of a decided series, and none before one is decided', () => {
    expect(clinchGame(over.series.W_1)!.number).toBe(7)
    expect(clinchGame(open.series.W_1)).toBeNull()
  })
})

describe('parseSeriesMvp', () => {
  it('reads the recipient off the awards feed', () => {
    const raw = { awards: [{ id: 'WSMVP', player: { id: 661388, nameFirstLast: 'William Contreras', primaryPosition: { abbreviation: 'C' } } }] }
    expect(parseSeriesMvp(raw)).toEqual({ id: 661388, name: 'William Contreras', position: 'C' })
  })

  it('is null before one is published', () => {
    expect(parseSeriesMvp({ awards: [] })).toBeNull()
    expect(parseSeriesMvp(null)).toBeNull()
  })
})
