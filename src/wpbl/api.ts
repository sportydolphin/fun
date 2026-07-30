import { supabase } from '../lib/supabase'
import type { WpblTeam, WpblPlayer, WpblGame, WpblStandingRow } from './types'

// Reads for the WPBL section. Everything degrades gracefully: if the tables don't
// exist yet (pre-migration) or a request fails, we log and return an empty result so
// the section renders an empty shell instead of throwing. Same tolerance the rest of
// the app uses for not-yet-migrated features.

async function safe<T>(label: string, run: () => PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  try {
    const { data, error } = await run()
    if (error) {
      console.warn(`[wpbl] ${label} failed:`, error)
      return fallback
    }
    return data ?? fallback
  } catch (e) {
    console.warn(`[wpbl] ${label} threw:`, e)
    return fallback
  }
}

export function fetchWpblTeams(): Promise<WpblTeam[]> {
  return safe('fetchWpblTeams', () =>
    supabase.from('wpbl_teams').select('*').order('sort_order', { ascending: true }),
    [] as WpblTeam[])
}

export function fetchWpblSchedule(): Promise<WpblGame[]> {
  return safe('fetchWpblSchedule', () =>
    supabase.from('wpbl_games').select('*').order('game_date', { ascending: true }),
    [] as WpblGame[])
}

export function fetchWpblRoster(teamId: string): Promise<WpblPlayer[]> {
  return safe('fetchWpblRoster', () =>
    supabase.from('wpbl_players').select('*').eq('team_id', teamId).order('name', { ascending: true }),
    [] as WpblPlayer[])
}

// Standings derived from final games (not stored). A game counts only once both a
// status of 'final' and both scores are present.
export function computeStandings(teams: WpblTeam[], games: WpblGame[]): WpblStandingRow[] {
  const rows = new Map<string, WpblStandingRow>()
  for (const team of teams) {
    rows.set(team.id, { team, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 })
  }
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null) continue
    const home = rows.get(g.home_team_id)
    const away = rows.get(g.away_team_id)
    if (!home || !away) continue
    home.runsFor += g.home_score; home.runsAgainst += g.away_score
    away.runsFor += g.away_score; away.runsAgainst += g.home_score
    if (g.home_score > g.away_score) { home.wins++; away.losses++ }
    else if (g.away_score > g.home_score) { away.wins++; home.losses++ }
  }
  return [...rows.values()].sort((a, b) => {
    const wpA = a.wins + a.losses ? a.wins / (a.wins + a.losses) : 0
    const wpB = b.wins + b.losses ? b.wins / (b.wins + b.losses) : 0
    if (wpB !== wpA) return wpB - wpA
    return (b.runsFor - b.runsAgainst) - (a.runsFor - a.runsAgainst)
  })
}
