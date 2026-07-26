// Report Card data layer — active-streak, iron-man, and pitches-per-PA leaders,
// all derived from per-player game logs (MLB StatsAPI has no streak stat type).
// Split out of api.ts; re-exported from there so '../api' imports still resolve.

import { TEAM_ABBR, CURRENT_SEASON } from './constants'
import { supabase } from '../lib/supabase'
import { fetchSeasonPlayerStats } from './apiSeasonStats'

// ─── Active streak leaders (computed from game logs) ─────────────────────────
// MLB StatsAPI has no streak stat type, so we derive current streaks from each
// candidate's game log. We can't fetch a log for all ~2000 players, so we narrow
// to a candidate pool first.
//
// That pool used to be "top 50 by games played / innings pitched", on the
// assumption that the real streak leaders are always among the highest-volume
// players. That assumption is wrong, and badly so:
//   · Catchers, platoon bats and anyone back from the IL sit well outside the
//     top 50 by games played while still running long hitting streaks.
//   · The top 50 by innings pitched are *all starters*, so scoreless-inning
//     streaks — overwhelmingly a reliever stat — could never appear at all.
// Measured mid-2026, 16 of the true top 25 hitting streaks were invisible.
//
// So eligibility is now a participation threshold that scales with how far into
// the season we are, rather than a volume ranking: play about half your team's
// games (or throw a fifth of the league-leading innings) and you're eligible.

export interface StreakRow {
  playerId: number
  playerName: string
  teamAbbr: string
  teamId: number
  value: number    // games (hitting / hitless / gamesPlayed) or outs (scoreless)
  capped?: boolean // gamesPlayed only: the streak was still alive at the oldest season we searched
}

export interface StreakLeaders {
  hitting: StreakRow[]
  hitless: StreakRow[]
  scoreless: StreakRow[]
  /** Optional: rows precomputed before this board existed won't carry it. */
  gamesPlayed?: StreakRow[]
}

// "5.1" innings → 16 outs. StatsAPI encodes thirds of an inning as .1 / .2.
function ipToOuts(ip: string | number | undefined): number {
  const [whole, frac] = String(ip ?? '0').split('.')
  return (Number(whole) || 0) * 3 + (Number(frac) || 0)
}

function fetchGameLog(id: number, group: 'hitting' | 'pitching', season: number): Promise<any[]> {
  return fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=${season}&sportId=1`)
    .then(r => r.json())
    .then((d: any) => {
      const splits = (d.stats?.[0]?.splits ?? []).filter((s: any) => s.gameType === 'R')
      // Game logs are normally chronological, but sort defensively so the last
      // element is reliably the most recent game.
      splits.sort((a: any, b: any) => (a.date ?? '').localeCompare(b.date ?? ''))
      return splits
    })
    .catch(() => [])
}

// ─── Games-played (iron man) streaks ─────────────────────────────────────────
// The other three boards only need a player's own game log: the streak lives
// entirely inside the games he appeared in. A consecutive-games-played streak is
// the opposite — it's broken by a game he *isn't* in, which his log can't show.
// So we need the team's schedule as the spine and the player's appearances laid
// against it.
//
// Rather than compare dates, each team's completed regular-season games are
// stored in chronological order and the player's appearances are mapped to
// positions in that list. Two appearances continue a streak when their positions
// differ by exactly 1. Seasons are concatenated into one list per team, so the
// offseason gap between the last game of one year and the first of the next is
// just another +1 step and streaks carry across years for free.
//
// A trade is the one case where positions can't be compared (different teams,
// different schedules). Official streaks survive a trade, so we do the same.

/** teamId → gamePks of completed regular-season games, oldest first. */
const seasonScheduleCache = new Map<number, Promise<Map<number, number[]>>>()

function fetchSeasonSchedule(season: number): Promise<Map<number, number[]>> {
  if (!seasonScheduleCache.has(season)) {
    seasonScheduleCache.set(season, (async () => {
      const byTeam = new Map<number, number[]>()
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${season}-01-01&endDate=${season}-12-31` +
          `&gameType=R&fields=dates,date,games,gamePk,status,codedGameState,teams,home,away,team,id`
        )
        const d = await r.json()
        // `dates` come back in calendar order, so pushing as we go keeps each
        // team's list chronological. Postponed and cancelled games never count.
        //
        // A suspended game is listed twice, once on the date it started and again
        // on the date it was finished, but a player's game log only ever records
        // the original date. Keeping the first listing of each gamePk matches the
        // logs; without this, the phantom second listing reads as a game everyone
        // missed and cuts every streak that crosses it.
        const seen = new Set<number>()
        for (const day of d.dates ?? []) {
          for (const g of day.games ?? []) {
            const state = g.status?.codedGameState
            if (state !== 'F' && state !== 'O') continue
            const pk = Number(g.gamePk)
            if (!pk || seen.has(pk)) continue
            seen.add(pk)
            for (const side of ['away', 'home'] as const) {
              const tid = Number(g.teams?.[side]?.team?.id)
              if (!tid) continue
              const arr = byTeam.get(tid)
              if (arr) arr.push(pk); else byTeam.set(tid, [pk])
            }
          }
        }
      } catch { /* empty map: the board comes back empty rather than wrong */ }
      return byTeam
    })())
  }
  return seasonScheduleCache.get(season)!
}

