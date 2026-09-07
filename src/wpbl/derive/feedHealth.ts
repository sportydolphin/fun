import { gameStartMs, WPBL_TZ } from '../constants'
import type { WpblGame } from '../types'

/**
 * Why a game that should have started is showing nothing.
 *
 * THE WHOLE POINT IS TELLING TWO SILENCES APART, and getting it backwards is worse than
 * saying nothing at all. A game sitting at "scheduled" twenty minutes after first pitch has
 * exactly two causes, and they point in opposite directions:
 *
 *   - the league has not published anything, and we are polling a row that will not move
 *   - our own ingest has stopped, and the league is publishing into a mirror nobody is filling
 *
 * From the reader's side both look identical: a stale page. From the row they do not, because
 * `wpbl_games` carries both clocks. `updated_at` is when WE last wrote the row, which the
 * ingest does on every pass whether or not anything changed, so a fresh one is proof our
 * cron is alive. `source_updated_at` is the timestamp the LEAGUE stamped on the record. Fresh
 * ours plus stale theirs is the only combination that licenses saying the delay is upstream.
 *
 * If our own clock is stale we say so instead, and the copy for it is plain. A notice blaming
 * the league for our outage is the failure this module exists to prevent: it is confidently
 * wrong, it is pointed at somebody else, and the one person who could act on it would be
 * reassured by it.
 *
 * FIRST PITCH IS THE GATE, and it is not optional. `source_updated_at` on a game three days
 * out is a month old by construction, because nothing has touched the row since the schedule
 * was published. Read without the gate, every future game on the calendar reports a broken
 * feed. Only once the scheduled start has passed does an old upstream timestamp mean anything.
 *
 * PURE, like the rest of derive/: a row and a clock in, a plain shape out.
 */

export type WpblFeedHealth =
  /** Nothing worth saying: too early to tell, or everything is moving. */
  | { kind: 'ok' }
  /** We are polling; the league is not publishing. `since` is their last stamp. */
  | { kind: 'feed-stale'; since: number; lateBy: number }
  /** Our own ingest has not written this row in a while. Ours to own, and ours to say. */
  | { kind: 'ingest-stale'; since: number }
  /**
   * The game is over and the league has not said so. Not a delay at all: both clocks are
   * fresh, the rows are arriving, and the only stale thing is the league's `status` field.
   * It sits in this type because it lands in the same slot on the page and answers the same
   * reader question ("why does this look wrong"), and because putting it anywhere else would
   * mean a second amber panel that could appear beside this one.
   */
  | { kind: 'unposted-final' }

/**
 * How long past the scheduled first pitch before silence is worth reporting.
 *
 * Deliberately generous. First pitch slips for weather, for a ceremony, for a bus, and the
 * league's own record is stamped when their scraper next runs rather than when the umpire
 * points. Fifteen minutes is long enough that none of those read as a fault and short enough
 * that a reader who came to watch is not left guessing for a whole half of baseball.
 */
export const FIRST_PITCH_GRACE_MS = 15 * 60_000

/** How stale the league's own stamp must be before we describe it as stale. Same figure as
 *  the grace above, and for the same reason: shorter and an ordinary between-innings gap in
 *  their publishing starts tripping it. */
export const FEED_STALE_MS = 15 * 60_000

/** How long without a write from our own ingest counts as our problem. The cron runs every
 *  two minutes, so this is five consecutive misses: past that it is not jitter. */
export const INGEST_STALE_MS = 10 * 60_000

/** What this needs off a game row. Narrow on purpose, so a caller holding a partial row (the
 *  live poll's column subset) can be type-checked against it rather than trusted. */
export type FeedHealthGame = Pick<
  WpblGame, 'game_date' | 'start_time' | 'status' | 'updated_at' | 'source_updated_at' | 'final_by_rule'>

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function feedHealth(game: FeedHealthGame, now: number = Date.now()): WpblFeedHealth {
  // OUR call before the league's word, because a settled row carries both: `status` reads
  // 'final' so the rest of the section treats it as one, and this flag is the only thing left
  // saying the league never posted it. Tested second and the row falls through to 'ok' and the
  // reader is told nothing about a result we inferred.
  if (game.final_by_rule) return { kind: 'unposted-final' }

  // A finished game is allowed to stop changing. That is what finished means.
  if (game.status === 'final') return { kind: 'ok' }

  // No start time, no gate, and without the gate this cannot tell a quiet feed from a game
  // that is simply not due yet. Say nothing.
  const start = gameStartMs(game.game_date, game.start_time)
  if (start == null) return { kind: 'ok' }

  const lateBy = now - start
  if (lateBy < FIRST_PITCH_GRACE_MS) return { kind: 'ok' }

  // OUR CLOCK FIRST, ALWAYS. If the ingest has stopped, the league's stamp is stale as a
  // consequence and says nothing about the league. Checking upstream first would report a
  // feed outage every time our own cron died, which is precisely backwards.
  const ours = ms(game.updated_at)
  if (ours == null || now - ours > INGEST_STALE_MS) {
    return { kind: 'ingest-stale', since: ours ?? 0 }
  }

  // Our side is demonstrably alive, so an old upstream stamp is theirs.
  const theirs = ms(game.source_updated_at)
  if (theirs == null || now - theirs > FEED_STALE_MS) {
    return { kind: 'feed-stale', since: theirs ?? 0, lateBy }
  }

  return { kind: 'ok' }
}

