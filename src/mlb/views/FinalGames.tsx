import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, TEAM_ABBR, TEAM_DIVISION, HEADSHOT, CURRENT_SEASON } from '../constants'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, defaultBorder } from '../colorUtils'
import { getHomeOverlay, setHomeOverlay, clearOverlayIf, stampOverlay } from '../homeOverlay'

// Loaded on first game click — keeps the Game Center out of the home bundle.
const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))

// ─── Types ────────────────────────────────────────────────────────────────────

type GameState = 'live' | 'final' | 'preview'

export interface FinalTeam {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  isWinner: boolean
}

export interface FinalGameSummary {
  gamePk:     number
  state:      GameState
  statusText: string                 // "Final"/"Final/10", live inning ("▲ 5th"), or start time
  home:       FinalTeam
  away:       FinalTeam
  winPitcher:  string | null
  losePitcher: string | null
  savePitcher: string | null
}

// Per-inning + R/H/E line score plus full batting / pitching tables.
interface InningLine { num: number; away: number | null; home: number | null }

interface BatterLine {
  id:    number
  name:  string
  pos:   string
  ab:    number
  r:     number
  h:     number
  rbi:   number
  bb:    number
  k:     number
  avg:   string
  isSub: boolean
}

interface PitcherLine {
  id:      number
  name:    string
  note:    string | null   // "(W, 10-6)", "(S, 28)", etc.
  ip:      string
  h:       number
  r:       number
  er:      number
  bb:      number
  k:       number
  pitches: number | null   // pitch count for the game
  era:     string | null    // season ERA when available
}

interface TeamBox {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  batters:  BatterLine[]
  pitchers: PitcherLine[]
}

export interface BoxScore {
  innings: InningLine[]
  away:    TeamBox
  home:    TeamBox
}

// ─── Game preview types ───────────────────────────────────────────────────────

interface ProbablePitcher {
  id:     number
  name:   string
  hand:   string          // 'R' | 'L' | 'S' | '?'
  era:    string | null
  wins:   number
  losses: number
  whip:   string | null
  k:      number
  ip:     string | null
}

interface GamePreviewData {
  venueName:    string
  weather:      { condition: string; temp: string; wind: string } | null
  awayPitcher:  ProbablePitcher | null
  homePitcher:  ProbablePitcher | null
}

// ─── Date helpers (local, not UTC — avoids evening off-by-one) ──────────────────

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateLabel(iso: string): string {
  const todayISO = toISO(new Date())
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  const tom  = new Date(); tom.setDate(tom.getDate() + 1)
  if (iso === todayISO)        return 'Today'
  if (iso === toISO(yest))     return 'Yesterday'
  if (iso === toISO(tom))      return 'Tomorrow'
  return fromISO(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// Game types we treat as "real" games on the scoreboard: regular + postseason.
const SCORED_GAME_TYPES = new Set(['R', 'F', 'D', 'L', 'W'])

// ─── API ────────────────────────────────────────────────────────────────────

// In-memory cache of resolved games per date. Past/future dates are static
// (a Final result never changes, a Preview's start time rarely does) so once
// fetched they're safe to reuse for the rest of the session — this is what
// makes date-nav feel instant after the first visit to a date. "Today" is
// deliberately never cached since a live game's score/inning keeps changing.
const gamesCache = new Map<string, FinalGameSummary[]>()

function parseScheduleDateGames(dateObj: any): FinalGameSummary[] {
  const out: FinalGameSummary[] = []
  for (const game of dateObj.games ?? []) {
    if (!SCORED_GAME_TYPES.has(game.gameType)) continue
    const abs      = game.status?.abstractGameState
    const detState = game.status?.detailedState ?? ''
    // "Live" during Warmup (~20 min pre-first-pitch) isn't really live yet.
    const state: GameState = abs === 'Final' ? 'final'
      : abs === 'Live' && detState !== 'Warmup' ? 'live'
      : 'preview'
    const ls    = game.linescore ?? {}

    const mkTeam = (side: 'home' | 'away'): FinalTeam => {
      const t   = game.teams?.[side]
      const lst = ls.teams?.[side] ?? {}
      const id  = Number(t?.team?.id ?? 0)
      return {
        teamId:   id,
        abbr:     TEAM_ABBR[id] ?? t?.team?.abbreviation ?? '???',
        name:     t?.team?.name ?? '???',
        runs:     lst.runs   ?? t?.score ?? 0,
        hits:     lst.hits   ?? 0,
        errors:   lst.errors ?? 0,
        isWinner: Boolean(t?.isWinner),
      }
    }

    let statusText: string
    if (state === 'final') {
      // Extra innings → "Final/10". scheduledInnings defaults to 9.
      const scheduled = ls.scheduledInnings ?? 9
      const played    = ls.currentInning ?? scheduled
      statusText = played > scheduled ? `Final/${played}` : 'Final'
    } else if (state === 'live') {
      const ord  = ls.currentInningOrdinal
      const half = ls.inningHalf as string | undefined
      if (ord) {
        const arrow = half === 'Bottom' || half === 'End' ? '▼' : '▲'
        statusText = `${arrow} ${ord}`
      } else {
        statusText = game.status?.detailedState ?? 'Live'
      }
    } else {
      // Preview / scheduled — show start time, or a notable status (Postponed, etc.)
      const detailed = game.status?.detailedState ?? ''
      if (detailed && !['Scheduled', 'Pre-Game', 'Warmup'].includes(detailed)) {
        statusText = detailed
      } else {
        const dt = game.gameDate ? new Date(game.gameDate) : null
        statusText = dt ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TBD'
      }
    }

    out.push({
      gamePk:     game.gamePk,
      state,
      statusText,
      home:       mkTeam('home'),
      away:       mkTeam('away'),
      winPitcher:  game.decisions?.winner?.fullName ?? null,
      losePitcher: game.decisions?.loser?.fullName  ?? null,
      savePitcher: game.decisions?.save?.fullName    ?? null,
    })
  }
  return out
}

export async function fetchFinalGames(dateISO: string): Promise<FinalGameSummary[]> {
  const cacheable = dateISO !== toISO(new Date())
  if (cacheable) {
    const cached = gamesCache.get(dateISO)
    if (cached) return cached
  }
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateISO}` +
      `&hydrate=linescore,decisions`
    )
    const d = await r.json()
    const out: FinalGameSummary[] = []
    for (const dateObj of d.dates ?? []) out.push(...parseScheduleDateGames(dateObj))
    if (cacheable) gamesCache.set(dateISO, out)
    return out
  } catch { return [] }
}

// Fetches a whole date range in one request and primes gamesCache with every
// date in it (again skipping "today", for the same live-score reason as
// above) — this is what lets date-nav resolve the target date's games from
// cache instead of a second round trip after jumping.
async function primeGamesCache(startISO: string, endISO: string): Promise<Map<string, FinalGameSummary[]>> {
  const map = new Map<string, FinalGameSummary[]>()
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startISO}&endDate=${endISO}` +
      `&hydrate=linescore,decisions`
    )
    const d = await r.json()
    const today = toISO(new Date())
    for (const dateObj of d.dates ?? []) {
      const iso   = dateObj.date as string
      const games = parseScheduleDateGames(dateObj)
      map.set(iso, games)
      if (games.length > 0 && iso !== today) gamesCache.set(iso, games)
    }
  } catch { /* best-effort — findAdjacentGameDate just sees an empty map */ }
  return map
}

