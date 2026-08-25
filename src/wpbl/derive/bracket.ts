import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'
import { countsInStandings } from '../season'
import { seedingRace, SEMIFINAL_PAIRS, bracketIsSet } from './seeding'

// The postseason bracket: who plays whom, and how far each series has got.
//
// The companion to derive/seeding.ts, which answers "what are the last games for". This
// answers the question after it, "so who goes where", which the seeding table states only as
// a letter in a column and a name in a cell. Four clubs, two semifinals, one championship: a
// shape small enough to draw, and drawing it is the point.
//
// WHY THIS DOES NOT WAIT ON THE FEED. The roadmap files series state as blocked until the
// first postseason game shows how the feed represents a series, on the assumption that we
// need it to hand us a series id or a game number. We do not. The postseason is the only part
// of the schedule `countsInStandings` rejects, and within it a pair of team ids identifies a
// series uniquely: the semifinals are 1v4 and 2v3, the championship is the two winners, and
// no two of those three pairings can be the same two clubs. So grouping postseason games by
// their unordered pair of teams reconstructs every series without a single new field, and it
// keeps working whatever the feed decides to call them.
//
// The one thing it does still depend on is the feed marking postseason games AT ALL, through
// `game_type` or `counts_in_standings`. If it marks neither, those games read as regular
// season and this bracket stays empty, which is the same known exposure the standings and
// every season total already carry (see season.ts) rather than a new one.
//
// Pure: standings rows and the schedule in, plain shapes out. No supabase, no React.

/** Semifinals are best-of-three, the championship best-of-five (format confirmed Aug 16). */
export const BEST_OF: Record<BracketRound, number> = { semifinal: 3, championship: 5 }

/**
 * The postseason calendar, as the league published it on Aug 24, 2026.
 *
 * WHY THIS IS A CONSTANT AND NOT A TABLE. The feed carries no postseason rows yet, and it
 * cannot: `wpbl_games` needs two clubs per row and nobody knows who plays whom until the last
 * regular-season game on Sep 6 sets the seeds. Dates are known, opponents are not, so the
 * dates live here and the pairings stay derived from the standings, exactly as they already
 * are. When the feed does publish real rows they take over on their own; nothing here has to
 * be removed, because this only ever labels a series with when it is scheduled.
 *
 * TIMES ARE CENTRAL WALL CLOCK, matching the `start_time` text the feed uses for every regular
 * season game, which `formatGameTime` already converts to the reader's zone DST-safe. The
 * league's email said "CST"; Springfield is on CDT in September, and it plainly meant Central
 * rather than a fixed offset. Writing these as a bare wall clock is what keeps that right, and
 * is why they must NOT be "corrected" into UTC.
 */
export interface PostseasonGame {
  game: number
  /** Central calendar date, YYYY-MM-DD, same shape as `wpbl_games.game_date`. */
  date: string
  /** Central wall clock, same shape as `wpbl_games.start_time`. */
  time: string
  /** Played only if the series is still alive. Marked with an asterisk wherever it is shown. */
  ifNecessary?: boolean
}

export const POSTSEASON_SCHEDULE: Record<string, PostseasonGame[]> = {
  'semifinal:A': [
    { game: 1, date: '2026-09-09', time: '6:00 PM' },
    { game: 2, date: '2026-09-11', time: '5:00 PM' },
    { game: 3, date: '2026-09-13', time: '2:00 PM', ifNecessary: true },
  ],
  'semifinal:B': [
    { game: 1, date: '2026-09-10', time: '6:00 PM' },
    { game: 2, date: '2026-09-12', time: '6:00 PM' },
    { game: 3, date: '2026-09-14', time: '6:00 PM', ifNecessary: true },
  ],
  // Best of five, so games 1 to 3 are always played and only 4 and 5 are conditional.
  championship: [
    { game: 1, date: '2026-09-16', time: '6:00 PM' },
    { game: 2, date: '2026-09-17', time: '6:00 PM' },
    { game: 3, date: '2026-09-19', time: '6:00 PM' },
    { game: 4, date: '2026-09-20', time: '2:00 PM', ifNecessary: true },
    { game: 5, date: '2026-09-22', time: '6:00 PM', ifNecessary: true },
  ],
}

