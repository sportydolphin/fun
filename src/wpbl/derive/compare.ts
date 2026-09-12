// Two players, side by side. Pure: totals in, rows out, no supabase and no React, the same
// shape as stats.ts and matchups.ts next door.
//
// WHAT THIS FILE IS CAREFUL ABOUT, since a comparison is the one surface where a number is
// read as a verdict on a person rather than as a fact about a season:
//
// 1. **A leader is only ever named on a row where both sides have the number.** A null is not
//    a loss. A pitcher with no innings does not have the worse ERA, she has no ERA, and a tick
//    against the other name would be the page inventing a result out of an absence.
// 2. **Playing time is the FIRST thing in every group, before any rate.** Whoever is ahead on
//    a rate is meaningless without it, and a compare page is precisely where a reader is
//    invited to skip straight to the ticks. `sample` is built so the surface cannot omit it.
// 3. **Nothing adds the ticks up.** There is no overall winner here and there is deliberately
//    no field a caller could render one from: "7-3" is an aggregate of stats nobody agreed
//    weighed the same, presented as a ranking of two people.
// 4. **The qualifying bar is reported, not enforced.** Below it, `percentiles.ts` refuses to
//    draw a league rank, and it is right to: a percentile is a claim about a population. Who
//    has the higher average is not that claim, so the row stays and `qualified` says which
//    side the reader should discount. Hiding the numbers would leave the short-sample player
//    with a page that says nothing about her at all.

import {
  sumBatting, sumPitching, plateAppearances, wpblQualifiers, fmtRate, fmtTwo,
  scaleToBasis, kRateLabel, ERA_BASIS_CANONICAL,
  aggregateBatting, aggregatePitching,
  type WpblBattingTotals, type WpblPitchingTotals, type EraBasis,
} from '../stats'
import { leadsWithPitching } from '../positions'
import { outsToIp } from '../innings'
import { regularSeasonLines } from '../season'
import { classifyPa, type WpblMatchupPlay } from './matchups'
import type {
  WpblPlayer, WpblTeam, WpblGame, WpblBattingLine, WpblPitchingLine,
} from '../types'

/** Which side of the page. 'a' is always the left column and the first name in the slug. */
export type WpblCompareSide = 'a' | 'b'

export interface WpblCompareRow {
  key: string
  label: string
  /** Which direction is good, so the surface never re-decides that ERA is not a high score. */
  better: 'high' | 'low'
  a: number | null
  b: number | null
  /** Formatted here so the two columns cannot disagree about precision. */
  aText: string
  bText: string
  /** Who is ahead, or null. Null covers a tie AND either side having no number at all; the
   *  two are different facts and neither one is a win. */
  leader: WpblCompareSide | null
}

export interface WpblCompareGroup {
  key: 'batting' | 'pitching'
  label: string
  /** How much each of them has played, in the unit this group's rates are set in. Rendered
   *  above the rows, never inside them: it is the context for every tick below it, not one
   *  more thing to be ahead on. */
  sample: { aText: string; bText: string; label: string }
  /** Does each side clear the rate-stat bar. False is not a reason to hide a row; see the
   *  header. */
  qualified: { a: boolean; b: boolean }
  /** The bar itself, spelled out ("24 PA"), so a card can say what "below the bar" means
   *  rather than asking the reader to take it on faith. Null before the bar is active at all,
   *  which is the first fortnight of a season. */
  barText: string | null
  rate: WpblCompareRow[]
  counting: WpblCompareRow[]
}

/** What the two of them have done to each other, when they have met. Only ever present for a
 *  hitter and a pitcher, and only when at least one plate appearance is on the record. */
export interface WpblCompareMatchup {
  /** Which side was batting. The other one was pitching. */
  batter: WpblCompareSide
  pa: number; ab: number; h: number; hr: number; xbh: number; bb: number; so: number
  avg: number | null
}

