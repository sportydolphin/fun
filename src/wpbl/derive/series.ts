import type { WpblGame, WpblTeam } from '../types'
// A runtime import, so it carries `.ts`: this module is loaded by Deno as well as by Vite
// (supabase/functions/wpbl-ingest announces a final straight to Discord, and that message is
// series-aware). Type-only imports are erased before resolution and stay extensionless.
// Same reason recap.ts and routes.ts carry the extension. For that same reason NOTHING here
// may import constants.ts, which pulls the club logos in as Vite assets.
import { countsInStandings } from '../season.ts'

// What series a postseason game belongs to, and where that series stands.
//
// WHY THIS IS SEPARATE FROM bracket.ts, which already groups postseason games by pairing.
// That module answers "draw me the bracket": it takes the standings, fills four slots, and
// reports three series. This one answers the question every OTHER surface has, which is the
// opposite way round: given ONE game, what series is it, which game of it is this, and what
// is the record. A schedule row, a Game Center header, a recap and a Discord post all need
// that and none of them has a standings table in hand. bracket.ts builds on the round
// definitions below rather than the other way about, so there is one statement of the format.
//
// THE POSTSEASON IS SERIES-SHAPED AND ALMOST NOTHING ELSE IN THE SECTION WAS. "SF leads 2-1"
// is the unit a fan tracks, and until this module a best-of-five clincher was recapped as
// "the Firebells beat the Queens 4-2" with no notion that a championship had just been won.
//
// NO SERIES ID IS NEEDED, and waiting for one is what kept this filed as blocked. The
// postseason is the only part of the schedule `countsInStandings` rejects, and within it an
// unordered pair of team ids identifies a series uniquely: the semifinals are 1v4 and 2v3, the
// championship is the two winners, and no two of those three pairings can be the same two
// clubs. So grouping by team pair reconstructs every series with no new field, whatever the
// feed decides to call them.
//
// IT FAILS TOWARD THE REGULAR SEASON, which is what the roadmap asks of anything written
// before Sep 9. Every function here returns null or an empty map when the feed marks no game
// as postseason, so every surface renders exactly as it does today rather than inventing a
// series. The disagreement itself is watched by scripts/check-wpbl-postseason.ts.
//
// Pure: games and teams in, plain shapes out. No supabase, no React.

/** The two rounds a WPBL postseason has. Four clubs, so there is no wild card and no division. */
export type BracketRound = 'semifinal' | 'championship'

/** Semifinals are best-of-three, the championship best-of-five (format confirmed Aug 16). */
export const BEST_OF: Record<BracketRound, number> = { semifinal: 3, championship: 5 }

/** Games a club must win to take the series: 2 of 3, 3 of 5. */
export const winsNeeded = (round: BracketRound): number => Math.floor(BEST_OF[round] / 2) + 1

/** An unordered pair of team ids, as a stable key. */
export const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

const isPlayed = (g: WpblGame): boolean =>
  g.status === 'final' && g.home_score != null && g.away_score != null

/** The winner of a decided game, or null for a tie or an unplayed one. A tie cannot decide a
 *  postseason game; it must not silently credit the home side if the feed ever reports one. */
function winnerOf(g: WpblGame): string | null {
  if (!isPlayed(g) || g.home_score === g.away_score) return null
  return g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id
}

/**
 * Every postseason pairing, with its games in the order they are played.
 *
 * Ordered by date first. Within this bracket no series ever plays twice on one day, so the
 * date IS the order and `start_time` and the id are only there to make the sort total: an
 * unstable order would renumber the games of a series between two renders of the same page.
 */
export function postseasonPairings(games: WpblGame[]): Map<string, WpblGame[]> {
  const out = new Map<string, WpblGame[]>()
  for (const g of games) {
    if (countsInStandings(g)) continue
    const key = pairKey(g.home_team_id, g.away_team_id)
    const list = out.get(key)
    if (list) list.push(g)
    else out.set(key, [g])
  }
  for (const list of out.values()) {
    list.sort((a, b) =>
      a.game_date.localeCompare(b.game_date)
      || (a.start_time ?? '').localeCompare(b.start_time ?? '')
      || a.id.localeCompare(b.id))
  }
  return out
}

