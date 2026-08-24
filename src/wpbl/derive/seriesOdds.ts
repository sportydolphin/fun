import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'
import { countsInStandings } from '../season'
import { winsNeeded, type WpblBracket, type BracketSeries } from './bracket'

/**
 * Postseason odds: the first forward-looking, probabilistic surface in the section.
 *
 * The bracket next door reports who is playing whom and the series record so far, which the
 * standings could tell you too. This answers the question a record cannot: who is going to WIN.
 * "SF has a 74% chance to take this series", "chance to win it all", updated after every game.
 *
 * WHY THIS IS HONEST RATHER THAN GUESSED. It is the series analogue of the in-game win-
 * probability chart (winProbability.ts): both turn a state into a number rather than a feeling.
 * The chain is short and every link is standard:
 *
 *   1. Team strength from the 30-game season, as a pythagenpat win expectation off runs
 *      scored/allowed. Pythagenpat rather than a fixed 1.83 exponent because this league scores
 *      ~15 runs a game, three times a normal environment, and the exponent is supposed to track
 *      exactly that (it is `(runs per game)^0.287`).
 *   2. A single game's odds between two clubs from log5 on those strengths, then BLENDED with
 *      how the two clubs actually fared head to head this season. A four-club league plays the
 *      same pairing 10-15 times, a sample a 30-club league never produces, so the real results
 *      deserve weight; but 12 games is still noisy, so the head-to-head is regressed toward the
 *      run-differential model by `n / (n + REGRESSION_GAMES)`. At a full season series that is
 *      ~55% actual, ~45% model; with two meetings it is almost all model.
 *   3. A series from the current game count by enumerating the ways it can still finish
 *      (best-of-3 and best-of-5, so at most a handful of games).
 *   4. The title by propagating the semifinal odds into the final, whose opponent is a
 *      distribution until both semifinals are done.
 *
 * WHAT IT DOES NOT CLAIM. 15 games is a small sample for a rating, so these numbers are soft.
 * There is no home-field term: the league plays every game at one hub venue, so the nominal home
 * side has no park to defend and `HOME_EDGE` is 0. If that ever changes, it is one constant here.
 *
 * Pure: standings rows and a built bracket in, plain numbers out. No supabase, no React. Tested
 * from the app runner like the rest of the derive layer.
 */

/** Per-game probability added to the nominal home side. Zero: one hub venue, no park to hold.
 *  Left as a named constant so a future multi-venue season is a one-line change, not a rewrite. */
export const HOME_EDGE = 0

/** How hard the head-to-head record is regressed toward the run-differential model: the weight
 *  on the actual results is `n / (n + REGRESSION_GAMES)` for `n` meetings. 10 puts a full-season
 *  series (~12 games) a little past half its own weight, and a two-game sample near none. */
export const REGRESSION_GAMES = 10

/** An unordered pair of team ids, as a stable key for head-to-head lookups. */
const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

/** Clamp a rating away from 0 and 1 so log5 never divides by zero on two identical extremes. */
const clamp = (p: number): number => Math.min(0.95, Math.max(0.05, p))

/**
 * A club's quality as a win expectation in (0,1), from its season runs.
 *
 * Pythagenpat: exponent `((RF+RA)/G)^0.287`, then `RF^e / (RF^e + RA^e)`. Falls back to a coin
 * flip before a club has played (G=0) or scored (RF+RA=0), neither of which happens with a real
 * 30-game season behind it but both of which a test or an empty state can hand us.
 */
export function pythagenpat(runsFor: number, runsAgainst: number, games: number): number {
  if (games <= 0 || runsFor + runsAgainst === 0) return 0.5
  const rpg = (runsFor + runsAgainst) / games
  const exp = Math.pow(rpg, 0.287)
  const rf = Math.pow(runsFor, exp)
  const ra = Math.pow(runsAgainst, exp)
  return clamp(rf / (rf + ra))
}

/** log5: P(A beats B) from each side's win rate. 0.5 on the degenerate all-or-nothing pair. */
export function log5(pa: number, pb: number): number {
  const den = pa + pb - 2 * pa * pb
  if (den === 0) return 0.5
  return (pa - pa * pb) / den
}

/**
 * P(the side needing `an` more wins takes the series), given P(it wins one game) = `p` and the
 * opponent needs `bn`. Exact, by playing the remaining games out: an already-clinched side is 1,
 * an already-eliminated side is 0. Depths are tiny (best-of-5 → at most 5 games) so the plain
 * recursion is cheaper than a table.
 */
