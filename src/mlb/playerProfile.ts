// The MLB player page's data: everything the page draws, read from StatsAPI by the page itself
// (views/MlbPlayerDetail.tsx) rather than handed down from useMlbState, so the same card can open
// as a page today and as the desktop side panel next, the way WPBL's player does.
//
// FEW REQUESTS, EACH WIDE. StatsAPI answers several stat types and several groups in one call, so
// a season's regular-season picture (the line, advanced, sabermetrics, expected, splits and
// fielding, for both hitting and pitching) is ONE request. The rest is the game log (both groups,
// every game type, one request), the postseason line (one), the career (two, cached and shared
// with the trends chart), awards (one) and, for a pitcher, the pitch mix (one). League ranks come
// off the season pool the leaderboards already cache.

import { fetchYearByYearSplits } from './api'
import { fetchSeasonPlayerStats } from './apiSeasonStats'
import { CURRENT_SEASON, TEAM_ABBR } from './constants'
import { combineStatLines } from './lib/gameScope'
import type { CareerStatSplit, RecentGameEntry } from './types'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from './qualify'

const API = 'https://statsapi.mlb.com/api/v1'

export type Role = 'hitting' | 'pitching'
/** The card's Regular / Playoffs / Both control. */
export type CardScope = 'regular' | 'post' | 'all'

const getJson = (url: string): Promise<any> => fetch(url).then(r => r.json())

/** A completed season never changes, so its reads are kept for the session. The current one is
 *  always read fresh. Failures are evicted so a blip does not stick. */
function cached<T>(store: Map<string, Promise<T>>, key: string, season: number, run: () => Promise<T>): Promise<T> {
  if (season >= CURRENT_SEASON) return run()
  const hit = store.get(key)
  if (hit) return hit
  const p = run()
  store.set(key, p)
  p.catch(() => store.delete(key))
  return p
}

// ─── Bio ────────────────────────────────────────────────────────────────────────

export interface MlbBio {
  id: number
  fullName: string
  active: boolean
  primaryNumber?: string
  currentAge?: number
  birthCity?: string
  birthStateProvince?: string
  birthCountry?: string
  height?: string
  weight?: number
  mlbDebutDate?: string
  lastPlayedDate?: string
  batSide?: { code: string }
  pitchHand?: { code: string }
  primaryPosition: { code: string; name: string; type: string; abbreviation?: string }
  currentTeam?: { id: number; name: string }
  drafts?: { year: string; pickRound: string; pickNumber: number; team?: { id: number } }[]
}

const bioCache = new Map<number, Promise<MlbBio | null>>()

/** The person, with the draft that `fetchPlayerDetails` leaves out (it is fetched on every player
 *  click across the section and the draft carries a scouting blurb nobody else reads). */
export function fetchMlbBio(id: number): Promise<MlbBio | null> {
  const hit = bioCache.get(id)
  if (hit) return hit
  const p = getJson(`${API}/people/${id}?hydrate=currentTeam,draft`).then(d => d.people?.[0] ?? null)
  bioCache.set(id, p)
  p.then(b => { if (b) bioSettled.set(id, b) }, () => bioCache.delete(id))
  return p
}

const bioSettled = new Map<number, MlbBio>()

/** A bio this session has already read, without waiting a tick for it. The compare page sizes its
 *  first frame from it: a promise, even a settled one, answers only after that frame is drawn. */
export const peekMlbBio = (id: number): MlbBio | undefined => bioSettled.get(id)

