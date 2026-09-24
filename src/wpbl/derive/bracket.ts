import type { WpblGame, WpblSiteGame, WpblStandingRow, WpblTeam } from '../types'
import { countsInStandings } from '../season'
import { seedingRace, SEMIFINAL_PAIRS, bracketIsSet, clinchedSeeds, type WpblSeedRow } from './seeding'
// The format and the pairing key live in series.ts, which is the module every OTHER surface
// reads (a schedule row, a Game Center header, a recap), and re-exported here so this file
// stays the one import a bracket needs. Stated in one place because "best of three" appearing
// twice is how a semifinal ends up needing three wins on one screen and two on another.
import { BEST_OF, winsNeeded, pairKey, type BracketRound } from './series'

// The postseason bracket: who plays whom, and how far each series has got.
//
// The companion to derive/seeding.ts, the standings race that decides the seeds: this answers
// the question after it, "so who goes where". Four clubs, two semifinals, one championship: a
// shape small enough to draw, and drawing it is the point.
//
// WHY THIS DOES NOT WAIT ON THE FEED. Nothing here needs the feed to hand over a series id or a
// game number. The postseason is the only part of the schedule `countsInStandings` rejects, and
// within it a pair of team ids identifies a series uniquely: the semifinals are 1v4 and 2v3, the
// championship is the two winners, and no two of those three pairings can be the same two clubs.
// So grouping postseason games by their unordered pair of teams reconstructs every series without
// a single new field, and it keeps working whatever the feed decides to call them.
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
 * The postseason calendar, as the league published it.
 *
 * WHY THIS IS A CONSTANT AND NOT A TABLE. The feed carries no postseason row until the seeds are
 * set: `wpbl_games` needs two clubs per row and nobody knows who plays whom until the last
 * regular-season game. Dates are known before opponents are, so the dates live here and the
 * pairings stay derived from the standings. When the feed publishes real rows they take over on
 * their own; nothing here has to be removed, because this only ever labels a series with when it
 * is scheduled.
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
  /**
   * Which seat bats last, as the league's own schedule publishes it.
   *
   * A SEAT AND NOT A CLUB, for the same reason the pairings are seeds: this is true before
   * anyone knows who the 1 seed is. The semifinals run higher, lower, higher, which is the
   * 1-1-1 the league's calendar spells out club by club (Boston @ San Francisco, San Francisco
   * @ Boston, Boston @ San Francisco, and Los Angeles @ New York the same way).
   *
   * ABSENT MEANS UNPUBLISHED, WHICH IS THE WHOLE CHAMPIONSHIP. Those five are listed as "WPBL
   * Championship Game #1" with no clubs on them, because the clubs are semifinal winners, and
   * the league has not said which end of the bracket bats last in which game. Do not fill them
   * in by extending the semifinals' pattern: a best-of-five is not a best-of-three, and a
   * guessed "@" is exactly the thing this list exists not to print.
   *
   * Every game is at one hub venue, so this is a batting order rather than a building.
   */
  home?: 'higher' | 'lower'
}

