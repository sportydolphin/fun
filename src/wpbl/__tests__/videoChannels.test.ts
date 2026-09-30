import { describe, it, expect } from 'vitest'
// The plain .mjs sync script, imported rather than reimplemented, for the same reason as
// discordHighlights.test.ts: a copy of the classifier living here would pass while the script
// drifted.
import {
  CHANNELS, LEAGUE_CHANNEL_ID as SYNC_LEAGUE, FAN_RECAPS_CHANNEL_ID as SYNC_FAN,
  buildTeamResolver, resolveVideo, refineKind,
} from '../../../scripts/sync-wpbl-youtube.mjs'
import { LEAGUE_CHANNEL_ID, FAN_RECAPS_CHANNEL_ID, gameVideos, videoCredit, videoLabel, watchShelves, MORE_GROUPS } from '../videoChannels'
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
  ['2026-09-06|BOS|SF', 'g-sep6'],
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

  it('takes a per-video date override over a title that names the wrong day', () => {
    const games = new Map([['2026-08-23|LA|BOS', 'g-aug23']])
    const title = 'LA Queens vs. Boston Hunters Highlights | WPBL | Aug. 24, 2026'
    expect(resolveVideo(fan, title, resolveTeam, games)).toMatchObject({ gameId: null })
    expect(resolveVideo(fan, title, resolveTeam, games, 'OEMYxsFlyDI'))
      .toMatchObject({ gameId: 'g-aug23', date: '2026-08-23' })
  })
})

describe('league titles', () => {
  it('matches a postseason reel with the round in front and a numeric date', () => {
    const r = resolveVideo(league,
      'WPBL Highlights: Championship - Game 5 | Los Angeles Queens @ San Francisco Firebells | 09/22/26',
      resolveTeam, gameByKey)
    expect(r).toMatchObject({ kind: 'highlight', gameId: 'g-cs5', away: 'LA', home: 'SF' })
  })

  // The broadcasts sat in 'other' until Sep 29, 2026, so thirty-five full games had no game page.
  it('reads a full-game broadcast as one, and matches it', () => {
    expect(resolveVideo(league, 'WPBL: Boston Hunters @ San Francisco Firebells | September 6, 2026', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'full_game', gameId: 'g-sep6', away: 'BOS', home: 'SF' })
    expect(resolveVideo(league, 'WPBL Championship: Game 5 | Los Angeles Queens @ San Francisco Firebells | September 22, 2026', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'full_game', gameId: 'g-cs5' })
  })

  it('accepts " at " in a broadcast title, the opening-day spelling', () => {
    expect(resolveVideo(league, 'WPBL: New York Heights at Los Angeles Queens | August 1, 2026', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'full_game', gameId: 'g-aug1' })
  })

  // A Short's title is free-form. " at " and a place name must not make one a three-hour game.
  it('never reads a Short as a broadcast', () => {
    for (const t of [
      "BTS: Pro Women's Baseball at Fenway Park!",
      "LA ties it up on the WPBL's Opening Day!",
      'The Setup vs. The Shot vs. The Play',
      'WPBL batting practice at the ballpark 💪',
    ]) expect(league.classify(t)).toBe('other')
  })

  it('matches a broadcast whose date has a space before the comma', () => {
    const games = new Map([['2026-08-22|NY|LA', 'g-aug22']])
    expect(resolveVideo(league, 'WPBL: New York Height @ Los Angeles Queens | August 22 , 2026', resolveTeam, games))
      .toMatchObject({ kind: 'full_game', gameId: 'g-aug22' })
  })

  it('reads a guest episode as the podcast, once the upload is known not to be a Short', () => {
    for (const t of [
      'Skylar Kaplan | Expert Hitter, Pro Ball Player, San Francisco Firebell',
      'Justine Siegal, PhD | The First Commissioner of the WPBL',
      'Lexi Hastings on Falling into Baseball, Social Justice, and Pursuing Your Dreams',
      'WPBL Group Chat LIVE! | Fort Myers, FL',
    ]) expect(refineKind(league.classify(t), t, false)).toBe('podcast')
  })

  // The channel's Shorts use the same pipe, and 'podcast' is a free "not a Short" (NEVER_SHORT):
  // reading one from the title alone would take a clip off the clips shelf and out of Discord.
  it('never turns a Short, or an upload not yet probed, into an episode', () => {
    const t = 'Eyes 👀 on the ball ⚾️ | Watch the WPBL Draft live on YouTube, IG, and TikTok on Nov. 20 at 5pm PT'
    expect(refineKind('other', t, true)).toBe('other')
    expect(refineKind('other', 'Skylar Kaplan | Expert Hitter', null)).toBe('other')
  })

  it('leaves a broadcast, a press conference and a plain feature alone', () => {
    expect(refineKind('full_game', 'WPBL: Boston Hunters @ San Francisco Firebells | September 6, 2026', false)).toBe('full_game')
    expect(refineKind('other', 'WPBL Draft 2025', false)).toBe('other')
  })

  it('reads a press conference as one, matched to no game', () => {
    expect(resolveVideo(league, 'WPBL: Boston Hunters Postgame Press Conference | August 2, 2026', resolveTeam, gameByKey))
      .toMatchObject({ kind: 'press', gameId: null })
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

describe('the Watch shelves', () => {
  const reel = video({ video_id: 'reel' })
  const broadcast = video({ video_id: 'full', kind: 'full_game', published_at: '2026-09-21T00:00:00Z' })
  const fanCut = video({ video_id: 'fan', channel_id: FAN_RECAPS_CHANNEL_ID, kind: 'condensed' })
  const clip = video({ video_id: 'clip', kind: 'other', game_id: null, is_short: true })
  const feature = video({ video_id: 'feature', kind: 'other', game_id: null, is_short: false })
  const unknown = video({ video_id: 'unknown', kind: 'other', game_id: null, is_short: null })

  it('puts every video on exactly one shelf', () => {
    const all = [reel, broadcast, fanCut, clip, feature, unknown]
    const { gameIds, clips, more } = watchShelves(all)
    expect(gameIds).toEqual(['g1'])
    expect(clips.map(v => v.video_id)).toEqual(['clip'])
    expect(more.map(v => v.video_id)).toEqual(['feature', 'unknown'])
  })

  // When clip tagging gives a Short a game, it is still a clip, not a fourth button on the card.
  it('keeps a Short on the clips shelf even with a game', () => {
    const { gameIds, clips } = watchShelves([video({ video_id: 'tagged', kind: 'other', is_short: true })])
    expect(gameIds).toEqual([])
    expect(clips).toHaveLength(1)
  })

  it("orders a game's videos shortest watch first", () => {
    expect(gameVideos([broadcast, fanCut, reel], 'g1').map(v => v.video_id)).toEqual(['reel', 'fan', 'full'])
  })

  it('files everything on More under a group', () => {
    for (const kind of ['compilation', 'other', 'press', 'podcast'] as const) {
      expect(MORE_GROUPS.some(g => g.test(video({ kind, game_id: null })))).toBe(true)
    }
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
    expect(videoLabel(video({ kind: 'full_game' }))).toBe('Full game')
  })
})
