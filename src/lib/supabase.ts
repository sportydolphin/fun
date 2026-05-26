import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Type helpers ─────────────────────────────────────────────────────────────

export interface UserPreferences {
  user_id:            string
  followed_team_id:   number | null
  followed_player_ids: number[]
  updated_at:         string
}