/** Where the player is from, as a reader would write it: no country for an American. */
export function birthplace(b: MlbBio): string | null {
  const parts = [b.birthCity, b.birthStateProvince, b.birthCountry && b.birthCountry !== 'USA' ? b.birthCountry : null].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** "Round 3, Pick 90 · 2018". The June amateur draft only: the feed also lists the old secondary
 *  phases, and a player drafted more than once is described by the draft they signed out of,
 *  which is the latest. */
export function draftLine(b: MlbBio): string | null {
  const d = [...(b.drafts ?? [])].sort((x, y) => Number(y.year) - Number(x.year))[0]
  if (!d?.pickRound) return null
  const round = /^\d+$/.test(d.pickRound) ? `Round ${d.pickRound}` : d.pickRound
  return `${round}, Pick ${d.pickNumber} · ${d.year} draft`
}

// ─── One season ─────────────────────────────────────────────────────────────────

export interface SplitLine { code: string; stat: any }

/** Fielding at one position. */
export interface FieldingLine { position: string; stat: any }

export interface SeasonBundle {
  hitting: any | null
  pitching: any | null
  advanced: Record<Role, any | null>
  saber: Record<Role, any | null>
  expected: Record<Role, any | null>
  splits: Record<Role, SplitLine[]>
  fielding: FieldingLine[]
}

const seasonCache = new Map<string, Promise<SeasonBundle>>()

/** Situational splits the page draws, in the order it draws them. */
export const SPLIT_CODES = ['vl', 'vr', 'h', 'a', 'risp'] as const

export function fetchSeasonBundle(id: number, season: number): Promise<SeasonBundle> {
  return cached(seasonCache, `${id}-${season}`, season, async () => {
    const d = await getJson(`${API}/people/${id}/stats?stats=season,seasonAdvanced,sabermetrics,expectedStatistics,statSplits`
      + `&group=hitting,pitching,fielding&season=${season}&sitCodes=${SPLIT_CODES.join(',')}`)
    return parseSeasonBundle(d)
  })
}

/** Split out of the one response. Exported for the tests, which pin it against a recorded payload. */
export function parseSeasonBundle(d: any): SeasonBundle {
  const out: SeasonBundle = {
    hitting: null, pitching: null,
    advanced: { hitting: null, pitching: null },
    saber: { hitting: null, pitching: null },
    expected: { hitting: null, pitching: null },
    splits: { hitting: [], pitching: [] },
    fielding: [],
  }
  for (const st of d?.stats ?? []) {
    const type: string = st.type?.displayName
    const group: string = st.group?.displayName
    const splits: any[] = st.splits ?? []
    if (group === 'fielding') {
      if (type === 'season') {
        // A traded season comes back as a row per club per position PLUS a total with no team on
        // it, as the year-by-year does (see careerRows), so a pitcher dealt in July drew "P" three
        // times. One row a position: the total where there is one, else the club with most games.
        const byPos = new Map<string, any>()
        for (const s of [...splits].sort((a, b) => Number(!!a.team?.id) - Number(!!b.team?.id)
          || Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))) {
          const pos = s.position?.abbreviation ?? ''
          if (pos && pos !== 'DH' && !byPos.has(pos)) byPos.set(pos, s.stat)
        }
        out.fielding = [...byPos].map(([position, stat]) => ({ position, stat }))
          .sort((a, b) => Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))
      }
      continue
    }
    if (group !== 'hitting' && group !== 'pitching') continue
    const first = splits[0]?.stat ?? null
    if (type === 'season') out[group] = first
    else if (type === 'seasonAdvanced') out.advanced[group] = first
    else if (type === 'sabermetrics') out.saber[group] = first
    else if (type === 'expectedStatistics') out.expected[group] = first
    else if (type === 'statSplits') {
      // In SPLIT_CODES order (handedness first), not the feed's, which leads with home and away.
      const rank = (c: string) => { const i = (SPLIT_CODES as readonly string[]).indexOf(c); return i < 0 ? 99 : i }
      out.splits[group] = splits.map(s => ({ code: s.split?.code ?? '', stat: s.stat })).filter(s => s.code)
        .sort((x, y) => rank(x.code) - rank(y.code))
    }
  }
  return out
}

const postCache = new Map<string, Promise<Record<Role, any | null>>>()

/** The postseason line, both groups. Null for a role the player did not fill in October. */
export function fetchPostseasonLines(id: number, season: number): Promise<Record<Role, any | null>> {
  return cached(postCache, `${id}-${season}`, season, async () => {
    const d = await getJson(`${API}/people/${id}/stats?stats=season&group=hitting,pitching&season=${season}&gameType=P`)
    const out: Record<Role, any | null> = { hitting: null, pitching: null }
    for (const st of d?.stats ?? []) {
      const g = st.group?.displayName
      if (g === 'hitting' || g === 'pitching') out[g as Role] = st.splits?.[0]?.stat ?? null
    }
    return out
  })
}

/** The line a scope asks for. "Both" is built from the two, since StatsAPI has no combined pool. */
export function scopedLine(regular: any | null, post: any | null, scope: CardScope): any | null {
  if (scope === 'regular') return regular
  if (scope === 'post') return post
  return combineStatLines(regular, post)
}

