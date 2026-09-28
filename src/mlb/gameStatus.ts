// IMPORT-FREE ON PURPOSE. The notification bell reads SCHEDULE_GAME_TYPES and it loads on every
// page of the site, WPBL included; pulling constants.ts in here would ship the MLB team tables
// with it. The placeholder-club test needs those tables, so it lives beside them (isRealClub).

// ─── Which games a schedule read asks for ─────────────────────────────────────
//
// REGULAR SEASON PLUS EVERY POSTSEASON ROUND (Wild Card, Division, League, World Series).
// Every schedule read in the section used to pass `gameType=R`, which is invisible for six
// months and would then have silenced the section for all of October: the predictor, the
// game-start bell and push, the pick reminder, the team schedule strip and the prediction
// resolver would each have seen an empty slate from the first Wild Card game on. Anything that asks "what is being
// played" takes these.
//
// SEASON TOTALS DO NOT. Hitting streaks, leaderboards, playoff odds and milestones are
// regular-season records by definition and keep `gameType=R`. The same split WPBL learned the
// other way round: the postseason belongs in the schedule and stays out of every season total.
//
// The Node jobs in scripts/ cannot import this, so each carries its own copy of the string.
export const SCHEDULE_GAME_TYPES = 'R,F,D,L,W'

/** The types a scoreboard treats as real games (exhibitions and spring training are not). */
export const SCORED_GAME_TYPES = new Set(SCHEDULE_GAME_TYPES.split(','))

// ─── Games that never happened ────────────────────────────────────────────────
//
// A postponed game and a cancelled one both report abstractGameState "Final", with no winner
// and no score. Only the postponement was recognised, so Sep 27, 2026's rained-out, never to be
// made up BAL@NYY (codedGameState "C") rendered as a 0–0 final on the scoreboard, the team card
// and in Game Center. Check this BEFORE reading abstractGameState.

interface StatusLike {
  codedGameState?: string
  detailedState?: string
  startTimeTBD?: boolean
}

/** Postponed (to be made up) or cancelled (never will be): either way, not a game that was played. */
export function isUnplayed(status: StatusLike | null | undefined): boolean {
  const coded = status?.codedGameState
  const detailed = status?.detailedState ?? ''
  return coded === 'D' || coded === 'C' || detailed === 'Postponed' || detailed === 'Cancelled'
}

/** What to print for an unplayed game. */
export function unplayedLabel(status: StatusLike | null | undefined): 'Postponed' | 'Cancelled' {
  return status?.codedGameState === 'C' || status?.detailedState === 'Cancelled' ? 'Cancelled' : 'Postponed'
}

// ─── Start times nobody has set ───────────────────────────────────────────────
//
// A postseason game whose time is not set yet still carries a `gameDate`, and it is a placeholder
// (Division Series games published at 07:33Z, which printed as "12:33 AM"). `startTimeTBD` is the
// only thing that says so. Anything that prints a start time, or counts down to one, checks it.

/** Whether `gameDate` is a real first pitch rather than a placeholder. */
export const hasStartTime = (status: StatusLike | null | undefined): boolean => !status?.startTimeTBD
