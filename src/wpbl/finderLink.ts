// WPBL's half of a stat question typed as words: its clubs as the parser reads them, and the
// address of its Find board. The shell's search (src/finderSearch.ts) and the board's own "Ask in
// words" box both go through here, so a question means the same in both places, and neither
// section imports the other to get at it.

import type { FinderClubAlias, ParsedFinder } from '../league/finderParse'
import { encodeFinderQuery, type FinderBoardSide, type FinderQuery } from '../league/finder'
import type { RosterPlayer } from '../league/playerQuestion'
import type { FinderReading } from '../ui/finderBoard'
import type { WpblBattingLine, WpblPitchingLine, WpblPlayer } from './types'
import { WPBL_TEAMS } from './constants'
import { REGULATION_INNINGS } from './innings'

/** The sides WPBL's Find board searches: the glove too, since the section stores fielding lines. */
export const WPBL_FINDER_SIDES: readonly FinderBoardSide[] = ['hitting', 'pitching', 'fielding']

/** What else WPBL's board can answer: a pitcher's half-innings and every plate appearance, from the play log. */
export const WPBL_FINDER_OPTS = { plays: true, regulationInnings: REGULATION_INNINGS } as const

export const WPBL_FINDER_CLUBS: FinderClubAlias[] = Object.values(WPBL_TEAMS).map(t => ({
  id: t.id, names: [t.abbr, t.city, t.name, `${t.city} ${t.name}`],
}))

/** The Find board asking `p`. */
export function wpblFinderHref(p: Omit<ParsedFinder, 'season' | 'ignored'> & {
  season?: number | null; ignored?: string[]; playerId?: string | null; batterId?: string | null; pitcherId?: string | null
}): string {
  const params = new URLSearchParams({ board: 'find', side: p.side })
  // No `q` for a game question with no stat ("Sato vs hunters"), which is the board's default grain.
  const q = encodeFinderQuery(p)
  if (q) params.set('q', q)
  if (p.teamId) params.set('team', p.teamId)
  if (p.oppId) params.set('opp', p.oppId)
  if (p.venue !== 'any') params.set('venue', p.venue)
  // The players, under the names StatsView reads (src/wpbl/stats/address.ts).
  if (p.playerId) params.set('by', p.playerId)
  if (p.batterId) params.set('bat', p.batterId)
  if (p.pitcherId) params.set('pit', p.pitcherId)
  if (p.season) params.set('season', String(p.season))
  // The finder's grammar is URL-safe on purpose (see encodeFinderQuery), so undo the escaping
  // URLSearchParams gives `~`: the address should read the way the board writes it.
  return `/wpbl/stats?${params.toString().replace(/%7E/gi, '~')}`
}

/**
 * Who has hit and who has pitched, for a name in a typed question ("Hondras vs RHP", "Whitmore off
 * Schroder"): whether a name is the batter or the pitcher in a matchup, and which side one player's
 * question is asked on, is read off the lines handed in. The search and the board's own box both
 * read names against this, so a name means the same player and the same side in both.
 */
export function wpblFinderRoster(
  players: readonly Pick<WpblPlayer, 'id' | 'name'>[],
  batting: readonly Pick<WpblBattingLine, 'player_id' | 'ab' | 'bb' | 'hbp' | 'sf' | 'sh'>[],
  pitching: readonly Pick<WpblPitchingLine, 'player_id' | 'bf' | 'outs'>[],
): RosterPlayer[] {
  const pa = new Map<string, number>(), bf = new Map<string, number>()
  for (const l of batting) pa.set(l.player_id, (pa.get(l.player_id) ?? 0) + l.ab + l.bb + l.hbp + l.sf + l.sh)
  for (const l of pitching) bf.set(l.player_id, (bf.get(l.player_id) ?? 0) + Math.max(l.bf ?? 0, l.outs))
  return players.map(p => {
    const trips = pa.get(p.id) ?? 0, faced = bf.get(p.id) ?? 0
    return { id: p.id, name: p.name, hits: trips > 0, pitches: faced > 0, lean: faced > trips ? 'pitching' as const : 'hitting' as const }
  }).filter(p => p.hits || p.pitches)
}

/**
 * The board's question once a typed reading on its own side is asked. A typed question is a whole
 * question: its stat, club, place, span and arm replace the board's. Only the players outlive it when
 * it names none, and a matchup only at the grain that asks it. Until Nov 19, 2026 the span and the
 * arm were dropped here, so "2 hits vs rhp" said "vs RHP" in the preview and then asked every pitcher.
 */
export function askedFinderQuery(query: FinderQuery, r: FinderReading): FinderQuery {
  const named = r.playerId !== undefined || r.batterId !== undefined || r.pitcherId !== undefined
  return {
    ...query, per: r.per, conditions: r.conditions, teamId: r.teamId, oppId: r.oppId, venue: r.venue, byClub: !!r.byClub,
    from: r.from ?? null, to: r.to ?? null, last: r.last ?? null, hand: r.hand ?? null,
    ...(named ? { playerId: r.playerId ?? null, batterId: r.batterId ?? null, pitcherId: r.pitcherId ?? null }
      : r.per === 'pa' ? {} : { batterId: null, pitcherId: null }),
  }
}
