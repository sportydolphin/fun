// "Biggest play", "highest WPA play", "biggest hit of 2026", "Hunters biggest hit", "Whitmore biggest
// strikeout", "highest leverage at-bats": single plays, ranked by how far they moved the game (the
// win model the WPA column sums, `gameWinProb`) or by how much rode on them (`leverageOfPoint`).
//
// THE SAME POINTS AS THE WPA COLUMN, regular-season finals only, so the biggest hit a row names is
// one of the swings in its batter's WPA. Each row opens Game Center at the play, like a first does.
// Asked for in the Nov 20, 2026 probe ("highest wpa play" was answered with a World Cup name).

import { fetchWpblAllRunValuePlays } from './api'
import { gameWinProb, winProbModel, type WinProbPoint } from './derive/winProbability'
import { leverageModel, leverageOfPoint, fmtLeverage } from './derive/leverage'
import { currentSeason, inSeason } from './season'
import { countsInStandings } from '../league/season'
import { WPBL_FINDER_CLUBS } from './finderLink'
import { wpblGamePath } from './routes'
import { requestPlay } from './entryUrl'
import { foldName } from '../lib/fuzzyName'
import type { PlayAnswer } from '../mlb/state/SearchBridgeContext'
import type { RunValueGame } from './derive/runExpectancy'
import type { WpblGame, WpblPlayer, WpblRunValuePlay, WpblTeam } from './types'

export type BigPlayKind = 'play' | 'hit' | 'out' | 'strikeout' | 'leverage'

export interface BigPlayAsk { kind: BigPlayKind; season: number | null; teamId?: string; who?: string }

const KINDS: { re: RegExp; kind: BigPlayKind }[] = [
  { re: /(?<![a-z])(?:highest|most|biggest|top)\s+(?:leverage|li|pressure)\s+(?:plays?|at[\s-]?bats?|pas?|plate\s+appearances?|spots?|moments?|situations?)(?![a-z])/, kind: 'leverage' },
  { re: /(?<![a-z])(?:biggest|clutchest|most\s+clutch|most\s+important|best|highest\s+wpa)\s+(?:hits?|swings?|home\s*runs?|homers?)(?![a-z])/, kind: 'hit' },
  { re: /(?<![a-z])(?:biggest|most\s+important|highest\s+wpa)\s+(?:strikeouts?|ks?)(?![a-z])/, kind: 'strikeout' },
  { re: /(?<![a-z])(?:biggest|most\s+important|highest\s+wpa)\s+outs?(?![a-z])/, kind: 'out' },
  { re: /(?<![a-z])(?:biggest|most\s+important|highest\s+wpa|top\s+wpa|wpa)\s+(?:plays?|moments?)(?![a-z])|(?<![a-z])(?:plays?\s+of\s+the\s+(?:year|season))(?![a-z])/, kind: 'play' },
]

/** The question in `text`, or null. Whatever is left beside it must be a club, a year or a name. */
export function parseBigPlay(text: string): BigPlayAsk | null {
  // The possessive off first: folded, "Whitmore's" would be a player called "whitmores".
  let t = ` ${foldName(text.replace(/['’]s(?![a-z])/gi, '').replace(/[-/]/g, ' '))} `
  const hit = KINDS.find(k => k.re.test(t))
  if (!hit) return null
  t = t.replace(hit.re, ' ')
  let season: number | null = null
  t = t.replace(/ (20\d\d) /, (_m, y: string) => { season = Number(y); return ' ' })
  const names = WPBL_FINDER_CLUBS.flatMap(c => c.names.map(n => ({ id: c.id, n: foldName(n) }))).sort((a, b) => b.n.length - a.n.length)
  let teamId: string | undefined
  for (const { id, n } of names) {
    const re = new RegExp(` (?:the )?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s? `)
    if (re.test(t)) { teamId = id; t = t.replace(re, ' '); break }
  }
  const who = t.replace(/(?<![a-z])(?:the|of|in|for|by|s|ever|season|year|this|wpbl|league|who|had|has|was|what|were|are|is)(?![a-z])/g, ' ')
    .replace(/\s+/g, ' ').trim()
  if (who && teamId) return null
  return { kind: hit.kind, season, ...(teamId ? { teamId } : {}), ...(who.length >= 3 ? { who } : {}) }
}

const MAX = 3
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const HIT_WORDS = /\b(?:singled|doubled|tripled|homered|home run|grand slam|inside-the-park)\b/i
const OUT_WORDS = /\b(?:struck out|grounded|flied|lined out|popped|fouled out|out at|double play|triple play|caught stealing|picked off)\b/i