export const POSTSEASON_SCHEDULE: Record<string, PostseasonGame[]> = {
  'semifinal:A': [
    { game: 1, date: '2026-09-09', time: '6:00 PM', home: 'higher' },
    { game: 2, date: '2026-09-11', time: '5:00 PM', home: 'lower' },
    { game: 3, date: '2026-09-13', time: '2:00 PM', ifNecessary: true, home: 'higher' },
  ],
  'semifinal:B': [
    // Rain: the league moved this from 6:00 PM on the day. See DELAYED_STARTS in startTimes.ts,
    // which does the same to the feed's row for the surfaces that read a game rather than a series.
    { game: 1, date: '2026-09-10', time: '7:30 PM', home: 'higher' },
    { game: 2, date: '2026-09-12', time: '6:00 PM', home: 'lower' },
    { game: 3, date: '2026-09-14', time: '6:00 PM', ifNecessary: true, home: 'higher' },
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
  /** True once any postseason game has STARTED, which flips the card from a projection to a
   *  report. Deliberately not "has been played": the card stops projecting at first pitch. */
  started: boolean
  champion: WpblTeam | null
}

const isPlayed = (g: WpblGame): boolean =>
  g.status === 'final' && g.home_score != null && g.away_score != null

/** UNDER WAY IS NOT THE SAME QUESTION AS DECIDED, and conflating them keeps the pick'em open
 *  through the first pitch it exists to close. A game in progress adds nothing to any series
 *  record, so `isPlayed` is right for the wins, but a pairing has to register on a game that is
 *  merely live: otherwise a semifinal in its second inning still reads `upcoming` and the sheet
 *  still offers "who wins this series". */
const hasStarted = (g: WpblGame): boolean => g.status === 'live' || isPlayed(g)

/** Wins per club within one postseason pairing, and whether a ball has been thrown in it. */
interface SeriesTally {
  wins: Map<string, number>
  started: boolean
}

/**
 * Each postseason pairing's state.
 *
 * Keyed on the pair rather than on anything the feed says about rounds, for the reason in the
 * header. A pairing that is not part of the bracket we expect simply never gets looked up.
 */
function postseasonSeries(games: WpblGame[]): Map<string, SeriesTally> {
  const out = new Map<string, SeriesTally>()
  for (const g of games) {
    if (countsInStandings(g) || !hasStarted(g)) continue
    const key = pairKey(g.home_team_id, g.away_team_id)
    const tally = out.get(key) ?? { wins: new Map<string, number>(), started: false }
    if (isPlayed(g) && g.home_score! !== g.away_score!) {
      // A tie cannot decide a postseason game, so an equal score is not a win for anybody. It
      // should not happen; it must not silently credit the home side if it does.
      const winner = g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id
      tally.wins.set(winner, (tally.wins.get(winner) ?? 0) + 1)
    }
    // Set unconditionally so a game that is under way, or played and tied, still registers.
    tally.started = true
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
  // Under way with nothing decided yet, which is game 1 in progress. "Tied 0-0" is what the
  // score line says and not what a fan would: nobody is tied, the series has just begun.
  if (series.played === 0) return 'Game 1 under way'
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
  series: Map<string, SeriesTally>,
): BracketSeries {
  const bestOf = BEST_OF[round]
  const tally = home.team && away.team ? series.get(pairKey(home.team.id, away.team.id)) : undefined
  const homeWins = (home.team && tally?.wins.get(home.team.id)) || 0
  const awayWins = (away.team && tally?.wins.get(away.team.id)) || 0
  const played = homeWins + awayWins
  const need = winsNeeded(round)
  const winner = homeWins >= need ? home.team : awayWins >= need ? away.team : null

  const base = {
    round, key, label, bestOf,
    home: { team: home.team, seed: home.seed, wins: homeWins },
    away: { team: away.team, seed: away.seed, wins: awayWins },
    played,
    winner,
    // `played` counts DECIDED games, so a series whose game 1 is in progress has none of them
    // and is still under way. Reading the status off `played` is what kept the pick'em open.
    status: (winner ? 'done' : tally?.started ? 'live' : 'upcoming') as BracketSeries['status'],
  }
  return { ...base, summary: summarise(base) }
}

/**
 * The whole bracket, from the standings order and the schedule.
 *
 * Before the postseason this is a projection: the pairings the table would produce if the
 * season ended now, which is exactly what the seeding race is about. Once postseason games
 * start landing the same structure carries their series records, so the card does not have to
 * become a different card on the first day of the postseason.
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

  // The championship's entrants are the semifinal winners, and EACH seat fills the moment its own
  // semifinal is decided rather than waiting on the other. A club that has clinched is IN the final
  // with its opponent still reading "Semifinal B winner": a club that sweeps its semifinal 2-0
  // belongs in the championship box that day, not on the day the other semifinal ends. Blanking
  // both seats until both are known hides a clinched finalist for as long as the other series runs
  // (as much as five days).
  const champEntrant = (i: number) => {
    const w = semifinals[i].winner
    return w ? { team: w, seed: seeds.find(x => x.team.id === w.id)?.seed ?? null } : { team: null, seed: null }
  }
  const a = champEntrant(0), b = champEntrant(1)
  // Higher seed drawn first so the bracket does not swap sides once a lower seed wins, but only
  // once BOTH are known: with one seat still a placeholder there is nothing to order it against,
  // so semifinal A feeds the top (home) seat and B the bottom, which is the seat each one's
  // "Semifinal A/B winner" label and the connector already assume.
  const [first, second] = a.team && b.team
    ? [a, b].sort((x, y) => (x.seed ?? 99) - (y.seed ?? 99))
    : [a, b]

  const championship = buildSeries('championship', null, 'Championship', first, second, series)

  return {
    semifinals,
    championship,
    settled: bracketIsSet(seeds),
    started: [...series.values()].length > 0,
    champion: championship.winner,
  }
}

/** The champion, the club it beat, and the series score, in one place so every surface that
 *  names the champion (the Home banner, the Home season-recap card, the season page's champion
 *  block) reads the same facts off the same record rather than re-deriving which side won. Null
 *  until the final is decided, which is exactly when `bracket.champion` is set. */
export interface ChampionResult {
  champion: WpblTeam
  runnerUp: WpblTeam | null
  champWins: number
  rivalWins: number
}

/** The clubs that can still win the title: the champion alone once decided, otherwise every club
 *  not yet eliminated (a semifinal winner is through to the final; a semifinal still in progress
 *  leaves both its clubs alive). Empty when there is no bracket. Pure, so the dev season-finale
 *  simulator can pick a plausible champion off it on Home and the season page alike. */
export function aliveContenders(bracket: WpblBracket): WpblTeam[] {
  if (bracket.champion) return [bracket.champion]
  const out: WpblTeam[] = []
  const seen = new Set<string>()
  const add = (t: WpblTeam | null | undefined) => { if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t) } }
  for (const s of bracket.semifinals) {
    if (s.winner) add(s.winner)
    else { add(s.home.team); add(s.away.team) }
  }
  return out
}

