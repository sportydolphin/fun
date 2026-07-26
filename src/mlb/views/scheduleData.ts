import { TEAM_ABBR } from '../constants'
import { PreviewGame } from './GamePreview'

// Data layer for the team schedule strip: types, StatsAPI fetches, and the small
// date/name formatters shared across the strip's card components. Split out of
// ScheduleStrip.tsx (July 2026) to keep that file focused on the UI.

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function chipDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${day}`
}

// Today / Yesterday / Tomorrow when close by, otherwise the plain "Mon D" date —
// used where the opponent is already shown via logos, so the date line doesn't
// need to repeat it.
export function relativeChipDate(d: string) {
  const toISO = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const today = new Date()
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1)
  const tom   = new Date(today); tom.setDate(tom.getDate() + 1)
  if (d === toISO(today)) return 'Today'
  if (d === toISO(yest))  return 'Yesterday'
  if (d === toISO(tom))   return 'Tomorrow'
  return chipDate(d)
}

export function shortName(name: string) {
  const parts = name.trim().split(' ')
  return parts.length <= 1 ? name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// Cap the two-half (away | home) rows so the second team/pitcher sits close to the
// first instead of spreading to ~50% of the wide My-Feed column. Shared by the score
// row, performer row, and pitcher row so their logos stay vertically aligned.
export const COMPACT_ROW_MAX = 240

export function formatIP(ip: string): string {
  if (!ip || ip === '—') return '?'
  const [w = '0', f = '0'] = ip.split('.')
  if (f === '0' || f === '') return w
  if (f === '1') return `${w}⅓`
  if (f === '2') return `${w}⅔`
  return ip
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleGame {
  gamePk:        number
  date:          string
  gameTime:      string
  gameDateISO:   string | null
  isHome:        boolean
  opponentId:    number
  opponentAbbr:  string
  state:         'final' | 'live' | 'preview' | 'postponed'
  teamScore:     number | null
  opponentScore: number | null
  isWin:         boolean | null
  gameNumber:    number    // 1, or 2 for the nightcap of a doubleheader
}

export interface ProbablePitcher {
  id:     number
  name:   string
  era:    string
  wins:   number
  losses: number
  hand:   string
  ip:     string
}

export interface GamePreviewData {
  venue:       string
  weatherDesc: string
  home: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
  away: { teamId: number; abbr: string; pitcher: ProbablePitcher | null }
}

export interface GameFinalDetails {
  winnerPitcher: { id: number; name: string; ip: string; er: number; teamId: number } | null
  loserPitcher:  { id: number; name: string; ip: string; er: number; teamId: number } | null
}

export interface LiveGameData {
  currentInning:        number | null
  currentInningOrdinal: string | null
  inningHalf:           'top' | 'bottom' | null
  inningState:          string | null   // "Top" | "Middle" | "Bottom" | "End" — "Middle"/"End" = between innings
  outs:                 number | null
  balls:                number | null
  strikes:              number | null
  batter:               { id: number; name: string; line: string | null } | null
  pitcher:              { id: number; name: string; line: string | null } | null
  onFirst:              boolean
  onSecond:             boolean
  onThird:              boolean
  homeRuns:             number | null
  awayRuns:             number | null
  homeHits:             number | null
  awayHits:             number | null
}

// Adapt a team-centric ScheduleGame into the shared PreviewGame shape so the schedule
// surfaces render the exact same preview card as the scoreboard (which fetches its own
// probable-starter data by gamePk).
export function scheduleGameToPreview(g: ScheduleGame, myTeamId: number): PreviewGame {
  const mine = { teamId: myTeamId,     abbr: TEAM_ABBR[myTeamId] ?? '?' }
  const opp  = { teamId: g.opponentId, abbr: g.opponentAbbr }
  return {
    gamePk:     g.gamePk,
    statusText: g.state === 'postponed' ? 'Postponed' : `${chipDate(g.date)} · ${g.gameTime}`,
    away: g.isHome ? opp : mine,
    home: g.isHome ? mine : opp,
  }
}

// ─── Schedule fetch ───────────────────────────────────────────────────────────

export async function fetchTeamSchedule(teamId: number): Promise<ScheduleGame[]> {
  const today = new Date()
  const start = new Date(today); start.setDate(start.getDate() - 14)
  const end   = new Date(today); end.setDate(end.getDate() + 21)
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1` +
    `&startDate=${toISO(start)}&endDate=${toISO(end)}&gameType=R` +
    `&fields=dates,date,games,gamePk,gameDate,gameNumber,status,abstractGameState,detailedState,teams,home,away,team,id,score,isWinner`
  )
  const d = await r.json()

  const games: ScheduleGame[] = []
  for (const dateObj of d.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const isHome = Number(game.teams?.home?.team?.id) === teamId
      const opp    = isHome ? game.teams.away : game.teams.home
      const mine   = isHome ? game.teams.home : game.teams.away
      const raw      = game.status?.abstractGameState ?? 'Preview'
      const detailed = game.status?.detailedState ?? ''
      // StatsAPI flips abstractGameState to "Live" during warmup (~20 min before
      // first pitch); only "In Progress" is really live.
      const state    = detailed === 'Postponed' ? 'postponed'
                     : raw === 'Final'          ? 'final'
                     : raw === 'Live' && detailed !== 'Warmup' ? 'live'
                     : 'preview'
      games.push({
        gamePk:        game.gamePk,
        date:          dateObj.date,
        gameTime:      game.gameDate ? new Date(game.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
        gameDateISO:   game.gameDate ?? null,
        isHome,
        opponentId:    Number(opp?.team?.id ?? 0),
        opponentAbbr:  TEAM_ABBR[Number(opp?.team?.id ?? 0)] ?? '???',
        state:         state as ScheduleGame['state'],
        teamScore:     state !== 'preview' ? Number(mine?.score ?? 0) : null,
        opponentScore: state !== 'preview' ? Number(opp?.score  ?? 0) : null,
        isWin:         state === 'final' ? Boolean(mine?.isWinner) : null,
        gameNumber:    Number(game.gameNumber ?? 1),
      })
    }
  }
  // Doubleheaders share a date, so game number breaks the tie — the strip and the
  // team card both rely on this list being in true chronological order.
  return games.sort((a, b) => a.date.localeCompare(b.date) || a.gameNumber - b.gameNumber)
}