/** "1h 52m", "18m": how long a gap has been open, for a sentence. Minutes below an hour,
 *  because "0h 18m" reads as a stopwatch and this is prose. */
export function describeGap(gapMs: number): string {
  const mins = Math.max(0, Math.floor(gapMs / 60_000))
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

// ─── When the league last changed a finished game ────────────────────────────

/** A box score the league revised after the day it was played. */
export interface WpblRevision {
  /** The league's own stamp on the record, in ms. */
  at: number
  /**
   * The LEAGUE's calendar day for that stamp, "2026-09-02".
   *
   * What a surface prints, and not `at` formatted locally. A revision stamped late in the
   * evening in Springfield is the small hours of the next day in UTC and the previous
   * afternoon on the west coast, so the reader's own midnight would move the date by a day for
   * most of them: six of the eight marked on the schedule the day this shipped. The decision
   * that this IS a revision is made against the league's day, and the date shown has to be the
   * same day the decision used.
   */
  on: string
  /** Whole days from the day it was played to the day it was last revised. */
  days: number
}

/**
 * When the league last touched this game's box score, if that was after the game itself.
 *
 * WHY THIS IS WORTH SHOWING. The league revises box scores for weeks: of the 30 regular-season
 * games, 23 carry a stamp two or more days after they were played, one of them nineteen days
 * later. A reader watching a season total move has no way to tell which game moved under it,
 * and the only record of it anywhere is this timestamp.
 *
 * IT IS THEIR CLOCK, NOT OURS, which is the whole point. `updated_at` is when the ingest last
 * wrote our row, and it moves on every pass whether or not anything changed, so it says nothing
 * about the league. `source_updated_at` is the timestamp the LEAGUE stamped on the record, and
 * on a completed game only a real revision moves it. The same pair, read the same way round, as
 * `feedDelay` above.
 *
 * A LATER CALENDAR DAY, not merely a later instant. Every final is stamped within an hour or so
 * of the last out, and printing "revised" against that would put a flag on all 30 games meaning
 * nothing but "the game ended". The comparison is against the league's own Central day, since
 * `game_date` is a Central wall date and a stamp at 23:40 Central is 04:40 UTC the next day.
 *
 * WHAT IT CANNOT SAY is what changed, or that nothing has. `wpbl-ingest` never re-reads a game
 * once it is stored final, so our copy of this stamp only advances when something reopens the
 * game: the nightly drift check (`scripts/check-wpbl-drift.mjs`) is what does that, and it is
 * what makes this number trustworthy at all. Without it, a revision the league made an hour ago
 * would not be here yet.
 */
export function boxScoreRevision(
  game: Pick<WpblGame, 'game_date' | 'status' | 'source_updated_at'>,
): WpblRevision | null {
  // Only a final. On a live or scheduled game the stamp is just "when it last moved", which is
  // every couple of minutes and is not a revision.
  if (game.status !== 'final' || !game.source_updated_at) return null
  const at = Date.parse(game.source_updated_at)
  if (!Number.isFinite(at)) return null

  const revisedOn = LEAGUE_DAY.format(at)          // "2026-08-21", the league's own day
  if (revisedOn <= game.game_date) return null

  // Both are bare calendar dates, so this is a difference in days with no clock in it and no
  // timezone left to get wrong.
  const days = Math.round(
    (Date.parse(`${revisedOn}T00:00:00Z`) - Date.parse(`${game.game_date}T00:00:00Z`)) / 86_400_000)
  return { at, on: revisedOn, days }
}

/** "Sep 2" from a bare calendar date, with no clock in it to shift the day. */
export function formatRevisionDay(on: string): string {
  return new Date(`${on}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** The league's calendar day for an instant. en-CA formats as YYYY-MM-DD, which is the shape
 *  `game_date` is stored in, so the two compare as strings. */
const LEAGUE_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: WPBL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