/** The plays, best first, for an ask over one season's plays and games. Pure for the tests. */
export function bigPlays(ask: BigPlayAsk, plays: WpblRunValuePlay[], games: WpblGame[], ids: string[]):
  { pt: WinProbPoint; game: WpblGame; value: number }[] {
  const wp = winProbModel(plays, games)
  const li = ask.kind === 'leverage' ? leverageModel(wp, plays, games as RunValueGame[]) : null
  const byGame = new Map<string, WpblRunValuePlay[]>()
  for (const p of plays) { const a = byGame.get(p.game_id); if (a) a.push(p); else byGame.set(p.game_id, [p]) }
  const mine = new Set(ids)
  const out: { pt: WinProbPoint; game: WpblGame; value: number }[] = []
  for (const g of games) {
    if (g.status !== 'final' || !countsInStandings(g)) continue
    if (ask.teamId && g.home_team_id !== ask.teamId && g.away_team_id !== ask.teamId) continue
    const gp = byGame.get(g.id)
    if (!gp?.length) continue
    for (const pt of gameWinProb(wp, gp, g).points) {
      const p = pt.play
      const forBatter = p.team_id === g.home_team_id ? pt.swing : -pt.swing
      const isPa = !!p.pitch_sequence
      // Whose the play was, and the swing from their side.
      let side: number
      if (ids.length) {
        if (p.batter_id && mine.has(p.batter_id)) side = forBatter
        else if (p.pitcher_id && mine.has(p.pitcher_id) && isPa) side = -forBatter
        else continue
      } else if (ask.teamId) side = p.team_id === ask.teamId ? forBatter : -forBatter
      else side = ask.kind === 'out' || ask.kind === 'strikeout' ? -forBatter : ask.kind === 'hit' ? forBatter : Math.abs(pt.swing)
      if (ask.kind === 'hit' && (!isPa || !HIT_WORDS.test(p.narrative ?? '') || (ids.length && !mine.has(p.batter_id ?? '')))) continue
      if (ask.kind === 'out' && (!isPa || !OUT_WORDS.test(p.narrative ?? ''))) continue
      if (ask.kind === 'strikeout' && (!isPa || !/\bstruck out\b/i.test(p.narrative ?? '') || (ids.length && !mine.has(p.pitcher_id ?? '')))) continue
      const value = li ? leverageOfPoint(li, pt) : side
      if (!li && value <= 0) continue
      out.push({ pt, game: g, value })
    }
  }
  return out.sort((a, b) => b.value - a.value).slice(0, MAX)
}

/** The rows for `text`, or none when it is not such a question. */
export async function wpblBigPlayAnswers(text: string, ctx: { games: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[] }): Promise<PlayAnswer[]> {
  const ask = parseBigPlay(text)
  if (!ask) return []
  const season = ask.season ?? currentSeason(ctx.games)
  if (season == null) return []
  let ids: string[] = []
  if (ask.who) {
    const w = foldName(ask.who)
    const whole = ctx.players.filter(p => foldName(p.name) === w)
    ids = (whole.length ? whole : ctx.players.filter(p => foldName(p.name).split(' ').pop() === w)).map(p => p.id)
    if (!ids.length) return []
  }
  const plays = inSeason(await fetchWpblAllRunValuePlays(season), ctx.games, season)
  const games = ctx.games.filter(g => g.game_date.startsWith(String(season)))
  const abbr = (id: string) => ctx.teams.find(t => t.id === id)?.abbr ?? id
  return bigPlays(ask, plays, games, ids).map(({ pt, game, value }, i) => {
    const p = pt.play
    // The play itself, up to the first runner's clause or the pitch codes: "Andréanne Leblanc homered
    // to center field, 4 RBI", not every runner's line after it.
    const sentence = (p.narrative ?? '').split(/;|\s\(/)[0].replace(/, unearned/g, '').replace(/[.\s]+$/, '').trim() || `${p.batter_name} vs ${p.pitcher_name}`
    const measure = ask.kind === 'leverage' ? `LI ${fmtLeverage(value)}` : `${value > 0 ? '+' : ''}${Math.round(value * 100)}% win probability`
    return {
      key: `big-${ask.kind}-${ask.teamId ?? ask.who ?? 'league'}-${season}-${i}`,
      title: sentence,
      detail: `${measure} · ${abbr(game.away_team_id)} at ${abbr(game.home_team_id)} · ${shortDay(game.game_date)} · ${p.half === 'top' ? 'Top' : 'Bottom'} ${p.inning}`,
      href: `${wpblGamePath(game, ctx.teams, ctx.games)}#play-${p.sequence}`,
      open: () => requestPlay(game.id, p.sequence),
      play: { gameId: game.id, sequence: p.sequence },
    }
  })
}
