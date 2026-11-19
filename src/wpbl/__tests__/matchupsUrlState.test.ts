// The matchups board keeps its board, club and slice in the address bar so Back from a pair's
// compare page (a new page, which remounts the board) lands on the list the reader left, not on
// "Batter edge" at the scroll depth of a different list. These pin the round trip and the
// fallbacks for links the page cannot honor.
import { describe, it, expect } from 'vitest'
import { readMatchupsUrlState, matchupsSearch, matchupMatches } from '../MatchupsPage'

describe('matchups URL state', () => {
  it('reads the defaults from a bare URL', () => {
    expect(readMatchupsUrlState('', null)).toEqual({ view: 'batter', club: 'all', scope: 'regular', q: '', expanded: false })
  })

  it('round-trips every non-default choice', () => {
    const state = { view: 'pitcher', club: 'ny', scope: 'all' } as const
    const search = matchupsSearch('', state)
    expect(search).toBe('?board=pitcher&club=ny&scope=all')
    expect(readMatchupsUrlState(search, null)).toEqual({ ...state, q: '', expanded: false })
  })

  it('writes nothing for the defaults, so the plain page keeps a bare URL', () => {
    expect(matchupsSearch('?board=pitcher&club=sf', { view: 'batter', club: 'all', scope: 'regular' })).toBe('')
  })

  it('keeps parameters it does not own', () => {
    expect(matchupsSearch('?utm_source=discord', { view: 'faced', club: 'all', scope: 'regular' }))
      .toBe('?utm_source=discord&board=faced')
  })

  it('falls back on a board or slice it does not know, and lowercases the club', () => {
    expect(readMatchupsUrlState('?board=nope&scope=spring&club=BOS', null))
      .toEqual({ view: 'batter', club: 'bos', scope: 'regular', q: '', expanded: false })
  })

  it('takes "Show more" from the history entry, never the URL', () => {
    expect(readMatchupsUrlState('?expanded=1', null).expanded).toBe(false)
    expect(readMatchupsUrlState('', { wpbl: {}, wpblMatchupsExpanded: true }).expanded).toBe(true)
  })

  // Back from a matchup remounts the board; a search held only in state came back empty, with the
  // reader's place in a 300-row list gone with it.
  it('round-trips a search, and drops an empty one', () => {
    const search = matchupsSearch('', { view: 'batter', club: 'all', scope: 'regular', q: 'saiki sato' })
    expect(search).toBe('?q=saiki+sato')
    expect(readMatchupsUrlState(search, null).q).toBe('saiki sato')
    expect(matchupsSearch('?q=old', { view: 'batter', club: 'all', scope: 'regular', q: '  ' })).toBe('')
  })
})

describe('matchup search', () => {
  const line = { batterName: 'Emi Saiki', pitcherName: 'Ela Day-Bédard' }
  it('needs every word typed, in either name', () => {
    expect(matchupMatches(line, 'saiki')).toBe(true)
    expect(matchupMatches(line, 'Saiki Day')).toBe(true)
    expect(matchupMatches(line, 'saiki sato')).toBe(false)
  })
  it('folds accents and case, and matches everything on an empty query', () => {
    expect(matchupMatches(line, 'BEDARD')).toBe(true)
    expect(matchupMatches(line, '   ')).toBe(true)
  })
})
