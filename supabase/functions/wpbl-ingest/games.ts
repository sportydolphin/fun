// Which copy of a duplicated game to keep. Its own module for the reason names.ts is: the rule
// DELETES rows, and index.ts imports the Supabase client over HTTPS so only Deno can load it,
// while nothing here has any dependencies at all and can be pinned from the app's test runner
// (see src/wpbl/__tests__/ingestTwins.test.ts).

// The hub venue's zone. Every WPBL game is played on Central time, at one venue.
export const HUB_ZONE = 'America/Chicago'

/** One copy of a matchup, as the tiebreak below sees it. */
export interface TwinCopy {
  gameId: string
  /** Completed, in progress, or anything the feed does not call "Not Started". */
  played: boolean
  /** Both club ids present. A TBD placeholder has neither. */
  hasTeams: boolean
  /** `presto_data.timeZone`: the zone the feed tagged THIS copy's start with. */
  feedZone: string
}

/**
 * The copy to keep out of a group the feed published for one matchup at one first pitch.
 *
 * WHY THE ZONE TAG IS IN HERE, AND WHY IT SITS WHERE IT DOES. The feed emits each game twice,
 * once tagged Eastern and once Central, for the same date, matchup and (after correction) first
 * pitch. Before first pitch both read "Not Started", so `played` and `hasTeams` tie on every
 * pair and the whole decision used to fall through to the id, which is a coin flip. Measured
 * across the 2026 season it landed the wrong way on 12 of 25 pairs: the row was deleted at
 * first pitch and rebuilt under a new uuid, taking everything keyed to the old one with it
 * (reminder opt-ins, an open `/predict` round). It was not even a fair coin going forward, as
 * the schedule ships Eastern-tagged in July and the Central copy is minted on the day, so every
 * unplayed game in the mirror was sitting on the copy that would lose.
 *
 * The league plays every game in Central at one venue, and the Central-tagged copy is the one
 * it publishes results against: 24 of the 25 pairs were played on it. So it is a real signal,
 * not a coincidence, and it goes BELOW `played`, which is evidence rather than a guess. That
 * ordering is what bounds the downside: on the one pair where the zone tag pointed at the wrong
 * copy (opening day), the result is the swap at first pitch that used to happen anyway. It can
 * never keep an unplayed copy over a played one.
 *
 * The id still breaks a remaining tie, so the answer does not depend on feed ordering. Three
 * copies of one game have been seen, two of them Central-tagged.
 */
export function bestTwin<T extends TwinCopy>(group: readonly T[]): T | undefined {
  let best: T | undefined
  for (const c of group) {
    if (!best) { best = c; continue }
    const d = twinRank(c) - twinRank(best)
    if (d > 0 || (d === 0 && c.gameId < best.gameId)) best = c
  }
  return best
}

/** Higher is more real. Exported for the tests; `bestTwin` is what the ingest calls. */
export function twinRank(c: TwinCopy): number {
  return (c.played ? 4 : 0) + (c.hasTeams ? 2 : 0) + (c.feedZone === HUB_ZONE ? 1 : 0)
}
