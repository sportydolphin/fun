import { REGULATION_INNINGS } from './innings'
import type { WpblGame, WpblLiveState } from './types'

/**
 * When the league has stopped updating a game it never marked final, decide for ourselves.
 *
 * WHAT THIS IS FOR. On Sep 4, 2026 the feed left SF at NY sitting at `In Progress - Top of
 * 7th` with the row still being written every two minutes: three outs recorded, the home side
 * up 14-2, the last out of the game already in the play log. That game was over by every rule
 * baseball has, and the section showed it as live indefinitely, with a pulsing dot, a poll
 * running against it, and its box score kept out of the standings and out of every season
 * total. Nothing was broken and nothing was going to fix itself, because the league's `status`
 * is a field somebody has to set and nobody set it.
 *
 * `feedHealth` cannot catch this and should not try. It answers "why is nothing arriving",
 * and here everything was arriving: our clock was fresh, THEIR clock was fresh, the row was
 * simply wrong. Those are different faults and they need different sentences.
 *
 * ONLY EVER LIVE → FINAL, NEVER THE REVERSE. A game the league calls final is final,
 * whatever the state says; a game it has not started cannot be over. The rule is allowed to
 * move a row exactly one way, so the worst case is a game called a few minutes early rather
 * than a stored result contradicted by an inference.
 *
 * IT IS A READ-TIME OVERLAY AND MUST STAY ONE. Do not write the derived status back to
 * `wpbl_games`. The ingest's every-two-minutes pass is `mode: "active"`, which skips a stored
 * final, so marking this game final in the mirror would stop us re-reading it: the league's
 * own final, its box-score revisions and its score corrections would all arrive at a row
 * nobody was fetching any more (see the read-only-once-final trap in CLAUDE.md). Left live in
 * the DB and final on screen, the corrections keep flowing and this file keeps deciding.
 *
 * SELF-CORRECTING, which is the property that makes the risk small. Nothing is remembered:
 * the call is recomputed from `live_state` on every read, so a state that stops proving the
 * game is over un-calls it on the next poll. That is why `settleGame` writes `final_by_rule`
 * as `false` rather than deleting it. The flag is ours, it is not a column, and a merged row
 * carrying a stale `true` has to be overwritten rather than left to survive.
 *
 * PURE, like season.ts next door: a row in, a row out, no supabase, no React, no clock. The
 * clock is deliberate. "It has been quiet for twenty minutes" is a tempting extra condition
 * and it is the wrong shape: it would make the same game final or not depending on when you
 * asked, and it cannot tell a finished game from a rain delay in the 4th. Either the state
 * proves the game is over or we say nothing.
 */

/**
 * What the rule needs off a game row. Narrow so a caller holding the live poll's column subset
 * can be type-checked against it rather than trusted.
 *
 * STRUCTURAL rather than a `Pick<WpblGame, …>`, because the Cloudflare Pages Function behind
 * the share cards carries its own narrower row type (`WpblCardGame`, whose `status` is a plain
 * string off PostgREST) and has to make the same call. A Pick would have forced that surface to
 * either widen to the app's row type or skip the rule, and skipping it is how an unfurl ends up
 * telling everyone who saw the link that a finished game has not been played.
 */
export interface SettleableGame {
  status: string | null
  home_score: number | null
  away_score: number | null
  live_state?: WpblGame['live_state']
  final_by_rule?: boolean
}

/** Why we called it, in the order the checks run. Exported for the tests and for anything
 *  that wants to explain the call rather than only make it. */
export type GameOverReason =
  /** The feed's own `complete` flag, which it sets on some games and not others. */
  | 'feed-complete'
  /** Last inning, side retired in the top half, home in front: the home team does not bat. */
  | 'home-need-not-bat'
  /** Last inning, side retired in the bottom half, somebody in front. */
  | 'side-retired'
  /** Home took the lead in its own last at-bat. A walk-off ends the moment it happens. */
  | 'walk-off'

