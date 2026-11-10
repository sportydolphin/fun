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
}

const HITS = new Set(['single', 'double', 'triple', 'home_run'])

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

export function inningPitchingLines(league: League, plays: RunValuePlay[], games: LeagueGame[]): InningPitchingLine[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  const sorted = inOrder(plays, gameById)

  // The last half-inning of each game, which is the only one that can end on something other than
  // a third out.
  const lastHalf = new Map<string, string>()
  for (const p of sorted) lastHalf.set(p.game_id, halfKey(p))

  const lines = new Map<string, InningPitchingLine>()
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    const g = gameById.get(p.game_id)!
    const key = halfKey(p)
    const next = sorted[i + 1]
    const sameHalf = next != null && halfKey(next) === key

    let outsAfter: number
    if (sameHalf) outsAfter = next.outs
    else if (key !== lastHalf.get(p.game_id)) outsAfter = 3
    else {
      // The game's last half-inning. A top half, or a bottom half the home side did not win, ended
      // on the third out; a bottom half the home side won ended on the winning run.
      const walkOff = p.half === 'bottom' && g.home_score != null && g.away_score != null && g.home_score > g.away_score
      outsAfter = walkOff ? p.outs : 3
    }

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
      }
      lines.set(id, line)
    }

    line.outs += Math.max(0, outsAfter - p.outs)
    line.r += league.runsOnPlay(p)

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
  const lastHalf = new Map<string, string>()
  for (const p of sorted) {
    if (league.runsOnPlay(p) > 0) lastRun.set(p.game_id, p.sequence)
    lastHalf.set(p.game_id, halfKey(p))
  }

  const out: PlateAppearanceLine[] = []
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
    out.push({
      id: `${p.game_id}|${p.sequence}`, game_id: p.game_id, sequence: p.sequence, inning: p.inning, half: p.half,
      batter_id: p.batter_id, pitcher_id: p.pitcher_id,
      batting_team: p.half === 'top' ? g.away_team_id : g.home_team_id,
      fielding_team: p.half === 'top' ? g.home_team_id : g.away_team_id,
      event: EVENT_CODE[ev] ?? null,
      paouts: p.outs, on: onBase(p.first_base) + onBase(p.second_base) + onBase(p.third_base),
      balls: Math.min(balls, 3), scount: Math.min(scount, 2), pitches: seq.length, strikes, fouls,
      h: HITS.has(ev) ? 1 : 0, doubles: ev === 'double' ? 1 : 0, triples: ev === 'triple' ? 1 : 0,
      hr: ev === 'home_run' ? 1 : 0, tb: BASES[ev] ?? 0,
      bb: ev === 'walk' ? 1 : 0, so: ev === 'strikeout' ? 1 : 0, hbp: ev === 'hit_by_pitch' ? 1 : 0,
      runs,
      walkoff: homeWon && runs > 0 && p.half === 'bottom' && halfKey(p) === lastHalf.get(p.game_id)
        && lastRun.get(p.game_id) === p.sequence ? 1 : 0,
    })
  }
  return out
}
