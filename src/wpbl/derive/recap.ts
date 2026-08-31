import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblRecapPlay } from '../types'
// The two runtime imports below carry explicit .ts extensions because this module is also
// loaded by Deno (supabase/functions/wpbl-ingest announces a final straight to Discord),
// and Deno resolves local specifiers literally. Type-only imports are erased before
// resolution, so they stay extensionless like the rest of the app.
import { outsToIp, playedInnings } from '../innings.ts'
import { classifyPa } from './matchups.ts'

// Auto game-recap engine. Pure: a game + its box lines + play-by-play in, a structured recap
// out (no supabase / React), so GameDetail renders the full version, Home renders a compact
// one, and a future Discord post can read the same object. Everything is derived from what we
// already store — final score, per-inning line score, box lines (with W/L/S decisions), and
// the feed's play narratives — so no new columns or feed calls are needed.

export interface RecapStar {
  playerId: string
  name: string
  teamId: string | null
  kind: 'bat' | 'pitch'
  statline: string          // "3-4, 3 HR, 6 RBI" or "6.0 IP, 9 K"
  score: number             // internal ranking weight
}

export interface RecapDecision { key: 'W' | 'L' | 'S'; name: string; teamId: string | null; statline: string }
export interface RecapTeamLine { teamId: string; name: string; r: number; h: number; e: number }

export interface GameRecap {
  winner: WpblTeam; loser: WpblTeam
  winnerScore: number; loserScore: number
  margin: number; innings: number
  headline: string          // "Firebells rout Queens"
  blurb: string             // 2–3 sentence narrative
  stars: RecapStar[]        // up to 3, most impactful first
  decisions: RecapDecision[]
  teamLine: [RecapTeamLine, RecapTeamLine]  // [away, home]
  feats: string[]           // auto-detected highlights (multi-HR, no-hitter, cycle, …)
  flags: { shutout: boolean; blowout: boolean; oneRun: boolean; walkOff: boolean; comeback: boolean; extras: boolean }
}

// ── League context ────────────────────────────────────────────────────────────────────────
// The verbs (rout / tight / slugfest / comeback) shouldn't be pinned to MLB's run environment:
// WPBL scores, margins, and offense differ, and the season is short, so a "rout" here is defined
// relative to how THIS league is actually playing. We profile every decided final and set each
// cutoff off the league's own margin/scoring distribution (mean ± ~1 SD), with floors so a tiny
// early-season sample can't produce silly thresholds. Recompute as games land and the words retune.
export interface RecapLeagueContext {
  blowoutMargin: number    // margin at/above → "rout" / "shut out"
  closeMargin: number      // margin at/below → "held on" flow
  bigInningRuns: number    // runs in one inning at/above → worth calling the decisive swing
  slugfestRuns: number     // combined runs at/above → "outslug" (with both sides productive)
  slugfestSide: number     // losing side's runs at/above, so a blowout can't read as a slugfest
  comebackDeficit: number  // deficit erased at/above → "rally past"
}

