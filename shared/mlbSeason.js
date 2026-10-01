// The MLB season calendar, shared by the site (src/mlb/seasonPhase.ts) and the GitHub Actions
// jobs (scripts/mlb-job-due.mjs), so "is the season on" has one answer in both places.
//
// THE CALENDAR IS THE LEAGUE'S. `/seasons/{year}` publishes the regular season's first and last
// days and the postseason's last, so nothing here hardcodes a date that moves every year. Plain
// ESM with no imports, so a cron step can run it before installing anything.
//
// Every function that reads the network FAILS TOWARD "THE SEASON IS ON". A job that runs when it
// did not need to costs a runner minute; one that skips a game day loses picks, pushes and grades.

const API = 'https://statsapi.mlb.com/api/v1'

const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

/** The league's calendar for a season, or null if it cannot be read. */
export async function fetchSeasonDates(season, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${API}/seasons/${season}?sportId=1`)
    if (!r.ok) return null
    const s = (await r.json())?.seasons?.[0]
    const regularSeasonStart = day(s?.regularSeasonStartDate)
    const regularSeasonEnd = day(s?.regularSeasonEndDate)
    const postSeasonEnd = day(s?.postSeasonEndDate) ?? day(s?.seasonEndDate)
    return regularSeasonStart && regularSeasonEnd && postSeasonEnd
      ? { regularSeasonStart, regularSeasonEnd, postSeasonEnd }
      : null
  } catch { return null }
}

/** `YYYY-MM-DD` plus or minus whole days. */
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/**
 * The phase on `today` (YYYY-MM-DD). `regularGamesLeft` keeps it in the regular season past the
 * scheduled last day while a rained-out game is still to be made up: that day the race is the news.
 */
export function phaseOn(dates, today, regularGamesLeft = false) {
  if (today < dates.regularSeasonStart) return 'preseason'
  if (today <= dates.regularSeasonEnd || regularGamesLeft) return 'regular'
  if (today <= dates.postSeasonEnd) return 'postseason'
  return 'offseason'
}

// The same test as gameStatus.ts's isUnplayed, repeated because this file cannot import the site's
// TypeScript. Pinned against it in src/mlb/__tests__/mlbSeason.test.ts.
const unplayed = st => {
  const coded = st?.codedGameState, detailed = st?.detailedState ?? ''
  return coded === 'D' || coded === 'C' || detailed === 'Postponed' || detailed === 'Cancelled'
}

/** Whether a schedule response still holds a game to be played. Postponed and cancelled never count. */
export function hasGamesLeft(schedule) {
  for (const d of schedule?.dates ?? []) {
    for (const g of d.games ?? []) {
      if (unplayed(g.status)) continue
      if (g.status?.abstractGameState !== 'Final') return true
    }
  }
  return false
}

/** Whether a regular-season game is still to be played between the scheduled last day and the
 *  end of the postseason. False when it cannot be read: only asked past the last day, where the
 *  calendar has already said the season is over. */
export async function regularGamesLeft(dates, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(
      `${API}/schedule?sportId=1&gameType=R&startDate=${dates.regularSeasonEnd}&endDate=${dates.postSeasonEnd}` +
      '&fields=dates,games,status,abstractGameState,codedGameState,detailedState')
    return r.ok ? hasGamesLeft(await r.json()) : false
  } catch { return false }
}

// ─── When each kind of MLB job has work ───────────────────────────────────────
//
// 'games': anything that acts on a day's games, regular season or postseason: the prediction and
//   Survivor bots, the pick and game-start pushes, and the resolvers that grade them. From the day
//   before the first game (a reminder goes out ahead of it) to two days past the last (the resolvers
//   grade the night after, and a rain-delayed World Series can slip a day).
// 'regular': the boards measured on regular-season totals: streaks, milestones, playoff odds. They
//   stop moving at the last regular-season game, so from the first day to two days past the last,
//   longer while a makeup is still to come. The frozen row they leave is the season's final word,
//   and the site reads it that way (see seasonPhase.ts).
export const JOB_KINDS = ['games', 'regular']

/** Pure: whether a job of `kind` has work on `today`, given the calendar for today's year. */
export function jobDueOn(kind, dates, today, makeupLeft = false) {
  if (kind === 'games') {
    return today >= addDaysISO(dates.regularSeasonStart, -1) && today <= addDaysISO(dates.postSeasonEnd, 2)
  }
  if (kind === 'regular') {
    return (today >= dates.regularSeasonStart && today <= addDaysISO(dates.regularSeasonEnd, 2)) || makeupLeft
  }
  throw new Error(`unknown job kind: ${kind}`)
}

/**
 * Whether a job of `kind` has work today, with the reason, for a cron step to print. Reads the
 * calendar for today's UTC year: in January that is the coming season, whose first day is ahead,
 * so the year's turn needs no special case.
 */
export async function mlbJobDue(kind, now = new Date(), fetchImpl = fetch) {
  const today = now.toISOString().slice(0, 10)
  const season = Number(today.slice(0, 4))
  const dates = await fetchSeasonDates(season, fetchImpl)
  if (!dates) return { due: true, reason: `could not read the ${season} calendar, running to be safe` }
  let makeup = false
  if (kind === 'regular' && today > addDaysISO(dates.regularSeasonEnd, 2) && today <= dates.postSeasonEnd) {
    makeup = await regularGamesLeft(dates, fetchImpl)
  }
  const due = jobDueOn(kind, dates, today, makeup)
  const window = kind === 'games'
    ? `${addDaysISO(dates.regularSeasonStart, -1)} to ${addDaysISO(dates.postSeasonEnd, 2)}`
    : `${dates.regularSeasonStart} to ${addDaysISO(dates.regularSeasonEnd, 2)}${makeup ? ', plus a makeup still to play' : ''}`
  return { due, reason: `${today} is ${due ? 'inside' : 'outside'} the ${season} '${kind}' window (${window})` }
}
