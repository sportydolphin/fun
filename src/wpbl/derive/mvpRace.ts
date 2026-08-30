import type { PlayRunValue } from './runExpectancy'
import type { WpblGame, WpblPlayer } from '../types'

/**
 * The MVP race, in runs.
 *
 * WHY THIS METRIC AND NOT A NEW ONE. The section already prices every play against the
 * league's own run-expectancy table, and the Run value board already publishes the two sides
 * of it as "most runs created" and "most runs saved". An MVP card needs one number that a
 * hitter and a pitcher can both be measured on, and the sum of those two IS that number:
 * both are run-expectancy swings, in runs, on the same scale, off the same table. Inventing a
 * box-score run estimator instead would have been cheaper to fetch (Home already holds the
 * lines) and was rejected on purpose: a calibrated Base Runs fit values a WPBL home run at
 * +1.33 runs where the league's own plays say +1.55, so the site would carry two "runs added"
 * figures for the same player, differing by ten to twenty percent, with neither of them wrong.
 * That is the exact failure `stats.ts` spells out for the ERA basis, one board disagreeing
 * with the page it opens, and it is worth a deferred fetch to avoid.
 *
 * WHAT IT IS NOT. There is no replacement level, no positional adjustment and no fielding in
 * here, so this is not WAR and must never be labelled as such. It is runs added at the plate
 * plus runs saved on the mound, which is a narrower and more literal claim, and the card says
 * so in as many words. Baserunning is out too, and not by choice: a stolen base is a play row
 * with no pitch sequence, so it belongs to no plate appearance and is credited to nobody here.
 * In a league that has attempted 94 steals at a break-even it does not clear, that is a real
 * omission rather than a rounding one.
 *
 * A COUNTING STAT, DELIBERATELY. It rewards playing time, which is what an MVP case is
 * partly made of, and it means no rate qualifier is needed: a cameo cannot accumulate runs it
 * never had the trips to earn, so the leaderboard cannot fill with small samples the way a
 * rate board does.
 *
 * PURE, like the module it reads from: arrays in, plain shapes out.
 */

export interface MvpCandidate {
  /** Resolved player id where the play log named one, else `name:<lowercased>`. */
  key: string
  /** Null when the play log names somebody who is not on a roster row we hold. */
  player: WpblPlayer | null
  name: string
  /**
   * The club to show beside her, which is "now" rather than "then" on purpose. A traded
   * player's game log has to read as the club she played each game for, and this is not a
   * game log: it is a live claim about who is having the best season, so the badge should be
   * the shirt she is wearing while the race is on. The roster row answers that; the play only
   * knows the club she was with that day, and is the fallback for someone off the roster.
   */
  teamId: string | null
  /** Runs created at the plate. */
  bat: number
  /** Runs saved on the mound: the batting side's swing, negated. */
  arm: number
  total: number
  /** Plate appearances as a hitter, and batters faced as a pitcher. */
  pa: number
  bf: number
  /** Both sides of the ball, and enough of each to be worth saying so. */
  twoWay: boolean
  /**
   * Cumulative total after each date on `MvpRace.dates`, same length and same order. Flat
   * across a date she did not play, which is the honest shape: a rest day is not a decline.
   */
  curve: number[]
}

export interface MvpRace {
  /** The shared x axis: every date the priced plays actually came from, in order. */
  dates: string[]
  /** Everyone the play log can name, best first. */
  field: MvpCandidate[]
  /** The two the card draws. Shorter than two only before the league has played. */
  top: MvpCandidate[]
  /** The margin, always >= 0. Zero when the top two are level. */
  lead: number
  /** Index into `dates` of the last time the lead actually changed hands, else null. */
  lastLeadChange: number | null
  /** How many times the lead has changed hands across the season. */
  leadChanges: number
}

/** Both sides of the ball, and not just a token appearance on one of them. A position player
 *  who threw one mop-up inning is not a two-way player, and a pitcher's own trips to the
 *  plate are not a second case for her. */
const TWO_WAY_MIN_PA = 20
const TWO_WAY_MIN_BF = 20

/**
 * Roll every priced play up per player, both sides at once.
 *
 * `values` must come from `playRunValues`, which has already dropped the postseason (it runs
 * its input through `regularSeasonLines`), so nothing here re-filters and nothing here can
 * disagree with the Run value board about which games counted.
 */