// ─── Pitch mix ──────────────────────────────────────────────────────────────────

export interface PitchUsage { code: string; name: string; share: number; count: number; mph: number | null }

const arsenalCache = new Map<string, Promise<PitchUsage[]>>()

/** A pitcher's mix: share of pitches and average velocity per pitch type, most-thrown first.
 *  Its own request with `group=pitching` named: asked alongside a hitting group, StatsAPI returns a
 *  second, unlabelled arsenal of the pitches the player SAW at the plate. */
export function fetchPitchMix(id: number, season: number): Promise<PitchUsage[]> {
  return cached(arsenalCache, `${id}-${season}`, season, async () => {
    const d = await getJson(`${API}/people/${id}/stats?stats=pitchArsenal&group=pitching&season=${season}`)
    const splits: any[] = d?.stats?.[0]?.splits ?? []
    return splits
      .map(s => ({
        code: s.stat?.type?.code ?? '',
        name: s.stat?.type?.description ?? '',
        share: Number(s.stat?.percentage ?? 0),
        count: Number(s.stat?.count ?? 0),
        mph: s.stat?.averageSpeed != null ? Number(s.stat.averageSpeed) : null,
      }))
      .filter(p => p.code && p.count > 0)
      .sort((a, b) => b.share - a.share)
  })
}

// ─── Game log ───────────────────────────────────────────────────────────────────

export interface LogGame extends RecentGameEntry {
  gamePk: number
  /** StatsAPI's code: R for the regular season, F / D / L / W for the four postseason rounds. */
  gameType: string
  isWin: boolean | null
  /** Where the player stood that game, "C" or "LF/1B". */
  positions: string
  /** The club the player played that game for, which for a traded player is not the current one. */
  teamId: number | null
}

const logCache = new Map<string, Promise<LogGame[]>>()

/** Every game of a season, regular and postseason, newest first, both roles merged per game. */
export function fetchSeasonLog(id: number, season: number): Promise<LogGame[]> {
  return cached(logCache, `${id}-${season}`, season, async () => {
    const d = await getJson(`${API}/people/${id}/stats?stats=gameLog&group=hitting,pitching&season=${season}&gameType=R,F,D,L,W`)
    return parseGameLog(d)
  })
}

export function parseGameLog(d: any): LogGame[] {
  const byGame = new Map<number, LogGame>()
  for (const st of d?.stats ?? []) {
    const group = st.group?.displayName
    if (group !== 'hitting' && group !== 'pitching') continue
    for (const s of st.splits ?? []) {
      const pk = Number(s.game?.gamePk)
      if (!pk) continue
      let g = byGame.get(pk)
      if (!g) {
        const oppId = s.opponent?.id != null ? Number(s.opponent.id) : null
        g = {
          gamePk: pk,
          date: s.date ?? '',
          gameType: s.gameType ?? 'R',
          isHome: s.isHome ?? true,
          isWin: typeof s.isWin === 'boolean' ? s.isWin : null,
          opponentId: oppId,
          opponentAbbr: (oppId != null ? TEAM_ABBR[oppId] : null) ?? s.opponent?.abbreviation ?? '???',
          teamId: s.team?.id != null ? Number(s.team.id) : null,
          positions: (s.positionsPlayed ?? []).map((p: any) => p?.abbreviation).filter(Boolean).join('/'),
          hitting: null,
          pitching: null,
        }
        byGame.set(pk, g)
      }
      g[group as Role] = s.stat
      // A game the player only pitched has no positions on its hitting row; the pitching row says P.
      if (!g.positions && s.positionsPlayed?.length) g.positions = s.positionsPlayed.map((p: any) => p?.abbreviation).filter(Boolean).join('/')
    }
  }
  // Newest first. Same-date games (a doubleheader) by game number, the later one first.
  return [...byGame.values()].sort((a, b) => b.date.localeCompare(a.date) || b.gamePk - a.gamePk)
}

export const isPostseasonGame = (g: { gameType: string }) => g.gameType !== 'R'

export function scopedLog(log: LogGame[], scope: CardScope): LogGame[] {
  if (scope === 'all') return log
  return log.filter(g => (scope === 'post') === isPostseasonGame(g))
}

/** A batting line with a plate appearance in it. A pinch-runner or a defensive sub carries an
 *  all-zero row, which would otherwise be a "0-for-0" in the log. */
