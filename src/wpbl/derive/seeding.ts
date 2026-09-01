import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'
import { countsInStandings } from '../season'

// The seeding race: what the remaining regular-season games actually decide.
//
// All four clubs qualify for the postseason, so a clinch tracker or a playoff-odds board has
// nothing to say, which is why both stay parked. Seeding is the opposite: the standings order
// IS the bracket (1v4 and 2v3 in the semifinals), it is the only thing the last games decide,
// and until now nothing on the section said so.
//
// Pure: standings rows and the schedule in, plain shapes out. No supabase, no React, mirroring
// stats.ts / matchups.ts. Everything here derives from `computeStandings`, which means no new
// column, no new request, and no way for this to disagree with the table it sits under.

/** The semifinal pairing a seed draws, by the published format. */
export const SEMIFINAL_PAIRS: [number, number][] = [[1, 4], [2, 3]]

export interface WpblSeedRow {
  team: WpblTeam
  /** 1..4: position in `computeStandings` order, tiebreaks already applied. */
  seed: number
  wins: number
  losses: number
  /** Regular-season games this club has left to play (live counts as unplayed). */
  remaining: number
  /** Wins if it takes every one of them. The ceiling every magic number is measured against. */
  maxWins: number
  /** Games ahead of the seed directly below, in the usual half-game units. null for the
   *  bottom seed, which has nobody below it. */
  aheadOfNext: number | null
  /** Games behind the seed directly above. null for the top seed. */
  behindPrev: number | null
  /** Wins-plus-rival-losses still needed to lock THIS seed or better. 0 = already locked.
   *  null for the bottom seed, where "no worse than fourth" is not a thing to clinch. */
  magic: number | null
  /** The same number for the BEST seed still reachable, which is the only figure the bottom
   *  seed has: it holds nothing, so "N to lock 4th" is vacuous while "N to reach 3rd" is the
   *  whole of its remaining season. null when the club is already in the best seat it can
   *  reach, where `magic` is the number that matters instead. Never both on screen at once. */
  climbMagic: number | null
  /** The best seed still mathematically reachable, and the worst it can still fall to.
   *  bestPossible === worstPossible means this exact seed is settled. */
  bestPossible: number
  worstPossible: number
  /** Who this seed would draw in the semifinals as things stand. null if the other side of
   *  the pairing is missing (a partial league, i.e. only in tests and empty states). */
  opponent: WpblTeam | null
}

/** A game is decided once it is final with both scores in. Anything else (scheduled, live,
 *  final-but-unscored) is still out there to be won. */
function isPlayed(g: WpblGame): boolean {
  return g.status === 'final' && g.home_score != null && g.away_score != null
}

/**
 * How many wins-or-rival-losses `a` still needs to be GUARANTEED to finish ahead of `b`.
 *
 * The standard magic number, stated against the rival's ceiling rather than against a fixed
 * 15-game season, so a postponement or an unbalanced schedule cannot make it lie:
 * `b.maxWins - a.wins + 1`. Each `a` win raises the left side of that comparison; each `b`
 * loss lowers `b.maxWins`; either way the number drops by one, which is the whole point of
 * quoting it.
 *
 * Deliberately ignores the head-to-head tiebreak. At 0 this says `a` finishes ahead OUTRIGHT,
 * with no tiebreak needed. That is a stronger and much easier claim to trust than one resting on
 * a series that has not been played yet. It therefore reads slightly pessimistic near the end,
 * which is the safe direction for a number a fan will quote at someone.
 */
export function magicOver(a: { wins: number }, b: { maxWins: number }): number {
  return Math.max(0, b.maxWins - a.wins + 1)
}

/**
 * The seeding picture, in standings order.
 *
 * `rows` must come from `computeStandings` (which is where the tiebreaks live); `games` is the
 * full schedule, filtered here to the regular season, since the postseason games this is trying
 * to seed obviously do not seed themselves.
 */
