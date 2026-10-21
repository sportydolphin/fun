import { describe, it, expect } from 'vitest'
import { regularSeasonOver } from '../season'

const g = (id: string, game_date: string, status: 'scheduled' | 'live' | 'final', game_type: string | null = 'regular') =>
  ({ id, game_date, status, game_type, counts_in_standings: null })

describe('regularSeasonOver', () => {
  it('is over once every regular-season game is played, whatever the postseason is doing', () => {
    const games = [g('1', '2026-09-05', 'final'), g('2', '2026-09-06', 'final'), g('3', '2026-09-20', 'scheduled', 'Championship')]
    expect(regularSeasonOver(games, '2026-09-10')).toBe(true)
  })
  it('stays open while a regular-season game is live or still to come', () => {
    expect(regularSeasonOver([g('1', '2026-09-05', 'final'), g('2', '2026-09-06', 'live')], '2026-09-06')).toBe(false)
    expect(regularSeasonOver([g('1', '2026-09-05', 'final'), g('2', '2026-09-08', 'scheduled')], '2026-09-06')).toBe(false)
  })
  it('does not wait on a game left scheduled on a date that has passed', () => {
    expect(regularSeasonOver([g('1', '2026-09-05', 'final'), g('2', '2026-09-01', 'scheduled')], '2026-09-10')).toBe(true)
  })
  it('is not over before a season has any games', () => {
    expect(regularSeasonOver([], '2026-09-10')).toBe(false)
  })
})
