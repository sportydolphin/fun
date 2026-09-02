import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, fmtRate, fmtTwo,
  scaleToBasis, kRateLabel, ERA_BASIS_CANONICAL,
  type WpblQualifiers, type EraBasis,
} from './stats'
import { outsToIp } from './innings'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine } from './types'

// Where a player sits against the rest of the league, for the percentile strip on her page.
//
// WHY THIS IS RANKED AGAINST QUALIFIED PLAYERS ONLY. A percentile is a statement about a
// population, so the population has to be one a reader would accept as "the league". Ranked
// against everyone who has logged a single line, a pinch-hitter who is 1-for-1 owns a 1.000
// average and the bar says she is the best hitter in the WPBL. The qualifying bar in
// `stats.ts` already exists to answer exactly this question for the leaderboards, and it
// scales with games played, so this reuses it rather than inventing a second definition that
// could disagree with the Stats tab about who leads the league.
//
// A player BELOW the bar gets no strip at all, and the page says why. That is deliberate:
// there is no honest percentile for someone with nine at-bats, and drawing a short bar would
// claim she is bad rather than that we do not know yet.
//
// HOW HONEST IS A PERCENTILE HERE. Less than it looks, and the UI should not oversell it.
// This is a four-club league playing a first season of about 40 games, so a qualified
// population is dozens of players, not hundreds: one good week moves a bar a long way, and
// the difference between the 60th and 70th percentile is a couple of hits. `of` is returned
// with every rank so the caller can print the population size next to the strip, which is the
// one thing that keeps "82nd percentile" from reading like a Statcast page built on
// thousands of batted balls.

export type WpblRankGroup = 'batting' | 'pitching'

export interface WpblStatRankDef {
  key: string
  label: string
  group: WpblRankGroup
  /** Which direction is good. ERA and WHIP are the ones this exists for. */
  better: 'high' | 'low'
}

export interface WpblStatRank extends WpblStatRankDef {
  /** Already formatted for display, so the caller never re-decides precision. */
  display: string
  /** 1 = best in the league. Ties share the better rank, as on the leaderboards. */
  rank: number
  /** Size of the qualified population this rank is against. Print it. */
  of: number
  /** 0 = worst of the qualified, 1 = best. Direction-aware: high is always good. */
  pct: number
  /** The raw number behind `display`, so a caller can sort or threshold on it without
   *  re-parsing a formatted string. `bestCountingRanks` uses it to drop a "1st in the league"
   *  that is really a five-way tie on zero. */
  value: number
}

/** The bars, in render order. Deliberately a short list of stats that say different things:
 *  OPS is already OBP + SLG, so a strip of eight rate stats would draw the same fact three
 *  times and read as more evidence than it is. Strikeouts are here, inverted, because
 *  striking out less is the one thing a contact hitter does that the slash line hides.
 *
 *  As a RATE, never as the raw count. Ranked on raw SO with 'low' better, the bar rewards not
 *  playing: a hitter with 20 at-bats and 2 strikeouts outranks one with 40 and 5, though the
 *  second is the better contact hitter. Every other 'low' stat here is already a rate for the
 *  same reason. HR stays a count because a home-run total is meant to reward playing time,
 *  which is the whole idea of a counting stat. */
export const WPBL_BAT_RANK_DEFS: WpblStatRankDef[] = [
  { key: 'avg', label: 'AVG', group: 'batting', better: 'high' },
  { key: 'obp', label: 'OBP', group: 'batting', better: 'high' },
  { key: 'slg', label: 'SLG', group: 'batting', better: 'high' },
  { key: 'ops', label: 'OPS', group: 'batting', better: 'high' },
  { key: 'hr',  label: 'HR',  group: 'batting', better: 'high' },
  { key: 'k%',  label: 'K%',  group: 'batting', better: 'low'  },
]

/** K/BB is the control stat that ERA and WHIP both blur. The K rate's label is not fixed
 *  here: the reader's innings basis names it, via `kRateLabel`. */
export const WPBL_PIT_RANK_DEFS: WpblStatRankDef[] = [
  { key: 'era',  label: 'ERA',  group: 'pitching', better: 'low'  },
  { key: 'whip', label: 'WHIP', group: 'pitching', better: 'low'  },
  { key: 'k9',   label: 'K/9',  group: 'pitching', better: 'high' },
  { key: 'kbb',  label: 'K/BB', group: 'pitching', better: 'high' },
]