export interface WpblComparison {
  groups: WpblCompareGroup[]
  /** Both directions, since two players who both bat and both pitch can have faced each other
   *  each way. Empty when they have never met, which is the common case for two hitters. */
  matchups: WpblCompareMatchup[]
}

const pct = (v: number | null): string => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const int = (v: number | null): string => (v == null ? '—' : String(v))

/**
 * One row, with the leader decided.
 *
 * THE NULL GUARD IS THE POINT OF THIS HELPER. Written inline at fourteen call sites, the
 * version that reads `(a ?? 0) > (b ?? 0)` is both the obvious one and wrong in a way nobody
 * would catch by looking: it hands the tick to whoever has a number when the other has none,
 * so a position player who has never pitched wins the ERA row against an actual pitcher.
 */
function row(
  key: string, label: string, better: 'high' | 'low',
  a: number | null, b: number | null,
  fmt: (v: number | null) => string,
): WpblCompareRow {
  const leader: WpblCompareSide | null =
    a == null || b == null || a === b ? null
      : better === 'high' ? (a > b ? 'a' : 'b')
        : (a < b ? 'a' : 'b')
  return { key, label, better, a, b, aText: fmt(a), bText: fmt(b), leader }
}

/** K%, over plate appearances. The same definition percentiles.ts ranks on, sac bunts
 *  included, so a hitter's compare row and her own page's bar cannot disagree. */
function strikeoutRate(t: WpblBattingTotals): number | null {
  const pa = plateAppearances(t)
  return pa > 0 ? t.so / pa : null
}

function battingRows(a: WpblBattingTotals, b: WpblBattingTotals) {
  const rate = [
    row('avg', 'AVG', 'high', a.avg, b.avg, fmtRate),
    row('obp', 'OBP', 'high', a.obp, b.obp, fmtRate),
    row('slg', 'SLG', 'high', a.slg, b.slg, fmtRate),
    row('ops', 'OPS', 'high', a.ops, b.ops, fmtRate),
    // Inverted, and as a rate rather than as the raw count, for the reason percentiles.ts
    // spells out: ranked on raw strikeouts, the hitter who barely plays always wins.
    row('k%', 'K%', 'low', strikeoutRate(a), strikeoutRate(b), pct),
  ]
  const counting = [
    row('h', 'H', 'high', a.h, b.h, int),
    row('hr', 'HR', 'high', a.hr, b.hr, int),
    row('rbi', 'RBI', 'high', a.rbi, b.rbi, int),
    row('r', 'R', 'high', a.r, b.r, int),
    row('2b', '2B', 'high', a.doubles, b.doubles, int),
    row('3b', '3B', 'high', a.triples, b.triples, int),
    row('bb', 'BB', 'high', a.bb, b.bb, int),
    row('sb', 'SB', 'high', a.sb, b.sb, int),
    row('tb', 'TB', 'high', a.tb, b.tb, int),
  ]
  return { rate, counting }
}

function pitchingRows(a: WpblPitchingTotals, b: WpblPitchingTotals, basis: EraBasis) {
  const rate = [
    // Rescaled at DISPLAY time from the one canonical basis, never recomputed from a literal.
    // Both stats are linear in the multiplier, so the leader is the leader on either basis
    // and a reader who flips the setting sees the same tick move to the same name.
    row('era', 'ERA', 'low', scaleToBasis(a.era, basis), scaleToBasis(b.era, basis), fmtTwo),
    row('whip', 'WHIP', 'low', a.whip, b.whip, fmtTwo),
    row('k9', kRateLabel(basis), 'high', scaleToBasis(a.k9, basis), scaleToBasis(b.k9, basis), fmtTwo),
    row('kbb', 'K/BB', 'high', a.kbb, b.kbb, fmtTwo),
  ]
  // EVERY COUNTING ROW IS ONE WHERE MORE IS BETTER AND MORE IS EARNED BY PLAYING, which is
  // the rule percentiles.ts states and the reason there is no walks-allowed row here. A 'low'
  // counting stat rewards not pitching: three innings and one walk beats sixty innings and
  // fifteen, and the tick would say so. Walks, hits and earned runs are already in WHIP and
  // ERA above, where they are rates and the comparison is honest.
  //
  // NO IP ROW EITHER. `sample` prints it for both of them already, and a card that says 23.0
  // twice invites the reader to take the second one as a thing to be ahead on.
  const counting = [
    row('so', 'SO', 'high', a.so, b.so, int),
    row('w', 'W', 'high', a.w, b.w, int),
    row('s', 'SV', 'high', a.s, b.s, int),
    row('gs', 'GS', 'high', a.gs, b.gs, int),
  ]
  return { rate, counting }
}