/**
 * Is this game over, on the evidence in the row?
 *
 * The three positive cases below are the whole of it, and every one of them is a rule of
 * baseball rather than a heuristic. What is deliberately NOT here:
 *
 *   - A tie. Never over, at any inning count.
 *   - Anything before `REGULATION_INNINGS`. Three outs in the top of the 3rd is the ordinary
 *     between-innings state and the feed publishes it forty times a game. Extras are covered
 *     because the gate is "at or past regulation", not "exactly regulation": every extra
 *     inning is potentially the last one, and the same three tests hold in each.
 *   - A shortened game. The league has called one game after six innings for weather
 *     ("Final - 6 innings"). Nothing in a row can distinguish that from a game still in a
 *     delay, so those stay live here and `feedHealth` says the feed has gone quiet. A missed
 *     call costs a late scoreboard; a wrong one publishes a result that never happened.
 */
export function gameIsOver(g: SettleableGame): boolean {
  return overReason(g) != null
}

export function overReason(g: SettleableGame): GameOverReason | null {
  // One direction only: see the header.
  if (g.status !== 'live') return null
  const s = g.live_state as WpblLiveState | null | undefined
  if (!s) return null
  if (s.complete === true) return 'feed-complete'

  const away = num(s.away_runs)
  const home = num(s.home_runs)
  const inning = num(s.inning)
  const outs = num(s.outs)
  if (away == null || home == null || inning == null || outs == null) return null

  // A tied game is never over, however many outs are showing.
  if (home === away) return null
  if (inning < REGULATION_INNINGS) return null

  // The feed writes '' for `half` between plays, so read it rather than assuming two values.
  const half = s.half === 'bottom' ? 'bottom' : s.half === 'top' ? 'top' : null
  if (half == null) return null

  // The home side batting in the last inning and in front means it just went in front: a team
  // with the lead does not come to bat. Ends the game where it stands, outs irrelevant.
  if (half === 'bottom' && home > away) return 'walk-off'

  if (outs < 3) return null
  // Third out of the top half with the home side ahead: there is no bottom half to play.
  if (half === 'top' && home > away) return 'home-need-not-bat'
  // Third out of the bottom half of the last inning, with somebody ahead.
  if (half === 'bottom') return 'side-retired'
  return null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * The same row with our call applied, or the row itself when there is nothing to call.
 *
 * IDENTITY IS PRESERVED when nothing changes, because this runs on the whole schedule every
 * poll and handing React a new object for all thirty games every twenty seconds would repaint
 * the section for nothing.
 *
 * The score is filled from `live_state` ONLY where the row has none. The ingest folds the
 * league's own score onto the row on every pass and that is the better number; the fallback
 * is for the row that has a situation and no score yet, which would otherwise be a final
 * game rendering 0-0.
 */
export function settleGame<T extends SettleableGame>(g: T): T {
  if (!gameIsOver(g)) {
    // Clear a stale flag rather than leaving it: the live poll merges its columns over the row
    // we already hold, and `final_by_rule` is not one of its columns because it is not a
    // column at all. Without this, a row we un-called would keep the marker for ever.
    return g.final_by_rule ? { ...g, final_by_rule: false } : g
  }
  const s = g.live_state as WpblLiveState | null
  // Cast because a spread widens `status` back to the union and TypeScript cannot see that
  // the result is still a T. The fields are checked one by one above it.
  return {
    ...g,
    status: 'final',
    final_by_rule: true,
    home_score: g.home_score ?? num(s?.home_runs),
    away_score: g.away_score ?? num(s?.away_runs),
  } as T
}

/** `settleGame` over a schedule, keeping the array's identity when nothing moved. */
export function settleGames<T extends SettleableGame>(games: T[]): T[] {
  let changed = false
  const out = games.map(g => {
    const next = settleGame(g)
    if (next !== g) changed = true
    return next
  })
  return changed ? out : games
}