/**
 * The COUNTING ranks, which are a different question and need no qualifying bar.
 *
 * WHY THIS EXISTS. Everything above is ranked against the qualified field, for the good reason
 * at the top of this file: there is no honest batting average for someone with nine at-bats.
 * But that reasoning is about RATES, and it was quietly being applied to the whole card. A
 * counting stat cannot be inflated by a short sample, only deflated: five stolen bases is five
 * stolen bases whether they came in nine games or forty. So the player who gets no strip at
 * all, the one a reader can least place on her own, was being denied the one comparison that
 * would have been perfectly sound for her. Maïka Dumais is 3rd in the WPBL in steals off
 * 28 plate appearances, and until this her page had no way to say it.
 *
 * WHICH IS ALSO WHY THE FIELD IS EVERYONE WHO HAS PLAYED, not the qualified. Ranking a
 * counting stat inside the qualified field would answer "best among the regulars", which is a
 * fact about the bar rather than about the league, and it would drop exactly the players this
 * is for. The population is printed beside the strip in different words from the qualified
 * one, because two strips on one card saying "of 63" and "of 31" must not read as a bug.
 *
 * SO strikeouts are absent, and their absence is the same rule as the note above about K%:
 * a 'low' counting stat rewards not playing, and a hitter with three strikeouts in ten games
 * would lead the league in not striking out. Every stat here is one where more is better and
 * more is earned by playing.
 */
/** THE ORDER IS THE TIEBREAK, so it is the order a reader would ask for these in rather than
 *  the order the box score prints them. Denae Benites is 1st in the league in six of these at
 *  once and the strip shows two, so which two is decided here and nowhere else. It was briefly
 *  decided by raw value instead, which sounds neutral and is not: 54 total bases outranks 9
 *  home runs because total bases is a bigger kind of number, so the naturally-large stats
 *  would have won every tie forever and "led the WPBL in home runs" would never once have been
 *  printed. TB is last for the related reason that it is mostly a restatement of the hits and
 *  homers above it. */
export const WPBL_BAT_COUNT_RANK_DEFS: WpblStatRankDef[] = [
  { key: 'c_hr',  label: 'HR',  group: 'batting', better: 'high' },
  { key: 'c_rbi', label: 'RBI', group: 'batting', better: 'high' },
  { key: 'c_h',   label: 'H',   group: 'batting', better: 'high' },
  { key: 'c_r',   label: 'R',   group: 'batting', better: 'high' },
  { key: 'c_sb',  label: 'SB',  group: 'batting', better: 'high' },
  { key: 'c_2b',  label: '2B',  group: 'batting', better: 'high' },
  { key: 'c_3b',  label: '3B',  group: 'batting', better: 'high' },
  { key: 'c_bb',  label: 'BB',  group: 'batting', better: 'high' },
  { key: 'c_tb',  label: 'TB',  group: 'batting', better: 'high' },
]

/**
 * The pitching equivalents. Losses are absent for the same reason strikeouts are absent above:
 * a rank whose bottom is "has not played" is not a rank.
 *
 * AND SO ARE APPEARANCES, which is the one this list learned the hard way. `G` was here for a
 * day and put "G 6 · 4th of 38" at the top of a reliever's card, which is a fact about a
 * manager's bullpen usage wearing the clothes of an achievement. The test a stat has to pass
 * here is not "does it reward playing time", which all of these do and is what a counting stat
 * is for. It is "did SHE do it". Innings are the edge of that and stay, because a workload is
 * something a pitcher is trusted with and every league prints an innings leaderboard. Games
 * are just how often the phone rang.
 */
export const WPBL_PIT_COUNT_RANK_DEFS: WpblStatRankDef[] = [
  { key: 'c_so',   label: 'SO', group: 'pitching', better: 'high' },
  { key: 'c_outs', label: 'IP', group: 'pitching', better: 'high' },
  { key: 'c_w',    label: 'W',  group: 'pitching', better: 'high' },
  { key: 'c_s',    label: 'SV', group: 'pitching', better: 'high' },
]

