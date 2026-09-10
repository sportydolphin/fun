import {
  WPBL_AWARDS, WPBL_MANAGERS, WPBL_ARM_ORDER_LAST, WPBL_GLOVE_SHORTLIST, WPBL_AURA_SHORTLIST,
  playChoiceKey,
  type AwardSlate, type WpblAward, type WpblNominee,
} from '../awards'
import { regularSeasonLines, countsInStandings } from '../season'
import { outsToIp } from '../innings'
import { buildPositionIndex, displayPositionFromIndex, positionsPlayed } from '../positions'
import { aggregateBatting, aggregatePitching, plateAppearances, sumFielding, wpblQualifiers, QUALIFY_FLOOR_PA } from '../stats'
import type { WpblBattingTotals, WpblFieldingTotals, WpblPitchingTotals } from '../stats'
import type { MvpRace } from './mvpRace'
import { fmtWinPct, type GameWinProb } from './winProbability'
import type { TrackingBoard } from '../tracking'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay,
  WpblTeam,
} from '../types'

/**
 * The shortlists behind the fan awards ballot.
 *
 * A SHORTLIST IS NOT A RANKING. It is a seed, and the search under every player category is
 * what says so to the reader: a vote for anyone in the league is one field away. Six
 * names is what a ballot line can hold before it becomes a table nobody reads, and the
 * open-field categories exist for the questions where offering six would be inventing an
 * opinion the data does not have.
 *
 * NOTHING HERE INVENTS A NUMBER. Every seeded category reuses a figure the section already
 * publishes: the MVP race for value, the run-expectancy table for runs saved, the win model
 * for plays and games, the qualifier bar for who counts as a regular. Two surfaces disagreeing
 * about the same player is the failure this section spends the most comment on avoiding, and a
 * ballot is the worst place to introduce it, since a vote cast on one number is settled
 * forever.
 *
 * POSTSEASON IS OUT of every total, because these are the regular-season awards and because
 * the ballot opens while the playoffs are running: a shortlist that moved between a voter
 * seeing it and voting on it would be worse than a stale one. Filtering runs through
 * `regularSeasonLines`, the section's one definition.
 *
 * PURE: arrays in, plain shapes out, no supabase and no React.
 */

/**
 * A figure on a candidate's card, as a label over a value.
 *
 * SEPARATE FROM `line`, WHICH STAYS. `line` is one sentence and is what a compact row shows; a
 * card has room for two or three numbers stacked, which is a different job. Both are formatted
 * here rather than in the component, for the reason this whole file exists: a ballot that
 * rounded a number differently from the board it came from would be the section disagreeing
 * with itself in the one place a disagreement is settled forever.
 */
export interface AwardStat {
  label: string
  value: string
  /**
   * Set when `value` is an ERA-BASIS FIGURE, which this module is not allowed to have the last
   * word on. `era` and `k9` are stored on whatever basis the league publishes (per seven since
   * Sep 3, 2026) and a reader can flip that in settings, so the app rescales at DISPLAY time.
   * This file is pure: no React, no context, no reader. It therefore emits the stored number
   * here and a canonical-basis string in `value` as the fallback, and the view formats it with
   * `useEraBasis().fmtEra`. See ERA_BASIS_CANONICAL in stats.ts and the note in armSlate.
   */
  eraBasisValue?: number | null
}

/** One name on a ballot line. `key` is what gets stored in `wpbl_award_votes.choice`. */
export interface AwardCandidate {
  key: string
  name: string
  /** The club to show beside her, which is "now" for a player and "then" for a play or a
   *  game. A player's roster row is the right answer for a season award: the badge should be
   *  the shirt she is wearing while the vote is open. A play belongs to the night it happened
   *  and takes its club from the game. See the trade note in CLAUDE.md. */
  teamId: string | null
  /** Set for a player pick, so a surface can draw a portrait and link to her page. */
  playerId: string | null
  /** The figure that put her on the list, already formatted. Empty on an open field. */
  line: string
  /** A second line where the first is not enough on its own: the game a play came from. */
  sub?: string
  /** Set for a game or play pick, so the card can link to Game Center. */
  gameId?: string
  sequence?: number
  /** Two or three figures for the card layout. Absent on the open-field slates, where the whole
   *  point is that the data has no opinion and printing a number would invent one. */
  stats?: AwardStat[]
}

export interface AwardBallotEntry {
  award: WpblAward
  candidates: AwardCandidate[]
  /** The figures for anybody the shortlist did not card, so a write-in reads like the names
   *  beside it. Gives nothing back on a question that cards nobody on numbers. See
   *  awardStatsLookup. */
  statsFor: (playerId: string) => AwardStat[]
}

export interface AwardGameWinProb {
  game: WpblGame
  wp: GameWinProb
}

export interface AwardBallotInput {
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  fielding: WpblFieldingLine[]
  /** The MVP race, which already prices both sides of the ball off one table. Absent until
   *  the play log has been fetched, which is a deferred read on every surface that uses it. */
  mvp?: MvpRace | null
  /** One entry per final game, priced by the win model. Absent for the same reason. */
  winProb?: readonly AwardGameWinProb[] | null
  /** Absent whenever the league is not publishing radar, which is most of the time. */
  tracking?: TrackingBoard | null
  /** The play log, for the one thing a fielding line cannot say: whether a catcher threw
   *  anybody out. Absent until it has been fetched, the same as `mvp`. */
  plays?: readonly WpblRunValuePlay[] | null
}

/** What a catcher did against the running game, which is the whole of her defensive case and
 *  is nowhere in her fielding row. */
export interface CatcherArm {
  caught: number
  attempts: number
}

/**
 * Caught stealing per catcher, read off the play log.
 *
 * NOT IN THE BOX SCORE AT ALL. The feed's fielding row is `po, a, e, dp, pb, sba, ci`: `sba`
 * counts the attempts against her and nothing counts the ones she ended. A catcher's throw shows
 * up in her assist total, mixed in with every other throw she made, so the two cannot be
 * separated there. The play log can: it spells the throw path out, and a caught stealing that
 * starts at the plate reads "out at second c to 2b, caught stealing". Twelve of the fifteen
 * caught stealings in the 2026 regular season were hers to claim; the other three start at `p`
 * and are pickoffs, which belong to the pitcher.
 *
 * THE NARRATIVE NAMES THE RUNNER, NEVER THE THROWER, so the catcher comes from the lineup: the
 * one player on the fielding club with `c` on her batting line that game, or nobody. An
 * unambiguous single hit or nothing, the same rule the slate itself uses for names, because a
 * game with two catchers in it cannot say which of them made the throw.
 */
