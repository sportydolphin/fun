import { describe, it, expect } from 'vitest'
import { runEnvironmentCurrent, regularFinals, type WpblRunEnvironment } from '../derive/runEnvironment'

type G = { id: string; status: 'scheduled' | 'live' | 'final'; game_type: string | null; counts_in_standings: boolean | null }
const g = (id: string, status: G['status'], game_type: string | null = 'regular'): G => ({ id, status, game_type, counts_in_standings: null })
const env = (final_games: number): WpblRunEnvironment =>
  ({ scope: 'regular', woba_weights: null, fip_weights: null, final_games, plays: 0 })

describe('the priced run environment', () => {
  // A postseason final must not count, or a playoff night would read as the row being behind.
  it('counts regular-season finals only', () => {
    expect(regularFinals([g('a', 'final'), g('b', 'final', 'Postseason'), g('c', 'scheduled')])).toBe(1)
  })

  it('is trusted only when it priced the finals this reader holds', () => {
    const games = [g('a', 'final'), g('b', 'final'), g('c', 'scheduled')]
    expect(runEnvironmentCurrent(env(2), games)).toBe(true)
    expect(runEnvironmentCurrent(env(1), games)).toBe(false)
    expect(runEnvironmentCurrent(null, games)).toBe(false)
    expect(runEnvironmentCurrent(env(0), [])).toBe(false)
  })

  // The browser's own pricing includes a live game's plays, which the stored row cannot.
  it('is not trusted while a regular-season game is live', () => {
    expect(runEnvironmentCurrent(env(1), [g('a', 'final'), g('b', 'live')])).toBe(false)
    expect(runEnvironmentCurrent(env(1), [g('a', 'final'), g('b', 'live', 'Postseason')])).toBe(true)
  })
})
