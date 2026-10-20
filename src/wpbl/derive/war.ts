import {
  aggregateBatting, aggregatePitching, sumBatting, sumPitching, plateAppearances, fip, fipConstant,
  ERA_BASIS_CANONICAL,
} from '../stats'
import { countsInStandings } from '../../league/season'
import { wobaWeights, fipWeights, wobaContext, woba, isInfieldFly } from './linearWeights'
import { doublePlayWorth, readDoublePlay, type FieldPosition, type FieldingLedger } from './fielding'
import type { CatcherArmLine } from './catching'
import { baserunningRuns, timesOnFirst, type BaserunningLine, type BaserunningRuns } from './baserunning'
import type { PlayRunValue, ReTable } from './runExpectancy'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

/**
 * Wins above replacement for the WPBL, built the way FanGraphs builds theirs, from nothing but the
 * league's own box scores and play log. Nobody publishes a WAR for this league, so this one has to
 * say exactly what it is: docs/WAR.md is the long version, and every constant below names its
 * source.
 *
 * A PLAYER'S WAR IS RUNS, THEN WINS:
 *
 *   batting      wRAA, from wOBA on this league's own weights (linearWeights.ts)
 *   baserunning  steals against the league's rate per time on first (wSB), extra bases and
 *                tag-ups (baserunning.ts), and double plays hit into against the league's rate
 *   fielding     range, errors, double plays, outfield arms, the catcher's arm and blocking
 *                (fielding.ts, catching.ts), each centered on the average at the position per out
 *   positional   FanGraphs' scale, per out at each position, resized to this run environment
 *   league       whatever makes the four above sum to zero across the league, per PA
 *   replacement  the runs a freely available player would have cost, per PA
 *   pitching     ifFIP against the league, per inning, plus pitching's own replacement runs
 *
 * and the sum divided by this league's runs per win.
 *
 * REPLACEMENT LEVEL IS THE INDUSTRY'S. FanGraphs and Baseball-Reference agreed in 2013 on a team
 * of replacement players winning 29.4% of its games, which puts 1,000 WAR across a 2,430-game MLB
 * season. The same rate here is 0.206 WAR per team-game, about 12 for 2026, split 57% to
 * position players by plate appearances and 43% to pitchers by innings, the same split.
 *
 * RUNS PER WIN ARE THIS LEAGUE'S. A run is worth less where runs are plentiful, and the WPBL
 * scored about 7.9 a team a game in 2026 against MLB's 4.5, so a win cost about 14 runs here
 * against MLB's 10. Pythagenpat's exponent, differentiated at .500, gives it exactly.
 *
 * REGULAR SEASON ONLY, like every engine it reads.
 */

/** FanGraphs' positional adjustments, runs per 162 games (1,458 innings) at the position. */
export const POSITIONAL_RUNS_MLB: Record<FieldPosition | 'dh', number> = {
  c: 12.5, '1b': -12.5, '2b': 2.5, '3b': 2.5, ss: 7.5, lf: -7.5, cf: 2.5, rf: -7.5, dh: -17.5,
  // A pitcher's fielding carries no adjustment, as in FanGraphs: their value is pitching.
  p: 0,
}
const MLB_OUTS_PER_SEASON = 162 * 27
/** The environment the scale was set in: about 4.5 runs a team a game, so 0.17 runs an out and
 *  0.12 a plate appearance. The scale is resized by this league's own rates against these. */
const MLB_RUNS_PER_OUT = 0.17
const MLB_RUNS_PER_PA = 0.12
/** A designated hitter's season in plate appearances, the unit the DH's adjustment is spent in. */
const MLB_DH_PA = 680

/** Wins above replacement per team-game: 1,000 WAR over 2,430 games, two teams a game. */
export const WAR_PER_TEAM_GAME = 1000 / 2430 / 2
export const POSITION_SHARE = 0.57

/** Runs per win at this run environment: Pythagenpat's slope at .500. `r` is runs per team-game. */
export function runsPerWin(r: number): number {
  const x = Math.pow(2 * r, 0.287)
  return (4 * r) / x
}