export function catcherArms(
  plays: readonly WpblRunValuePlay[],
  batting: WpblBattingLine[],
  fielding: WpblFieldingLine[],
  games: WpblGame[],
): Map<string, CatcherArm> {
  const gm = new Map(games.map(g => [g.id, g]))
  const catcherOf = new Map<string, string | null>()
  for (const b of regularSeasonLines(batting, games)) {
    if (!String(b.position ?? '').split('/').some(x => x.trim().toLowerCase() === 'c')) continue
    const k = `${b.game_id}|${b.team_id}`
    catcherOf.set(k, catcherOf.has(k) && catcherOf.get(k) !== b.player_id ? null : b.player_id)
  }
  const out = new Map<string, CatcherArm>()
  const bump = (id: string, k: keyof CatcherArm, n = 1) => {
    const a = out.get(id) ?? { caught: 0, attempts: 0 }
    a[k] += n; out.set(id, a)
  }
  for (const l of regularSeasonLines(fielding, games)) if (l.sba) bump(l.player_id, 'attempts', l.sba)
  for (const p of regularSeasonLines([...plays] as WpblRunValuePlay[], games)) {
    const n = p.narrative ?? ''
    if (!/caught stealing/i.test(n) || !/out at \w+ c to /i.test(n)) continue
    const g = gm.get(p.game_id); if (!g) continue
    // A play's `team_id` is the BATTING side, so the fielding club is the other one.
    const fieldingClub = p.team_id === g.home_team_id ? g.away_team_id : g.home_team_id
    const c = catcherOf.get(`${p.game_id}|${fieldingClub}`)
    if (c) bump(c, 'caught')
  }
  return out
}

/**
 * Four names, or eight where the thing being picked is a moment rather than a person: a play
 * shortlist is drawn from 30 games and one per club per week is the least it can be.
 *
 * FOUR BECAUSE MANAGER OF THE YEAR IS FOUR AND CANNOT BE ANYTHING ELSE. That category is the
 * league's four clubs, a slate rather than a shortlist, so it sets the shape of the sheet
 * whether or not the others agree with it. At six the ballot alternated three rows of tiles
 * with two rows and back, and the odd one out was the only category a reader could not scroll
 * past without noticing. Four also fills the two-column grid exactly, which six does and eight
 * does, but four does in half the height: five questions at six names each is a sheet nobody
 * reaches the bottom of.
 *
 * It costs the tail of each list, which is the half nobody was voting for anyway. The search
 * under every player category takes a vote for anyone in the league, so a name off the four is
 * one field away rather than unavailable.
 */
const SHORTLIST = 4
const MOMENT_SHORTLIST = 8

/** Enough of a season to be a baserunner rather than to have run once. */
const WHEELS_MIN_SB = 2

/** Two positions is a platoon. Three is a story. */
const UTILITY_MIN_POSITIONS = 3

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** A batting average the way every board in this section prints one: three places, no leading
 *  zero. Here rather than imported so the ballot cannot drift from them by a rounding. */
const fmtAvg = (v: number | null): string =>
  v == null ? '—' : v.toFixed(3).replace(/^0\./, '.')

/** Positions read back as a fan writes them: "C, 1B, LF". */
const prettyPositions = (pos: readonly string[]): string => pos.map(p => p.toUpperCase()).join(', ')

/**
 * Build the whole ballot.
 *
 * A category whose shortlist comes back empty is DROPPED rather than rendered blank. Most of
 * them can only be empty before the season has data, but two of them (`cannon`, `contact`)
 * are empty whenever the league has stopped publishing tracking, which is a normal state
 * rather than an outage, and an award nobody can be nominated for is worse than an award that
 * is not offered.
 */
export function buildAwardBallot(input: AwardBallotInput): AwardBallotEntry[] {
  const out: AwardBallotEntry[] = []
  // Built once, up front, because Pitcher of the Year is defined partly by who MVP already
  // took (see armSlate). Reused for the MVP award itself rather than recomputed, so the two
  // cannot disagree about who is on it, which is the whole basis of the dedupe.
  const mvp = mvpSlate(input)
  const mvpKeys = new Set(mvp.map(c => c.key))
  const where = positionLabeller(input)
  const statsFor = awardStatsLookup(input)
  for (const award of WPBL_AWARDS) {
    const candidates = award.slate === 'mvp' ? mvp : slateFor(award.slate, input, mvpKeys)
    if (candidates.length === 0) continue
    out.push({ award, candidates: candidates.map(c => where(award, c)), statsFor: statsFor(award) })
  }
  return out
}

/**
 * The position under the name, which is the one fact about a player a stat line cannot carry.
 *
 * WHY IT IS HERE AND NOT IN EVERY BUILDER. A card says who she is and what she did, and eight
 * of these slates were saying only the second half: four batting averages side by side do not
 * tell a reader that one of them is a catcher and another is the club's shortstop. It is one
 * pass over the finished ballot rather than a line in each builder, because it is the same
 * answer everywhere and a builder that forgot it would be invisible.
 *
 * FROM THE BOX SCORES, NOT THE ROSTER LISTING, via the same `positions.ts` the player page, the
 * unfurl card and the Discord card all use. Two clubs' worth of players are filed somewhere they
 * have not played all season, and a ballot that disagreed with the player page it links to would
 * be the section arguing with itself.
 *
 * "P / CF" IS THE TWO-WAY HALF, AND MVP IS THE REASON IT EXISTS. The MVP race prices runs added
 * at the plate plus runs saved on the mound, so a two-way player is on that shortlist partly for
 * her pitching, and the card then shows her a hitter's line and nothing else: Kelsie Whitmore
 * reads as an outfielder who hits, which is half of her case. The tile has no room for a sixth
 * figure and mixing a K into a row of batting figures is worse than not showing it, since K at
 * the plate and K on the mound are opposite facts spelled the same. So the position says it in
 * four characters and the reader can open her page for the rest.
 *
 * THE MOUND LEADS, ON EVERY AWARD, because it is the half no stat line on this sheet can carry.
 * A row of batting figures cannot show it and a row of fielding figures shows her at the position
 * she plays when she is not pitching, so on both the "P" is the new information and the other
 * code is the one the numbers beside it have already implied. One order everywhere, too: the same
 * player is carded on more than one question here, and a label that reordered itself per award
 * would read as two different facts about her. This is a narrower question than
 * `leadsWithPitching` in positions.ts answers, which decides which half of a whole player page to
 * open on and gets to weigh a season. Four characters on a ballot tile only point at what is
 * missing.
 *
 * NOT ON PITCHER OF THE YEAR, where every candidate is a pitcher and "P" under four names in a
 * row is a column of noise.
 */
function positionLabeller(input: AwardBallotInput) {
  const index = buildPositionIndex(input.batting, input.games)
  const byId = new Map(input.players.map(pl => [pl.id, pl]))
  // Any real work on the mound. A position player who recorded an out in a blowout is not a
  // two-way player, and `gs` is what tells them apart: see leadsWithPitching in positions.ts.
  const pitched = new Set(
    input.pitching.filter(l => (l.gs ?? 0) > 0 || (l.outs ?? 0) >= 9).map(l => l.player_id),
  )
  return (award: WpblAward, c: AwardCandidate): AwardCandidate => {
    // A `sub` a builder already wrote outranks this: it is a fact the figures cannot carry
    // either, and the tile draws one line, not two.
    if (award.pick !== 'player' || award.slate === 'arm' || c.sub || !c.playerId) return c
    const player = byId.get(c.playerId)
    if (!player) return c
    const label = displayPositionFromIndex(player, index).label
    if (!label) return c
    const twoWay = pitched.has(c.playerId) && !/P/i.test(label)
    return { ...c, sub: twoWay ? `P / ${label}` : label }
  }
}

