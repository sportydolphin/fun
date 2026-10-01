import { TEAM_ABBR, isRealClub } from './constants'
import { isUnplayed, hasStartTime } from './gameStatus'

// ─── The MLB postseason bracket, as data ──────────────────────────────────────
//
// ONE READ: `/schedule/postseason/series` returns all eleven series with every game in each,
// including the "if necessary" ones and, before a round is decided, games between stand-in clubs
// ("HOU/CWS", "AL Higher Seed"). Nothing here is projected; the bracket is exactly what the league
// has published, which is why it can be read on the day of a game and be right.
//
// THE SHAPE COMES FROM THE SERIES IDS, and that is checked rather than assumed. Across every
// season of the 12-team format (2022 to 2026) the winner of F_1 plays in D_2, F_2 in D_1, F_3 in
// D_4, F_4 in D_3, D_1 and D_2 meet in L_1 (AL), D_3 and D_4 in L_2 (NL), and the two LCS winners
// in W_1; and D_1 and D_3 are hosted by each league's 1 seed. That gives every seed without a
// standings read: F_1/F_3 are 3 vs 6, F_2/F_4 are 4 vs 5, D_1/D_3 host the 1 seed and D_2/D_4
// the 2. If the league ever publishes a different set of ids, `buildBracket` returns null and the
// card simply does not draw, rather than drawing a wrong bracket with confidence.

export type SeriesId = 'F_1' | 'F_2' | 'F_3' | 'F_4' | 'D_1' | 'D_2' | 'D_3' | 'D_4' | 'L_1' | 'L_2' | 'W_1'
export type Round = 'wc' | 'ds' | 'lcs' | 'ws'

export const ROUNDS: { key: Round; label: string; short: string }[] = [
  { key: 'wc',  label: 'Wild Card',        short: 'WC' },
  { key: 'ds',  label: 'Division Series',  short: 'DS' },
  { key: 'lcs', label: 'League Championship', short: 'LCS' },
  { key: 'ws',  label: 'World Series',     short: 'WS' },
]

interface SeriesShape { round: Round; league: 'AL' | 'NL' | null; label: string; topSeed?: number; bottomSeed?: number }
const SHAPE: Record<SeriesId, SeriesShape> = {
  F_1: { round: 'wc',  league: 'AL', label: 'AL Wild Card',  topSeed: 3, bottomSeed: 6 },
  F_2: { round: 'wc',  league: 'AL', label: 'AL Wild Card',  topSeed: 4, bottomSeed: 5 },
  F_3: { round: 'wc',  league: 'NL', label: 'NL Wild Card',  topSeed: 3, bottomSeed: 6 },
  F_4: { round: 'wc',  league: 'NL', label: 'NL Wild Card',  topSeed: 4, bottomSeed: 5 },
  D_1: { round: 'ds',  league: 'AL', label: 'ALDS',          topSeed: 1 },
  D_2: { round: 'ds',  league: 'AL', label: 'ALDS',          topSeed: 2 },
  D_3: { round: 'ds',  league: 'NL', label: 'NLDS',          topSeed: 1 },
  D_4: { round: 'ds',  league: 'NL', label: 'NLDS',          topSeed: 2 },
  L_1: { round: 'lcs', league: 'AL', label: 'ALCS' },
  L_2: { round: 'lcs', league: 'NL', label: 'NLCS' },
  W_1: { round: 'ws',  league: null, label: 'World Series' },
}
/** Display order within a round: AL above NL, the 1 seed's side of each league first. */
export const SERIES_ORDER: SeriesId[] = ['F_2', 'F_1', 'F_4', 'F_3', 'D_1', 'D_2', 'D_3', 'D_4', 'L_1', 'L_2', 'W_1']

export interface PsTeam {
  id: number
  /** "TB", or a stand-in's own name ("HOU/CWS"), or "TBD" for "AL Higher Seed" and the like. */
  abbr: string
  name: string
  /** One of the 30 clubs. A stand-in is shown but never linked. */
  real: boolean
  seed: number | null
}

export interface PsGame {
  gamePk: number
  number: number
  ifNecessary: boolean
  state: 'preview' | 'live' | 'final' | 'postponed'
  startMs: number
  /** A real first pitch, not the placeholder published before the time is set. */
  timeSet: boolean
  detail: string
  /** "▲ 7th" while live, in the scoreboard's own spelling, so the two never disagree about a game
   *  they both show. Null otherwise, and on a live game the linescore has not caught up to. */
  inning: string | null
  away: { id: number; abbr: string; score: number | null }
  home: { id: number; abbr: string; score: number | null }
  winnerId: number | null
}