/**
 * Every plate appearance one of them took against the other.
 *
 * `plays` MUST be the unfiltered league play log (`fetchWpblAllRunValuePlays`). The firsts
 * read next door to it in api.ts drops routine outs at the database, which is right for what
 * it is for and would make this read a .650 average for everybody: the outs are most of the
 * denominator and none of them would arrive. The parameter type is the narrow structural one
 * from matchups.ts rather than either read's own, so this cannot be enforced by the compiler
 * and is stated here instead.
 *
 * `games` is required for the reason every aggregate in this section requires it: a play
 * carries a game_id and nothing else, so it cannot say for itself whether it was a postseason
 * game, and a postseason at-bat must not reach a season line.
 */
function matchupBetween(
  batter: WpblPlayer, pitcher: WpblPlayer,
  plays: WpblMatchupPlay[], games: WpblGame[],
): Omit<WpblCompareMatchup, 'batter'> | null {
  // Every feed id each of them has held, because the league mints a new player_id on a trade
  // and a matchup played in July is keyed on the id she held then.
  const batterIds = new Set([...(batter.api_ids ?? []), batter.api_id, batter.id].filter(Boolean))
  const pitcherIds = new Set([...(pitcher.api_ids ?? []), pitcher.api_id, pitcher.id].filter(Boolean))
  const t = { pa: 0, ab: 0, h: 0, hr: 0, xbh: 0, bb: 0, so: 0 }
  for (const p of regularSeasonLines(plays, games)) {
    if (!p.batter_id || !p.pitcher_id) continue
    if (!batterIds.has(p.batter_id) || !pitcherIds.has(p.pitcher_id)) continue
    const o = classifyPa(p)
    if (!o) continue
    t.pa++; t.ab += o.ab; t.h += o.h; t.hr += o.hr; t.xbh += o.xbh; t.bb += o.bb; t.so += o.so
  }
  if (t.pa === 0) return null
  return { ...t, avg: t.ab > 0 ? t.h / t.ab : null }
}

/**
 * Build the whole comparison.
 *
 * A GROUP IS SHOWN WHEN EITHER OF THEM HAS DONE IT, not when both have, and the asymmetry is
 * deliberate. Every pitcher on this roster also bats (38 of 38 as of Sep 2026), so "both have
 * a line" would show a pitcher-versus-hitter pair nothing but two thin batting columns and
 * quietly drop the half of the page that is actually about the pitcher. Showing the group with
 * one column empty says the true thing: one of them does this and the other does not.
 *
 * `games` is the schedule, and it is REQUIRED here for the reason stated on every aggregate in
 * stats.ts. It is passed straight through to `sumBatting` / `sumPitching`, which do the
 * excluding; nothing in this file re-implements the rule.
 */