function slateFor(
  slate: AwardSlate, input: AwardBallotInput, mvpKeys: ReadonlySet<string>,
): AwardCandidate[] {
  switch (slate) {
    case 'mvp':         return mvpSlate(input)
    case 'arm':         return armSlate(input, mvpKeys)
    case 'glove':       return gloveSlate(input)
    case 'play':        return playSlate(input)
    case 'game':        return gameSlate(input)
    case 'wheels':      return wheelsSlate(input)
    case 'toughestOut': return toughestOutSlate(input)
    case 'workhorse':   return workhorseSlate(input)
    case 'utility':     return utilitySlate(input)
    case 'cannon':      return cannonSlate(input)
    case 'contact':     return contactSlate(input)
    case 'manager':     return managerSlate(input)
    case 'aura':        return auraSlate(input)
    case 'everyone':    return everyoneSlate(input)
  }
}

// ── Value, from the race that already prices it ─────────────────────────────────

/**
 * The figures a player is carded on, chosen by what she actually does. A hitter gets the
 * slash-line facts a fan argues with, a pitcher gets the mound ones, and a two-way player gets
 * one of each.
 *
 * NO RUNS-VALUE FIGURE ANYWHERE ON THIS BALLOT, which is the same call the pitcher slate makes
 * and for the same two reasons. "RUNS ADDED" is twice the width of AVG or HR, so as the first
 * column of the row it set the spacing for every figure beside it. And it is priced off our own
 * run-expectancy table: this is the friendliest surface in the section, the one place a reader
 * who does not follow the league is asked to have an opinion, and leading every card with a
 * number almost nobody outside the site can read is the wrong first impression. The shortlist is
 * still ORDERED by it, which is worth more here than printing it. This is not the earlier mistake of carding everyone on the sort figure alone; it
 * is the opposite, and it leaves the cards saying more rather than less.
 *
 * A TWO-WAY PLAYER IS THE ONE REAL LOSS, and it is paid rather than ignored. Total/Bat/Arm split
 * her season in half, which is the whole argument for her, and short labels meant she never had
 * the width problem. But they are still three run-value numbers. A bat figure beside an arm
 * figure makes the same case in stats a beginner already owns, so HR AND K LEAD, in that order:
 * the display drops to two figures on a phone, so those two are the ones that survive, and one
 * of each is exactly the thing being claimed. AVG and IP fill the desktop row behind them.
 */
function valueStats(
  bat: { avg: number | null; hr: number; ops: number | null; sb: number; rbi: number } | undefined,
): AwardStat[] {
  // ONE LINE FOR EVERY NAME ON THIS AWARD, IN THE ORDER A FAN READS THEM. MVP is a hitters-only
  // slate now (see mvpSlate), so there is no second shape to switch on and no reason for two
  // candidates on one grid to be carded on different things: comparing them is the entire task,
  // and a reader cannot compare .451 against 26.2 IP. AVG then HR is the pair that survives to
  // a phone, which is why they lead.
  //
  // RBI IS LAST, AND THAT IS THE WHOLE ORDERING DECISION. The tile shows three figures on a
  // phone and five above it, so position IS priority: whatever sits in the first three is what
  // most readers will ever see. RBI is the least informative of the five, since it prices the
  // lineup batting in front of her as much as the hitter herself, so it takes the slot that
  // only appears where there is room to spare.
  return bat ? [
    { label: 'AVG', value: fmtAvg(bat.avg) },
    { label: 'HR', value: String(bat.hr) },
    { label: 'OPS', value: fmtAvg(bat.ops) },
    { label: 'SB', value: String(bat.sb) },
    { label: 'RBI', value: String(bat.rbi) },
  ] : []
}

/**
 * MVP, from the race that already prices value, minus the pitchers.
 *
 * HITTERS ONLY, BECAUSE THE PITCHERS HAVE THEIR OWN AWARD ON THE SAME BALLOT. The race ranks
 * everybody by runs added plus runs saved, so a reliever having a good season outranks most of
 * the league's hitters and the MVP shortlist filled up with the same arms carded two questions
 * further down. Five questions that keep returning the same four names read as one question
 * asked five ways.
 *
 * `bat >= arm` rather than "has at-bats": the test is which half of the game she is being VALUED
 * for, so a two-way player whose bat carries her stays (Kelsie Whitmore is exactly this, and
 * belongs on an MVP ballot), while a pitcher who has taken a few swings does not sneak back in.
 *
 * It costs the one genuinely two-way case her arm on this card, since the stat line is now a
 * hitter's line. That is the trade: her pitching is on Pitcher of the Year, where it can be
 * compared against other pitching instead of sitting next to four batting averages.
 *
 * ONE HITTER PER CLUB, WHICH ON A FOUR-CLUB LEAGUE MEANS ALL FOUR CLUBS ARE ON THE BALLOT. Taken
 * straight off the top the list ran two deep into the same club and left one with nobody, and the
 * question this award asks a reader is which season was the best rather than which club had the
 * best pair. A fan who follows one team and finds nobody of theirs on the first question of the
 * ballot reads the whole thing as not being about them. It costs the fifth-best hitter in the
 * league a tile she was only holding because a team-mate already had one, and the search under
 * every player category still takes a vote for her.
 *
 * IT DEGRADES BY FILLING RATHER THAN BY SHRINKING. Once every club has a name the remaining slots
 * go to the best hitters left, so a league with fewer clubs than SHORTLIST, or a club with no
 * qualified hitter, still gets four tiles instead of a short row.
 */
function mvpSlate({ mvp, players, batting, pitching, games }: AwardBallotInput): AwardCandidate[] {
  if (!mvp) return []
  const bats = new Map(aggregateBatting(players, batting, games).map(b => [b.player.id, b.totals]))
  return oncePerClub(mvp.field.filter(c => c.bat >= c.arm), c => c.player?.team_id ?? c.teamId).map(c => ({
    // The race keys an unrostered name as `name:<lowercased>`, and that key is what gets
    // stored. It is stable for as long as the play log spells her the same way, which is the
    // best any vote for somebody with no roster row can do.
    key: c.player?.id ?? c.key,
    name: c.name,
    teamId: c.player?.team_id ?? c.teamId,
    playerId: c.player?.id ?? null,
    // NO RUN-VALUE SENTENCE HERE EITHER. `line` only draws when a candidate has no stats at
    // all, so this used to be the one path that could still put "runs added" on screen after
    // the figure itself came off the tiles. Empty rather than reworded: a candidate with no
    // batting totals has nothing true to say beyond her name.
    line: '',
    // NO `sub` FOR A TWO-WAY PLAYER ANY MORE. It read "Both sides of the ball", which is exactly
    // what a Bat figure beside an Arm figure says, and the card now carries both: the sentence
    // and the numbers under it were the same claim twice, and the sentence was the half that
    // wrapped onto a second line.
    stats: valueStats(c.player ? bats.get(c.player.id) : undefined),
  }))
}

