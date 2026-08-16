// ─── WPBL game-start reminder opt-in ──────────────────────────────────────────
//
// The client side of the reminder switch on the WPBL Home next-game card. It is a single
// standing preference — "before every game" — rather than a row per game, which is what it
// used to be; see the note on the pref below.
//
// The per-game helpers that wrote wpbl_game_reminders rows are gone with that change.
// Nothing creates new rows now, but scripts/send-wpbl-game-start.mjs still reads the table
// so anyone who opted into a specific game before this still gets that reminder.
//
// Reminders are user-scoped because Web Push subscriptions are (push_subscriptions keys off
// user_id), so turning one on requires a signed-in account.

import { supabase } from '../lib/supabase'
import { enablePush, isSubscribed } from '../lib/push'

// ─── Standing "every game" opt-in ─────────────────────────────────────────────
//
// One preference instead of a row per game. Lives on user_preferences so the server sender
// can read it (scripts/send-wpbl-game-start.mjs unions it with any per-game rows), and is
// mirrored to localStorage so the switch renders correctly on the first frame rather than
// flicking on after a round trip.
//
// Sending still needs a push subscription, so turning this on runs the same enablePush()
// flow the per-game bell used to — that is what prompts for permission on a device that has
// never granted it.

const ALL_GAMES_KEY = 'wpbl_notify_all_games'

export function getCachedAllGamesPref(): boolean {
  try { return localStorage.getItem(ALL_GAMES_KEY) === '1' } catch { return false }
}

function setCachedAllGamesPref(on: boolean) {
  try { localStorage.setItem(ALL_GAMES_KEY, on ? '1' : '0') } catch {}
}

/** null when the column isn't there yet, so the caller keeps whatever it had. */
export async function fetchAllGamesPref(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('notify_wpbl_all_games')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const on = !!(data as { notify_wpbl_all_games?: boolean }).notify_wpbl_all_games
  setCachedAllGamesPref(on)
  return on
}

/** Returns an error string for the caller to show inline, or null on success. */
export async function setAllGamesPref(userId: string, on: boolean): Promise<string | null> {
  if (on) {
    // No point recording the wish if nothing can deliver it.
    const err = (await isSubscribed()) ? null : await enablePush(userId)
    if (err) return err
  }
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id:               userId,
      notify_wpbl_all_games: on,
      updated_at:            new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (error) {
    console.warn('[wpbl] setAllGamesPref failed:', error.message)
    return 'Couldn\u2019t save that. Please try again.'
  }
  setCachedAllGamesPref(on)
  return null
}