// ─── Doubleheader helpers ─────────────────────────────────────────────────────
// Every slot in the team card (last / today / upcoming) holds a *day*, not a
// game, so a doubleheader shows both games instead of silently dropping one.

/** All games on the same date as `date`, in game-number order. */
export function gamesOnDate(games: ScheduleGame[], date: string): ScheduleGame[] {
  return games.filter(g => g.date === date)
}

/** "GM 1" / "GM 2" badge — only when the day actually has more than one game. */
export function gmLabel(day: ScheduleGame[], g: ScheduleGame): string | undefined {
  return day.length > 1 ? `GM ${g.gameNumber}` : undefined
}

// ─── Game preview fetch ───────────────────────────────────────────────────────

export async function fetchGamePreview(gamePk: number): Promise<GamePreviewData | null> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?gamePk=${gamePk}` +
      `&hydrate=probablePitcher,venue,weather`
    )
    const d = await r.json()
    const game = d.dates?.[0]?.games?.[0]
    if (!game) return null

    const ht = game.teams?.home
    const at = game.teams?.away

    const homePitcherId = ht?.probablePitcher?.id ? Number(ht.probablePitcher.id) : null
    const awayPitcherId = at?.probablePitcher?.id ? Number(at.probablePitcher.id) : null
    const pitcherIds = [homePitcherId, awayPitcherId].filter((x): x is number => x !== null)

    type PitcherDetails = { hand: string; era: string; ip: string; wins: number; losses: number }
    const pitcherMap: Record<number, PitcherDetails> = {}
    if (pitcherIds.length > 0) {
      try {
        const season = new Date().getFullYear()
        const pr = await fetch(
          `https://statsapi.mlb.com/api/v1/people?personIds=${pitcherIds.join(',')}` +
          `&hydrate=stats(group=pitching,type=season,season=${season})`
        )
        const pd = await pr.json()
        for (const p of pd.people ?? []) {
          const grp  = (p.stats ?? []).find((s: any) => s.group?.displayName === 'pitching')
          const stat = grp?.splits?.[0]?.stat ?? {}
          pitcherMap[Number(p.id)] = {
            hand:   p.pitchHand?.code        ?? '?',
            era:    stat.era                 ?? '—',
            ip:     stat.inningsPitched      ?? '—',
            wins:   Number(stat.wins   ?? 0),
            losses: Number(stat.losses ?? 0),
          }
        }
      } catch { /* non-fatal */ }
    }

    const parsePitcher = (side: any): ProbablePitcher | null => {
      const p = side?.probablePitcher
      if (!p) return null
      const det = pitcherMap[Number(p.id)]
      return {
        id:     Number(p.id),
        name:   p.fullName   ?? '—',
        era:    det?.era     ?? '—',
        ip:     det?.ip      ?? '—',
        wins:   det?.wins    ?? 0,
        losses: det?.losses  ?? 0,
        hand:   det?.hand    ?? '?',
      }
    }

    const w = game.weather
    const weatherDesc = w
      ? [w.condition, w.temp ? `${w.temp}°F` : null, w.wind || null].filter(Boolean).join(' · ')
      : ''

    return {
      venue:       game.venue?.name ?? '',
      weatherDesc,
      home: { teamId: Number(ht?.team?.id ?? 0), abbr: TEAM_ABBR[Number(ht?.team?.id ?? 0)] ?? '?', pitcher: parsePitcher(ht) },
      away: { teamId: Number(at?.team?.id ?? 0), abbr: TEAM_ABBR[Number(at?.team?.id ?? 0)] ?? '?', pitcher: parsePitcher(at) },
    }
  } catch { return null }
}

