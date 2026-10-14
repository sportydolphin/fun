import { POSTSEASON_SCHEDULE } from './derive/bracket'
import { seasonOf } from './season'
import type { WpblGame } from './types'

/**
 * Whether the calendar says the postseason is over, for the one surface that has to guess before
 * any data exists: the skeleton. The loaded page keys on the decided champion (`seasonDone` in
 * Home), which needs the schedule; this needs nothing, and answers from the last date the league
 * published for the final. A final decided before its last scheduled date leaves the skeleton on
 * the in-season shape for those few days, which is the same page it drew before this existed.
 *
 * AND IT ENDS ON THE NEXT OPENING DAY, which the calendar cannot know. `POSTSEASON_SCHEDULE` is
 * replaced only once the league publishes the next bracket, months after the next season starts,
 * so on the published dates alone every skeleton through the 2027 season would draw the offseason
 * frame over an in-season Home, a full-page jump on every load. The opener is in the schedule, so
 * the loaded Home remembers it (`rememberNextOpeningDay`) and this reads it back. A first visit has
 * nothing remembered and guesses offseason, the shape it drew before; that is a jump for one load.
 * A remembered opener from BEFORE the published final is last year's, and is ignored.
 */
export function offseasonByCalendar(now = Date.now(), opener: string | null = storedOpeningDay()): boolean {
  const dates = Object.values(POSTSEASON_SCHEDULE).flat().map(g => g.date).sort()
  const last = dates[dates.length - 1]
  // The end of that day in the league's zone, generously: 06:00Z the next morning.
  if (!last || now <= Date.parse(`${last}T00:00:00Z`) + 30 * 3600_000) return false
  // The start of Opening Day in the league's zone, 06:00Z: the skeleton turns before first pitch.
  return !(opener && opener > last && now >= Date.parse(`${opener}T06:00:00Z`))
}

const OPENER_KEY = 'wpbl.nextOpeningDay'

/** Per-viewer and only a hint, so storage off simply means no hint. */
function storedOpeningDay(): string | null {
  try { return localStorage.getItem(OPENER_KEY) } catch { return null }
}

/**
 * The first game of the season after `current`, from a schedule the loaded Home holds, for
 * `offseasonByCalendar`. Null until the league publishes one.
 */
export function nextOpeningDay(schedule: Pick<WpblGame, 'game_date'>[], current: number | null): string | null {
  if (current == null) return null
  let out: string | null = null
  for (const g of schedule) {
    const y = seasonOf(g)
    if (y != null && y > current && (out == null || g.game_date < out)) out = g.game_date
  }
  return out
}

export function rememberNextOpeningDay(date: string | null): void {
  if (!date) return
  try { localStorage.setItem(OPENER_KEY, date) } catch { /* storage off */ }
}
