import { supabase } from '../../lib/supabase'
import { writeSeed } from '../seed'
import { PLAYER_SEASON_SELECT, playerSeasonsCurrent, type WpblPlayerSeasonRow } from '../derive/playerSeasons'
import type {
  WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblLineupHistoryRow,
  WpblPitchingUsageRow,
} from '../types'
import {
  safe, once, overlayKeyed, isList, seeded, isFresh, isFreshSlow, keyedCache, emptyList,
  fetchAllPaged,
} from './core'
import { allLinesCache, allFieldingCache, seedLines } from './lines'
import { allTrackingCache, trackedGameIdsCache, seedTrackedIds } from './tracking'

// Players: the league pool, each club's roster, lineups and usage, one player's lines and every player's season.

function readWpblRoster(teamId: string): Promise<WpblPlayer[]> {
  return safe('fetchWpblRoster', () =>
    supabase.from('wpbl_players').select('*').eq('team_id', teamId).order('name', { ascending: true }),
    [] as WpblPlayer[])
}

let allPlayersCache:  { data: WpblPlayer[]; at: number } | null = null

const seedPlayers = () => seeded<WpblPlayer[]>('players', allPlayersCache, isList, data => { allPlayersCache = { data, at: 0 } })

export function getCachedWpblAllPlayers(): WpblPlayer[] | null { seedPlayers(); return allPlayersCache?.data ?? null }

const rosterCache  = keyedCache('roster', readWpblRoster, emptyList)
const lineupsCache = keyedCache('lineups', readWpblLineupHistory, emptyList)
const usageCache   = keyedCache('usage', readWpblPitchingUsage, emptyList)

// A PLAYER PAGE IS THE THING PEOPLE OPEN TWICE. It is the section's retention event (a reader
// who opens one comes back at 76.5%, against 7.8% for one who opens neither it nor Game
// Center; see ROADMAP-WPBL.md), and it is reached from a leaderboard, which is a list of
// twenty of them: open, read, close, open the next, come back to the first.
const playerLinesCache = keyedCache('playerLines', readWpblPlayerLines,
  v => v.batting.length === 0 && v.pitching.length === 0 && v.fielding.length === 0)

export const fetchWpblRoster = rosterCache.fetch
export const fetchWpblLineupHistory = lineupsCache.fetch
export const fetchWpblPitchingUsage = usageCache.fetch
export const fetchWpblPlayerLines = playerLinesCache.fetch

/** The last good read for one club, or null. For painting on the first render; the caller
 *  should still call the matching `fetch` so a stale entry revalidates behind the paint. */
export const getCachedWpblRoster = rosterCache.get
export const getCachedWpblLineupHistory = lineupsCache.get
export const getCachedWpblPitchingUsage = usageCache.get

/**
 * A player's lines for the first paint of their card: their own cached read, or else their slice
 * of the league-wide read that Home and Stats have almost always made already.
 *
 * WHY THE SECOND SOURCE. A player opened for the first time had nothing in the per-player cache,
 * so the card rose with a spinner under the band, and when the read landed the band moved from
 * pinned into the scrolling pane, below a role switch that had not existed a moment before: the
 * portrait remounted and the whole band dropped, mid-slide. The bulk read holds exactly these rows
 * (the same table, the same `player_id`, every column but `created_at`), so a card opened from a
 * leaderboard can draw its finished shape at once and let its own read revalidate behind it.
 *
 * Batting and pitching only decide whether to seed: the bulk fielding read is made by the awards
 * ballot alone, so it is used when present and otherwise empty until the player's own read lands,
 * which only adds the fielding line at the foot of the card.
 */
export function getSeedWpblPlayerLines(playerId: string): { batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] } | null {
  const own = playerLinesCache.get(playerId)
  if (own) return own
  const bulk = allLinesCache?.data
  if (!bulk) return null
  const batting = bulk.batting.filter(l => l.player_id === playerId)
  const pitching = bulk.pitching.filter(l => l.player_id === playerId)
  if (batting.length === 0 && pitching.length === 0) return null
  const fielding = (allFieldingCache?.data ?? []).filter(l => l.player_id === playerId)
  return { batting, pitching, fielding }
}

/** Age (ms) of the cached players+lines pair; Infinity until both are seeded. */
export function wpblStatsCacheAgeMs(): number {
  seedPlayers(); seedLines()
  if (!allPlayersCache || !allLinesCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at)
}

/** Age (ms) of the players+lines+tracking trio the Tracking tab reads; Infinity until all seeded. */
export function wpblTrackingCacheAgeMs(): number {
  seedPlayers(); seedLines()
  if (!allPlayersCache || !allLinesCache || !allTrackingCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at, allTrackingCache.at)
}

/** Age (ms) of the set Home's own effect reads (players + lines + the tracked-game-id list its
 *  banner needs); Infinity until all three are seeded, which is what makes a warm re-entry skip
 *  the refetch. It deliberately does NOT wait on the run-value play log: that is fetched last and
 *  on its own, so gating warmth on it would keep Home "cold" for the second it takes to land and
 *  refetch everything else needlessly. (It used to wait on the firsts play log, which Home has
 *  not read since the Hall of Firsts came off, so this never went warm at all.) */