/**
 * Which round each pairing is, worked out from the shape of the bracket rather than from
 * dates or from anything the feed says.
 *
 * A club that reaches the championship plays in TWO postseason pairings; one knocked out in
 * the semifinals plays in one. So the championship is the pairing both of whose clubs appear
 * in more than one pairing, and there can only ever be one such pairing. That holds however
 * the league labels its rounds, and it holds for a championship whose games are all still
 * scheduled, because the pairing exists as soon as the rows do.
 *
 * Deliberately NOT keyed on the published dates. A postseason game moves far more than a
 * regular-season one (see the note on the Discord event sync), and a rescheduled semifinal
 * that slid past the championship's published start would relabel itself.
 */
export function postseasonRounds(games: WpblGame[]): Map<string, BracketRound> {
  return roundsFrom(postseasonPairings(games))
}

/** The rule itself, over pairings already grouped, so a caller doing every game at once does
 *  not regroup the schedule per row. */
function roundsFrom(pairings: Map<string, WpblGame[]>): Map<string, BracketRound> {
  const appearances = new Map<string, number>()
  for (const key of pairings.keys()) {
    for (const teamId of key.split('|')) appearances.set(teamId, (appearances.get(teamId) ?? 0) + 1)
  }
  const out = new Map<string, BracketRound>()
  for (const key of pairings.keys()) {
    const both = key.split('|').every(teamId => (appearances.get(teamId) ?? 0) > 1)
    out.set(key, both ? 'championship' : 'semifinal')
  }
  return out
}

export interface SeriesContext {
  round: BracketRound
  /** "Semifinal" / "Championship". No A or B: a single game has no bracket to be placed in,
   *  and the two semifinals are told apart by who is playing, which is on screen already. */
  label: string
  bestOf: number
  /** 1-based position of this game in its series.
   *
   *  It can exceed `bestOf`, and "Game 4 of 3" on screen is a real signal rather than a
   *  rendering fault: it means the pairing has picked up a game that is not part of the
   *  series, which in this mirror means a duplicate row (the feed publishes a timezone twin of
   *  every game and the ingest de-duplicates them; see the note in wpbl-ingest). Left
   *  un-clamped on purpose. Clamping would hide a doubled row behind a plausible number, and
   *  the same doubling is also silently inflating the series record beside it. */
  gameNumber: number
  /** Series wins for this GAME's home and away club, through this game: including it once it
   *  is final, and only the games before it while it is not. That is what each surface wants
   *  without having to ask: a box score reports the series as it stands after the game it is
   *  reporting, a schedule row previews the one about to be played. */
  homeWins: number
  awayWins: number
  /** The series is decided, and this game is the one that decided it. */
  clinched: boolean
  /** Set only on a clincher. */
  seriesWinner: WpblTeam | null
  /** The one line a fan would say: "Firebells lead 2-1", "Series tied 1-1", "Firebells win
   *  the championship 3-2". Null before a series has a decided game, where the record says
   *  nothing the label and the game number have not already said. */
  line: string | null
  /** What is at stake, for a game not yet final: "Firebells can clinch", "Winner takes the
   *  championship". Null once the game is played, and null when nothing is on the line yet. */
  stakes: string | null
  /** The same fact as `line`, written as a sentence for the middle of a recap: "Firebells
   *  lead the semifinal 2-1.", "Firebells are WPBL champions, taking the final 3-1."
   *
   *  A SECOND WORDING RATHER THAN A REUSE, because the two are read in different places and a
   *  chip is not a sentence. `line` sits under a schedule row where the label beside it
   *  already says which series it is; this one is appended to a paragraph that has said
   *  nothing about a series and has to name the round itself. Both live here so a clincher
   *  cannot be worded one way on the site and another way in the Discord channel. */
  sentence: string | null
}

const roundLabel = (round: BracketRound): string =>
  round === 'championship' ? 'Championship' : 'Semifinal'

/** "the championship" / "the semifinal", for the middle of a sentence. */
const roundNoun = (round: BracketRound): string =>
  round === 'championship' ? 'the championship' : 'the series'

/**
 * Where this game's series stands, or null when the game is not a postseason game.
 *
 * `games` must be the WHOLE schedule. A series record cannot be read off one row, in exactly
 * the way a season total cannot: the game carries its own two clubs and its own result, and
 * the record is a fact about the games around it.
 */
export function seriesContext(
  game: WpblGame,
  games: WpblGame[],
  teams: Map<string, WpblTeam>,
): SeriesContext | null {
  if (countsInStandings(game)) return null
  const key = pairKey(game.home_team_id, game.away_team_id)
  const pairings = postseasonPairings(games)
  const inSeries = pairings.get(key)
  // The game is postseason but the schedule handed in does not contain it. A caller holding a
  // partial schedule, which is the shape of every bug this could have, gets nothing rather
  // than a record computed from a fraction of the series.
  if (!inSeries || !inSeries.some(g => g.id === game.id)) return null
  return contextIn(game, inSeries, roundsFrom(pairings).get(key) ?? 'semifinal', teams)
}

