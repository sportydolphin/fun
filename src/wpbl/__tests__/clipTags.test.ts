import { describe, it, expect } from 'vitest'
// The plain .mjs matcher the sync runs, imported rather than reimplemented, so a copy here cannot
// pass while the script drifts (the same reason videoChannels.test.ts imports the sync).
import {
  buildClipContext, tagClip, parseEvent, findPlayers, buildNameIndex, gameStartMs,
} from '../../../scripts/wpbl-clip-tags.mjs'
import { inningLabel, clipLabel } from '../Watch'
import type { WpblGame, WpblTeam, WpblVideoTag } from '../types'

// A clip pinned to the wrong game or player is worse than one pinned to nothing: it shows up on a
// Game Center and a player page where it does not belong, with nobody looking. Every case here is
// a real 2026 title shape, and most are ones an earlier version of the matcher got wrong.

const teams = [
  { id: 'LA', city: 'Los Angeles', name: 'Queens', abbr: 'LA' },
  { id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF' },
  { id: 'NY', city: 'New York', name: 'Heights', abbr: 'NY' },
  { id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS' },
]
const players = [
  { id: 'gian', name: 'Amanda Gianelloni' },
  { id: 'mack', name: 'Jamie Mackay' },
  { id: 'jpark', name: 'Jua Park' },
  { id: 'mpark', name: 'Minseo Park' },
  { id: 'lexi', name: 'Lexi Hastings' },
  { id: 'gen', name: 'Genevieve Hastings' },
  { id: 'rkim', name: 'Rakyung Kim' },
  { id: 'hkim', name: 'Hyeonah Kim' },
  { id: 'osul', name: "Claire O'Sullivan" },
  { id: 'leb', name: 'Andréanne Leblanc' },
  { id: 'hon', name: 'Amira Hondras' },
]
// Sep 16, 6:00 PM Central = 23:00Z. Sep 17 the same.
const games = [
  { id: 'g16', game_date: '2026-09-16', start_time: '6:00 PM', home_team_id: 'SF', away_team_id: 'LA', status: 'final' },
  { id: 'g17', game_date: '2026-09-17', start_time: '6:00 PM', home_team_id: 'SF', away_team_id: 'LA', status: 'final' },
]
const lines = [
  ...['gian', 'jpark', 'leb', 'hon', 'gen'].flatMap(p => ['g16', 'g17'].map(g => ({ game_id: g, player_id: p, team_id: 'SF' }))),
  ...['mack', 'mpark', 'rkim', 'osul', 'lexi'].flatMap(p => ['g16', 'g17'].map(g => ({ game_id: g, player_id: p, team_id: 'LA' }))),
]
const play = (game_id: string, sequence: number, batter_id: string, event_type: string, runs_scored: number, over = {}) => ({
  game_id, sequence, inning: 2, half: 'bottom', team_id: 'SF', batter_id, event_type, runs_scored, narrative: '', ...over,
})
const plays = [
  play('g16', 20, 'gian', 'home_run', 3),                 // the grand slam
  play('g16', 40, 'gian', 'home_run', 0, { inning: 5 }),  // and a solo shot later
  play('g17', 12, 'gian', 'home_run', 1),
  play('g16', 30, 'mack', 'home_run', 1, { half: 'top', team_id: 'LA' }),
  play('g16', 33, 'mack', 'home_run', 0, { half: 'top', team_id: 'LA' }),
  play('g16', 50, 'hon', 'caught_stealing', 0, { narrative: 'Amira Hondras out at second c to 2b, caught stealing.' }),
  play('g17', 60, 'jpark', 'double', 3),
]
const ctx = buildClipContext({ players, teams, games, lines, plays })
const clip = (title: string, published_at: string) => tagClip({ video_id: 'v', title, published_at }, ctx)

describe('gameStartMs', () => {
  it('reads the stored wall clock as Central', () => {
    expect(new Date(gameStartMs('2026-09-16', '6:00 PM')).toISOString()).toBe('2026-09-16T23:00:00.000Z')
  })
})

describe('pinning a clip to its at-bat', () => {
  it('uses "grand slam" to pick the one play out of two home runs that night', () => {
    expect(clip('GIANELLONI GRAND SLAM', '2026-09-17T00:24:00Z'))
      .toMatchObject({ method: 'play', game_id: 'g16', play_sequence: 20, player_ids: ['gian'], team_id: 'SF' })
  })

  // runs_scored does not count the batter, so a 2-run homer is runs_scored 1.
  it('reads "2-run" as one runner crossing', () => {
    expect(clip('2-run homer for Jamie Mackay!', '2026-09-17T00:30:00Z'))
      .toMatchObject({ method: 'play', play_sequence: 30 })
  })

  it('stops at the game when two plays agree with the title', () => {
    expect(clip('2 AB, 2 HR for Jamie Mackay!!', '2026-09-17T00:40:00Z'))
      .toMatchObject({ method: 'game', game_id: 'g16', play_sequence: null })
  })

  it('takes the newest game with a matching play, not the first one ever', () => {
    expect(clip('Gianelloni goes yard!', '2026-09-18T00:10:00Z'))
      .toMatchObject({ method: 'play', game_id: 'g17', play_sequence: 12 })
  })

  it('finds a runner by the name the narrative opens with', () => {
    expect(clip('Hondras caught stealing!!', '2026-09-17T01:00:00Z'))
      .toMatchObject({ method: 'play', play_sequence: 50 })
  })

  it('never pins to a game that had not started when the clip went up', () => {
    // Posted the morning of the 17th: the 17th's game (and its double) had not happened.
    expect(clip('Jua Park 3 RBI Double!!', '2026-09-17T15:00:00Z')?.game_id).not.toBe('g17')
  })
})

describe('names', () => {
  const index = buildNameIndex(players)
  const names = (t: string) => findPlayers(t, index).map(c => c.map(p => p.id))

  it('does not read "out of the park" as a Park', () => {
    expect(names('Mackay launches one out of the park!')).toEqual([['mack']])
  })

  it('strips possessives and keeps inner apostrophes', () => {
    expect(names("O'Sullivan with the go-ahead homer!")).toEqual([['osul']])
    expect(names("LEBLANC'S big night")).toEqual([['leb']])
  })

  it('does not add the other owner of a surname a full name already matched', () => {
    expect(names('Lexi Hastings first homer in the WPBL!')).toEqual([['lexi']])
  })

  it('keeps a shared surname as a choice for the game to settle', () => {
    expect(names('Kim with a defensive gem!')).toEqual([['rkim', 'hkim']])
  })

  it('resolves a shared surname to whichever owner played in the pinned game', () => {
    const t = tagClip({ video_id: 'v', title: 'Kim with a defensive gem!', published_at: '2026-09-17T00:30:00Z' }, ctx)
    // Neither Kim is named with an event and the name is ambiguous, so there is no game to settle
    // it: no guess at which Kim.
    expect(t).toBeNull()
  })
})

describe('without an event', () => {
  it('pins a named player to a game only while that game was on', () => {
    expect(clip('Leblanc is on fire!', '2026-09-17T01:00:00Z')).toMatchObject({ method: 'game', game_id: 'g16' })
    expect(clip("Leblanc's big night", '2026-09-17T17:00:00Z')).toMatchObject({ method: 'player', game_id: null, team_id: 'SF' })
  })

  it('pins a club to a game only while it was playing, and to no game otherwise', () => {
    expect(clip('The Queens go ahead!', '2026-09-17T01:00:00Z')).toMatchObject({ method: 'game', game_id: 'g16', team_id: 'LA' })
    expect(clip('How the Queens are preparing for the Postseason', '2026-09-17T20:00:00Z'))
      .toMatchObject({ method: 'team', game_id: null, team_id: 'LA' })
  })

  it('reads "the Bells" as the Firebells', () => {
    expect(clip('THE BELLS FORCE GAME 5!', '2026-09-20T12:00:00Z')).toMatchObject({ team_id: 'SF' })
  })

  it('returns nothing for a title that names nobody', () => {
    expect(clip('Sounds of the Stadium 😌', '2026-09-17T01:00:00Z')).toBeNull()
  })
})

describe('parseEvent', () => {
  it('does not read a double play as a double', () => {
    expect(parseEvent('Double play Queens!')).toBeNull()
    expect(parseEvent('Yonetani with a 2 RBI double!')).toEqual({ type: 'double', runs: 2 })
  })
})

describe('the clip label', () => {
  const g = new Map<string, WpblGame>([['g16', { id: 'g16', game_date: '2026-09-16', away_team_id: 'LA', home_team_id: 'SF' } as WpblGame]])
  const t = new Map<string, WpblTeam>([['LA', { id: 'LA', abbr: 'LA' } as WpblTeam], ['SF', { id: 'SF', abbr: 'SF' } as WpblTeam]])
  const tag = { video_id: 'v', game_id: 'g16', play_sequence: 20, inning: 2, half: 'bottom', team_id: 'SF', player_ids: [], method: 'play' } as WpblVideoTag

  it('names the game, the date and the half-inning', () => {
    expect(inningLabel(tag)).toBe('Bottom 2nd')
    expect(clipLabel(tag, g, t)).toMatch(/^LA @ SF · Sep 16 · Bottom 2nd$/)
  })

  it('leaves the game out where the game is already on screen', () => {
    expect(clipLabel(tag, g, t, false)).toBe('Bottom 2nd')
  })
})
