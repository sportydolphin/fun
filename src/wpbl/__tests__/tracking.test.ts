import { describe, it, expect } from 'vitest'
import { aggregateTracking } from '../tracking'
import type { WpblSeasonGame } from '../season'
import type { WpblTrackRow, WpblPlayer, WpblPitchingLine } from '../types'

// The TrackMan boards are SEASON boards: the fastest pitch of the season, the hardest ball hit
// in it. They had no way to say so until Sep 2026, because `aggregateTracking` took rows,
// players and pitching lines and no schedule, and a tracking row carries a `game_id` and
// nothing else about its game. It cost nothing only because the league published tracking for
// Aug 1 and Aug 2 and then stopped for five weeks. This pins the argument that fixes it.
//
// There is no other test file for this module; these cover the postseason rule and the
// attribution it depends on, not the leaderboard arithmetic.

const player = (over: Partial<WpblPlayer>): WpblPlayer => ({
  id: 'p1', name: 'Kate Blunt', team_id: 'BOS', position: 'RHP',
  api_id: null, api_ids: [], jersey_number: null,
  ...over,
} as WpblPlayer)

const pitch = (over: Partial<WpblTrackRow>): WpblTrackRow => ({
  game_id: 'reg1', kind: 'pitch', release_speed: 70, spin_rate_rpm: 1800, pitch_type: 'Fastball',
  pitcher_id: 'feed-blunt', pitcher_name: 'Blunt, Kate', batter_id: 'feed-b', batter_name: 'Someone, A',
  exit_speed: null, launch_angle: null, distance: null, hit_type: null,
  ...over,
})

const PLAYOFF: WpblSeasonGame[] = [
  { id: 'reg1', game_type: 'regular', counts_in_standings: true },
  { id: 'post1', game_type: 'postSeason', counts_in_standings: true },
]
const NO_PITCHING: WpblPitchingLine[] = []

describe('the TrackMan boards and the postseason', () => {
  const blunt = player({ id: 'p1', api_id: 'feed-blunt' })

  it('leaves a playoff pitch off the velocity board', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => pitch({ release_speed: 68 })),
      pitch({ game_id: 'post1', release_speed: 95 }),   // a playoff pitch, and the hardest thrown
    ]
    const board = aggregateTracking(rows, [blunt], NO_PITCHING, PLAYOFF)
    expect(board.pitchCount).toBe(3)
    expect(board.fastestPitches[0].velo).toBe(68)
    expect(board.veloLeaders[0].maxVelo).toBe(68)
    expect(board.gameCount).toBe(1)
  })

  it('leaves a playoff batted ball off the hardest-hit and longest-hit boards', () => {
    const rows = [
      pitch({ kind: 'hit', exit_speed: 90, distance: 300 }),
      pitch({ game_id: 'post1', kind: 'hit', exit_speed: 110, distance: 450 }),
    ]
    const board = aggregateTracking(rows, [blunt], NO_PITCHING, PLAYOFF)
    expect(board.hardestHits.map(h => h.exit)).toEqual([90])
    expect(board.longestHits.map(h => h.distance)).toEqual([300])
  })

  // Fails OPEN, the same direction as everything else that takes a schedule: a game the caller
  // cannot place is counted, so a partial schedule over-counts rather than emptying the board.
  it('counts a game the schedule does not mention', () => {
    const rows = [pitch({ game_id: 'unknown', release_speed: 99 })]
    expect(aggregateTracking(rows, [blunt], NO_PITCHING, PLAYOFF).pitchCount).toBe(1)
  })

  // The league mints a new player id per club and again for the postseason, and a tracking row
  // is keyed on whichever was current when the pitch was thrown. Mapping only the CURRENT id
  // drops her earlier work onto the name matcher, which is a worse answer and sometimes none.
  it('attributes pitches thrown under an id the player no longer carries', () => {
    const traded = player({ id: 'p1', name: 'Diana Ibarra', api_id: 'new-id', api_ids: ['old-id', 'new-id'] })
    const rows = Array.from({ length: 4 }, () => pitch({ pitcher_id: 'old-id', pitcher_name: 'Nobody, Matching' }))
    const board = aggregateTracking(rows, [traded], NO_PITCHING, PLAYOFF)
    expect(board.veloLeaders[0].player?.id).toBe('p1')
  })
})
