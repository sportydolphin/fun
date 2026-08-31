import { gameStartMs } from '../constants'
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
  WpblGame, 'game_date' | 'start_time' | 'status' | 'updated_at' | 'source_updated_at'>

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function feedHealth(game: FeedHealthGame, now: number = Date.now()): WpblFeedHealth {
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
