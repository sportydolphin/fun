// "Draft eligible hitters", "re-signed pitchers era", "Boston 2027 roster", "unsigned players": the
// Players board under its 2027 roster filter (StatsView, `roster=`), offered while the board offers
// it. The words are read here; the choices and who passes them are offseason2027.ts's, so the row
// and the board cannot disagree.

import { parseLeaderText } from '../league/finderParse'
import { boardColumn, leaderTitle } from '../finderSearch'
import { fetchWpblAllLines, fetchWpblRosterMoves } from './api'
import { WPBL_FINDER_CLUBS } from './finderLink'
import { currentSeason, inSeason } from './season'
import {
  CLUB_CITIES, ROSTER_KIND_LABELS, ROSTER_SEASON, matchesRosterFilter, rosterFilterOffered, rosterFilterParam,
  rosterStatuses, type RosterFilter, type RosterKind, type RosterStatus,
} from './offseason2027'
import { foldName } from '../lib/fuzzyName'
import type { FinderClubAlias } from '../league/finderParse'
import type { PlayAnswer } from '../mlb/state/SearchBridgeContext'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

/** What was asked. `unplaced` is whichever not-yet-placed status the moves give these players
 *  ("Draft eligible" now, "Not yet re-signed" while a window is open), since the words for it
 *  ("unsigned", "draft pool") do not change with the phase and the status does. */
export interface RosterAsk {
  filter: RosterFilter | { kind: 'unplaced' }
  side: 'hitting' | 'pitching' | 'overall' | null
  /** The Players table's column to sort on, and its direction, when a stat was named. */
  sort: string | null
  dir: 'asc' | 'desc' | null
  /** The ranking's title ("Most home runs") when a stat was named. */
  ranked: string | null
}

const STATUS_WORDS: [RegExp, RosterAsk['filter']][] = [
  // Before "drafted", which "draft eligible" is not.
  [/draft[\s-]?(?:eligible|pool)|unsigned|not (?:yet )?(?:re[\s-]?)?signed|available/, { kind: 'unplaced' }],
  [/re[\s-]?signed|resigned|returning|coming back/, { kind: 'status', status: 're-signed' }],
  [/traded/, { kind: 'status', status: 'traded' }],
  [/drafted/, { kind: 'status', status: 'drafted' }],
  [/released/, { kind: 'status', status: 'released' }],
]

