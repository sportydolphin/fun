import { TEAM_ABBR } from '../constants'
import type { RosterMove } from '../api'

// ─── Which transactions are worth a row ────────────────────────────────────────
//
// The transactions feed is a ledger of every paper move in the sport, a thousand-odd a month. This
// decides which of them the Roster Moves card and its list show, in two modes.
//
// IN SEASON it is trades, designations, claims, releases, signings and suspensions; options,
// recalls, rehab assignments and status changes are daily churn.
//
// IN THE WINTER (the card is "Hot Stove" from the end of the World Series to opening day) it adds
// the two moves that ARE the offseason's news: a player declaring free agency (`DFA` on the wire,
// which is NOT "designated for assignment": that one is `DES`) and a Rule 5 selection. Over Nov 1
// to Dec 15, 2025 the feed carried 251 of the first and 13 of the second, against 76 trades.
//
// A MINOR-LEAGUE CONTRACT IS NEVER A ROW, in either mode. Signings are `SFA` whether the deal is a
// nine-figure contract or a spring-training invitation, and over that same winter 234 of 279 were
// minor-league deals, which would have buried every real signing on the card. The feed says so only
// in the description, so that is what is read.

const SEASON_TYPES   = new Set(['TR', 'DES', 'CLW', 'REL', 'SFA', 'SU'])
const HOT_STOVE_TYPES = new Set([...SEASON_TYPES, 'DFA', 'R5'])

/** How far back each mode reads. The winter has quiet weeks around the holidays, and an empty card
 *  in January says the feed is broken rather than that nothing happened. */
export const moveWindowDays = (hotStove: boolean) => (hotStove ? 30 : 14)

const MINOR_DEAL = /minor league contract/i

interface FeedTransaction {
  id: number
  typeCode?: string
  typeDesc?: string
  date?: string
  description?: string
  person?: { id?: number; fullName?: string }
  fromTeam?: { id?: number }
  toTeam?: { id?: number }
}

export function pickMoves(transactions: FeedTransaction[], hotStove: boolean): RosterMove[] {
  const types = hotStove ? HOT_STOVE_TYPES : SEASON_TYPES
  const moves: RosterMove[] = []
  // A trade shares one transaction id across both sides (one row per player, from/to swapped), so
  // dedupe on id+person, not id alone, which would drop the other player.
  const seen = new Set<string>()
  for (const t of transactions) {
    if (!t.typeCode || !types.has(t.typeCode) || !t.person?.id) continue
    if (t.typeCode === 'SFA' && MINOR_DEAL.test(t.description ?? '')) continue
    const key = `${t.id}:${t.person.id}`
    if (seen.has(key)) continue
    const fromId = t.fromTeam?.id && TEAM_ABBR[t.fromTeam.id] ? Number(t.fromTeam.id) : null
    const toId   = t.toTeam?.id   && TEAM_ABBR[t.toTeam.id]   ? Number(t.toTeam.id)   : null
    // The feed includes minor-league paper moves. Keep only moves touching an MLB club.
    if (fromId == null && toId == null) continue
    seen.add(key)
    moves.push({
      id: t.id, playerId: Number(t.person.id), playerName: t.person.fullName ?? '?',
      fromTeamId: fromId, toTeamId: toId,
      date: t.date ?? '', typeCode: t.typeCode, typeDesc: t.typeDesc ?? '',
      description: t.description ?? '',
    })
  }
  // Newest first; trades outrank other moves from the same day.
  moves.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    Number(b.typeCode === 'TR') - Number(a.typeCode === 'TR'))
  return moves
}

/**
 * The card's few rows in the winter. The day after the World Series a whole free-agent class
 * declares at once (well over a hundred rows on one date), so left in, the card would be nothing
 * but names leaving clubs and no signing or trade would reach it. They stay in the full list, where
 * the club filter makes them "who left my team"; on the card only the followed club's are kept.
 */
export function cardMoves(moves: RosterMove[], hotStove: boolean, followedTeamId?: number | null): RosterMove[] {
  if (!hotStove) return moves
  const touches = (m: RosterMove) => followedTeamId != null && (m.fromTeamId === followedTeamId || m.toTeamId === followedTeamId)
  const newest = moves.reduce((d, m) => (m.date > d ? m.date : d), '')
  const fresh = (m: RosterMove) => daysBetween(m.date, newest) <= FRESH_DAYS
  return moves
    .filter(m => m.typeCode !== 'DFA' || touches(m))
    .map((m, i) => ({ m, i }))
    .sort((a, b) =>
      Number(fresh(b.m)) - Number(fresh(a.m))
      || (MOVE_RANK[a.m.typeCode] ?? 2) - (MOVE_RANK[b.m.typeCode] ?? 2)
      || Number(touches(b.m)) - Number(touches(a.m))
      || a.i - b.i)
    .map(({ m }) => m)
}

// NEWEST-FIRST LET A RELEASE BURY A SIGNING. The card holds four rows, and the feed files a nine-figure
// contract beside a waiver claim on the same day, so a real signing could be gone from the card by the
// next morning. Within the last week (a band, so an old signing never outranks this week's news) the
// moves readers came for lead, and a followed club's lead its kind. Only the winter's card: the full
// list stays in date order, and in season the card is a deadline-week log.
const FRESH_DAYS = 7
const MOVE_RANK: Record<string, number> = { SFA: 0, TR: 0, R5: 1, CLW: 1, SU: 1, DFA: 2, DES: 3, REL: 3 }
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000

const MOVE_NOUNS: [string, string, string][] = [
  ['SFA', 'signing', 'signings'], ['TR', 'trade', 'trades'], ['DFA', 'free agent', 'free agents'], ['R5', 'Rule 5 pick', 'Rule 5 picks'],
  ['CLW', 'claim', 'claims'], ['DES', 'DFA', 'DFAs'], ['REL', 'release', 'releases'], ['SU', 'suspension', 'suspensions'],
]

/** The club's winter on one line, its two commonest kinds of move: "6 free agents · 2 trades". Null with none. */
export function moveSummary(moves: RosterMove[], teamId: number): string | null {
  const mine = moves.filter(m => m.fromTeamId === teamId || m.toTeamId === teamId)
  const seenTrades = new Set<number>()
  const counts = new Map<string, number>()
  for (const m of mine) {
    if (m.typeCode === 'TR') { if (seenTrades.has(m.id)) continue; seenTrades.add(m.id) }
    counts.set(m.typeCode, (counts.get(m.typeCode) ?? 0) + 1)
  }
  const parts = MOVE_NOUNS
    .map(([code, one, many], order) => ({ n: counts.get(code) ?? 0, one, many, order }))
    .filter(p => p.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, 2)
    .map(p => `${p.n} ${p.n === 1 ? p.one : p.many}`)
  return parts.length ? parts.join(' · ') : null
}