export interface WarLine {
  playerId: string
  pa: number
  /** Outs pitched. */
  outs: number
  /** Runs, each from the batting side's or the fielding side's own good. */
  bat: number
  /** Steals, extra bases and tag-ups, and `gdp` inside it. */
  bsr: number
  gdp: number
  /** The glove, each part centered on the average at the position. `fld` is their sum. */
  rng: number
  err: number
  dp: number
  ofArm: number
  cArm: number
  cBlk: number
  fld: number
  /** The part of `fld` earned on the mound, which counts toward pitching WAR: fielding the
   *  position is part of a pitcher's job, and a pure pitcher has no position-player WAR. */
  fldP: number
  pos: number
  lgAdj: number
  /** Replacement runs as a hitter, and as a pitcher. */
  repBat: number
  repPit: number
  /** Pitching runs above average, from FIP. */
  pit: number
  /** Wins: position player, pitcher, and the two together. */
  batWar: number
  pitWar: number
  war: number
}

export interface WarSeason {
  lines: Map<string, WarLine>
  /** The constants this season was measured with, for the methodology note and the tests. */
  context: { runsPerWin: number; teamGames: number; totalWar: number; runsPerOut: number; runsPerPa: number }
}

export interface WarInput {
  values: readonly PlayRunValue[]
  table: ReTable
  games: WpblGame[]
  players: WpblPlayer[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  /** The runners, from `baserunningLeaders`, raw: `centeredBaserunning` centers the steals. */
  baserunning: readonly BaserunningLine<WpblPlayer>[]
  ledger: FieldingLedger
  arm: readonly CatcherArmLine<unknown>[]
}

/** BsR for a season: `baserunningRuns` over the season's hitters. `batting` is the season's
 *  lines; the schedule keeps the postseason out, as in every aggregate. `gdp` is
 *  `doublePlayRuns`; WAR leaves it out here and adds it to every line it keys, the roster's or not. */
export function centeredBaserunning(
  runners: readonly BaserunningLine<WpblPlayer>[],
  players: WpblPlayer[],
  batting: WpblBattingLine[],
  games: WpblGame[],
  gdp?: ReadonlyMap<string, number>,
): BaserunningRuns<WpblPlayer>[] {
  // The club of the player's last line in the season, for a row with no runner event to take it from.
  const club = new Map<string, string>()
  for (const l of batting) if (l.team_id) club.set(l.player_id, l.team_id)
  const hitters = aggregateBatting(players, batting, games, 'regular')
    .map(s => ({ player: s.player, onFirst: timesOnFirst(s.totals), teamId: club.get(s.player.id) ?? null }))
  return baserunningRuns([...runners], hitters, timesOnFirst(sumBatting(batting, games, 'regular')), gdp)
}

/**
 * Runs per batter on double plays hit into, against the league's rate (FanGraphs' wGDP), the third
 * part of BsR. A chance is a plate appearance with a runner on first and fewer than two out; a
 * double play hit into costs what `doublePlayWorth` says the second out was worth, on average.
 * Keyed by the play's batter id, every one of them, as WAR has always counted them.
 */
export function doublePlayRuns(values: readonly PlayRunValue[], table: ReTable): Map<string, number> {
  const chances = new Map<string, { opp: number; gidp: number }>()
  let opp = 0, gidp = 0, worth = 0
  for (const v of values) {
    const p = v.play
    if (!p.pitch_sequence || !p.batter_id || v.outs >= 2 || !(v.bases & 1)) continue
    const c = chances.get(p.batter_id) ?? { opp: 0, gidp: 0 }
    c.opp++; opp++
    const dp = p.narrative ? readDoublePlay(p.narrative) : null
    if (dp?.ground) {
      c.gidp++; gidp++
      worth += doublePlayWorth(v, table, true) ?? 0
    }
    chances.set(p.batter_id, c)
  }
  const out = new Map<string, number>()
  if (opp > 0 && gidp > 0) {
    const rate = gidp / opp, cost = worth / gidp
    for (const [id, c] of chances) out.set(id, (rate * c.opp - c.gidp) * cost)
  }
  return out
}

export function warSeason(input: WarInput): WarSeason | null {
  const { values, table, games, players, batting, pitching, baserunning, ledger, arm } = input
  const regular = games.filter(g => g.status === 'final' && countsInStandings(g))
  if (regular.length === 0) return null
  const teamGames = regular.length * 2
  const lgRuns = regular.reduce((n, g) => n + (g.home_score ?? 0) + (g.away_score ?? 0), 0)
  const rpw = runsPerWin(lgRuns / teamGames)

  const lgBat = sumBatting(batting, games, 'regular')
  const lgPit = sumPitching(pitching, games, 'regular')
  const lgPa = plateAppearances(lgBat)
  if (lgPa === 0 || lgPit.outs === 0) return null
  const runsPerOut = lgPit.r / lgPit.outs
  const runsPerPa = lgPit.r / lgPa

  const lines = new Map<string, WarLine>()
  const line = (id: string) => {
    let l = lines.get(id)
    if (!l) {
      lines.set(id, l = {
        playerId: id, pa: 0, outs: 0, bat: 0, bsr: 0, gdp: 0, rng: 0, err: 0, dp: 0, ofArm: 0, cArm: 0,
        cBlk: 0, fld: 0, fldP: 0, pos: 0, lgAdj: 0, repBat: 0, repPit: 0, pit: 0, batWar: 0, pitWar: 0, war: 0,
      })
    }
    return l
  }

  // ── Batting: wRAA ──────────────────────────────────────────────────────────────
  const wW = wobaWeights(values as PlayRunValue[])
  const wCtx = wobaContext(lgBat, wW)
  for (const s of aggregateBatting(players, batting, games, 'regular')) {
    const pa = plateAppearances(s.totals)
    if (pa === 0) continue
    const l = line(s.player.id)
    l.pa = pa
    const w = woba(s.totals, wW, wCtx)
    if (w != null && wCtx) l.bat = ((w - wCtx.lgWoba) / wCtx.scale) * pa
  }

  // ── Baserunning, and double plays hit into ────────────────────────────────────
  // BsR, from `baserunningRuns` (baserunning.ts), which says why the steals are centered, then the
  // double plays. The same two calls Run value's bases board makes, so the column and the board
  // are one number.
  for (const b of centeredBaserunning(baserunning, players, batting, games)) {
    if (b.player) line(b.player.id).bsr += b.bsr
  }
  for (const [id, g] of doublePlayRuns(values, table)) {
    const l = line(id)
    l.gdp = g
    l.bsr += g
  }

  // ── Fielding, centered per position per out ────────────────────────────────────
  // Errors and double plays per out at the position; outfield arms per runner chance, since a
  // corner outfielder sees fewer runners going first to third than a center fielder does.
  const perPos = new Map<FieldPosition, { outs: number; err: number; dp: number; arm: number; chances: number }>()
  let pitches = 0, blockRuns = 0
  for (const c of ledger.cells) {
    const s = perPos.get(c.pos) ?? { outs: 0, err: 0, dp: 0, arm: 0, chances: 0 }
    s.outs += c.outs; s.err += c.errRuns; s.dp += c.dpRuns; s.arm += c.armRuns; s.chances += c.armChances
    perPos.set(c.pos, s)
    if (c.pos === 'c') { pitches += c.pitches; blockRuns += c.wpPbRuns }
  }
  const blockRate = pitches > 0 ? blockRuns / pitches : 0
  for (const c of ledger.cells) {
    const s = perPos.get(c.pos)!
    const l = line(c.playerId)
    const share = s.outs > 0 ? c.outs / s.outs : 0
    const err = c.errRuns - s.err * share, dp = c.dpRuns - s.dp * share
    l.err += err
    l.dp += dp
    l.rng += c.rangeRuns
    if (c.pos === 'p') l.fldP += err + dp + c.rangeRuns
    l.ofArm += c.armRuns - (s.chances > 0 ? (s.arm * c.armChances) / s.chances : 0)
    if (c.pos === 'c') l.cBlk += blockRate * c.pitches - c.wpPbRuns
    l.pos += (POSITIONAL_RUNS_MLB[c.pos] / MLB_OUTS_PER_SEASON) * (runsPerOut / MLB_RUNS_PER_OUT) * c.outs
  }
  for (const a of arm) line(a.playerId).cArm += a.runs

  // The designated hitter's adjustment, per plate appearance as one: a line that never took the
  // field ("dh", or "ph/dh").
  const dhGames = new Set(batting
    .filter(b => (b.position ?? '').toLowerCase().split('/').every(t => t === 'dh' || t === 'ph' || t === 'pr')
      && (b.position ?? '').toLowerCase().includes('dh'))
    .map(b => `${b.game_id}|${b.player_id}`))
  const dhPa = new Map<string, number>()
  for (const v of values) {
    const p = v.play
    if (p.pitch_sequence && p.batter_id && dhGames.has(`${p.game_id}|${p.batter_id}`)) {
      dhPa.set(p.batter_id, (dhPa.get(p.batter_id) ?? 0) + 1)
    }
  }
  for (const [id, n] of dhPa) {
    line(id).pos += (POSITIONAL_RUNS_MLB.dh / MLB_DH_PA) * (runsPerPa / MLB_RUNS_PER_PA) * n
  }

  // ── Pitching: ifFIP against the league ────────────────────────────────────────
  // FanGraphs' WAR runs on ifFIP, which counts an infield fly as a strikeout, so the weights here
  // pool the two and the constant is rebuilt with the league's infield flies in it. The FIP column
  // on the Pitching side stays plain FIP, as FanGraphs' does.
  const iff = new Map<string, number>()
  let lgIff = 0
  for (const v of values) {
    const id = v.play.pitcher_id
    if (!v.play.pitch_sequence || !id || !isInfieldFly(v.play)) continue
    iff.set(id, (iff.get(id) ?? 0) + 1); lgIff++
  }
  const fW = fipWeights(values as PlayRunValue[], { infieldFlies: true })
  const fC = fipConstant({ ...lgPit, so: lgPit.so + lgIff }, fW)
  for (const s of aggregatePitching(players, pitching, games, 'regular')) {
    if (s.totals.outs === 0) continue
    const l = line(s.player.id)
    l.outs = s.totals.outs
    const f = fip({ ...s.totals, so: s.totals.so + (iff.get(s.player.id) ?? 0) }, fW, fC)
    if (f != null && lgPit.era != null) l.pit = (lgPit.era - f) * (s.totals.outs / 3) / ERA_BASIS_CANONICAL
  }

  // ── League adjustment and replacement ─────────────────────────────────────────
  for (const l of lines.values()) l.fld = l.rng + l.err + l.dp + l.ofArm + l.cArm + l.cBlk
  let sum = 0, pa = 0
  for (const l of lines.values()) { sum += l.bat + l.bsr + l.fld + l.pos; pa += l.pa }
  const totalWar = WAR_PER_TEAM_GAME * teamGames
  const repPerPa = (POSITION_SHARE * totalWar * rpw) / lgPa
  const repPerOut = ((1 - POSITION_SHARE) * totalWar * rpw) / lgPit.outs
  for (const l of lines.values()) {
    l.lgAdj = pa > 0 ? (-sum * l.pa) / pa : 0
    l.repBat = repPerPa * l.pa
    l.repPit = repPerOut * l.outs
    l.batWar = (l.bat + l.bsr + l.fld - l.fldP + l.pos + l.lgAdj + l.repBat) / rpw
    l.pitWar = (l.pit + l.fldP + l.repPit) / rpw
    l.war = l.batWar + l.pitWar
  }

  return { lines, context: { runsPerWin: rpw, teamGames, totalWar, runsPerOut, runsPerPa } }
}
