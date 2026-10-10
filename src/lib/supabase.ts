import { createClient } from '@supabase/supabase-js'
import { edgeFetch } from './edgeFetch'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Signed-out reads of public tables go through the edge cache in a built site (src/lib/edgeTables.ts
// says which and why). Not under `npm run dev` or Vitest, where there is no Pages Function to ask:
// those talk to Supabase exactly as before.
export const supabase = import.meta.env.PROD && typeof window !== 'undefined'
  ? createClient(supabaseUrl, supabaseKey, {
      global: { fetch: edgeFetch(supabaseUrl, supabaseKey, window.location.origin, (...a) => fetch(...a)) },
    })
  : createClient(supabaseUrl, supabaseKey)

// ─── Type helpers ─────────────────────────────────────────────────────────────

export interface UserPreferences {
  user_id:            string
  followed_team_id:   number | null
  followed_player_ids: number[]
  updated_at:         string
}
