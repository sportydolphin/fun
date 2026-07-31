import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, TEAM_ABBR, CURRENT_SEASON } from '../constants'
import { useIsDark, defaultBorder } from '../lib/colorUtils'
import { getHomeOverlay, setHomeOverlay, clearOverlayIf, stampOverlay } from '../state/homeOverlay'
import { fetchTeamSeasonStats, TEAM_STAT_DEFS, TeamSeasonStats, TeamStatValue } from '../api'
import { LogoBubble, LiveDot } from '../components/boxScore'
import { useScrollLock } from '../lib/useScrollLock'
import { GamePreviewModal } from './GamePreview'

// Loaded on first game click — keeps the Game Center out of the home bundle.
const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))

// ─── Types ────────────────────────────────────────────────────────────────────

type GameState = 'live' | 'final' | 'preview' | 'postponed'

export interface FinalTeam {
  teamId:   number
  abbr:     string
  name:     string
  runs:     number
  hits:     number
  errors:   number
  isWinner: boolean
  record?:  string          // "54-38" — season record as of this game
}

export interface FinalGameSummary {
  gamePk:     number
  state:      GameState
  startMs:    number                 // scheduled first pitch (epoch ms) — drives chronological order
  statusText: string                 // "Final"/"Final/10", live inning ("▲ 5th"), or start time
  home:       FinalTeam
  away:       FinalTeam
  winPitcher:  string | null
  losePitcher: string | null
  savePitcher: string | null
  reason?:     string                // "Rain"/"Snow"/... — only set for postponed games
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
    const coded    = game.status?.codedGameState
    // Postponed games report abstractGameState "Final" (codedGameState "D") even
    // though they never happened — check them first or they'd show as a 0-0 Final.
    // "Live" during Warmup (~20 min pre-first-pitch) isn't really live yet.
    const state: GameState = coded === 'D' || detState === 'Postponed' ? 'postponed'
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
        abbr:     TEAM_ABBR[id] ?? t?.team?.abbreviation ?? '???',
        name:     t?.team?.name ?? '???',
        runs:     lst.runs   ?? t?.score ?? 0,
        hits:     lst.hits   ?? 0,
        errors:   lst.errors ?? 0,
        isWinner: Boolean(t?.isWinner),
        record:   rec && rec.wins != null && rec.losses != null ? `${rec.wins}-${rec.losses}` : undefined,
      }
    }

    const parsedStart = game.gameDate ? new Date(game.gameDate).getTime() : NaN
    // Games without a usable start time sink to the bottom of their group.
    const startMs = Number.isNaN(parsedStart) ? Number.MAX_SAFE_INTEGER : parsedStart

    let statusText: string
    if (state === 'postponed') {
      statusText = 'Postponed'
    } else if (state === 'final') {
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
      startMs,
      statusText,
      home:       mkTeam('home'),
      away:       mkTeam('away'),
      winPitcher:  game.decisions?.winner?.fullName ?? null,
      losePitcher: game.decisions?.loser?.fullName  ?? null,
      savePitcher: game.decisions?.save?.fullName    ?? null,
      reason:      state === 'postponed' ? (game.status?.reason || undefined) : undefined,
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


// ─── Mini score card (final / live / preview) ────────────────────────────────

function FinalGameMiniCard({ game, onClick, wide = false, accent }: {
  game:    FinalGameSummary
  onClick?: () => void
  wide?:    boolean          // fill the parent (grid cell) instead of fixed strip width
  accent?:  string           // ring color to call out the followed team's game
}) {
  const isPreview   = game.state === 'preview'
  const isPostponed = game.state === 'postponed'
  const isLive      = game.state === 'live'
  const noScore     = isPreview || isPostponed   // postponed games never happened → no score row
  const statusColor = isLive ? '#ef4444' : isPostponed ? '#f59e0b' : 'text.disabled'
  const isDark = useIsDark()

  // Which team to emphasize: winner (final) or current leader (live)
  const emphasize = (t: FinalTeam): boolean => {
    if (noScore) return false
    if (game.state === 'final') return t.isWinner
    const other = t === game.away ? game.home : game.away
    return t.runs > other.runs
  }

  const teamRow = (t: FinalTeam) => {
    const em = emphasize(t)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <LogoBubble teamId={t.teamId} abbr={t.abbr} size={20} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Typography sx={{
            fontSize: '0.74rem', fontWeight: em ? 800 : 500, lineHeight: 1,
            color: (isLive || em) ? 'text.primary' : 'text.secondary',
          }}>
            {t.abbr}
          </Typography>
          {noScore && t.record && (
            <Typography sx={{
              fontSize: '0.56rem', fontWeight: 500, lineHeight: 1, color: 'text.disabled',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>
              {t.record}
            </Typography>
          )}
        </Box>
        {!noScore && (
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
            {noScore ? 'Preview →' : 'Box →'}
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
  useScrollLock()
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
  // The strip sits directly on the page now (no enclosing card), so the edge-fade
  // arrows blend to the page background rather than a paper surface.
  const pageBg = theme.palette.background.default
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

  // Ordering:
  //   1. Followed team's game is always first, no matter what.
  //   2. Then by state: live → final → upcoming → postponed.
  //   3. Chronological (first pitch) within each state group.
  // No division/league weighting — it scattered the day's slate unpredictably.
  const STATE_ORDER: Record<GameState, number> = { live: 0, final: 1, preview: 2, postponed: 3 }
  const isMine = (g: FinalGameSummary) =>
    followedTeamId != null && (g.home.teamId === followedTeamId || g.away.teamId === followedTeamId)

  const sortedGames = [...games].sort((a, b) => {
    const aMine = isMine(a), bMine = isMine(b)
    if (aMine !== bMine) return aMine ? -1 : 1
    const state = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (state !== 0) return state
    return a.startMs - b.startMs
  })

  return (
    <>
      {/* Open on the page — no enclosing card. The mini-cards carry their own border. */}
      <Box>
        {/* Header with date nav */}
        <Box sx={{
          px: 0.25, pb: 0.75,
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
                background: `linear-gradient(to right, ${pageBg} 0%, ${pageBg}cc 55%, transparent 100%)`,
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
                background: `linear-gradient(to left, ${pageBg} 0%, ${pageBg}cc 55%, transparent 100%)`,
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
                display: 'flex', gap: 1, px: 0.25, py: 1,
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

      {openGame && (openGame.state === 'preview' || openGame.state === 'postponed') ? (() => {
        // ‹ › steps through the other upcoming games in the current scoreboard list.
        // Postponed games open the matchup preview too (never a box score — there's no game).
        const previews = sortedGames.filter(g => g.state === 'preview')
        const idx = previews.findIndex(g => g.gamePk === openGame.gamePk)
        return (
          <GamePreviewModal
            game={openGame}
            onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
            onPlayerClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick)}
            onTeamClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick)}
            onPrev={idx > 0 ? () => setOpenGame(previews[idx - 1]) : undefined}
            onNext={idx >= 0 && idx < previews.length - 1 ? () => setOpenGame(previews[idx + 1]) : undefined}
          />
        )
      })() : openGame ? (
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
