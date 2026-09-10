import { describe, it, expect } from 'vitest'
import { applyLeagueStartTimes, type PublishedStart, type StartTimeRow } from '../startTimes'

// The rule that stopped the section telling a west-coast reader 3:00 PM for a playoff game
// that started at 4:00 PM. The zone conversion was never wrong; the number it converted was.
// See the header on startTimes.ts for what the two sources are and which one wins.

const game = (o: Partial<StartTimeRow> = {}): StartTimeRow => ({
  game_date: '2026-09-10', start_time: '5:00 PM',
  away_team_id: 'LA', home_team_id: 'NY', status: 'scheduled', ...o,
})
const published = (o: Partial<PublishedStart> = {}): PublishedStart => ({
  game_date: '2026-09-10', start_time: '6:00 PM',
  away_team_id: 'LA', home_team_id: 'NY', ...o,
})

describe('applyLeagueStartTimes', () => {
  it('takes the league calendar over the feed for a game nobody has played', () => {
    expect(applyLeagueStartTimes([game()], [published()])[0].start_time).toBe('6:00 PM')
  })

  it('leaves a live or final game alone, because the feed watched it start', () => {
    for (const status of ['live', 'final']) {
      expect(applyLeagueStartTimes([game({ status })], [published()])[0].start_time).toBe('5:00 PM')
    }
  })

  it('matches on the date and both clubs, so a game the league moved keeps the feed time', () => {
    // A moved game needs a different key to follow (the calendar row carries its own event id).
    // Silently keeping the feed's time is the correct half of that: the alternative is matching
    // a club pair across days and rewriting the wrong game.
    expect(applyLeagueStartTimes([game()], [published({ game_date: '2026-09-11' })])[0].start_time)
      .toBe('5:00 PM')
    expect(applyLeagueStartTimes([game()], [published({ away_team_id: 'SF' })])[0].start_time)
      .toBe('5:00 PM')
  })

  it('ignores a calendar row with no clubs on it, which is every championship game until the semifinals end', () => {
    const nameless = published({ home_team_id: null, away_team_id: null })
    expect(applyLeagueStartTimes([game()], [nameless])[0].start_time).toBe('5:00 PM')
  })

  it('fails open on an empty or timeless calendar', () => {
    expect(applyLeagueStartTimes([game()], [])[0].start_time).toBe('5:00 PM')
    expect(applyLeagueStartTimes([game()], [published({ start_time: '' })])[0].start_time).toBe('5:00 PM')
  })

  it('returns the same array when nothing moved, so a schedule poll cannot churn the section', () => {
    // Every 60 seconds, for as long as the tab is open. A fresh array here would invalidate
    // every memo downstream of the schedule on every poll of a schedule that had not changed.
    const games = [game({ start_time: '6:00 PM' })]
    expect(applyLeagueStartTimes(games, [published()])).toBe(games)
    expect(applyLeagueStartTimes(games, [])).toBe(games)
  })

  it('corrects only the games that disagree and keeps the rest identical', () => {
    const agree = game({ game_date: '2026-09-12', start_time: '6:00 PM', away_team_id: 'NY', home_team_id: 'LA' })
    const out = applyLeagueStartTimes([game(), agree], [
      published(),
      published({ game_date: '2026-09-12', away_team_id: 'NY', home_team_id: 'LA' }),
    ])
    expect(out.map(g => g.start_time)).toEqual(['6:00 PM', '6:00 PM'])
    expect(out[1]).toBe(agree)
  })
})
