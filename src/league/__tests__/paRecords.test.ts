import { describe, it, expect } from 'vitest'
import { paRecordQuestion } from '../../finderSearch'
import { measureText } from '../paRecords'

// A plate-appearance record is a superlative the Find parser has no word for, with whatever else was
// typed read by that parser as a filter. These pin the measure each phrasing means, the side it is
// filed under, the filters it keeps, and the phrasings that must stay something else.

const ask = (t: string) => paRecordQuestion('wpbl', t)
const fields = (t: string) => ask(t)?.conditions.map(c => `${c.field}.${c.op}.${c.value}`)

describe('paRecordQuestion', () => {
  it('reads the longest at-bat however it is said', () => {
    for (const t of ['longest at-bat', 'longest at bat', 'longest AB', 'longest plate appearance', "what's the longest at-bat?", 'most pitches in a PA', 'most pitches seen in an at-bat'])
      expect(ask(t), t).toMatchObject({ measure: { field: 'pitches', side: 'hitting' }, conditions: [{ field: 'pitches', op: 'gte', value: 1 }] })
  })

  it('files the pitcher-side phrasings under the pitcher', () => {
    expect(ask('most pitches thrown to one batter')!.measure).toMatchObject({ field: 'pitches', side: 'pitching' })
    expect(ask('most strikes to a single batter')!.measure).toMatchObject({ field: 'strikes', side: 'pitching' })
    expect(ask('most strikeouts in a row')!.measure).toMatchObject({ field: 'krow', side: 'pitching' })
    for (const t of ['most consecutive outs', 'most batters retired in a row', 'longest streak of batters retired'])
      expect(ask(t)!.measure.field, t).toBe('retired')
  })

  it('reads fouls with or without a grain', () => {
    for (const t of ['most fouls', 'most foul balls', 'most fouls in a PA', 'most foul balls fought off in an at-bat'])
      expect(ask(t)!.measure.field, t).toBe('fouls')
  })

  it('keeps the event as a filter, ranked by the measure', () => {
    expect(fields('longest strikeout')).toEqual(['pitches.gte.1', 'so.gte.1'])
    expect(fields('longest walk')).toEqual(['pitches.gte.1', 'bb.gte.1'])
    expect(fields('longest at-bat ending in a home run')).toEqual(['pitches.gte.1', 'hr.gte.1'])
    expect(fields('most pitches in a walk')).toEqual(['pitches.gte.1', 'bb.gte.1'])
    expect(ask('most fouls before a strikeout')!.title).toBe('Most fouls in a strikeout')
  })

  it('keeps the situation, the club and the opponent', () => {
    expect(fields('longest walk with the bases loaded')).toEqual(['pitches.gte.1', 'on.eq.3', 'bb.gte.1'])
    expect(fields('most fouls in a pa with 2 outs')).toEqual(['fouls.gte.1', 'paouts.eq.2'])
    expect(fields('longest at-bat in the 7th')).toEqual(['pitches.gte.1', 'inn.eq.7'])
    expect(ask('longest at-bat by the Firebells')).toMatchObject({ teamId: 'SF', title: 'Longest at-bat by the Firebells' })
    expect(ask('longest at-bat vs Queens')!.oppId).toBe('LA')
  })

  it('reads the season and the playoffs', () => {
    expect(ask('longest at-bat of 2026')!.season).toBe(2026)
    expect(ask('longest at-bat ever')!.season).toBe('all')
    expect(ask('longest at-bat in the playoffs')!.scope).toBe('postseason')
    expect(ask('longest at-bat including playoffs')!.scope).toBe('all')
    expect(ask('longest at-bat')!.scope).toBe('regular')
  })

  it('leaves distance, single games, rankings and names alone', () => {
    // A home run's length is TrackMan's distance, which two games of data cannot rank.
    for (const t of ['longest home run', 'longest hit', 'most pitches in a game', 'most hr', 'most strikeouts', 'longest outing', 'longest at-bat by Whitmore', 'Whitmore'])
      expect(ask(t), t).toBeNull()
    expect(paRecordQuestion('mlb', 'longest at-bat')).toBeNull()
  })
})

describe('measureText', () => {
  it('says one and many', () => {
    expect(measureText({ field: 'pitches', side: 'hitting', unit: ['pitch', 'pitches'] }, 1)).toBe('1 pitch')
    expect(measureText({ field: 'krow', side: 'pitching', unit: ['strikeout in a row', 'strikeouts in a row'] }, 4)).toBe('4 strikeouts in a row')
  })
})
