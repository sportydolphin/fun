// ─── Live drama detection ─────────────────────────────────────────────────────
// Scans today's live games for moments worth interrupting the home page for:
//
//   • No-hitter watch — a team still hitless after 5 complete innings batting
//     (upgraded to "Perfect game" when the boxscore confirms zero baserunners)
//   • Walk-off watch — bottom of the 9th or later, home team tied or with the
//     winning run reachable in one swing
//   • Cycle watch — a batter three legs into the cycle (or done with it)
//   • Free baseball — any game that reaches the 11th inning
//
// One schedule+linescore call covers every live game; boxscores are fetched only
// for games that need a deeper look (no-hit candidates + cycle scans from the
// 4th on). The event *builders* are exported separately so devDrama.ts can
// fabricate events that render identically to real ones.

import { TEAM_ABBR, TEAM_NICKNAME } from '../constants'

export type DramaKind = 'perfect' | 'nohitter' | 'walkoff' | 'cycle' | 'marathon'

export interface DramaSide {
  id:    number
  abbr:  string
  score: number
  hits:  number
}

export interface DramaEvent {
  id:           string        // stable per moment, e.g. "775432-nohitter-away"
  kind:         DramaKind
  gamePk:       number
  inning:       number
  half:         'top' | 'bottom'
  away:         DramaSide
  home:         DramaSide
  accentTeamId: number        // the team doing the dramatic thing
  headline:     string
  detail:       string
  severity:     number        // higher = more dramatic; card sorts by this
}

