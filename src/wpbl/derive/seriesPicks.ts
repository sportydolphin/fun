import type { BracketSeries, WpblBracket } from './bracket'
import { winsNeeded } from './series'
import type { WpblTeam } from '../types'

/**
 * The bracket pick'em: predict each postseason series, by club AND by series score.
 *
 * WHY IT RIDES ON THE AWARDS BALLOT rather than a table of its own. `wpbl_award_votes` is
 * already "one browser, one answer, per named question", write-open and read-closed, with two
 * aggregate-only RPCs behind it; its own migration says the questions live in code and that a
 * new one is added by inventing an id. A pick is that: a question id and an answer string. A
 * second table would have duplicated two policies and two functions to store the same pair.
 *
 * WHICH MAKES THESE IDS PERMANENT, on exactly the terms that migration sets out: an id is what
 * lands in `wpbl_award_votes.category`, so renaming one orphans every pick already made under
 * the old spelling. The season is in the id because the same three series happen again in 2027
 * and 2026's answers must not be counted into them.
 *
 * WHAT A CHOICE HOLDS is `<team id>:<wins>-<losses>`, our own team id (a short slug like 'SF',
 * stable and ours) and the series score from the winner's side. Not a game id, not a feed id.
 * Nothing validates it in the database, so the reader maps a stored choice back onto the
 * options it can currently offer and ignores what it cannot place: a pick for a club that is
 * not in the series any more reads as a busted pick rather than as a broken card.
 *
 * Pure: bracket shapes in, plain strings out. No supabase, no React, no clock.
 */

/** Bumped once a year, and never for anything else. See the header. */
export const PICKEM_SEASON = '2026'

/** One option on one series: a club, a series score, and the string that gets stored. */
export interface SeriesPickOption {
  choice: string
  teamId: string
  /** The winner's games, then the loser's. A best-of-3 is 2-0 or 2-1. */
  wins: number
  losses: number
  /** "in 3", which reads under a club name. The club is the row, not the chip. */
  label: string
}

/** The question id for one series. Permanent; see the header. */
export function seriesPickCategory(round: BracketSeries['round'], key: string | null): string {
  return round === 'championship'
    ? `pickem:${PICKEM_SEASON}:championship`
    : `pickem:${PICKEM_SEASON}:${round}:${key ?? '?'}`
}

export const pickChoice = (teamId: string, wins: number, losses: number): string =>
  `${teamId}:${wins}-${losses}`

/** A stored choice back into its parts, or null if it is not one of ours. Tolerant on purpose:
 *  this reads whatever is in the database, including a row written by a version that has since
 *  changed its mind about the format. */
export function parsePickChoice(choice: string): { teamId: string; wins: number; losses: number } | null {
  const m = /^([A-Za-z0-9_-]{1,16}):(\d)-(\d)$/.exec(choice ?? '')
  if (!m) return null
  const wins = Number(m[2]), losses = Number(m[3])
  if (wins <= losses) return null           // the winner won more games than the loser
  return { teamId: m[1], wins, losses }
}

/**
 * Every way this series could end, for these two clubs.
 *
 * The loser's total runs from 0 up to one short of clinching, which is what makes a best-of-3
 * two options a side and a best-of-5 three. Taking the ROUND and asking `winsNeeded` for the
 * rest, rather than taking a number: the format is stated once, in derive/series.ts, and a
 * league that lengthens a round changes nothing here. A literal 2 or 3 in this file is the
 * bug where one screen needs two wins and another needs three.
 */
export function seriesPickOptions(
  round: BracketSeries['round'],
  teams: (WpblTeam | null)[],
): SeriesPickOption[] {
  const need = winsNeeded(round)
  const out: SeriesPickOption[] = []
  for (const team of teams) {
    if (!team) continue
    for (let losses = 0; losses < need; losses++) {
      out.push({
        choice: pickChoice(team.id, need, losses),
        teamId: team.id,
        wins: need,
        losses,
        label: `in ${need + losses}`,
      })
    }
  }
  return out
}

/**
 * How the series actually ended, in the same shape a pick is stored in, or null while it is
 * still being played. This is what marks a pick right or wrong, and it is deliberately built
 * from the bracket's own entrant win counts rather than from anything a pick knows about.
 */
export function seriesResultChoice(series: BracketSeries): string | null {
  const w = series.winner
  if (!w) return null
  const [win, lose] = series.home.team?.id === w.id
    ? [series.home.wins, series.away.wins]
    : [series.away.wins, series.home.wins]
  return pickChoice(w.id, win, lose)
}

/**
 * Can this series still be picked?
 *
 * A prediction made after the first pitch of game 1 is not a prediction. `status` is the
 * bracket's own word for it and covers both halves: 'upcoming' is also what an undecided
 * championship reads as, which is right, because that series has not started either.
 */
export const seriesPickOpen = (series: BracketSeries): boolean => series.status === 'upcoming'

/**
 * The two clubs to offer for the championship, which is the whole reason this file has a
 * function for it.
 *
 * THE FINAL HAS NO ENTRANTS UNTIL THE SEMIFINALS END, and a pick'em that waited for them would
 * open on the day the thing it is predicting is half over. So before then it offers the clubs
 * the READER has already picked, which is what makes this a bracket rather than three separate
 * questions: pick San Francisco and New York to advance and the final you are asked about is
 * San Francisco against New York. Both semifinals have to be answered first, because offering
 * one known club against a blank is a worse question than asking for the other half.
 *
 * Once the real entrants exist they win, always, including when they contradict the reader:
 * their championship pick is then a club that is not in the final, which the card marks as
 * busted rather than quietly re-offering.
 */
export function championshipEntrants(
  bracket: WpblBracket,
  ballot: Record<string, string>,
): (WpblTeam | null)[] {
  const real = [bracket.championship.home.team, bracket.championship.away.team]
  if (real[0] && real[1]) return real

  const byId = new Map<string, WpblTeam>()
  for (const s of bracket.semifinals) {
    for (const t of [s.home.team, s.away.team]) if (t) byId.set(t.id, t)
  }
  const picked = bracket.semifinals.map(s => {
    // A semifinal already decided answers for itself: a reader who never picked it, or picked
    // the club that lost, is still watching the club that won play in the final.
    if (s.winner) return s.winner
    const mine = parsePickChoice(ballot[seriesPickCategory(s.round, s.key)] ?? '')
    return mine ? byId.get(mine.teamId) ?? null : null
  })
  return picked[0] && picked[1] ? picked : [null, null]
}

/** Share of the vote per choice, for a set of options. Zero when nobody has answered, which
 *  renders as a bar with no width rather than as a missing row. */
export function pickShares(
  tally: Record<string, number> | undefined,
  options: SeriesPickOption[],
): { total: number; share: (choice: string) => number } {
  let total = 0
  for (const o of options) total += tally?.[o.choice] ?? 0
  return {
    total,
    share: (choice: string) => (total > 0 ? (tally?.[choice] ?? 0) / total : 0),
  }
}