function pickNearestGameDate(map: Map<string, FinalGameSummary[]>, dir: 1 | -1): string | null {
  const dates = [...map.entries()].filter(([, g]) => g.length > 0).map(([iso]) => iso).sort()
  if (dates.length === 0) return null
  return dir === 1 ? dates[0] : dates[dates.length - 1]
}

// ─── Season bounds (clamps date-nav to the actual season) ──────────────────────

interface SeasonBounds { start: string; end: string }
const seasonBoundsCache = new Map<number, Promise<SeasonBounds>>()

function fetchSeasonBounds(season: number): Promise<SeasonBounds> {
  let p = seasonBoundsCache.get(season)
  if (p) return p
  p = fetch(`https://statsapi.mlb.com/api/v1/seasons/${season}?sportId=1`)
    .then(r => r.json())
    .then(d => {
      const s = d.seasons?.[0]
      return {
        start: String(s?.regularSeasonStartDate ?? s?.seasonStartDate ?? `${season}-03-01`).slice(0, 10),
        end:   String(s?.postSeasonEndDate ?? s?.seasonEndDate ?? `${season}-11-30`).slice(0, 10),
      }
    })
    .catch(() => ({ start: `${season}-03-01`, end: `${season}-11-30` }))
  seasonBoundsCache.set(season, p)
  return p
}

const clampISO = (iso: string, bounds: SeasonBounds) =>
  iso < bounds.start ? bounds.start : iso > bounds.end ? bounds.end : iso

// A ~month-wide window comfortably covers any real in-season gap (All-Star
// break, a playoff off-day) in a single request, while also priming the
// cache for that whole stretch — so stepping through several dates in a row
// after the first click costs no further network calls.
const NAV_WINDOW_DAYS = 30

// Nearest date with a scored game past `fromDateISO` in the given direction,
// clamped to the season bounds. Returning null past a bound is what keeps
// date-nav from wandering outside the season.
async function findAdjacentGameDate(fromDateISO: string, dir: 1 | -1, season: number): Promise<string | null> {
  const bounds = await fetchSeasonBounds(season)
  const probeDate = fromISO(fromDateISO)
  probeDate.setDate(probeDate.getDate() + dir)
  const probe = toISO(probeDate)

  const edgeDate = fromISO(probe)
  edgeDate.setDate(edgeDate.getDate() + dir * NAV_WINDOW_DAYS)
  const windowEdge = toISO(edgeDate)

  let start = clampISO(dir === 1 ? probe : windowEdge, bounds)
  let end   = clampISO(dir === 1 ? windowEdge : probe, bounds)
  if (start <= end) {
    const found = pickNearestGameDate(await primeGamesCache(start, end), dir)
    if (found) return found
  }

  // Rare: no games anywhere in the ~month window — sweep the rest of the
  // season in one more request rather than giving up.
  start = clampISO(dir === 1 ? windowEdge : bounds.start, bounds)
  end   = clampISO(dir === 1 ? bounds.end : windowEdge, bounds)
  if (start > end) return null
  return pickNearestGameDate(await primeGamesCache(start, end), dir)
}

