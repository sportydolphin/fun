// The questions a reader ran from the search box ("most hr all time", "5 strikeouts no walks",
// "what is FIP"), kept so they come back under Recent beside the players and clubs.
//
// THE SHELL'S, NOT THE SECTIONS'. Each section keeps its own player and club recents, synced to the
// account in a column whose shape is a player or a club (`user_preferences.recent_searches`,
// `wpbl_recent_searches`), and a client from before this change drops any entry it does not know as
// it writes the list back, so putting a question in there would lose it on the next sync from an
// older tab. A question is a link and a title, already self-describing, so it lives here, on this
// device only.
//
// AND THE ORDER. Recent is one list, newest first, but the sections' recents carry no time. So the
// palette also notes when it opened each player or club row; a row it never saw opened (picked
// before this existed, or on another device) sorts after everything it did. See mergeRecent.

import type { NavSection } from '../sectionNav'

export interface RecentQuestion {
  kind: 'leader' | 'finder' | 'definition'
  title: string
  subtitle?: string
  href: string
  /** The part of the page to scroll to (lib/sectionScroll.ts), for a glossary term. */
  scrollTo?: string
  at: number
}

const MAX_QUESTIONS = 8
const MAX_PICKS = 30
const qKey = (s: NavSection) => `sdRecentQuestions:${s}`
const pKey = (s: NavSection) => `sdPalettePicks:${s}`

function read<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback } catch { return fallback }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: kept for nobody */ }
}

const isQuestion = (x: unknown): x is RecentQuestion => {
  const q = x as RecentQuestion
  return !!q && ['leader', 'finder', 'definition'].includes(q.kind) && typeof q.title === 'string'
    && typeof q.href === 'string' && typeof q.at === 'number'
}

export function getRecentQuestions(section: NavSection): RecentQuestion[] {
  const v = read<unknown[]>(qKey(section), [])
  return Array.isArray(v) ? v.filter(isQuestion) : []
}

/** Front of the list, once: the same link asked again moves up rather than repeating. */
export function recordRecentQuestion(section: NavSection, q: Omit<RecentQuestion, 'at'>, now = Date.now()): void {
  const same = (x: RecentQuestion) => x.href === q.href && (x.scrollTo ?? null) === (q.scrollTo ?? null)
  write(qKey(section), [{ ...q, at: now }, ...getRecentQuestions(section).filter(x => !same(x))].slice(0, MAX_QUESTIONS))
}

/** When the palette opened a player or club row, by the row's key. */
export function getRowPicks(section: NavSection): Record<string, number> {
  const v = read<Record<string, number>>(pKey(section), {})
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export function recordRowPick(section: NavSection, key: string, now = Date.now()): void {
  const kept = Object.entries({ ...getRowPicks(section), [key]: now }).sort((a, b) => b[1] - a[1]).slice(0, MAX_PICKS)
  write(pKey(section), Object.fromEntries(kept))
}

export function clearRecentQuestions(section: NavSection): void {
  try { localStorage.removeItem(qKey(section)); localStorage.removeItem(pKey(section)) } catch { /* nothing kept */ }
}

/**
 * One Recent list, newest first: the section's rows in their own order, each placed by when the
 * palette last opened it, and the questions by when they were asked. A row with no time keeps its
 * place among the rows but sorts after every timed entry, since anything with a time is known to be
 * at least that recent. Stable, so equal entries keep the section's order.
 */
export function mergeRecent<R extends { key: string }>(rows: R[], questions: RecentQuestion[], picks: Record<string, number>, max: number):
  ({ row: R } | { question: RecentQuestion })[] {
  const timed = [
    ...rows.map((row, i) => ({ entry: { row } as { row: R } | { question: RecentQuestion }, at: picks[row.key] ?? -1, i })),
    ...questions.map((question, i) => ({ entry: { question } as { row: R } | { question: RecentQuestion }, at: question.at, i: rows.length + i })),
  ]
  return timed.sort((a, b) => b.at - a.at || a.i - b.i).slice(0, max).map(t => t.entry)
}