export interface PlayedGame { gamePk: number; teamId: number }

/** gamePk → position, per team. Rebuilt whenever an older season is prepended. */
export function buildScheduleIndex(byTeam: Map<number, number[]>): Map<number, Map<number, number>> {
  const index = new Map<number, Map<number, number>>()
  for (const [teamId, pks] of byTeam) {
    const m = new Map<number, number>()
    pks.forEach((pk, i) => m.set(pk, i))
    index.set(teamId, m)
  }
  return index
}

/**
 * Walk a player's appearances backwards from the most recent.
 *
 * `games` is the active streak, 0 when the player sat out his team's latest game.
 * `open` means the walk ran out of history without breaking: he played the very
 * first game we loaded, so the streak probably continues into an earlier season.
 */
export function walkGamesPlayedStreak(
  played: PlayedGame[],                            // chronological, oldest first
  byTeam: Map<number, number[]>,
  index: Map<number, Map<number, number>>,
): { games: number; open: boolean } {
  if (played.length === 0) return { games: 0, open: false }

  const posOf = (g: PlayedGame) => index.get(g.teamId)?.get(g.gamePk)

  // Only active streaks belong on the board, so the player must have been in his
  // team's most recent completed game.
  const latest = played[played.length - 1]
  const latestPos = posOf(latest)
  const teamGames = byTeam.get(latest.teamId)
  if (latestPos == null || !teamGames || latestPos !== teamGames.length - 1) {
    return { games: 0, open: false }
  }

  let games = 1
  for (let i = played.length - 1; i > 0; i--) {
    const later = played[i], earlier = played[i - 1]
    if (later.teamId === earlier.teamId) {
      const lp = posOf(later), ep = posOf(earlier)
      if (lp == null || ep == null || lp - ep !== 1) return { games, open: false }
    }
    // Different teams: he was traded mid-streak, which doesn't end it.
    games++
  }

  // Ran out of loaded games. Only worth looking further back if he played his
  // team's opening game of the span (rather than debuting partway through it).
  return { games, open: posOf(played[0]) === 0 }
}

// How many seasons before the current one to search. Four covers ~650 games,
// comfortably beyond any streak of the last few decades.
const IRONMAN_SEASONS_BACK = 4
const IRONMAN_MIN_GAMES    = 10

// Eligibility thresholds, expressed as a fraction of the current league leader
// so they scale with season progress (in April, half of 20 games is 10).
const STREAK_MIN_GP_PCT = 0.5    // hitters: ~half your team's games
const STREAK_MIN_IP_PCT = 0.2    // pitchers: a fifth of the innings leader — keeps relievers in
const STREAK_MIN_GP      = 10    // floors, so opening week isn't wide open
const STREAK_MIN_IP      = 5

