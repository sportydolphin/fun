import type { League, LeagueGame, RunValuePlay } from './types'

/**
 * One pitcher's work in one half-inning, built from the play log: the finder's third grain.
 *
 * WHY A LINE AND NOT A QUERY OVER PLAYS. The finder already knows how to filter, sort, tally and
 * cut lines by club, opponent, venue and season scope, and every one of those reads `game_id`,
 * `player_id` and `team_id` off a row. Folding the plays into rows of that shape once means "three
 * strikeouts in an inning" runs through the same engine as "five strikeouts in a game", tally and
 * all, instead of a second engine that has to be kept in step with it.
 *
 * ONE LINE PER PITCHER, NOT PER HALF-INNING. A reliever who comes in with two out and strikes out
 * the last batter did not strike out three in the inning, whatever the inning's total says. So a
 * half-inning with a pitching change is two lines, and each play is credited to the pitcher on it.
 *
 * WHAT IS COUNTED, AND FROM WHAT. The log names each play's event, not its outs, so every count but
 * one is a classification of `event_type`: strikeouts, walks, hit batters, hits and home runs. The
 * plate appearances are `League.isPlateAppearance`, the pitches and strikes are the league's own
 * pitch letters. On WPBL's 2026 log the strikeouts agree with the box scores to one (330 against 331).
 *
 * OUTS ARE READ OFF THE NEXT ROW, never classified. Each row carries the outs BEFORE it, so the outs
 * a row made are the next row's outs less its own: that catches a double play, a runner thrown out
 * stretching and a caught stealing, all of which a classification of the batter's event misses
 * (runExpectancy.ts, `halfInningEndings`, has the long version). The last row of a half-inning has
 * no next row, so it is taken to end the half with three out, unless the half is the game's last and
 * the home side batting won it: a walk-off stops on the run, not an out, and that row is credited
 * none. Clamped at zero, so a row whose outs go backwards (a correction that has not landed) costs
 * nothing rather than a negative inning.
 *
 * RUNS ARE THE RUNS THAT SCORED WHILE THE PITCHER WAS ON, not the runs charged. A box score charges
 * an inherited runner to the pitcher who put them on, and the log cannot say who that was once a
 * runner has moved. "Runs scored on the pitcher's watch" is the honest reading of the data, and
 * equals the charged runs whenever one pitcher threw the whole half, which is nearly always.
 *
 * NO CLAIM ABOUT WHETHER THE INNING IS OVER. Lines are built for every game handed in; the finder
 * keeps finals only, as it does for game lines.
 */
export interface InningPitchingLine {
  /** `${game_id}|${inning}|${half}|${pitcher_id}`: unique, and stable across reads. */
  id: string
  game_id: string
  /** The pitcher. */
  player_id: string
  /** The club IN THE FIELD, which is the pitcher's that day. A play names only the batting side. */
  team_id: string | null
  inning: number
  half: 'top' | 'bottom'
  /** This pitcher's first plate appearance in the half (the first row, when there is none): where
   *  Game Center opens the play-by-play. */
  sequence: number
  /** Batters faced: the plate appearances this pitcher finished. */
  bf: number
  /** Outs recorded while this pitcher was on, read off the next row (see above). */
  outs: number
  so: number
  bb: number
  hbp: number
  h: number
  hr: number
  /** Runs that scored on this pitcher's plays (see above). */
  r: number
  pitches: number
  /** Every pitch that was not a ball or a hit batter: called, swinging, foul and in play. */
  strikes: number
  /** What the runners did while this pitcher was on (see `runnerEvents`): bases stolen, runners caught
   *  stealing and picked off, wild pitches, passed balls and balks. */
  sb: number
  cs: number
  pk: number
  wp: number
  pb: number
  bk: number
}

const HITS = new Set(['single', 'double', 'triple', 'home_run'])

