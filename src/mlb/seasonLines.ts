import { supabase } from '../lib/supabase'
import type { SeasonScope } from '../league/season'
import type { BattingGameLine, LeagueGame, LeaguePlayer, PitchingGameLine } from '../league/types'
import type { GameScope } from './lib/gameScope'
import { CURRENT_SEASON } from './constants'

// Every MLB box-score line of one season, for the boards that run WPBL's engines (src/league/):
// Bests and Find. Mirrored nightly by scripts/sync-mlb-lines.mjs and served packed, one row per
// season, by the `mlb_season_lines` view (see its migration for why a view). This module is the
// MLB adapter's read half: it turns that row into the neutral shapes, which is ids into strings
// and a line id built from the game and the player, and nothing else.

/** A game as the engines read it, keeping StatsAPI's numeric ids alongside for links and logos. */
export interface MlbLineGame extends LeagueGame {
  gamePk: number
  homeId: number
  awayId: number
}

/** A player as a board row needs one, with the numeric id a player link takes. */
export interface MlbLinePlayer extends LeaguePlayer {
  playerId: number
}

export interface MlbSeasonLines {
  season: number
  games: MlbLineGame[]
  batting: BattingGameLine[]
  pitching: PitchingGameLine[]
  players: MlbLinePlayer[]
  /** When the newest game in it was written, for the board's foot. */
  syncedAt: string | null
}

interface Packed { cols: string[]; rows: unknown[][] }

/** A packed set as objects, by the column names that travel with it, so a column added to the
 *  view cannot shift every number along by one. */
export function unpack(p: Packed | null | undefined): Record<string, unknown>[] {
  if (!p?.cols || !Array.isArray(p.rows)) return []
  return p.rows.map(r => Object.fromEntries(p.cols.map((c, i) => [c, r[i]])))
}

const str = (v: unknown): string => String(v)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v))

/** The view's row, in the neutral shapes. Pure, so a test can hand it a row. */
export function adaptSeasonLines(row: {
  season: number; games: Packed; batting: Packed; pitching: Packed; players: Packed; synced_at?: string | null
}): MlbSeasonLines {
  const games = unpack(row.games).map((g): MlbLineGame => ({
    id: str(g.game_pk),
    gamePk: num(g.game_pk),
    game_date: String(g.game_date),
    game_type: String(g.game_type),
    counts_in_standings: g.counts_in_standings as boolean,
    status: String(g.status),
    home_team_id: str(g.home_team_id),
    away_team_id: str(g.away_team_id),
    homeId: num(g.home_team_id),
    awayId: num(g.away_team_id),
    home_score: numOrNull(g.home_score),
    away_score: numOrNull(g.away_score),
  }))
  const line = (l: Record<string, unknown>) => ({
    id: `${l.game_pk}-${l.player_id}`,
    game_id: str(l.game_pk),
    player_id: str(l.player_id),
    team_id: l.team_id == null ? null : str(l.team_id),
  })
  const batting = unpack(row.batting).map((l): BattingGameLine => ({
    ...line(l),
    ab: num(l.ab), r: num(l.r), h: num(l.h), doubles: num(l.doubles), triples: num(l.triples),
    hr: num(l.hr), rbi: num(l.rbi), bb: num(l.bb), so: num(l.so), hbp: num(l.hbp), sb: num(l.sb),
    cs: num(l.cs), sf: num(l.sf), sh: num(l.sh), gdp: num(l.gdp), tb: num(l.tb),
  }))
  const pitching = unpack(row.pitching).map((l): PitchingGameLine => ({
    ...line(l),
    outs: num(l.outs), bf: numOrNull(l.bf), h: num(l.h), r: num(l.r), er: num(l.er), bb: num(l.bb),
    so: num(l.so), hr: num(l.hr), pitches: numOrNull(l.pitches), strikes: numOrNull(l.strikes),
    hbp: num(l.hbp), wp: num(l.wp), bk: num(l.bk),
  }))
  const players = unpack(row.players).map((p): MlbLinePlayer => ({
    id: str(p.player_id),
    playerId: num(p.player_id),
    name: String(p.name),
    team_id: p.team_id == null ? null : str(p.team_id),
  }))
  return { season: row.season, games, batting, pitching, players, syncedAt: row.synced_at ?? null }
}

/** The first season the mirror holds: the job began with 2026's, read back in full. An earlier one
 *  can be added with `node scripts/sync-mlb-lines.mjs --season <year> --all`, and lowering this. */
export const MLB_LINES_FIRST_SEASON = 2026
/** Every season a board may ask the mirror for, oldest first. */
export const MLB_LINES_SEASONS: readonly number[] = Array.from(
  { length: Math.max(1, CURRENT_SEASON - MLB_LINES_FIRST_SEASON + 1) }, (_, i) => MLB_LINES_FIRST_SEASON + i)

/** The section's Regular season / Playoffs / Both, in the engines' words. */
export const seasonScopeOf = (s: GameScope): SeasonScope => (s === 'post' ? 'postseason' : s === 'all' ? 'all' : 'regular')

// Cached per season for the life of the page, as WPBL's whole-league reads are: Bests and Find
// read the same half megabyte, and a reader moving between them should not pay for it twice.
const cache = new Map<number, Promise<MlbSeasonLines | null>>()

/**
 * One season's lines, or null when the mirror holds nothing for it (a season before the mirror
 * began, or the first days of one). A failed read is dropped from the cache so the next visit
 * tries again rather than remembering the failure.
 */
export function fetchMlbSeasonLines(season: number): Promise<MlbSeasonLines | null> {
  let p = cache.get(season)
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.from('mlb_season_lines').select('*').eq('season', season).maybeSingle()
      if (error) throw error
      return data ? adaptSeasonLines(data) : null
    })()
    p.catch(() => cache.delete(season))
    cache.set(season, p)
  }
  return p
}
