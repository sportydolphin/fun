import { supabase } from './supabase'

// ─── Shared username validation ────────────────────────────────────────────────

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/

export function usernameValidationMsg(val: string): string | null {
  if (val.length === 0) return null
  if (val.length < 3)  return 'At least 3 characters'
  if (val.length > 20) return 'Max 20 characters'
  if (!/^[a-zA-Z0-9_-]+$/.test(val)) return 'Letters, numbers, _ and - only'
  return null
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { data } = await supabase.from('usernames').select('user_id').eq('username', username).maybeSingle()
  return !!data
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
    if (!(await isUsernameTaken(name))) return name
  }
  // Astronomically unlikely fallback — a timestamp suffix guarantees uniqueness
  return `${randomFrom(WORDS_A)}${randomFrom(WORDS_B)}${Date.now() % 100000}`
}