/**
 * THE RUNNERS' PLAYS. A steal, a caught stealing, a pickoff, a wild pitch, a passed ball and a balk are
 * usually a row of their own with no pitches, which neither the box score's inning nor the plate
 * appearance sees, and sometimes a clause of a batter's row ("struck out; ... advanced to second on a
 * wild pitch"). So they are read off every row's narrative, never inferred from the bases: steals and
 * caught stealing by how many times the text says so, since a double steal is one row with two ("stole
 * second; ... stole third") and the box score credits both; a wild pitch, a passed ball and a balk once
 * per row, however many runners it moved. "Failed pickoff attempt" is a throw over and not a pickoff.
 * Against 2026's box scores: 115 of 116 steals, 21 of 22 caught, 93 of 93 wild pitches, 18 of 24 balks
 * (a balk with nobody moving leaves no row).
 */
export function runnerEvents(p: Pick<RunValuePlay, 'event_type' | 'narrative'>): { sb: number; sbh: number; cs: number; pk: number; wp: number; pb: number; bk: number } {
  const text = (p.narrative ?? '').toLowerCase()
  const count = (re: RegExp) => (text.match(re) ?? []).length
  return {
    sb: Math.max(p.event_type === 'stolen_base' ? 1 : 0, count(/\bstole\b/g)),
    sbh: count(/\bstole home\b/g),
    cs: Math.max(p.event_type === 'caught_stealing' ? 1 : 0, count(/caught stealing/g)),
    pk: count(/\bpicked off\b/g),
    wp: p.event_type === 'wild_pitch' || /wild pitch/.test(text) ? 1 : 0,
    pb: p.event_type === 'passed_ball' || /passed ball/.test(text) ? 1 : 0,
    bk: /\bbalk\b/.test(text) ? 1 : 0,
  }
}

/** The half-inning a row belongs to, as one string. */
const halfKey = (p: Pick<RunValuePlay, 'game_id' | 'inning' | 'half'>) => `${p.game_id}|${p.inning}|${p.half}`

/**
 * Every pitcher's half-innings in the plays handed in.
 *
 * `games` names the club in the field and says which half-inning ended a game and how. A play
 * whose game is missing is skipped: without it there is no club to file the line under, and the
 * finder would drop the line anyway, since it keeps only the games it holds.
 *
 * Order is not assumed: the rows are sorted by game and sequence on the way in, because every out
 * is a difference between neighbors.
 */
/** The plays of the games held, in game and sequence order. */
function inOrder(plays: RunValuePlay[], gameById: Map<string, LeagueGame>): RunValuePlay[] {
  return [...plays]
    .filter(p => gameById.has(p.game_id))
    .sort((a, b) => (a.game_id === b.game_id ? a.sequence - b.sequence : a.game_id < b.game_id ? -1 : 1))
}

/**
 * A ROW THAT IS THE START OF THE NEXT ONE IS NOT A PLATE APPEARANCE. A run scoring on a balk
 * mid-at-bat can arrive as its own row carrying the count so far ("BBFB"), followed by the same
 * batter's finished at-bat ("BBFBSB"). Counted as it stands, that is one batter faced twice and four
 * pitches thrown twice. Once in WPBL's 2026 log, and exact to catch.
 */
function partOfNext(p: RunValuePlay, next: RunValuePlay | undefined): boolean {
  const seq = p.pitch_sequence ?? ''
  return !!seq && next != null && halfKey(next) === halfKey(p) && next.batter_id === p.batter_id
    && (next.pitch_sequence ?? '').startsWith(seq)
}

/** Each game's last half-inning, the only one that can end on something other than a third out. */
function lastHalves(sorted: RunValuePlay[]): Map<string, string> {
  const lastHalf = new Map<string, string>()
  for (const p of sorted) lastHalf.set(p.game_id, halfKey(p))
  return lastHalf
}

/** The outs once row `i` was over: the next row's, or the end of the half (see the comment above). */
function outsAfterRow(sorted: RunValuePlay[], i: number, lastHalf: Map<string, string>, g: LeagueGame): number {
  const p = sorted[i]
  const next = sorted[i + 1]
  if (next != null && halfKey(next) === halfKey(p)) return next.outs
  if (halfKey(p) !== lastHalf.get(p.game_id)) return 3
  // The game's last half-inning. A top half, or a bottom half the home side did not win, ended on the
  // third out; a bottom half the home side won ended on the winning run.
  const walkOff = p.half === 'bottom' && g.home_score != null && g.away_score != null && g.home_score > g.away_score
  return walkOff ? p.outs : 3
}

