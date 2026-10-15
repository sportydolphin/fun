// The search box's two answers on MLB: a stat typed beside a name ("Ohtani hr" -> "55 HR · 2026",
// "Skenes fip") and who leads a ranking row ("Most home runs", "Highest wRC+" -> who, and with what).
//
// THE LEADER IS THE STATS TABLE'S FIRST ROW, from the table's own reads and rules: the season pool
// (fetchLeaderboardData) or the all-time one, the advanced figures folded in by the table's own
// `withAdvanced` (with StatsAPI's sabermetrics for wOBA and wRC+, and the park factors for OPS+ and
// ERA+, each read only when the column asks for it), the qualifying bar on rate stats only, as the
// table's lit chip applies it, and `sortBoard`. Every read is cached for the session, so a reader who
// then opens the board pays for nothing twice.
//
// A PLAYER'S ANSWER is one small call for a box-score stat. An advanced one is measured against the
// league, so it is read off the same season board the table draws, which is the only way the two can
// agree; a career has no such board, and answers only the figures that need no league (K%, ISO).
//
// There is no MLB WAR: the site has none to rank, so "most war" offers no row here (finderSearch.ts).

import { CURRENT_SEASON, HITTING_STAT_DEFS, PITCHING_STAT_DEFS } from './constants'
import { fetchAllTimeLeaderboardData, fetchLeaderboardData } from './api'
import { fetchParkFactors, fetchSeasonSabermetrics } from './apiSeasonStats'
import { HITTING_ADVANCED_DEFS, PARK_ADJUSTED_KEYS, PITCHING_ADVANCED_DEFS, SABERMETRIC_KEYS, advancedFor, withAdvanced } from './lib/advanced'
import { filterQualified } from './lib/utils'
import { rankValue, sortBoard } from './lib/statsBoard'
import type { LeaderboardEntry, StatDef } from './types'
import type { RankSide } from '../league/finderParse'
import type { LeaderAsk, LeaderPeek, PlayerBridgeItem, PlayerStatAsk } from './state/SearchBridgeContext'

type Group = 'hitting' | 'pitching'
const ADVANCED: Record<Group, StatDef[]> = { hitting: HITTING_ADVANCED_DEFS, pitching: PITCHING_ADVANCED_DEFS }

function statDef(side: RankSide, sort: string): { group: Group; def: StatDef; advanced: boolean } | null {
  if (side === 'overall') return null
  const standard = (side === 'pitching' ? PITCHING_STAT_DEFS : HITTING_STAT_DEFS).find(d => d.key === sort)
  if (standard) return { group: side, def: standard, advanced: false }
  const advanced = ADVANCED[side].find(d => d.key === sort)
  return advanced ? { group: side, def: advanced, advanced: true } : null
}

/** A cell as the table prints it, or null for a dash. W-L ranks on the wins, so it prints them. */
function printed(def: StatDef, stat: unknown): string | null {
  const s = def.leaderValue ? String(rankValue(def, stat)) : def.format(def.getValue(stat))
  return !s || s === '—' || s === 'NaN' || s === 'undefined' ? null : s
}

/** A season's board with its advanced figures, as the table builds it, for the column asked about. */
async function seasonBoard(group: Group, season: number, key: string): Promise<LeaderboardEntry[]> {
  const [all, saber, parks] = await Promise.all([
    fetchLeaderboardData(group, season),
    group === 'hitting' && SABERMETRIC_KEYS.has(key) ? fetchSeasonSabermetrics(season) : Promise.resolve(null),
    PARK_ADJUSTED_KEYS.has(key) ? fetchParkFactors(season) : Promise.resolve(null),
  ])
  return withAdvanced(all, group, saber, parks)
}

// One player's line over a span. Kept as the promise, so the answer for a row the reader is still
// typing toward is asked once; a failure is dropped so the next ask tries again.
const lineCache = new Map<string, Promise<unknown | null>>()

function fetchPlayerLine(id: number, group: Group, span: number | 'career'): Promise<unknown | null> {
  const key = `${id}-${group}-${span}`
  let p = lineCache.get(key)
  if (!p) {
    const which = span === 'career' ? 'stats=career' : `stats=season&season=${span}`
    p = fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?${which}&group=${group}&sportId=1`)
      .then(r => { if (!r.ok) throw new Error(`people/stats ${r.status}`); return r.json() })
      .then((d: { stats?: { splits?: { team?: unknown; stat?: unknown }[] }[] }) => {
        const splits = d.stats?.[0]?.splits ?? []
        // A player traded in the season has a split per club and one for the whole season, which
        // is the one without a club, and the one the table shows.
        return (splits.length > 1 ? splits.find(s => !s.team) : splits[0])?.stat ?? null
      })
    lineCache.set(key, p)
    p.catch(() => { if (lineCache.get(key) === p) lineCache.delete(key) })
  }
  return p
}

/**
 * "55 HR · 2026" for one player, or null when there is no such number. A word that names a stat on
 * both sides ("strikeouts") is read on the side the player plays, and on the word's lean for a
 * two-way player. A retired player with no year typed answers for the career, since this season
 * has no line of theirs.
 */
export async function mlbPlayerAnswer(player: PlayerBridgeItem, ask: PlayerStatAsk): Promise<string | null> {
  const sides = (['hitting', 'pitching'] as const).filter(s => ask.columns[s])
  const pos = player.primaryPosition
  const twoWay = pos?.abbreviation === 'TWP' || pos?.code === 'Y'
  const pitcher = pos?.abbreviation === 'P' || pos?.code === '1'
  const side = sides.length === 1 ? sides[0] : twoWay ? ask.lean ?? 'hitting' : pitcher ? 'pitching' : 'hitting'
  const found = statDef(side, ask.columns[side] ?? '')
  if (!found) return null
  const { group, def, advanced } = found
  const span = ask.season ?? (player.active === false ? 'career' : CURRENT_SEASON)
  let stat: unknown
  if (!advanced) stat = await fetchPlayerLine(player.id, group, span)
  else if (span === 'career') {
    const line = await fetchPlayerLine(player.id, group, span)
    stat = line ? { ...(line as object), ...advancedFor(line, group, {}) } : null
  } else stat = (await seasonBoard(group, span, def.key)).find(e => e.playerId === player.id)?.stat
  const value = stat ? printed(def, stat) : null
  return value ? `${value} ${def.label} · ${span}` : null
}

/** Who tops the stats table the row links to, ranked as that table ranks. */
export async function mlbLeaderPeek(ask: LeaderAsk): Promise<LeaderPeek | null> {
  const found = statDef(ask.side, ask.sort)
  if (!found) return null
  const { group, def } = found
  const pool = ask.career
    // Career rate boards are the career Qualified pool, as the table restricts them.
    ? withAdvanced(await fetchAllTimeLeaderboardData(group), group).filter(e => !def.isRate || (e as { qualified?: boolean }).qualified)
    : await (async () => {
        const all = await seasonBoard(group, ask.season ?? CURRENT_SEASON, def.key)
        return def.isRate ? filterQualified(all, group) : all
      })()
  const asc = ask.dir ? ask.dir === 'asc' : !!def.lowerIsBetter
  const ranked = sortBoard(pool, def, asc)
  const top = ranked[0]
  const value = top ? printed(def, top.stat) : null
  if (!top || !value) return null
  const others = ranked.slice(1).filter(e => printed(def, e.stat) === value).length
  return { name: top.playerName, others, value, season: ask.career ? null : ask.season ?? CURRENT_SEASON }
}
