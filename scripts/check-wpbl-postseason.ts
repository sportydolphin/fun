/**
 * check-wpbl-postseason.ts: does the feed mark a postseason game as one?
 *
 * WHY THIS EXISTS. Every season total on the site rides on one fact nobody can check until
 * Sep 9, 2026: whether the league's feed flags a postseason game through `game_type` or
 * `counts_in_standings`. `countsInStandings()` in src/wpbl/season.ts deliberately FAILS OPEN,
 * excluding a game only on positive evidence and counting everything it does not recognise,
 * because the alternative renders four clubs at 0-0 the day the feed renames its game types.
 * That is the right failure direction and it has a price: if the feed marks a semifinal as
 * nothing in particular, the site silently folds 7 to 11 postseason games into every
 * leaderboard, every player page, the OG cards and the Discord `/player` card, and the
 * bracket sits empty while the games it is drawing are being played. Nothing goes red. The
 * numbers just quietly stop being season numbers.
 *
 * So this job is the tripwire under that. It compares the league's own published calendar
 * against the feed's own marking, and fails when they disagree in either direction.
 *
 * THE TWO INDEPENDENT SIGNALS, and why the calendar is only ever a monitor:
 *
 *   1. The published calendar. POSTSEASON_SCHEDULE in src/wpbl/derive/bracket.ts is the
 *      league's own dates, so a game on or after the first of them is a postseason game by
 *      the league's word.
 *   2. The feed's marking, read exactly as the site reads it, through `countsInStandings`.
 *
 * IT MUST NOT BECOME A FILTER. The obvious "fix", the day this fires, is to have the app
 * treat the date as authoritative and exclude anything from Sep 9 on. Do not: a postponed
 * regular-season game replayed on Sep 8, which is precisely the kind of thing a league with
 * one venue does, would vanish from the standings with no evidence it was ever there. The
 * date is good enough to raise an alarm a person then reads. It is not good enough to decide
 * what counts, and the difference between those two is the whole design of this file.
 *
 * WHY IT FAILS LOUDLY, unlike the play-by-play validator next to it. That one reports 57
 * known findings every night and would train anyone to ignore a red X, so it records a row
 * and always exits 0. This one has nothing to say on any ordinary day: it is green all season
 * and it goes red exactly once, on the day something needs a person. A red X IS the signal
 * here, which is why there is no baseline file and no --record.
 *
 * Usage:
 *   npm run check-postseason           # exits 1 on a disagreement, 0 otherwise
 *   npm run check-postseason -- --json
 *
 * Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Reads only, and the games table is
 * public-read, so the anon key is enough and the service-role key has no business here.
 */
import { pathToFileURL } from 'node:url'
import { countsInStandings } from '../src/wpbl/season'
import { POSTSEASON_SCHEDULE } from '../src/wpbl/derive/bracket'
import type { WpblGame } from '../src/wpbl/types'

const JSON_OUT = process.argv.includes('--json')

/**
 * The first day of the postseason, taken from the published schedule rather than written
 * down again, so a corrected date only has to be corrected in one place. Everything on or
 * after it is a postseason game by the league's own calendar.
 */
function firstPostseasonDate(): string {
  const dates = Object.values(POSTSEASON_SCHEDULE).flat().map(g => g.date).sort()
  return dates[0]
}

/** The columns this check reasons about, and nothing else. */
type Row = Pick<WpblGame,
  'id' | 'game_date' | 'status' | 'game_type' | 'counts_in_standings' | 'home_team_id' | 'away_team_id'>

async function fetchGames(): Promise<Row[]> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (try: node --env-file=.env)')
  }
  const cols = 'id,game_date,status,game_type,counts_in_standings,home_team_id,away_team_id'
  // Explicit limit and an order, per the paging rule in CLAUDE.md. A season is ~40 rows, so
  // one page is the whole table, but a bare select would cap at 1000 without saying so and
  // this is the kind of file that gets copied.
  const url = `${base.replace(/\/+$/, '')}/rest/v1/wpbl_games?select=${cols}&order=game_date.asc,id.asc&limit=2000`
  const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
  if (!res.ok) throw new Error(`wpbl_games read failed: ${res.status} ${await res.text()}`)
  return await res.json() as Row[]
}