export function championResult(bracket: WpblBracket): ChampionResult | null {
  const s = bracket.championship
  if (!s.winner) return null
  const champIsHome = s.winner.id === s.home.team?.id
  return {
    champion: s.winner,
    runnerUp: champIsHome ? s.away.team : s.home.team,
    champWins: champIsHome ? s.home.wins : s.away.wins,
    rivalWins: champIsHome ? s.away.wins : s.home.wins,
  }
}

/** The championship series games in date order, for the game logs on Home and the season
 *  recap. The two finalists meet only in the championship, so any postseason game between them is a title game. */
export function championshipGames(games: WpblGame[], aId: string, bId: string): WpblGame[] {
  return games
    .filter(g => !countsInStandings(g)
      && ((g.home_team_id === aId && g.away_team_id === bId) || (g.home_team_id === bId && g.away_team_id === aId)))
    .sort((x, y) => (x.game_date < y.game_date ? -1 : x.game_date > y.game_date ? 1 : 0))
}

/**
 * When Home's champion banner comes down: midnight at the end of the day AFTER the title was
 * clinched, in the reader's own zone. The banner is news, and news that stays up all offseason
 * stops being read as news, while the season card below it keeps the champion for good. Keyed on
 * the clinching game's date rather than a constant, so it comes back on its own next season.
 *
 * `game_date` is the league's calendar day, parsed as a LOCAL date on purpose: `new Date('2026-09-22')`
 * is UTC midnight, which is the previous evening anywhere in the Americas and would take a day
 * off the window. Null when there is no decided final to date it from.
 */
export function championBannerUntil(games: WpblGame[], result: ChampionResult): number | null {
  if (!result.runnerUp) return null
  const finals = championshipGames(games, result.champion.id, result.runnerUp.id).filter(g => g.status === 'final')
  const clincher = finals[finals.length - 1]
  const m = clincher?.game_date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 2).getTime()
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
  /** Higher seed first. This is seed order, never away-at-home: `homeSlot` is the only thing
   *  that says which of them bats last, and it is often null. */
  first: PostseasonSlot
  second: PostseasonSlot
  /**
   * Which seat the league has designated the home club, or null when nothing here can say.
   *
   * Null for three different reasons, and a surface treats all three the same by printing no
   * "@": the league has not published this game's home club (the championship), the two seats
   * hold clubs whose seed order is still open (`seedOrderTbd`, where "the higher seed bats
   * last" names nobody), or the round has no published designation at all.
   */
  homeSlot: 'first' | 'second' | null
}

