// The Pitches board's rates in the search box: "best whiff rate", "lowest contact rate", "Whitmore
// first pitch strike rate", "pitches per plate appearance leaders".
//
// RANKED AS THE BOARD RANKS (`rankBy` over `aggregatePitchCodes`, the board's own pitch minimums), so
// the leader a row names is the first row of the card it opens. Every rate has a good end that
// depends on the side: a pitcher wants whiffs, a hitter does not. "Best" means the good end, "highest"
// the high one. Before Nov 20, 2026 none of these words reached anything: the rates lived on the
// Pitches board alone.

import { fetchWpblAllPitchPlays } from './api'
import { aggregatePitchCodes, fmtPct, pitchQualifiers, rankBy, type PitchBoard, type PitchRates } from './derive/pitches'
import { wpblQualifiers } from './stats'
import { currentSeason, gamesInSeason, inSeason } from './season'
import { foldName } from '../lib/fuzzyName'
import type { PlayAnswer } from '../mlb/state/SearchBridgeContext'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

type Side = 'hitting' | 'pitching'
type RateKey = keyof PitchRates

interface RateDef {
  key: RateKey
  /** How a row names it: a label, the way the board's cards do. */
  label: string
  words: RegExp
  /** The side a bare question means. */
  lean: Side
  /** Whether the high end is the good one, per side. */
  highGood: Record<Side, boolean>
}

