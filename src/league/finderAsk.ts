// A ranking, a record or a plain question typed as words, as the Find question that answers it.
//
// ONE READER FOR THE SEARCH AND THE BOARD. The shell's search (src/finderSearch.ts) offered
// "avg vs lefties", "most walks in a game" and "most hr in an inning" as Find links, each built in
// its own row function, while the board's own "Ask in words" box read only the plain grammar and
// answered nothing to any of them (Nov 19, 2026). The conversions live here, league-neutral, so the
// same words make the same question in both places, and neither has a copy to drift.

import { finderFields, type FinderBoardSide } from './finder'
import { parseFinderText, parseRecordQuestion, parseScopedRank, rankLowerBetter, type FinderClubAlias, type ParsedFinder, type ParsedRecord, type ParsedScopedRank } from './finderParse'

/** A Find question read off words, with how a ranking was asked when it was one. */
export interface FinderAsk extends ParsedFinder {
  /** A ranking ("Highest batting average vs LHP", "Most walks in a game"): its word and stat. The
   *  board ranks its rows highest first by the first condition, so the ranking IS the question. */
  rank?: { lead: 'Most' | 'Highest' | 'Lowest'; field: string }
}

export type FinderAskOpts = { plays?: boolean; regulationInnings?: number }

// "most runs in an inning", "biggest innings": the inning record, which neither the leaders (season
// totals) nor the Bests boards (one game) hold. The Find board already lists its matches highest
// first by the question's stat, so "at least 1, in an inning" IS that ranking. Only where the plays
// are read: MLB has no play log to cut into innings.
const INNING_MOST = /^\s*(?:what\s+(?:is|was|were|are)\s+)?(?:the\s+)?(?:most|highest|greatest)\s+(.+?)\s+in\s+(?:an?|one|a\s+single)\s+(?:half[\s-]+)?inning\s*\??\s*$/i
const BIGGEST_INNING = /^\s*(?:the\s+)?(?:biggest|largest)\s+innings?\s*\??\s*$/i

/** An inning record, as the plain question that asks it ("1+ hr in an inning"), or null. */
export function inningRecord(text: string): { text: string; stat: string } | null {
  if (BIGGEST_INNING.test(text)) return { text: '1+ runs in an inning', stat: 'runs' }
  const m = text.match(INNING_MOST)
  return m ? { text: `1+ ${m[1]} in an inning`, stat: m[1] } : null
}

const CLUB_RATES = new Set(['avg', 'obp', 'slg', 'ops'])

/**
 * "avg vs lefties", "hr vs boston", "era at home": the season grain asking for every season that
 * could rank, highest first. A rate's low end can be the good one (ERA), so it asks for at least 0
 * and the board ranks it; a count asks for at least one. A rate over a cut carries its own smaller bar.
 * Null for a stat the board has no season field for.
 */
export function scopedRankFinder(r: ParsedScopedRank): FinderAsk | null {
  const field = finderFields(r.side, 'season', true, !!r.byClub).find(f => f.key === r.field)
  if (!field) return null
  const lower = rankLowerBetter(r.side, r.field)
  const rate = !!r.bar || (!!r.byClub && CLUB_RATES.has(r.field))
  const conditions = [{ field: r.field, op: 'gte' as const, value: rate && lower ? 0 : 1 },
    ...(r.bar ? [{ field: r.bar.field, op: 'gte' as const, value: r.bar.value }] : []), ...(r.situation ?? [])]
  return {
    side: r.side, per: 'season', conditions, teamId: r.teamId, oppId: r.oppId, venue: r.venue, season: r.season, ignored: [],
    from: r.from ?? null, to: r.to ?? null, last: r.last ?? null, hand: r.hand ?? null,
    ...(r.byClub ? { byClub: true } : {}),
    rank: { lead: rate ? (lower ? 'Lowest' : 'Highest') : 'Most', field: r.field },
  }
}

/** "most walks in a game", "most singles": the grain asking for at least one, highest first. */
export function recordFinder(r: ParsedRecord): FinderAsk {
  return {
    side: r.side, per: r.per, conditions: [{ field: r.field, op: 'gte', value: 1 }], teamId: r.teamId, oppId: r.oppId,
    venue: r.venue, season: r.season, ignored: [], ...(r.byClub ? { byClub: true } : {}),
    rank: { lead: 'Most', field: r.field },
  }
}

const sameQuestion = (a: ParsedFinder, b: ParsedFinder) => a.side === b.side && a.per === b.per && !!a.byClub === !!b.byClub
  && a.teamId === b.teamId && a.oppId === b.oppId && a.venue === b.venue && a.season === b.season && (a.hand ?? null) === (b.hand ?? null)
  && JSON.stringify(a.conditions) === JSON.stringify(b.conditions)

/**
 * Every reading of `text` as a Find question, best first: a ranking against a club, a place, a span
 * or an arm, then a record at any grain (a season one too, since on the board a season record is
 * the leaders), then the plain question. What the plain grammar already reads the same way is not
 * said twice. Each is a question the board can ask on one of `sides`.
 */
export function finderAskReadings(text: string, clubs: readonly FinderClubAlias[], sides: readonly FinderBoardSide[], opts: FinderAskOpts = {}): FinderAsk[] {
  const out: FinderAsk[] = []
  const add = (r: FinderAsk | null) => { if (r && sides.includes(r.side) && !out.some(o => sameQuestion(o, r))) out.push(r) }
  for (const r of parseScopedRank(text, clubs, opts)) add(scopedRankFinder(r))
  const inning = opts.plays ? inningRecord(text) : null
  if (inning) {
    for (const p of parseFinderText(inning.text, clubs, sides, opts)) {
      if (p.per === 'inning' && p.conditions.length === 1) add({ ...p, rank: { lead: 'Most', field: p.conditions[0].field } })
    }
  } else {
    for (const r of parseRecordQuestion(text, clubs, { season: true, plays: !!opts.plays })) {
      // A record is a field at its grain, or no question at all.
      if (finderFields(r.side, r.per).some(f => f.key === r.field)) add(recordFinder(r))
    }
  }
  for (const p of parseFinderText(text, clubs, sides, opts)) add(p)
  return out
}