/**
 * The two seats in the order a fixture is read: away over home where that is known, seed order
 * where it is not.
 *
 * One definition because three surfaces draw this row (the Schedule tab, the Home scoreboard
 * chip, the Next game card) and a postseason row that reads away-at-home on one of them and
 * seed-first on another is worse than either alone.
 */
export function postseasonSlots(
  row: Pick<PostseasonScheduleRow, 'first' | 'second' | 'homeSlot'>,
): { slots: [PostseasonSlot, PostseasonSlot]; homeKnown: boolean } {
  if (row.homeSlot === 'first') return { slots: [row.second, row.first], homeKnown: true }
  if (row.homeSlot === 'second') return { slots: [row.first, row.second], homeKnown: true }
  return { slots: [row.first, row.second], homeKnown: false }
}

/**
 * Which seat the mirrored calendar says bats last, or null when it cannot say.
 *
 * Null covers every way this can fail to mean anything, and all of them are ordinary: no
 * mirrored row for this game, a row the league has not put clubs on yet (the whole
 * championship until the semifinals end), a seat with no club named in it, and a pair of clubs
 * that are not the two clubs in front of us. The caller then falls back to the seat rule, which
 * is never wrong about a semifinal and simply silent about everything else.
 */
function siteHomeSlot(
  site: WpblSiteGame | undefined,
  first: PostseasonSlot,
  second: PostseasonSlot,
): 'first' | 'second' | null {
  if (!site?.home_team_id || !site.away_team_id) return null
  if (!first.team || !second.team) return null
  const pair = new Set([first.team.id, second.team.id])
  if (!pair.has(site.home_team_id) || !pair.has(site.away_team_id)) return null
  return site.home_team_id === first.team.id ? 'first' : 'second'
}

/**
 * The postseason as rows the schedule can print, before the feed has any games for it.
 *
 * WHY THE SCHEDULE NEEDS THESE AT ALL. `wpbl_games` has no postseason rows until the league
 * publishes the bracket, so without these the section's own schedule would say the season
 * stopped while the bracket card was already counting down to the first playoff game. These fill
 * that gap from the calendar the league published, and they retire themselves: a row is dropped
 * as soon as the feed carries a real postseason game on its date, so nothing has to be deleted
 * later and the real row is always the one that wins.
 *
 * SEEDS, NOT PROJECTED CLUBS. A slot names a club only once that exact seed can no longer move
 * (`bestPossible === worstPossible`, the same test `bracketIsSet` applies to the whole
 * bracket), and prints "1 seed" until then. The bracket card is free to project because it
 * reads as a projection; a schedule reads as fact, and a fan who screenshots "Firebells at
 * Heights" before the seeds are set has been told something we do not know. The seed line is
 * true on the day it is written and stays true.
 *
 * AWAY AT HOME WHERE THE LEAGUE HAS SAID SO, SEED ORDER WHERE IT HAS NOT. Every other card in
 * the schedule is "away @ home" because the feed says which is which. Before the feed carries a
 * postseason row, the league's own schedule page already designates a home club for all six
 * semifinal games: the higher seed bats last in games 1 and 3, the lower seed in game 2. That
 * lives on `POSTSEASON_SCHEDULE` as a seat rather than a club, so it is true before the seeds
 * are, and it reaches a surface through `homeSlot` and `postseasonSlots`.
 *
 * TWO SOURCES FOR THAT, IN ORDER, and the order is the point. `siteGames` is the league's own
 * calendar as mirrored last night (`wpbl_site_games`), which names actual clubs and is the only
 * thing that will ever know the CHAMPIONSHIP's home clubs, since those games are published with
 * no clubs on them until the semifinals end. `POSTSEASON_SCHEDULE`'s own `home` seat is the
 * fallback, and it is not merely a stale copy of the same thing: it is expressed as "the higher
 * seed" rather than as a club, so it still answers when the mirror is empty, when a row cannot
 * be matched, and on any render that happens before the mirror has been read.
 *
 * A row whose two seats are settled as a PAIRING but not as seeds gets a designation from
 * neither: "the higher seed bats last" names nobody until there is a higher seed, and the
 * mirror's clubs cannot be assigned to seats we cannot put in order. It prints seed order with
 * no `@`. There is one hub venue, so no club has a home park: "home" here only ever means who
 * bats last.
 */