// Shared with LiveGameCenter, which parses the same shapes out of the live feed
// (liveData.linescore / liveData.boxscore) instead of the standalone endpoints.
export function parseBoxScoreData(ls: any, box: any): BoxScore {
  const innings: InningLine[] = (ls.innings ?? []).map((i: any) => ({
    num:  i.num,
    away: i.away?.runs ?? null,
    home: i.home?.runs ?? null,
  }))

  const mkTeamBox = (side: 'home' | 'away'): TeamBox => {
    const t       = box.teams?.[side] ?? {}
    const players = t.players ?? {}
    const lst     = ls.teams?.[side] ?? {}

    const batters: BatterLine[] = (t.batters ?? []).map((pid: number) => {
      const p  = players[`ID${pid}`] ?? {}
      const b  = p.stats?.batting ?? {}
      const sb = p.seasonStats?.batting ?? {}
      // battingOrder is "100", "200" for starters; "101", "201" for subs.
      const order = String(p.battingOrder ?? '')
      return {
        id:    Number(p.person?.id ?? pid),
        name:  p.person?.fullName ?? '—',
        pos:   p.position?.abbreviation ?? '',
        ab:    b.atBats     ?? 0,
        r:     b.runs       ?? 0,
        h:     b.hits       ?? 0,
        rbi:   b.rbi        ?? 0,
        bb:    b.baseOnBalls ?? 0,
        k:     b.strikeOuts ?? 0,
        avg:   sb.avg ?? b.avg ?? '',
        isSub: order !== '' && !order.endsWith('00'),
      }
    })

    const pitchers: PitcherLine[] = (t.pitchers ?? []).map((pid: number) => {
      const p  = players[`ID${pid}`] ?? {}
      const pt = p.stats?.pitching ?? {}
      const sp = p.seasonStats?.pitching ?? {}
      return {
        id:   Number(p.person?.id ?? pid),
        name: p.person?.fullName ?? '—',
        note:    pt.note ? String(pt.note).replace(/[()]/g, '') : null,
        ip:      pt.inningsPitched ?? '0.0',
        h:       pt.hits        ?? 0,
        r:       pt.runs        ?? 0,
        er:      pt.earnedRuns  ?? 0,
        bb:      pt.baseOnBalls ?? 0,
        k:       pt.strikeOuts  ?? 0,
        pitches: pt.pitchesThrown ?? pt.numberOfPitches ?? null,
        era:     sp.era ?? null,
      }
    })

    const id = Number(t.team?.id ?? 0)
    return {
      teamId:   id,
      abbr:     TEAM_ABBR[id] ?? t.team?.abbreviation ?? '???',
      name:     t.team?.name ?? '???',
      runs:     lst.runs   ?? 0,
      hits:     lst.hits   ?? 0,
      errors:   lst.errors ?? 0,
      batters,
      pitchers,
    }
  }

  return { innings, away: mkTeamBox('away'), home: mkTeamBox('home') }
}

async function fetchGamePreview(gamePk: number): Promise<GamePreviewData | null> {
  try {
    const season = new Date().getFullYear()
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}` +
      `&hydrate=probablePitcher,venue,weather`
    ).then(r => r.json()).catch(() => null)

    const game = schedRes?.dates?.[0]?.games?.[0]
    if (!game) return null

    const venueName = game.venue?.name ?? ''
    const w = game.weather
    const weather = (w && (w.condition || w.temp || w.wind))
      ? { condition: w.condition ?? '', temp: w.temp ?? '', wind: w.wind ?? '' }
      : null

    const fetchPitcher = async (raw: any): Promise<ProbablePitcher | null> => {
      if (!raw?.id) return null
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/people/${raw.id}?hydrate=stats(group=pitching,type=season,season=${season})`
        ).then(r => r.json())
        const person = r.people?.[0]
        const stat = person?.stats?.find((s: any) => s.group?.displayName === 'pitching')?.splits?.[0]?.stat
        return {
          id:     raw.id,
          name:   raw.fullName,
          hand:   person?.pitchHand?.code ?? '?',
          era:    stat?.era    ?? null,
          wins:   Number(stat?.wins      ?? 0),
          losses: Number(stat?.losses    ?? 0),
          whip:   stat?.whip   ?? null,
          k:      Number(stat?.strikeOuts ?? 0),
          ip:     stat?.inningsPitched ?? null,
        }
      } catch {
        return { id: raw.id, name: raw.fullName, hand: '?', era: null, wins: 0, losses: 0, whip: null, k: 0, ip: null }
      }
    }

    const [awayPitcher, homePitcher] = await Promise.all([
      fetchPitcher(game.teams?.away?.probablePitcher),
      fetchPitcher(game.teams?.home?.probablePitcher),
    ])

    return { venueName, weather, awayPitcher, homePitcher }
  } catch { return null }
}

// ─── Team logo bubble ───────────────────────────────────────────────────────

export function LogoBubble({ teamId, abbr, size, ring = 1.5 }: {
  teamId: number; abbr: string; size: number; ring?: number
}) {
  const isDark = useIsDark()
  const col = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: teamLogoBg(teamId, isDark),
      border: `${ring}px solid ${col}`, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <Box
        component="img"
        src={teamLogoSrc(teamId, isDark)}
        alt={abbr}
        sx={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────

export function LiveDot({ size = 6 }: { size?: number }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0,
      animation: 'scoreLivePulse 1.6s ease-in-out infinite',
      '@keyframes scoreLivePulse': { '0%,100%': { opacity: 1, transform: 'scale(1)' }, '50%': { opacity: 0.45, transform: 'scale(0.8)' } },
    }} />
  )
}

// ─── Mini score card (final / live / preview) ────────────────────────────────