export function seriesWinProb(an: number, bn: number, p: number): number {
  if (an <= 0) return 1
  if (bn <= 0) return 0
  return p * seriesWinProb(an - 1, bn, p) + (1 - p) * seriesWinProb(an, bn - 1, p)
}

/** The two clubs' regular-season record against each other, relative to the series' home/away
 *  entrants. Null when they never met in the regular season (which cannot happen with a real
 *  schedule, but a test or a partial season can produce). */
export interface HeadToHead { homeWins: number; awayWins: number }

export interface SeriesOdds {
  /** P(the higher-seed `home` entrant wins the series) and its complement. Both are 1/0 once
   *  the series is decided. */
  homeWinP: number
  awayWinP: number
  /** P(home beats away in a single game), the blended input the series odds are built from. */
  gameHomeP: number
  /** The season series between the two clubs, feeding gameHomeP and worth showing on its own. */
  h2h: HeadToHead | null
  /** The club that loses the series with its next loss, or null if neither is on the brink. */
  eliminationFor: WpblTeam | null
  /** The club that wins the series with its next win, or null if neither can clinch yet. */
  clinchFor: WpblTeam | null
}

export interface TitleOdds {
  team: WpblTeam
  seed: number | null
  /** P(this club wins the championship), from where the bracket stands now. */
  p: number
}

export interface WpblPostseasonOdds {
  semifinals: SeriesOdds[]     // aligned with bracket.semifinals
  championship: SeriesOdds | null
  /** Every club's title chance, highest first. Sums to ~1 across the four. */
  title: TitleOdds[]
}

/** Regular-season head-to-head wins per club, keyed on the unordered team pair. Postseason games
 *  are excluded (they are the series being priced, not evidence of season strength) exactly as
 *  the rating excludes them. */
export function regularH2H(games: WpblGame[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const g of games) {
    if (!countsInStandings(g)) continue
    if (g.status !== 'final' || g.home_score == null || g.away_score == null) continue
    if (g.home_score === g.away_score) continue   // a tie credits nobody
    const key = pairKey(g.home_team_id, g.away_team_id)
    const tally = out.get(key) ?? new Map<string, number>()
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    tally.set(winner, (tally.get(winner) ?? 0) + 1)
    out.set(key, tally)
  }
  return out
}

/**
 * P(`a` beats `b`) in one game: log5 on the two run-differential ratings, then blended toward
 * their actual season head-to-head by `n / (n + REGRESSION_GAMES)`. With no meetings it is the
 * pure model; with a full-season series it is a little over half the real record.
 */
export function matchupProb(
  a: WpblTeam, b: WpblTeam,
  rating: (t: WpblTeam) => number,
  h2h: Map<string, Map<string, number>>,
): number {
  const pModel = log5(rating(a), rating(b))
  const tally = h2h.get(pairKey(a.id, b.id))
  let p = pModel
  if (tally) {
    const aw = tally.get(a.id) ?? 0
    const bw = tally.get(b.id) ?? 0
    const n = aw + bw
    if (n > 0) {
      const w = n / (n + REGRESSION_GAMES)
      p = w * (aw / n) + (1 - w) * pModel
    }
  }
  return clamp(p + HOME_EDGE)
}

/** Best-of-N game probability for a matchup starting level, used for a final whose participants
 *  are not yet settled (so no series is under way to read a count from). */
function freshSeriesP(round: BracketSeries['round'], pHome: number): number {
  const need = winsNeeded(round)
  return seriesWinProb(need, need, pHome)
}

/** Odds for one concrete series, from its current win count, the two clubs' ratings, and their
 *  season head-to-head. */