export interface PsSeries {
  id: SeriesId
  round: Round
  league: 'AL' | 'NL' | null
  label: string
  bestOf: number
  /** The higher seed: home in game 1. */
  top: PsTeam
  bottom: PsTeam
  winsTop: number
  winsBottom: number
  /** Set once a club has won enough games, from the games themselves. */
  winnerId: number | null
  games: PsGame[]
  /** The first game not yet final, skipping "if necessary" games the series never reached. */
  next: PsGame | null
  live: boolean
}

export interface Bracket { season: number; series: Record<SeriesId, PsSeries>; current: Round; started: boolean; over: boolean }

const abbrFor = (t: { id?: number; name?: string } | undefined): string => {
  const id = Number(t?.id ?? 0)
  if (TEAM_ABBR[id]) return TEAM_ABBR[id]
  const name = t?.name ?? ''
  // "HOU/CWS" says exactly who it is; "AL Higher Seed" says nothing a reader can use.
  return name.includes('/') ? name : 'TBD'
}

function parseGame(g: any): PsGame {
  const st = g.status ?? {}
  const abs = st.abstractGameState
  const state: PsGame['state'] = isUnplayed(st) ? 'postponed'
    : abs === 'Final' ? 'final'
    : abs === 'Live' && st.detailedState !== 'Warmup' ? 'live'
    : 'preview'
  const side = (s: 'away' | 'home') => {
    const t = g.teams?.[s]
    return { id: Number(t?.team?.id ?? 0), abbr: abbrFor(t?.team), score: state === 'preview' ? null : (t?.score ?? null) }
  }
  const away = side('away'), home = side('home')
  const winnerId = state !== 'final' ? null
    : g.teams?.home?.isWinner ? home.id : g.teams?.away?.isWinner ? away.id : null
  const t = g.gameDate ? new Date(g.gameDate).getTime() : NaN
  const ls = g.linescore ?? {}
  const inning = state === 'live' && ls.currentInningOrdinal
    ? `${ls.inningHalf === 'Bottom' || ls.inningHalf === 'End' ? '▼' : '▲'} ${ls.currentInningOrdinal}`
    : null
  return {
    gamePk: Number(g.gamePk),
    number: Number(g.seriesGameNumber ?? 0),
    ifNecessary: g.ifNecessary === 'Y',
    state,
    startMs: Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t,
    timeSet: hasStartTime(st),
    detail: st.detailedState ?? '',
    inning,
    away, home, winnerId,
  }
}

/** Pure, so it can be pinned against a recorded feed. Null when the feed is not the shape above. */
export function buildBracket(season: number, raw: any): Bracket | null {
  const list: any[] = raw?.series ?? []
  const byId = new Map<string, any>(list.map(s => [String(s?.series?.id), s]))
  const ids = Object.keys(SHAPE) as SeriesId[]
  if (!ids.every(id => byId.has(id) && (byId.get(id).games ?? []).length > 0)) return null

  const seedOf = new Map<number, number>()
  const series = {} as Record<SeriesId, PsSeries>
  // Rounds in order, so a club's seed from an earlier round is known when it reaches a later one.
  for (const id of SERIES_ORDER.slice().sort((a, b) => 'FDLW'.indexOf(a[0]) - 'FDLW'.indexOf(b[0]))) {
    const shape = SHAPE[id]
    const games = (byId.get(id).games as any[]).map(parseGame).sort((a, b) => a.number - b.number || a.startMs - b.startMs)
    const g1raw = (byId.get(id).games as any[]).find(g => Number(g.seriesGameNumber) === 1) ?? byId.get(id).games[0]
    const mk = (s: 'home' | 'away', seedFromShape?: number): PsTeam => {
      const t = g1raw.teams?.[s]?.team ?? {}
      const tid = Number(t.id ?? 0)
      const real = isRealClub(tid)
      const seed = seedFromShape ?? (real ? seedOf.get(tid) ?? null : null)
      if (real && seed != null && !seedOf.has(tid)) seedOf.set(tid, seed)
      return { id: tid, abbr: abbrFor(t), name: t.name ?? '', real, seed }
    }
    const top = mk('home', shape.topSeed)
    const bottom = mk('away', shape.bottomSeed)
    const bestOf = Number(g1raw.gamesInSeries ?? games.length) || games.length
    const need = winsNeeded({ bestOf })
    const winsTop = games.filter(g => g.winnerId === top.id && top.real).length
    const winsBottom = games.filter(g => g.winnerId === bottom.id && bottom.real).length
    const winnerId = winsTop >= need ? top.id : winsBottom >= need ? bottom.id : null
    const next = winnerId ? null : games.find(g => g.state !== 'final' && g.state !== 'postponed') ?? null
    series[id] = {
      id, round: shape.round, league: shape.league, label: shape.label, bestOf,
      top, bottom, winsTop, winsBottom, winnerId, games, next,
      live: games.some(g => g.state === 'live'),
    }
  }

  // The round on now: the earliest with a series still undecided, or the World Series once all is over.
  const rounds: Round[] = ['wc', 'ds', 'lcs', 'ws']
  const open = rounds.find(r => ids.some(id => series[id].round === r && series[id].winnerId == null))
  const started = ids.some(id => series[id].games.some(g => g.state === 'final' || g.state === 'live'))
  return { season, series, current: open ?? 'ws', started, over: open == null }
}

