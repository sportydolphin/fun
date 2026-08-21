import { regularSeasonLines, type WpblSeasonGame } from '../season'
import type { WpblPitchPlay, WpblPlayer } from '../types'

/**
 * The pitch-code layer: season-wide plate-discipline and pitch-mix boards built from the one
 * character per pitch that the feed puts in `wpbl_game_plays.pitch_sequence`.
 *
 * WHY THIS EXISTS. The section's only pitch-level surface was the TrackMan board, and the
 * league has published radar for two games. This reads a string that is present on every
 * plate appearance of every game, so it covers the whole season: roughly 3.8 pitches per PA,
 * about 4,300 pitches so far, against 766 tracked rows. Same kind of question, twenty times
 * the sample, and no new ingest.
 *
 * DECODE THE LETTER, NEVER THE FEED'S LABEL. `pitch_events` carries the feed's own `type`
 * for each pitch and two of the six codes are wrong there: `K` arrives as `"unknown"` and
 * `P` as `"pitchout"`. Those two are 39% of every pitch thrown in the league, so trusting the
 * labels would drop a called strike and a ball in play into an unclassified bucket and halve
 * every rate on these boards without erroring. The letter is the truth; the six-code map
 * below is the whole contract.
 *
 * PURE. Arrays in, plain shapes out, no supabase and no React, like stats.ts and matchups.ts.
 */

// ── The six codes ────────────────────────────────────────────────────────────────
// Verified against the whole league play log: B, K, P, F, S, H and nothing else. An
// unrecognised letter is counted separately rather than guessed at, so the day the feed adds
// a seventh (a pitchout or an intentional ball would be the obvious ones) it shows up as a
// number on the coverage line instead of quietly inflating "ball".
export type PitchKind = 'ball' | 'called' | 'swinging' | 'foul' | 'inplay' | 'hbp'

export const PITCH_CODES: Readonly<Record<string, PitchKind>> = {
  B: 'ball',      // taken outside the zone
  K: 'called',    // taken for a strike. The feed labels this one "unknown"
  S: 'swinging',  // swung through
  F: 'foul',      // swung, contacted, foul
  P: 'inplay',    // put in play; always the last pitch of the sequence. Labelled "pitchout"
  H: 'hbp',       // hit by pitch; also terminal
}

const isStrike = (k: PitchKind): boolean => k !== 'ball' && k !== 'hbp'

// ── Rates ────────────────────────────────────────────────────────────────────────
// Every rate is null rather than 0 when its denominator is empty, so a player with no swings
// renders a dash (fmtRate's convention) instead of a 0% that reads like a measurement.
export interface PitchRates {
  /** Anything not a ball or a hit-by-pitch, over all pitches. Fouls count, as they do
   *  everywhere else this stat is published. */
  strikePct: number | null
  /** Swinging strikes over ALL pitches. The "stuff" number: what a pitcher's raw miss rate is
   *  against everyone who steps in, regardless of how often they offer. */
  swStrPct: number | null
  /** Swinging strikes over swings. The same event per opportunity: how often a swing missed. */
  whiffPct: number | null
  /** Contact (foul or in play) over swings. The complement of whiffPct, kept because the
   *  hitting board leads with it and reading a hitter off "1 minus" is a needless step. */
  contactPct: number | null
  swingPct: number | null
  /** Called strikes over all pitches. On the hitting board this is the passivity number:
   *  strikes taken without offering. */
  calledPct: number | null
  pitchesPerPa: number | null
  /** Plate appearances whose FIRST pitch was a strike. The count the whole at-bat is played
   *  from, and the one rate here a pitching coach would name first. */
  firstStrikePct: number | null
  /** Strikeouts over the plate appearances that reached two strikes: the finishing rate,
   *  with the at-bats that never got there taken out of the denominator. */
  putawayPct: number | null
}

/** One player's line on the boards, from whichever side they were on. */
export interface PitchProfile extends PitchRates {
  /** Null when the play log names someone we cannot resolve to a roster row. Rare (about 2%
   *  of plays), and the name is still shown, but the row is not clickable. */
  player: WpblPlayer | null
  name: string
  teamId: string | null
  pitches: number
  pa: number
  /** Swings taken (or induced): the denominator of whiffPct and contactPct, and not a fixed
   *  share of `pitches`, since how often someone offers is the thing being measured. */
  swings: number
  strikeouts: number
  twoStrikePa: number
  /** Per-pitch counts, for anything that wants the mix rather than the rates. */
  counts: PitchCounts
}

export interface PitchCounts {
  ball: number
  called: number
  swinging: number
  foul: number
  inplay: number
  hbp: number
  /** Codes outside the six. Should be 0; surfaced so it cannot silently stop being 0. */
  unknown: number
}

export interface PitchBoard {
  /** Distinct games with at least one pitch sequence, for the coverage line. */
  gameCount: number
  pitches: number
  pa: number
  /** The league line, as its own profile. Every board prints it under the leaders so a rate
   *  has something to be read against: 11% whiffs means nothing until you know the league is
   *  at 5.4%. */
  league: PitchProfile
  pitchers: PitchProfile[]
  batters: PitchProfile[]
}

