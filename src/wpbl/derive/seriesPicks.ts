import { postseasonGames } from './bracket'
import type { BracketSeries, WpblBracket } from './bracket'
import { winsNeeded } from './series'
import { gameStartMs } from '../constants'
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
 * Pure: bracket shapes in, plain strings out. No supabase, no React. It does read a clock,
 * but only where `seriesPickOpen` is handed one. See the note there for why that is not
 * optional.
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
 * A prediction made after the first pitch of game 1 is not a prediction.
 *
 * TWO SIGNALS, AND THE SECOND ONE IS WHY `now` IS REQUIRED RATHER THAN DEFAULTED.
 *
 *  1. The bracket's own `status`, which is 'upcoming' until a game of this pairing starts and
 *     is also what an undecided championship reads as, correctly: that series has not started
 *     either. This is the accurate signal, and it is entirely downstream of the ingest.
 *  2. THE PUBLISHED FIRST PITCH, because signal 1 is only as good as our mirror of the
 *     schedule and on Sep 9, 2026 the mirror was empty. The league mints a new team id per
 *     club for the postseason, wpbl-ingest could map none of them, and all four bracket games
 *     were dropped every pass for two days. With no game rows, the semifinal read 'upcoming'
 *     through the whole of game 1 and the sheet went on asking who would win a series that
 *     was being played. `POSTSEASON_SCHEDULE` is a constant in this repo and needs nothing
 *     from the feed, so it closes the question on time even when the mirror knows nothing.
 *
 * A defaulted `now` would have made this the same trap the first signal already was: a call
 * site that forgets it gets an answer that looks right all season and is wrong for the two
 * weeks that matter. The clock belongs to the caller, which is also what keeps this testable.
 *
 * A round with no published schedule falls back to signal 1 alone. That fails OPEN, on
 * purpose: a hypothetical extra round would otherwise be unpickable forever, and an ingest
 * that is working closes it at first pitch anyway.
 *
 * NOTE THAT THIS IS THE ONLY GATE. Votes land through `wpbl_cast_award_vote`, which stores a
 * category and an answer and knows nothing about postseason dates, so a locked series is
 * locked in the UI and nowhere else.
 */
export function seriesPickOpen(series: BracketSeries, now: number): boolean {
  if (series.status !== 'upcoming') return false
  const first = postseasonGames(series.round, series.key)[0]
  const firstPitch = first ? gameStartMs(first.date, first.time) : null
  return firstPitch == null || now < firstPitch
}

/**
 * Can the FINAL still be picked?
 *
 * `seriesPickOpen` asks whether a series has started, which for the championship is Sep 16 and
 * is not the whole question. The final is picked out of clubs that are still playing semifinals,
 * so once ANY postseason baseball has been played, a championship pick is being made with
 * evidence the question was written before. On Sep 10, 2026 that was live: semifinal A was 1-0
 * to San Francisco and the sheet was still asking, unchanged, who would win it all.
 *
 * THE WHOLE FINAL, NOT JUST THE READERS HOLDING A CLUB THAT HAS PLAYED. A narrower rule was
 * tried first, locking only a reader whose own pick was already on the field, on the reasoning
 * that San Francisco batting tells someone holding New York nothing. It is true and it is not
 * the point: the bracket is one question in three parts, everyone answers it against the same
 * board, and a sheet where the final is shut for some readers and open for others is not a
 * pick'em. First pitch of the postseason is the deadline for all of it.
 *
 * IT USES `seriesPickOpen` FOR THE SEMIFINALS RATHER THAN THEIR BRACKET STATUS, so it inherits
 * the published-first-pitch backstop with them: the whole reason that backstop exists is that
 * the mirror was empty for two days of live postseason baseball, and a lock built on `status`
 * alone would go on being wrong here in exactly the same way.
 *
 * STILL THE ONLY GATE, and still only in the UI: `wpbl_cast_award_vote` knows nothing about any
 * of this. Same non-guarantee as seriesPickOpen's.
 */
export function championshipPickOpen(bracket: WpblBracket, now: number): boolean {
  return seriesPickOpen(bracket.championship, now)
    && bracket.semifinals.every(semi => seriesPickOpen(semi, now))
}

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

/**
 * Every club anyone could have picked to win it all, which is the championship's real
 * denominator and is NOT the two clubs it offers this reader.
 *
 * See `pickShares` for why the difference matters. Built from the semifinal entrants rather
 * than from the final's own seats, because before the semifinals end those seats are empty and
 * this is exactly when the question is being asked.
 */
export function championshipField(bracket: WpblBracket): SeriesPickOption[] {
  const byId = new Map<string, WpblTeam>()
  for (const s of bracket.semifinals) {
    for (const t of [s.home.team, s.away.team]) if (t) byId.set(t.id, t)
  }
  for (const t of [bracket.championship.home.team, bracket.championship.away.team]) {
    if (t) byId.set(t.id, t)
  }
  return seriesPickOptions('championship', [...byId.values()])
}

/**
 * Share of the vote per choice. Zero when nobody has answered, which renders as a bar with no
 * width rather than as a missing row.
 *
 * TWO OPTION LISTS, AND THE SECOND ONE IS THE DENOMINATOR. A semifinal asks everyone the same
 * question, so what it offers and what could have been answered are the same set and the shares
 * add to 100. THE CHAMPIONSHIP DOES NOT: every reader answers `pickem:2026:championship`, but
 * before the semifinals end each of them is offered only the two clubs they sent through, so the
 * options on screen are a slice of the field. Dividing by that slice made the reader's own two
 * finalists add to 100% no matter how few people had either of them winning it all, which is a
 * number with no stated meaning: not "share of fans", not "share of this matchup", something in
 * between that only made sense if you already knew how the sheet worked. It also made two
 * percentages that look alike incomparable, since a semifinal's 60% was out of everybody and the
 * final's 60% was out of whoever happened to agree with your bracket.
 *
 * So the denominator is every answer to the QUESTION, and the visible shares are allowed not to
 * add up. The sheet does not try to explain the gap in words any more, and should not: it says
 * how many people have voted, once, and lets three percentages that add to 55 stand.
 *
 * `universe` must still be a real option list and not the raw tally: a stale key from a retired
 * format must not inflate it, or every bar comes out short and nothing says why.
 */
export function pickShares(
  tally: Record<string, number> | undefined,
  options: SeriesPickOption[],
  universe: SeriesPickOption[] = options,
): { total: number; share: (choice: string) => number } {
  let total = 0
  for (const o of universe) total += tally?.[o.choice] ?? 0
  return {
    total,
    share: (choice: string) => (total > 0 ? (tally?.[choice] ?? 0) / total : 0),
  }
}