function oddsForSeries(
  s: BracketSeries,
  rating: (t: WpblTeam) => number,
  h2h: Map<string, Map<string, number>>,
): SeriesOdds | null {
  if (!s.home.team || !s.away.team) return null
  const gameHomeP = matchupProb(s.home.team, s.away.team, rating, h2h)
  const tally = h2h.get(pairKey(s.home.team.id, s.away.team.id))
  const h2hRecord: HeadToHead | null = tally
    ? { homeWins: tally.get(s.home.team.id) ?? 0, awayWins: tally.get(s.away.team.id) ?? 0 }
    : null
  const need = winsNeeded(s.round)
  const homeWinP = s.winner
    ? (s.winner.id === s.home.team.id ? 1 : 0)
    : seriesWinProb(need - s.home.wins, need - s.away.wins, gameHomeP)

  // Stakes are deterministic on the count: a club is on the brink when its opponent is one win
  // from the series, and can clinch when it is itself one win away. A decided series has neither.
  let eliminationFor: WpblTeam | null = null
  let clinchFor: WpblTeam | null = null
  if (!s.winner && s.played > 0) {
    if (s.away.wins === need - 1) eliminationFor = s.home.team
    else if (s.home.wins === need - 1) eliminationFor = s.away.team
    if (s.home.wins === need - 1) clinchFor = s.home.team
    else if (s.away.wins === need - 1) clinchFor = s.away.team
  }

  return { homeWinP, awayWinP: 1 - homeWinP, gameHomeP, h2h: h2hRecord, eliminationFor, clinchFor }
}

/**
 * The whole postseason priced, from the bracket and the standings it was built from.
 *
 * Two cases for the title, both exact:
 *  - Both finalists known (the final is set, whether or not it has started): the two of them get
 *    their championship-series odds read off the current count, everyone else gets 0.
 *  - Otherwise: each club's title chance is P(it wins its own semifinal) times the chance it then
 *    beats whoever comes out of the other semifinal, that opponent being a distribution over the
 *    other semifinal's two clubs weighted by their own series odds. The final is priced fresh
 *    (0-0) because it cannot have started while a semifinal is still open.
 */
export function postseasonOdds(
  bracket: WpblBracket,
  rows: WpblStandingRow[],
  games: WpblGame[],
): WpblPostseasonOdds | null {
  if (bracket.semifinals.length !== 2) return null

  const byId = new Map(rows.map(r => [r.team.id, r]))
  const rating = (t: WpblTeam): number => {
    const r = byId.get(t.id)
    return r ? pythagenpat(r.runsFor, r.runsAgainst, r.wins + r.losses) : 0.5
  }
  const h2h = regularH2H(games)

  const semiOdds = bracket.semifinals.map(s => oddsForSeries(s, rating, h2h))
  const champOdds = oddsForSeries(bracket.championship, rating, h2h)

  // Collect the four semifinal clubs with the probability each REACHES the final.
  interface Finalist { team: WpblTeam; seed: number | null; reachP: number; semi: number }
  const finalists: Finalist[] = []
  bracket.semifinals.forEach((s, i) => {
    const o = semiOdds[i]
    if (s.home.team) finalists.push({ team: s.home.team, seed: s.home.seed, reachP: o?.homeWinP ?? 0, semi: i })
    if (s.away.team) finalists.push({ team: s.away.team, seed: s.away.seed, reachP: o?.awayWinP ?? 0, semi: i })
  })

  const title: TitleOdds[] = []
  const champSet = !!(bracket.championship.home.team && bracket.championship.away.team)

  if (champSet && champOdds) {
    const h = bracket.championship.home
    const a = bracket.championship.away
    for (const f of finalists) {
      let p = 0
      if (h.team && f.team.id === h.team.id) p = champOdds.homeWinP
      else if (a.team && f.team.id === a.team.id) p = champOdds.awayWinP
      title.push({ team: f.team, seed: f.seed, p })
    }
  } else {
    for (const f of finalists) {
      const opponents = finalists.filter(o => o.semi !== f.semi)
      let beatsField = 0
      for (const o of opponents) {
        const pGame = matchupProb(f.team, o.team, rating, h2h)
        beatsField += o.reachP * freshSeriesP('championship', pGame)
      }
      title.push({ team: f.team, seed: f.seed, p: f.reachP * beatsField })
    }
  }

  title.sort((x, y) => y.p - x.p)
  return { semifinals: semiOdds.filter((o): o is SeriesOdds => o !== null), championship: champOdds, title }
}

/** "74%" from 0.74; "<1%" and ">99%" at the tails so a real chance never rounds to an
 *  impossibility (or a certainty). Empty for exactly 0 or 1, where a bare number reads cleaner. */
export function fmtOdds(p: number): string {
  if (p <= 0 || p >= 1) return `${Math.round(p * 100)}%`
  const pct = p * 100
  if (pct < 1) return '<1%'
  if (pct > 99) return '>99%'
  return `${Math.round(pct)}%`
}