export function inningPitchingLines(league: League, plays: RunValuePlay[], games: LeagueGame[]): InningPitchingLine[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  const sorted = inOrder(plays, gameById)
  const lastHalf = lastHalves(sorted)

  const lines = new Map<string, InningPitchingLine>()
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    const g = gameById.get(p.game_id)!
    const key = halfKey(p)
    const next = sorted[i + 1]
    const outsAfter = outsAfterRow(sorted, i, lastHalf, g)

    // A row with no pitcher still moves the outs (a pickoff with the name missing), but there is
    // nobody to credit it to.
    if (!p.pitcher_id) continue
    const id = `${key}|${p.pitcher_id}`
    let line = lines.get(id)
    if (!line) {
      line = {
        id, game_id: p.game_id, player_id: p.pitcher_id,
        team_id: p.half === 'top' ? g.home_team_id : g.away_team_id,
        inning: p.inning, half: p.half, sequence: p.sequence,
        bf: 0, outs: 0, so: 0, bb: 0, hbp: 0, h: 0, hr: 0, r: 0, pitches: 0, strikes: 0,
        sb: 0, cs: 0, pk: 0, wp: 0, pb: 0, bk: 0,
      }
      lines.set(id, line)
    }

    line.outs += Math.max(0, outsAfter - p.outs)
    line.r += league.runsOnPlay(p)
    const run = runnerEvents(p)
    line.sb += run.sb; line.cs += run.cs; line.pk += run.pk; line.wp += run.wp; line.pb += run.pb; line.bk += run.bk

    if (partOfNext(p, next)) continue
    const seq = p.pitch_sequence ?? ''
    if (league.isPlateAppearance(p)) {
      // The row Game Center opens on: the pitcher's first batter. Substitutions and other rows with
      // no at-bat are not drawn as rows there, so a link to one would scroll to nothing.
      if (line.bf === 0) line.sequence = p.sequence
      line.bf++
    }
    const ev = p.event_type
    if (ev === 'strikeout') line.so++
    else if (ev === 'walk') line.bb++
    else if (ev === 'hit_by_pitch') line.hbp++
    else if (ev && HITS.has(ev)) { line.h++; if (ev === 'home_run') line.hr++ }

    for (const ch of seq) {
      // A letter the league does not know is still a pitch thrown; it is just not counted a strike.
      const kind = league.pitchCodes[ch]
      line.pitches++
      if (kind && kind !== 'ball' && kind !== 'hbp') line.strikes++
    }
  }
  return [...lines.values()]
}

/**
 * One trip to the plate, the finder's finest grain: "a home run on 0-2", "a 10-pitch at-bat", "a
 * bases-loaded walk". One line serves both sides; the finder files it under the batter on Hitting
 * and the pitcher on Pitching (`runFinder`).
 *
 * THE COUNT IS THE ONE BEFORE THE LAST PITCH, which is what "on 0-2" means: the pitch that ended it
 * is the result, and the count it was thrown in is the situation. Read off the league's own pitch
 * letters with the foul rule (a foul is a strike only below two), the way `readSequence` reads them.
 *
 * WHAT IT CARRIES is what the play log states for one plate appearance and nothing it would have to
 * guess: the event, the outs and runners it began with, the pitches, and the runs that scored on it
 * (`League.runsOnPlay`, never the column). No RBI, since the log does not say which runs a batter
 * drove in (an error or a wild pitch on the same play scores runs that are not), and no earned runs.
 *
 * A WALK-OFF is the last run of a game the home side won, scored in the bottom of its last half.
 * The bottom of a game's last inning is only played while the home side is not ahead, so any home
 * win whose last run came there came on that play.
 */
