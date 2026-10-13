// The Scores page's timeline: which game day it opens on, where a jump lands, and which days a
// scroll loads next. Pure, so the rules can be pinned without a browser. `days` is every date in
// the season with a game, ascending, as fetchSeasonGameDates returns it.

/** Days fetched per request, each way. Four is a full regular-season stretch in about 300KB. */
export const CHUNK = 4

/** The day the page opens on: the most recent day with a game under way or done, so the reader's
 *  first screen is the latest result with what is next below it. Today once any game has started,
 *  otherwise the game day before it. A morning reader sees last night's finals, then today. */
export function anchorIndex(days: string[], today: string, todayStarted: boolean): number {
  if (!days.length) return -1
  const i = days.indexOf(today)
  if (i >= 0) return todayStarted || i === 0 ? i : i - 1
  const before = lastIndexBefore(days, today)
  // Before opening day there is no result yet, so the first game day.
  return before >= 0 ? before : 0
}

/** Where a jump to a date lands: that day, or the first game day after it (an off day, the
 *  All-Star break), or the last one when the date is past the season. */
export function indexOnOrAfter(days: string[], iso: string): number {
  if (!days.length) return -1
  const i = days.findIndex(d => d >= iso)
  return i >= 0 ? i : days.length - 1
}

function lastIndexBefore(days: string[], iso: string): number {
  for (let k = days.length - 1; k >= 0; k--) if (days[k] < iso) return k
  return -1
}

/** The next run of days to fetch below the loaded ones, or null at the end of the schedule. */
export function nextChunk(days: string[], hi: number): [number, number] | null {
  if (hi >= days.length - 1) return null
  return [hi + 1, Math.min(days.length - 1, hi + CHUNK)]
}

/** The run above the loaded ones, or null at opening day. */
export function prevChunk(lo: number): [number, number] | null {
  if (lo <= 0) return null
  return [Math.max(0, lo - CHUNK), lo - 1]
}

/** The day being read: the last section whose top has passed the pinned bar's bottom edge. */
export function activeDay(tops: Array<{ day: string; top: number }>, line: number): string | null {
  let current: string | null = tops[0]?.day ?? null
  for (const t of tops) if (t.top <= line) current = t.day
  return current
}
