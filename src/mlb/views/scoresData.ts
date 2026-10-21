import { TEAM_ABBR } from '../constants'
import { fetchSeasonDates } from '../seasonPhase'
import { postseasonGameLabel, isDecider } from '../postseason'
import { isUnplayed, unplayedLabel, hasStartTime, SCORED_GAME_TYPES, SCHEDULE_GAME_TYPES } from '../gameStatus'
import { cachedJson, FRESH_LIVE_MS, FRESH_LONG_MS } from '../lib/readCache'

// The MLB scoreboard's data: the card's shape, the one StatsAPI schedule query every scoreboard
// reads, and the season's game days. Out of FinalGames.tsx (Oct 2026) so the Scores timeline can
// read it without the two view files importing each other: a cycle between them blanked the page
// under Vite's hot reload, and it is a load-order bug waiting in any build.

// ─── Types ────────────────────────────────────────────────────────────────────

export type GameState = 'live' | 'final' | 'preview' | 'postponed'

export interface FinalTeam {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  isWinner: boolean
  record?:  string          // "54-38": season record as of this game
}

export interface FinalGameSummary {
  gamePk:     number
  state:      GameState
  startMs:    number                 // scheduled first pitch (epoch ms), drives chronological order
  statusText: string                 // "Final"/"Final/10", live inning ("▲ 5th"), or start time
  home:       FinalTeam
  away:       FinalTeam
  winPitcher:  string | null
  losePitcher: string | null
  savePitcher: string | null
  reason?:     string                // "Rain"/"Snow"/..., only set for postponed games
  /** Held up by weather or the like, before first pitch or mid-game. */
  delayed?:    boolean
  /** Postseason only: the game's place in the bracket ("NLWC Gm 3"), and whether it decides the
   *  series. The score card printed "PHI 1-1, ATL 1-1" over a winner-take-all game and said nothing
   *  else; the series records were there, the stakes were not. */
  series?:     { label: string; decider: boolean }
  /** "MIL leads 2-0", StatsAPI's own line for the series as it stands. Postseason only. */
  seriesResult?: string
  /** Runs per inning, away and home. Null is a half not batted (the home ninth of a home win, or
   *  one a live game has not reached). The full Scores card's line score. */
  innings?:    { num: number; away: number | null; home: number | null }[]
  /** The three decisions with ids, for the full card. The name-only fields above are what the
   *  game sheets read. */
  decisions?:  { win: Person | null; loss: Person | null; save: Person | null }
  /** A live game's situation, between the scores. Absent unless live. */
  live?:       LiveSituation
  /** Starters announced for a game not yet played, with their season W-L and ERA. */
  probables?:  { away: Probable | null; home: Probable | null }
  /** Where to watch: the national carrier when there is one, else each club's own channel. */
  tv?:         string
  venue?:      string
  /** A postponed game's makeup date (YYYY-MM-DD), when one is set. */
  makeup?:     string
  /** A postseason game that is played only if the series is still going. */
  ifNecessary?: boolean
}

export interface Person { id: number; name: string }
export interface Probable extends Person { hand: string | null; wins: number | null; losses: number | null; era: string | null }
export interface LiveSituation {
  outs: number; balls: number; strikes: number
  onFirst: boolean; onSecond: boolean; onThird: boolean
  /** "Middle" or "End": the batter and count describe an at-bat that has not started. */
  between: boolean
  batter: Person | null
  pitcher: Person | null
}