export interface PlateAppearanceLine {
  /** `${game_id}|${sequence}`. */
  id: string
  game_id: string
  sequence: number
  inning: number
  half: 'top' | 'bottom'
  batter_id: string | null
  pitcher_id: string | null
  /** The batting club, and the club in the field. */
  batting_team: string | null
  fielding_team: string | null
  /** The feed's event, as a box score abbreviates it ("HR", "K", "BB"); null when it named none. */
  event: string | null
  /** Outs when the plate appearance began, and runners on base. */
  paouts: number
  on: number
  /** One with a runner on second or third (in scoring position), else zero. */
  risp: number
  /** The count before the last pitch. */
  balls: number
  scount: number
  pitches: number
  strikes: number
  fouls: number
  /** One when the play was this, else zero, so a condition reads "at least 1". */
  h: number
  doubles: number
  triples: number
  hr: number
  tb: number
  bb: number
  so: number
  hbp: number
  /** Runs that scored on the play. */
  runs: number
  walkoff: number
  /**
   * RUNS OF PLAYS, each counted ONCE, on the run's last plate appearance and zero everywhere else, so
   * "back-to-back home runs" matches a run of three once rather than twice, and the board's highest
   * first order lists the longest run first. `hrrow`: the batting club's home runs in a row within the
   * half-inning (a solo one is 1). `krow` and `retired`: the pitcher's strikeouts and batters retired
   * in a row within the game, across innings.
   */
  hrrow: number
  krow: number
  retired: number
}

/**
 * A BATTER IS RETIRED when the plate appearance made an out and the batter did not reach: no hit, walk,
 * hit batter or fielder's choice. Read off the outs rather than the event, because the event misleads
 * both ways: an infield fly arrives as `unknown`, a batter safe on an error is `unknown` too, and a
 * strikeout can reach on a dropped third strike. A double play counts once, as one batter.
 */
const reached = (l: PlateAppearanceLine) => l.h + l.bb + l.hbp > 0 || l.event === 'FC'

/** Sets `field` on the last line of each run of `hit` lines sharing a `group`, to the run's length. */
function markRuns(lines: PlateAppearanceLine[], group: (l: PlateAppearanceLine) => string | null,
  hit: (l: PlateAppearanceLine, i: number) => boolean, field: 'hrrow' | 'krow' | 'retired') {
  const run = new Map<string, { n: number; last: number }>()
  const close = (key: string) => {
    const r = run.get(key)
    if (r && r.n > 0) lines[r.last][field] = r.n
    run.delete(key)
  }
  lines.forEach((l, i) => {
    const key = group(l)
    if (key == null) return
    if (!hit(l, i)) { close(key); return }
    const r = run.get(key) ?? { n: 0, last: i }
    run.set(key, { n: r.n + 1, last: i })
  })
  for (const key of [...run.keys()]) close(key)
}

const EVENT_CODE: Record<string, string> = {
  single: '1B', double: '2B', triple: '3B', home_run: 'HR', walk: 'BB', strikeout: 'K', hit_by_pitch: 'HBP',
  groundout: 'GO', flyout: 'FO', lineout: 'LO', popup: 'PO', foul_out: 'FO', fielders_choice: 'FC',
  sacrifice: 'SAC', out: 'Out',
}
const BASES: Record<string, number> = { single: 1, double: 2, triple: 3, home_run: 4 }
const onBase = (v: string | null) => (v ? 1 : 0)

/** Every plate appearance in the plays handed in. `games` says which club is in the field and how a
 *  game ended (for the walk-off); a play whose game is missing is skipped, as above. */
