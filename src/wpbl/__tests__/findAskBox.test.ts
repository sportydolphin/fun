import { describe, it, expect } from 'vitest'
import { EMPTY_FINDER_QUERY } from '../../league/finder'
import { parseFinderText } from '../../league/finderParse'
import { nameSuggestions } from '../../league/playerQuestion'
import { recordSuggestions, scopedRankSuggestions } from '../../finderSearch'
import { askedFinderQuery, WPBL_FINDER_CLUBS, WPBL_FINDER_OPTS, WPBL_FINDER_SIDES, wpblAskReadings, wpblFinderHref, wpblFinderRoster } from '../finderLink'

// The Find board's own "Ask in words" box. It read no names until Nov 19, 2026: "hondras vs rhp" was
// not a question at all, and "hondras hits vs rhp" asked everyone's hits with the name ignored. It also
// dropped the arm and the span on the way to the board, so the preview said "vs RHP" and the answer
// was every pitcher. Both are pinned here through the same helpers the board calls.

const ROSTER = wpblFinderRoster(
  [{ id: 'h', name: 'Amira Hondras' }, { id: 'w', name: 'Kelsie Whitmore' }, { id: 'x', name: 'Never Played' }],
  [{ player_id: 'h', ab: 4, bb: 1, hbp: 0, sf: 0, sh: 0 }],
  [{ player_id: 'w', bf: 20, outs: 15 }],
)
const read = (text: string) => wpblAskReadings(text, ROSTER)

describe('wpblFinderRoster', () => {
  it('knows who hit and who pitched, and leaves out anyone with no line', () => {
    expect(ROSTER.map(p => [p.id, p.hits, p.pitches])).toEqual([['h', true, false], ['w', false, true]])
  })
})

describe('a name in the Find box', () => {
  it('reads "hondras vs rhp" as her season against right-handers', () => {
    const q = askedFinderQuery(EMPTY_FINDER_QUERY, read('hondras vs rhp')[0])
    expect(q).toMatchObject({ per: 'season', playerId: 'h', hand: 'R' })
  })

  it('reads two names as the matchup', () => {
    const q = askedFinderQuery(EMPTY_FINDER_QUERY, read('hondras vs whitmore')[0])
    expect(q).toMatchObject({ per: 'pa', batterId: 'h', pitcherId: 'w' })
  })
})

describe('askedFinderQuery', () => {
  it('keeps the arm a reading without a name says', () => {
    const r = parseFinderText('2 hits vs rhp', WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)[0]
    expect(askedFinderQuery(EMPTY_FINDER_QUERY, r)).toMatchObject({ hand: 'R', conditions: [{ field: 'h', op: 'gte', value: 2 }] })
  })

  it('keeps the player picked on the board when the typed question names none', () => {
    const r = parseFinderText('3 hits', WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)[0]
    expect(askedFinderQuery({ ...EMPTY_FINDER_QUERY, playerId: 'h', hand: 'L' }, r)).toMatchObject({ playerId: 'h', hand: null })
  })
})

describe('a ranking or a record in the Find box', () => {
  const href = (text: string) => { const r = read(text)[0]; return r ? `${r.rank?.lead ?? ''} ${wpblFinderHref(r)}` : null }

  it('reads what the search reads as a ranking, the same question both ways', () => {
    expect(href('avg vs lefties')).toBe('Highest /wpbl/stats?board=find&side=hitting&q=season~hand.l~avg.gte.1~pa.gte.10')
    expect(href('era at home')).toBe('Lowest /wpbl/stats?board=find&side=pitching&q=season~era.gte.0~ip.gte.15&venue=home')
    // The search's row opens the very link the box asks: one reader, not two copies.
    for (const text of ['avg vs lefties', 'era at home', 'hr vs boston']) {
      expect(scopedRankSuggestions('wpbl', text)[0].href).toBe(wpblFinderHref(read(text)[0]))
    }
  })

  it('reads a record at any grain, and a season one as the leaders', () => {
    expect(href('most walks in a game')).toBe('Most /wpbl/stats?board=find&side=hitting&q=bb.gte.1')
    expect(href('most hr in an inning')).toBe('Most /wpbl/stats?board=find&side=hitting&q=inning~hr.gte.1')
    expect(href('most hr')).toBe('Most /wpbl/stats?board=find&side=hitting&q=season~hr.gte.1')
    expect(recordSuggestions('wpbl', 'most walks in a game')[0].href).toBe(wpblFinderHref(read('most walks in a game')[0]))
  })

  it('leaves a plain question plain', () => {
    expect(href('3 hits')).toBe(' /wpbl/stats?board=find&side=hitting&q=h.gte.3')
  })
})

describe('nameSuggestions', () => {
  const roster = wpblFinderRoster(
    [{ id: 'h', name: 'Amira Hondras' }, { id: 's1', name: 'Ayami Sato' }, { id: 's2', name: 'Kana Sato' }],
    [{ player_id: 'h', ab: 4, bb: 0, hbp: 0, sf: 0, sh: 0 }, { player_id: 's1', ab: 4, bb: 0, hbp: 0, sf: 0, sh: 0 }, { player_id: 's2', ab: 4, bb: 0, hbp: 0, sf: 0, sh: 0 }],
    [],
  )
  const names = (text: string) => nameSuggestions(text, roster, WPBL_FINDER_CLUBS).map(n => n.text)

  it('finishes a name being typed', () => expect(names('hond')).toEqual(['Amira Hondras']))
  it('catches a slip in a surname', () => expect(names('hondars vs rhp')).toEqual(['Amira Hondras vs rhp']))
  it('offers each player a shared surname could be', () => expect(names('sato 2 hits')).toEqual(['Ayami Sato 2 hits', 'Kana Sato 2 hits']))
  it('leaves a whole name, and a question word, alone', () => {
    expect(names('hondras vs rhp')).toEqual([])
    expect(names('hits')).toEqual([])
  })
})

// "most 2 out rbi" listed the two-out plays a run scored on (Nov 20, 2026): the RBI were the runs on
// the play, which no season could sum, and "most grand slams" listed the slams. Each is now the
// hitters' season of those trips, ranked; without "most" it stays the plays.
describe('"most" of a kind of plate appearance', () => {
  const first = (text: string) => wpblFinderHref(read(text)[0])
  it('ranks the hitters by RBI in a situation', () => {
    expect(first('most 2 out rbi')).toContain('q=season~rbi.gte.1~paouts.eq.2')
    expect(first('two out rbi leaders')).toContain('q=season~rbi.gte.1~paouts.eq.2')
    expect(first('most rbi with risp')).toContain('q=season~rbi.gte.1~risp.eq.1')
  })
  it('ranks the hitters by a kind of trip', () => {
    expect(first('most grand slams')).toContain('q=season~hr.gte.1~on.eq.3')
    expect(first('most walk-off hits')).toContain('q=season~h.gte.1~walkoff.eq.1')
    expect(first('most leadoff home runs')).toContain('q=season~hr.gte.1~leadoff.eq.1')
  })
  it('keeps the plays without a word for a ranking, and counts RBI, not runs', () => {
    expect(first('two out rbi')).toContain('q=pa~paouts.eq.2~rbi.gte.1')
    expect(first('grand slams')).toContain('q=pa~hr.gte.1~on.eq.3')
    expect(first('home runs leading off the game')).toContain('q=pa~')
  })
})