function FinalGameMiniCard({ game, onClick, wide = false, accent }: {
  game:    FinalGameSummary
  onClick?: () => void
  wide?:    boolean          // fill the parent (grid cell) instead of fixed strip width
  accent?:  string           // ring color to call out the followed team's game
}) {
  const isPreview = game.state === 'preview'
  const isLive    = game.state === 'live'
  const statusColor = isLive ? '#ef4444' : 'text.disabled'
  const isDark = useIsDark()

  // Which team to emphasize: winner (final) or current leader (live)
  const emphasize = (t: FinalTeam): boolean => {
    if (isPreview) return false
    if (game.state === 'final') return t.isWinner
    const other = t === game.away ? game.home : game.away
    return t.runs > other.runs
  }

  const teamRow = (t: FinalTeam) => {
    const em = emphasize(t)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <LogoBubble teamId={t.teamId} abbr={t.abbr} size={20} />
        <Typography sx={{
          flex: 1, fontSize: '0.74rem', fontWeight: em ? 800 : 500, lineHeight: 1,
          color: (isLive || em) ? 'text.primary' : 'text.secondary',
        }}>
          {t.abbr}
        </Typography>
        {!isPreview && (
          <Typography sx={{
            fontSize: '0.9rem', fontWeight: em ? 800 : 500, lineHeight: 1,
            color: (isLive || em) ? 'text.primary' : 'text.secondary', minWidth: 16, textAlign: 'right',
          }}>
            {t.runs}
          </Typography>
        )}
      </Box>
    )
  }

  return (
    <Box
      onClick={onClick}
      sx={{
        flexShrink: 0, width: wide ? '100%' : 124, minWidth: 0,
        borderRadius: 2, border: '1px solid',
        borderColor: accent ? `${accent}70` : defaultBorder(isDark),
        boxShadow: accent ? `0 0 0 1.5px ${accent}40` : 'none',
        bgcolor: 'background.paper', overflow: 'hidden',
        userSelect: 'none',
        transition: 'all 0.15s',
        ...(onClick ? {
          cursor: 'pointer',
          '&:hover': { borderColor: accent ?? 'text.secondary', transform: 'translateY(-2px)', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' },
        } : {}),
      }}
    >
      {/* Status row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, pt: 0.8, pb: 0.4 }}>
        {isLive && <LiveDot size={5} />}
        <Typography sx={{
          fontSize: '0.56rem', fontWeight: 800, color: statusColor,
          letterSpacing: 0.6, textTransform: 'uppercase', lineHeight: 1,
        }}>
          {game.statusText}
        </Typography>
        {onClick && (
          <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', ml: 'auto', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            {isPreview ? 'Preview →' : 'Box →'}
          </Typography>
        )}
      </Box>

      {/* Teams + scores */}
      <Box sx={{ px: 1, pb: 0.8, display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {teamRow(game.away)}
        {teamRow(game.home)}
      </Box>
    </Box>
  )
}

// ─── Box-score modal ──────────────────────────────────────────────────────────

function StatHead({ children, w = 26 }: { children: React.ReactNode; w?: number }) {
  return (
    <Box component="th" sx={{
      fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.4,
      textAlign: 'right', px: 0.4, py: 0.5, minWidth: w,
    }}>
      {children}
    </Box>
  )
}

function StatCell({ children, bold = false }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <Box component="td" sx={{
      fontSize: '0.72rem', fontWeight: bold ? 800 : 600, color: 'text.primary',
      textAlign: 'right', px: 0.4, py: 0.45, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </Box>
  )
}

export function LineScoreTable({ box }: { box: BoxScore }) {
  const rows: Array<{ side: 'away' | 'home'; t: TeamBox }> = [
    { side: 'away', t: box.away },
    { side: 'home', t: box.home },
  ]
  // Always show a full 9 innings (more only if the game went to extras); innings the
  // game hasn't reached yet render as blank columns.
  const lastNum = box.innings.length ? box.innings[box.innings.length - 1].num : 0
  const byNum   = new Map(box.innings.map(i => [i.num, i] as const))
  const cols    = Array.from({ length: Math.max(9, lastNum) }, (_, k) => k + 1)
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 44 }} />
            {cols.map(num => (
              <StatHead key={num} w={18}>{num}</StatHead>
            ))}
            <Box component="th" sx={{ width: 8 }} />
            <StatHead w={22}>R</StatHead>
            <StatHead w={22}>H</StatHead>
            <StatHead w={22}>E</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(({ side, t }) => (
            <Box component="tr" key={side} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <LogoBubble teamId={t.teamId} abbr={t.abbr} size={18} ring={1.25} />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: t.runs > (side === 'away' ? box.home.runs : box.away.runs) ? 800 : 600, lineHeight: 1 }}>
                    {t.abbr}
                  </Typography>
                </Box>
              </Box>
              {cols.map(num => {
                const i = byNum.get(num)
                if (!i) return <StatCell key={num}>{''}</StatCell>   // inning not reached yet
                const v = side === 'away' ? i.away : i.home
                // Home team that didn't bat in its last frame → "x"
                return <StatCell key={num}>{v == null ? (side === 'home' ? 'x' : '-') : v}</StatCell>
              })}
              <Box component="td" sx={{ width: 8 }} />
              <StatCell bold>{t.runs}</StatCell>
              <StatCell>{t.hits}</StatCell>
              <StatCell>{t.errors}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function BattingTable({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 132, textAlign: 'left', fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.5 }}>
              Batters
            </Box>
            <StatHead>AB</StatHead><StatHead>R</StatHead><StatHead>H</StatHead>
            <StatHead>RBI</StatHead><StatHead>BB</StatHead><StatHead>SO</StatHead>
            <StatHead w={36}>AVG</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {team.batters.map(b => (
            <Box component="tr" key={b.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ px: 0.4, py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography
                    onClick={onPlayerClick ? () => onPlayerClick(b.id) : undefined}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.2,
                      pl: b.isSub ? 1 : 0,
                      ...(onPlayerClick ? { cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } } : {}),
                    }}
                  >
                    {b.name}
                  </Typography>
                  <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled', lineHeight: 1 }}>{b.pos}</Typography>
                </Box>
              </Box>
              <StatCell>{b.ab}</StatCell><StatCell>{b.r}</StatCell><StatCell bold>{b.h}</StatCell>
              <StatCell>{b.rbi}</StatCell><StatCell>{b.bb}</StatCell><StatCell>{b.k}</StatCell>
              <StatCell>{b.avg}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function PitchingTable({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box data-swipe-ignore="true" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ minWidth: 132, textAlign: 'left', fontSize: '0.56rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, px: 0.4, py: 0.5 }}>
              Pitchers
            </Box>
            <StatHead w={32}>IP</StatHead><StatHead>H</StatHead><StatHead>R</StatHead>
            <StatHead>ER</StatHead><StatHead>BB</StatHead><StatHead>SO</StatHead>
            <StatHead>P</StatHead>
            <StatHead w={36}>ERA</StatHead>
          </Box>
        </Box>
        <Box component="tbody">
          {team.pitchers.map(p => (
            <Box component="tr" key={p.id} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Box component="td" sx={{ px: 0.4, py: 0.45 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography
                    onClick={onPlayerClick ? () => onPlayerClick(p.id) : undefined}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.2,
                      ...(onPlayerClick ? { cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } } : {}),
                    }}
                  >
                    {p.name}
                  </Typography>
                  {p.note && (
                    <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>
                      {p.note}
                    </Typography>
                  )}
                </Box>
              </Box>
              <StatCell bold>{p.ip}</StatCell><StatCell>{p.h}</StatCell><StatCell>{p.r}</StatCell>
              <StatCell>{p.er}</StatCell><StatCell>{p.bb}</StatCell><StatCell>{p.k}</StatCell>
              <StatCell>{p.pitches ?? '—'}</StatCell>
              <StatCell>{p.era ?? '—'}</StatCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
      textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1,
    }}>
      {children}
    </Typography>
  )
}

export function TeamBoxSection({ team, onPlayerClick }: { team: TeamBox; onPlayerClick?: (id: number) => void }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, bgcolor: 'action.hover' }}>
        <LogoBubble teamId={team.teamId} abbr={team.abbr} size={26} />
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, lineHeight: 1 }}>{team.name}</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', ml: 'auto', lineHeight: 1 }}>
          {team.runs} R · {team.hits} H · {team.errors} E
        </Typography>
      </Box>
      <Box sx={{ px: 2, py: 1.25 }}>
        <BattingTable team={team} onPlayerClick={onPlayerClick} />
      </Box>
      <Box sx={{ px: 2, pb: 1.5, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <PitchingTable team={team} onPlayerClick={onPlayerClick} />
      </Box>
    </Box>
  )
}