// The season the rosters are FOR, said any way: "2027", "next season", "next year".
const NEXT = new RegExp(`(?<![a-z0-9])(?:${ROSTER_SEASON}|next (?:season|year))(?![a-z0-9])`)
const SIDE_WORDS: [RegExp, NonNullable<RosterAsk['side']>][] = [
  [/(?<![a-z])(?:hitters?|batters?|hitting|batting|bats)(?![a-z])/, 'hitting'],
  [/(?<![a-z])(?:pitchers?|pitching|arms)(?![a-z])/, 'pitching'],
]
// What may be left once the status, the club, the side and the stat are out: words a list is asked
// with. Anything else is a different question ("re-signed whitmore" is a player's), so no row.
const FILLER = /(?<![a-z0-9])(?:the|a|an|who|whos|who's|is|are|was|were|for|of|in|on|by|with|and|all|list|players?|stats?|roster|rosters|lineup|best|top|leaders?|leading|s|their|club|team|20\d\d)(?![a-z0-9])/g

/** The 2027 roster question in `text`, or null. Needs a status word, or a club with "2027" or "next
 *  season" beside it ("Boston roster" alone is the club's page), or "2027 rosters" for every club. */
export function parseRosterAsk(text: string, clubs: readonly FinderClubAlias[] = WPBL_FINDER_CLUBS): RosterAsk | null {
  let rest = ` ${foldName(text).replace(/[?!.,']+/g, ' ').replace(/\s+/g, ' ')} `
  let filter: RosterAsk['filter'] | null = null
  for (const [re, f] of STATUS_WORDS) {
    const m = rest.match(new RegExp(`(?<![a-z])(?:${re.source})(?![a-z])`))
    if (m) { filter = f; rest = rest.replace(m[0], ' '); break }
  }
  const next = NEXT.test(rest)
  rest = rest.replace(NEXT, ' ')
  if (!filter) {
    if (!next) return null
    const names = clubs.flatMap(c => c.names.map(n => ({ id: c.id, n: foldName(n) }))).sort((a, b) => b.n.length - a.n.length)
    for (const { id, n } of names) {
      const re = new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z0-9])`)
      if (re.test(rest)) { filter = { kind: 'club', teamId: id }; rest = rest.replace(re, ' '); break }
    }
    if (!filter) {
      if (!/(?<![a-z])rosters?(?![a-z])/.test(rest)) return null
      filter = { kind: 'any' }
    }
  }
  let side: RosterAsk['side'] = null
  for (const [re, s] of SIDE_WORDS) if (re.test(rest)) { side = s; rest = rest.replace(re, ' '); break }
  const leader = parseLeaderText(rest).find(p => !p.career && !p.post && (!side || p.side === side)) ?? null
  const sort = leader ? boardColumn('wpbl', leader.side, leader.field) : null
  if (leader && !sort) return null
  if (!leader && rest.replace(FILLER, ' ').trim()) return null
  return {
    filter, side: leader ? leader.side : side, sort, dir: leader?.dir ?? null,
    ranked: leader ? leaderTitle(leader) : null,
  }
}

/** The filter the ask means, given the statuses: `unplaced` becomes whichever unplaced kind the
 *  players have (the most common one, should a window leave clubs in different places). */
export function resolveRosterAsk(ask: RosterAsk, statuses: ReadonlyMap<string, RosterStatus>): RosterFilter | null {
  if (ask.filter.kind !== 'unplaced') return ask.filter
  const counts = new Map<RosterKind, number>()
  for (const s of statuses.values()) {
    if (s.kind === 'unsigned' || s.kind === 'not-announced' || s.kind === 'draft-eligible') counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]
  return top ? { kind: 'status', status: top[0] } : null
}

const SIDE_LABEL = { hitting: 'Hitting stats', pitching: 'Pitching stats', overall: 'Overall' } as const

/** The rows for a 2027 roster question, or none: not one, or the board does not offer the filter. */
export async function wpblRosterAnswers(text: string, ctx: { games: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[] }): Promise<PlayAnswer[]> {
  const ask = parseRosterAsk(text)
  if (!ask) return []
  const year = ROSTER_SEASON - 1
  const now = Date.now()
  if (!rosterFilterOffered(year, currentSeason(ctx.games), now)) return []
  const [moves, lines] = await Promise.all([fetchWpblRosterMoves(), fetchWpblAllLines()])
  const statuses = rosterStatuses(moves, now)
  const filter = resolveRosterAsk(ask, statuses)
  if (!filter) return []
  const club = filter.kind === 'club' ? ctx.teams.find(t => t.id === filter.teamId) : undefined
  const word = filter.kind === 'any' ? 'Any club' : filter.kind === 'status' ? ROSTER_KIND_LABELS[filter.status]
    : CLUB_CITIES[filter.teamId] ?? club?.name ?? filter.teamId
  const sides = ask.side ? [ask.side] : (['hitting', 'pitching'] as const)
  return sides.flatMap(side => {
    // Everyone with a line on that side, as the board lists them once Everyone is on: a pool is
    // read whole, not only the regulars over the qualifying bar.
    const cutLines = side === 'pitching' ? inSeason(lines.pitching, ctx.games, year) : inSeason(lines.batting, ctx.games, year)
    const ids = new Set(cutLines.map(l => l.player_id))
    const n = [...ids].filter(id => matchesRosterFilter(filter, statuses.get(id))).length
    if (!n) return []
    const params = new URLSearchParams({ board: 'players', side, season: String(year), who: 'all', roster: rosterFilterParam(filter) })
    if (ask.sort) params.set('sort', ask.sort)
    if (ask.dir) params.set('dir', ask.dir)
    return [{
      key: `roster-${params}`,
      title: ask.ranked ? `${ask.ranked} · ${ROSTER_SEASON}: ${word}` : `${ROSTER_SEASON}: ${word}`,
      detail: `${SIDE_LABEL[side]} · ${year} · ${n} ${n === 1 ? 'player' : 'players'}`,
      href: `/wpbl/stats?${params}`,
      open: () => {},
    }]
  })
}