export function plateAppearanceLines(league: League, plays: RunValuePlay[], games: LeagueGame[]): PlateAppearanceLine[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  const sorted = inOrder(plays, gameById)

  // Each game's last run-scoring row, and its last half-inning.
  const lastRun = new Map<string, number>()
  const lastHalf = lastHalves(sorted)
  for (const p of sorted) if (league.runsOnPlay(p) > 0) lastRun.set(p.game_id, p.sequence)

  const out: PlateAppearanceLine[] = []
  // The outs each plate appearance made, beside `out`, for who was retired.
  const outsMade: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    if (!league.isPlateAppearance(p) || partOfNext(p, sorted[i + 1])) continue
    const g = gameById.get(p.game_id)!
    const seq = p.pitch_sequence ?? ''
    let balls = 0, scount = 0, strikes = 0, fouls = 0
    for (let j = 0; j < seq.length; j++) {
      const kind = league.pitchCodes[seq[j]]
      if (kind === 'foul') fouls++
      if (kind && kind !== 'ball' && kind !== 'hbp') strikes++
      if (j === seq.length - 1) break
      if (kind === 'ball') balls++
      else if (kind === 'called' || kind === 'swinging' || (kind === 'foul' && scount < 2)) scount++
    }
    const ev = p.event_type ?? ''
    const runs = league.runsOnPlay(p)
    const homeWon = g.home_score != null && g.away_score != null && g.home_score > g.away_score
    outsMade.push(Math.max(0, outsAfterRow(sorted, i, lastHalf, g) - p.outs))
    out.push({
      id: `${p.game_id}|${p.sequence}`, game_id: p.game_id, sequence: p.sequence, inning: p.inning, half: p.half,
      batter_id: p.batter_id, pitcher_id: p.pitcher_id,
      batting_team: p.half === 'top' ? g.away_team_id : g.home_team_id,
      fielding_team: p.half === 'top' ? g.home_team_id : g.away_team_id,
      event: EVENT_CODE[ev] ?? null,
      paouts: p.outs, on: onBase(p.first_base) + onBase(p.second_base) + onBase(p.third_base),
      risp: onBase(p.second_base) || onBase(p.third_base),
      balls: Math.min(balls, 3), scount: Math.min(scount, 2), pitches: seq.length, strikes, fouls,
      h: HITS.has(ev) ? 1 : 0, doubles: ev === 'double' ? 1 : 0, triples: ev === 'triple' ? 1 : 0,
      hr: ev === 'home_run' ? 1 : 0, tb: BASES[ev] ?? 0,
      bb: ev === 'walk' ? 1 : 0, so: ev === 'strikeout' ? 1 : 0, hbp: ev === 'hit_by_pitch' ? 1 : 0,
      runs,
      walkoff: homeWon && runs > 0 && p.half === 'bottom' && halfKey(p) === lastHalf.get(p.game_id)
        && lastRun.get(p.game_id) === p.sequence ? 1 : 0,
      hrrow: 0, krow: 0, retired: 0,
    })
  }
  markRuns(out, l => `${l.game_id}|${l.inning}|${l.half}`, l => l.hr > 0, 'hrrow')
  const byPitcher = (l: PlateAppearanceLine) => (l.pitcher_id ? `${l.game_id}|${l.pitcher_id}` : null)
  markRuns(out, byPitcher, l => l.so > 0, 'krow')
  markRuns(out, byPitcher, (l, i) => outsMade[i] > 0 && !reached(l), 'retired')
  return out
}

/**
 * One club's half-inning at the plate: "innings with 5+ runs", "two-out rallies", comebacks.
 *
 * THE BATTING SIDE'S INNING, where `InningPitchingLine` is the fielding side's pitcher's. One line per
 * half-inning, whoever pitched it, filed under the club batting. It carries the batting line's own
 * property names (`r`, `h`, `hr`, `bb`, `so`, and `ab`/`sh` so a plate-appearance sum reads as on a
 * box-score line), so the finder's Hitting fields read it unchanged.
 *
 * THE SCORE IS THE LOG'S OWN RUNNING SUM, from the first play of the game. `trail` is how far the club
 * was behind as the half began, and `tooklead` whether it ended the half in front having started it
 * level or behind: a comeback is both. A game whose log is missing runs (runExpectancy.ts says how
 * that happens) runs its sum short from that point, so a lead read off it can be wrong there; the line
 * score cannot fix it, since it says how many runs an inning scored but not when.
 */
export interface TeamInningLine {
  /** `${game_id}|${inning}|${half}`. */
  id: string
  game_id: string
  /** The club batting. */
  team_id: string
  inning: number
  half: 'top' | 'bottom'
  /** The half's first plate appearance (its first row, when there is none): where Game Center opens. */
  sequence: number
  r: number
  h: number
  doubles: number
  triples: number
  hr: number
  tb: number
  bb: number
  so: number
  hbp: number
  /** Plate appearances less walks, hit batters and sacrifices, and the sacrifices, so `ab + bb + hbp +
   *  sf + sh` is the plate appearances the half sent up, as the finder sums them on a batting line. */
  ab: number
  sh: number
  sf: number
  /** Runs that scored on plays begun with two out. */
  r2: number
  /** Runs behind as the half began; zero when level or ahead. */
  trail: number
  /** One when the club started the half level or behind and ended it in front. */
  tooklead: number
  /** The club's runners: bases stolen (home among them), caught stealing and picked off (`runnerEvents`). */
  sb: number
  sbh: number
  cs: number
  pk: number
}

