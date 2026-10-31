import { cachedJson, FRESH_LONG_MS } from './lib/readCache'
import { parseIP } from './lib/utils'

// ─── A postseason's leaders ───────────────────────────────────────────────────
//
// `/stats/leaders?gameType=P` ignores the game type and answers with regular-season totals (45 HR in
// a month, Oct 2026), so these are `/stats?stats=season&gameType=P`, every player who appeared, ranked
// here. Checked against a club's Division, League and World Series lines, which it sums to. Two reads
// for a whole October, where summing box scores would be some forty of them.

/** A rate needs a floor, or a pinch hitter's one at bat leads. About four games of a regular. */
export const AVG_MIN_PA = 15
/** About two starts. */
export const ERA_MIN_IP = 10

export interface PostseasonLeader { id: number; name: string; teamId: number; value: string }
export interface PostseasonBoard { key: string; label: string; info?: string; rows: PostseasonLeader[] }

const TOP = 5

interface Split { id: number; name: string; teamId: number; stat: any }

const splitsOf = (raw: any): Split[] => (raw?.stats?.[0]?.splits ?? [])
  .filter((s: any) => s?.player?.id && s.player.fullName)
  .map((s: any) => ({ id: Number(s.player.id), name: String(s.player.fullName), teamId: Number(s.team?.id ?? 0), stat: s.stat ?? {} }))

function board(key: string, label: string, pool: Split[], rank: (s: Split) => number, show: (s: Split) => string, info?: string): PostseasonBoard {
  const rows = pool
    .map(s => ({ s, n: rank(s) }))
    .filter(x => Number.isFinite(x.n))
    .sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name))
    .slice(0, TOP)
    .map(({ s }) => ({ id: s.id, name: s.name, teamId: s.teamId, value: show(s) }))
  return { key, label, info, rows }
}

/** A counting stat's rank, leaving out players with none: a saves board of zeros is no board. */
const count = (field: string) => (s: Split) => Number(s.stat[field] ?? 0) || NaN
const shown = (field: string) => (s: Split) => String(s.stat[field] ?? '')

/** Pure, for the test: the two reads into the six boards. */
export function postseasonBoards(hitting: any, pitching: any): PostseasonBoard[] {
  const hitters = splitsOf(hitting)
  const pitchers = splitsOf(pitching)
  return [
    board('hr', 'HR', hitters, count('homeRuns'), shown('homeRuns')),
    board('rbi', 'RBI', hitters, count('rbi'), shown('rbi')),
    board('avg', 'AVG', hitters,
      s => Number(s.stat.plateAppearances ?? 0) >= AVG_MIN_PA ? Number(s.stat.avg) : NaN,
      shown('avg'), `Minimum ${AVG_MIN_PA} plate appearances`),
    board('k', 'K', pitchers, count('strikeOuts'), shown('strikeOuts')),
    board('era', 'ERA', pitchers,
      // Negated because the board ranks high to low. Zero is a real ERA here, so not `count`.
      s => parseIP(s.stat.inningsPitched) >= ERA_MIN_IP ? -Number(s.stat.era) : NaN,
      shown('era'), `Minimum ${ERA_MIN_IP} innings`),
    board('sv', 'SV', pitchers, count('saves'), shown('saves')),
  ]
}

const FIELDS = 'stats,splits,player,id,fullName,team,stat,'

function read(season: number, group: string, fields: string): Promise<any> {
  return cachedJson<any>(
    `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&gameType=P&season=${season}&sportId=1&playerPool=ALL&limit=500&fields=${FIELDS}${fields}`,
    FRESH_LONG_MS,
  )
}

/** Null when either read fails, since half the boards under a heading reads as the whole. */
export function fetchPostseasonBoards(season: number): Promise<PostseasonBoard[] | null> {
  return Promise.all([
    read(season, 'hitting', 'homeRuns,rbi,avg,plateAppearances'),
    read(season, 'pitching', 'strikeOuts,era,inningsPitched,saves'),
  ]).then(([h, p]) => postseasonBoards(h, p)).catch(() => null)
}
