import {
  aggregateBatting, aggregatePitching, wpblQualifiers, fmtRate, fmtTwo,
  scaleToBasis, kRateLabel, ERA_BASIS_CANONICAL,
  type WpblQualifiers, type EraBasis,
} from './stats'
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

const FORMAT: Record<string, (n: number) => string> = {
  avg: fmtRate, obp: fmtRate, slg: fmtRate, ops: fmtRate,
  hr: n => String(Math.round(n)), 'k%': n => `${(n * 100).toFixed(1)}%`,
  era: fmtTwo, whip: fmtTwo, k9: n => n.toFixed(1), kbb: n => n.toFixed(2),
}

export interface WpblPlayerRanks {
  batting: WpblStatRank[]
  pitching: WpblStatRank[]
  /** Qualified population sizes, for the "vs N qualified batters" line. */
  batOf: number
  pitOf: number
  /** Why a strip is missing, so the page can say so instead of rendering nothing. */
  batReason: 'ok' | 'season-young' | 'below-bar' | 'no-data'
  pitReason: 'ok' | 'season-young' | 'below-bar' | 'no-data'
  qualifiers: WpblQualifiers
}

const EMPTY: Omit<WpblPlayerRanks, 'qualifiers'> = {
  batting: [], pitching: [], batOf: 0, pitOf: 0, batReason: 'no-data', pitReason: 'no-data',
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

  const batField = batSeasons.filter(s => s.totals.ab >= qualifiers.minAb)
  const pitField = pitSeasons.filter(s => s.totals.outs >= qualifiers.minOuts)

  const batValue = (key: string, t: (typeof batSeasons)[number]['totals']): number | null => {
    switch (key) {
      case 'avg': return t.avg
      case 'obp': return t.obp
      case 'slg': return t.slg
      case 'ops': return t.ops
      case 'hr':  return t.hr
      // K% over plate appearances. `sh` is not carried on the totals, so a sacrifice bunt is
      // missing from the denominator and a bunter's rate reads a shade high: a fraction of a
      // percentage point on a player with one or two of them, against a stat whose whole
      // point is the difference between 12% and 25%.
      case 'k%': {
        const pa = t.ab + t.bb + t.hbp + t.sf
        return pa > 0 ? t.so / pa : null
      }
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
      default:     return null
    }
  }

  const batting = rankOne(playerId, batField, WPBL_BAT_RANK_DEFS, batValue)
  // The K rate's heading moves with the basis, so it is stamped here rather than left on the
  // def: the strip prints `label` verbatim, and "K/9" over a per-7 number is the one label on
  // the page that can be flatly wrong rather than merely imprecise.
  const pitDefs = WPBL_PIT_RANK_DEFS.map(d => d.key === 'k9' ? { ...d, label: kRateLabel(basis) } : d)
  const pitching = rankOne(playerId, pitField, pitDefs, pitValue)

  const inBatField = batField.some(s => s.player.id === playerId)
  const inPitField = pitField.some(s => s.player.id === playerId)
  const playedBat = batSeasons.some(s => s.player.id === playerId)
  const playedPit = pitSeasons.some(s => s.player.id === playerId)

  return {
    batting, pitching,
    batOf: batField.length, pitOf: pitField.length,
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