// ─── Date helpers (local, not UTC, which avoids an evening off-by-one) ──────────────────

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dateLabel(iso: string): string {
  const todayISO = toISO(new Date())
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  const tom  = new Date(); tom.setDate(tom.getDate() + 1)
  if (iso === todayISO)        return 'Today'
  if (iso === toISO(yest))     return 'Yesterday'
  if (iso === toISO(tom))      return 'Tomorrow'
  return fromISO(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── API ────────────────────────────────────────────────────────────────────

/** Where to watch, as a scoreboard prints it: the national carrier when the game has one (every
 *  postseason game, and the weekly national windows), else the two clubs' own channels, away first.
 *  English TV only; radio and the Spanish feeds are on the game's own page. */
function tvLine(broadcasts: any[] | undefined): string | undefined {
  const tv = (broadcasts ?? []).filter(b => b?.type === 'TV' && (b.language ?? 'en') === 'en')
  const national = [...new Set(tv.filter(b => b.isNational).map(b => b.callSign || b.name))]
  if (national.length) return national.join(' · ')
  const side = (s: string) => tv.find(b => b.homeAway === s)
  const local = [side('away'), side('home')].filter(Boolean).map(b => b.callSign || b.name)
  return local.length ? [...new Set(local)].join(' · ') : undefined
}

// Every scoreboard read is this one query, so the strip, the page and a game reached by its address
// parse the same fields. The hydrations give the full card its probables (with season W-L and ERA,
// through person(stats)), broadcasts and series line in the same request; `fields` trims what they
// drag in (each person's whole biography, every broadcast's media metadata) back to what is read
// here: a full regular-season day is 76KB with it and 464KB without. A key missing from FIELDS
// arrives as undefined with no error, so a new read off `game` needs its name added.
const HYDRATE = 'linescore,decisions,probablePitcher,person(stats(type=season,group=pitching)),broadcasts(all),seriesStatus,venue'
const FIELDS = [
  'dates', 'date', 'games', 'gamePk', 'gameType', 'gameDate', 'description', 'seriesGameNumber', 'gamesInSeries',
  'status', 'abstractGameState', 'codedGameState', 'detailedState', 'startTimeTBD', 'reason',
  'teams', 'away', 'home', 'team', 'id', 'name', 'abbreviation', 'score', 'isWinner', 'leagueRecord', 'wins', 'losses',
  'linescore', 'currentInning', 'currentInningOrdinal', 'inningState', 'inningHalf', 'isTopInning', 'scheduledInnings',
  'innings', 'num', 'runs', 'hits', 'errors', 'offense', 'defense', 'batter', 'pitcher', 'first', 'second', 'third',
  'fullName', 'balls', 'strikes', 'outs',
  'decisions', 'winner', 'loser', 'save', 'probablePitcher', 'stats', 'type', 'displayName', 'splits', 'stat', 'era',
  'pitchHand', 'code', 'broadcasts', 'callSign', 'isNational', 'language', 'homeAway',
  'seriesStatus', 'result', 'venue', 'rescheduleGameDate', 'ifNecessary',
].join(',')
const scheduleQuery = (range: string) =>
  `https://statsapi.mlb.com/api/v1/schedule?sportId=1&${range}&hydrate=${HYDRATE}&fields=${FIELDS}`

// In-memory cache of resolved games per date. Past/future dates are static
// (a Final result never changes, a Preview's start time rarely does) so once
// fetched they're safe to reuse for the rest of the session. This is what
// makes date-nav feel instant after the first visit to a date. "Today" is
// deliberately never cached since a live game's score/inning keeps changing.
const gamesCache = new Map<string, FinalGameSummary[]>()

function parseScheduleDateGames(dateObj: any): FinalGameSummary[] {
  const out: FinalGameSummary[] = []
  for (const game of dateObj.games ?? []) {
    if (!SCORED_GAME_TYPES.has(game.gameType)) continue
    const abs      = game.status?.abstractGameState
    const detState = game.status?.detailedState ?? ''
    // Postponed and canceled games report abstractGameState "Final" though they never
    // happened: check them first or they'd show as a 0-0 Final (see gameStatus.ts).
    // "Live" during Warmup (~20 min pre-first-pitch) isn't really live yet.
    const state: GameState = isUnplayed(game.status) ? 'postponed'
      : abs === 'Final' ? 'final'
      : abs === 'Live' && detState !== 'Warmup' ? 'live'
      : 'preview'
    const ls    = game.linescore ?? {}

    const mkTeam = (side: 'home' | 'away'): FinalTeam => {
      const t   = game.teams?.[side]
      const lst = ls.teams?.[side] ?? {}
      const id  = Number(t?.team?.id ?? 0)
      const rec = t?.leagueRecord
      return {
        teamId:   id,
        // A postseason stand-in ("HOU/CWS") has no abbreviation, and its name is already one.
        abbr:     TEAM_ABBR[id] ?? t?.team?.abbreviation ?? t?.team?.name ?? '???',
        name:     t?.team?.name ?? '???',
        runs:     lst.runs   ?? t?.score ?? 0,
        hits:     lst.hits   ?? 0,
        errors:   lst.errors ?? 0,
        isWinner: Boolean(t?.isWinner),
        record:   rec && rec.wins != null && rec.losses != null ? `${rec.wins}–${rec.losses}` : undefined,
      }
    }

    const parsedStart = game.gameDate ? new Date(game.gameDate).getTime() : NaN
    // Games without a usable start time sink to the bottom of their group.
    const startMs = Number.isNaN(parsedStart) ? Number.MAX_SAFE_INTEGER : parsedStart

    // "Delayed: Rain" mid-game, "Delayed Start: Rain" before it. A delay printed only the inning
    // before, so a score sitting still for an hour looked like a feed that had stopped.
    const delayed = /^Delayed/.test(detState) && (state === 'live' || state === 'preview')

    let statusText: string
    if (delayed) {
      // The reason is on the game's own page; the chip has room for one word beside "Live →".
      statusText = 'Delayed'
    } else if (state === 'postponed') {
      statusText = unplayedLabel(game.status)
    } else if (state === 'final') {
      // Extra innings → "Final/10", and a game called short → "Final/6": a rain-shortened score
      // read as nine innings otherwise. scheduledInnings defaults to 9.
      const scheduled = ls.scheduledInnings ?? 9
      const played    = ls.currentInning ?? scheduled
      statusText = played !== scheduled ? `Final/${played}` : 'Final'
    } else if (state === 'live') {
      // Between innings is `inningState` (Middle / End); `inningHalf` only ever says Top or
      // Bottom, so reading it for "End" printed an arrow over a break. Same rule as Game Center.
      const ord = ls.currentInningOrdinal
      const st  = ls.inningState as string | undefined
      if (ord) {
        statusText = st === 'Middle' ? `Mid ${ord}`
          : st === 'End' ? `End ${ord}`
          : `${ls.isTopInning === false || ls.inningHalf === 'Bottom' ? '▼' : '▲'} ${ord}`
      } else {
        statusText = game.status?.detailedState ?? 'Live'
      }
    } else {
      // Preview / scheduled: show start time, or a notable status (Postponed, etc.)
      const detailed = game.status?.detailedState ?? ''
      if (detailed && !['Scheduled', 'Pre-Game', 'Warmup'].includes(detailed)) {
        statusText = detailed
      } else {
        const dt = game.gameDate && hasStartTime(game.status) ? new Date(game.gameDate) : null
        statusText = dt ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TBD'
      }
    }

    const person = (raw: any): Person | null => raw?.id ? { id: Number(raw.id), name: raw.fullName ?? '' } : null
    const probable = (raw: any): Probable | null => {
      const p = person(raw)
      if (!p) return null
      // A pitcher traded in-season has a split per club; the one without a club is the season.
      const splits: any[] = raw.stats?.find((x: any) => x.type?.displayName === 'season')?.splits ?? []
      const st = (splits.find(x => !x.team) ?? splits[splits.length - 1])?.stat
      return { ...p, hand: raw.pitchHand?.code ?? null, wins: st?.wins ?? null, losses: st?.losses ?? null, era: st?.era ?? null }
    }
    const off = ls.offense ?? {}
    const def = ls.defense ?? {}
    const live: LiveSituation | undefined = state === 'live' ? {
      // Clamped: between at-bats the feed can hold the last strikeout's full count, as WPBL's does
      // (CLAUDE.md, live_state), and a fourth ball drawn as a bulb is a count that cannot exist.
      outs:    Math.min(3, Number(ls.outs ?? 0)),
      balls:   Math.min(3, Number(ls.balls ?? 0)),
      strikes: Math.min(2, Number(ls.strikes ?? 0)),
      onFirst: !!off.first, onSecond: !!off.second, onThird: !!off.third,
      between: ls.inningState === 'Middle' || ls.inningState === 'End',
      batter:  person(off.batter),
      pitcher: person(def.pitcher),
    } : undefined

    out.push({
      gamePk:     game.gamePk,
      state,
      startMs,
      statusText,
      home:       mkTeam('home'),
      away:       mkTeam('away'),
      winPitcher:  game.decisions?.winner?.fullName ?? null,
      losePitcher: game.decisions?.loser?.fullName  ?? null,
      savePitcher: game.decisions?.save?.fullName    ?? null,
      reason:      state === 'postponed' ? (game.status?.reason || undefined) : undefined,
      delayed:     delayed || undefined,
      series:      (() => {
        const label = postseasonGameLabel(game)
        // A decider is news before and during the game; once it is final the series line says it.
        return label ? { label, decider: state !== 'final' && isDecider(game) } : undefined
      })(),
      seriesResult: postseasonGameLabel(game) ? game.seriesStatus?.result || undefined : undefined,
      innings:     (ls.innings ?? []).map((i: any) => ({
        num:  Number(i.num),
        away: i.away?.runs ?? null,
        home: i.home?.runs ?? null,
      })),
      decisions:   game.decisions ? {
        win: person(game.decisions.winner), loss: person(game.decisions.loser), save: person(game.decisions.save),
      } : undefined,
      live,
      probables:   state === 'preview' || state === 'postponed'
        ? { away: probable(game.teams?.away?.probablePitcher), home: probable(game.teams?.home?.probablePitcher) }
        : undefined,
      tv:          tvLine(game.broadcasts),
      venue:       game.venue?.name || undefined,
      makeup:      state === 'postponed' ? game.rescheduleGameDate || undefined : undefined,
      ifNecessary: game.ifNecessary === 'Y' || undefined,
    })
  }
  return out
}

/** A slate that can still change must not go in gamesCache. "Not today" was the whole test, so a
 *  game still going at midnight was read once as yesterday's and then held: the page polled it
 *  and was handed the same inning back until it was reloaded. */
const settled = (games: FinalGameSummary[]) => !games.some(g => g.state === 'live' || g.delayed)

export async function fetchFinalGames(dateISO: string): Promise<FinalGameSummary[]> {
  const cacheable = dateISO !== toISO(new Date())
  if (cacheable) {
    const cached = gamesCache.get(dateISO)
    if (cached) return cached
  }
  try {
    // Today is held for seconds only, under the 30s the scoreboard polls at, so every tick is
    // still a real read; it is there for the section remounting on a switch back from WPBL.
    const d = await cachedJson<any>(scheduleQuery(`date=${dateISO}`), FRESH_LIVE_MS)
    const out: FinalGameSummary[] = []
    for (const dateObj of d.dates ?? []) out.push(...parseScheduleDateGames(dateObj))
    if (cacheable && settled(out)) gamesCache.set(dateISO, out)
    return out
  } catch { return [] }
}

/** One game by its pk, in the shape the scoreboard opens it with, for a game reached by its
 *  address rather than from a scoreboard (state/GameRoute.tsx). Null for no such game, or one the
 *  scoreboard would not show (spring training, an exhibition). Never cached: it may be live. */
export async function fetchGameSummary(gamePk: number): Promise<FinalGameSummary | null> {
  try {
    const r = await fetch(scheduleQuery(`gamePk=${gamePk}`))
    if (!r.ok) return null
    const d = await r.json()
    const dateObj = d.dates?.[0]
    return dateObj ? parseScheduleDateGames(dateObj).find(g => g.gamePk === gamePk) ?? null : null
  } catch { return null }
}

// Fetches a whole date range in one request and primes gamesCache with every settled date in it
// (never today, for the same live-score reason as above). Held for minutes, except a range that
// takes in today, which would otherwise paint a live game minutes behind on a remount.
async function primeGamesCache(startISO: string, endISO: string): Promise<Map<string, FinalGameSummary[]>> {
  const map = new Map<string, FinalGameSummary[]>()
  const today = toISO(new Date())
  try {
    const fresh = startISO <= today && today <= endISO ? FRESH_LIVE_MS : FRESH_LONG_MS
    const d = await cachedJson<any>(scheduleQuery(`startDate=${startISO}&endDate=${endISO}`), fresh)
    for (const dateObj of d.dates ?? []) {
      const iso   = dateObj.date as string
      const games = parseScheduleDateGames(dateObj)
      map.set(iso, games)
      if (games.length > 0 && iso !== today && settled(games)) gamesCache.set(iso, games)
    }
  } catch { /* best-effort: the caller sees the dates it asked for as empty */ }
  return map
}

/** The full cards for a run of game days (ascending), in one request for whatever is not cached
 *  already. Every date asked for is in the answer, empty if the read failed. */
export async function fetchGameDays(dates: string[]): Promise<Map<string, FinalGameSummary[]>> {
  const map = new Map<string, FinalGameSummary[]>()
  const today = toISO(new Date())
  const missing = dates.filter(d => d === today || !gamesCache.has(d))
  for (const d of dates) if (!missing.includes(d)) map.set(d, gamesCache.get(d)!)
  if (missing.length) {
    const got = await primeGamesCache(missing[0], missing[missing.length - 1])
    for (const d of missing) map.set(d, got.get(d) ?? [])
  }
  return map
}

// ─── Season bounds and game days ───────────────────────────────────────────────

export interface SeasonBounds { start: string; end: string }

// The same read Home's season phase makes (see seasonPhase.ts), so the two cost one request.
export function fetchSeasonBounds(season: number): Promise<SeasonBounds> {
  return fetchSeasonDates(season).then(d => d
    ? { start: d.regularSeasonStart, end: d.postSeasonEnd }
    : { start: `${season}-03-01`, end: `${season}-11-30` })
}

/** Every date in the season with a game, opening day through the last scheduled postseason date,
 *  ascending. Dates only: 8KB for the whole season. Finding the next game day used to read a
 *  month of full cards (2.3MB once the cards carried probables and broadcasts) to learn one date. */
export async function fetchSeasonGameDates(season: number): Promise<string[]> {
  const b = await fetchSeasonBounds(season)
  try {
    const d = await cachedJson<any>(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${b.start}&endDate=${b.end}` +
      `&gameType=${SCHEDULE_GAME_TYPES}&fields=dates,date`,
      FRESH_LONG_MS,
    )
    return (d.dates ?? []).map((x: any) => String(x.date)).sort()
  } catch { return [] }
}

// Nearest game day past `fromDateISO` in the given direction, or null past either end of the
// season, which is what keeps date-nav inside it.
export async function findAdjacentGameDate(fromDateISO: string, dir: 1 | -1, season: number): Promise<string | null> {
  const days = await fetchSeasonGameDates(season)
  return (dir === 1 ? days.find(d => d > fromDateISO) : [...days].reverse().find(d => d < fromDateISO)) ?? null
}

/** A settled day already read this session, without a request. Never today, which can still change. */
export const cachedGames = (dateISO: string): FinalGameSummary[] | undefined =>
  dateISO === toISO(new Date()) ? undefined : gamesCache.get(dateISO)