export function mvpRace(
  values: PlayRunValue[],
  players: WpblPlayer[],
  games: Pick<WpblGame, 'id' | 'game_date'>[],
): MvpRace {
  const byId = new Map(players.map(p => [p.id, p]))
  const dateOf = new Map(games.map(g => [g.id, g.game_date]))

  interface Acc extends Omit<MvpCandidate, 'curve' | 'twoWay'> { perDate: Map<string, number> }
  const rows = new Map<string, Acc>()
  const dates = new Set<string>()

  const reach = (id: string | null, name: string, playTeamId: string | null): Acc => {
    // Same key rule as `runValueLeaders`, so the two boards agree on who is one person. The
    // play log carries our own player uuid rather than a feed id, so a player the league has
    // minted two ids for is already one row here; the name fallback is for a play that names
    // somebody the roster does not.
    const key = id ?? `name:${name.toLowerCase()}`
    let r = rows.get(key)
    if (!r) {
      const player = id ? byId.get(id) ?? null : null
      r = {
        key, player, name,
        teamId: player?.team_id ?? playTeamId,
        bat: 0, arm: 0, total: 0, pa: 0, bf: 0, perDate: new Map(),
      }
      rows.set(key, r)
    }
    return r
  }

  for (const v of values) {
    // A play with no pitch sequence is a steal, a substitution or a runner advancing: it has
    // no plate appearance, so it names neither a hitter nor a pitcher who can be charged for
    // it. Same guard, and the same reason, as `runValueLeaders` and `biggestSwings`.
    if (!v.play.pitch_sequence) continue
    const date = dateOf.get(v.play.game_id)
    if (!date) continue
    dates.add(date)

    if (v.play.batter_name) {
      const r = reach(v.play.batter_id, v.play.batter_name, v.play.team_id)
      r.bat += v.value; r.total += v.value; r.pa++
      r.perDate.set(date, (r.perDate.get(date) ?? 0) + v.value)
    }
    if (v.play.pitcher_name) {
      // Negated: the play that added half a run to the offence took half a run off the
      // pitcher who allowed it. Ranked on the batting side's sign, the board would open with
      // the worst arms in the league.
      const r = reach(v.play.pitcher_id, v.play.pitcher_name, v.fieldingTeamId)
      r.arm += -v.value; r.total += -v.value; r.bf++
      r.perDate.set(date, (r.perDate.get(date) ?? 0) - v.value)
    }
  }

  const axis = [...dates].sort()
  const field: MvpCandidate[] = [...rows.values()]
    .map(r => {
      const curve: number[] = []
      let running = 0
      for (const d of axis) { running += r.perDate.get(d) ?? 0; curve.push(running) }
      const { perDate: _drop, ...rest } = r
      return {
        ...rest,
        twoWay: r.pa >= TWO_WAY_MIN_PA && r.bf >= TWO_WAY_MIN_BF,
        curve,
      }
    })
    // Ties break toward the bigger workload, so the player who needed fewer trips for the
    // same runs is not ranked below the one who needed more.
    .sort((a, b) => b.total - a.total || (b.pa + b.bf) - (a.pa + a.bf))

  const top = field.slice(0, 2)
  const lead = top.length === 2 ? top[0].total - top[1].total : 0

  // Who was ahead on each date, walked forward. Exact ties hold the lead where it was rather
  // than counting as a change, so a day both curves happen to meet is not reported as two
  // changes in a row.
  let leadChanges = 0
  let lastLeadChange: number | null = null
  if (top.length === 2) {
    let holder: 0 | 1 | null = null
    for (let i = 0; i < axis.length; i++) {
      const diff = top[0].curve[i] - top[1].curve[i]
      if (diff === 0) continue
      const now: 0 | 1 = diff > 0 ? 0 : 1
      if (holder != null && now !== holder) { leadChanges++; lastLeadChange = i }
      holder = now
    }
  }

  return { dates: axis, field, top, lead, lastLeadChange, leadChanges }
}

/** Runs, signed, one decimal: the same spelling `fmtRunValue` gives the Run value board, so a
 *  reader meeting +18.5 on both surfaces is meeting one number rather than two. */
export function fmtMvpRuns(v: number): string {
  const r = Math.round(v * 10) / 10
  const z = Object.is(r, -0) ? 0 : r
  return `${z > 0 ? '+' : ''}${z.toFixed(1)}`
}
