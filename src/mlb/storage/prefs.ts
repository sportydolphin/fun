import { supabase } from '../../lib/supabase'
import { ensureActiveUser } from '../../lib/userActive'
import type { RecentSearchItem } from './recentSearches'
import { DEFAULT_GAME_START_LEAD_MIN } from '../../../shared/notifications'

// ─── Followed-team / followed-player preference helpers ───────────────────────
// Shared between useMlbState (the MLB feature) and the global Settings dialog
// in App.tsx, which lets a user change their preferred team from anywhere.

export async function loadPrefsFromSupabase(userId: string) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('followed_team_id, followed_player_ids')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { console.warn('[prefs] load error:', error.message); return null }
  return data
}

export async function savePrefsToSupabase(
  userId: string,
  followedTeamId: number | null,
  followedPlayerIds: number[],
) {
  if (!(await ensureActiveUser(userId))) return
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      followed_team_id: followedTeamId,
      followed_player_ids: followedPlayerIds,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (error) console.warn('[prefs] save error:', error.message)
}

// ─── Recent searches (cross-device) ──────────────────────────────────────────
// Kept separate from the followed-team/players helpers above so that a missing
// `recent_searches` column (migration not run yet) degrades gracefully: recents
// simply fall back to localStorage while everything else keeps syncing.

export async function loadRecentSearchesFromSupabase(userId: string): Promise<RecentSearchItem[] | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('recent_searches')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null   // column may not exist yet — caller keeps localStorage
  const arr = (data as any)?.recent_searches
  return Array.isArray(arr) ? (arr as RecentSearchItem[]) : null
}

export async function saveRecentSearchesToSupabase(userId: string, items: RecentSearchItem[]): Promise<void> {
  if (!(await ensureActiveUser(userId))) return
  // Upserts only recent_searches; other columns on the row are left untouched.
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, recent_searches: items, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) { /* column may not exist yet — localStorage still holds them */ }
}

export function getLocalFollowedTeamId(): number | null {
  try { const s = localStorage.getItem('mlb_fav_team_id'); return s ? Number(s) : null } catch { return null }
}

export function setLocalFollowedTeamId(teamId: number | null) {
  try {
    if (teamId !== null) localStorage.setItem('mlb_fav_team_id', String(teamId))
    else localStorage.removeItem('mlb_fav_team_id')
  } catch {}
}

export function getLocalFollowedPlayerIds(): number[] {
  try {
    const s = localStorage.getItem('mlb_fav_player_ids')
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

// ─── Game-start reminder preference ───────────────────────────────────────────
// Per-type opt-in for "your team's game is about to start" notifications, plus
// how many minutes before first pitch to fire. Mirrored to localStorage so the
// in-site notification source can read it synchronously, and upserted to
// user_preferences so the server-side push sender (scripts/send-game-start.mjs)
// can honour it. Both columns degrade gracefully if the migration hasn't run.

export interface GameStartPref { enabled: boolean; leadMin: number }

const GS_ENABLED_KEY = 'mlb_notify_game_start'
const GS_LEAD_KEY    = 'mlb_game_start_lead_min'

export function getLocalGameStartPref(): GameStartPref {
  try {
    const enabled = localStorage.getItem(GS_ENABLED_KEY) === '1'
    const raw     = localStorage.getItem(GS_LEAD_KEY)
    const leadMin = raw != null ? Number(raw) : DEFAULT_GAME_START_LEAD_MIN
    return { enabled, leadMin: Number.isFinite(leadMin) && leadMin > 0 ? leadMin : DEFAULT_GAME_START_LEAD_MIN }
  } catch {
    return { enabled: false, leadMin: DEFAULT_GAME_START_LEAD_MIN }
  }
}

export function setLocalGameStartPref(pref: GameStartPref) {
  try {
    localStorage.setItem(GS_ENABLED_KEY, pref.enabled ? '1' : '0')
    localStorage.setItem(GS_LEAD_KEY, String(pref.leadMin))
  } catch {}
}

export async function loadGameStartPrefFromSupabase(userId: string): Promise<GameStartPref | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('notify_game_start, game_start_lead_min')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null   // columns may not exist yet — caller keeps localStorage
  const leadMin = (data as any).game_start_lead_min
  return {
    enabled: !!(data as any).notify_game_start,
    leadMin: Number.isFinite(leadMin) && leadMin > 0 ? leadMin : DEFAULT_GAME_START_LEAD_MIN,
  }
}

export async function saveGameStartPrefToSupabase(userId: string, pref: GameStartPref): Promise<void> {
  if (!(await ensureActiveUser(userId))) return
  // Upserts only the game-start columns; other preference columns are untouched.
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id:             userId,
      notify_game_start:   pref.enabled,
      game_start_lead_min: pref.leadMin,
      updated_at:          new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (error) { /* columns may not exist yet — localStorage still holds them */ }
}