/**
 * The best SHORTLIST names, spread across the clubs: every club's best one first, in ranking
 * order, then the best of whoever is left.
 *
 * ORDER IS PRESERVED WITHIN BOTH PASSES, so the tile a reader sees first is still the top of the
 * race. The second pass exists so the row is always full: without it a three-club league, or a
 * club with nobody eligible, would render a short slate rather than a spread one.
 */
function oncePerClub<T>(ranked: readonly T[], clubOf: (x: T) => string | null): T[] {
  const seen = new Set<string>()
  const first: T[] = []
  const rest: T[] = []
  for (const x of ranked) {
    const club = clubOf(x)
    // A candidate with no club cannot claim a club's slot, so she waits for the fill pass.
    if (club && !seen.has(club)) { seen.add(club); first.push(x) } else rest.push(x)
  }
  return [...first, ...rest].slice(0, SHORTLIST)
}

function armSlate(
  { mvp, players, pitching, games, teams }: AwardBallotInput,
  /** Keys already carded on MVP. See the dedupe note below. */
  exclude: ReadonlySet<string> = new Set(),
): AwardCandidate[] {
  if (!mvp) return []
  // The gate is the section's own rate-title bar, not a number invented here, so a pitcher on
  // this list is one the stats board would also let onto a leaderboard.
  const qual = wpblQualifiers(teams, games)
  const eligible = new Set(
    aggregatePitching(players, pitching, games)
      .filter(p => p.totals.outs >= (qual.active ? qual.minOuts : 0))
      .map(p => p.player.id),
  )
  // NO RUNS-SAVED FIGURE ON THE CARD, THOUGH IT IS STILL THE SORT. Two things were wrong with
  // it and neither was the number. "RUNS SAVED" is twice the width of every label beside it, so
  // the first column of a four-figure row set the spacing for the whole grid and the three
  // familiar stats got squeezed against it. And it is a run-expectancy figure: this ballot is
  // the friendliest surface in the section, the one place a reader who does not follow the
  // league is asked to have an opinion, and the first number on the first pitcher was one
  // almost nobody outside the site can price. The list is still ordered by it.
  //
  // NOT ERA either: it is stored on whichever basis the league publishes and the reader can
  // flip that basis in settings, so a pure builder printing it would be handing out a number
  // half the audience has asked not to see (see stats.ts).
  const totals = new Map(aggregatePitching(players, pitching, games).map(p => [p.player.id, p.totals]))
  // NOBODY IS CARDED ON TWO AWARDS ON ONE BALLOT. MVP is hitters-only now, so the overlap is
  // exactly the two-way player: she led this list on runs saved AND the MVP list on runs added,
  // and a reader answering five questions met the same face twice in the first two. Dropping her
  // here rather than there is deliberate, and it is the half that costs least: the next arm down
  // is a real candidate with a real case, while MVP has no equivalent replacement for her bat.
  //
  // It is a rule and not a list, so it follows the race: if the MVP shortlist changes, this one
  // re-derives against it on the next build.
  // The hand-ordered names run AFTER the cut, never before it. See WPBL_ARM_ORDER_LAST: the
  // sort decides who is on the ballot and this decides nothing but where a card is drawn.
  return orderLast(WPBL_ARM_ORDER_LAST, players, mvp.field
    .filter(c => c.arm > 0 && c.player != null && eligible.has(c.player.id))
    .filter(c => !exclude.has(c.player!.id))
    .sort((a, b) => b.arm - a.arm)
    .slice(0, SHORTLIST)
    .map(c => {
      const t = totals.get(c.player!.id)
      return {
        key: c.player!.id,
        name: c.name,
        teamId: c.player!.team_id ?? c.teamId,
        playerId: c.player!.id,
        // Empty for the reason mvpSlate's is: `line` draws only when a candidate has no stats
        // at all, which the filter above makes unreachable anyway, and a run-value sentence is
        // the one thing this ballot has deliberately stopped saying.
        line: '',
        // ERA FIRST, WHICH IS THE ORDER A FAN READS A PITCHER IN, and it is the one figure on
        // this ballot whose spelling depends on a reader setting: `eraBasisValue` carries the
        // stored number for the view to scale, and `value` is the canonical-basis fallback for
        // anything that cannot (see AwardStat).
        //
        // SAVES SECOND, FOR A PITCHER WHO HAS NOT STARTED A GAME, and nowhere else. A closer
        // carded on innings and strikeouts is being judged on the two things her job does not
        // ask of her, and the three figures a phone shows would not include the one stat that
        // is her whole case. `gs === 0` rather than a save threshold: it is her ROLE that makes
        // the number worth leading with, so a middle reliever reads an honest 0 and a starter
        // who happened to pick up a save is not recarded as a closer.
        stats: armStats(t),
      }
    }))
}

/**
 * Moves the named players to the end of a shortlist, in the order they are named.
 *
 * ON THE ROSTER ROW, not on the candidate's own name, so it agrees with `resolveNominees` about
 * what a nominee is: a (name, club) pair that has to hit exactly one player. A name that resolves
 * to nobody, or to two people, moves nobody and leaves the list as the sort built it, which is the
 * same way every hand-kept list in this file fails.
 */
function orderLast(
  last: readonly WpblNominee[], players: WpblPlayer[], candidates: AwardCandidate[],
): AwardCandidate[] {
  const ids = new Set(resolveNominees(last, players).map(r => r.player.id))
  if (!ids.size) return candidates
  const kept = candidates.filter(c => !c.playerId || !ids.has(c.playerId))
  // Ordered by the CONSTANT and not by the shortlist, so two pinned names keep the order they
  // were written in rather than the one the sort happened to leave them in.
  const moved = [...ids].flatMap(id => candidates.filter(c => c.playerId === id))
  return [...kept, ...moved]
}

// ── The box-score shortlists ────────────────────────────────────────────────────

/**
 * A hand-kept list of names into roster rows.
 *
 * NAME AND CLUB, AND ONLY AN UNAMBIGUOUS SINGLE HIT. Two players sharing a name on one club is
 * the case routes.ts already refuses to guess at, and a ballot is a worse place to guess than a
 * URL. A name that resolves to nobody is dropped and the rest stand: silently offering three is
 * better than an empty award and better than inventing a fourth, and the list is four lines of
 * source a person maintains, so a name going missing is visible where it is written.
 */
function resolveNominees(
  list: readonly WpblNominee[], players: WpblPlayer[],
): { nominee: WpblNominee; player: WpblPlayer }[] {
  const out: { nominee: WpblNominee; player: WpblPlayer }[] = []
  for (const nominee of list) {
    const found = players.filter(p => p.name === nominee.name && p.team_id === nominee.teamId)
    if (found.length === 1) out.push({ nominee, player: found[0] })
  }
  return out
}