export interface Disagreement {
  kind: 'counted-postseason' | 'excluded-regular'
  id: string
  game_date: string
  status: string
  game_type: string | null
  counts_in_standings: boolean | null
}

/**
 * Where the calendar and the feed disagree.
 *
 * Both directions, because both are silent and both are wrong:
 *
 *   counted-postseason: a game on a postseason date that every season total is folding in.
 *     This is the one the whole file was written for.
 *   excluded-regular: a game before the postseason that the feed says does not count, which
 *     drops a real regular-season game out of the standings. Less likely and just as quiet:
 *     it would read as a club having played fewer games than it has.
 *
 * Exported and pure so the rules can be tested without a live feed, which matters more here
 * than usual: this code's whole job happens on a day that has not arrived yet.
 */
export function findDisagreements(games: Row[], postseasonFrom: string): Disagreement[] {
  const out: Disagreement[] = []
  for (const g of games) {
    const calendarSaysPostseason = g.game_date >= postseasonFrom
    const feedSaysRegular = countsInStandings(g)
    // They agree when exactly one of the two is true. Spelled out rather than as the equality
    // it reduces to, because the short version reads like a typo and this is the one line the
    // whole file turns on.
    const kind: Disagreement['kind'] | null =
        calendarSaysPostseason && feedSaysRegular ? 'counted-postseason'
      : !calendarSaysPostseason && !feedSaysRegular ? 'excluded-regular'
      : null
    if (!kind) continue
    out.push({
      kind,
      id: g.id,
      game_date: g.game_date,
      status: g.status,
      game_type: g.game_type ?? null,
      counts_in_standings: g.counts_in_standings ?? null,
    })
  }
  return out
}

async function main(): Promise<void> {
  const from = firstPostseasonDate()
  const games = await fetchGames()
  const postseason = games.filter(g => g.game_date >= from)
  const bad = findDisagreements(games, from)

  if (JSON_OUT) {
    console.log(JSON.stringify({
      checked_at: new Date().toISOString(),
      postseason_from: from,
      games_seen: games.length,
      postseason_rows: postseason.length,
      disagreements: bad,
    }, null, 2))
  } else {
    console.log('\nWPBL postseason marking check')
    console.log('='.repeat(60))
    console.log(`Postseason starts ${from} (from the published schedule)`)
    console.log(`${games.length} games in the mirror, ${postseason.length} on a postseason date.`)
    // Always print what the feed actually sent for the postseason rows. On the day the first
    // one lands this is the answer to the question the whole roadmap item is waiting on, and
    // it should be in the log whether or not anything is wrong.
    if (postseason.length) {
      console.log('\nWhat the feed says about them:')
      console.table(postseason.map(g => ({
        date: g.game_date, status: g.status,
        game_type: g.game_type ?? '—',
        counts_in_standings: g.counts_in_standings ?? '—',
        counted_by_us: countsInStandings(g),
      })))
    } else {
      console.log('\nNo postseason rows yet. Nothing to disagree about.')
    }
    if (bad.length) {
      console.log('\n' + '!'.repeat(60))
      console.log(`${bad.length} game(s) where the calendar and the feed disagree:\n`)
      console.table(bad)
      console.log(`
What to do, for the 'counted-postseason' rows:

  The feed is not marking the postseason in a way season.ts recognises, so every season
  aggregate on the site is currently including these games. Look at what game_type actually
  holds above, then widen the regex in countsInStandings() in src/wpbl/season.ts to match it.
  That one function is the only place that decides, so the standings, every leaderboard, the
  player pages, the OG cards and the Discord /player card all follow from the change.

  Do NOT switch the app over to filtering on the date instead. See the header of this file.
`)
    } else {
      console.log('\nCalendar and feed agree. Nothing to do.')
    }
  }
  process.exit(bad.length > 0 ? 1 : 0)
}

// Only when run as the script, so the test suite can import `findDisagreements` without
// this file reaching for the network and calling process.exit on the way past. Same guard
// as scripts/sync-wpbl-discord-postseason.mjs, for the same reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err)
    process.exit(2)
  })
}