const RATES: readonly RateDef[] = [
  { key: 'swStrPct', label: 'swinging strike rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:swinging[\s-]strike(?:s)?\s*(?:rate|%|pct|percentage)?|swstr\s*%?|swstr\s+rate)(?![a-z])/ },
  { key: 'whiffPct', label: 'whiff rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:whiff\s*(?:rate|%|pct|percentage)|whiffs?|swing[\s-]and[\s-]miss(?:\s+rate)?|miss\s+rate|swings?\s+missed)(?![a-z])/ },
  { key: 'contactPct', label: 'contact rate', lean: 'hitting', highGood: { pitching: false, hitting: true },
    words: /(?<![a-z])contact\s*(?:rate|%|pct|percentage)(?![a-z])/ },
  { key: 'swingPct', label: 'swing rate', lean: 'hitting', highGood: { pitching: true, hitting: true },
    words: /(?<![a-z])swing\s*(?:rate|%|pct|percentage)(?![a-z])/ },
  { key: 'calledPct', label: 'called strike rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:called[\s-]strikes?\s*(?:rate|%|pct|percentage)?|taken\s+strikes?)(?![a-z])/ },
  { key: 'firstStrikePct', label: 'first-pitch strike rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:first[\s-]pitch[\s-]strikes?\s*(?:rate|%|pct|percentage)?|f[\s-]strike\s*%?|first[\s-]strike\s*(?:rate|%))(?![a-z])/ },
  { key: 'putawayPct', label: 'putaway rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:put[\s-]?away\s*(?:rate|%|pct|percentage)?|two[\s-]strike\s+(?:strikeout|k)\s+rate)(?![a-z])/ },
  { key: 'pitchesPerPa', label: 'pitches per plate appearance', lean: 'hitting', highGood: { pitching: false, hitting: true },
    words: /(?<![a-z])(?:pitches\s+(?:seen\s+)?per\s+(?:plate\s+appearance|pa|at[\s-]?bat)|p\/pa)(?![a-z])/ },
  { key: 'groundOutPct', label: 'groundout rate', lean: 'pitching', highGood: { pitching: true, hitting: false },
    words: /(?<![a-z])(?:ground[\s-]?outs?\s*(?:rate|%|pct|percentage)|go\s*%)(?![a-z])/ },
]

export interface PitchRateAsk {
  def: RateDef
  side: Side
  /** 'high' or 'low' end; null for the good end of the side. */
  end: 'high' | 'low' | 'good' | 'bad'
  season: number | null
  /** A player's name, as typed, or null for the board. */
  who: string | null
}

const FILLER = /(?<![a-z])(?:the|a|an|in|of|on|for|by|is|has|who|whos|who's|which|what|whats|what's|league|wpbl|leaders?|leaderboard|rank(?:ed|ing|s)?|board|this|season|year|stats?|rate|player|players|does|do|where|with)(?![a-z])/g

/** The pitch-rate question in `text`, or null. */
export function parsePitchRateText(text: string): PitchRateAsk | null {
  let t = ` ${text.toLowerCase().replace(/[?!.]+$/, '').replace(/\s+/g, ' ')} `
  const def = RATES.find(d => d.words.test(t))
  if (!def) return null
  t = t.replace(def.words, ' ')
  let season: number | null = null
  t = t.replace(/(?<![0-9])(20\d\d)(?![0-9])/, (_m, y: string) => { season = Number(y); return ' ' })
  const hitters = /(?<![a-z])(?:hitters?|batters?|hitting|batting|offense)(?![a-z])/.test(t)
  const pitchers = /(?<![a-z])(?:pitchers?|pitching|starters?|relievers?|staff)(?![a-z])/.test(t)
  if (hitters && pitchers) return null
  t = t.replace(/(?<![a-z])(?:hitters?|batters?|hitting|batting|offense|pitchers?|pitching|starters?|relievers?|staff|against|allowed|induced)(?![a-z])/g, ' ')
  let end: PitchRateAsk['end'] = 'good'
  t = t.replace(/(?<![a-z])(best|top|worst|bottom|highest|most|lowest|least|fewest)(?![a-z])/g, (_m, w: string) => {
    end = /best|top/.test(w) ? 'good' : /worst|bottom/.test(w) ? 'bad' : /highest|most/.test(w) ? 'high' : 'low'
    return ' '
  })
  const who = t.replace(FILLER, ' ').replace(/['’]s\b/g, ' ').replace(/[^a-z .'-]/g, ' ').replace(/\s+/g, ' ').trim()
  return { def, side: hitters ? 'hitting' : pitchers ? 'pitching' : def.lean, end, season, who: who.length >= 2 ? who : null }
}

const valueText = (key: RateKey, v: number | null) => (key === 'pitchesPerPa' ? (v == null ? '—' : v.toFixed(2)) : fmtPct(v))

function ordinal(n: number): string {
  const ten = n % 100
  return `${n}${ten >= 11 && ten <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** The rows for one question over a season's board: the leader of the board, or one player's line. */
export function pitchRateRows(ask: PitchRateAsk, board: PitchBoard, mins: { minPitcher: number; minBatter: number },
  season: number, players: readonly WpblPlayer[]): PlayAnswer[] {
  const { def, side } = ask
  const highFirst = ask.end === 'high' || (ask.end === 'good' && def.highGood[side]) || (ask.end === 'bad' && !def.highGood[side])
  const pool = side === 'pitching' ? board.pitchers : board.batters
  const min = side === 'pitching' ? mins.minPitcher : mins.minBatter
  const ranked = rankBy(pool, def.key, min, !highFirst, board.league)
  const league = valueText(def.key, board.league[def.key])
  const href = `/wpbl/stats?board=pitches&side=${side}&season=${season}`
  const noun = side === 'pitching' ? 'pitchers' : 'hitters'
  if (ask.who) {
    const w = foldName(ask.who)
    const mine = pool.filter(p => p.player && (foldName(p.player.name) === w || foldName(p.player.name).split(' ').pop() === w
      || foldName(p.player.name).includes(w)))
    // A name nobody on the board has: not this question's to answer.
    if (!mine.length && !players.some(p => foldName(p.name).includes(w))) return []
    return mine.slice(0, 3).flatMap(p => {
      const v = p[def.key]
      if (v == null) return []
      const at = ranked.indexOf(p)
      const place = at >= 0 ? `${ordinal(at + 1)} of ${ranked.length} ${noun}` : null
      return [{
        key: `pitch-rate-${def.key}-${side}-${p.player!.id}-${season}`,
        title: `${p.name} ${def.label}`,
        detail: [valueText(def.key, v), String(season), place, `league ${league}`].filter(Boolean).join(' · '),
        href, open: () => {},
      }]
    })
  }
  const top = ranked[0]
  if (!top) return []
  const shown = valueText(def.key, top[def.key])
  const tied = ranked.slice(1).filter(p => valueText(def.key, p[def.key]) === shown).length
  const word = highFirst ? 'Highest' : 'Lowest'
  const who = tied ? `${top.name} and ${tied} more lead with` : `${top.name} leads with`
  return [{
    key: `pitch-rate-${def.key}-${side}-${highFirst ? 'high' : 'low'}-${season}`,
    title: `${word} ${def.label}${side === 'hitting' && def.lean === 'pitching' ? ' by a hitter' : side === 'pitching' && def.lean === 'hitting' ? ' by a pitcher' : ''}`,
    detail: `${who} ${shown} · ${season} · league ${league}`,
    href, open: () => {},
  }]
}

/** Reads the season's plays and answers, or nothing when the text is no such question. */
export async function wpblPitchRateAnswers(text: string, ctx: { games: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[] }): Promise<PlayAnswer[]> {
  const ask = parsePitchRateText(text)
  if (!ask) return []
  const season = ask.season ?? currentSeason(ctx.games)
  if (season == null) return []
  const plays = inSeason(await fetchWpblAllPitchPlays(season), ctx.games, season)
  const board: PitchBoard = aggregatePitchCodes(plays, ctx.players, ctx.games)
  if (!board.pitches) return []
  // The board's own bar, restated in pitches (PitchView): measured in the season's games.
  const qual = wpblQualifiers(ctx.teams, gamesInSeason(ctx.games, season))
  return pitchRateRows(ask, board, pitchQualifiers(qual.active ? qual.teamGames : 0), season, ctx.players)
}

