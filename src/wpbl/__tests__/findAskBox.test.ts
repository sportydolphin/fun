import { describe, it, expect } from 'vitest'
import { EMPTY_FINDER_QUERY } from '../../league/finder'
import { parseFinderText } from '../../league/finderParse'
import { parsePlayerQuestion } from '../../league/playerQuestion'
import { askedFinderQuery, WPBL_FINDER_CLUBS, WPBL_FINDER_OPTS, WPBL_FINDER_SIDES, wpblFinderRoster } from '../finderLink'

// The Find board's own "Ask in words" box. It read no names until Nov 19, 2026: "hondras vs rhp" was
// not a question at all, and "hondras hits vs rhp" asked everyone's hits with the name ignored. It also
// dropped the arm and the span on the way to the board, so the preview said "vs RHP" and the answer
// was every pitcher. Both are pinned here through the same helpers the board calls.

const ROSTER = wpblFinderRoster(
  [{ id: 'h', name: 'Amira Hondras' }, { id: 'w', name: 'Kelsie Whitmore' }, { id: 'x', name: 'Never Played' }],
  [{ player_id: 'h', ab: 4, bb: 1, hbp: 0, sf: 0, sh: 0 }],
  [{ player_id: 'w', bf: 20, outs: 15 }],
)
const read = (text: string) => parsePlayerQuestion(text, ROSTER, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)
  .map(q => ({ ...q, ignored: [] }))

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
