import type { WpblGame, WpblTeam, WpblBattingLine, WpblPitchingLine, WpblGamePlay } from '../types'
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
  closeMargin: number      // margin at/below → "tight" flow; also the decisive-inning size
  slugfestRuns: number     // combined runs at/above → "outslug" (with both sides productive)
  slugfestSide: number     // losing side's runs at/above, so a blowout can't read as a slugfest
  comebackDeficit: number  // deficit erased at/above → "rally past"
}

// Season-neutral defaults, used until enough finals (<4) define a league profile.
export const DEFAULT_RECAP_CONTEXT: RecapLeagueContext = {
  blowoutMargin: 6, closeMargin: 2, slugfestRuns: 15, slugfestSide: 7, comebackDeficit: 3,
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
    closeMargin: Math.max(2, r(mMar)),            // at/below the league's typical margin
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
function backToBackHR(plays: WpblGamePlay[]): number | null {
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
  plays: WpblGamePlay[],
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
  const verb = flags.walkOff ? 'walk off'
    : flags.shutout ? 'shut out'
    : flags.blowout ? 'rout'
    : flags.comeback ? 'rally past'
    : slugfest ? 'outslug'
    : flags.oneRun ? 'edge'
    : 'top'
  const headline = `${winner.name} ${verb} ${loser.name}`

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
  const stars = [...batStars, ...pitchStars]
    .sort((x, y) => y.score - x.score)
    .filter(s => (seen.has(s.playerId) ? false : (seen.add(s.playerId), true)))
    .slice(0, 3)

  // ── Narrative blurb: how it unfolded (the decisive swing is always the winner's), then the
  // day's biggest bat or arm. ─────────────────────────────────────────────────────────────
  const struckElsewhere = !!firstBlood && firstBlood.team.id !== winner.id
  let flow: string
  if (flags.walkOff) {
    flow = `${cap(nick(winner))} won it in the bottom of the ${ord(innings)}${flags.extras ? `, after ${innings} innings` : ''}.`
  } else if (flags.comeback) {
    flow = `${cap(nick(winner))} came back from ${winnerDeficit} runs down${winnerBig.runs >= ctx.closeMargin ? ` on ${article(winnerBig.runs)} ${winnerBig.runs}-run ${ord(winnerBig.inning)}` : ''} to take it.`
  } else if (winnerBig.runs >= ctx.closeMargin && struckElsewhere && firstBlood) {
    flow = `${cap(nick(firstBlood.team))} scored first${firstBlood.runs > 1 ? `, putting up ${firstBlood.runs} in the ${ord(firstBlood.inning)}` : ''}, but ${nick(winner)} put up ${article(winnerBig.runs)} ${winnerBig.runs}-run ${ord(winnerBig.inning)}.`
  } else if (winnerBig.runs >= ctx.closeMargin) {
    const openedEarlier = firstBlood && firstBlood.inning !== winnerBig.inning
    flow = openedEarlier
      ? `${cap(nick(winner))} scored first${firstBlood!.runs > 1 ? ` with ${firstBlood!.runs} in the ${ord(firstBlood!.inning)}` : ''} and pulled ahead with ${article(winnerBig.runs)} ${winnerBig.runs}-run ${ord(winnerBig.inning)}.`
      : `${cap(nick(winner))} pulled ahead with ${article(winnerBig.runs)} ${winnerBig.runs}-run ${ord(winnerBig.inning)}.`
  } else if (margin <= ctx.closeMargin) {
    flow = `${cap(nick(winner))} held on for ${article(winnerScore)} ${winnerScore}-${loserScore} win.`
  } else {
    flow = `${cap(nick(winner))} pulled away for ${article(winnerScore)} ${winnerScore}-${loserScore} win.`
  }
  const top = stars[0]
  const starLine = top ? ` ${top.name} ${top.kind === 'bat' ? 'went' : 'threw'} ${top.statline}.` : ''
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
