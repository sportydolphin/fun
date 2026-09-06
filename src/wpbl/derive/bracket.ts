import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'
import { countsInStandings } from '../season'
import { seedingRace, SEMIFINAL_PAIRS, bracketIsSet, clinchedSeeds, type WpblSeedRow } from './seeding'
// The format and the pairing key live in series.ts, which is the module every OTHER surface
// reads (a schedule row, a Game Center header, a recap), and re-exported here so this file
// stays the one import a bracket needs. Stated in one place because "best of three" appearing
// twice is how a semifinal ends up needing three wins on one screen and two on another.
import { BEST_OF, winsNeeded, pairKey, type BracketRound } from './series'

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

export { BEST_OF, winsNeeded }
export type { BracketRound }

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

// ─── The postseason on the schedule ─────────────────────────────────────────

/** One side of a postseason game before the feed has a row for it. */
export interface PostseasonSlot {
  /** The club, once this slot is decided. Null while it is still a projection. */
  team: WpblTeam | null
  /** What to print when `team` is null: "1 seed", "Semifinal A winner". */
  label: string
  /** The same thing for a card with no room for it: "1 seed", "Semi A". Spelled here rather
   *  than truncated at the call site, because the scoreboard chip is 8.5rem wide and
   *  "Semifinal A winner" ellipsises to "Semifinal A w…", which names the wrong thing. */
  shortLabel: string
  /** The seed this slot is reserved for, so a card can show the number without parsing the
   *  label. Null on the championship, whose slots are winners rather than seeds. */
  seed: number | null
}

export interface PostseasonScheduleRow {
  /** Stable across renders and independent of the clubs, which move. */
  id: string
  /** Central calendar date, matching `wpbl_games.game_date`. */
  date: string
  /** Central wall clock, matching `wpbl_games.start_time`. */
  time: string
  round: BracketRound
  key: string | null
  /** "Semifinal A", "Championship". */
  label: string
  gameNumber: number
  /** Whether this game may never be played. Goes false once the series reaches the point where
   *  it must be, which is not the same as the row surviving at all: a row is dropped when the
   *  series is OVER, and unflagged when the series is alive and every game before this one has
   *  been played. */
  ifNecessary: boolean
  /** The two clubs are known but which of them is the higher seed is not, so `first` and
   *  `second` are the current projection rather than a fact. True only in the window where a
   *  pairing has closed and the seeds inside it have not: see `postseasonScheduleRows`. */
  seedOrderTbd: boolean
  /** Higher seed first. NOT home and away: see the note in `postseasonScheduleRows`. */
  first: PostseasonSlot
  second: PostseasonSlot
}

/**
 * The postseason as rows the schedule can print, before the feed has any games for it.
 *
 * WHY THE SCHEDULE NEEDS THESE AT ALL. `wpbl_games` ends on Sep 6 and will until the league
 * publishes the bracket, so the section's own schedule said the season stopped there while the
 * bracket card two tabs away was already counting down to Sep 9. These fill that gap from the
 * calendar the league published, and they retire themselves: a row is dropped as soon as the
 * feed carries a real postseason game on its date, so nothing has to be deleted later and the
 * real row is always the one that wins.
 *
 * SEEDS, NOT PROJECTED CLUBS. A slot names a club only once that exact seed can no longer move
 * (`bestPossible === worstPossible`, the same test `bracketIsSet` applies to the whole
 * bracket), and prints "1 seed" until then. The bracket card is free to project because it
 * reads as a projection; a schedule reads as fact, and a fan who screenshots "Firebells at
 * Heights, Sep 9" on Sep 3 has been told something we do not know. The seed line is true on the
 * day it is written and stays true.
 *
 * FIRST AND SECOND, NOT AWAY AND HOME. Every other card in the schedule is "away @ home"
 * because the feed says which is which. Here nothing does: the league published dates and
 * times, not venues, and a best-of-three does not simply give every game to the higher seed.
 * So these print as two rows in seed order with no `@`, and the day the feed sends real rows
 * they carry the real thing.
 */