export function postseasonScheduleRows(
  rows: WpblStandingRow[],
  games: WpblGame[],
  /** The league's website calendar, mirrored. Optional, and every surface works without it:
   *  see the two-sources note above. */
  siteGames: WpblSiteGame[] = [],
): PostseasonScheduleRow[] {
  const seeds = seedingRace(rows, games)
  if (seeds.length < 4) return []

  // The mirrored calendar, keyed the way this file addresses a game. Only a postseason row
  // carries a round, so a regular-season row cannot collide with one.
  const siteByGame = new Map<string, WpblSiteGame>()
  for (const g of siteGames) {
    if (g.round && g.game_number != null) {
      siteByGame.set(`${g.round}:${g.series_key ?? '-'}:${g.game_number}`, g)
    }
  }

  // A seed names a club only when it has CLINCHED it, which `clinchedSeeds` decides. Per seed,
  // not per bracket: the top seed routinely locks days before the bottom two stop swapping, and
  // holding every slot vague until the whole bracket settles would say less than we know.
  //
  // THE TIEBREAK LIVES IN seeding.ts, next to the standings rule it has to agree with. A local
  // rule that resolves a rival only on wins and treats any possible tie as open is right for a
  // magic number and wrong for a clinch: a club that holds the head-to-head tiebreak has clinched
  // even while a rival can still tie its record.
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
   * A PAIRING CLOSES BEFORE ITS SEEDS DO. With the 1 and 4 seeds clinched and two clubs still
   * disputing 2 and 3, those two are certain to play EACH OTHER, because 2v3 is the whole of the
   * other semifinal; but neither has clinched a seed, so the per-seed rule above would print "2
   * seed" against "3 seed" and say less than the standings already know.
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
      const site = siteByGame.get(`${round}:${key ?? '-'}:${g.game}`)
      // The league's calendar is live where this constant is a snapshot of it, so where the two
      // disagree about when a game starts, the calendar is right. A moved game is the one thing
      // a hardcoded date cannot survive and the one nobody would notice.
      const date = site?.game_date ?? g.date
      const time = site?.start_time ?? g.time
      if (feedDates.has(date)) continue
      // An if-necessary game that is no longer necessary. Once a series is won its game 3 (or
      // its games 4 and 5) will not be played, and leaving them on the calendar is the one way
      // this list can state something that is not merely unknown but false.
      if (g.ifNecessary && decided) continue
      // The other end of the same fact: with every game before it played and the series still
      // alive, an if-necessary game is necessary. In a best-of-N that is exactly the moment it
      // becomes certain, and it matters beyond the label, because the scoreboard strip has room
      // for four fixtures and spends them on games it can promise.
      const forced = !decided && (series?.played ?? 0) >= g.game - 1
      // "The higher seed bats last" needs a higher seed. With the pairing settled and the seeds
      // inside it still open, `first` and `second` are a projection, so applying either source's
      // designation to them would print an "@" against a coin toss.
      //
      // The mirror wins where it can be applied, because it names clubs: it is the only thing
      // that will know the championship's home club, and the only thing that would notice the
      // league swapping one. It applies only when its two clubs ARE these two seats, so a row
      // that has drifted out of agreement with the bracket falls back to the seat rule rather
      // than contradicting the clubs printed beside it.
      const seatHome = !g.home ? null : g.home === 'higher' ? 'first' : 'second'
      const homeSlot = seedOrderTbd ? null : (siteHomeSlot(site, first, second) ?? seatHome)
      out.push({
        id: `ps:${round}:${key ?? '-'}:${g.game}`,
        date, time, round, key, label,
        gameNumber: g.game, ifNecessary: !!g.ifNecessary && !forced,
        seedOrderTbd,
        first, second, homeSlot,
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