/** The published dates for one series, or [] for a round we have no schedule for. */
export function postseasonGames(round: BracketRound, key: string | null): PostseasonGame[] {
  return POSTSEASON_SCHEDULE[round === 'championship' ? 'championship' : `${round}:${key}`] ?? []
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * One line of dates for a series: "Sep 9, 11, 13*".
 *
 * The month is repeated only when it changes, which it does not this year but would the moment
 * a series straddled the end of a month. Built by string surgery rather than `new Date`, since
 * a bare date parsed as a Date is midnight UTC printed in local time, which is the previous
 * evening in every American zone.
 */
export function seriesDateLine(round: BracketRound, key: string | null): string | null {
  const games = postseasonGames(round, key)
  if (!games.length) return null
  let lastMonth = ''
  return games.map(g => {
    const [, mo, d] = g.date.split('-')
    const month = SHORT_MONTHS[Number(mo) - 1] ?? mo
    const label = month === lastMonth ? `${Number(d)}` : `${month} ${Number(d)}`
    lastMonth = month
    return `${label}${g.ifNecessary ? '*' : ''}`
  }).join(', ')
}

export type BracketRound = 'semifinal' | 'championship'

/** Games a club must win to take the series: 2 of 3, 3 of 5. */
export const winsNeeded = (round: BracketRound): number => Math.floor(BEST_OF[round] / 2) + 1

export interface BracketEntrant {
  /** Null while the slot is still being decided, which is the championship before both
   *  semifinals have a winner. */
  team: WpblTeam | null
  seed: number | null
  /** Wins in THIS series only. */
  wins: number
}

export interface BracketSeries {
  round: BracketRound
  /** 'A' and 'B' for the semifinals, matching semifinalLabel; null for the championship. */
  key: string | null
  label: string
  bestOf: number
  /** The higher seed, so the bracket always draws the same way round. */
  home: BracketEntrant
  away: BracketEntrant
  played: number
  winner: WpblTeam | null
  /** `upcoming` covers both a series not yet started and one whose entrants are still unknown. */
  status: 'upcoming' | 'live' | 'done'
  /** One line a fan would say out loud: "Best of 3", "Firebells lead 2-1", "Tied 1-1",
   *  "Firebells win 2-0". */
  summary: string
}

export interface WpblBracket {
  semifinals: BracketSeries[]
  championship: BracketSeries
  /** Every seed is locked, so these pairings are final rather than a snapshot. */
  settled: boolean
  /** True once any postseason game has been played, which flips the card from a projection
   *  to a report. */
  started: boolean
  champion: WpblTeam | null
}

const isPlayed = (g: WpblGame): boolean =>
  g.status === 'final' && g.home_score != null && g.away_score != null

/** An unordered pair of team ids, as a stable key. */
const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

/**
 * Wins per club within each postseason pairing.
 *
 * Keyed on the pair rather than on anything the feed says about rounds, for the reason in the
 * header. A pairing that is not part of the bracket we expect simply never gets looked up.
 */
function postseasonSeries(games: WpblGame[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const g of games) {
    if (countsInStandings(g) || !isPlayed(g)) continue
    const key = pairKey(g.home_team_id, g.away_team_id)
    const tally = out.get(key) ?? new Map<string, number>()
    // A tie cannot decide a postseason game, so an equal score is not a win for anybody. It
    // should not happen; it must not silently credit the home side if it does.
    if (g.home_score! !== g.away_score!) {
      const winner = g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id
      tally.set(winner, (tally.get(winner) ?? 0) + 1)
    }
    // Set unconditionally so a played-but-tied game still registers the pairing as under way.
    out.set(key, tally)
  }
  return out
}

/** "Firebells lead 2-1" and the rest of the one-liners, in the order a reader cares about. */
function summarise(series: Omit<BracketSeries, 'summary'>): string {
  const { home, away, winner, bestOf, status } = series
  if (status === 'upcoming') {
    return home.team && away.team ? `Best of ${bestOf}` : 'Awaiting semifinal'
  }
  if (winner) {
    const w = winner.id === home.team?.id ? home : away
    const l = winner.id === home.team?.id ? away : home
    return `${winner.name} win ${w.wins}-${l.wins}`
  }
  if (home.wins === away.wins) return `Tied ${home.wins}-${away.wins}`
  const [lead, trail] = home.wins > away.wins ? [home, away] : [away, home]
  return `${lead.team?.name} lead ${lead.wins}-${trail.wins}`
}

function buildSeries(
  round: BracketRound,
  key: string | null,
  label: string,
  home: { team: WpblTeam | null; seed: number | null },
  away: { team: WpblTeam | null; seed: number | null },
  series: Map<string, Map<string, number>>,
): BracketSeries {
  const bestOf = BEST_OF[round]
  const tally = home.team && away.team ? series.get(pairKey(home.team.id, away.team.id)) : undefined
  const homeWins = (home.team && tally?.get(home.team.id)) || 0
  const awayWins = (away.team && tally?.get(away.team.id)) || 0
  const played = homeWins + awayWins
  const need = winsNeeded(round)
  const winner = homeWins >= need ? home.team : awayWins >= need ? away.team : null

  const base = {
    round, key, label, bestOf,
    home: { team: home.team, seed: home.seed, wins: homeWins },
    away: { team: away.team, seed: away.seed, wins: awayWins },
    played,
    winner,
    status: (winner ? 'done' : played > 0 ? 'live' : 'upcoming') as BracketSeries['status'],
  }
  return { ...base, summary: summarise(base) }
}

/**
 * The whole bracket, from the standings order and the schedule.
 *
 * Before the postseason this is a projection: the pairings the table would produce if the
 * season ended now, which is exactly what the seeding race is about. Once postseason games
 * start landing the same structure carries their series records, so the card does not have to
 * become a different card on Sep 9.
 */
export function buildBracket(rows: WpblStandingRow[], games: WpblGame[]): WpblBracket | null {
  const seeds = seedingRace(rows, games)
  // A bracket needs all four slots. Fewer clubs than that is a partial league, which happens
  // in tests and in an empty state, and half a bracket is worse than none.
  if (seeds.length < 4) return null

  const bySeed = new Map(seeds.map(s => [s.seed, s]))
  const series = postseasonSeries(games)
  const entrant = (seed: number) => {
    const s = bySeed.get(seed)
    return { team: s?.team ?? null, seed: s?.seed ?? null }
  }

  const semifinals = SEMIFINAL_PAIRS.map(([hi, lo], i) => buildSeries(
    'semifinal',
    String.fromCharCode(65 + i),
    `Semifinal ${String.fromCharCode(65 + i)}`,
    entrant(hi), entrant(lo), series,
  ))

  // The championship's entrants are the semifinal winners, and stay null until there are two.
  // The higher seed is drawn first, so the bracket does not swap sides when a lower seed wins.
  const winners = semifinals
    .map(s => s.winner ? { team: s.winner, seed: seeds.find(x => x.team.id === s.winner!.id)?.seed ?? null } : null)
  const [first, second] = winners.every(Boolean)
    ? [winners[0]!, winners[1]!].sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99))
    : [{ team: null, seed: null }, { team: null, seed: null }]

  const championship = buildSeries('championship', null, 'Championship', first, second, series)

  return {
    semifinals,
    championship,
    settled: bracketIsSet(seeds),
    started: [...series.values()].length > 0,
    champion: championship.winner,
  }
}
