import { describe, it, expect } from 'vitest'
// The cron script imported rather than reimplemented, for the reason wpblDrift.test gives: a
// copy of these rules living here would keep passing while the script it mirrors drifted.
import {
  siteRowToGame, seriesLabel, fixtureKey, matchupLine, WINS_NEEDED,
} from '../../../scripts/update-wpbl-discord-board.mjs'
import { postseasonSlotKey } from '../../../scripts/sync-wpbl-discord-postseason.mjs'
import { BEST_OF, winsNeeded } from '../derive/series'

// The Discord watch-party board reads `wpbl_games`, which is the STATS feed's mirror, and that
// feed will not carry a game row without two clubs on it. Measured Sep 7, 2026: it held nothing
// at all from Sep 7 onward, while the postseason ran Sep 9 to Sep 22. So the board was going to
// post "No games scheduled right now" for the whole postseason, on a server whose entire purpose
// is watch parties, through the eleven games anybody would turn up for.
//
// It reads the league's website calendar for those. Every rule that turns one of those rows into
// a board line can fail quietly, so each one is here.

const row = (over: Record<string, unknown> = {}) => ({
  event_id: 1, game_date: '2026-09-09', start_time: '6:00 PM', status: 'scheduled',
  round: 'semifinal', series_key: 'A', game_number: 1,
  home_team_id: 'SF', away_team_id: 'BOS', ...over,
})

describe('a website-calendar fixture as a board line', () => {
  it('carries no api_game_id, because it is not the stats feed’s row', () => {
    expect(siteRowToGame(row()).api_game_id).toBeNull()
  })

  it('names a fixture by its round and game number', () => {
    expect(seriesLabel(row())).toBe('Semifinal A · Game 1')
    expect(seriesLabel(row({ round: 'championship', series_key: null, game_number: 4 })))
      .toBe('Championship · Game 4')
  })

  // The championship's five fixtures are published weeks before anyone knows who is in them.
  // "??? @ ???" was the old answer to a missing club and it is the wrong one: the round and the
  // game number ARE that fixture's name until the semifinals fill it in.
  it('falls back to the round when a fixture has no clubs yet', () => {
    const g = siteRowToGame(row({ round: 'championship', series_key: null, game_number: 1, home_team_id: null, away_team_id: null }))
    expect(matchupLine(new Map(), g)).toBe('Championship · Game 1')
  })

  it('names the clubs when it has them', () => {
    const names = new Map([['SF', 'San Francisco Firebells'], ['BOS', 'Boston Hunters']])
    expect(matchupLine(names, siteRowToGame(row())))
      .toBe('Boston Hunters @ San Francisco Firebells')
  })
})

describe('which fixtures might never be played', () => {
  // Derived from the format, not from the website's wording: the site marks the championship's
  // last two "if needed" and marks no semifinal decider at all, so trusting its titles would
  // promise a Game 3 that only happens half the time.
  it('marks a decider and nothing before it', () => {
    expect(siteRowToGame(row({ game_number: 1 })).ifNecessary).toBe(false)
    expect(siteRowToGame(row({ game_number: 2 })).ifNecessary).toBe(false)
    expect(siteRowToGame(row({ game_number: 3 })).ifNecessary).toBe(true)
  })

  it('knows a best-of-five keeps three certain games', () => {
    const champ = (n: number) => siteRowToGame(row({ round: 'championship', series_key: null, game_number: n })).ifNecessary
    expect([champ(1), champ(2), champ(3), champ(4), champ(5)]).toEqual([false, false, false, true, true])
  })

  // The board is a plain .mjs and cannot import the app's TypeScript, so it keeps its own copy
  // of the format. This is the only thing keeping the two in step: a league that lengthened a
  // round would otherwise have the board promising a game that may never be played.
  it('agrees with the app’s one definition of the format', () => {
    expect(WINS_NEEDED.semifinal).toBe(winsNeeded('semifinal'))
    expect(WINS_NEEDED.championship).toBe(winsNeeded('championship'))
    expect(BEST_OF.semifinal).toBe(3)
    expect(BEST_OF.championship).toBe(5)
  })
})

describe('the watch-party link', () => {
  // A slot has an identity before it has clubs, which is why these events can be created early.
  // The board and the event sync have to agree on how that identity is spelled, or every
  // postseason line silently falls back to the generic events link and three different games
  // point at one event.
  it('is keyed the same way on both sides', () => {
    expect(siteRowToGame(row()).slot_key).toBe(postseasonSlotKey('semi-a', 1))
    expect(siteRowToGame(row({ series_key: 'B', game_number: 3 })).slot_key)
      .toBe(postseasonSlotKey('semi-b', 3))
    expect(siteRowToGame(row({ round: 'championship', series_key: null, game_number: 5 })).slot_key)
      .toBe(postseasonSlotKey('final', 5))
  })

  it('is null for a row the sync could never have made an event for', () => {
    expect(siteRowToGame(row({ round: null, series_key: null, game_number: null })).slot_key).toBeNull()
  })
})

describe('one fixture from two sources', () => {
  // The website calendar retires itself fixture by fixture as the stats feed picks each one up.
  // The feed's row has to win, because its api_game_id is what the event map is keyed on for
  // everything else, and a fixture listed twice is a board that says the same game twice.
  it('gives a feed row and a website row the same key', () => {
    const feed = { game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS', id: 'uuid' }
    expect(fixtureKey(siteRowToGame(row()))).toBe(fixtureKey(feed))
  })

  it('does not care which club the source called home', () => {
    const feed = { game_date: '2026-09-09', home_team_id: 'BOS', away_team_id: 'SF', id: 'uuid' }
    expect(fixtureKey(siteRowToGame(row()))).toBe(fixtureKey(feed))
  })

  // A clubless championship fixture cannot collide with anything, so it keys on itself rather
  // than on a pair of nulls that every other clubless fixture would share.
  it('keys a clubless fixture on itself', () => {
    const a = siteRowToGame(row({ event_id: 7, home_team_id: null, away_team_id: null }))
    const b = siteRowToGame(row({ event_id: 8, home_team_id: null, away_team_id: null }))
    expect(fixtureKey(a)).not.toBe(fixtureKey(b))
  })
})