export function cameToPlate(s: any): boolean {
  return Number(s?.plateAppearances ?? 0) > 0
}

/** A pitcher's decision, for the log's DEC column. */
export function decision(s: any): string {
  if (!s) return '—'
  if (Number(s.wins) > 0) return 'W'
  if (Number(s.losses) > 0) return 'L'
  if (Number(s.saves) > 0) return 'SV'
  if (Number(s.holds) > 0) return 'HLD'
  if (Number(s.blownSaves) > 0) return 'BS'
  return '—'
}

// ─── Career ─────────────────────────────────────────────────────────────────────

export interface CareerRow {
  season: number
  /** Every club that season, in the order the player played for them: "DET/LAD". */
  teams: string
  /** The club the season ended with, for the band's colours. */
  lastTeamId: number | null
  stat: any
}

/**
 * One row per season for a role, from StatsAPI's year-by-year.
 *
 * A TRADED SEASON COMES BACK AS A ROW PER CLUB PLUS A TOTAL, and the total is the one with no
 * team on it (`numTeams` 2). The old career table took the club row with the most games, so a
 * pitcher traded at the deadline showed two thirds of a season as the whole of it. The total is
 * the season; the club rows only say which clubs.
 */
export function careerRows(splits: any[]): CareerRow[] {
  const bySeason = new Map<number, any[]>()
  for (const s of splits) {
    const y = Number(s.season)
    if (!y) continue
    bySeason.set(y, [...(bySeason.get(y) ?? []), s])
  }
  const rows: CareerRow[] = []
  for (const [season, list] of bySeason) {
    const clubs = list.filter(s => s.team?.id)
    const total = list.find(s => !s.team?.id) ?? (clubs.length === 1 ? clubs[0] : null)
    const stat = total?.stat ?? (clubs.length ? clubs.reduce((acc, s) => combineStatLines(acc, s.stat), null as any) : null)
    if (!stat) continue
    const abbrs: string[] = []
    for (const c of clubs) {
      const a = TEAM_ABBR[Number(c.team.id)] ?? c.team.abbreviation
      if (a && !abbrs.includes(a)) abbrs.push(a)
    }
    rows.push({ season, teams: abbrs.join('/'), lastTeamId: clubs.length ? Number(clubs[clubs.length - 1].team.id) : null, stat })
  }
  return rows.sort((a, b) => b.season - a.season)
}

export interface Career {
  hitting: CareerRow[]
  pitching: CareerRow[]
  totals: Record<Role, any | null>
}

const careerTotalsCache = new Map<number, Promise<Record<Role, any | null>>>()

function fetchCareerTotals(id: number): Promise<Record<Role, any | null>> {
  const hit = careerTotalsCache.get(id)
  if (hit) return hit
  const p = getJson(`${API}/people/${id}/stats?stats=career&group=hitting,pitching&sportId=1`).then(d => {
    const out: Record<Role, any | null> = { hitting: null, pitching: null }
    for (const st of d?.stats ?? []) {
      const g = st.group?.displayName
      if (g === 'hitting' || g === 'pitching') out[g as Role] = st.splits?.[0]?.stat ?? null
    }
    return out
  })
  careerTotalsCache.set(id, p)
  p.catch(() => careerTotalsCache.delete(id))
  return p
}

export async function fetchCareer(id: number): Promise<Career> {
  const [hit, pit, totals] = await Promise.all([
    fetchYearByYearSplits(id, 'hitting'),
    fetchYearByYearSplits(id, 'pitching'),
    fetchCareerTotals(id).catch(() => ({ hitting: null, pitching: null })),
  ])
  return { hitting: careerRows(hit), pitching: careerRows(pit), totals }
}

/** The career in the trends chart's shape (oldest first, one entry a season, both roles). */
export function careerTrendSplits(c: Career): CareerStatSplit[] {
  const seasons = [...new Set([...c.hitting, ...c.pitching].map(r => r.season))].sort((a, b) => a - b)
  return seasons.map(season => {
    const h = c.hitting.find(r => r.season === season)
    const p = c.pitching.find(r => r.season === season)
    return {
      season,
      teamId: h?.lastTeamId ?? p?.lastTeamId ?? null,
      teamAbbr: (h?.teams || p?.teams) || null,
      hitting: h?.stat ?? null,
      pitching: p?.stat ?? null,
    }
  })
}