export function postseasonScheduleRows(
  rows: WpblStandingRow[],
  games: WpblGame[],
): PostseasonScheduleRow[] {
  const seeds = seedingRace(rows, games)
  if (seeds.length < 4) return []

  // A seed names a club only when it has CLINCHED it, which `clinchedSeeds` decides. Per seed,
  // not per bracket: the top seed routinely locks days before the bottom two stop swapping, and
  // holding every slot vague until the whole bracket settles would say less than we know.
  //
  // THIS USED TO BE A LOCAL RULE HERE AND IT WAS TOO SHY. It resolved a rival only on wins and
  // treated any possible tie as open, which is right for a magic number and wrong for a clinch:
  // on Sep 3, 2026 San Francisco were 9-4 with two to play against a Los Angeles ceiling of 9,
  // so the only way LA caught them was a 9-6 tie, and SF held that series 3-2 with no games left
  // in it. SF had the top seed and this list still said "1 seed". The tiebreak lives in
  // seeding.ts now, next to the standings rule it has to agree with.
  const settled = new Map<number, WpblTeam>()
  for (const [teamId, seed] of clinchedSeeds(seeds, games)) {
    const row = seeds.find(x => x.team.id === teamId)
    if (row) settled.set(seed, row.team)
  }

  // The dates the feed has already claimed. A published postseason game always beats the
  // constant: it carries the clubs, the real time, and a page to open.
  const feedDates = new Set<string>()
  for (const g of games) if (!countsInStandings(g)) feedDates.add(g.game_date)

  const bracket = buildBracket(rows, games)
  const seedSlot = (seed: number): PostseasonSlot =>
    ({ team: settled.get(seed) ?? null, label: `${seed} seed`, shortLabel: `${seed} seed`, seed })

  /**
   * The clubs that can still land in one semifinal's two seats: those whose whole remaining
   * range of seeds lies inside the pair.
   *
   * A PAIRING CLOSES BEFORE ITS SEEDS DO, and on Sep 5, 2026 it had. San Francisco had clinched
   * the 1 seed and Boston the 4, which left New York and Los Angeles disputing 2 and 3 with one
   * game to play. Whoever won it they were playing EACH OTHER, because 2v3 is the whole of the
   * other semifinal; but neither had clinched a seed, so the per-seed rule above printed "2
   * seed" against "3 seed" and said less than the standings already knew.
   *
   * Exactly two clubs is the only answer that means anything. One says nothing (a known club
   * against an open opponent is not a matchup), and more is the ordinary case early on, when
   * every range is still wide. The 1v4 pair is the reason the test is a subset rather than an
   * overlap: its seats are not adjacent, so before anything is settled EVERY club's 1-to-4 range
   * lies inside it, and only the count keeps that from reading as a decided matchup.
   */
  const pairOccupants = ([a, b]: [number, number]): WpblSeedRow[] => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    return seeds.filter(s => s.bestPossible >= lo && s.worstPossible <= hi)
  }

  const out: PostseasonScheduleRow[] = []
  const push = (
    round: BracketRound, key: string | null, label: string,
    first: PostseasonSlot, second: PostseasonSlot,
    series: BracketSeries | null,
    seedOrderTbd = false,
  ) => {
    const decided = !!series?.winner
    for (const g of postseasonGames(round, key)) {
      if (feedDates.has(g.date)) continue
      // An if-necessary game that is no longer necessary. Once a series is won its game 3 (or
      // its games 4 and 5) will not be played, and leaving them on the calendar is the one way
      // this list can state something that is not merely unknown but false.
      if (g.ifNecessary && decided) continue
      // The other end of the same fact: with every game before it played and the series still
      // alive, an if-necessary game is necessary. In a best-of-N that is exactly the moment it
      // becomes certain, and it matters beyond the label, because the scoreboard strip has room
      // for four fixtures and spends them on games it can promise.
      const forced = !decided && (series?.played ?? 0) >= g.game - 1
      out.push({
        id: `ps:${round}:${key ?? '-'}:${g.game}`,
        date: g.date, time: g.time, round, key, label,
        gameNumber: g.game, ifNecessary: !!g.ifNecessary && !forced,
        seedOrderTbd,
        first, second,
      })
    }
  }

  SEMIFINAL_PAIRS.forEach((pair, i) => {
    const [hi, lo] = pair
    const key = String.fromCharCode(65 + i)
    const first = seedSlot(hi), second = seedSlot(lo)
    // Both seats open and only two clubs left that can fill them: the matchup is settled even
    // though neither seed is. The clubs go in standings order, which is the projected seeding,
    // and the row carries the flag saying that order is the one thing still unknown.
    let seedOrderTbd = false
    if (!first.team && !second.team) {
      const inPair = pairOccupants(pair)
      if (inPair.length === 2) {
        first.team = inPair[0].team
        second.team = inPair[1].team
        seedOrderTbd = true
      }
    }
    push('semifinal', key, `Semifinal ${key}`, first, second, bracket?.semifinals[i] ?? null, seedOrderTbd)
  })

  // The championship's slots are the semifinal winners, so they are unknown for a different
  // reason than a seed is, and say so rather than borrowing a seed number they do not have.
  const champSlot = (i: number): PostseasonSlot => ({
    team: bracket?.semifinals[i]?.winner ?? null,
    label: `Semifinal ${String.fromCharCode(65 + i)} winner`,
    shortLabel: `Semi ${String.fromCharCode(65 + i)}`,
    seed: null,
  })
  push('championship', null, 'Championship', champSlot(0), champSlot(1), bracket?.championship ?? null)

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.gameNumber - b.gameNumber)
}