// Season-neutral defaults, used until enough finals (<4) define a league profile.
export const DEFAULT_RECAP_CONTEXT: RecapLeagueContext = {
  blowoutMargin: 6, closeMargin: 2, bigInningRuns: 3, slugfestRuns: 15, slugfestSide: 7, comebackDeficit: 3,
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
const stdev = (a: number[], m: number) => Math.sqrt(mean(a.map(x => (x - m) ** 2)))

export function leagueRecapContext(games: WpblGame[]): RecapLeagueContext {
  const finals = games.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
  if (finals.length < 4) return DEFAULT_RECAP_CONTEXT
  const margins: number[] = [], totals: number[] = [], sides: number[] = []
  for (const g of finals) {
    const hi = Math.max(g.home_score!, g.away_score!), lo = Math.min(g.home_score!, g.away_score!)
    margins.push(hi - lo); totals.push(hi + lo); sides.push(lo)
  }
  const mMar = mean(margins), sMar = stdev(margins, mMar)
  const mTot = mean(totals), sTot = stdev(totals, mTot)
  const mSide = mean(sides)
  const r = Math.round
  return {
    blowoutMargin: Math.max(4, r(mMar + sMar)),   // ~1 SD above the league's typical margin
    // CLOSE IS A TAIL, NOT THE MIDDLE, and it used to be the middle. Setting this to the mean
    // margin made roughly half of every season "close" by construction, which is how a 9-4
    // came to read "the Heights held on for a 9-4 win". A typical game is not a nail-biter.
    // One SD BELOW the mean, so close and blowout are symmetric ends of the same distribution:
    // on the 20 finals to Aug 23 that is 2 rather than 5, and only one- and two-run games
    // qualify. Floor of 1, because a league that somehow had no spread should still reserve
    // the word for the one-run games rather than handing it to everybody.
    closeMargin: Math.max(1, r(mMar - sMar)),
    // Split out of closeMargin, which was doing this job as well. The two pull in opposite
    // directions: tightening "close" to 2 would otherwise have made every 2-run inning the
    // decisive swing of its game, and "pulled ahead with a 2-run 4th" says nothing. An inning
    // worth naming is one about the size of a whole typical winning margin, which is what the
    // mean gives, and it is already producing the right sentences at 5.
    bigInningRuns: Math.max(2, r(mMar)),
    slugfestRuns: Math.max(12, r(mTot + sTot)),   // ~1 SD above the league's typical run total
    slugfestSide: Math.max(6, r(mSide + 1)),      // loser still productive, not just outscored
    comebackDeficit: Math.max(2, r(mMar)),        // a hole around a typical winning margin
  }
}

// "a" vs "an" for a number that's read aloud: eight, eleven, eighteen and the eighties all
// take "an" ("an 8-2 win", "an 11-run 4th"). Everything else in a baseball score takes "a".
// Only the leading number matters — "an 8-2 win" is governed by the 8, not the 2.
const article = (n: number): 'a' | 'an' =>
  (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89)) ? 'an' : 'a'

/**
 * VARIATION HAS TO BE DETERMINISTIC, and that is the only hard rule in this file's wording.
 *
 * One recap is built in three places from the same inputs: the site renders it, the ingest's
 * edge function announces the final to Discord, and the nightly job re-renders every game to
 * decide whether the posted message still matches. That last one compares by CONTENT HASH, so
 * a recap that worded itself differently on each build would leave the job editing the same
 * message forever, every night, for the rest of the season. `Math.random()` would also rewrite
 * the sentence under a reader on any re-render, which is its own small horror.
 *
 * So the pick is a pure function of the game id. Same game, same words, on every machine and in
 * every runtime, permanently. Seed on nothing that can change: not the fetch order, not a
 * timestamp, not the score.
 */
