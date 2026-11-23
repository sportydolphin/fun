// The play-log lines are built once per log and schedule, and shared (inningLines.ts, "Built once per
// log"). Undo that and the search box walks a season's log once for every Find row it counts.

import { describe, it, expect } from 'vitest'
import { inningPitchingLines, plateAppearanceLines, playTotals, teamInningLines } from '../inningLines'
import { seasonCut, seasonGames } from '../../wpbl/season'
import { WPBL_LEAGUE } from '../../wpbl/league'
import type { RunValuePlay } from '../types'
import type { WpblGame } from '../../wpbl/types'

const games = [
  { id: 'g1', game_date: '2026-08-01', home_team_id: 'SF', away_team_id: 'NY', home_score: 1, away_score: 0, status: 'final' },
  { id: 'g2', game_date: '2027-06-01', home_team_id: 'SF', away_team_id: 'NY', home_score: 1, away_score: 0, status: 'final' },
] as unknown as WpblGame[]
const plays = [] as RunValuePlay[]

describe('the play-log lines', () => {
  it('come back as the same arrays for the same log and games', () => {
    expect(plateAppearanceLines(WPBL_LEAGUE, plays, games)).toBe(plateAppearanceLines(WPBL_LEAGUE, plays, games))
    expect(inningPitchingLines(WPBL_LEAGUE, plays, games)).toBe(inningPitchingLines(WPBL_LEAGUE, plays, games))
    expect(teamInningLines(WPBL_LEAGUE, plays, games)).toBe(teamInningLines(WPBL_LEAGUE, plays, games))
    expect(playTotals(WPBL_LEAGUE, plays, games)).toBe(playTotals(WPBL_LEAGUE, plays, games))
  })

  it('are built afresh for a new read of the log', () => {
    expect(plateAppearanceLines(WPBL_LEAGUE, [], games)).not.toBe(plateAppearanceLines(WPBL_LEAGUE, [], games))
  })

  it('share a season cut, which keeps its identity', () => {
    expect(seasonGames(games, 2026)).toBe(seasonGames(games, 2026))
    expect(seasonGames(games, 2026).map(g => g.id)).toEqual(['g1'])
    const lines = [{ game_id: 'g1' }]
    expect(seasonCut(lines, games, 2026)).toBe(lines)
    expect(seasonCut([...lines, { game_id: 'g2' }], games, 2026)).toEqual(lines)
  })
})
