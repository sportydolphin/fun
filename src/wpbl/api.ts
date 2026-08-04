import { supabase } from '../lib/supabase'
import type {
  WpblTeam, WpblPlayer, WpblGame, WpblStandingRow,
  WpblBattingLine, WpblPitchingLine,
  WpblFieldingLine, WpblGamePlay, WpblPitchTracking, WpblIngestRun,
} from './types'

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

// The feed occasionally emits a phantom `scheduled` duplicate of a game it already
// reported final (same date + matchup, different api_game_id). Drop the not-yet-played
// copy when a played one exists for the same matchup-day; genuine doubleheaders (two
// played, or two upcoming) are left untouched.
//
// The wpbl-ingest function now suppresses these server-side too (deletes the phantom row
// from the mirror), so on a healthy DB this filter is a no-op. It's kept as a cheap
// fallback for the window before a re-ingest clears an already-stored phantom.
function dedupeSchedule(games: WpblGame[]): WpblGame[] {
  const played = (g: WpblGame) => g.status === 'final' || g.status === 'live'
  const hasPlayed = new Set<string>()
  for (const g of games) if (played(g)) hasPlayed.add(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`)
  return games.filter(g => played(g) || !hasPlayed.has(`${g.game_date}|${g.away_team_id}|${g.home_team_id}`))
}

export async function fetchWpblSchedule(): Promise<WpblGame[]> {
  const games = await safe('fetchWpblSchedule', () =>
    supabase.from('wpbl_games').select('*').order('game_date', { ascending: true }),
    [] as WpblGame[])
  return dedupeSchedule(games)
}

// One game's current row — used by the live views to poll fresh score + live_state.
export async function fetchWpblGame(gameId: string): Promise<WpblGame | null> {
  return safe('fetchWpblGame', () =>
    supabase.from('wpbl_games').select('*').eq('id', gameId).maybeSingle(),
    null as WpblGame | null)
}

export function fetchWpblRoster(teamId: string): Promise<WpblPlayer[]> {
  return safe('fetchWpblRoster', () =>
    supabase.from('wpbl_players').select('*').eq('team_id', teamId).order('name', { ascending: true }),
    [] as WpblPlayer[])
}

// Every player in the league (all four rosters). Used to attach names/teams to the
// aggregated league-leader rows on the home view.
export function fetchWpblAllPlayers(): Promise<WpblPlayer[]> {
  return safe('fetchWpblAllPlayers', () =>
    supabase.from('wpbl_players').select('*'),
    [] as WpblPlayer[])
}

// Every play-by-play row in the league — for the Hall of Firsts (first HR, first
// strikeout, first stolen base, etc.). Small for a four-team league; empty pre-migration.
export function fetchWpblAllPlays(): Promise<WpblGamePlay[]> {
  return safe('fetchWpblAllPlays', () =>
    supabase.from('wpbl_game_plays').select('*'),
    [] as WpblGamePlay[])
}

// Every box-score line in the league — for computing season league leaders. Cheap for
// a four-team league; returns empty (no leaders) until games start being entered.
export async function fetchWpblAllLines(): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }> {
  const [batting, pitching] = await Promise.all([
    safe('fetchWpblAllBatting', () =>
      supabase.from('wpbl_batting_lines').select('*'),
      [] as WpblBattingLine[]),
    safe('fetchWpblAllPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*'),
      [] as WpblPitchingLine[]),
  ])
  return { batting, pitching }
}

// Existing box-score lines for one game (for editing / display).
export async function fetchWpblGameLines(gameId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('game_id', gameId).order('batting_order', { ascending: true }),
      [] as WpblBattingLine[]),
    safe('fetchWpblPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('game_id', gameId).order('created_at', { ascending: true }),
      [] as WpblPitchingLine[]),
    safe('fetchWpblFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('game_id', gameId),
      [] as WpblFieldingLine[]),
  ])
  return { batting, pitching, fielding }
}

// The official-feed play-by-play for one game, in order.
export function fetchWpblGamePlays(gameId: string): Promise<WpblGamePlay[]> {
  return safe('fetchWpblGamePlays', () =>
    supabase.from('wpbl_game_plays').select('*').eq('game_id', gameId).order('sequence', { ascending: true }),
    [] as WpblGamePlay[])
}

// TrackMan pitch/hit tracking for one game (chronological).
export function fetchWpblGameTracking(gameId: string): Promise<WpblPitchTracking[]> {
  return safe('fetchWpblGameTracking', () =>
    supabase.from('wpbl_pitch_tracking').select('*').eq('game_id', gameId).order('occurred_at', { ascending: true }),
    [] as WpblPitchTracking[])
}

// All of a player's box-score lines across every game (for the player page).
export async function fetchWpblPlayerLines(playerId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblPlayerBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('player_id', playerId),
      [] as WpblBattingLine[]),
    safe('fetchWpblPlayerPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('player_id', playerId),
      [] as WpblPitchingLine[]),
    safe('fetchWpblPlayerFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('player_id', playerId),
      [] as WpblFieldingLine[]),
  ])
  return { batting, pitching, fielding }
}

// The most recent ingest run (feed-mirror health). Null pre-migration or if the log is
// empty. Used by the admin freshness indicator on the WPBL home.
export function fetchWpblIngestHealth(): Promise<WpblIngestRun | null> {
  return safe('fetchWpblIngestHealth', () =>
    supabase.from('wpbl_ingest_runs').select('*').order('ran_at', { ascending: false }).limit(1).maybeSingle(),
    null as WpblIngestRun | null)
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
