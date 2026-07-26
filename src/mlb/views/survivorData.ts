// Streak Survivor — data layer. Picks live in `survivor_picks` (one per user per
// day); the nightly resolver (scripts/resolve-survivor.mjs) grades them and keeps
// each user's running streak in `survivor_stats`, so the leaderboard and the "your
// streak" header are single cheap reads rather than a client-side walk of everyone's
// history. See scripts/create_survivor_picks.sql.

import { supabase } from '../../lib/supabase'
import { fetchStreakLeaders } from '../api'
import { fetchTodayGames } from './Predictor'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SurvivorResult = 'pending' | 'hit' | 'miss' | 'void'

export interface SurvivorPick {
  gameDate:   string
  playerId:   number
  playerName: string
  teamId:     number
  result:     SurvivorResult
}

export interface SurvivorStats {
  currentStreak: number
  longestStreak: number
  totalHits:     number
  totalPicks:    number
}

export interface SurvivorLeaderRow {
  userId:        string
  displayName:   string
  currentStreak: number
  longestStreak: number
  rank:          number
  isMe:          boolean
}

export interface HotHitter {
  playerId:   number
  playerName: string
  teamId:     number
  teamAbbr:   string
  streak:     number   // current active hit-streak length, from the streak boards
}

// Local calendar day, matching the predictions widget so both games agree on
// "today". The resolver only grades days that are fully over everywhere, so a
// device a few hours off the ballpark's timezone still resolves correctly.
export function survivorToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function fetchMyPick(userId: string, date: string): Promise<SurvivorPick | null> {
  const { data } = await supabase
    .from('survivor_picks')
    .select('game_date, player_id, player_name, team_id, result')
    .eq('user_id', userId)
    .eq('game_date', date)
    .maybeSingle()
  if (!data) return null
  return {
    gameDate:   data.game_date,
    playerId:   Number(data.player_id),
    playerName: data.player_name,
    teamId:     Number(data.team_id),
    result:     data.result as SurvivorResult,
  }
}

export async function fetchMyRecentPicks(userId: string, limit = 10): Promise<SurvivorPick[]> {
  const { data } = await supabase
    .from('survivor_picks')
    .select('game_date, player_id, player_name, team_id, result')
    .eq('user_id', userId)
    .order('game_date', { ascending: false })
    .limit(limit)
  return (data ?? []).map(d => ({
    gameDate:   d.game_date,
    playerId:   Number(d.player_id),
    playerName: d.player_name,
    teamId:     Number(d.team_id),
    result:     d.result as SurvivorResult,
  }))
}

export async function fetchMyStats(userId: string): Promise<SurvivorStats> {
  const { data } = await supabase
    .from('survivor_stats')
    .select('current_streak, longest_streak, total_hits, total_picks')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    currentStreak: Number(data?.current_streak ?? 0),
    longestStreak: Number(data?.longest_streak ?? 0),
    totalHits:     Number(data?.total_hits ?? 0),
    totalPicks:    Number(data?.total_picks ?? 0),
  }
}

// Leaderboard: ranked by longest streak (the season trophy), current streak as the
// tiebreak. Names resolve from `usernames` at read time so the board always shows
// each player's current handle, matching the predictions leaderboard.
export async function fetchSurvivorLeaderboard(myUserId: string | null, limit = 25): Promise<SurvivorLeaderRow[]> {
  const { data } = await supabase
    .from('survivor_stats')
    .select('user_id, display_name, current_streak, longest_streak')
    .order('longest_streak', { ascending: false })
    .order('current_streak', { ascending: false })
    .limit(limit)
  const rows = data ?? []
  if (!rows.length) return []

  const ids = rows.map(r => r.user_id)
  const nameByUser: Record<string, string> = {}
  try {
    const { data: names } = await supabase.from('usernames').select('user_id, username').in('user_id', ids)
    for (const n of names ?? []) nameByUser[n.user_id] = n.username
  } catch { /* names are best-effort */ }

  return rows.map((r, i) => ({
    userId:        r.user_id,
    displayName:   nameByUser[r.user_id] ?? r.display_name ?? 'Anonymous',
    currentStreak: Number(r.current_streak ?? 0),
    longestStreak: Number(r.longest_streak ?? 0),
    rank:          i + 1,
    isMe:          r.user_id === myUserId,
  }))
}

// Hot-hitter suggestions come straight off the precomputed hitting-streak board —
// players who've hit in the most consecutive games are the natural survivor picks,
// and it's the same single-row read the report cards already use.
export async function fetchHotHitters(season: number, limit = 8): Promise<HotHitter[]> {
  try {
    const boards = await fetchStreakLeaders(season)
    return (boards.hitting ?? [])
      .slice(0, limit)
      .map(s => ({ playerId: s.playerId, playerName: s.playerName, teamId: s.teamId, teamAbbr: s.teamAbbr, streak: s.value }))
      .filter(h => h.playerId > 0)
  } catch { return [] }
}

// Which teams are still pickable today: a team's game must not have started. Maps
// teamId → true when that team's game is in the preview state. Doubleheaders keep
// the pick open until the first game of the day starts.
export async function fetchPickableTeams(date: string): Promise<Set<number>> {
  const open = new Set<number>()
  try {
    const games = await fetchTodayGames(date)
    for (const g of games) {
      if (g.state === 'preview') { open.add(g.home.teamId); open.add(g.away.teamId) }
    }
  } catch { /* schedule unreachable — caller treats as locked */ }
  return open
}

// ─── Write ──────────────────────────────────────────────────────────────────

// Upserts today's pick (one per day). Returns an error string on failure, null on
// success. The client gates this on the team still being pickable; RLS gates it on
// the row belonging to the signed-in user.
export async function saveMyPick(
  userId: string,
  date: string,
  player: { playerId: number; playerName: string; teamId: number },
): Promise<string | null> {
  const { error } = await supabase.from('survivor_picks').upsert(
    {
      user_id:     userId,
      game_date:   date,
      player_id:   player.playerId,
      player_name: player.playerName,
      team_id:     player.teamId,
      result:      'pending',
    },
    { onConflict: 'user_id,game_date' },
  )
  return error ? error.message : null
}