/**
 * How high a counting rank has to be before the card says it out loud, and how many it says.
 *
 * BOTH NUMBERS WERE MEASURED, and the naive version of this feature died on the measurement.
 * Lighting every top-3 counting stat, over the 63 batters who had played as of Sep 2, 2026,
 * lit SIX of the ten tiles on the two league leaders' cards and none at all on 53 of the 63.
 * Emphasis that fires hardest on the two players a reader can already place, and not at all
 * on everyone else, is not emphasis. Hence a cap as well as a bar: the cap is what keeps the
 * leaders to a headline instead of a second stat grid, and the bar is what keeps this off the
 * cards where it would mean nothing.
 *
 * Top 5 reaches 19 of the 63. Top 3 reaches 10, which leaves the feature barely present; top
 * 8 reaches 27 but starts naming mid-pack players as though they led something. Re-measure
 * before moving either: both are properties of a 63-player league playing a 40-game season.
 */
export const COUNT_RANK_BAR = 5
export const COUNT_RANK_ROWS = 2
/** And a field big enough for "5th in the league" to mean anything. An absolute bar of 5 says
 *  nothing on its own: in a field of six it is next to last, and in a field of one it makes a
 *  player who has taken four at-bats the league leader in hits. The same reasoning, and nearly
 *  the same number, as `notable()` in derive/playerSummary.ts. The live fields are 68 batters
 *  and 38 pitchers, so this only ever fires early in a season or in a test fixture, which is
 *  exactly when a card would otherwise make its most confident wrong claim. */
export const COUNT_RANK_MIN_FIELD = 10

/**
 * Her best counting ranks worth printing, best first, capped. Empty is the common answer and
 * the caller must draw nothing at all for it, rather than an empty block.
 *
 * `alreadyShown` is the rate strip's own ranks, and passing them is NOT optional hygiene.
 * HR is a counting stat that lives in the rate defs (see the note there: a home-run total is
 * supposed to reward playing time), so it is the one stat that can be ranked twice on one
 * card, against two different fields, with two different ordinals, three rows apart. Matching
 * on LABEL rather than on key is deliberate: the keys differ by construction ('hr' against
 * 'c_hr') and a collision here is a collision in what the reader sees, not in what the code
 * calls it. A below-bar player passes an empty list and loses nothing, which is correct: there
 * is no strip above her for this to collide with.
 *
 * The sort is on rank alone and relies on being stable, so ties fall out in def order. That
 * order is a decision, not an accident. See WPBL_BAT_COUNT_RANK_DEFS.
 */
export function bestCountingRanks(ranks: WpblStatRank[], alreadyShown: WpblStatRank[] = []): WpblStatRank[] {
  const shown = new Set(alreadyShown.map(r => r.label))
  return ranks
    .filter(r => r.of >= COUNT_RANK_MIN_FIELD && r.rank <= COUNT_RANK_BAR && r.value > 0 && !shown.has(r.label))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, COUNT_RANK_ROWS)
}

const FORMAT: Record<string, (n: number) => string> = {
  avg: fmtRate, obp: fmtRate, slg: fmtRate, ops: fmtRate,
  hr: n => String(Math.round(n)), 'k%': n => `${(n * 100).toFixed(1)}%`,
  era: fmtTwo, whip: fmtTwo, k9: n => n.toFixed(1), kbb: n => n.toFixed(2),
  // Counting stats are whole numbers and print as themselves. Innings are the exception: the
  // field is ranked on OUTS, because thirds of an inning do not compare correctly as decimals
  // (6.2 IP is 20 outs and 6.2 is not two thirds), and only the display converts back.
  c_outs: outsToIp,
}

export interface WpblPlayerRanks {
  batting: WpblStatRank[]
  pitching: WpblStatRank[]
  /** Counting ranks, against everyone who has played rather than the qualified field. Present
   *  whatever `batReason` says: that flag is about rate stats, and these are not. */
  battingCounts: WpblStatRank[]
  pitchingCounts: WpblStatRank[]
  /** Qualified population sizes, for the "vs N qualified batters" line. */
  batOf: number
  pitOf: number
  /** The population the counting ranks were taken against: the qualified field when she is in
   *  it, everyone who has played when she is not. Equal to `batOf` in the first case, which is
   *  what lets the merged strip print one population line. */
  batCountOf: number
  pitCountOf: number
  /** Why a strip is missing, so the page can say so instead of rendering nothing. */
  batReason: 'ok' | 'season-young' | 'below-bar' | 'no-data'
  pitReason: 'ok' | 'season-young' | 'below-bar' | 'no-data'
  qualifiers: WpblQualifiers
}