// ─── Game preview modal ───────────────────────────────────────────────────────

function GamePreviewModal({ game, onClose, onPlayerClick, onTeamClick }: {
  game: FinalGameSummary
  onClose: () => void
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const [preview, setPreview] = useState<GamePreviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchGamePreview(game.gamePk).then(p => { setPreview(p); setLoading(false) })
  }, [game.gamePk])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const isDark = useIsDark()

  function PitcherCard({ pitcher, team }: { pitcher: ProbablePitcher | null; team: FinalTeam }) {
    const teamColor  = TEAM_BG[team.teamId] ?? '#444'
    const accentText = accentColor(teamColor, isDark)
    return (
      <Box
        onClick={pitcher && onPlayerClick ? () => { onPlayerClick(pitcher.id); onClose() } : undefined}
        sx={{
          flex: 1, p: 1.5, borderRadius: 2,
          bgcolor: `${teamColor}10`,
          border: '1px solid', borderColor: borderAlpha(teamColor, isDark),
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
          cursor: pitcher && onPlayerClick ? 'pointer' : 'default',
          transition: 'border-color 0.15s',
          ...(pitcher && onPlayerClick ? { '&:hover': { borderColor: `${teamColor}60` } } : {}),
        }}
      >
        <Box sx={{
          width: 58, height: 70, borderRadius: 1.5, overflow: 'hidden',
          border: `2px solid ${photoBorderAlpha(teamColor, isDark)}`, bgcolor: 'action.hover', flexShrink: 0,
        }}>
          {pitcher ? (
            <Box component="img"
              src={HEADSHOT(pitcher.id)} alt={pitcher.name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
            />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: '1.4rem', lineHeight: 1 }}>?</Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ textAlign: 'center', minWidth: 0 }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.8rem', lineHeight: 1.2,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {pitcher?.name ?? 'TBD'}
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1, mt: 0.2 }}>
            {pitcher ? `${pitcher.hand}HP · ${team.abbr}` : team.abbr}
          </Typography>
        </Box>

        {pitcher && (
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { label: 'W-L',  value: pitcher.era !== null ? `${pitcher.wins}-${pitcher.losses}` : '—' },
              { label: 'ERA',  value: pitcher.era  ?? '—' },
              { label: 'WHIP', value: pitcher.whip ?? '—' },
              { label: 'K',    value: String(pitcher.k) },
            ].map(s => (
              <Box key={s.label} sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, lineHeight: 1, color: accentText, letterSpacing: '-0.3px' }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 0.4, color: 'text.secondary', lineHeight: 1, mt: 0.2,
                }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  }

  const teamSide = (t: FinalTeam) => (
    <Box
      onClick={onTeamClick ? () => { onTeamClick(t.teamId); onClose() } : undefined}
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6,
        cursor: onTeamClick ? 'pointer' : 'default',
      }}
    >
      <LogoBubble teamId={t.teamId} abbr={t.abbr} size={48} ring={2.5} />
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>{t.abbr}</Typography>
    </Box>
  )

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1500,
        bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 480,
        // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
        // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
        maxHeight: '100%', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
      }}>

        {/* Header */}
        <Box sx={{
          px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
        }}>
          <Typography sx={{
            flex: 1, fontWeight: 800, fontSize: '0.72rem', color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1,
          }}>
            Preview · {game.statusText}
          </Typography>
          <Box
            onClick={onClose}
            sx={{
              flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'text.disabled',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>✕</Typography>
          </Box>
        </Box>

        {/* Matchup */}
        <Box sx={{ px: 2, pt: 2.5, pb: 1.75, display: 'flex', alignItems: 'center', gap: 1 }}>
          {teamSide(game.away)}
          <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled', px: 1 }}>@</Typography>
          {teamSide(game.home)}
        </Box>

        {/* Venue + weather */}
        {!loading && preview && (
          <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1.5 }}>
            {preview.venueName && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', textAlign: 'center' }}>
                {preview.venueName}
              </Typography>
            )}
            {preview.weather && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', textAlign: 'center' }}>
                {preview.weather.temp}°F · {preview.weather.condition}
                {preview.weather.wind ? ` · ${preview.weather.wind}` : ''}
              </Typography>
            )}
          </Box>
        )}

        {/* Probable starters */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
          <Typography sx={{
            fontSize: '0.58rem', fontWeight: 700, color: 'text.disabled',
            textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1, mb: 1.25,
          }}>
            Probable Starters
          </Typography>
          {loading ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading…</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <PitcherCard pitcher={preview?.awayPitcher ?? null} team={game.away} />
              <PitcherCard pitcher={preview?.homePitcher ?? null} team={game.home} />
            </Box>
          )}
        </Box>

      </Box>
    </Box>
  )
}

