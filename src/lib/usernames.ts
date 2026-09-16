import { supabase } from './supabase'
import { containsProfanity } from './profanity'

// ─── Shared username validation ────────────────────────────────────────────────

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/

export function usernameValidationMsg(val: string): string | null {
  if (val.length === 0) return null
  if (val.length < 3)  return 'At least 3 characters'
  if (val.length > 20) return 'Max 20 characters'
  if (!/^[a-zA-Z0-9_-]+$/.test(val)) return 'Letters, numbers, _ and - only'
  // A public display name (leaderboards, predictions), so keep the obviously offensive ones off
  // it. A database trigger enforces the same rule on write (see lib/profanity.ts); this is the
  // in-form half.
  if (containsProfanity(val)) return 'Please choose a different name'
  return null
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { data } = await supabase.from('usernames').select('user_id').eq('username', username).maybeSingle()
  return !!data
}

// ─── Soft-delete enforcement ────────────────────────────────────────────────────
// The owner can deactivate accounts from the Admin panel (an `is_deleted` flag on
// `usernames`, see scripts/add_user_admin.sql). These helpers keep deactivated users
// off public leaderboards and out of the app. Both degrade to "nobody is deactivated"
// if the column hasn't been migrated yet, so nothing breaks pre-migration.

// The set of deactivated user_ids, optionally narrowed to a list of ids you care about
// (leaderboards pass the ids already on the board to keep the query small).
export async function fetchDeactivatedUserIds(userIds?: string[]): Promise<Set<string>> {
  if (userIds && userIds.length === 0) return new Set()
  let q = supabase.from('usernames').select('user_id').eq('is_deleted', true)
  if (userIds) q = q.in('user_id', userIds)
  const { data, error } = await q
  if (error) return new Set()   // column not migrated / query failed → enforce nothing
  return new Set((data ?? []).map(r => r.user_id as string))
}

// Whether one specific user is deactivated — used to block them at sign-in.
export async function isUserDeactivated(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('usernames').select('is_deleted').eq('user_id', userId).maybeSingle()
  if (error) return false
  return !!data?.is_deleted
}

// ─── Random baseball-themed username generator ─────────────────────────────────
// Used when a new account doesn't pick a username — combines two baseball
// words + a number, e.g. "SluggerRocket482".

const WORDS_A = [
  'Slugger', 'Curveball', 'Fastball', 'Knuckler', 'Southpaw', 'Bullpen', 'Dugout',
  'Diamond', 'Bunt', 'Cleanup', 'Rookie', 'Closer', 'Ace', 'Walkoff', 'Pinchhit',
  'Grandslam', 'Inning', 'Bleacher', 'Outfield', 'Infield', 'Strikeout', 'Homer',
  'Triple', 'Fungo',
]
const WORDS_B = [
  'Bomber', 'Hitter', 'Pitcher', 'Catcher', 'Slider', 'Screwball', 'Changeup',
  'Sinker', 'Heater', 'Cannon', 'Rocket', 'Legend', 'Star', 'Champ', 'Captain',
  'Wizard', 'Hero', 'Tiger', 'Hawk', 'Bear', 'Wolf', 'Eagle', 'Shark', 'Storm',
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function candidate(): string {
  const num = Math.floor(Math.random() * 900) + 10 // 10–909
  return `${randomFrom(WORDS_A)}${randomFrom(WORDS_B)}${num}`
}

export async function generateUniqueUsername(maxAttempts = 12): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const name = candidate()
    // The word lists are clean, but a concatenation is the one way two innocent parts could form
    // something that is not, so never hand back a generated name the filter would reject.
    if (containsProfanity(name)) continue
    if (!(await isUsernameTaken(name))) return name
  }
  // Astronomically unlikely fallback — a timestamp suffix guarantees uniqueness
  return `${randomFrom(WORDS_A)}${randomFrom(WORDS_B)}${Date.now() % 100000}`
}
