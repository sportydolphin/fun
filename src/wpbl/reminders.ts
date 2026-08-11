// ─── WPBL game-start reminder opt-ins ─────────────────────────────────────────
//
// The client side of the "notify me before this game" bell on the WPBL Home
// next-game card. An opt-in is one row in wpbl_game_reminders (see
// scripts/create_wpbl_game_reminders.sql); the server sender
// (scripts/send-wpbl-game-start.mjs) reads those rows and fires the push.
//
// Reminders are user-scoped because Web Push subscriptions are (push_subscriptions
// keys off user_id), so turning one on requires a signed-in account. Enabling a
// reminder also ensures this browser actually has a push subscription — reusing the
// exact same enablePush() flow the MLB Settings toggle uses — so opting in on a
// device that never granted notification permission prompts for it here too.

import { supabase } from '../lib/supabase'
import { enablePush, isSubscribed } from '../lib/push'
import type { WpblGame } from './types'

const DEFAULT_LEAD_MIN = 30

/** The set of game ids this user has an active reminder for. Empty on any error. */
export async function fetchGameReminderIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('wpbl_game_reminders')
    .select('game_id')
    .eq('user_id', userId)
  if (error) {
    console.warn('[wpbl] fetchGameReminderIds failed:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map(r => r.game_id as string))
}

/**
 * Opt the user into a pre-game push for `game`. Ensures a live push subscription
 * first (requesting notification permission if needed), then records the opt-in.
 * Returns null on success or a user-facing error string — the same contract as
 * enablePush(), so the caller can surface it inline.
 */
export async function addGameReminder(userId: string, game: WpblGame): Promise<string | null> {
  // Make sure this browser can actually receive the push. If a subscription
  // already exists we skip the permission prompt; otherwise enablePush requests it.
  if (!(await isSubscribed())) {
    const err = await enablePush(userId)
    if (err) return err
  }

  const { error } = await supabase
    .from('wpbl_game_reminders')
    .upsert({
      user_id:   userId,
      game_id:   game.id,
      game_date: game.game_date,
      lead_min:  DEFAULT_LEAD_MIN,
    }, { onConflict: 'user_id,game_id' })

  if (error) {
    console.warn('[wpbl] addGameReminder failed:', error.message)
    return 'Couldn’t save your reminder. Please try again.'
  }
  return null
}

/**
 * Turn a reminder back off. Leaves the push subscription in place (the user may
 * have other reminders, in this league or MLB, riding on it).
 */
export async function removeGameReminder(userId: string, gameId: string): Promise<string | null> {
  const { error } = await supabase
    .from('wpbl_game_reminders')
    .delete()
    .eq('user_id', userId)
    .eq('game_id', gameId)

  if (error) {
    console.warn('[wpbl] removeGameReminder failed:', error.message)
    return 'Couldn’t remove your reminder. Please try again.'
  }
  return null
}
