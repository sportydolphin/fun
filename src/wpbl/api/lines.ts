import { supabase } from '../../lib/supabase'
import { writeSeed } from '../seed'
import type { WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'
import { safe, once, overlayGameId, asGame, seeded, isFresh, fetchAllPaged } from './core'

// Box-score lines: the league-wide bulk reads, the Scores tab's narrow one, and one game's or a few games'.

export type WpblLinesResult = { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }

export let allLinesCache:    { data: WpblLinesResult; at: number } | null = null

const isLines = (d: unknown): d is WpblLinesResult =>
  !!d && Array.isArray((d as WpblLinesResult).batting) && Array.isArray((d as WpblLinesResult).pitching)

export const seedLines = () => seeded('lines', allLinesCache, isLines, data => { allLinesCache = { data, at: 0 } })

export function getCachedWpblAllLines(): WpblLinesResult | null { seedLines(); return allLinesCache?.data ?? null }

// Every box-score line in the league, for season aggregates. Paged, because a truncated read
// here doesn't fail, it just makes every league-wide rate quietly wrong: OPS+ and ERA+ derive
// their league baseline from these rows. Returns empty (no leaders) until games start being
// entered.
// The bulk line reads take every column EXCEPT `created_at`, which nothing in the section
// reads and which costs 17 KB across the season's batting lines (145 KB to 128 KB, 12%). The
// per-game reads still take `select('*')`: they are one game's worth of rows and the saving
// there is noise.
//
// Read these as "the table, minus created_at". If you add a column to either table, add it
// here too, or the season aggregates simply will not see it. tsc will not catch the omission,
// because a missing column arrives as `undefined` and both types allow that for new fields;
// __tests__/columnPartition.test.ts does, against the columns the migrations create.
export const PITCHING_LINE_COLUMN_NAMES = [
  'id', 'game_id', 'player_id', 'team_id', 'outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr',
  'pitches', 'decision', 'gs', 'hbp', 'ibb', 'wp', 'bk', 'strikes', 'doubles', 'triples',
] as const
const PITCHING_LINE_COLUMNS = PITCHING_LINE_COLUMN_NAMES.join(',')

export const BATTING_LINE_COLUMN_NAMES = [
  'id', 'game_id', 'player_id', 'team_id', 'batting_order', 'position',
  'ab', 'r', 'h', 'doubles', 'triples', 'hr', 'rbi', 'bb', 'so', 'hbp',
  'sb', 'cs', 'sf', 'sh', 'ibb', 'gdp', 'tb', 'lob', 'sub_out',
] as const
const BATTING_LINE_COLUMNS = BATTING_LINE_COLUMN_NAMES.join(',')

/**
 * Merge a fresh pair of line reads over the last-good pair, ARRAY BY ARRAY.
 *
 * `fetchWpblAllPlayers` gets last-good right because it holds one array: an empty result with a
 * good cache means the read failed, so the cache is left alone. Two arrays make that test
 * ambiguous. "Cache the pair unless BOTH failed" is wrong, because the two reads run in parallel
 * and fail independently: a run where only the batting read came up short would cache a league
 * with no batting at all, and every surface built on it (team stats, the spec chart's Power,
 * Contact, Eye and Speed) would look finished while being half fiction.
 *
 * `complete` is false when either side came back short, and the caller uses it to leave the
 * cache's timestamp alone so the next read RETRIES rather than serving the half it knows is
 * missing for the whole freshness window.
 *
 * A genuinely empty league (no cache yet, pre-migration) still seeds, or every caller spins
 * forever waiting for rows that do not exist.
 */
export function mergeBulkLines(fresh: WpblLinesResult, prev: WpblLinesResult | null): {
  data: WpblLinesResult
  complete: boolean
} {
  const complete = fresh.batting.length > 0 && fresh.pitching.length > 0
  if (!prev) return { data: fresh, complete }
  return {
    data: {
      batting: fresh.batting.length > 0 ? fresh.batting : prev.batting,
      pitching: fresh.pitching.length > 0 ? fresh.pitching : prev.pitching,
    },
    complete,
  }
}

/**
 * Every fielding line in the league, for the one thing that needs them: the fan ballot's
 * Defensive Wizard shortlist.
 *
 * League-wide fielding is read nowhere else: the section has no defensive leaderboard and
 * deliberately does not pretend to have one. A ballot line still has to offer names, and the
 * box score's fielding line is the closest it gets to a play made.
 *
 * PAGED, AND ORDERED, which on this table is the whole risk. PostgREST caps a bare select at
 * 1000 rows and says nothing about it, and one season already runs to hundreds of fielding
 * lines, so a second season walks straight into a silent truncation that would quietly drop
 * whole clubs off the shortlist. `fetchAllPaged` with a deterministic order is the section's one
 * answer to that; see CLAUDE.md.
 *
 * Cached on the same clock as the other bulk reads, and empty on error rather than throwing: a
 * ballot that cannot draw one shortlist should draw the others.
 */
const FIELDING_LINE_COLUMNS = [
  'id', 'game_id', 'player_id', 'team_id', 'po', 'a', 'e', 'pb', 'sba', 'ci', 'dp',
].join(',')

export let allFieldingCache: { data: WpblFieldingLine[]; at: number } | null = null

export function getCachedWpblAllFielding(): WpblFieldingLine[] | null {
  return allFieldingCache?.data ?? null
}

export function fetchWpblAllFielding(): Promise<WpblFieldingLine[]> {
  if (isFresh(allFieldingCache)) return Promise.resolve(allFieldingCache!.data)
  return once('allFielding', async () => {
    const rows = await fetchAllPaged<WpblFieldingLine>('fetchWpblAllFielding', (from, to) =>
      supabase.from('wpbl_fielding_lines').select(FIELDING_LINE_COLUMNS)
        .order('id', { ascending: true }).range(from, to) as unknown as
        PromiseLike<{ data: WpblFieldingLine[] | null; error: unknown }>)
    // A short read keeps the last good rows and leaves the clock alone, exactly as the batting
    // and pitching reads do: half a league's fielding is a shortlist missing two clubs, and it
    // looks precisely like a shortlist that is complete.
    if (rows.length === 0 && allFieldingCache) return allFieldingCache.data
    allFieldingCache = { data: rows, at: Date.now() }
    return rows
  })
}

export function fetchWpblAllLines(): Promise<WpblLinesResult> {
  if (isFresh(allLinesCache)) return Promise.resolve(allLinesCache!.data)
  return once('allLines', async () => {
    const [batting, pitching] = await Promise.all([
      fetchAllPaged<WpblBattingLine>('fetchWpblAllBatting', (from, to) =>
        supabase.from('wpbl_batting_lines').select(BATTING_LINE_COLUMNS)
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblBattingLine[] | null; error: unknown }>),
      fetchAllPaged<WpblPitchingLine>('fetchWpblAllPitching', (from, to) =>
        supabase.from('wpbl_pitching_lines').select(PITCHING_LINE_COLUMNS)
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblPitchingLine[] | null; error: unknown }>),
    ])
    seedLines()
    const prevAt = allLinesCache?.at
    const { data, complete } = mergeBulkLines({ batting, pitching }, allLinesCache?.data ?? null)
    if (!complete && prevAt != null) {
      console.warn(`[wpbl] fetchWpblAllLines came back short (batting ${batting.length}, pitching ${pitching.length}); serving last-good for the missing half and leaving the cache stale so the next read retries.`)
    }
    // A short read updates the DATA (it may still carry a fresher half) but not the clock.
    allLinesCache = { data, at: complete || prevAt == null ? Date.now() : prevAt }
    if (complete) writeSeed('lines', data)
    return data
  })
}