const seedOf = (s: string) => {
  // FNV-1a. Chosen for being four lines rather than for its distribution; the pools are at most
  // four long and any spread will do.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** One of `pool`, chosen by the game id and the slot name. The slot is in the seed so the verb
 *  and the flow sentence do not move together, which would give four recap shapes instead of
 *  the dozens the pools actually describe. */
const pick = <T>(pool: readonly T[], gameId: string, slot: string): T =>
  pool[seedOf(`${gameId}:${slot}`) % pool.length]

const ORD = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
const ord = (n: number) => ORD[n] ?? `${n}th`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const nick = (t: WpblTeam) => `the ${t.name}`

const runsByInning = (line: WpblGame['away_line'], n: number): number[] => {
  const out = Array(n).fill(0)
  for (const e of line ?? []) if (e.inning >= 1 && e.inning <= n) out[e.inning - 1] = e.runs
  return out
}

function battingStatline(b: WpblBattingLine): string {
  const parts = [`${b.h}-${b.ab}`]
  if (b.hr) parts.push(`${b.hr} HR`)
  if (b.rbi) parts.push(`${b.rbi} RBI`)
  if (!b.hr && b.doubles) parts.push(`${b.doubles} 2B`)
  if (!b.hr && !b.rbi && !b.doubles && b.r) parts.push(`${b.r} R`)
  if (b.sb) parts.push(`${b.sb} SB`)
  return parts.slice(0, 3).join(', ')
}

function pitchingStatline(p: WpblPitchingLine): string {
  const parts = [`${outsToIp(p.outs)} IP`, `${p.so} K`]
  parts.push(`${p.er} ER`)
  return parts.join(', ')
}

// A batter's two consecutive plate appearances both homering — reuses the shared PA rule so
// steals/pickoffs between swings don't count as "in between". Returns the inning, or null.
function backToBackHR(plays: WpblRecapPlay[]): number | null {
  const lastPaEvent = new Map<string, string>()
  for (const p of plays) {
    if (!p.team_id) continue
    if (!classifyPa(p)) continue
    if (lastPaEvent.get(p.team_id) === 'home_run' && p.event_type === 'home_run') return p.inning
    lastPaEvent.set(p.team_id, p.event_type ?? '')
  }
  return null
}

export function buildRecap(
  game: WpblGame,
  teams: Map<string, WpblTeam>,
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  plays: WpblRecapPlay[],
  nameOf: (playerId: string) => string,
  ctx: RecapLeagueContext = DEFAULT_RECAP_CONTEXT,
): GameRecap | null {
  if (game.status !== 'final' || game.home_score == null || game.away_score == null || game.home_score === game.away_score) return null
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  if (!away || !home) return null

  const homeWon = game.home_score > game.away_score
  const winner = homeWon ? home : away
  const loser = homeWon ? away : home
  const winnerScore = homeWon ? game.home_score : game.away_score
  const loserScore = homeWon ? game.away_score : game.home_score
  const margin = winnerScore - loserScore
  // The line score is the truth about how long the game ran: `innings` on the row is not
  // populated, and the feed's own count includes the phantom inning playedInnings strips.
  // Getting this right is what lets an actual extra-inning game's last frame reach the
  // walk-off / comeback walk below, instead of being cut off at regulation.
  const innings = Math.max(playedInnings(game.away_line, game.home_line), game.innings ?? 7)

  // ── Walk the line score for first blood, the winner's deepest hole (comeback), and a
  // bottom-of-the-last walk-off; the winner's own biggest inning is the decisive swing. ──
  const aRuns = runsByInning(game.away_line, innings)
  const hRuns = runsByInning(game.home_line, innings)
  const winnerRuns = homeWon ? hRuns : aRuns
  let a = 0, h = 0, winnerDeficit = 0, walkOff = false
  let firstBlood: { team: WpblTeam; inning: number; runs: number } | null = null
  const winLead = () => (homeWon ? h - a : a - h)
  for (let i = 1; i <= innings; i++) {
    if (aRuns[i - 1] > 0 && !firstBlood) firstBlood = { team: away, inning: i, runs: aRuns[i - 1] }
    a += aRuns[i - 1]
    if (winLead() < 0) winnerDeficit = Math.max(winnerDeficit, -winLead())
    const preH = h
    if (hRuns[i - 1] > 0 && !firstBlood) firstBlood = { team: home, inning: i, runs: hRuns[i - 1] }
    h += hRuns[i - 1]
    if (winLead() < 0) winnerDeficit = Math.max(winnerDeficit, -winLead())
    if (homeWon && i === innings && hRuns[i - 1] > 0 && preH <= a && h > a) walkOff = true
  }
  let winnerBig = { inning: 0, runs: 0 }
  for (let i = 0; i < innings; i++) if (winnerRuns[i] > winnerBig.runs) winnerBig = { inning: i + 1, runs: winnerRuns[i] }

  const flags = {
    shutout: loserScore === 0,
    blowout: margin >= ctx.blowoutMargin,
    oneRun: margin === 1,
    walkOff,
    comeback: winnerDeficit >= ctx.comebackDeficit,
    extras: innings > 7,
  }

  // ── Headline (present tense, news-style; score shown separately by the UI). ────────────
  const slugfest = !flags.blowout && !flags.shutout && winnerScore + loserScore >= ctx.slugfestRuns && loserScore >= ctx.slugfestSide
  // Pools rather than one verb each, because a four-club league plays the same four matchups
  // over and over and most finals land in the last branch: an entire season of "Firebells top
  // Queens" was the result. The pick is seeded on the game id, so a given game's headline never
  // changes. Present tense, plural, and it has to read as a headline with the club name in
  // front of it, which is what rules out most of the obvious synonyms.
  const verbs: readonly string[] =
      flags.walkOff ? ['walk off']
    : flags.shutout ? ['shut out', 'blank']
    : flags.blowout ? ['rout', 'hammer', 'roll past', 'pull away from']
    : flags.comeback ? ['rally past', 'come back to beat', 'rally to beat']
    // 'outscore' was cut: every winner outscores the loser, so it says nothing.
    : slugfest ? ['outslug']
    // Extra innings earn their own verb ahead of the margin ones. It is the only entry here
    // that adds a FACT rather than a synonym: the game went long, which the score cannot say.
    : flags.extras ? ['outlast']
    : flags.oneRun ? ['edge', 'slip past', 'hold off']
    // This branch runs from a 3-run win up to the blowout cutoff, which in this league is
    // around 9, so every verb in it has to survive a wide margin. 'get past' and 'down' did
    // not: "Queens get past Hunters" was a 12-4.
    : ['top', 'beat']
  const headline = `${winner.name} ${pick(verbs, game.id, 'verb')} ${loser.name}`

  // ── Stars: rank hitters (total bases + RBI + runs) and pitchers together; a pitcher earns
  // a spot only with a real, clean outing on the winning side (or a save), so a cameo reliever
  // or a shelled losing arm can't sneak in. ──────────────────────────────────────────────
  const batStars: RecapStar[] = batting
    .filter(b => b.h > 0 || b.rbi > 0 || b.r > 0)
    .map(b => ({ playerId: b.player_id, name: nameOf(b.player_id), teamId: b.team_id, kind: 'bat' as const,
      statline: battingStatline(b), score: b.tb + b.rbi + b.r + b.sb + b.bb * 0.5 }))
  const pitchStars: RecapStar[] = pitching
    .filter(p => p.er <= 3 && (p.outs >= 9 || p.decision === 'S') && (p.team_id === winner.id || p.decision === 'S'))
    .map(p => ({ playerId: p.player_id, name: nameOf(p.player_id), teamId: p.team_id, kind: 'pitch' as const,
      statline: pitchingStatline(p),
      score: p.outs + p.so * 1.2 - p.er * 2 - p.h * 0.4 - p.bb * 0.4 + (p.decision === 'W' ? 2 : 0) + (p.decision === 'S' ? 3 : 0) }))
    .filter(s => s.score >= 8)
  const seen = new Set<string>()
  const ranked = [...batStars, ...pitchStars]
    .sort((x, y) => y.score - x.score)
    .filter(s => (seen.has(s.playerId) ? false : (seen.add(s.playerId), true)))

  // ── THE PLAYER OF THE GAME COMES FROM THE TEAM THAT WON. ───────────────────────────────
  //
  // `stars[0]` is not "the best line in the box score", whatever the ranking above measures.
  // It is the gold medal on the Home card, the first medal in the Discord box score, and the
  // name the blurb puts in "X led the way" directly after a sentence about the winner. Filled
  // from the losing side it does not read as a generous mention, it reads as a mistake:
  // "Firebells walk off Heights. Denae Benites led the way" is a Heights player credited for
  // a Firebells win.
  //
  // It happened in 5 of the season's first 25 decided finals, a fifth of them, and the
  // arithmetic is ordinary rather than exotic: the league's best hitter plays for a club that
  // loses a lot, so her line beats every winner's on a regular basis. Aug 30 is the clearest
  // case. Andréanne Leblanc hit a two-out walk-off grand slam to win it 11-9, and the card
  // credited Benites, who went 1-for-4 in the loss with a bigger RBI total.
  //
  // The pitching filter above has taken this position since it was written: a losing arm
  // cannot be a star at all (only a save escapes). This is the same rule applied to the half
  // of the ranking that never got it.
  //
  // ONLY THE LEAD SLOT IS PROMOTED, and the rest stay in score order on purpose. Sorting the
  // whole list winner-first would fill all three places from the winning side, since a winning
  // team always has three batters who scored or drove one in, and that quietly deletes the
  // thing worth reporting about the loser: on Aug 22 it would have dropped Ashton Lansdell's
  // 15-point game off the card entirely. Promote the winner to the medal, leave the rest of
  // the board honest.
  //
  // NO TUNING CONSTANT, deliberately. A weighting factor on losing lines would need defending
  // every time somebody looked at it, and would still leave the top slot wrong whenever a big
  // enough game beat the multiplier.
  const leadIdx = ranked.findIndex(s => s.teamId === winner.id)
  const stars = (leadIdx > 0
    ? [ranked[leadIdx], ...ranked.filter((_, i) => i !== leadIdx)]
    : ranked   // already a winner, or (never seen) nobody on the winning side qualified
  ).slice(0, 3)

  // ── Narrative blurb: how it unfolded (the decisive swing is always the winner's), then the
  // day's biggest bat or arm. ─────────────────────────────────────────────────────────────
  const struckElsewhere = !!firstBlood && firstBlood.team.id !== winner.id
  // Each branch is a pool for the same reason the verbs are: the shape of a game repeats all
  // season, so the sentence describing it cannot be a single fixed string. Every variant in a
  // pool has to say the SAME thing, since which one a game gets is decided by a hash and not by
  // anything about the game. A variant that hedges differently, or claims a little more, would
  // make the recap's accuracy depend on the game id.
  const W = cap(nick(winner))
  const bigInning = `${article(winnerBig.runs)} ${winnerBig.runs}-run ${ord(winnerBig.inning)}`
  let flow: string
  if (flags.walkOff) {
    const tail = flags.extras ? `, after ${innings} innings` : ''
    flow = pick([
      `${W} won it in the bottom of the ${ord(innings)}${tail}.`,
      `${W} ended it in the bottom of the ${ord(innings)}${tail}.`,
      `${W} walked it off in the ${ord(innings)}${tail}.`,
    ], game.id, 'flow')
  } else if (flags.comeback) {
    const on = winnerBig.runs >= ctx.bigInningRuns ? ` on ${bigInning}` : ''
    flow = pick([
      `${W} came back from ${winnerDeficit} runs down${on} to take it.`,
      `${W} erased a ${winnerDeficit}-run deficit${on} and took it.`,
      `Down ${winnerDeficit}, ${nick(winner)} came back${on} to win it.`,
    ], game.id, 'flow')
  } else if (winnerBig.runs >= ctx.bigInningRuns && struckElsewhere && firstBlood) {
    const F = cap(nick(firstBlood.team))
    const early = firstBlood.runs > 1 ? `, putting up ${firstBlood.runs} in the ${ord(firstBlood.inning)}` : ''
    flow = pick([
      `${F} scored first${early}, but ${nick(winner)} put up ${bigInning}.`,
      `${F} opened the scoring${early}, but ${nick(winner)} answered with ${bigInning}.`,
      `${F} struck first${early}, before ${nick(winner)} put up ${bigInning}.`,
    ], game.id, 'flow')
  } else if (winnerBig.runs >= ctx.bigInningRuns) {
    const openedEarlier = firstBlood && firstBlood.inning !== winnerBig.inning
    const early = openedEarlier && firstBlood!.runs > 1 ? ` with ${firstBlood!.runs} in the ${ord(firstBlood!.inning)}` : ''
    flow = openedEarlier
      ? pick([
        `${W} scored first${early} and pulled ahead with ${bigInning}.`,
        `${W} opened the scoring${early} and broke it open with ${bigInning}.`,
        `${W} got on the board first${early} and took control with ${bigInning}.`,
      ], game.id, 'flow')
      : pick([
        `${W} pulled ahead with ${bigInning}.`,
        `${W} broke it open with ${bigInning}.`,
        `${cap(article(winnerBig.runs))} ${winnerBig.runs}-run ${ord(winnerBig.inning)} put ${nick(winner)} in front.`,
      ], game.id, 'flow')
  } else if (margin <= ctx.closeMargin) {
    flow = pick([
      `${W} held on for ${article(winnerScore)} ${winnerScore}-${loserScore} win.`,
      `${W} hung on for ${article(winnerScore)} ${winnerScore}-${loserScore} win.`,
    ], game.id, 'flow')
  } else {
    flow = pick([
      `${W} pulled away for ${article(winnerScore)} ${winnerScore}-${loserScore} win.`,
      `${W} cruised to ${article(winnerScore)} ${winnerScore}-${loserScore} win.`,
      `${W} controlled it, ${winnerScore}-${loserScore}.`,
    ], game.id, 'flow')
  }
  const top = stars[0]
  const starLine = !top ? ''
    : top.kind === 'bat'
      ? pick([
        ` ${top.name} went ${top.statline}.`,
        ` ${top.name} led the way, going ${top.statline}.`,
        ` ${top.name} did the damage: ${top.statline}.`,
      ], game.id, 'star')
      : pick([
        ` ${top.name} threw ${top.statline}.`,
        ` ${top.name} went ${top.statline} on the mound.`,
        ` ${top.name} handled it from the mound: ${top.statline}.`,
      ], game.id, 'star')
  const blurb = flow + starLine

  // ── Decisions (W / L / S) with their lines. ────────────────────────────────────────────
  const decisions: RecapDecision[] = []
  for (const key of ['W', 'L', 'S'] as const) {
    const p = pitching.find(pp => pp.decision === key)
    if (p) decisions.push({ key, name: nameOf(p.player_id), teamId: p.team_id, statline: pitchingStatline(p) })
  }

  // ── H-R-E line for each team. ──────────────────────────────────────────────────────────
  const teamLine: [RecapTeamLine, RecapTeamLine] = [
    { teamId: away.id, name: `${away.city} ${away.name}`, r: game.away_score, h: game.away_hits ?? 0, e: game.away_errors ?? 0 },
    { teamId: home.id, name: `${home.city} ${home.name}`, r: game.home_score, h: game.home_hits ?? 0, e: game.home_errors ?? 0 },
  ]

  // ── Auto-detected feats. ───────────────────────────────────────────────────────────────
  const feats: string[] = []
  const loserHits = homeWon ? (game.away_hits ?? null) : (game.home_hits ?? null)
  if (loserHits === 0) feats.push(`${winner.name} no-hit ${loser.name}!`)
  else if (flags.shutout) feats.push(`${winner.name} shutout`)
  for (const b of batting) {
    const singles = b.h - b.doubles - b.triples - b.hr
    if (singles >= 1 && b.doubles >= 1 && b.triples >= 1 && b.hr >= 1) feats.push(`${nameOf(b.player_id)} hit for the cycle!`)
    else if (b.hr >= 2) feats.push(`${nameOf(b.player_id)}: ${b.hr} HR${b.rbi ? `, ${b.rbi} RBI` : ''}`)
    else if (b.rbi >= 4) feats.push(`${nameOf(b.player_id)}: ${b.rbi} RBI`)
  }
  const b2b = backToBackHR(plays)
  if (b2b) feats.push(`Back-to-back homers in the ${ord(b2b)}`)
  for (const p of pitching) {
    if (p.so >= 8) feats.push(`${nameOf(p.player_id)}: ${p.so} K`)
    else if (p.gs === 1 && p.outs >= innings * 3 && pitching.filter(pp => pp.team_id === p.team_id).length === 1) feats.push(`${nameOf(p.player_id)}: complete game`)
  }

  return { winner, loser, winnerScore, loserScore, margin, innings, headline, blurb, stars, decisions, teamLine, feats: feats.slice(0, 5), flags }
}