export function buildWpblComparison(
  a: WpblPlayer,
  b: WpblPlayer,
  opts: {
    teams: WpblTeam[]
    games: WpblGame[]
    batting: WpblBattingLine[]
    pitching: WpblPitchingLine[]
    /** The unfiltered league play log, for the head-to-head. Omitted where it has not
     *  arrived: the rest of the page does not wait on it. */
    plays?: WpblMatchupPlay[]
    basis?: EraBasis
  },
): WpblComparison {
  const { teams, games, batting, pitching, plays, basis = ERA_BASIS_CANONICAL } = opts
  const q = wpblQualifiers(teams, games)

  const forPlayer = <T extends { player_id: string }>(lines: T[], p: WpblPlayer) =>
    lines.filter(l => l.player_id === p.id)

  const aBat = sumBatting(forPlayer(batting, a), games)
  const bBat = sumBatting(forPlayer(batting, b), games)
  const aPit = sumPitching(forPlayer(pitching, a), games)
  const bPit = sumPitching(forPlayer(pitching, b), games)

  const groups: WpblCompareGroup[] = []

  // ON PLATE APPEARANCES, NOT GAMES. A pitcher who has never batted still carries a batting
  // LINE for every game she appeared in, all of them zeroes, so `g > 0` renders a full card of
  // dashes for two pitchers in a league where neither of them bats.
  const aPa = plateAppearances(aBat)
  const bPa = plateAppearances(bBat)
  if (aPa > 0 || bPa > 0) {
    const { rate, counting } = battingRows(aBat, bBat)
    groups.push({
      key: 'batting',
      label: 'Batting',
      sample: { aText: `${aBat.g} G · ${aPa} PA`, bText: `${bBat.g} G · ${bPa} PA`, label: 'Played' },
      qualified: { a: q.active && aPa >= q.minPa, b: q.active && bPa >= q.minPa },
      barText: q.active ? `${q.minPa} PA` : null,
      rate,
      counting,
    })
  }

  // On outs, for the reason above: a line with no innings in it is not a pitching season.
  if (aPit.outs > 0 || bPit.outs > 0) {
    const { rate, counting } = pitchingRows(aPit, bPit, basis)
    groups.push({
      key: 'pitching',
      label: 'Pitching',
      sample: {
        aText: `${aPit.g} G · ${outsToIp(aPit.outs)} IP`,
        bText: `${bPit.g} G · ${outsToIp(bPit.outs)} IP`,
        label: 'Pitched',
      },
      qualified: { a: q.active && aPit.outs >= q.minOuts, b: q.active && bPit.outs >= q.minOuts },
      barText: q.active ? `${outsToIp(q.minOuts)} IP` : null,
      rate,
      counting,
    })
  }

  // THE BIGGER SAMPLE LEADS. A pitcher against a hitter has both groups, and the batting one
  // is 60 plate appearances against nine: put it first, as the insertion order above does, and
  // the page opens on the half of it that is mostly dashes. Sorted by how much the pair has
  // actually done in each, so the group carrying the comparison is the one on screen first.
  const weight = (gr: WpblCompareGroup) =>
    gr.key === 'batting'
      ? plateAppearances(aBat) + plateAppearances(bBat)
      // Outs, scaled into the same rough order of magnitude as plate appearances: three outs
      // is an inning and an inning is about four batters faced. Nothing turns on the constant
      // beyond which of two cards is drawn first.
      : (aPit.outs + bPit.outs) * 4 / 3
  groups.sort((x, y) => weight(y) - weight(x))

  // Both directions. Two players who each bat and each pitch can have faced each other each
  // way, and a four-club league is exactly where that happens.
  const matchups: WpblCompareMatchup[] = []
  if (plays && plays.length > 0) {
    const ab = matchupBetween(a, b, plays, games)
    if (ab) matchups.push({ batter: 'a', ...ab })
    const ba = matchupBetween(b, a, plays, games)
    if (ba) matchups.push({ batter: 'b', ...ba })
  }

  return { groups, matchups }
}


// ─── Who to offer next ────────────────────────────────────────────────────────

export interface WpblCompareCandidate {
  player: WpblPlayer
  /** Which half of her season leads. The picker groups like with like on it. */
  pitcher: boolean
  /** What the row prints: innings for a pitcher, plate appearances for a hitter. */
  playedText: string
  /** The sort key, and the number `playedText` is a rendering OF. The two must not come
   *  apart; see the note below. */
  played: number
}