// ── Qualifiers ───────────────────────────────────────────────────────────────────
// Derived from the box-score qualifiers in stats.ts (2.0 AB and 0.8 IP per team game) at the
// league's measured 3.8 pitches per plate appearance, rather than invented: a hitter clearing
// the AB bar should clear this one too, so the two Stats boards do not disagree about who is
// a regular. Floors keep an early-season board from being one reliever.
const PITCHER_PITCHES_PER_GAME = 12   // 0.8 IP ≈ 3.2 batters faced ≈ 12 pitches
const BATTER_PITCHES_PER_GAME = 8     // 2.0 AB ≈ 8 pitches seen
const PITCHER_FLOOR = 40
const BATTER_FLOOR = 25

export interface PitchQualifiers { minPitcher: number; minBatter: number }

/** The pitch minimums for a season this far along. `teamGames` is the games played by the
 *  team that has played fewest, which is what `wpblQualifiers` already computes for the
 *  Stats tab; pass 0 (or anything below the tab's own threshold) to turn the bar off. */
export function pitchQualifiers(teamGames: number): PitchQualifiers {
  return {
    minPitcher: Math.max(PITCHER_FLOOR, Math.round(PITCHER_PITCHES_PER_GAME * teamGames)),
    minBatter: Math.max(BATTER_FLOOR, Math.round(BATTER_PITCHES_PER_GAME * teamGames)),
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────────

interface Tally {
  player: WpblPlayer | null
  name: string
  teamId: string | null
  counts: PitchCounts
  pitches: number
  pa: number
  strikeouts: number
  firstStrikes: number
  twoStrikePa: number
}

const emptyCounts = (): PitchCounts => ({ ball: 0, called: 0, swinging: 0, foul: 0, inplay: 0, hbp: 0, unknown: 0 })

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null)

const swingsOf = (c: PitchCounts): number => c.swinging + c.foul + c.inplay

function ratesOf(t: Tally): PitchRates {
  const c = t.counts
  const graded = c.ball + c.called + c.swinging + c.foul + c.inplay + c.hbp
  const swings = swingsOf(c)
  const strikes = c.called + c.swinging + c.foul + c.inplay
  return {
    strikePct: rate(strikes, graded),
    swStrPct: rate(c.swinging, graded),
    whiffPct: rate(c.swinging, swings),
    contactPct: rate(c.foul + c.inplay, swings),
    swingPct: rate(swings, graded),
    calledPct: rate(c.called, graded),
    pitchesPerPa: rate(t.pitches, t.pa),
    firstStrikePct: rate(t.firstStrikes, t.pa),
    putawayPct: rate(t.strikeouts, t.twoStrikePa),
  }
}

const profileOf = (t: Tally): PitchProfile => ({
  player: t.player, name: t.name, teamId: t.teamId,
  pitches: t.pitches, pa: t.pa, swings: swingsOf(t.counts),
  strikeouts: t.strikeouts, twoStrikePa: t.twoStrikePa,
  counts: t.counts, ...ratesOf(t),
})

/** What one plate appearance's sequence says, on its own. Exported for the tests, and because
 *  a single at-bat's line is the obvious next consumer (a Game Center pitch-by-pitch summary). */
export function readSequence(seq: string): {
  counts: PitchCounts; pitches: number; firstPitchStrike: boolean; reachedTwoStrikes: boolean
} {
  const counts = emptyCounts()
  let strikes = 0
  let reachedTwoStrikes = false
  let firstPitchStrike = false
  for (let i = 0; i < seq.length; i++) {
    const kind = PITCH_CODES[seq[i]]
    if (!kind) { counts.unknown++; continue }
    counts[kind]++
    if (i === 0) firstPitchStrike = isStrike(kind)
    // The foul rule is the whole reason this is a loop and not six string counts: a foul is a
    // strike only below two, so a nine-pitch at-bat with five fouls reached two strikes once,
    // not six times, and its `strikes` never leaves 2.
    if (kind === 'called' || kind === 'swinging') strikes++
    else if (kind === 'foul' && strikes < 2) strikes++
    if (strikes >= 2) reachedTwoStrikes = true
  }
  return { counts, pitches: seq.length, firstPitchStrike, reachedTwoStrikes }
}

/**
 * Both boards, from the season's plate appearances.
 *
 * `games` IS REQUIRED, for the reason `sumBatting` and friends take it (see season.ts): a play
 * row carries a `game_id` and nothing else about its game, so it cannot say for itself whether
 * it belongs in a season total, and the postseason's 7 to 11 games would otherwise fold
 * straight into every rate here. Filtering runs through `regularSeasonLines`, which excludes by
 * the known-postseason ids rather than keeping the known-regular ones, so a caller holding a
 * partial schedule over-counts instead of rendering an empty board.
 */
export function aggregatePitchCodes(
  plays: WpblPitchPlay[],
  players: WpblPlayer[],
  games: WpblSeasonGame[],
): PitchBoard {
  const byId = new Map(players.map(p => [p.id, p]))
  const pitchers = new Map<string, Tally>()
  const batters = new Map<string, Tally>()
  const gameIds = new Set<string>()
  const league: Tally = { player: null, name: 'League', teamId: null, counts: emptyCounts(), pitches: 0, pa: 0, strikeouts: 0, firstStrikes: 0, twoStrikePa: 0 }

  const take = (
    map: Map<string, Tally>, id: string | null, name: string | null, fallbackTeam: string | null,
  ): Tally | null => {
    if (!id && !name) return null
    const player = id ? byId.get(id) ?? null : null
    // Key on the resolved player where there is one, so the same person never splits into two
    // rows because the feed spelled their name two ways across a season.
    const key = player ? player.id : `name:${(name ?? '').toLowerCase()}`
    const existing = map.get(key)
    if (existing) return existing
    const t: Tally = {
      player,
      name: player?.name ?? name ?? 'Unknown',
      // A play's own `team_id` is the BATTING side, so it is the batter's club and never the
      // pitcher's. The pitcher's comes from their roster row or stays null; guessing it from
      // the game's other team would need the schedule for a badge.
      teamId: player?.team_id ?? fallbackTeam,
      counts: emptyCounts(), pitches: 0, pa: 0, strikeouts: 0, firstStrikes: 0, twoStrikePa: 0,
    }
    map.set(key, t)
    return t
  }

  const add = (t: Tally, read: ReturnType<typeof readSequence>, strikeout: boolean) => {
    for (const k of Object.keys(read.counts) as (keyof PitchCounts)[]) t.counts[k] += read.counts[k]
    t.pitches += read.pitches
    t.pa++
    if (strikeout) t.strikeouts++
    if (read.firstPitchStrike) t.firstStrikes++
    if (read.reachedTwoStrikes) t.twoStrikePa++
  }

  for (const play of regularSeasonLines(plays, games)) {
    const seq = play.pitch_sequence
    if (!seq) continue
    const read = readSequence(seq)
    const strikeout = play.event_type === 'strikeout'
    gameIds.add(play.game_id)
    add(league, read, strikeout)
    const p = take(pitchers, play.pitcher_id, play.pitcher_name, null)
    if (p) add(p, read, strikeout)
    const b = take(batters, play.batter_id, play.batter_name, play.team_id)
    if (b) add(b, read, strikeout)
  }

  return {
    gameCount: gameIds.size,
    pitches: league.pitches,
    pa: league.pa,
    league: profileOf(league),
    pitchers: [...pitchers.values()].map(profileOf).sort((a, b) => b.pitches - a.pitches),
    batters: [...batters.values()].map(profileOf).sort((a, b) => b.pitches - a.pitches),
  }
}

/** What each rate is actually measured over. A rate is only as good as its own denominator,
 *  and they are not interchangeable: a hitter can clear a pitches-seen bar and still have
 *  taken fifteen swings all season. */
const DENOMINATOR: Record<keyof PitchRates, (p: PitchProfile) => number> = {
  strikePct: p => p.pitches,
  swStrPct: p => p.pitches,
  swingPct: p => p.pitches,
  calledPct: p => p.pitches,
  whiffPct: p => p.swings,
  contactPct: p => p.swings,
  pitchesPerPa: p => p.pa,
  firstStrikePct: p => p.pa,
  putawayPct: p => p.twoStrikePa,
}

/**
 * Rank a board on one rate.
 *
 * TWO BARS, NOT ONE, and the second is the one that matters. A pitches-seen minimum alone put
 * a hitter who had swung 15 times on top of the contact board at a flat 100%, because contact
 * is measured per swing and nothing was checking how many swings there were. So the sample bar
 * is also applied to the rate's OWN denominator, scaled off the league: a qualifier needs as
 * many swings (or two-strike counts, or plate appearances) as a player with `minPitches` would
 * typically have had. That keeps one threshold to reason about while every board polices the
 * number it is actually dividing by.
 *
 * Ties break toward the larger denominator, so when four hitters are all at 0.0% the one who
 * has been tested most often leads. In a 16-game season that is most of the top of a board.
 */
export function rankBy(
  profiles: PitchProfile[],
  key: keyof PitchRates,
  minPitches: number,
  lowerBetter = false,
  /** The league line, for scaling the denominator bar. Omit to check `minPitches` alone. */
  league?: PitchProfile,
): PitchProfile[] {
  const denom = DENOMINATOR[key]
  const minSample = league && league.pitches > 0
    ? Math.round(minPitches * (denom(league) / league.pitches))
    : 0
  return profiles
    .filter(p => p.pitches >= minPitches && p[key] != null && denom(p) >= minSample)
    .sort((a, b) => {
      const diff = (lowerBetter ? -1 : 1) * ((b[key] as number) - (a[key] as number))
      return diff !== 0 ? diff : denom(b) - denom(a)
    })
}

/** "24.8%" for a rate, a dash when there is nothing to measure. Matches fmtRate's contract
 *  (stats.ts) for the dash so the boards agree with the tables about what "no data" looks
 *  like; the glyph is the em-dash-width "no value" symbol used in every stat line here. */
export const fmtPct = (v: number | null, digits = 1): string =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`
