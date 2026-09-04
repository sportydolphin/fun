import { describe, it, expect } from 'vitest'
import { bestTwin, twinRank, HUB_ZONE } from '../../../supabase/functions/wpbl-ingest/games'

// The feed publishes each game more than once. Picking the wrong copy is not a display bug:
// the losers are DELETED, and a game's uuid is what reminder opt-ins and an open /predict
// round hang off, so choosing again at first pitch throws those away with it.

const copy = (gameId: string, o: Partial<Parameters<typeof twinRank>[0]> = {}) => ({
  gameId, played: false, hasTeams: true, feedZone: 'America/New_York', ...o,
})

describe('bestTwin', () => {
  it('keeps a played copy over an unplayed one, whatever else they say', () => {
    // Evidence beats every guess below it: a copy the league has actually played is the game.
    const played = copy('zzzz', { played: true, feedZone: 'America/New_York' })
    const staged = copy('aaaa', { feedZone: HUB_ZONE })
    expect(bestTwin([staged, played])?.gameId).toBe('zzzz')
    expect(bestTwin([played, staged])?.gameId).toBe('zzzz')
  })

  it('keeps the copy with clubs on it over a TBD placeholder', () => {
    expect(bestTwin([copy('aaaa', { hasTeams: false }), copy('zzzz')])?.gameId).toBe('zzzz')
  })

  it('prefers the hub zone once nothing above it separates them', () => {
    // Sep 3, 2026, the pair that cost the section a whole roster. Both read "Not Started" all
    // afternoon, so the id decided, and sq38 < uogj: the mirror sat on the copy that would
    // never be played. The Central-tagged one is the one the league published results against.
    const eastern = copy('sq38zkgwktwktgu1', { feedZone: 'America/New_York' })
    const central = copy('uogjry1r7cxhpt96', { feedZone: HUB_ZONE })
    expect(bestTwin([eastern, central])?.gameId).toBe('uogjry1r7cxhpt96')
  })

  it('falls back to the id when the zone tag says nothing', () => {
    // Aug 6 and Aug 19, 2026: both copies tagged Eastern. No signal, so the answer has to be
    // stable rather than dependent on the order the feed happened to list them in.
    const a = copy('7e3ys466tbcontza')
    const b = copy('tcvtrxvuqrl488nu')
    expect(bestTwin([a, b])?.gameId).toBe('7e3ys466tbcontza')
    expect(bestTwin([b, a])?.gameId).toBe('7e3ys466tbcontza')
  })

  it('breaks a tie between two hub-zone copies on the id', () => {
    // Aug 13 and Aug 15, 2026 each carried THREE copies, two of them Central-tagged.
    const one = copy('20f8lv4g5kfttfg1', { feedZone: HUB_ZONE })
    const two = copy('9xy114plku7zlpny', { feedZone: HUB_ZONE })
    const far = copy('6kntl8iur69kzthh')
    expect(bestTwin([far, two, one])?.gameId).toBe('20f8lv4g5kfttfg1')
  })

  it('cannot drop a played copy for a hub-zone one, which is what bounds the risk', () => {
    // Opening day is the one pair all season where the zone tag pointed at the wrong copy: the
    // played game was Eastern-tagged and its Central twin was never played. Once either side
    // has been played the guess stops mattering, so the worst this rule can do is leave the
    // swap at first pitch that used to happen anyway.
    const playedEastern = copy('8alsgvzc90ypwphl', { played: true })
    const unplayedCentral = copy('mcns90grkf4vinwa', { feedZone: HUB_ZONE })
    expect(bestTwin([unplayedCentral, playedEastern])?.gameId).toBe('8alsgvzc90ypwphl')
  })

  it('ranks played above clubs above the zone, so no two guesses can outvote evidence', () => {
    expect(twinRank(copy('x', { played: true, hasTeams: false, feedZone: 'America/New_York' })))
      .toBeGreaterThan(twinRank(copy('x', { hasTeams: true, feedZone: HUB_ZONE })))
    expect(twinRank(copy('x', { hasTeams: true, feedZone: 'America/New_York' })))
      .toBeGreaterThan(twinRank(copy('x', { hasTeams: false, feedZone: HUB_ZONE })))
  })

  it('returns nothing for an empty group rather than inventing a keeper', () => {
    expect(bestTwin([])).toBeUndefined()
  })
})