export function wpblHomeCacheAgeMs(): number {
  seedPlayers(); seedLines(); seedTrackedIds()
  if (!allPlayersCache || !allLinesCache || !trackedGameIdsCache) return Infinity
  return Date.now() - Math.min(allPlayersCache.at, allLinesCache.at, trackedGameIdsCache.at)
}

// Every player in the league (all four rosters): the name pool for search, for slugs, and for
// any surface that names a player off a box-score line.
export function fetchWpblAllPlayers(): Promise<WpblPlayer[]> {
  if (isFreshSlow(allPlayersCache)) return Promise.resolve(allPlayersCache!.data)
  return once('allPlayers', async () => {
    const data = await safe('fetchWpblAllPlayers', () =>
      supabase.from('wpbl_players').select('*'),
      [] as WpblPlayer[])
    // Don't clobber a good cache with an empty error/timeout fallback; a genuinely
    // empty first load (pre-migration) still seeds so callers stop showing a spinner.
    if (data.length > 0) writeSeed('players', data)
    if (data.length > 0 || allPlayersCache == null) allPlayersCache = { data, at: Date.now() }
    return data
  })
}

// Every player's season, totaled by scripts/compute-wpbl-player-seasons.ts (derive/playerSeasons.ts):
// the Stats tab's boards and the search box's answers read these in place of every box-score line
// and the play log. ONE SEASON PER READ, keyed on the year, like the play log: the table holds every
// year and a board shows one. The rows are trusted only when they describe the inputs as they
// stand now, which the database answers with one small read of `wpbl_player_season_stamp` beside
// them (the migration explains the stamp). `current` false, or a failed read, means "read the
// lines", exactly as before the table existed.
export interface WpblPlayerSeasonsRead { rows: WpblPlayerSeasonRow[]; current: boolean }
const playerSeasonsCache = new Map<number, { data: WpblPlayerSeasonsRead; at: number }>()
export function getCachedWpblPlayerSeasons(season: number): WpblPlayerSeasonsRead | null {
  return playerSeasonsCache.get(season)?.data ?? null
}
export function fetchWpblPlayerSeasons(season: number): Promise<WpblPlayerSeasonsRead> {
  const own = playerSeasonsCache.get(season)
  if (isFresh(own ?? null)) return Promise.resolve(own!.data)
  return once(`playerSeasons:${season}`, async () => {
    const [rows, stamps] = await Promise.all([
      fetchAllPaged<WpblPlayerSeasonRow>('fetchWpblPlayerSeasons', (from, to) =>
        supabase.from('wpbl_player_seasons').select(PLAYER_SEASON_SELECT).eq('season', season)
          .order('scope', { ascending: true }).order('player_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: WpblPlayerSeasonRow[] | null; error: unknown }>),
      safe<{ stamp: string }[]>('fetchWpblPlayerSeasonStamp', () =>
        supabase.from('wpbl_player_season_stamp').select('stamp').limit(1) as unknown as
          PromiseLike<{ data: { stamp: string }[] | null; error: unknown }>,
        []),
    ])
    const data = { rows, current: playerSeasonsCurrent(rows, stamps[0]?.stamp ?? null) }
    playerSeasonsCache.set(season, { data, at: Date.now() })
    return data
  })
}

// Lineup history for one team: which slot and position each player filled, game by game.
//
// Reads the wpbl_lineup_history view rather than wpbl_batting_lines, because "did they start
// or come in later?" can only be answered by cross-referencing play sequence, and that join
// belongs in the database next to the rule it implements (see the view's migration).
//
// Deliberately narrow: the grid needs slot, position and started (not the stat line), so
// the columns are listed rather than select('*'). One team's season is a few hundred rows.
function readWpblLineupHistory(teamId: string): Promise<WpblLineupHistoryRow[]> {
  return safe('fetchWpblLineupHistory', () =>
    supabase.from('wpbl_lineup_history')
      .select('game_id,team_id,player_id,game_date,game_status,opponent_team_id,opp_starter_name,opp_starter_throws,lineup_spot,position,started,slot_shared')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false })
      .order('lineup_spot', { ascending: true }),
    [] as WpblLineupHistoryRow[])
}

// Pitcher usage for one team: every appearance, with rest days already computed.
//
// days_rest comes from the view rather than being derived here: the gap that matters is
// between a pitcher's own consecutive outings, which is a window function over their whole
// appearance history, not something the client can see from one team's recent games.
function readWpblPitchingUsage(teamId: string): Promise<WpblPitchingUsageRow[]> {
  return safe('fetchWpblPitchingUsage', () =>
    supabase.from('wpbl_pitching_usage')
      .select('game_id,team_id,player_id,game_date,game_status,opponent_team_id,started,outs,pitches,bf,er,so,bb,decision,days_rest')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false }),
    [] as WpblPitchingUsageRow[])
}

// All of a player's box-score lines across every game (for the player page).
async function readWpblPlayerLines(playerId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblPlayerBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('player_id', playerId),
      [] as WpblBattingLine[]),
    safe('fetchWpblPlayerPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('player_id', playerId),
      [] as WpblPitchingLine[]),
    safe('fetchWpblPlayerFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('player_id', playerId),
      [] as WpblFieldingLine[]),
  ])
  return { batting: overlayKeyed(batting), pitching: overlayKeyed(pitching), fielding: overlayKeyed(fielding) }
}