// ─── Date navigator ────────────────────────────────────────────────────────────

function DateNav({ dateISO, onChange }: { dateISO: string; onChange: (iso: string) => void }) {
  const [bounds,     setBounds]     = useState<SeasonBounds | null>(null)
  const [navigating, setNavigating] = useState(false)
  const navigatingRef = useRef(false)

  useEffect(() => {
    fetchSeasonBounds(CURRENT_SEASON).then(setBounds)
  }, [])

  // Arrows skip straight to the nearest date with games — never landing on a
  // dead date — and clamp to the season's actual start/end.
  const shift = async (dir: 1 | -1) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    setNavigating(true)
    try {
      const next = await findAdjacentGameDate(dateISO, dir, CURRENT_SEASON)
      if (next) onChange(next)
    } finally {
      navigatingRef.current = false
      setNavigating(false)
    }
  }

  const arrowSx = {
    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: navigating ? 'default' : 'pointer', color: 'text.secondary',
    opacity: navigating ? 0.5 : 1,
    '&:hover': navigating ? {} : { bgcolor: 'action.hover', color: 'text.primary' },
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box onClick={() => shift(-1)} sx={arrowSx}>
        <Typography sx={{ fontSize: '0.9rem', lineHeight: 1 }}>‹</Typography>
      </Box>

      {/* Clickable label with an overlaid native date input for jumping */}
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 700, color: 'text.primary',
          minWidth: 88, textAlign: 'center', lineHeight: 1, userSelect: 'none',
        }}>
          {dateLabel(dateISO)}
        </Typography>
        <Box
          component="input"
          type="date"
          value={dateISO}
          min={bounds?.start}
          max={bounds?.end}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onChange(e.target.value) }}
          sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: 0, cursor: 'pointer', border: 'none', padding: 0,
          }}
        />
      </Box>

      <Box onClick={() => shift(1)} sx={arrowSx}>
        <Typography sx={{ fontSize: '0.9rem', lineHeight: 1 }}>›</Typography>
      </Box>

      {/* Only shown when not already viewing today — jumps straight back. */}
      {dateISO !== toISO(new Date()) && (
        <Box
          onClick={() => onChange(toISO(new Date()))}
          sx={{
            fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled',
            cursor: 'pointer', px: 0.9, py: 0.3, ml: 0.25,
            borderRadius: 999, border: '1px solid', borderColor: 'divider',
            whiteSpace: 'nowrap',
            transition: 'color 0.12s, border-color 0.12s',
            '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
          }}
        >
          Today
        </Box>
      )}
    </Box>
  )
}

// ─── ScoreboardModal — all scores side by side ────────────────────────────────