const EMPTY: Omit<WpblPlayerRanks, 'qualifiers'> = {
  batting: [], pitching: [], battingCounts: [], pitchingCounts: [],
  batOf: 0, pitOf: 0, batCountOf: 0, pitCountOf: 0,
  batReason: 'no-data', pitReason: 'no-data',
}

/**
 * Rank one player against the qualified field, per stat.
 *
 * `games` is required for the same reason it is required by every aggregate in `stats.ts`:
 * a box-score line carries only a `game_id`, so it cannot say for itself whether it belongs
 * in a season total, and postseason games must never reach one.
 */
export function computeWpblPlayerRanks(
  playerId: string,
  players: WpblPlayer[],
  teams: WpblTeam[],
  games: WpblGame[],
  battingLines: WpblBattingLine[],
  pitchingLines: WpblPitchingLine[],
  /** What the printed ERA and K rate are shown on. Ordering is basis-invariant, so this
   *  only reaches the `display` strings. */
  basis: EraBasis = ERA_BASIS_CANONICAL,
): WpblPlayerRanks {
  const qualifiers = wpblQualifiers(teams, games)
  if (!qualifiers.active) {
    return { ...EMPTY, batReason: 'season-young', pitReason: 'season-young', qualifiers }
  }

  const batSeasons = aggregateBatting(players, battingLines, games)
  const pitSeasons = aggregatePitching(players, pitchingLines, games)

  const batField = batSeasons.filter(s => plateAppearances(s.totals) >= qualifiers.minPa)
  const pitField = pitSeasons.filter(s => s.totals.outs >= qualifiers.minOuts)

  const batValue = (key: string, t: (typeof batSeasons)[number]['totals']): number | null => {
    switch (key) {
      case 'avg': return t.avg
      case 'obp': return t.obp
      case 'slg': return t.slg
      case 'ops': return t.ops
      case 'hr':  return t.hr
      // K% over plate appearances, sac bunts included: the denominator used to drop them and
      // a bunter's rate read a shade high.
      case 'k%': {
        const pa = plateAppearances(t)
        return pa > 0 ? t.so / pa : null
      }
      // The counting stats, prefixed so they cannot collide with a rate key: 'hr' is already
      // taken above and means the same number ranked against a different field, which is
      // exactly the sort of near-miss that would land silently.
      case 'c_h':   return t.h
      case 'c_r':   return t.r
      case 'c_rbi': return t.rbi
      case 'c_hr':  return t.hr
      case 'c_2b':  return t.doubles
      case 'c_3b':  return t.triples
      case 'c_bb':  return t.bb
      case 'c_sb':  return t.sb
      case 'c_tb':  return t.tb
      default:    return null
    }
  }
  const pitValue = (key: string, t: (typeof pitSeasons)[number]['totals']): number | null => {
    switch (key) {
      // Rescaled, so the printed value under the strip matches the hero stat above it. The
      // ORDER cannot move: both stats are linear in the basis, so every pitcher is scaled by
      // the same factor and the rank is the rank either way.
      case 'era':  return scaleToBasis(t.era, basis)
      case 'whip': return t.whip
      case 'k9':   return scaleToBasis(t.k9, basis)
      case 'kbb':  return t.kbb
      case 'c_so':   return t.so
      // Ranked on outs, displayed as innings. See the note beside `c_outs` in FORMAT.
      case 'c_outs': return t.outs
      case 'c_w':    return t.w
      case 'c_s':    return t.s
      default:     return null
    }
  }

  const batting = rankOne(playerId, batField, WPBL_BAT_RANK_DEFS, batValue)
  // The counting field is EVERYONE WITH A LINE, and the filter is on the appearance rather
  // than on production: a hitter who is 0-for-12 belongs in the population she is being
  // ranked against, or every rank on the card is against a field quietly cleaned of the
  // players below the subject. `aggregateBatting` already returns only players who have a
  // line, so this is the whole of it.
  const inBatField = batField.some(s => s.player.id === playerId)
  const inPitField = pitField.some(s => s.player.id === playerId)

  // AGAINST THE FIELD SHE IS ALREADY BEING COMPARED TO, whichever that is, and this is the
  // whole reason there is one comparison block on the card instead of two.
  //
  // The first version of this always ranked counts against everyone who had played, on the
  // reasoning that a count needs no qualifying bar. True, but it produced a card with "Against
  // the league" over four rate rows and 31 qualified batters, and a second block three rows
  // below headed "Where she ranks" over two counting rows and 68 batters. Two headings that
  // mean the same sentence in English, over the same geometry, differing only by a population
  // the reader has no reason to be holding. The distinction is real in the code and is not a
  // thing to make a reader carry.
  //
  // So the population follows the player. A qualified batter is ranked on everything against
  // the qualified field, and her counting rows merge into the strip she already had under its
  // existing footnote. A batter BELOW the bar has no rate rows to merge into, and her counts
  // are ranked against everyone who has played, because the qualified field is precisely the
  // one she is not in. Each card states its own population once and no card shows two.
  const batCountField = inBatField ? batField : batSeasons
  const pitCountField = inPitField ? pitField : pitSeasons
  const battingCounts = rankOne(playerId, batCountField, WPBL_BAT_COUNT_RANK_DEFS, batValue)
  const pitchingCounts = rankOne(playerId, pitCountField, WPBL_PIT_COUNT_RANK_DEFS, pitValue)
  // The K rate's heading moves with the basis, so it is stamped here rather than left on the
  // def: the strip prints `label` verbatim, and "K/9" over a per-7 number is the one label on
  // the page that can be flatly wrong rather than merely imprecise.
  const pitDefs = WPBL_PIT_RANK_DEFS.map(d => d.key === 'k9' ? { ...d, label: kRateLabel(basis) } : d)
  const pitching = rankOne(playerId, pitField, pitDefs, pitValue)

  const playedBat = batSeasons.some(s => s.player.id === playerId)
  const playedPit = pitSeasons.some(s => s.player.id === playerId)

  return {
    batting, pitching, battingCounts, pitchingCounts,
    batOf: batField.length, pitOf: pitField.length,
    batCountOf: batCountField.length, pitCountOf: pitCountField.length,
    batReason: inBatField ? 'ok' : playedBat ? 'below-bar' : 'no-data',
    pitReason: inPitField ? 'ok' : playedPit ? 'below-bar' : 'no-data',
    qualifiers,
  }
}