/** The box-score lines that can put a name on a Scores card, and only the columns that decide it. */
export interface WpblScoreCardLines {
  batting: Pick<WpblBattingLine, 'game_id' | 'player_id' | 'team_id' | 'ab' | 'h' | 'r' | 'rbi' | 'hr' | 'doubles' | 'triples' | 'sb' | 'bb' | 'tb'>[]
  pitching: Pick<WpblPitchingLine, 'game_id' | 'player_id' | 'team_id' | 'outs' | 'h' | 'er' | 'bb' | 'so' | 'decision' | 'gs'>[]
}
let scoreCardLinesCache: { data: WpblScoreCardLines; at: number } | null = null

/**
 * The Scores tab's own read of the box scores: the star of each game and its pitchers of record.
 *
 * NOT fetchWpblAllLines, the heaviest read in the section, for a footer of three names. The rows
 * are filtered by the same tests buildRecap applies before a line can rank at all (a batter who
 * hit, scored or drove one in; a pitcher with a decision or three innings), and the columns are the
 * ones its star and decision code reads, so a line this drops could never have reached a card.
 * If buildRecap's eligibility rules widen, these filters have to widen with them.
 */
export function fetchWpblScoreCardLines(): Promise<WpblScoreCardLines> {
  if (isFresh(scoreCardLinesCache)) return Promise.resolve(scoreCardLinesCache!.data)
  return once('scoreCardLines', async () => {
    const [batting, pitching] = await Promise.all([
      fetchAllPaged<WpblScoreCardLines['batting'][number]>('fetchWpblScoreCardBatting', (from, to) =>
        supabase.from('wpbl_batting_lines')
          .select('id,game_id,player_id,team_id,ab,h,r,rbi,hr,doubles,triples,sb,bb,tb')
          .or('h.gt.0,r.gt.0,rbi.gt.0')
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblScoreCardLines['batting'] | null; error: unknown }>),
      fetchAllPaged<WpblScoreCardLines['pitching'][number]>('fetchWpblScoreCardPitching', (from, to) =>
        supabase.from('wpbl_pitching_lines')
          .select('id,game_id,player_id,team_id,outs,h,er,bb,so,decision,gs')
          .or('decision.not.is.null,outs.gte.9')
          .order('id', { ascending: true }).range(from, to) as unknown as
          PromiseLike<{ data: WpblScoreCardLines['pitching'] | null; error: unknown }>),
    ])
    // Both halves or the last good pair: a card with a star and no pitchers reads as a game nobody
    // pitched in, and an empty read looks exactly like a quiet one.
    if ((batting.length === 0 || pitching.length === 0) && scoreCardLinesCache) return scoreCardLinesCache.data
    scoreCardLinesCache = { data: { batting, pitching }, at: Date.now() }
    return scoreCardLinesCache.data
  })
}