/** The nine positions as the log writes them, in scorer's order, so a position's number is its index + 1. */
export const FIELD_POSITIONS = ['p', 'c', '1b', '2b', '3b', 'ss', 'lf', 'cf', 'rf'] as const
const POS = '(p|c|1b|2b|3b|ss|lf|cf|rf)'

/** What a section knows that the plays do not: where each starter played, and who a name is. */
export interface FielderSource {
  /** Each game's lineups: the position a player started at (`started`), written as the lineup card
   *  writes it, the first of "lf/p" being where she began. */
  starts: { game_id: string; team_id: string | null; player_id: string; position: string | null; started: boolean }[]
  /** The player a name is, or null. Names are unique in the league (checked Nov 7, 2026). */
  byName: (name: string) => string | null
  /** The club a player played for in a game, off that game's lines. */
  teamOf: (gameId: string, playerId: string) => string | null
}

/**
 * ONE FIELDER'S HALF-INNING: Fielding's inning grain, a fielder's as a pitcher's inning is a pitcher's.
 *
 * THE LOG CHARGES A POSITION, NOT A PLAYER ("throwing error by ss"), so the fielder is whoever held
 * that position at that play: the lineup card's starters, then every change the log writes as a row
 * of its own ("Jua Park to 2b for Amanda Gianelloni", "Kelsie Whitmore to cf"), and the pitcher always
 * the play's own pitcher, since in a game with a designated hitter the pitcher is on no lineup card.
 * An error is counted where the text charges one ("error by", "dropped fly by", "muffed throw by"),
 * never where it only mentions one: "advanced to second on the error" is the same error again. Every
 * fielder in a double play's chain ("double play ss to 2b to 1b") turned it, as the box score credits
 * each. The catcher's passed balls and the steals against her go to whoever was catching.
 *
 * A position nobody can be placed at (a card that does not list it, a change the log does not write)
 * leaves that play uncredited rather than guessed. Against 2026's box scores: see the tests.
 */
export interface FieldingInningLine {
  /** `${game_id}|${inning}|${half}|${player_id}`. */
  id: string
  game_id: string
  /** The fielder. */
  player_id: string
  /** The club in the field. */
  team_id: string
  inning: number
  half: 'top' | 'bottom'
  /** The fielder's first play in the half: where Game Center opens. */
  sequence: number
  /** Where the fielder was playing at their first play of the half, as the position's number (1 to 9). */
  pos: number
  e: number
  dp: number
  pb: number
  /** Steals against the fielder, when catching. */
  sba: number
}

