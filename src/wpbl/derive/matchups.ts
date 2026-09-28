import { countsInStandings, scopedLines, type SeasonScope, type WpblSeasonGame } from '../season.ts'
import type { WpblGamePlay, WpblGame, WpblPlayer } from '../types'

// Matchup derivations: batter-vs-pitcher lines and team-vs-team head-to-head. Pure:
// arrays in, plain shapes out (no supabase / React), mirroring stats.ts and firsts.ts.
//
// The one judgement call, "what counts as a plate appearance", lives in classifyPa() so
// every consumer (and any future producer: RISP, two-strike, player-of-the-game) agrees on
// it instead of re-deriving it. It reads only a play's event_type + narrative, exactly the
// fields `WpblMatchupPlay` below names.

// A plate-appearance outcome distilled from one play. null = the play is NOT a plate
// appearance (a steal, wild pitch, pickoff, substitution: mid-PA or between-PA noise).
interface PaOutcome { ab: number; h: number; hr: number; xbh: number; bb: number; so: number }

const HIT_EVENTS    = new Set(['single', 'double', 'triple', 'home_run'])
const OUT_EVENTS    = new Set(['groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'strikeout', 'fielders_choice'])
const NON_AB_EVENTS = new Set(['walk', 'hit_by_pitch', 'sacrifice']) // a PA, but not an at-bat
// Most `unknown` rows are baserunning / substitution notes, but a few are genuine batter
// PAs ("reached first on an error"); match that phrasing so they count as an at-bat out.
const REACHED_ON_ERROR = /reached\b.*\b(error|fielder'?s choice)\b/i

/**
 * Every event type `classifyPa` can turn into a plate appearance, `unknown` included for the
 * reached-on-error rows. For a READ that wants to drop the steals, pickoffs and substitution notes
 * at the database: built from the same three sets `classifyPa` reads, so the filter cannot drift
 * away from the classifier and quietly lose a kind of out. Dropping any OUT here is the failure
 * the note on `WpblMatchupPlay` describes, every hitter batting .650.
 */
export const PA_EVENT_TYPES: readonly string[] = [...HIT_EVENTS, ...OUT_EVENTS, ...NON_AB_EVENTS, 'unknown']

export function classifyPa(play: Pick<WpblMatchupPlay, 'event_type' | 'narrative'>): PaOutcome | null {
  const et = play.event_type ?? ''
  if (HIT_EVENTS.has(et))    return { ab: 1, h: 1, hr: et === 'home_run' ? 1 : 0, xbh: et === 'single' ? 0 : 1, bb: 0, so: 0 }
  if (OUT_EVENTS.has(et))    return { ab: 1, h: 0, hr: 0, xbh: 0, bb: 0, so: et === 'strikeout' ? 1 : 0 }
  if (NON_AB_EVENTS.has(et)) return { ab: 0, h: 0, hr: 0, xbh: 0, bb: et === 'walk' ? 1 : 0, so: 0 }
  if (et === 'unknown' && REACHED_ON_ERROR.test(play.narrative ?? '')) return { ab: 1, h: 0, hr: 0, xbh: 0, bb: 0, so: 0 }
  return null
}

/**
 * The columns a batter-versus-pitcher line reads, and no more.
 *
 * DELIBERATELY NOT `WpblFirstsPlay`. That type names the projection behind
 * `fetchWpblAllPlays`, and that read drops routine outs AT THE DATABASE because none of them
 * can set a milestone. Feed it here and every hitter in the league bats about .650: the outs
 * are most of the denominator and none of them arrive, with no error and nothing short about
 * the array to notice. The only league-wide read that belongs here is the unfiltered one,
 * `fetchWpblAllRunValuePlays`.
 *
 * A structural type cannot enforce that, since the filtered read satisfies it too. Naming it
 * something other than the wrong read's own type is what the type CAN do.
 */
export type WpblMatchupPlay = Pick<WpblGamePlay,
  | 'game_id' | 'team_id' | 'batter_id' | 'batter_name' | 'pitcher_id' | 'pitcher_name'
  | 'event_type' | 'narrative'
>

/** What a matchup needs to know about a game: whether it counts (for the scope), and, when the
 *  caller has them, the two clubs, so a line can say which club each side played for. */
export type WpblMatchupGame = WpblSeasonGame & Partial<Pick<WpblGame, 'home_team_id' | 'away_team_id'>>

/**
 * Every id a player can appear under on a play.
 *
 * A play's ids are our own player uuids (the ingest resolves by name, and the columns are typed
 * uuid), so against stored plays this matches on `id` alone. The feed ids ride along for callers
 * holding plays from anywhere else, since the league mints a new one on a trade; a DATABASE
 * filter must drop them, see `fetchWpblPlayerMatchupPlays`. ONE definition, shared by the player card, the
 * compare page and the per-player read, so the three cannot disagree about who she is.
 */
export function playerPlayIds(p: Pick<WpblPlayer, 'id' | 'api_id' | 'api_ids'>): string[] {
  return [...new Set([p.id, p.api_id, ...(p.api_ids ?? [])].filter((x): x is string => !!x))]
}

export interface WpblMatchupLine {
  batterId: string; batterName: string
  pitcherId: string; pitcherName: string
  /** The clubs each side played for IN THESE PLATE APPEARANCES, off the play and the game, never
   *  the roster, which says where a traded player is now rather than where she was then. Usually
   *  one each; empty when the caller's games carry no clubs. */
  batterTeamIds: string[]; pitcherTeamIds: string[]
  pa: number; ab: number; h: number; hr: number; xbh: number; bb: number; so: number
  avg: number | null                  // null when ab === 0 (all walks / HBP)
  edge: 'pitcher' | 'batter' | null   // lopsided flag, for a badge
  score: number                       // how compelling the duel is (see below), for ranking
}

// One line per batter/pitcher pair with at least `minPa` plate appearances, ranked by how
// compelling the duel is (lopsided splits, homers, and extreme averages float up; raw
// familiarity barely counts) rather than by who's simply been faced the most, which would let
// the early-season workhorse pitcher fill the whole list.
//
// KEYED ON THE PLAYER ID, NOT THE NAME. The ingest resolves a play's batter and pitcher by name
// and leaves the id null when the name is ambiguous, so a name key would fold two namesakes into
// one duel exactly where the ingest refused to guess. A play with no id is skipped: it is
// evidence of nothing about who was at the plate. As of Sep 28, 2026 every one of the 2,820
// plate appearances carries both ids, so this costs nothing today.
//
// `games` is REQUIRED for the reason every aggregate in stats.ts requires it: a play carries a
// game_id and nothing else, so it cannot say whether it was a playoff at-bat. Without it a
// batter's semifinal homer lands in her season line against that pitcher. `scope` is the player
// page's Regular / Playoffs / Both control and defaults to the regular season like every other
// caller of `scopedLines`; the playoffs are a quarter of all plate appearances, so "Both" is a
// real difference in sample and the reader's to choose, not ours.
//
// minPa is 3, not 4, on purpose: at 4+ the pool collapses to the one or two pitchers with the
// most innings, so the board reads as "everyone vs Pitcher X." Three widens it to ~10 pitchers.
export function batterPitcherMatchups(
  plays: WpblMatchupPlay[], games: WpblMatchupGame[],
  { minPa = 3, scope = 'regular' }: { minPa?: number; scope?: SeasonScope } = {},
): WpblMatchupLine[] {
  const acc = new Map<string, WpblMatchupLine>()
  const gameById = new Map(games.map(g => [g.id, g]))
  const add = (xs: string[], x: string | null | undefined) => { if (x && !xs.includes(x)) xs.push(x) }
  for (const p of scopedLines(plays, games, scope)) {
    if (!p.batter_id || !p.pitcher_id) continue
    const o = classifyPa(p)
    if (!o) continue
    const key = `${p.batter_id}|${p.pitcher_id}`
    let r = acc.get(key)
    if (!r) {
      r = { batterId: p.batter_id, batterName: p.batter_name ?? '', pitcherId: p.pitcher_id, pitcherName: p.pitcher_name ?? '',
            batterTeamIds: [], pitcherTeamIds: [],
            pa: 0, ab: 0, h: 0, hr: 0, xbh: 0, bb: 0, so: 0, avg: null, edge: null, score: 0 }
      acc.set(key, r)
    }
    // The batting side is on the play; the pitching side is the game's other club.
    const g = gameById.get(p.game_id)
    add(r.batterTeamIds, p.team_id)
    if (p.team_id && g?.home_team_id && g.away_team_id) {
      add(r.pitcherTeamIds, p.team_id === g.home_team_id ? g.away_team_id : g.home_team_id)
    }
    r.pa++; r.ab += o.ab; r.h += o.h; r.hr += o.hr; r.xbh += o.xbh; r.bb += o.bb; r.so += o.so
    if (!r.batterName && p.batter_name) r.batterName = p.batter_name
    if (!r.pitcherName && p.pitcher_name) r.pitcherName = p.pitcher_name
  }
  const out: WpblMatchupLine[] = []
  for (const r of acc.values()) {
    if (r.pa < minPa) continue
    r.avg = r.ab > 0 ? r.h / r.ab : null
    r.edge = edgeOf(r)
    // Interestingness: lopsided edge + homers + how far the average strays from league-ish
    // .250 (weighted by the at-bat sample) + strikeouts, with familiarity as a faint tiebreak.
    const dev = r.avg == null ? 0 : Math.abs(r.avg - 0.25) * Math.min(r.ab, 8)
    r.score = (r.edge ? 3 : 0) + r.hr * 2.5 + dev * 3 + r.so * 0.3 + r.pa * 0.15
    out.push(r)
  }
  out.sort((a, b) => b.score - a.score || b.pa - a.pa)
  return out
}

/**
 * Who has had the better of a duel, or null when neither clearly has.
 *
 * A HOME RUN ALONE IS NOT AN EDGE. Until Sep 28, 2026 any homer handed the hitter the edge, which
 * put a 1-for-7 with one home run on a board headed "the hitter's edge" beside a .143 average.
 * The hitter now needs to be hitting: .500 over three at-bats, two home runs, or a homer inside a
 * .333 line. The pitcher needs three at-bats at .150 or under with nothing leaving the park.
 * Deliberately generous at these sample sizes, since the board prints the counts beside every
 * line and a reader can see "3-for-4" for what it is; what it must never do is print a verdict
 * the counts beside it contradict.
 */
export function edgeOf(r: Pick<WpblMatchupLine, 'ab' | 'h' | 'hr' | 'avg'>): 'pitcher' | 'batter' | null {
  if (r.hr >= 2) return 'batter'
  if (r.avg != null && r.ab >= 3 && r.avg >= 0.5) return 'batter'
  if (r.hr >= 1 && r.avg != null && r.avg >= 0.333) return 'batter'
  if (r.hr === 0 && r.ab >= 3 && r.avg != null && r.avg <= 0.15) return 'pitcher'
  return null
}

/** The three ways the league board reads the same lines. */
export type MatchupBoardView = 'pitcher' | 'batter' | 'faced'

/**
 * One board, sorted for what it is asking.
 *
 * THE EDGE BOARDS RANK BY MARGIN, NOT AVERAGE. Sorted by average, a 2-for-2 led the hitter's board
 * over a 4-for-5, because at these sample sizes the highest averages are simply the smallest
 * samples. The margin is hits against what a league-average hitter would have had in the same
 * at-bats, `h - avg * ab`, with the league average taken from the lines themselves, so a longer
 * run of success counts for more than a short one. `batter` sorts that margin high to low, then
 * home runs; `pitcher` low to high, then strikeouts. `faced` is every pair, most plate
 * appearances first, the duels the league kept staging rather than the loudest ones.
 */
export function matchupBoard(lines: WpblMatchupLine[], view: MatchupBoardView): WpblMatchupLine[] {
  const tie = (a: WpblMatchupLine, b: WpblMatchupLine) =>
    b.pa - a.pa || a.batterName.localeCompare(b.batterName) || a.pitcherName.localeCompare(b.pitcherName)
  if (view === 'faced') return [...lines].sort(tie)
  const ab = lines.reduce((n, l) => n + l.ab, 0)
  const leagueAvg = ab > 0 ? lines.reduce((n, l) => n + l.h, 0) / ab : 0.25
  const margin = (l: WpblMatchupLine) => l.h - leagueAvg * l.ab
  if (view === 'pitcher') {
    return lines.filter(l => l.edge === 'pitcher').sort((a, b) => margin(a) - margin(b) || b.so - a.so || tie(a, b))
  }
  return lines.filter(l => l.edge === 'batter').sort((a, b) => margin(b) - margin(a) || b.hr - a.hr || tie(a, b))
}

// One player's duels from both sides of the plate, most-faced first, for the player page.
//
// EVERY PAIR, NOT JUST THE COMPELLING ONES. The league board ranks by `score` to surface a duel
// nobody went looking for; a reader on her page is asking "how has she done against whom", and
// the honest answer to that is the whole list in order of how much evidence each line carries.
// Only three pairs in the 2026 regular season met more than seven times, so a ranking by average
// would put a 1-for-1 at the top of every card.
//
// `playerIds` is every id the player could appear under. A play's ids are our own player uuids
// (the ingest resolves by name), so this is normally one id, but it is a set so a caller can
// pass the same set compare.ts builds and the two surfaces cannot disagree about who she is.
export interface WpblPlayerMatchups {
  /** Her at the plate: one line per pitcher she has faced. */
  vsPitchers: WpblMatchupLine[]
  /** Her on the mound: one line per batter she has faced. */
  vsBatters: WpblMatchupLine[]
}

export function playerMatchups(
  playerIds: ReadonlySet<string>, plays: WpblMatchupPlay[], games: WpblSeasonGame[],
  scope: SeasonScope = 'regular',
): WpblPlayerMatchups {
  const mine = plays.filter(p =>
    (p.batter_id != null && playerIds.has(p.batter_id)) || (p.pitcher_id != null && playerIds.has(p.pitcher_id)))
  const all = batterPitcherMatchups(mine, games, { minPa: 1, scope })
  const byEvidence = (a: WpblMatchupLine, b: WpblMatchupLine) =>
    b.pa - a.pa || b.h - a.h || b.hr - a.hr || a.batterName.localeCompare(b.batterName) || a.pitcherName.localeCompare(b.pitcherName)
  return {
    vsPitchers: all.filter(l => playerIds.has(l.batterId)).sort(byEvidence),
    vsBatters: all.filter(l => playerIds.has(l.pitcherId)).sort(byEvidence),
  }
}

// ─── Team head-to-head ──────────────────────────────────────────────────────────

export interface WpblH2HCell { wins: number; losses: number; runsFor: number; runsAgainst: number }

// grid.get(rowId, colId) → the row team's record + runs vs the column team, or null if they
// haven't met (or it's the diagonal). Only decisive finals count, same rule as computeStandings.
//
// BOTH HALVES OF THAT RULE: the decisive-final test AND `countsInStandings`. With only the
// first, the first postseason game to go final reads as one more meeting: San Francisco 6-0
// over Boston against a season series of 5-0, one row above a standings table that says 10-5.
// Nothing marks the extra win as a playoff win, because from in here it looks like any other
// final.
export interface WpblH2H { get(rowId: string, colId: string): WpblH2HCell | null }

export function headToHead(games: WpblGame[]): WpblH2H {
  const rec = new Map<string, WpblH2HCell>()
  const cell = (a: string, b: string) => {
    const k = `${a}|${b}`
    let c = rec.get(k)
    if (!c) { c = { wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 }; rec.set(k, c) }
    return c
  }
  for (const g of games) {
    if (!countsInStandings(g)) continue
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    const A = cell(g.home_team_id, g.away_team_id), B = cell(g.away_team_id, g.home_team_id)
    A.runsFor += g.home_score; A.runsAgainst += g.away_score
    B.runsFor += g.away_score; B.runsAgainst += g.home_score
    if (g.home_score > g.away_score) { A.wins++; B.losses++ } else { A.losses++; B.wins++ }
  }
  return { get: (a, b) => rec.get(`${a}|${b}`) ?? null }
}