// Existing box-score lines for one game (for editing / display).
export async function fetchWpblGameLines(gameId: string): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; fielding: WpblFieldingLine[] }> {
  const id = overlayGameId(gameId)
  const [batting, pitching, fielding] = await Promise.all([
    safe('fetchWpblBatting', () =>
      supabase.from('wpbl_batting_lines').select('*').eq('game_id', id).order('batting_order', { ascending: true }),
      [] as WpblBattingLine[]),
    safe('fetchWpblPitching', () =>
      supabase.from('wpbl_pitching_lines').select('*').eq('game_id', id).order('created_at', { ascending: true }),
      [] as WpblPitchingLine[]),
    safe('fetchWpblFielding', () =>
      supabase.from('wpbl_fielding_lines').select('*').eq('game_id', id),
      [] as WpblFieldingLine[]),
  ])
  return { batting: asGame(batting, id, gameId), pitching: asGame(pitching, id, gameId), fielding: asGame(fielding, id, gameId) }
}

// Batting and pitching lines for a handful of games, in one read per table. For the offseason Home's
// Star of the final, which needs the five championship games and nothing else: that page skips
// `fetchWpblAllLines` on purpose (about 73KB gzipped for no card), and a box-score read per game
// would be fifteen requests where two do. Kept for the session, since a decided series does not
// change under it.
const linesForGamesCache = new Map<string, { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>()
export function fetchWpblLinesForGames(gameIds: string[]): Promise<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }> {
  const key = [...gameIds].sort().join(',')
  const hit = linesForGamesCache.get(key)
  if (hit) return Promise.resolve(hit)
  if (gameIds.length === 0) return Promise.resolve({ batting: [], pitching: [] })
  return once(`linesFor:${key}`, async () => {
    // The dev overlay can stand one game in for another; read the source ids and hand each row
    // back under the id it was asked for, as fetchWpblGameLines does for one.
    const asked = new Map(gameIds.map(g => [overlayGameId(g), g]))
    const ids = [...asked.keys()]
    const [batting, pitching] = await Promise.all([
      safe('fetchWpblLinesForGamesBatting', () =>
        supabase.from('wpbl_batting_lines').select(BATTING_LINE_COLUMNS).in('game_id', ids)
          .order('id', { ascending: true }) as unknown as PromiseLike<{ data: WpblBattingLine[] | null; error: unknown }>,
        [] as WpblBattingLine[]),
      safe('fetchWpblLinesForGamesPitching', () =>
        supabase.from('wpbl_pitching_lines').select(PITCHING_LINE_COLUMNS).in('game_id', ids)
          .order('id', { ascending: true }) as unknown as PromiseLike<{ data: WpblPitchingLine[] | null; error: unknown }>,
        [] as WpblPitchingLine[]),
    ])
    const back = <T extends { game_id: string }>(rows: T[]) => rows.map(r => ({ ...r, game_id: asked.get(r.game_id) ?? r.game_id }))
    const out = { batting: back(batting), pitching: back(pitching) }
    // An empty answer may be a timeout (safe() falls back to []), so only a real one is kept.
    if (out.batting.length > 0 || out.pitching.length > 0) linesForGamesCache.set(key, out)
    return out
  })
}