// ─── Awards ─────────────────────────────────────────────────────────────────────

export interface AwardTally { key: string; label: string; seasons: number[] }

/**
 * The honours worth a ribbon, in the order a reader ranks them.
 *
 * A WHITELIST, because the feed's list is everything: every Player of the Week, every minor-league
 * mid-season All-Star team, Baseball America's lists. A ribbon for each would bury the MVP under
 * forty of them. AL and NL versions of an award fold into one ribbon.
 */
const AWARD_RULES: { key: string; label: string; test: (id: string) => boolean }[] = [
  { key: 'mvp', label: 'MVP', test: id => id === 'ALMVP' || id === 'NLMVP' },
  { key: 'cy', label: 'Cy Young', test: id => id === 'ALCY' || id === 'NLCY' },
  { key: 'ws', label: 'World Series', test: id => id === 'WSCHAMP' },
  { key: 'wsmvp', label: 'World Series MVP', test: id => id === 'WSMVP' },
  { key: 'roy', label: 'Rookie of the Year', test: id => id === 'ALROY' || id === 'NLROY' },
  { key: 'pg', label: 'Platinum Glove', test: id => id === 'ALPG' || id === 'NLPG' },
  { key: 'gg', label: 'Gold Glove', test: id => id === 'ALGG' || id === 'NLGG' },
  { key: 'ss', label: 'Silver Slugger', test: id => id === 'ALSS' || id === 'NLSS' },
  { key: 'haa', label: 'Hank Aaron Award', test: id => id === 'ALHAA' || id === 'NLHAA' },
  { key: 'as', label: 'All-Star', test: id => id === 'ALAS' || id === 'NLAS' },
]

export function tallyAwards(awards: { id: string; season?: string }[]): AwardTally[] {
  const out: AwardTally[] = []
  for (const rule of AWARD_RULES) {
    const seasons = [...new Set(awards.filter(a => rule.test(a.id)).map(a => Number(a.season)).filter(Boolean))].sort((a, b) => a - b)
    if (seasons.length) out.push({ key: rule.key, label: rule.label, seasons })
  }
  return out
}

const awardsCache = new Map<number, Promise<AwardTally[]>>()

export function fetchAwards(id: number): Promise<AwardTally[]> {
  const hit = awardsCache.get(id)
  if (hit) return hit
  const p = getJson(`${API}/people/${id}/awards`).then(d => tallyAwards(d?.awards ?? []))
  awardsCache.set(id, p)
  p.catch(() => awardsCache.delete(id))
  return p
}

// ─── League ranks ───────────────────────────────────────────────────────────────

export interface MlbRank { rank: number; of: number }

export interface SeasonRanks {
  /** Keyed by the season line's column label. */
  ranks: Record<string, MlbRank>
  /** The qualifying bars this season, which the sample line names a shortfall against. */
  minPa: number
  minOuts: number
}

/** Outs from a "123.1"-style innings string. */
export const ipToOuts = (ip: any): number => {
  const [w, f] = String(ip ?? '0').split('.')
  return (Number(w) || 0) * 3 + (Number(f) || 0)
}

interface RankDef { label: string; value: (s: any) => number | null; rate?: boolean; lower?: boolean }

const num = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))

/** What the season line ranks. Strikeouts are never ranked for a hitter, and nothing a pitcher
 *  gives up is ranked for a pitcher: second in the league in either is not an achievement. */
export const RANK_DEFS: Record<Role, RankDef[]> = {
  hitting: [
    { label: 'AVG', value: s => num(s.avg), rate: true },
    { label: 'OBP', value: s => num(s.obp), rate: true },
    { label: 'SLG', value: s => num(s.slg), rate: true },
    { label: 'OPS', value: s => num(s.ops), rate: true },
    { label: 'R', value: s => num(s.runs) },
    { label: 'H', value: s => num(s.hits) },
    { label: '2B', value: s => num(s.doubles) },
    { label: '3B', value: s => num(s.triples) },
    { label: 'HR', value: s => num(s.homeRuns) },
    { label: 'RBI', value: s => num(s.rbi) },
    { label: 'SB', value: s => num(s.stolenBases) },
    { label: 'BB', value: s => num(s.baseOnBalls) },
  ],
  pitching: [
    { label: 'ERA', value: s => num(s.era), rate: true, lower: true },
    { label: 'WHIP', value: s => num(s.whip), rate: true, lower: true },
    { label: 'K/9', value: s => num(s.strikeoutsPer9Inn), rate: true },
    { label: 'K/BB', value: s => num(s.strikeoutWalkRatio), rate: true },
    { label: 'W', value: s => num(s.wins) },
    { label: 'SV', value: s => num(s.saves) },
    { label: 'HLD', value: s => num(s.holds) },
    { label: 'IP', value: s => ipToOuts(s.inningsPitched) },
    { label: 'SO', value: s => num(s.strikeOuts) },
  ],
}

