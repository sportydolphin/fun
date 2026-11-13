import { liveNotes, type LiveNote, type NotePos, type NotesOptions, type PlayReading, type ThrowChain } from '../../league/liveNotes'
import { WPBL_LEAGUE } from '../league'
import { seasonOf } from '../season'
import type { WpblGame, WpblGamePlay } from '../types'
import { defenseIndex, errorFielders, readDoublePlay } from './fielding'

/**
 * WPBL's half of the live notes (src/league/liveNotes.ts): the scorer's words read for the throw
 * chains and the errors, and who stood at each position from the box score's lineups and the log's
 * own substitution rows (`defenseIndex`, the same placement Fielding's inning grain uses).
 *
 * THE CALLER HANDS IN EVERY SEASON. A note's history is everything before it, so "first in WPBL
 * history" in 2027 needs 2026's plays too; cutting to one season here would make every 2027 first a
 * first ever. The plays must already carry the corrections (`applyPlayCorrections`), as every other
 * reader of the log does.
 */

export interface WpblNotesInput {
  games: readonly WpblGame[]
  plays: readonly WpblGamePlay[]
  /** Batting and pitching lines, with positions: who started where, and each player's club that day. */
  lines: readonly { game_id: string; player_id: string; team_id: string | null; position?: string | null }[]
  players: readonly { id: string; name: string }[]
  teams: readonly { id: string; city: string | null; name: string }[]
}

const POS = '(?:p|c|1b|2b|3b|ss|lf|cf|rf)'
const CHAIN = new RegExp(`\\bout at (first|second|third|home) (${POS}(?: to ${POS})*)`, 'i')
const TRIPLE = new RegExp(`\\btriple play((?: ${POS}(?: to)?)*)`, 'i')

const chainOf = (text: string): NotePos[] => {
  const out: NotePos[] = []
  for (const t of text.toLowerCase().split(/\s+/)) {
    if (/^(?:p|c|1b|2b|3b|ss|lf|cf|rf)$/.test(t) && out[out.length - 1] !== t) out.push(t as NotePos)
  }
  return out
}

/** Every throw chain the row's text writes, and every fielder charged with an error. */
export function readWpblPlay(narrative: string | null): PlayReading {
  const text = narrative ?? ''
  const chains: ThrowChain[] = []
  const dp = readDoublePlay(text)
  if (dp) chains.push({ what: 'dp', base: null, chain: dp.chain, how: null })
  const tp = TRIPLE.exec(text.split(';')[0])
  if (tp) chains.push({ what: 'tp', base: null, chain: chainOf(tp[1] ?? ''), how: null })
  // A double play's own clause names its chain once; the runner's "out on the play" adds nothing.
  for (const clause of text.split(';')) {
    const m = CHAIN.exec(clause)
    if (!m || (dp && /\bdouble play\b/i.test(clause))) continue
    const how = /picked off/i.test(clause) ? 'pk' : /caught stealing/i.test(clause) ? 'cs' : null
    chains.push({ what: 'out', base: m[1].toLowerCase() as ThrowChain['base'], chain: chainOf(m[2]), how })
  }
  return { chains, errors: errorFielders(text) }
}

/** Every game's notes, by game id. */
export function wpblLiveNotes(input: WpblNotesInput, opts?: NotesOptions): Map<string, LiveNote[]> {
  const names = new Map(input.players.map(p => [p.id, p.name.trim()]))
  const clubs = new Map(input.teams.map(t => [t.id, t.city ?? t.name]))
  const fielderAt = defenseIndex(input.lines, input.plays, input.players)
  return liveNotes<WpblGame>({
    league: WPBL_LEAGUE,
    leagueName: 'WPBL',
    games: input.games,
    plays: input.plays,
    season: seasonOf,
    when: g => `${g.game_date} ${g.start_time ?? ''}`,
    playerName: id => names.get(id) ?? 'Unknown player',
    clubName: id => clubs.get(id) ?? id,
    read: p => readWpblPlay(p.narrative),
    fielderAt,
  }, opts)
}
