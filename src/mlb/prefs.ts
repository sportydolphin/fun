import { supabase } from '../lib/supabase'

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
