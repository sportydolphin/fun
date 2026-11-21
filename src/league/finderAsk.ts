// A ranking, a record or a plain question typed as words, as the Find question that answers it.
//
// ONE READER FOR THE SEARCH AND THE BOARD. The shell's search (src/finderSearch.ts) offered
// "avg vs lefties", "most walks in a game" and "most hr in an inning" as Find links, each built in
// its own row function, while the board's own "Ask in words" box read only the plain grammar and
// answered nothing to any of them (Nov 19, 2026). The conversions live here, league-neutral, so the
// same words make the same question in both places, and neither has a copy to drift.

import { conditionsForPer, finderCutsOf, finderFields, hasFinderCut, hasPlayerFilter, PA_CUT_KEYS, PA_SEASON_KEYS, type FinderBoardSide, type FinderQuery } from './finder'
import { parseClubScope, parseFinderText, parseRecordQuestion, parseScopedRank, rankLowerBetter, type FinderClubAlias, type ParsedFinder, type ParsedRecord, type ParsedScopedRank } from './finderParse'

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
    ...finderCutsOf(r),
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

// "most grand slams", "two out rbi leaders", "most walk-off hits": a word for a ranking.
// Not "leading off", which is where a trip began ("home runs leading off the game").
const RANK_WORD = /(?<![a-z])(?:most|leaders?|leading(?!\s+off)|top)(?![a-z])/
const FEWEST_WORD = /(?<![a-z])(?:fewest|least|lowest)(?![a-z])/

/** Whether words ask for the most of something, not the fewest. */
export function asksForMost(text: string): boolean {
  const t = text.toLowerCase()
  return RANK_WORD.test(t) && !FEWEST_WORD.test(t)
}

/**
 * A plate-appearance question asked as a ranking, as the hitters' season that answers it: "most grand
 * slams" is each hitter's home runs over the trips with the bases loaded, highest first. The plain
 * reading of those words is every such trip, which lists the plays and leaves the counting to the
 * reader. Only one stat a season of trips can sum (`PA_SEASON_KEYS`), with at least one other condition
 * and every other one a cut (`PA_CUT_KEYS`); anything else stays the plays. Null when it is not that.
 */
export function paRankFinder(p: ParsedFinder): FinderAsk | null {
  if (p.side !== 'hitting' || p.per !== 'pa') return null
  const stats = p.conditions.filter(c => !PA_CUT_KEYS.has(c.field))
  // With no cut it is the stat's own leaderboard ("most k's"), which the leaders already answer.
  if (stats.length === p.conditions.length) return null
  if (stats.length !== 1 || stats[0].op !== 'gte' || !PA_SEASON_KEYS.has(stats[0].field)) return null
  const field = stats[0].field
  return {
    ...p, per: 'season', bare: undefined,
    conditions: [{ field, op: 'gte', value: 1 }, ...p.conditions.filter(c => PA_CUT_KEYS.has(c.field))],
    rank: { lead: 'Most', field },
  }
}

const sameQuestion = (a: ParsedFinder, b: ParsedFinder) => a.side === b.side && a.per === b.per && !!a.byClub === !!b.byClub
  && a.teamId === b.teamId && a.oppId === b.oppId && a.venue === b.venue && a.season === b.season
  && JSON.stringify(finderCutsOf(a)) === JSON.stringify(finderCutsOf(b))
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
  const plain = parseFinderText(text, clubs, sides, opts)
  if (opts.plays && asksForMost(text)) {
    for (const p of plain) add(paRankFinder(p))
  }
  for (const p of plain) add(p)
  return out
}

/** The parts of a question `addToFinderQuestion` reads and writes: a reading, or the board's own query. */
type AddableQuestion = Pick<ParsedFinder, 'side' | 'per' | 'conditions' | 'teamId' | 'oppId' | 'venue' | 'ignored'>
  & { season?: number | null; byClub?: boolean; rank?: unknown; playerId?: string | null; batterId?: string | null; pitcherId?: string | null }
  & Partial<Pick<ParsedFinder, 'from' | 'to' | 'last' | 'hand' | 'extra' | 'dh' | 'stretch'>>

/**
 * WHAT A PHRASE TYPED UNDER A QUESTION ADDS TO IT, best first, ahead of `readings` (the phrase read on
 * its own, which stays offered for a reader who meant a new question). The box says "Add: vs LA, 2+
 * RBI" once a question is set, but every reading replaced the question whole: "2+ RBI" under "Bases
 * loaded, walk" threw the walk away, and "for BOS" read as nothing at all, since a club alone names no
 * stat (Nov 20, 2026). A who or where alone (`parseClubScope`) sets that and keeps the rest; a stat
 * the question's grain can ask joins its conditions, replacing one on the same stat. A ranking, a
 * named player or another side is a new question, and is left as it reads.
 */
export function addToFinderQuestion<R extends AddableQuestion>(
  base: R, text: string, clubs: readonly FinderClubAlias[], readings: R[],
): R[] {
  const scope = parseClubScope(text, clubs)
  const cutsOf = (r: Partial<AddableQuestion>) => finderCutsOf(r as Parameters<typeof finderCutsOf>[0])
  const merge = (r: Partial<AddableQuestion>, conditions: R['conditions']): R => {
    const own = cutsOf(r), was = cutsOf(base)
    const cuts = Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v ?? was[k as keyof typeof was]]))
    return {
      ...base, ...cuts, conditions, ignored: r.ignored ?? [],
      teamId: r.teamId ?? base.teamId, oppId: r.oppId ?? base.oppId,
      venue: r.venue && r.venue !== 'any' ? r.venue : base.venue,
      season: r.season ?? base.season,
    }
  }
  if (scope && scope.teamIds.length === 1 && scope.oppIds.length === 1 && (!scope.per || scope.per === base.per)) {
    const { teamIds, oppIds, venue, season, per: _per, ...cuts } = scope
    return [merge({ ...cuts, teamId: teamIds[0], oppId: oppIds[0], venue, season, ignored: [] }, base.conditions), ...readings]
  }
  const added: R[] = []
  for (const r of readings) {
    if (r.side !== base.side || r.rank || r.playerId || r.batterId || r.pitcherId || !!r.byClub !== !!base.byClub) continue
    // A stat read at another grain ("2+ RBI" is a game's) joins a plate appearance when one can have it.
    if (r.per !== base.per && conditionsForPer(base.side, base.per, r.conditions, true, !!base.byClub).length !== r.conditions.length) continue
    const asked = new Set(r.conditions.map(c => c.field))
    const conditions = [...base.conditions.filter(c => !asked.has(c.field)), ...r.conditions].slice(0, 6)
    added.push(merge(r, conditions))
    break
  }
  return [...added, ...readings]
}

/** The question on a board as a reading `addToFinderQuestion` can add to, or null while nothing is
 *  asked (the start screen), where a typed phrase is a new question. */
export function boardQuestion(side: FinderBoardSide, q: FinderQuery, season: number | null = null): AddableQuestion | null {
  const asked = q.conditions.length > 0 || !!q.teamId || !!q.oppId || q.venue !== 'any' || hasFinderCut(q) || hasPlayerFilter(side, q)
  return asked ? {
    side, per: q.per, conditions: q.conditions, teamId: q.teamId, oppId: q.oppId, venue: q.venue, byClub: !!q.byClub,
    ...finderCutsOf(q), season, ignored: [],
  } : null
}