/** The reading itself, given the series this game is already known to belong to. */
function contextIn(
  game: WpblGame,
  inSeries: WpblGame[],
  round: BracketRound,
  teams: Map<string, WpblTeam>,
): SeriesContext {
  const bestOf = BEST_OF[round]
  const need = winsNeeded(round)
  const gameNumber = inSeries.findIndex(g => g.id === game.id) + 1

  // Games up to and including this one. A game that is not final contributes nothing, so the
  // same slice serves both readings and there is no second code path to get wrong.
  const through = inSeries.slice(0, gameNumber)
  let homeWins = 0, awayWins = 0
  for (const g of through) {
    const w = winnerOf(g)
    if (w === game.home_team_id) homeWins++
    else if (w === game.away_team_id) awayWins++
  }

  const home = teams.get(game.home_team_id) ?? null
  const away = teams.get(game.away_team_id) ?? null
  const [lead, leadWins, trailWins] = homeWins >= awayWins
    ? [home, homeWins, awayWins] as const
    : [away, awayWins, homeWins] as const

  const decided = leadWins >= need
  // Only THIS game can have clinched it: `through` ends here, so the series reaching `need`
  // within it and this game being final is the same statement.
  const clinched = decided && isPlayed(game)

  let line: string | null = null
  if (clinched && lead) line = `${lead.name} win ${roundNoun(round)} ${leadWins}-${trailWins}`
  else if (leadWins === 0 && trailWins === 0) line = null
  else if (homeWins === awayWins) line = `Series tied ${homeWins}-${awayWins}`
  else if (lead) line = `${lead.name} lead ${leadWins}-${trailWins}`

  // What a win tonight would settle. Both clubs can be one win away at once (a deciding game),
  // and saying it once from the series' point of view beats saying it twice from each club's.
  let stakes: string | null = null
  if (!isPlayed(game)) {
    const homeCanClinch = homeWins + 1 >= need
    const awayCanClinch = awayWins + 1 >= need
    if (homeCanClinch && awayCanClinch) {
      stakes = round === 'championship' ? 'Winner takes the championship' : 'Winner takes the series'
    } else if (homeCanClinch && home) {
      stakes = `${home.name} can clinch`
    } else if (awayCanClinch && away) {
      stakes = `${away.name} can clinch`
    }
  }

  // The prose form. A clincher is the one case that earns a fact the game score cannot carry
  // at all: without this a best-of-five decider was recapped as "the Firebells top the Queens"
  // to a Discord channel and a Bluesky feed, on the night the league crowned a champion.
  let sentence: string | null = null
  const round_ = roundLabel(round).toLowerCase()
  if (clinched && lead) {
    sentence = round === 'championship'
      ? `${lead.name} are WPBL champions, taking the final ${leadWins}-${trailWins}.`
      : `${lead.name} take the semifinal ${leadWins}-${trailWins} and go to the championship.`
  } else if (leadWins === 0 && trailWins === 0) {
    sentence = null
  } else if (homeWins === awayWins) {
    sentence = `The ${round_} is tied ${homeWins}-${awayWins}.`
  } else if (lead) {
    sentence = `${lead.name} lead the ${round_} ${leadWins}-${trailWins}.`
  }

  return {
    round,
    label: roundLabel(round),
    bestOf,
    gameNumber,
    homeWins,
    awayWins,
    clinched,
    seriesWinner: clinched ? lead : null,
    line,
    stakes,
    sentence,
  }
}

/**
 * The same thing for a whole schedule at once, keyed by game id.
 *
 * The Schedule renders every row, and `seriesContext` regroups the schedule on each call. One
 * pass over the postseason instead of one per row: it is a handful of games either way, but a
 * list view calling an O(n) derive per row is the shape that stops being a handful later.
 */
export function seriesContexts(
  games: WpblGame[],
  teams: Map<string, WpblTeam>,
): Map<string, SeriesContext> {
  const pairings = postseasonPairings(games)
  const rounds = roundsFrom(pairings)
  const out = new Map<string, SeriesContext>()
  for (const [key, inSeries] of pairings) {
    const round = rounds.get(key) ?? 'semifinal'
    for (const g of inSeries) out.set(g.id, contextIn(g, inSeries, round, teams))
  }
  return out
}
