// The matchups board keeps its board, club and slice in the address bar so Back from a pair's
// compare page (a new page, which remounts the board) lands on the list the reader left, not on
// "Batter edge" at the scroll depth of a different list. These pin the round trip and the
// fallbacks for links the page cannot honour.
import { describe, it, expect } from 'vitest'
import { readMatchupsUrlState, matchupsSearch } from '../MatchupsPage'

describe('matchups URL state', () => {
  it('reads the defaults from a bare URL', () => {
    expect(readMatchupsUrlState('', null)).toEqual({ view: 'batter', club: 'all', scope: 'regular', expanded: false })
  })

  it('round-trips every non-default choice', () => {
    const state = { view: 'pitcher', club: 'ny', scope: 'all' } as const
    const search = matchupsSearch('', state)
    expect(search).toBe('?board=pitcher&club=ny&scope=all')
    expect(readMatchupsUrlState(search, null)).toEqual({ ...state, expanded: false })
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
      .toEqual({ view: 'batter', club: 'bos', scope: 'regular', expanded: false })
  })

  it('takes "Show more" from the history entry, never the URL', () => {
    expect(readMatchupsUrlState('?expanded=1', null).expanded).toBe(false)
    expect(readMatchupsUrlState('', { wpbl: {}, wpblMatchupsExpanded: true }).expanded).toBe(true)
  })
})