/**
 * One player's rank per stat, against a field already filtered to the qualified.
 *
 * A stat whose value is null for the SUBJECT drops out entirely rather than ranking last:
 * K/BB is null when a pitcher has walked nobody, which is the best possible control and
 * would otherwise draw an empty bar meaning the opposite of the truth.
 */
function rankOne<T extends { player: WpblPlayer; totals: unknown }>(
  playerId: string,
  field: T[],
  defs: WpblStatRankDef[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valueOf: (key: string, totals: any) => number | null,
): WpblStatRank[] {
  const subject = field.find(s => s.player.id === playerId)
  if (!subject) return []

  const out: WpblStatRank[] = []
  for (const def of defs) {
    const mine = valueOf(def.key, subject.totals)
    if (mine == null || !Number.isFinite(mine)) continue

    const values: number[] = []
    for (const s of field) {
      const v = valueOf(def.key, s.totals)
      if (v != null && Number.isFinite(v)) values.push(v)
    }
    if (values.length === 0) continue

    // Ties share the better rank, matching the leaderboards: two players on .400 are both
    // 1st, and the next is 3rd.
    const better = def.better === 'high'
      ? values.filter(v => v > mine).length
      : values.filter(v => v < mine).length
    const worse = def.better === 'high'
      ? values.filter(v => v < mine).length
      : values.filter(v => v > mine).length

    // Share of the field this player beats. Everyone tied with her sits at the MIDPOINT of
    // their own block rather than at its bottom, which is what `worse / (n - 1)` alone gave.
    // The difference is visible the moment a stat has a big tie at one end: a hitter with 0 HR
    // in a league where twenty others also have 0 drew a completely empty bar next to the text
    // "13th of 33", so the bar said last and the number said mid-pack, about the same player,
    // on the same row. A field of one is 1: there is nobody to be worse than, and 0 would read
    // as "worst in the league" for the only qualified player at that position.
    const tied = Math.max(0, values.length - better - worse - 1)
    const pct = values.length <= 1 ? 1 : (worse + 0.5 * tied) / (values.length - 1)

    out.push({
      ...def,
      display: (FORMAT[def.key] ?? String)(mine),
      value: mine,
      rank: better + 1,
      of: values.length,
      pct: Math.max(0, Math.min(1, pct)),
    })
  }
  return out
}

/** "2nd" / "3rd" / "11th". Used beside the headline stat, where "rank 2 of 47" reads as a
 *  database row and "2nd in the WPBL" reads as a fact about a season. */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}