function ScoreboardModal({ dateISO, onDateChange, games, loading, followedTeamId, onGameClick, onClose, gameModalOpen }: {
  dateISO:        string
  onDateChange:   (iso: string) => void
  games:          FinalGameSummary[]   // pre-sorted: followed team first
  loading:        boolean
  followedTeamId?: number | null
  onGameClick:    (g: FinalGameSummary) => void
  onClose:        () => void
  gameModalOpen:  boolean              // a game modal is stacked on top — let it own Escape
}) {
  useEffect(() => {
    if (gameModalOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, gameModalOpen])

  const isMine = (g: FinalGameSummary) =>
    followedTeamId != null && (g.home.teamId === followedTeamId || g.away.teamId === followedTeamId)

  return (
    <Box
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1400,
        bgcolor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 1, sm: 2.5 },
      }}
    >
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3,
        border: '1px solid', borderColor: 'divider',
        width: '100%', maxWidth: 1000,
        // `100%` of the padded fixed overlay (not `vh`) so the card stays on-screen
        // under the desktop `zoom` wrapper, which doesn't shrink viewport units.
        maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{
          px: { xs: 2, sm: 2.5 }, py: 1.5, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap',
        }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.78rem', textTransform: 'uppercase',
            letterSpacing: 1.4, color: 'text.secondary', lineHeight: 1,
          }}>
            Scores
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <DateNav dateISO={dateISO} onChange={onDateChange} />
            <Box
              onClick={onClose}
              sx={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.disabled',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              <Typography sx={{ fontSize: '0.8rem', lineHeight: 1 }}>✕</Typography>
            </Box>
          </Box>
        </Box>

        {/* Grid of all games */}
        <Box sx={{
          overflowY: 'auto', flex: 1, minHeight: 0, p: { xs: 1.5, sm: 2 },
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}>
          {loading ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>Loading…</Typography>
            </Box>
          ) : games.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled' }}>No games scheduled on this date</Typography>
            </Box>
          ) : (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
              gap: 1.25,
            }}>
              {games.map(game => (
                <FinalGameMiniCard
                  key={game.gamePk}
                  game={game}
                  wide
                  accent={isMine(game) ? (TEAM_BG[followedTeamId!] ?? undefined) : undefined}
                  onClick={() => onGameClick(game)}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── FinalGamesSection ─────────────────────────────────────────────────────────

export function FinalGamesSection({ followedTeamId, onPlayerClick, onTeamClick }: {
  followedTeamId?: number | null
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const [dateISO,    setDateISO]    = useState(() => toISO(new Date()))
  const [games,      setGames]      = useState<FinalGameSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [openGame,   setOpenGame]   = useState<FinalGameSummary | null>(null)
  const [expanded,   setExpanded]   = useState(false)
  const isDark = useIsDark()

  // Back-from-Search restore: reopen the game modal the user cross-linked from.
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'scoreGame') setOpenGame(o.game)
  }, [])

  const theme = useTheme()
  const paperBg = theme.palette.background.paper
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const handleStripScroll = useCallback(() => {
    const c = stripRef.current
    if (!c) return
    setCanScrollLeft(c.scrollLeft > 8)
    setCanScrollRight(c.scrollLeft < c.scrollWidth - c.clientWidth - 8)
  }, [])

  // Click (or tap on mobile): jump by roughly one viewport's worth of games.
  const scrollStrip = useCallback((dir: 'left' | 'right') => {
    const c = stripRef.current
    if (!c) return
    const amount = Math.round(c.clientWidth * 0.85)
    c.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' })
  }, [])

  // Hover (mouse/trackpad only — gated on the `hover` media feature so touch
  // taps never trigger a runaway auto-scroll): glide continuously while the
  // pointer stays over the arrow, stop the moment it leaves.
  const autoScrollDirRef  = useRef<'left' | 'right' | null>(null)
  const autoScrollRafRef  = useRef<number | null>(null)

  const stepAutoScroll = useCallback(() => {
    const c = stripRef.current, dir = autoScrollDirRef.current
    if (!c || !dir) { autoScrollRafRef.current = null; return }
    c.scrollLeft += dir === 'right' ? 7 : -7
    autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
  }, [])

  const startAutoScroll = useCallback((dir: 'left' | 'right') => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
    autoScrollDirRef.current = dir
    if (autoScrollRafRef.current == null) autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
  }, [stepAutoScroll])

  const stopAutoScroll = useCallback(() => {
    autoScrollDirRef.current = null
    if (autoScrollRafRef.current != null) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null }
  }, [])

  useEffect(() => stopAutoScroll, [stopAutoScroll])

  // Window resize (or phone rotation) changes clientWidth without touching `games`
  // or firing a scroll event — re-check arrow visibility so it doesn't go stale.
  useEffect(() => {
    window.addEventListener('resize', handleStripScroll)
    return () => window.removeEventListener('resize', handleStripScroll)
  }, [handleStripScroll])

  // Once, on first load: if today has no games at all (off day, All-Star break,
  // offseason), roll forward to the next date that does.
  const autoAdvancedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchFinalGames(dateISO)
      .then(async g => {
        if (cancelled) return
        if (g.length === 0 && dateISO === toISO(new Date()) && !autoAdvancedRef.current) {
          autoAdvancedRef.current = true
          const next = await findAdjacentGameDate(dateISO, 1, CURRENT_SEASON)
          if (cancelled) return
          if (next) {
            const gg = await fetchFinalGames(next)   // already cached by findAdjacentGameDate
            if (cancelled) return
            setDateISO(next)
            setGames(gg)
            setLoading(false)
            return
          }
          // Nothing found ahead — show today's empty state as-is.
          setGames([])
          setLoading(false)
          return
        }
        setGames(g)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setGames([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [dateISO])

  // Re-check arrow visibility whenever the game list (re)renders — new date, new
  // width, etc. — since scrollWidth/clientWidth only settle after paint.
  useEffect(() => {
    const t = setTimeout(handleStripScroll, 50)
    return () => clearTimeout(t)
  }, [games, handleStripScroll])

  // Ordering (see request):
  //   1. Followed team's game is always first, no matter what.
  //   2. Live games come first; the division/league order applies *within* live,
  //      then again within the non-live games.
  //   3. Division order: followed team → its division rivals → rest of its league
  //      → other league.
  //   4. Final before preview as a final tiebreaker.
  const STATE_ORDER: Record<GameState, number> = { live: 0, final: 1, preview: 2 }
  const myDiv    = followedTeamId != null ? TEAM_DIVISION[followedTeamId] : undefined
  const myLeague = myDiv?.slice(0, 2)

  // Relevance of a single team to the followed team: 0 division, 1 league, 2 other.
  const teamRel = (teamId: number): number => {
    const div = TEAM_DIVISION[teamId]
    if (!div || !myDiv) return 2
    if (div === myDiv) return 0
    if (div.slice(0, 2) === myLeague) return 1
    return 2
  }
  // A game ranks by its most relevant team.
  const gameRel = (g: FinalGameSummary) => Math.min(teamRel(g.home.teamId), teamRel(g.away.teamId))
  const isMine  = (g: FinalGameSummary) =>
    followedTeamId != null && (g.home.teamId === followedTeamId || g.away.teamId === followedTeamId)

  const sortedGames = [...games].sort((a, b) => {
    const aMine = isMine(a), bMine = isMine(b)
    if (aMine !== bMine) return aMine ? -1 : 1
    const aLive = a.state === 'live', bLive = b.state === 'live'
    if (aLive !== bLive) return aLive ? -1 : 1
    const rel = gameRel(a) - gameRel(b)
    if (rel !== 0) return rel
    return STATE_ORDER[a.state] - STATE_ORDER[b.state]
  })

  return (
    <>
      <Box sx={{
        borderRadius: 3, border: '1px solid', borderColor: defaultBorder(isDark),
        bgcolor: 'background.paper', overflow: 'hidden',
      }}>
        {/* Header with date nav */}
        <Box sx={{
          px: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase',
            letterSpacing: 1.4, color: 'text.secondary', lineHeight: 1,
          }}>
            Scores
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <DateNav dateISO={dateISO} onChange={setDateISO} />
            <Box
              onClick={() => setExpanded(true)}
              title="View all scores"
              sx={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.secondary',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              <Typography sx={{ fontSize: '0.85rem', lineHeight: 1 }}>⛶</Typography>
            </Box>
          </Box>
        </Box>

        {/* Body */}
        {loading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading…</Typography>
          </Box>
        ) : games.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.74rem', color: 'text.disabled' }}>No games scheduled on this date</Typography>
          </Box>
        ) : (
          <Box sx={{ position: 'relative' }}>
            {/* ◀ / ▶ columnar edge arrows — full-height gradient bars.
                Desktop: hovering glides the strip continuously (see startAutoScroll).
                Mobile: no hover to speak of, so a tap just jumps one page. */}
            <Box
              onClick={() => scrollStrip('left')}
              onMouseEnter={() => startAutoScroll('left')}
              onMouseLeave={stopAutoScroll}
              sx={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 34, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                cursor: 'pointer',
                opacity: canScrollLeft ? 1 : 0, pointerEvents: canScrollLeft ? 'auto' : 'none',
                transition: 'opacity 0.15s',
                background: `linear-gradient(to right, ${paperBg} 0%, ${paperBg}cc 55%, transparent 100%)`,
                '&:hover .scoreArrowIcon': { color: 'text.primary', transform: 'scale(1.15)' },
              }}
            >
              <Box className="scoreArrowIcon" sx={{
                display: 'flex', ml: 0.4, color: 'text.secondary',
                transition: 'color 0.12s, transform 0.12s',
              }}>
                <ChevronLeft sx={{ fontSize: '1.3rem' }} />
              </Box>
            </Box>
            <Box
              onClick={() => scrollStrip('right')}
              onMouseEnter={() => startAutoScroll('right')}
              onMouseLeave={stopAutoScroll}
              sx={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: 34, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                cursor: 'pointer',
                opacity: canScrollRight ? 1 : 0, pointerEvents: canScrollRight ? 'auto' : 'none',
                transition: 'opacity 0.15s',
                background: `linear-gradient(to left, ${paperBg} 0%, ${paperBg}cc 55%, transparent 100%)`,
                '&:hover .scoreArrowIcon': { color: 'text.primary', transform: 'scale(1.15)' },
              }}
            >
              <Box className="scoreArrowIcon" sx={{
                display: 'flex', mr: 0.4, color: 'text.secondary',
                transition: 'color 0.12s, transform 0.12s',
              }}>
                <ChevronRight sx={{ fontSize: '1.3rem' }} />
              </Box>
            </Box>

            <Box
              ref={stripRef}
              onScroll={handleStripScroll}
              data-swipe-ignore="true"
              sx={{
                display: 'flex', gap: 1, p: 1.25,
                overflowX: 'auto',
                '&::-webkit-scrollbar': { display: 'none' },
                msOverflowStyle: 'none', scrollbarWidth: 'none',
              }}
            >
              {sortedGames.map(game => (
                <FinalGameMiniCard
                  key={game.gamePk}
                  game={game}
                  onClick={() => setOpenGame(game)}
                />
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {expanded && (
        <ScoreboardModal
          dateISO={dateISO}
          onDateChange={setDateISO}
          games={sortedGames}
          loading={loading}
          followedTeamId={followedTeamId}
          onGameClick={setOpenGame}
          onClose={() => setExpanded(false)}
          gameModalOpen={openGame !== null}
        />
      )}

      {openGame && openGame.state === 'preview' ? (
        <GamePreviewModal
          game={openGame}
          onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
          onPlayerClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick)}
          onTeamClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick)}
        />
      ) : openGame ? (
        <Suspense fallback={null}>
          <GameCenterModal
            game={openGame}
            onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
            onPlayerClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick)}
            onTeamClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