// Safety bound on game-log fetches. The nightly precompute (update-streaks.mjs)
// uses a much larger cap — it runs once on CI, where hundreds of fetches are
// fine. This lower cap only applies to the in-browser fallback below, which is
// a best-effort approximation; the precomputed board is the authoritative one.
const STREAK_CANDIDATES = 200

const streakCache = new Map<number, Promise<StreakLeaders>>()

export function fetchStreakLeaders(season: number): Promise<StreakLeaders> {
  if (!streakCache.has(season)) streakCache.set(season, loadStreakLeaders(season))
  return streakCache.get(season)!
}

// A GitHub Action precomputes the boards nightly (scripts/update-streaks.mjs →
// streak_leaders table, one jsonb row per season) so most visitors get one
// Supabase read instead of ~100 game-log fetches. Stale or missing rows fall
// back to the live computation below — keep the script's logic in sync with it.
const STREAK_STALE_MS = 48 * 3600 * 1000

async function loadStreakLeaders(season: number): Promise<StreakLeaders> {
  try {
    const { data } = await supabase
      .from('streak_leaders')
      .select('data, computed_at')
      .eq('season', season)
      .limit(1)
    const row = data?.[0]
    if (row?.data && Date.now() - new Date(row.computed_at).getTime() < STREAK_STALE_MS) {
      const stored = row.data as StreakLeaders
      if (stored.gamesPlayed) return stored
      // Row was written before the iron-man board existed. Keep the three cheap
      // precomputed boards and compute only the missing one, rather than
      // throwing away a good row and recomputing everything.
      return { ...stored, gamesPlayed: await computeGamesPlayedLeaders(season) }
    }
  } catch { /* table missing or unreachable — compute live */ }
  return computeStreakLeaders(season)
}

const streakMeta = (s: any): StreakRow => ({
  playerId: Number(s.player?.id),
  playerName: s.player?.fullName ?? '—',
  teamAbbr: s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
  teamId: Number(s.team?.id) || 0,
  value: 0,
})

/**
 * Build the iron-man board from candidates whose game logs are already loaded.
 *
 * Starts with the current season's schedule and only reaches back a year at a
 * time for the handful of players whose streak is still unbroken at the edge of
 * what's loaded, so a cross-season search costs one extra schedule request plus
 * a game log for those few players.
 */