export function fieldingInningLines(plays: RunValuePlay[], games: LeagueGame[], src: FielderSource): FieldingInningLine[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  // Who is at each position, per club in each game, as of the play being read.
  const align = new Map<string, Map<string, string>>()
  const at = (game: string, team: string) => {
    const key = `${game}|${team}`
    let m = align.get(key)
    if (!m) { m = new Map(); align.set(key, m) }
    return m
  }
  for (const r of src.starts) {
    const first = r.position?.split('/')[0] ?? ''
    if (!r.started || !r.team_id || !gameById.has(r.game_id) || first === 'p' || !(FIELD_POSITIONS as readonly string[]).includes(first)) continue
    at(r.game_id, r.team_id).set(first, r.player_id)
  }
  const lines = new Map<string, FieldingInningLine>()
  const credit = (p: RunValuePlay, team: string, pos: string, playerId: string | null | undefined): FieldingInningLine | null => {
    if (!playerId) return null
    const id = `${halfKey(p)}|${playerId}`
    let line = lines.get(id)
    if (!line) {
      line = {
        id, game_id: p.game_id, player_id: playerId, team_id: team, inning: p.inning, half: p.half,
        sequence: p.sequence, pos: FIELD_POSITIONS.indexOf(pos as typeof FIELD_POSITIONS[number]) + 1, e: 0, dp: 0, pb: 0, sba: 0,
      }
      lines.set(id, line)
    }
    return line
  }
  const sub = new RegExp(`^\\s*(.+?) to ${POS.slice(0, -1)}|dh)(?: for (.+?))?\\.?\\s*$`, 'i')
  for (const p of inOrder(plays, gameById)) {
    const g = gameById.get(p.game_id)!
    const fielding = p.half === 'top' ? g.home_team_id : g.away_team_id
    const raw = p.narrative ?? ''
    // A CHANGE IN THE FIELD: the named player takes the position, and leaves the one she held.
    const change = !p.pitch_sequence ? raw.match(sub) : null
    if (change) {
      const playerId = src.byName(change[1])
      const pos = change[2].toLowerCase()
      const team = playerId ? src.teamOf(p.game_id, playerId) : null
      if (playerId && team && pos !== 'p' && pos !== 'dh') {
        const m = at(p.game_id, team)
        for (const [k, v] of m) if (v === playerId) m.delete(k)
        m.set(pos, playerId)
      } else if (playerId && team && pos === 'p') {
        // To the mound: the position she held is open until a change fills it.
        const m = at(p.game_id, team)
        for (const [k, v] of m) if (v === playerId) m.delete(k)
      }
      continue
    }
    const text = raw.toLowerCase()
    const who = (pos: string) => (pos === 'p' ? p.pitcher_id : at(p.game_id, fielding).get(pos))
    for (const m of text.matchAll(new RegExp(`(?:error|dropped \\w+|muffed \\w+) by ${POS}\\b`, 'g'))) {
      const line = credit(p, fielding, m[1], who(m[1]))
      if (line) line.e++
    }
    for (const m of text.matchAll(new RegExp(`double play ((?:${POS}(?: to )?)+)`, 'g'))) {
      for (const pos of new Set(m[1].trim().split(/\s+to\s+/))) {
        const line = credit(p, fielding, pos, who(pos))
        if (line) line.dp++
      }
    }
    const run = runnerEvents(p)
    if (run.pb || run.sb) {
      const line = credit(p, fielding, 'c', who('c'))
      if (line) { line.pb += run.pb; line.sba += run.sb }
    }
  }
  return [...lines.values()]
}

