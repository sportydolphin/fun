import { describe, it, expect } from 'vitest'
import { seriesGamesStarted } from '../SeriesPreview'
import type { WpblGame } from '../types'

// The series overview lists a series' results in place of its published fixtures, and its leaders
// are computed over exactly these games. A regular-season meeting leaking in would put a season
// game on the series' list and its lines in the series totals; an unplayed row would print a
// 0-0 "result".

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-09-16', start_time: '4:00 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 6, away_score: 7, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'Championship', counts_in_standings: false,
  ...over,
})

describe('seriesGamesStarted', () => {
  it('keeps the postseason games between the two clubs that have started, oldest first', () => {
    const g2 = game({ game_date: '2026-09-17', home_team_id: 'LA', away_team_id: 'SF' })
    const g1 = game({ game_date: '2026-09-16' })
    const live = game({ game_date: '2026-09-19', status: 'live' })
    expect(seriesGamesStarted('LA', 'SF', [g2, live, g1]).map(g => g.id)).toEqual([g1.id, g2.id, live.id])
  })

  it('leaves out regular-season meetings, unplayed games and other pairings', () => {
    const regular = game({ game_type: 'regular', counts_in_standings: true, game_date: '2026-08-21' })
    const upcoming = game({ status: 'scheduled', game_date: '2026-09-22' })
    const semi = game({ home_team_id: 'SF', away_team_id: 'BOS', game_type: 'Semifinal A' })
    expect(seriesGamesStarted('LA', 'SF', [regular, upcoming, semi])).toEqual([])
  })
})