/**
 * The order to offer the rest of the league in.
 *
 * ALPHABETICAL IS THE WRONG DEFAULT HERE, which is not obvious until you use it: the list
 * opened on Abigail Moore, Adelaide Frank and Adelaide Ziebart, three players with 24 plate
 * appearances between them, and the comparison somebody actually came to build was eleven
 * screens down. A name is what the search box is for. What the LIST is for is the question
 * "who is worth putting next to her", and an alphabet answers a different question.
 *
 * So, in order:
 *
 * 1. **Her own half of the game first.** A hitter against a pitcher shares almost no rows: the
 *    page draws two cards where one column is dashes all the way down. That comparison stays
 *    reachable, and the head-to-head makes it worth reaching, but it is not what to put at the
 *    top. `leadsWithPitching` is the same call the player card uses to decide which way round
 *    to open, so the picker and the card cannot disagree about who is a pitcher. With no
 *    subject chosen yet there is no role to match, and hitters lead: they are the larger group
 *    and the commoner first pick.
 * 2. **Then by how much she has played**, most first. Playing time is the honest proxy for "is
 *    there a season here to compare", it is what the comparison itself leads with, and it is
 *    not a ranking of quality: sorting the picker by OPS would make it a leaderboard and invite
 *    the reader to compare the top two and stop.
 * 3. **Then by name**, so the order is deterministic and does not shuffle between renders.
 *
 * THE SORT KEY IS ALWAYS THE NUMBER THE ROW PRINTS, and rule 1 is what makes that possible.
 * A first draft ranked everyone by CONFRONTATIONS — batters faced for a pitcher, plate
 * appearances for a hitter, which is genuinely one unit measured twice and is the only way to
 * order a list holding both. It was right and it looked broken: the column shows innings, and
 * a pitcher who walks people faces more batters per inning, so the list ran 21.0 IP, 21.2 IP,
 * 18.2, 15.2, 18.2 and read as a sort that had failed. Because role is the FIRST key, each role
 * is a contiguous block, so each block can be sorted in its own unit and every block is
 * monotonic in what the reader can see. A sorted list that cannot be checked by eye is worth
 * less than one that can.
 */
export function rankCompareCandidates(
  subject: WpblPlayer | null,
  players: WpblPlayer[],
  opts: { games: WpblGame[]; batting: WpblBattingLine[]; pitching: WpblPitchingLine[] },
): WpblCompareCandidate[] {
  const { games, batting, pitching } = opts
  // Aggregated for the whole league in one pass each; both of these filter the postseason out
  // once rather than per player, which is the reason to use them over 118 calls to `sumBatting`.
  const bat = new Map(aggregateBatting(players, batting, games).map(s => [s.player.id, s.totals]))
  const pit = new Map(aggregatePitching(players, pitching, games).map(s => [s.player.id, s.totals]))

  const describe = (player: WpblPlayer): WpblCompareCandidate => {
    const b = bat.get(player.id)
    const p = pit.get(player.id)
    const pa = b ? plateAppearances(b) : 0
    const pitcher = leadsWithPitching({
      position: player.position,
      hasBatting: !!b, hasPitching: !!p,
      gs: p?.gs ?? 0, bf: p?.bf ?? 0, pa,
    })
    const outs = p?.outs ?? 0
    return {
      player,
      pitcher,
      // Outs, not innings: 6.2 IP is 20 outs and 6.2 is not two thirds of anything a sort can
      // use. `outsToIp` is monotonic in outs, so the printed column is in the order this is.
      played: pitcher ? outs : pa,
      playedText: pitcher ? `${outsToIp(outs)} IP` : `${pa} PA`,
    }
  }

  const leadingRole = subject ? describe(subject).pitcher : false
  return players
    .filter(p => p.id !== subject?.id)
    .map(describe)
    .sort((x, y) =>
      Number(y.pitcher === leadingRole) - Number(x.pitcher === leadingRole)
      || y.played - x.played
      || x.player.name.localeCompare(y.player.name))
}