/** A name as it is compared: no accents, no case, single spaces. */
const foldName = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * WHO A RUNNER'S CLAUSE IS ABOUT. The log names a runner only by name ("Hyeonah Kim out at second c to
 * ss, picked off"), never by id. But every runner reached base as a batter, and the log gives each
 * batter's name AND id, so the names a club sent to the plate in a game are the runners it can have,
 * and a clause is the runner whose name it starts with (the longest, so "Kim" never beats "Hyeonah
 * Kim"). A pinch runner who never batted is not among them and stays unnamed, which costs that one
 * play rather than guessing. On 2026's log every pickoff resolves (6 of 6).
 */
export function runnerResolver(plays: RunValuePlay[]): (p: RunValuePlay) => { id: string; clause: string }[] {
  const byClub = new Map<string, { name: string; id: string }[]>()
  for (const p of plays) {
    if (!p.batter_id || !p.batter_name || !p.team_id) continue
    const key = `${p.game_id}|${p.team_id}`
    const list = byClub.get(key) ?? []
    const name = foldName(p.batter_name)
    if (!list.some(x => x.id === p.batter_id)) list.push({ name, id: p.batter_id })
    byClub.set(key, list)
  }
  for (const list of byClub.values()) list.sort((a, b) => b.name.length - a.name.length)
  return p => {
    const names = byClub.get(`${p.game_id}|${p.team_id}`) ?? []
    return (p.narrative ?? '').split(';').flatMap(raw => {
      const clause = foldName(raw)
      const who = names.find(n => clause.startsWith(`${n.name} `))
      return who ? [{ id: who.id, clause }] : []
    })
  }
}

/** One player's play-log counts in one game (`playTotals`). */
export interface PlayTotals {
  /** A pitcher's pickoffs. */
  pk: number
  /** A batter's pitches seen. */
  pitches: number
  /** A runner's times picked off. */
  pko: number
  /** A runner's steals of home. */
  sbh: number
}

/**
 * Each player's play-log counts in each game, for a game or a season of the counts no box score
 * carries: a pitcher's pickoffs (`runnerEvents`, credited to the pitcher on the row), a batter's
 * pitches seen (the plate appearances' own pitch counts, so a row that was the start of the next one
 * is not counted twice), and a runner's pickoffs and steals of home (`runnerResolver`). Keyed
 * `${game_id}|${player_id}`.
 */
export function playTotals(league: League, plays: RunValuePlay[], games: LeagueGame[]): Map<string, PlayTotals> {
  const out = new Map<string, PlayTotals>()
  const at = (game: string, player: string) => {
    const key = `${game}|${player}`
    let t = out.get(key)
    if (!t) { t = { pk: 0, pitches: 0, pko: 0, sbh: 0 }; out.set(key, t) }
    return t
  }
  const gameIds = new Set(games.map(g => g.id))
  const runners = runnerResolver(plays)
  for (const p of plays) {
    if (!gameIds.has(p.game_id)) continue
    const pk = runnerEvents(p).pk
    if (pk && p.pitcher_id) at(p.game_id, p.pitcher_id).pk += pk
    if (!/picked off|stole home/i.test(p.narrative ?? '')) continue
    for (const { id, clause } of runners(p)) {
      if (/\bpicked off\b/.test(clause)) at(p.game_id, id).pko++
      if (/\bstole home\b/.test(clause)) at(p.game_id, id).sbh++
    }
  }
  for (const l of plateAppearanceLines(league, plays, games)) {
    if (l.batter_id) at(l.game_id, l.batter_id).pitches += l.pitches
  }
  return out
}

export function teamInningLines(league: League, plays: RunValuePlay[], games: LeagueGame[]): TeamInningLine[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  const sorted = inOrder(plays, gameById)
  const out: TeamInningLine[] = []
  let gameId = ''
  let score = { top: 0, bottom: 0 }
  let line: TeamInningLine | null = null
  let before = { us: 0, them: 0 }
  const close = () => {
    if (!line) return
    const us = score[line.half], them = score[line.half === 'top' ? 'bottom' : 'top']
    line.tooklead = before.us <= before.them && us > them ? 1 : 0
    out.push(line)
    line = null
  }
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    if (p.game_id !== gameId) { close(); gameId = p.game_id; score = { top: 0, bottom: 0 } }
    const g = gameById.get(p.game_id)!
    const id = halfKey(p)
    if (line?.id !== id) {
      close()
      const us = score[p.half], them = score[p.half === 'top' ? 'bottom' : 'top']
      before = { us, them }
      line = {
        id, game_id: p.game_id, team_id: p.half === 'top' ? g.away_team_id : g.home_team_id,
        inning: p.inning, half: p.half, sequence: p.sequence,
        r: 0, h: 0, doubles: 0, triples: 0, hr: 0, tb: 0, bb: 0, so: 0, hbp: 0, ab: 0, sh: 0, sf: 0, r2: 0,
        trail: Math.max(0, them - us), tooklead: 0, sb: 0, sbh: 0, cs: 0, pk: 0,
      }
    }
    const l = line!
    const run = runnerEvents(p)
    l.sb += run.sb; l.sbh += run.sbh; l.cs += run.cs; l.pk += run.pk
    const runs = league.runsOnPlay(p)
    l.r += runs
    if (p.outs === 2) l.r2 += runs
    score[p.half] += runs
    if (!league.isPlateAppearance(p) || partOfNext(p, sorted[i + 1])) continue
    if (l.ab + l.bb + l.hbp + l.sh === 0) l.sequence = p.sequence
    const ev = p.event_type ?? ''
    if (ev === 'walk') l.bb++
    else if (ev === 'hit_by_pitch') l.hbp++
    else if (ev === 'sacrifice') l.sh++
    else l.ab++
    if (ev === 'strikeout') l.so++
    if (HITS.has(ev)) {
      l.h++; l.tb += BASES[ev]
      if (ev === 'double') l.doubles++
      else if (ev === 'triple') l.triples++
      else if (ev === 'home_run') l.hr++
    }
  }
  close()
  return out
}