async function computeGamesPlayedBoard(
  season: number,
  entries: { m: StreakRow; log: any[] }[],
): Promise<StreakRow[]> {
  const toPlayed = (log: any[]): PlayedGame[] =>
    log.map(s => ({ gamePk: Number(s.game?.gamePk) || 0, teamId: Number(s.team?.id) || 0 }))
       .filter(g => g.gamePk > 0 && g.teamId > 0)

  // Per-team spine, oldest game first. Older seasons are prepended as needed;
  // the cached per-season maps are never mutated.
  const byTeam = new Map<number, number[]>()
  const prependSeason = (older: Map<number, number[]>) => {
    for (const [tid, pks] of older) {
      const existing = byTeam.get(tid)
      byTeam.set(tid, existing ? [...pks, ...existing] : [...pks])
    }
  }

  prependSeason(await fetchSeasonSchedule(season))
  let index = buildScheduleIndex(byTeam)

  const state = entries.map(e => ({ m: e.m, played: toPlayed(e.log), games: 0, open: false }))
  const rewalk = () => {
    for (const s of state) {
      const r = walkGamesPlayedStreak(s.played, byTeam, index)
      s.games = r.games
      s.open  = r.open
    }
  }
  rewalk()

  for (let back = 1; back <= IRONMAN_SEASONS_BACK; back++) {
    const stillOpen = state.filter(s => s.open)
    if (stillOpen.length === 0) break
    const prev = season - back
    const [older, logs] = await Promise.all([
      fetchSeasonSchedule(prev),
      Promise.all(stillOpen.map(s => fetchGameLog(s.m.playerId, 'hitting', prev))),
    ])
    if (older.size === 0) break   // no schedule for that year, so stop here
    prependSeason(older)
    stillOpen.forEach((s, i) => { s.played = [...toPlayed(logs[i]), ...s.played] })
    // Prepending shifted every position, so everyone is rewalked, not just these.
    index = buildScheduleIndex(byTeam)
    rewalk()
  }

  return state
    .filter(s => s.games >= IRONMAN_MIN_GAMES)
    .map(s => ({ ...s.m, value: s.games, ...(s.open ? { capped: true } : {}) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)
}

// Used only when the precomputed row predates this board. A streak can never be
// longer than the games a player has appeared in this season, so ranking by that
// and taking the top slice bounds who can reach the top 25.
const IRONMAN_FALLBACK_CANDIDATES = 100

async function computeGamesPlayedLeaders(season: number): Promise<StreakRow[]> {
  const hitters = await fetchSeasonPlayerStats('hitting', season)
  const candidates = [...hitters]
    .filter(s => Number(s.player?.id) > 0 && Number(s.stat?.gamesPlayed ?? 0) >= IRONMAN_MIN_GAMES)
    .sort((a, b) => Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))
    .slice(0, IRONMAN_FALLBACK_CANDIDATES)
  const logs = await Promise.all(candidates.map(c =>
    fetchGameLog(Number(c.player.id), 'hitting', season).then(log => ({ m: streakMeta(c), log }))))
  return computeGamesPlayedBoard(season, logs)
}

async function computeStreakLeaders(season: number): Promise<StreakLeaders> {
  const meta = streakMeta

  const [hitters, pitchers] = await Promise.all([
    fetchSeasonPlayerStats('hitting', season),
    fetchSeasonPlayerStats('pitching', season),
  ])

  // Scale eligibility off the current leaders, so the same rule works in April
  // and in September.
  const maxGP = Math.max(...hitters.map(s => Number(s.stat?.gamesPlayed ?? 0)), 1)
  const maxIP = Math.max(...pitchers.map(s => parseFloat(s.stat?.inningsPitched ?? '0')), 1)
  const minGP = Math.max(STREAK_MIN_GP, Math.round(maxGP * STREAK_MIN_GP_PCT))
  const minIP = Math.max(STREAK_MIN_IP, maxIP * STREAK_MIN_IP_PCT)

  const hitCandidates = [...hitters]
    .filter(s => Number(s.stat?.atBats ?? 0) > 0 && Number(s.player?.id) > 0)
    .filter(s => Number(s.stat?.gamesPlayed ?? 0) >= minGP)
    .sort((a, b) => Number(b.stat?.gamesPlayed ?? 0) - Number(a.stat?.gamesPlayed ?? 0))
    .slice(0, STREAK_CANDIDATES)
  const pitchCandidates = [...pitchers]
    .filter(s => Number(s.player?.id) > 0)
    .filter(s => parseFloat(s.stat?.inningsPitched ?? '0') >= minIP)
    .sort((a, b) => parseFloat(b.stat?.inningsPitched ?? '0') - parseFloat(a.stat?.inningsPitched ?? '0'))
    .slice(0, STREAK_CANDIDATES)

  const [hitLogs, pitchLogs] = await Promise.all([
    Promise.all(hitCandidates.map(c => fetchGameLog(Number(c.player.id), 'hitting', season).then(log => ({ m: meta(c), log })))),
    Promise.all(pitchCandidates.map(c => fetchGameLog(Number(c.player.id), 'pitching', season).then(log => ({ m: meta(c), log })))),
  ])

  const hitting: StreakRow[] = []
  const hitless: StreakRow[] = []
  for (const { m, log } of hitLogs) {
    let mode: 'hit' | 'hitless' | null = null
    let games = 0   // consecutive games in the streak
    let pa = 0      // plate appearances accumulated across those games (for the hitless board)
    for (let i = log.length - 1; i >= 0; i--) {
      const ab = Number(log[i].stat?.atBats ?? 0)
      if (ab === 0) continue   // no official at-bat: never extends or breaks a streak
      const got = Number(log[i].stat?.hits ?? 0) > 0
      const gamePa = Number(log[i].stat?.plateAppearances ?? ab)
      if (mode === null) { mode = got ? 'hit' : 'hitless'; games = 1; pa = gamePa; continue }
      if ((got && mode === 'hit') || (!got && mode === 'hitless')) { games++; pa += gamePa }
      else break
    }
    // Hitting streaks are measured in games; hitless droughts in plate appearances.
    if (mode === 'hit' && games >= 2) hitting.push({ ...m, value: games })
    else if (mode === 'hitless' && games >= 2) hitless.push({ ...m, value: pa })
  }

  const scoreless: StreakRow[] = []
  for (const { m, log } of pitchLogs) {
    let outs = 0
    for (let i = log.length - 1; i >= 0; i--) {
      if (Number(log[i].stat?.runs ?? 0) === 0) outs += ipToOuts(log[i].stat?.inningsPitched)
      else break
    }
    if (outs >= 3) scoreless.push({ ...m, value: outs })   // at least one full scoreless inning
  }

  // Reuses the hitter game logs already in hand, so the only extra cost here is
  // the schedule request(s).
  const gamesPlayed = await computeGamesPlayedBoard(season, hitLogs)

  const byValue = (a: StreakRow, b: StreakRow) => b.value - a.value
  return {
    hitting: hitting.sort(byValue).slice(0, 25),
    hitless: hitless.sort(byValue).slice(0, 25),
    scoreless: scoreless.sort(byValue).slice(0, 25),
    gamesPlayed,
  }
}

// ─── Pitches per plate appearance (grinders vs. free swingers) ───────────────
// Who makes pitchers work and who swings at the first thing they see. Both boards
// come from one request against `playerPool=qualified` — MLB's own 3.1-PA-per-
// team-game cutoff, so a bench bat with 30 trips can't win either end. That pool is
// ~150 rows, far cheaper than filtering the cached 2000-player "All" payload, and
// it's the same qualification a fan would see on a league leaderboard.
//
// Unlike the streak boards this is a plain season rate, so it works for past
// seasons too (`numberOfPitches` goes back to the late-'80s).

export interface PitchPaRow {
  playerId: number
  playerName: string
  teamAbbr: string
  teamId: number
  value: number       // pitches seen per plate appearance
}

export interface PitchPaLeaders {
  most:   PitchPaRow[]   // grinders, longest at-bats first
  fewest: PitchPaRow[]   // free swingers, shortest at-bats first
  min:    number         // league-wide qualified range, so both boards can share
  max:    number         // one bar scale instead of each normalising to itself
}

const EMPTY_PITCH_PA: PitchPaLeaders = { most: [], fewest: [], min: 0, max: 0 }

const pitchPaCache = new Map<number, Promise<PitchPaLeaders>>()

export function fetchPitchesPerPa(season: number): Promise<PitchPaLeaders> {
  if (!pitchPaCache.has(season)) pitchPaCache.set(season, loadPitchesPerPa(season))
  return pitchPaCache.get(season)!
}

async function loadPitchesPerPa(season: number): Promise<PitchPaLeaders> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${season}` +
      `&sportId=1&limit=500&playerPool=qualified`
    )
    const d = await r.json()
    const rows: PitchPaRow[] = (d.stats?.[0]?.splits ?? [])
      .map((s: any): PitchPaRow => {
        const pa      = Number(s.stat?.plateAppearances ?? 0)
        const pitches = Number(s.stat?.numberOfPitches ?? 0)
        return {
          playerId:   Number(s.player?.id) || 0,
          playerName: s.player?.fullName ?? '—',
          teamAbbr:   s.team?.abbreviation ?? TEAM_ABBR[s.team?.id] ?? '—',
          teamId:     Number(s.team?.id) || 0,
          value:      pa > 0 ? pitches / pa : 0,
        }
      })
      .filter((row: PitchPaRow) => row.playerId > 0 && row.value > 0)

    if (rows.length === 0) return EMPTY_PITCH_PA

    const desc = rows.sort((a, b) => b.value - a.value)
    return {
      most:   desc.slice(0, 25),
      fewest: [...desc].reverse().slice(0, 25),
      min:    desc[desc.length - 1].value,
      max:    desc[0].value,
    }
  } catch { return EMPTY_PITCH_PA }
}
