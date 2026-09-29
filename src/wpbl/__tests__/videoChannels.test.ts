import { describe, it, expect } from 'vitest'
// The plain .mjs sync script, imported rather than reimplemented, for the same reason as
// discordHighlights.test.ts: a copy of the classifier living here would pass while the script
// drifted.
import {
  CHANNELS, LEAGUE_CHANNEL_ID as SYNC_LEAGUE, FAN_RECAPS_CHANNEL_ID as SYNC_FAN,
  buildTeamResolver, resolveVideo,
} from '../../../scripts/sync-wpbl-youtube.mjs'
import { LEAGUE_CHANNEL_ID, FAN_RECAPS_CHANNEL_ID, gameVideos, videoCredit, videoLabel } from '../videoChannels'
import type { WpblVideo } from '../types'

// Two channels feed wpbl_videos, and each writes titles to its own contract. The failures that
// matter are silent: a fan condensed game classified as a league 'highlight' reaches the Discord
// poster, and a title the matcher cannot read simply shows no video on its game.

const teams = [
  { id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS' },
  { id: 'LA', city: 'Los Angeles', name: 'Queens', abbr: 'LA' },
  { id: 'NY', city: 'New York', name: 'Heights', abbr: 'NY' },
  { id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF' },
]
const resolveTeam = buildTeamResolver(teams)
// Key `date|away|home`, as the sync builds it from wpbl_games.
const gameByKey = new Map([
  ['2026-08-01|NY|LA', 'g-aug1'],
  ['2026-09-16|SF|LA', 'g-cs1'],
  ['2026-09-22|LA|SF', 'g-cs5'],
])
const league = CHANNELS.find((c: { id: string }) => c.id === SYNC_LEAGUE)
const fan = CHANNELS.find((c: { id: string }) => c.id === SYNC_FAN)

describe('the two channel lists', () => {
  it('agree on the ids', () => {
    expect(SYNC_LEAGUE).toBe(LEAGUE_CHANNEL_ID)
    expect(SYNC_FAN).toBe(FAN_RECAPS_CHANNEL_ID)
  })
})

describe('WPBL from Day 1 titles', () => {
  it('matches a regular-season condensed game, whichever club the title names first', () => {
    const r = resolveVideo(fan, 'LA Queens vs. NY Heights Highlights | WPBL | Aug. 1, 2026', resolveTeam, gameByKey)
    expect(r).toMatchObject({ kind: 'condensed', gameId: 'g-aug1', date: '2026-08-01' })
    // The hints follow the game, not the title's word order.
    expect([r.away, r.home]).toEqual(['NY', 'LA'])
  })

  it('matches a postseason one behind its [GAME n] tag, with no "Highlights" in the title', () => {
    const r = resolveVideo(fan, '[GAME 1] LA Queens vs. SF Firebells | WPBL Championship | Sep. 16, 2026', resolveTeam, gameByKey)
    expect(r).toMatchObject({ kind: 'condensed', gameId: 'g-cs1' })
  })

  it('never classifies as the league\'s "highlight", which is what the Discord poster keys on', () => {
    for (const t of [
      'LA Queens vs. NY Heights Highlights | WPBL | Aug. 1, 2026',
      '[GAME 5] LA Queens vs. SF Firebells | WPBL Championship | Sep. 22, 2026',
      'Top 10 Home Runs of the WPBL Season!',
      'Something new entirely',
    ]) expect(fan.classify(t)).not.toBe('highlight')
  })

  it('reads a Top 10 as a compilation and matches it to no game', () => {
    expect(resolveVideo(fan, 'Top 10 Plays of the WPBL Season!', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'compilation', gameId: null })
  })

  it('leaves a matchup with no readable date unmatched rather than guessing a night', () => {
    expect(resolveVideo(fan, 'LA Queens vs. NY Heights: the rivalry', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'other', gameId: null })
  })
})

describe('league titles', () => {
  it('matches a postseason reel with the round in front and a numeric date', () => {
    const r = resolveVideo(league,
      'WPBL Highlights: Championship - Game 5 | Los Angeles Queens @ San Francisco Firebells | 09/22/26',
      resolveTeam, gameByKey)
    expect(r).toMatchObject({ kind: 'highlight', gameId: 'g-cs5', away: 'LA', home: 'SF' })
  })

  it('still matches the regular-season contract', () => {
    expect(resolveVideo(league, 'WPBL Highlights: New York Heights @ Los Angeles Queens | August 1st, 2026', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'highlight', gameId: 'g-aug1' })
  })
})

const video = (over: Partial<WpblVideo>): WpblVideo => ({
  video_id: 'x', channel_id: LEAGUE_CHANNEL_ID, title: 't', published_at: '2026-09-23T00:00:00Z',
  thumbnail_url: null, kind: 'highlight', game_id: 'g1', ...over,
})

describe('gameVideos', () => {
  it('keeps both videos of a game, the league reel first, whatever order the table returned', () => {
    const fanCut = video({ video_id: 'fan', channel_id: FAN_RECAPS_CHANNEL_ID, kind: 'condensed', published_at: '2026-09-22T00:00:00Z' })
    const reel = video({ video_id: 'league' })
    const other = video({ video_id: 'elsewhere', game_id: 'g2' })
    expect(gameVideos([fanCut, other, reel], 'g1').map(v => v.video_id)).toEqual(['league', 'fan'])
  })
})

describe('credit', () => {
  it('credits the fan channel on its cards and never the league', () => {
    expect(videoCredit(video({ channel_id: FAN_RECAPS_CHANNEL_ID, kind: 'condensed' })))
      .toEqual({ name: 'WPBL from Day 1', url: 'https://www.youtube.com/@wpblfanrecaps' })
    expect(videoCredit(video({}))).toBeNull()
  })

  it('labels a condensed game as one', () => {
    expect(videoLabel(video({ kind: 'condensed' }))).toBe('Condensed game')
    expect(videoLabel(video({}))).toBe('Watch Highlights')
  })
})