/**
 * The four named in `WPBL_GLOVE_SHORTLIST`, carded on what they actually did.
 *
 * The list is the shortlist and the header there says why: the feed's fielding row carries no
 * position, so every ranking this could compute is an infielder's, and a catcher and a right
 * fielder cannot reach one however well they play. Nothing is sorted here and nothing is cut.
 *
 * A NAME THAT RESOLVES TO NOBODY IS DROPPED AND THE REST STAND, which is the same call every
 * other slate makes when a player has no lines. Silently offering three names is better than an
 * empty award, and better than guessing at a fifth: the list is four lines of source that a
 * person maintains, so a name going missing is visible where it is written rather than here.
 */
function gloveSlate({ players, fielding, batting, games, plays }: AwardBallotInput): AwardCandidate[] {
  const byPlayer = new Map<string, WpblFieldingLine[]>()
  for (const l of regularSeasonLines(fielding, games)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const positions = buildPositionIndex(batting, games)
  // Null, not an empty map, when the play log has not been fetched: a catcher then reads "—"
  // rather than a confident zero, which is the difference between "we do not know" and "nobody
  // ran on her". See AwardStat.
  const arms = plays?.length ? catcherArms(plays, batting, fielding, games) : null
  const out: AwardCandidate[] = []
  for (const { player } of resolveNominees(WPBL_GLOVE_SHORTLIST, players)) {
    const t = sumFielding(byPlayer.get(player.id) ?? [])
    const catcher = positions.get(player.id)?.position === 'c'
    out.push({
      ...playerCandidate(player, gloveLine(t, catcher ? arms?.get(player.id) ?? null : null, catcher)),
      stats: gloveStats(t, catcher, catcher ? arms?.get(player.id) ?? null : null),
    })
  }
  return out
}

/** The sentence under the name. A catcher's is the running game; everyone else's is volume and
 *  errors, which is the honest pair once putouts are off the table. */
function gloveLine(t: WpblFieldingTotals, arm: CatcherArm | null, catcher: boolean): string {
  const errs = `${t.e} ${t.e === 1 ? 'error' : 'errors'}`
  if (!catcher) return `${t.po + t.a + t.e} chances, ${errs}`
  if (!arm) return `${t.a} assists, ${errs}`
  return arm.attempts
    ? `Threw out ${arm.caught} of ${arm.attempts} who ran on her`
    : `Nobody tried to run on her, ${errs}`
}

function wheelsSlate({ players, batting, games }: AwardBallotInput): AwardCandidate[] {
  return aggregateBatting(players, batting, games)
    .filter(b => b.totals.sb >= WHEELS_MIN_SB)
    .sort((a, b) => (b.totals.sb - b.totals.cs) - (a.totals.sb - a.totals.cs)
      || b.totals.sb - a.totals.sb
      || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(b => playerCandidate(
      b.player,
      `${b.totals.sb} ${b.totals.sb === 1 ? 'steal' : 'steals'}, caught ${b.totals.cs}`,
    ))
}

function toughestOutSlate({ players, batting, games, teams }: AwardBallotInput): AwardCandidate[] {
  const qual = wpblQualifiers(teams, games)
  const bar = qual.active ? qual.minPa : QUALIFY_FLOOR_PA
  const rows = aggregateBatting(players, batting, games)
    .map(b => ({ ...b, pa: plateAppearances(b.totals) }))
    .filter(b => b.pa >= bar)
  return rows
    .sort((a, b) => a.totals.so / a.pa - b.totals.so / b.pa || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(b => playerCandidate(
      b.player,
      `Struck out in ${((b.totals.so / b.pa) * 100).toFixed(1)}% of ${b.pa} trips`,
    ))
}

function workhorseSlate({ players, pitching, games }: AwardBallotInput): AwardCandidate[] {
  return aggregatePitching(players, pitching, games)
    .filter(p => p.totals.outs > 0)
    .sort((a, b) => b.totals.outs - a.totals.outs || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(p => playerCandidate(
      p.player,
      `${outsToIp(p.totals.outs)} innings across ${p.totals.g} ${p.totals.g === 1 ? 'outing' : 'outings'}`,
    ))
}

function utilitySlate({ players, batting, games }: AwardBallotInput): AwardCandidate[] {
  const byPlayer = new Map<string, WpblBattingLine[]>()
  for (const l of regularSeasonLines(batting, games)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const roster = new Map(players.map(p => [p.id, p]))
  const rows: { player: WpblPlayer; positions: string[] }[] = []
  for (const [pid, lines] of byPlayer) {
    const player = roster.get(pid)
    if (!player) continue
    const positions = positionsPlayed(lines, games)
    if (positions.length >= UTILITY_MIN_POSITIONS) rows.push({ player, positions })
  }
  return rows
    .sort((a, b) => b.positions.length - a.positions.length || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(r => playerCandidate(
      r.player,
      `${r.positions.length} positions: ${prettyPositions(r.positions)}`,
    ))
}

// ── Moments, from the win model ─────────────────────────────────────────────────

function playSlate({ winProb, teams }: AwardBallotInput): AwardCandidate[] {
  if (!winProb) return []
  const names = teamNames(teams)
  const rows: { swing: number; candidate: AwardCandidate }[] = []
  for (const { game, wp } of winProb) {
    if (game.status !== 'final' || !countsInStandings(game)) continue
    // `decisive` rather than `biggest`: the largest swing toward the side that actually won.
    // The biggest swing full stop is often a rally the losing team wasted, and a card calling
    // that the play of the year reads as a mistake rather than as a different question.
    const pt = wp.decisive
    if (!pt || !pt.play.narrative) continue
    rows.push({
      swing: Math.abs(pt.swing),
      candidate: {
        key: playChoiceKey(game.id, pt.play.sequence),
        name: pt.play.narrative,
        teamId: pt.play.team_id,
        playerId: pt.play.batter_id,
        line: `Swung the game ${fmtWinPct(Math.abs(pt.swing))}`,
        sub: `${names(game.away_team_id)} at ${names(game.home_team_id)}, ${game.game_date}`,
        gameId: game.id,
        sequence: pt.play.sequence,
      },
    })
  }
  return rows.sort((a, b) => b.swing - a.swing).slice(0, MOMENT_SHORTLIST).map(r => r.candidate)
}

function gameSlate({ winProb, teams }: AwardBallotInput): AwardCandidate[] {
  if (!winProb) return []
  const names = teamNames(teams)
  return winProb
    .filter(({ game }) => game.status === 'final' && countsInStandings(game))
    .slice()
    .sort((a, b) => b.wp.excitement - a.wp.excitement)
    .slice(0, SHORTLIST)
    .map(({ game }) => ({
      key: game.id,
      name: `${names(game.away_team_id)} at ${names(game.home_team_id)}`,
      teamId: game.home_team_id,
      playerId: null,
      line: `${names(game.away_team_id)} ${game.away_score ?? 0}, ${names(game.home_team_id)} ${game.home_score ?? 0}`,
      sub: game.game_date,
      gameId: game.id,
    }))
}

// ── Radar, when there is any ────────────────────────────────────────────────────

function cannonSlate({ tracking }: AwardBallotInput): AwardCandidate[] {
  if (!tracking) return []
  return tracking.veloLeaders
    .slice(0, SHORTLIST)
    .filter(l => l.player != null)
    .map(l => ({
      key: l.player!.id,
      name: l.name,
      teamId: l.player!.team_id ?? l.teamId,
      playerId: l.player!.id,
      line: `${l.maxVelo.toFixed(1)} mph, hardest of ${l.count} tracked pitches`,
    }))
}

function contactSlate({ tracking }: AwardBallotInput): AwardCandidate[] {
  if (!tracking) return []
  const seen = new Set<string>()
  const out: AwardCandidate[] = []
  // One entry per hitter: the board is a list of batted balls, and the same swing-first
  // hitter owning three of six slots would leave a ballot with three names on it.
  for (const hit of tracking.hardestHits) {
    if (!hit.player || hit.exit == null || seen.has(hit.player.id)) continue
    seen.add(hit.player.id)
    out.push({
      key: hit.player.id,
      name: hit.name,
      teamId: hit.player.team_id ?? hit.teamId,
      playerId: hit.player.id,
      line: `${hit.exit.toFixed(1)} mph off the bat`,
      sub: hit.distance != null ? `${Math.round(hit.distance)} feet` : undefined,
      gameId: hit.gameId,
    })
    if (out.length >= SHORTLIST) break
  }
  return out
}

// ── The open field ──────────────────────────────────────────────────────────────

/** Everyone who played, for the categories no number can shortlist. Alphabetical rather than
 *  ranked on purpose: any order here would be the opinion the category exists to avoid. */
function everyoneSlate({ players, batting, pitching, games }: AwardBallotInput): AwardCandidate[] {
  const played = new Set<string>()
  for (const l of regularSeasonLines(batting, games)) played.add(l.player_id)
  for (const l of regularSeasonLines(pitching, games)) played.add(l.player_id)
  return players
    .filter(p => played.has(p.id))
    .sort(byName)
    .map(p => ({ key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: '' }))
}

// ── The bench, which is a club here ─────────────────────────────────────────────

/**
 * All four clubs, best record first.
 *
 * A SLATE OF FOUR IS NOT A SHORTLIST. Every club is on it
 * because there are only four, so the ordering is the whole of what this contributes and the
 * ordering is just the standings. That is fine for the one award where the reader already knows
 * every candidate by heart.
 *
 * The record is counted here rather than taken from `computeStandings`, which lives in api.ts
 * and would drag the supabase client into a file whose header promises it has none. It is a
 * win and a loss per final game, which is the entire tiebreak-free version of the table and
 * all this needs: nothing downstream sorts on it beyond putting the best record first.
 */
function managerSlate({ teams, games }: AwardBallotInput): AwardCandidate[] {
  const record = new Map<string, { w: number; l: number; rf: number; ra: number }>(
    teams.map(t => [t.id, { w: 0, l: 0, rf: 0, ra: 0 }]))
  for (const g of games) {
    if (g.status !== 'final' || !countsInStandings(g)) continue
    if (g.home_score == null || g.away_score == null) continue
    const home = record.get(g.home_team_id), away = record.get(g.away_team_id)
    if (home) { home.rf += g.home_score; home.ra += g.away_score }
    if (away) { away.rf += g.away_score; away.ra += g.home_score }
    if (g.home_score === g.away_score) continue
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    const loser = g.home_score > g.away_score ? g.away_team_id : g.home_team_id
    const w = record.get(winner); if (w) w.w++
    const l = record.get(loser); if (l) l.l++
  }
  return [...teams]
    .sort((a, b) => {
      const ra = record.get(a.id)!, rb = record.get(b.id)!
      return (rb.w - rb.l) - (ra.w - ra.l) || a.name.localeCompare(b.name)
    })
    .map(t => {
      const r = record.get(t.id)!
      const mgr = WPBL_MANAGERS.find(m => m.teamId === t.id)
      const diff = r.rf - r.ra
      return {
        // The person, not the chair. See WPBL_MANAGERS: Boston has had two in fifteen games, so
        // a vote stored against the club would re-credit whoever holds the job next.
        key: mgr?.key ?? t.id,
        name: mgr?.name ?? t.name,
        teamId: t.id,
        // NOT A PLAYER, and this is the field that says so. A surface drawing a portrait off
        // `playerId` draws a club badge instead when it is null, and nothing links through to a
        // player page for a vote that was never about one.
        playerId: null,
        line: `${t.name} · ${r.w}-${r.l}`,
        // The club, on every card rather than only on Boston's. Manager of the Year is the one
        // award where the badge alone is not enough context: a reader who could name all four
        // benches would not need the shortlist.
        sub: t.name,
        stats: [
          { label: 'Record', value: `${r.w}-${r.l}` },
          { label: 'Run diff', value: diff > 0 ? `+${diff}` : String(diff) },
        ],
      }
    })
}

// ── Aura, which no column holds ─────────────────────────────────────────────────

/**
 * The four named in `WPBL_AURA_SHORTLIST`, carded on nothing.
 *
 * NO NUMBERS, AND THAT IS THE FEATURE. The header on the list says why the names are chosen; this
 * says why the row under them holds no figures. A number on an aura card does not inform the
 * question, it replaces it: put HR and AVG under four faces and the reader compares them, because
 * that is what a row of figures is for, and the answer they arrive at is "who is better", which
 * is the MVP two questions up.
 *
 * THE TEAM TAKES THE SLOT INSTEAD, because empty was the other thing this got wrong. A tile with
 * a face, a name and a position and then nothing had a visible hole where every other question on
 * the sheet puts something, and a hole reads as a card that failed to load rather than as a
 * question with no arithmetic in it. The team is the one fact left that is worth stating and
 * cannot be argued with, and it is genuinely absent otherwise: a player tile draws her portrait
 * where a club tile would draw the badge, so until now the only thing naming her side on this
 * question was the accent colour behind her. Labelled TEAM rather than CLUB, which is the word
 * this file's prose uses but not the one on any surface a reader sees.
 *
 * `awardStatsLookup` gives a write-in the same single line, or the one name a reader added
 * themselves would be the only bare card in a grid of four.
 */
function auraSlate({ players, teams }: AwardBallotInput): AwardCandidate[] {
  const teamName = teamNames(teams)
  return resolveNominees(WPBL_AURA_SHORTLIST, players)
    .map(({ player }) => ({
      ...playerCandidate(player, ''),
      stats: [{ label: 'Team', value: teamName(player.team_id) }],
    }))
}

// ── The same figures, for a name the shortlist never had ────────────────────

/**
 * A pitcher's line, a fielder's line, and aura's two.
 *
 * Lifted out of the slates that used to spell them inline, for one reason: a write-in has to be
 * carded on exactly what the seeded names are carded on. Four tiles showing ERA, K, IP and WHIP
 * beside a fifth showing something else is not a ballot anybody can compare, and two copies of a
 * stat line drift the first time one of them is edited.
 */
function armStats(t: WpblPitchingTotals | undefined): AwardStat[] {
  // ERA FIRST, WHICH IS THE ORDER A FAN READS A PITCHER IN, and it is the one figure on this
  // ballot whose spelling depends on a reader setting: `eraBasisValue` carries the stored number
  // for the view to scale, and `value` is the canonical-basis fallback for anything that cannot
  // (see AwardStat).
  //
  // SAVES SECOND, FOR A PITCHER WHO HAS NOT STARTED A GAME, and nowhere else. A closer carded on
  // innings and strikeouts is being judged on the two things her job does not ask of her, and the
  // three figures a phone shows would not include the one stat that is her whole case. `gs === 0`
  // rather than a save threshold: it is her ROLE that makes the number worth leading with, so a
  // middle reliever reads an honest 0 and a starter who happened to pick up a save is not
  // recarded as a closer.
  return t ? [
    { label: 'ERA', value: t.era == null ? '—' : t.era.toFixed(2), eraBasisValue: t.era },
    ...(t.gs === 0 ? [{ label: 'SV', value: String(t.s) }] : []),
    { label: 'K', value: String(t.so) },
    { label: 'IP', value: outsToIp(t.outs) },
    { label: 'WHIP', value: t.whip == null ? '—' : t.whip.toFixed(2) },
  ] : []
}

/** Errors included even though they do not help the sort. This shortlist is ordered on chances
 *  made and says so; leaving out the one column that counts chances MISSED would make it read as
 *  a ranking that had already weighed both. */
// PUTOUTS, ASSISTS, ERRORS: the plain fielding line, and the only three that are legible across
// the positions this slate now spans. DP came off with the sort that used it, and it was 0 for
// three of the four names: a column of zeros beside one number reads as a ranking nobody made.
//
// PUTOUTS ARE SAFE TO PRINT AND WERE NEVER SAFE TO RANK ON, which is the distinction the old
// `GLOVE_MIN_CHANCES` comment was really making. A catcher is credited a putout on every
// strikeout and a first baseman on every groundout, so a shortlist ordered on them is a list of
// positions rather than of players, in this league or any other. Nothing is ordered here any
// more, so the number goes back to being what it is: how much came at her.
function gloveStats(t: WpblFieldingTotals, catcher: boolean, arm: CatcherArm | null): AwardStat[] {
  // ONE CARD, WITH ONE SUBSTITUTION. Assists and errors mean the same thing wherever she stands,
  // so only the lead figure changes: putouts for everybody, caught stealing for a catcher.
  //
  // PUTOUTS ARE THE DECOY AND THAT IS WHY THEY GO. Denae Benites has 90 of them and 86 are her
  // club's strikeouts: she is credited one every time an NY pitcher rings somebody up, so the
  // number measures innings caught and the pitching staff rather than anything she did. Under it
  // is a real season nobody could see, because it is not in the box score at all: she threw out
  // 5 of the 12 who ran on her, 42%, where the league's other regulars sit between 5 and 8 per
  // cent. Those five are also five of her fourteen assists, which is not double counting so much
  // as the same throws named twice: the assist column is where a catcher's arm has always hidden.
  //
  // CS MEANS THE OPPOSITE OF THE CS ON A HITTER'S CARD, which is worth knowing before anyone puts
  // the two on one screen: there it is the runner being thrown out and it counts against her,
  // here it is the catcher doing the throwing and it counts for her. The same trap as K at the
  // plate against K on the mound (see valueStats). The count alone rather than "5 of 12", because
  // these tiles are a third of a card wide and sit beside two plain integers; the attempts are
  // in the line under her name, which is where the 42% that makes 5 remarkable actually lives.
  const lead: AwardStat = catcher
    ? { label: 'CS', value: arm ? String(arm.caught) : '—' }
    : { label: 'PO', value: String(t.po) }
  return [
    lead,
    { label: 'Assists', value: String(t.a) },
    { label: 'Errors', value: String(t.e) },
  ]
}

/**
 * The figures for anybody at all, on any question: what a write-in gets carded on.
 *
 * WHY A BALLOT NEEDS THIS AT ALL. A shortlist builder walks a pool and cards whoever survives its
 * filter, so the numbers only exist for the names it chose. A reader who searched the league and
 * voted for somebody else got a tile with a name and a blank where five figures sit on every tile
 * beside it. The vote a reader had to go looking for is the one they are least sure of, and it
 * was the only one the ballot said nothing about.
 *
 * COMPUTED ON DEMAND, ONCE. Three season aggregates over every line in the league is not work to
 * repeat per question on a sheet where most readers never write anybody in, so each is built the
 * first time something asks for it and shared by all five questions after that.
 *
 * A CATEGORY THAT CARDS NOBODY ON NUMBERS STAYS THAT WAY. Play, Game and Manager have no figures
 * to give, and the open-field slates withhold them on purpose; returning nothing here keeps that
 * true of the write-in too, which is what the reserved row in FanVote is for.
 */
export function awardStatsLookup(
  input: AwardBallotInput,
): (award: WpblAward) => (playerId: string) => AwardStat[] {
  let bats: Map<string, WpblBattingTotals> | null = null
  let arms: Map<string, WpblPitchingTotals> | null = null
  let gloves: Map<string, WpblFieldingTotals> | null = null
  const batting = () => (bats ??= new Map(
    aggregateBatting(input.players, input.batting, input.games).map(b => [b.player.id, b.totals])))
  const pitching = () => (arms ??= new Map(
    aggregatePitching(input.players, input.pitching, input.games).map(p => [p.player.id, p.totals])))
  // Both lazy, for the reason every other lookup here is: a sheet where nobody searches for a
  // catcher must not pay for either of them.
  let posIndex: ReturnType<typeof buildPositionIndex> | null = null
  const writeInPositions = () => (posIndex ??= buildPositionIndex(input.batting, input.games))
  let catcherArmIndex: Map<string, CatcherArm> | null | undefined
  const writeInArms = () => {
    if (catcherArmIndex !== undefined) return catcherArmIndex
    catcherArmIndex = input.plays?.length
      ? catcherArms(input.plays, input.batting, input.fielding, input.games)
      : null
    return catcherArmIndex
  }

  const teamName = teamNames(input.teams)

  const fielding = () => {
    if (gloves) return gloves
    const lines = new Map<string, WpblFieldingLine[]>()
    for (const l of regularSeasonLines(input.fielding, input.games)) {
      const arr = lines.get(l.player_id) ?? []
      arr.push(l); lines.set(l.player_id, arr)
    }
    gloves = new Map([...lines].map(([id, ls]) => [id, sumFielding(ls)]))
    return gloves
  }

  /**
   * Which half of a season to card her on.
   *
   * THE MOUND ONLY WHERE THE BAT HAS NOTHING TO SAY, because both questions that ask this are
   * questions a hitter is normally the answer to. A pitcher written into MVP is the case that
   * forced it: carded on her batting she read `.000  0  .000  0  0`, five columns of nothing,
   * which is not what the reader who voted for her meant and is not a season anybody had. It is
   * a shortlist she was deliberately left off (MVP seeds hitters only, see mvpSlate), so a
   * different shape of line is the honest answer rather than an inconsistency.
   *
   * A HOME RUN IS ENOUGH TO KEEP HER ON THE BAT, which is what holds a two-way player on the
   * card the seeded slates already give her. And REAL work on the mound, by the same test
   * positionLabeller uses: a position player who finished a blowout is not a pitcher.
   */
  const mound = (
    bat: WpblBattingTotals | undefined, arm: WpblPitchingTotals | undefined,
  ): boolean => !!arm && (arm.gs > 0 || arm.outs >= 9) && (!bat || bat.hr === 0)

  return (award: WpblAward) => (playerId: string): AwardStat[] => {
    switch (award.slate) {
      case 'mvp': {
        const bat = batting().get(playerId)
        const arm = pitching().get(playerId)
        return mound(bat, arm) ? armStats(arm) : valueStats(bat)
      }
      case 'arm':
        return armStats(pitching().get(playerId))
      case 'glove': {
        const t = fielding().get(playerId)
        if (!t) return []
        // A write-in gets the same two shapes the shortlist does, decided the same way, or a
        // catcher voted for by name would be carded on the strikeout putouts the slate itself
        // has just stopped printing.
        const catcher = writeInPositions().get(playerId)?.position === 'c'
        return gloveStats(t, catcher, catcher ? writeInArms()?.get(playerId) ?? null : null)
      }
      // Aura carries no figures on any card, seeded or written in: the slot holds her team
      // instead, and a write-in has to be carded on what the seeded four are. See auraSlate.
      case 'aura': {
        const player = input.players.find(p => p.id === playerId)
        return player ? [{ label: 'Team', value: teamName(player.team_id) }] : []
      }
      default:
        return []
    }
  }
}

// ── Shared ──────────────────────────────────────────────────────────────────────

function playerCandidate(player: WpblPlayer, line: string): AwardCandidate {
  return { key: player.id, name: player.name, teamId: player.team_id, playerId: player.id, line }
}

/** Club nickname by id, falling back to the id itself so a club the roster fetch missed still
 *  reads as something rather than as blank. */
function teamNames(teams: readonly WpblTeam[]): (id: string | null) => string {
  const map = new Map(teams.map(t => [t.id, t.name || t.abbr || t.id]))
  return (id: string | null) => (id ? map.get(id) ?? id : '')
}

// ── Write-ins on the ballot ─────────────────────────────────────────────────────

/**
 * The names a question actually shows, once the crowd is allowed to affect them.
 *
 * THE SHORTLIST IS SEEDED, NOT ELECTED, AND THAT ONLY HOLDS WHILE THE TALLY IS HIDDEN. A
 * category takes votes for anyone in the league through the search, so a name with real support
 * can sit off the list indefinitely: at close, a write-in who WON was not drawn at all, because
 * the results view renders the seeded four plus your own pick and nothing else. That is the hole
 * this closes.
 *
 * WHY IT IS GATED ON `reveal` AND NOT ALWAYS ON. Promoting a write-in is itself a fact about how
 * other people voted, so doing it before the reader answers would break the same rule the
 * percentages obey ("the tally is hidden until you answer"), by a quieter route. It is also
 * self-reinforcing in a way percentages are not: a promoted write-in costs one tap while an
 * unpromoted one costs knowing to search, so promotion buys votes, which buys promotion. A
 * ballot that orders itself by its own running total manufactures a consensus rather than
 * measuring one, and the first fifty voters would pick the shortlist the next five hundred are
 * offered. `reveal` is true exactly when the tally is already on screen: you have answered, or
 * voting is closed. Then it adds information the reader can already see anyway.
 *
 * MIN_WRITE_IN_VOTES, so one person cannot put a name in front of everybody. A single vote is
 * the write-in equivalent of an empty room, and the reader's OWN pick is added regardless (see
 * `mine`), so the floor costs a real voter nothing.
 */
export const MIN_WRITE_IN_VOTES = 2

export interface WriteInOptions {
  /** The tally for this category: choice key to votes. */
  bucket: Record<string, number> | undefined
  /** Everyone who could have been written in, for resolving a key back to a person. */
  players: readonly WpblPlayer[]
  /** This reader's own choice, which is drawn whatever its support. */
  picked: string | null
  /** Whether the tally is already visible: they have answered, or the ballot has closed. */
  reveal: boolean
  /** Voting is over, so the list becomes a result and is ordered by it. */
  closed: boolean
}

export function withWriteIns(
  candidates: readonly AwardCandidate[],
  { bucket, players, picked, reveal, closed }: WriteInOptions,
): AwardCandidate[] {
  const onList = new Set(candidates.map(c => c.key))
  const votes = (key: string) => bucket?.[key] ?? 0
  const byId = new Map(players.map(p => [p.id, p]))

  const asCandidate = (key: string, line: string): AwardCandidate | null => {
    const p = byId.get(key)
    // A key that names nobody on the roster is left out rather than drawn as a blank tile. The
    // MVP race keys an unrostered name as `name:<lowercased>`, and a vote can also outlive the
    // player it named; neither has a portrait, a club or a page to open.
    return p ? { key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line } : null
  }

  const extras: AwardCandidate[] = []
  // The reader's own write-in, always. Without this the tile they just tapped disappears the
  // moment the search clears, which reads as the vote having been rejected.
  const mine = picked && !onList.has(picked) ? asCandidate(picked, 'Your write-in') : null
  if (mine) extras.push(mine)

  if (reveal) {
    // The bar a write-in has to clear: real support, and more of it than the weakest name we
    // seeded. Beating the floor alone would let a name with two votes displace one the MVP race
    // put there, which is the shortlist arguing with itself.
    const weakest = candidates.reduce(
      (n, c) => Math.min(n, votes(c.key)), Number.POSITIVE_INFINITY)
    for (const [key, n] of Object.entries(bucket ?? {})) {
      if (onList.has(key) || key === picked) continue
      if (n < MIN_WRITE_IN_VOTES || n <= weakest) continue
      const c = asCandidate(key, `${n} ${n === 1 ? 'vote' : 'votes'}`)
      if (c) extras.push(c)
    }
  }

  const shown = [...candidates, ...extras]
  // ORDERED BY VOTES ONLY ONCE IT IS A RESULT. Re-sorting a live ballot under the reader the
  // instant they answer moves every tile they were just looking at, and ballot position is
  // itself a nudge; seeded order is the neutral one to hold while the question is still open.
  if (!closed) return shown
  return shown
    .slice()
    .sort((a, b) => votes(b.key) - votes(a.key) || a.key.localeCompare(b.key))
}