// Only what buildBracket reads: the full feed is several times the size, mostly venue and content links.
const FIELDS = 'series,id,games,gamePk,gameDate,gameType,status,abstractGameState,codedGameState,detailedState,' +
  'startTimeTBD,teams,away,home,team,name,score,isWinner,seriesGameNumber,gamesInSeries,ifNecessary,' +
  'linescore,currentInningOrdinal,inningHalf'

// A short-lived cache, so Home and Standings reading the bracket in one visit is one request.
let cache: { season: number; at: number; p: Promise<Bracket | null> } | null = null
const FRESH_MS = 60_000

export function fetchBracket(season: number, force = false): Promise<Bracket | null> {
  if (!force && cache && cache.season === season && Date.now() - cache.at < FRESH_MS) return cache.p
  const p = fetch(`https://statsapi.mlb.com/api/v1/schedule/postseason/series?season=${season}&sportId=1&hydrate=linescore&fields=${FIELDS}`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    .then(d => buildBracket(season, d))
    .catch(() => null)
  cache = { season, at: Date.now(), p }
  return p
}

/** Whether the field is set: all four Wild Card series between real clubs. The league can publish
 *  the postseason's series while every slot is still "AL Lower Seed", and a bracket of placeholders
 *  says nothing, so no surface draws one before this. */
export function fieldIsSet(b: Bracket): boolean {
  return (['F_1', 'F_2', 'F_3', 'F_4'] as const).every(id => b.series[id].top.real && b.series[id].bottom.real)
}

/** Wins needed to take the series: 2 of 3, 3 of 5, 4 of 7. */
export const winsNeeded = (s: Pick<PsSeries, 'bestOf'>): number => Math.floor(s.bestOf / 2) + 1

/** The live game's own score, leader first: "BOS 3–1", "Tied 2–2". Never the series: the card
 *  says that with its pips, and a second pair of numbers beside them is what made the card read
 *  as a box score. */
export function liveGameScore(g: PsGame): string {
  const a = g.away.score ?? 0, h = g.home.score ?? 0
  if (a === h) return `Tied ${a}–${h}`
  const lead = a > h ? g.away : g.home
  return `${lead.abbr} ${Math.max(a, h)}–${Math.min(a, h)}`
}

/** "TB leads 2-1", "Series tied 1-1", "TOR wins 2-0", or null before a game is final. */
export function seriesLine(s: PsSeries): string | null {
  const a = s.winsTop, b = s.winsBottom
  if (a + b === 0) return null
  if (s.winnerId != null) {
    const w = s.winnerId === s.top.id ? s.top : s.bottom
    return `${w.abbr} wins ${Math.max(a, b)}-${Math.min(a, b)}`
  }
  if (a === b) return `Series tied ${a}-${b}`
  const lead = a > b ? s.top : s.bottom
  return `${lead.abbr} leads ${Math.max(a, b)}-${Math.min(a, b)}`
}

// ─── One club's October, from the bracket ─────────────────────────────────────
//
// What Home's team card says once the regular season is over, and whether it still leads the page.
// A club that is still playing keeps the full card, because its next game is the most useful thing
// on Home for its fans; a club that is out shrinks to one line, because its last game is a week old.

export type TeamOctober =
  /** In a series that has not been decided. */
  | { kind: 'playing'; series: PsSeries; wins: number; losses: number; opp: PsTeam }
  /** Won its latest series and the next one has not been published with it in yet. */
  | { kind: 'advanced'; series: PsSeries; wins: number; losses: number; opp: PsTeam }
  | { kind: 'champion'; series: PsSeries; wins: number; losses: number; opp: PsTeam }
  | { kind: 'eliminated'; series: PsSeries; wins: number; losses: number; opp: PsTeam }
  | { kind: 'missed' }

const ROUND_ORDER: Round[] = ['wc', 'ds', 'lcs', 'ws']

/**
 * Null when the bracket cannot say: no bracket, or a field still made of placeholders. A club absent
 * from a bracket whose field IS set missed the postseason, since every entrant plays a Wild Card
 * series or holds a bye into a Division Series, and both of those name real clubs once the field is set.
 */
export function teamOctober(b: Bracket | null, teamId: number): TeamOctober | null {
  if (!b || !fieldIsSet(b)) return null
  const mine = SERIES_ORDER
    .map(id => b.series[id])
    .filter(s => (s.top.real && s.top.id === teamId) || (s.bottom.real && s.bottom.id === teamId))
    .sort((x, y) => ROUND_ORDER.indexOf(y.round) - ROUND_ORDER.indexOf(x.round))
  const s = mine[0]
  if (!s) return { kind: 'missed' }
  const isTop = s.top.id === teamId
  const wins = isTop ? s.winsTop : s.winsBottom
  const losses = isTop ? s.winsBottom : s.winsTop
  const opp = isTop ? s.bottom : s.top
  if (s.winnerId == null) return { kind: 'playing', series: s, wins, losses, opp }
  if (s.winnerId !== teamId) return { kind: 'eliminated', series: s, wins, losses, opp }
  return { kind: s.round === 'ws' ? 'champion' : 'advanced', series: s, wins, losses, opp }
}

/** The series as a fan of the club says it: "ALDS", "NL Wild Card Series", "World Series". */
export function seriesName(s: Pick<PsSeries, 'round' | 'league'>): string {
  if (s.round === 'wc') return `${s.league ?? ''} Wild Card Series`.trim()
  if (s.round === 'ws') return 'World Series'
  return `${s.league ?? ''}${s.round === 'ds' ? 'DS' : 'CS'}`
}

/** One line for the team card. Records read from the club's side: wins first. */
export function teamOctoberLine(o: TeamOctober): string {
  if (o.kind === 'missed') return 'Missed the postseason'
  const name = seriesName(o.series)
  const vs = o.opp.real ? ` vs ${o.opp.abbr}` : ''
  const rec = `${o.wins}-${o.losses}`
  switch (o.kind) {
    case 'champion':   return `World Series champions, ${rec}${vs}`
    case 'advanced':   return `Won the ${name} ${rec}${vs}`
    case 'eliminated': return o.series.round === 'ws' ? `Lost the World Series ${rec}${vs}` : `Out in the ${name}, ${rec}${vs}`
    case 'playing':
      if (o.wins + o.losses === 0) return `${name}${vs}`
      if (o.wins === o.losses) return `${name}: tied ${rec}${vs}`
      return `${name}: ${o.wins > o.losses ? 'leads' : 'trails'} ${rec}${vs}`
  }
}

/** Whether the club's season is still going, which is what keeps its card at full size. */
export const stillPlaying = (o: TeamOctober | null): boolean =>
  o == null || o.kind === 'playing' || o.kind === 'advanced' || o.kind === 'champion'

// ─── One postseason game, in a few characters ─────────────────────────────────

/** "NLWC Gm 2", "ALDS Gm 3", "WS Gm 1": the game's place in the bracket, short enough for a stat line. */
export function postseasonGameLabel(g: { gameType?: string; description?: string; seriesGameNumber?: number }): string | undefined {
  const round = ({ F: 'WC', D: 'DS', L: 'CS', W: 'WS' } as Record<string, string>)[g.gameType ?? '']
  if (!round) return undefined
  // "NL Wild Card 'A' Game 1", "ALDS 'B' Game 2", "ALCS Game 5": the league is the first two letters.
  const league = round === 'WS' ? '' : (/^(AL|NL)/.exec(g.description ?? '')?.[1] ?? '')
  const n = Number(g.seriesGameNumber ?? 0)
  return `${league}${round}${n > 0 ? ` Gm ${n}` : ''}`
}

/**
 * Whether a game still to be played decides its series: both clubs one win short. Read off the two
 * clubs' series records as the schedule publishes them on a postseason game (`leagueRecord` there is
 * the series, not the season), so it needs nothing beyond the game itself.
 */
export function isDecider(g: { gamesInSeries?: number; teams?: { away?: { leagueRecord?: { wins?: number } }; home?: { leagueRecord?: { wins?: number } } } }): boolean {
  const n = Number(g.gamesInSeries ?? 0)
  if (n < 3) return false
  const need = Math.floor(n / 2) + 1
  const a = g.teams?.away?.leagueRecord?.wins, h = g.teams?.home?.leagueRecord?.wins
  return a === need - 1 && h === need - 1
}