export function ord(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

const scoreline = (away: DramaSide, home: DramaSide) =>
  `${away.abbr} ${away.score}–${home.score} ${home.abbr}`

// ─── Event builders (shared with the dev simulator) ──────────────────────────

export function makeNoHitEvent(p: {
  gamePk: number; inning: number; half: 'top' | 'bottom'
  away: DramaSide; home: DramaSide
  hitlessSide: 'away' | 'home'
  through: number               // complete hitless innings
  pitcherName: string | null    // null = combined effort
  perfect: boolean
}): DramaEvent {
  const hitless  = p.hitlessSide === 'away' ? p.away : p.home
  const pitching = p.hitlessSide === 'away' ? p.home : p.away
  const who      = p.pitcherName ?? `${pitching.abbr}'s staff`
  const nickname = TEAM_NICKNAME[hitless.id] ?? hitless.abbr
  return {
    id: `${p.gamePk}-nohitter-${p.hitlessSide}`,
    kind: p.perfect ? 'perfect' : 'nohitter',
    gamePk: p.gamePk, inning: p.inning, half: p.half,
    away: p.away, home: p.home,
    accentTeamId: pitching.id,
    headline: p.perfect ? `Perfect game through ${p.through}` : `No-hitter through ${p.through}`,
    detail: p.perfect
      ? `${who} has retired all ${p.through * 3} ${nickname} batters · ${scoreline(p.away, p.home)}`
      : `${who} has the ${nickname} hitless · ${scoreline(p.away, p.home)}`,
    severity: (p.perfect ? 95 : 80) + p.through,
  }
}

export function makeWalkoffEvent(p: {
  gamePk: number; inning: number
  away: DramaSide; home: DramaSide
}): DramaEvent {
  const deficit  = p.away.score - p.home.score
  const nickname = TEAM_NICKNAME[p.home.id] ?? p.home.abbr
  return {
    id: `${p.gamePk}-walkoff`,
    kind: 'walkoff',
    gamePk: p.gamePk, inning: p.inning, half: 'bottom',
    away: p.away, home: p.home,
    accentTeamId: p.home.id,
    headline: 'Walk-off watch',
    detail: deficit === 0
      ? `${nickname} batting in the bottom ${ord(p.inning)}, tied ${p.home.score}–${p.away.score} — next run wins it`
      : `${nickname} down ${deficit} in the bottom ${ord(p.inning)} — one swing can end it`,
    severity: 70 + (deficit === 0 ? 5 : 0) + (p.inning > 9 ? 3 : 0),
  }
}

const LEG_LABEL: Record<string, string> = {
  single: 'a single', double: 'a double', triple: 'a triple', homer: 'a home run',
}

export function makeCycleEvent(p: {
  gamePk: number; inning: number; half: 'top' | 'bottom'
  away: DramaSide; home: DramaSide
  playerName: string; teamId: number
  complete: boolean
  missing?: 'single' | 'double' | 'triple' | 'homer'
}): DramaEvent {
  return {
    id: `${p.gamePk}-cycle-${p.playerName}`,
    kind: 'cycle',
    gamePk: p.gamePk, inning: p.inning, half: p.half,
    away: p.away, home: p.home,
    accentTeamId: p.teamId,
    headline: p.complete ? `${p.playerName} hit for the cycle!` : `Cycle watch: ${p.playerName}`,
    detail: p.complete
      ? `Single, double, triple, homer — the full set · ${scoreline(p.away, p.home)}`
      : `${LEG_LABEL[p.missing ?? 'triple']} away from the cycle · ${scoreline(p.away, p.home)}`,
    severity: p.complete ? 65 : 55,
  }
}

export function makeMarathonEvent(p: {
  gamePk: number; inning: number; half: 'top' | 'bottom'
  away: DramaSide; home: DramaSide
}): DramaEvent {
  return {
    id: `${p.gamePk}-marathon`,
    kind: 'marathon',
    gamePk: p.gamePk, inning: p.inning, half: p.half,
    away: p.away, home: p.home,
    accentTeamId: p.home.id,
    headline: `${p.inning >= 15 ? 'Marathon' : 'Free baseball'} — ${ord(p.inning)} inning`,
    detail: `${scoreline(p.away, p.home)} and still going`,
    severity: 40 + p.inning,
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────

interface LiveGame {
  gamePk:  number
  inning:  number
  half:    string          // Top | Middle | Bottom | End (raw from linescore)
  away:    DramaSide & { errors: number }
  home:    DramaSide & { errors: number }
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// How many innings a side has COMPLETED batting, given the current inning/half.
function completedBattingInnings(side: 'away' | 'home', inning: number, half: string): number {
  if (side === 'away') return (inning - 1) + (half !== 'Top' ? 1 : 0)
  return (inning - 1) + (half === 'End' ? 1 : 0)
}

async function fetchLiveGames(): Promise<LiveGame[]> {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${localYmd(new Date())}` +
    `&hydrate=linescore` +
    `&fields=dates,games,gamePk,status,abstractGameState,detailedState,teams,home,away,team,id,score,` +
    `linescore,currentInning,inningHalf,runs,hits,errors`
  )
  const d = await r.json()
  const out: LiveGame[] = []
  for (const dateObj of d.dates ?? []) {
    for (const g of dateObj.games ?? []) {
      // Warmup reports abstractGameState "Live" ~20 min before first pitch — skip it.
      if (g.status?.abstractGameState !== 'Live' || g.status?.detailedState === 'Warmup') continue
      const ls = g.linescore
      if (!ls?.currentInning) continue
      const side = (s: 'away' | 'home') => {
        const id = Number(g.teams?.[s]?.team?.id ?? 0)
        return {
          id, abbr: TEAM_ABBR[id] ?? '?',
          score:  Number(ls.teams?.[s]?.runs ?? g.teams?.[s]?.score ?? 0),
          hits:   Number(ls.teams?.[s]?.hits ?? 0),
          errors: Number(ls.teams?.[s]?.errors ?? 0),
        }
      }
      out.push({
        gamePk: Number(g.gamePk),
        inning: Number(ls.currentInning),
        half:   String(ls.inningHalf ?? 'Top'),
        away:   side('away'),
        home:   side('home'),
      })
    }
  }
  return out
}

// Trimmed boxscore — enough for the perfect-game check, pitcher names, and the
// cycle scan. Fetched only for games that need it.
function fetchDramaBoxscore(gamePk: number): Promise<any | null> {
  return fetch(
    `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore` +
    `?fields=teams,away,home,teamStats,batting,baseOnBalls,hitByPitch,hits,doubles,triples,homeRuns,` +
    `players,person,id,fullName,stats,pitchers`
  ).then(r => r.json()).catch(() => null)
}

const displayHalf = (half: string): 'top' | 'bottom' => half === 'Top' ? 'top' : 'bottom'

async function detectGame(g: LiveGame): Promise<DramaEvent[]> {
  const events: DramaEvent[] = []
  const half = displayHalf(g.half)

  // Which deep checks does this game need?
  const noHitSides = (['away', 'home'] as const).filter(s =>
    g[s].hits === 0 && completedBattingInnings(s, g.inning, g.half) >= 5)
  const wantsCycleScan = g.inning >= 4
  const box = (noHitSides.length > 0 || wantsCycleScan) ? await fetchDramaBoxscore(g.gamePk) : null

  // No-hitter / perfect game
  for (const s of noHitSides) {
    const pitchSide = s === 'away' ? 'home' : 'away'
    const batting = box?.teams?.[s]?.teamStats?.batting
    const perfect = !!batting &&
      Number(batting.baseOnBalls ?? 1) === 0 &&
      Number(batting.hitByPitch ?? 1) === 0 &&
      g[pitchSide].errors === 0
    const pitcherIds: number[] = box?.teams?.[pitchSide]?.pitchers ?? []
    const pitcherName = pitcherIds.length === 1
      ? box?.teams?.[pitchSide]?.players?.[`ID${pitcherIds[0]}`]?.person?.fullName ?? null
      : null
    events.push(makeNoHitEvent({
      gamePk: g.gamePk, inning: g.inning, half,
      away: g.away, home: g.home,
      hitlessSide: s,
      through: completedBattingInnings(s, g.inning, g.half),
      pitcherName, perfect,
    }))
  }

  // Cycle watch — either side, any batter with 3+ legs
  if (box && wantsCycleScan) {
    for (const s of ['away', 'home'] as const) {
      const players = box.teams?.[s]?.players ?? {}
      for (const key of Object.keys(players)) {
        const b = players[key]?.stats?.batting
        if (!b || !Number(b.hits)) continue
        const doubles = Number(b.doubles ?? 0), triples = Number(b.triples ?? 0), homers = Number(b.homeRuns ?? 0)
        const singles = Number(b.hits) - doubles - triples - homers
        const legs = [singles, doubles, triples, homers].filter(n => n > 0).length
        const complete = legs === 4
        if (legs < 3) continue
        if (!complete && g.inning > 8) continue   // late innings: another at-bat is unlikely
        const missing = (['single', 'double', 'triple', 'homer'] as const)
          [[singles, doubles, triples, homers].findIndex(n => n === 0)]
        events.push(makeCycleEvent({
          gamePk: g.gamePk, inning: g.inning, half,
          away: g.away, home: g.home,
          playerName: players[key]?.person?.fullName ?? '—',
          teamId: g[s].id,
          complete, missing: complete ? undefined : missing,
        }))
      }
    }
  }

  // Walk-off watch — bottom (or about to be bottom) of the 9th+, home not ahead
  if (g.inning >= 9 && (g.half === 'Bottom' || g.half === 'Middle') && g.home.score <= g.away.score) {
    const deficit = g.away.score - g.home.score
    let inReach = deficit <= 1
    if (!inReach && deficit <= 3 && g.half === 'Bottom') {
      // Down 2–3: only a walk-off if one swing can end it (winning run on base)
      try {
        const ls = await fetch(
          `https://statsapi.mlb.com/api/v1/game/${g.gamePk}/linescore?fields=offense,first,second,third,id`
        ).then(r => r.json())
        const runners = ['first', 'second', 'third'].filter(b => ls?.offense?.[b]?.id).length
        inReach = deficit <= runners + 1
      } catch { /* runners unknown — stay conservative */ }
    }
    if (inReach) {
      events.push(makeWalkoffEvent({ gamePk: g.gamePk, inning: g.inning, away: g.away, home: g.home }))
    }
  }

  // Free baseball — 11th inning on; redundant when a walk-off row exists for the game
  if (g.inning >= 11 && !events.some(e => e.kind === 'walkoff')) {
    events.push(makeMarathonEvent({ gamePk: g.gamePk, inning: g.inning, half, away: g.away, home: g.home }))
  }

  return events
}

export async function fetchLiveDrama(): Promise<DramaEvent[]> {
  try {
    const games = await fetchLiveGames()
    const perGame = await Promise.all(games.map(g => detectGame(g).catch(() => [])))
    return perGame.flat().sort((a, b) => b.severity - a.severity)
  } catch {
    return []
  }
}