export function seedingRace(rows: WpblStandingRow[], games: WpblGame[]): WpblSeedRow[] {
  // Remaining games per club, from the games that count toward the season record.
  const left = new Map<string, number>(rows.map(r => [r.team.id, 0]))
  for (const g of games) {
    if (isPlayed(g) || !countsInStandings(g)) continue
    for (const id of [g.home_team_id, g.away_team_id]) {
      const n = left.get(id)
      if (n != null) left.set(id, n + 1)
    }
  }

  const base = rows.map((r, i) => ({
    row: r,
    seed: i + 1,
    remaining: left.get(r.team.id) ?? 0,
    maxWins: r.wins + (left.get(r.team.id) ?? 0),
  }))

  return base.map((me, i) => {
    const others = base.filter((_, j) => j !== i)

    // Magic to lock seed k = be guaranteed ahead of at least (N - k) of the others. So sort the
    // per-rival magic numbers and read off the (N - k)th smallest: the cheapest set of rivals
    // that gets there. For the seed this club currently holds, k = seed, so it needs to hold off
    // (N - seed) clubs, which for the bottom seed is none, hence null rather than a vacuous 0.
    const perRival = others.map(o => magicOver(me.row, o)).sort((a, b) => a - b)
    const magicFor = (k: number) => {
      const needed = base.length - k
      return needed <= 0 ? null : perRival[needed - 1] ?? null
    }
    const magic = magicFor(me.seed)

    // Ceiling and floor, on the same "outright, no tiebreak" footing as the magic number. Best
    // case: this club wins out, everyone else loses out, and a rival can still finish ahead if its
    // CURRENT wins already match that ceiling. Worst case is the mirror image.
    const bestPossible = 1 + others.filter(o => o.row.wins >= me.maxWins).length
    const worstPossible = 1 + others.filter(o => o.maxWins >= me.row.wins).length

    // The climb is priced with the same function as the defence, deliberately: two formulas for
    // "what does this club still need" would eventually disagree in front of a reader, and the
    // question is the same one asked about a different seed.
    const climbMagic = bestPossible < me.seed ? magicFor(bestPossible) : null

    const gb = (ahead: typeof me, behind: typeof me) =>
      ((ahead.row.wins - behind.row.wins) + (behind.row.losses - ahead.row.losses)) / 2

    const pair = SEMIFINAL_PAIRS.find(p => p.includes(me.seed))
    const oppSeed = pair?.find(s => s !== me.seed)
    const prev = base[i - 1], next = base[i + 1]

    return {
      team: me.row.team,
      seed: me.seed,
      wins: me.row.wins,
      losses: me.row.losses,
      remaining: me.remaining,
      maxWins: me.maxWins,
      aheadOfNext: next ? gb(me, next) : null,
      behindPrev: prev ? gb(prev, me) : null,
      magic,
      climbMagic,
      bestPossible,
      worstPossible,
      opponent: base.find(o => o.seed === oppSeed)?.row.team ?? null,
    }
  })
}

/** Which semifinal a seed lands in, as a letter: 1 and 4 play in A, 2 and 3 in B. Our own
 *  labels, not the league's, which names its games by date. They exist so the two clubs that
 *  would meet carry a mark in common on a list sorted by seed, where they are never adjacent. */
export function semifinalLabel(seed: number): string | null {
  const i = SEMIFINAL_PAIRS.findIndex(p => p.includes(seed))
  return i < 0 ? null : String.fromCharCode(65 + i)
}

/** Whether the whole order is settled: every club's seed is fixed, so the bracket above is
 *  the real bracket rather than a snapshot.
 *
 *  No separate "the schedule is empty" case, which looks like an omission and is not: with
 *  nothing left to play `maxWins` collapses onto `wins`, both range formulas reduce to the
 *  same count, and every club's range closes on its own. Two clubs finishing level on record
 *  both land on the LOWER of their two seeds there, which is the pessimistic reading the rest
 *  of this module takes everywhere and does not affect the answer here. */
export function bracketIsSet(seeds: WpblSeedRow[]): boolean {
  return seeds.length > 0 && seeds.every(s => s.bestPossible === s.worstPossible)
}

/** A remaining game between two clubs directly disputing a seed line. */
export interface WpblSwingGame {
  game: WpblGame
  /** The two clubs, better seed first. Both are in the standings order the card renders. */
  higher: WpblSeedRow
  lower: WpblSeedRow
}

/**
 * The games left that can still move the order, which is the fact a magic number cannot carry.
 *
 * A column of magic numbers says what each club needs and never says WHEN it gets decided. In a
 * four-club league most of the answer is one date: two of the clubs disputing a seed line play
 * each other, and that game settles more than any other night left.
 *
 * TWO CONDITIONS, AND BOTH ARE DELIBERATELY STRICT.
 *
 * ADJACENT in the standings, so this means "these two are arguing over the same seat". A game
 * between the 1 and 3 seeds can matter too, but there is no honest way to rank it against the
 * rest without a win model, and the point of this line is to name a game rather than to grade
 * every game. Adjacency is the one relationship a reader can check against the table above.
 *
 * OPEN, in the same outright sense the magic numbers use: neither club has yet clinched
 * finishing ahead of the other. `magicOver` at 0 in either direction means the order between
 * them is already settled and the game, whoever wins it, decides nothing about their pairing.
 * That is what keeps a dead rubber off this line in the last week, which is exactly when the
 * line is most likely to be read.
 */
export function swingGames(seeds: WpblSeedRow[], games: WpblGame[]): WpblSwingGame[] {
  const bySeed = new Map(seeds.map(s => [s.team.id, s]))
  const out: WpblSwingGame[] = []
  for (const g of games) {
    if (isPlayed(g) || !countsInStandings(g)) continue
    const a = bySeed.get(g.home_team_id), b = bySeed.get(g.away_team_id)
    if (!a || !b || Math.abs(a.seed - b.seed) !== 1) continue
    const [higher, lower] = a.seed < b.seed ? [a, b] : [b, a]
    if (magicOver(higher, lower) === 0 || magicOver(lower, higher) === 0) continue
    out.push({ game: g, higher, lower })
  }
  // Date order, because the first one is the one being asked about. `game_date` is a plain
  // YYYY-MM-DD, which sorts correctly as a string and avoids parsing it into a Date at all:
  // the feed's dates are naive local days and constructing a Date from one shifts it a day in
  // half the world's timezones.
  return out.sort((x, y) => x.game.game_date.localeCompare(y.game.game_date))
}
