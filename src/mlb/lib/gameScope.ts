// Which games a stat line counts: the regular season, the postseason, or both.
//
// StatsAPI serves the first two (`gameType=R`, `gameType=P`) and NOT the third: a combined
// `gameType=R,P` quietly answers with the regular season alone, so "All" is built here, one
// player at a time, from the two lines it is made of.

export type GameScope = 'regular' | 'post' | 'all'
export const GAME_SCOPES: readonly GameScope[] = ['regular', 'post', 'all']
export const isGameScope = (v: unknown): v is GameScope => typeof v === 'string' && (GAME_SCOPES as readonly string[]).includes(v)

/** The control's labels. "Playoffs" rather than "Postseason" so three fit across a phone. */
// WPBL's words for the same three slices (its StatsView chips), so the control reads the same in both
// sections. "Both" rather than "All", for WPBL's reason: beside a filter that has its own "All"
// (a club, the qualifying bar's Everyone), two Alls in a row are a coin toss.
export const GAME_SCOPE_LABEL: Record<GameScope, string> = { regular: 'Regular season', post: 'Playoffs', all: 'Both' }

/** The career postseason rate boards' bar, which is ours: StatsAPI has no qualified pool there.
 *  See fetchAllTimeLeaderboardData. */
export const CAREER_POST_MIN_PA = 100
export const CAREER_POST_MIN_IP = 40

// ─── Combining two lines ──────────────────────────────────────────────────────
//
// COUNTS ADD, RATES DO NOT. Every number on a StatsAPI line is a count except `age`, so the
// numbers are summed; every string is a rate or a ratio, which cannot be averaged or summed,
// so each one the app reads is recomputed from the summed counts. A string this does not know
// how to rebuild is DROPPED rather than carried over from one half: a regular-season BABIP
// printed under "All" is wrong in a way nobody would ever catch, and a dash is merely absent.

const NOT_A_COUNT = new Set(['age'])

const rate3 = (num: number, den: number): string | null => {
  if (!den) return null
  const v = (num / den).toFixed(3)
  return v.startsWith('0.') ? v.slice(1) : v
}
const rate2 = (v: number | null): string | null => v == null || !isFinite(v) ? null : v.toFixed(2)
const n = (s: any, k: string): number => Number(s?.[k] ?? 0) || 0

/** Outs from a line: StatsAPI's `outs` when present, else parsed from "6.2"-style innings. */
function outsOf(s: any): number {
  if (s?.outs != null) return Number(s.outs) || 0
  const [whole, part] = String(s?.inningsPitched ?? '0').split('.')
  return (Number(whole) || 0) * 3 + (Number(part) || 0)
}

export function combineStatLines(a: any, b: any): any {
  if (!a) return b
  if (!b) return a
  const out: Record<string, any> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k]
    if (NOT_A_COUNT.has(k)) out[k] = x ?? y
    else if (typeof x === 'number' || typeof y === 'number') out[k] = (Number(x) || 0) + (Number(y) || 0)
  }

  // Batting (also on a pitching line, as what the pitcher allowed).
  const ab = n(out, 'atBats'), h = n(out, 'hits'), bb = n(out, 'baseOnBalls')
  const hbp = n(out, 'hitByPitch'), sf = n(out, 'sacFlies')
  const tb = out.totalBases != null ? n(out, 'totalBases')
    : h + n(out, 'doubles') + 2 * n(out, 'triples') + 3 * n(out, 'homeRuns')
  out.avg = rate3(h, ab)
  out.obp = rate3(h + bb + hbp, ab + bb + hbp + sf)
  out.slg = rate3(tb, ab)
  // OBP plus SLG at full precision, rounded once: adding the two rounded strings is off by a
  // point about one time in three.
  out.ops = ab ? rate3((h + bb + hbp) / (ab + bb + hbp + sf) + tb / ab, 1) : null
  const sb = n(out, 'stolenBases'), cs = n(out, 'caughtStealing')
  out.stolenBasePercentage = rate3(sb, sb + cs)

  // Pitching, only when one half is a pitching line.
  if (a.inningsPitched != null || b.inningsPitched != null) {
    const outs = outsOf(a) + outsOf(b)
    out.outs = outs
    out.inningsPitched = `${Math.floor(outs / 3)}.${outs % 3}`
    const per9 = (count: number) => outs ? rate2(count * 27 / outs) : null
    out.era = per9(n(out, 'earnedRuns'))
    out.whip = outs ? rate2((bb + h) * 3 / outs) : null
    out.strikeoutsPer9Inn = per9(n(out, 'strikeOuts'))
    out.walksPer9Inn = per9(bb)
    out.hitsPer9Inn = per9(h)
    out.homeRunsPer9 = per9(n(out, 'homeRuns'))
    const w = n(out, 'wins'), l = n(out, 'losses')
    out.winPercentage = rate3(w, w + l)
  }
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k]
  return out
}

/** One entry per player across the two halves. The club is the postseason one when there is
 *  one, since that is where the player is now. */
export function combineEntries<T extends { playerId: number; teamId: number; teamAbbr: string; stat: any }>(
  regular: T[], post: T[],
): T[] {
  const byId = new Map<number, T>()
  for (const e of regular) byId.set(e.playerId, e)
  for (const e of post) {
    const r = byId.get(e.playerId)
    byId.set(e.playerId, r ? { ...r, teamId: e.teamId, teamAbbr: e.teamAbbr, stat: combineStatLines(r.stat, e.stat) } : e)
  }
  return [...byId.values()]
}
