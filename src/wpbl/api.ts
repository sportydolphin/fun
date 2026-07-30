import { supabase } from '../lib/supabase'
import type {
  WpblTeam, WpblPlayer, WpblGame, WpblStandingRow, WpblGameStatus,
  WpblBattingLine, WpblPitchingLine, WpblBattingInput, WpblPitchingInput,
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

// Every player in the league (all four rosters). Used to attach names/teams to the
// aggregated league-leader rows on the home view.
export function fetchWpblAllPlayers(): Promise<WpblPlayer[]> {
  return safe('fetchWpblAllPlayers', () =>
    supabase.from('wpbl_players').select('*'),
    [] as WpblPlayer[])
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
export async function fetchWpblGameLines(gameId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }> {
  const [batting, pitching] = await Promise.all([
    safe('fetchWpblBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('game_id', gameId).order('batting_order', { ascending: true }),
      [] as WpblBattingLine[]),
    safe('fetchWpblPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('game_id', gameId).order('created_at', { ascending: true }),
      [] as WpblPitchingLine[]),
  ])
  return { batting, pitching }
}

// Owner-only write: save a game's result + box-score lines. RLS (is_site_owner) gates
// this server-side — the signed-in owner's session must be active. Lines are replaced
// wholesale (delete-then-insert) since a single admin edits one game at a time.
export async function saveWpblGameResult(
  gameId: string,
  patch: { status: WpblGameStatus; home_score: number | null; away_score: number | null; innings: number | null },
  batting: WpblBattingInput[],
  pitching: WpblPitchingInput[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const gu = await supabase.from('wpbl_games')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', gameId)
    if (gu.error) return { ok: false, error: gu.error.message }

    const db = await supabase.from('wpbl_batting_lines').delete().eq('game_id', gameId)
    if (db.error) return { ok: false, error: db.error.message }
    if (batting.length) {
      const ib = await supabase.from('wpbl_batting_lines').insert(batting.map(b => ({ ...b, game_id: gameId })))
      if (ib.error) return { ok: false, error: ib.error.message }
    }

    const dp = await supabase.from('wpbl_pitching_lines').delete().eq('game_id', gameId)
    if (dp.error) return { ok: false, error: dp.error.message }
    if (pitching.length) {
      const ip = await supabase.from('wpbl_pitching_lines').insert(pitching.map(p => ({ ...p, game_id: gameId })))
      if (ip.error) return { ok: false, error: ip.error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' }
  }
}

// All of a player's box-score lines across every game (for the player page).
export async function fetchWpblPlayerLines(playerId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }> {
  const [batting, pitching] = await Promise.all([
    safe('fetchWpblPlayerBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('player_id', playerId),
      [] as WpblBattingLine[]),
    safe('fetchWpblPlayerPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('player_id', playerId),
      [] as WpblPitchingLine[]),
  ])
  return { batting, pitching }
}

// Owner-only: wipe a game's result — delete its lines and reset it to 'scheduled'.
// Handy for re-testing entry. Owner RLS gates the writes.
export async function clearWpblGameResult(gameId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await supabase.from('wpbl_batting_lines').delete().eq('game_id', gameId)
    if (db.error) return { ok: false, error: db.error.message }
    const dp = await supabase.from('wpbl_pitching_lines').delete().eq('game_id', gameId)
    if (dp.error) return { ok: false, error: dp.error.message }
    const gu = await supabase.from('wpbl_games')
      .update({ status: 'scheduled', home_score: null, away_score: null, innings: null, updated_at: new Date().toISOString() })
      .eq('id', gameId)
    if (gu.error) return { ok: false, error: gu.error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Clear failed' }
  }
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
