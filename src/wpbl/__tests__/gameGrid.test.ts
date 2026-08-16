import { describe, it, expect } from 'vitest'
import { formatGameColumn } from '../GameGrid'
import { buildLineupGrid } from '../derive/lineupGrid'
import { buildUsageGrid } from '../derive/pitchingUsage'
import type { WpblLineupHistoryRow, WpblPitchingUsageRow } from '../types'

/** The two team-page grids sit one above the other and are meant to be read against each
 *  other, so what they share has to actually stay shared. These are the two things that
 *  used to drift: how a column is labelled, and what order the columns come in. */

describe('formatGameColumn', () => {
  it('labels a date the same way for both grids', () => {
    expect(formatGameColumn('2026-08-15')).toBe('Sa 8/15')
  })

  it('reads the date as parts, so it does not slip a day west of UTC', () => {
    // `new Date('2026-01-01')` is UTC midnight, which is 31 December locally in the Americas.
    expect(formatGameColumn('2026-01-01')).toBe('Th 1/1')
  })

  it('keeps every weekday inside the pitching grid column', () => {
    // Two letters is what lets that grid show a weekday at all: at 16px Inter a three-letter
    // weekday measured 44px against its column. Guard the abbreviation, not the pixels.
    const days = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12',
                  '2026-08-13', '2026-08-14', '2026-08-15']
    const labels = days.map(formatGameColumn)
    expect(labels.map(l => l.split(' ')[0])).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    expect(new Set(labels.map(l => l.split(' ')[0])).size).toBe(7)   // no ambiguous pair
  })
})

describe('doubleheader column order', () => {
  // Both games carry the same date and the views expose no start time, so the order is
  // arbitrary — but it must be the SAME arbitrary order in both cards, or the two grids
  // would show one afternoon's games flipped relative to each other.
  const DATE = '2026-08-12'

  const lineup = (game_id: string): WpblLineupHistoryRow => ({
    game_id, team_id: 'LA', player_id: 'a', game_date: DATE, game_status: 'final',
    opponent_team_id: 'SF', opp_starter_name: 'Liz Gilder', opp_starter_throws: 'L',
    lineup_spot: 1, position: 'cf', started: true, slot_shared: false,
  })
  const usage = (game_id: string): WpblPitchingUsageRow => ({
    game_id, team_id: 'LA', player_id: 'p', game_date: DATE, game_status: 'final',
    opponent_team_id: 'SF', started: true, outs: 15, pitches: 60, bf: 20,
    er: 1, so: 4, bb: 1, decision: 'W', days_rest: null,
  })

  it('puts the two games in the same order in both grids', () => {
    // Fed in opposite orders, which is the case that used to diverge: the sort was on date
    // alone, so each grid kept whatever order its own rows happened to arrive in.
    const a = buildLineupGrid([lineup('g2'), lineup('g1')], 6).games.map(g => g.id)
    const b = buildUsageGrid([usage('g1'), usage('g2')], 6).games.map(g => g.id)
    expect(a).toEqual(b)
  })

  it('does not collapse two games played on one date into a single column', () => {
    expect(buildLineupGrid([lineup('g1'), lineup('g2')], 6).games).toHaveLength(2)
  })
})