// ─── Final game box-score fetch ───────────────────────────────────────────────

export async function fetchGameFinalDetails(gamePk: number, _myTeamId: number): Promise<GameFinalDetails | null> {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
    const d = await r.json()

    const decisions = d.decisions ?? {}
    const winnerId  = decisions.winner?.id ? Number(decisions.winner.id) : null
    const homeId    = Number(d.teams?.home?.team?.id ?? 0)
    const awayId    = Number(d.teams?.away?.team?.id ?? 0)

    const findTopPitcher = (side: 'home' | 'away') => {
      const sideData    = d.teams?.[side]
      const sidePlayers = sideData?.players ?? {}
      const teamId      = side === 'home' ? homeId : awayId
      let best: GameFinalDetails['winnerPitcher'] = null
      let maxOuts = 0
      for (const pitcherId of (sideData?.pitchers ?? []) as number[]) {
        const p = sidePlayers[`ID${pitcherId}`]
        if (!p) continue
        const s     = p.stats?.pitching ?? {}
        const ipStr = String(s.inningsPitched ?? '0')
        const [w = '0', f = '0'] = ipStr.split('.')
        const outs  = Number(w) * 3 + Number(f)
        if (outs > maxOuts) {
          maxOuts = outs
          best = { id: pitcherId, name: p.person?.fullName ?? '—', ip: ipStr, er: Number(s.earnedRuns ?? 0), teamId }
        }
      }
      return best
    }

    const homePitcher = findTopPitcher('home')
    const awayPitcher = findTopPitcher('away')

    // Determine winning side from the decision pitcher; fall back to score
    const homeWon = winnerId
      ? !!d.teams?.home?.players?.[`ID${winnerId}`]
      : (d.teams?.home?.teamStats?.batting?.runs ?? 0) > (d.teams?.away?.teamStats?.batting?.runs ?? 0)

    return {
      winnerPitcher: homeWon ? homePitcher : awayPitcher,
      loserPitcher:  homeWon ? awayPitcher : homePitcher,
    }
  } catch { return null }
}

// ─── Live game fetch ──────────────────────────────────────────────────────────

export async function fetchLiveGameData(gamePk: number): Promise<LiveGameData | null> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live` +
      `?fields=liveData,linescore,currentInning,currentInningOrdinal,inningHalf,inningState,outs,balls,strikes,offense,defense,batter,pitcher,first,second,third,id,fullName,teams,home,away,runs,` +
      `boxscore,players,stats,batting,pitching,atBats,hits,rbi,homeRuns,inningsPitched,numberOfPitches`
    )
    const d = await r.json()
    const ls = d.liveData?.linescore
    if (!ls) return null
    const half = String(ls.inningHalf ?? '').toLowerCase()
    const off  = ls.offense ?? {}
    const def  = ls.defense ?? {}

    const boxTeams  = d.liveData?.boxscore?.teams
    const findStats = (id: number | undefined) => {
      if (!id) return null
      const key = `ID${id}`
      return boxTeams?.away?.players?.[key]?.stats ?? boxTeams?.home?.players?.[key]?.stats ?? null
    }
    const pitcherLine = (id: number | undefined) => {
      const s = findStats(id)?.pitching
      if (!s) return null
      return `${s.inningsPitched ?? '0.0'} IP · ${s.numberOfPitches ?? 0} P`
    }
    const batterLine = (id: number | undefined) => {
      const s = findStats(id)?.batting
      if (!s) return null
      const parts = [`${s.hits ?? 0}-${s.atBats ?? 0}`]
      if (s.homeRuns) parts.push(`${s.homeRuns} HR`)
      if (s.rbi)      parts.push(`${s.rbi} RBI`)
      return parts.join(', ')
    }
    const pp = (p: any, line: string | null) => p?.id ? { id: Number(p.id), name: String(p.fullName ?? p.id), line } : null

    return {
      currentInning:        ls.currentInning        ?? null,
      currentInningOrdinal: ls.currentInningOrdinal ?? null,
      inningHalf:           half === 'top' ? 'top' : half === 'bottom' ? 'bottom' : null,
      inningState:          String(ls.inningState ?? '') || null,
      outs:                 ls.outs                 ?? null,
      balls:                ls.balls                ?? null,
      strikes:              ls.strikes              ?? null,
      batter:               pp(off.batter, batterLine(off.batter?.id)),
      pitcher:              pp(def.pitcher, pitcherLine(def.pitcher?.id)),
      onFirst:              Boolean(off.first),
      onSecond:             Boolean(off.second),
      onThird:              Boolean(off.third),
      homeRuns:             ls.teams?.home?.runs    ?? null,
      awayRuns:             ls.teams?.away?.runs    ?? null,
      homeHits:             ls.teams?.home?.hits    ?? null,
      awayHits:             ls.teams?.away?.hits    ?? null,
    }
  } catch { return null }
}