/**
 * The player's place in each ranked column, against the season's whole pool.
 *
 * QUALIFYING IS MLB'S OWN RULE, 3.1 plate appearances or 1 inning per team game, with the team's
 * games read as the most any player has appeared in (the pool carries no schedule). A rate is
 * ranked only among qualifiers, and a player short of the bar gets no rate rank at all rather than
 * one against a field the player is not in. Ties share a place: rank is one more than the number of
 * players strictly ahead.
 */
export function rankPlayer(pool: any[], playerId: number, role: Role): SeasonRanks {
  const games = Math.max(1, ...pool.map(s => Number(s.stat?.gamesPlayed ?? 0)))
  const minPa = Math.round(games * MLB_QUALIFY_PA_PER_GAME)
  const minOuts = games * MLB_QUALIFY_IP_PER_GAME * 3
  const qualifies = (s: any) => role === 'hitting'
    ? Number(s?.plateAppearances ?? 0) >= minPa
    : ipToOuts(s?.inningsPitched) >= minOuts
  const me = pool.find(s => Number(s.player?.id) === playerId)?.stat
  const ranks: Record<string, MlbRank> = {}
  if (!me) return { ranks, minPa, minOuts }
  for (const def of RANK_DEFS[role]) {
    if (def.rate && !qualifies(me)) continue
    const mine = def.value(me)
    if (mine == null) continue
    const field = (def.rate ? pool.filter(s => qualifies(s.stat)) : pool)
      .map(s => def.value(s.stat))
      .filter((v): v is number => v != null)
    const ahead = field.filter(v => (def.lower ? v < mine : v > mine)).length
    ranks[def.label] = { rank: ahead + 1, of: field.length }
  }
  return { ranks, minPa, minOuts }
}

export async function fetchSeasonRanks(playerId: number, role: Role, season: number): Promise<SeasonRanks> {
  return rankPlayer(await fetchSeasonPlayerStats(role, season), playerId, role)
}

// ─── Roles ──────────────────────────────────────────────────────────────────────

/** Below these a second role is a cameo (a reliever's at-bats in an old NL park, a position
 *  player's mop-up inning): one line in the main pane rather than a tab of its own. Season-sized,
 *  unlike WPBL's fifteen-game thresholds. */
export const BAT_CAMEO_PA = 150
export const PIT_CAMEO_OUTS = 45

export interface RolePlan {
  /** The roles that get a pane, primary first. */
  roles: Role[]
  battingCameo: boolean
  pitchingCameo: boolean
}

/**
 * Which roles a season earns. A pitcher leads with pitching and a position player with hitting,
 * whatever the season's numbers say; a two-way player leads with hitting, which is where most of
 * the games are. A second role gets its own pane only above the cameo bar.
 */
export function planRoles(positionCode: string, hitting: any | null, pitching: any | null): RolePlan {
  const pitcherFirst = positionCode === '1'
  const pa = Number(hitting?.plateAppearances ?? 0)
  const outs = pitching ? ipToOuts(pitching.inningsPitched) : 0
  const hasHit = pa > 0
  const hasPit = outs > 0 || Number(pitching?.battersFaced ?? 0) > 0
  const battingCameo = pitcherFirst && hasHit && pa < BAT_CAMEO_PA
  const pitchingCameo = !pitcherFirst && hasPit && outs < PIT_CAMEO_OUTS
  const primary: Role = pitcherFirst ? (hasPit || !hasHit ? 'pitching' : 'hitting') : (hasHit || !hasPit ? 'hitting' : 'pitching')
  const second: Role = primary === 'hitting' ? 'pitching' : 'hitting'
  const secondReal = second === 'hitting' ? hasHit && !battingCameo : hasPit && !pitchingCameo
  return { roles: secondReal ? [primary, second] : [primary], battingCameo, pitchingCameo }
}
