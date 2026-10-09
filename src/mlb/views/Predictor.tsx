import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, TEAM_NICKNAME, ACCENT, ACCENT_TEXT, PREDICTION_HEATER_MIN, isRealClub, CURRENT_SEASON, TONE } from '../constants'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { track, EVENTS } from '../../lib/analytics'
import { ensureActiveUser } from '../../lib/userActive'
import { useDevSim } from '../dev/devSim'
import { useDeepLink } from '../state/deepLink'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { SCHEDULE_GAME_TYPES, isUnplayed, hasStartTime } from '../gameStatus'
import { fetchSeasonPhase, fetchSeasonDates } from '../seasonPhase'
import { useDevSeasonPhase } from '../dev/devSeasonPhase'
import { chromePx, typePx } from '../../ui/scale'
import { SectionCard, CardLink, TYPE_SCALE, ICON_SIZE } from '../../ui/card'

// Both open on a tap from the widget, so neither rides in the Home landing (see PredictorModal.tsx).
const PredictorModal = lazy(() => import('./PredictorModal').then(m => ({ default: m.PredictorModal })))
const PredictionStatsModal = lazy(() => import('./PredictionStats').then(m => ({ default: m.PredictionStatsModal })))

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayPitcher {
  id:   number
  name: string
  hand: string
  era:  string
  ip:   string
}

export interface TodayGame {
  gamePk:   number
  gameTime: string
  state:    'preview' | 'live' | 'final' | 'postponed'
  /** Postseason only: "Gm 3", plus "if nec." for a game the series may never reach. A pick on
   *  that game never resolves if it is not played, so the reader should know. */
  note?:    string
  home: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  away: { teamId: number; abbr: string; name: string; pitcher: TodayPitcher | null }
  winnerId: number | null
}

// ─── API ──────────────────────────────────────────────────────────────────────

// One read per date shared by everything that asks at once. Home mounts the Predictor and Streak
// Survivor side by side and the toolbar bell asks too, so a cold /mlb load sent the schedule read
// and the probable pitchers' stats read twice each, a few milliseconds apart. A minute also covers
// the section remounting when the reader comes back from WPBL (see lib/readCache.ts), and it cannot
// leave a started game pickable: StatsAPI stops calling a game 'Preview' at warmup, about twenty
// minutes before first pitch. The Predictor's own refresh is every three minutes.
const TODAY_GAMES_TTL_MS = 60_000
const todayGamesCache = new Map<string, { at: number; p: Promise<TodayGame[]> }>()

export function fetchTodayGames(dateStr: string): Promise<TodayGame[]> {
  const hit = todayGamesCache.get(dateStr)
  let p: Promise<TodayGame[]>
  if (hit && Date.now() - hit.at < TODAY_GAMES_TTL_MS) p = hit.p
  else {
    p = readTodayGames(dateStr)
    todayGamesCache.set(dateStr, { at: Date.now(), p })
  }
  // A copy each: callers merge into and keep these objects, and one caller's edit must not
  // surface in another's state.
  return p.then(gs => structuredClone(gs))
}

async function readTodayGames(dateStr: string): Promise<TodayGame[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}` +
      `&gameType=${SCHEDULE_GAME_TYPES}&hydrate=probablePitcher`
    )
    const d = await r.json()
    const rawGames: TodayGame[] = []
    const pitcherIds: number[] = []

    for (const dateObj of d.dates ?? []) {
      for (const g of dateObj.games ?? []) {
        const ht      = g.teams?.home
        const at      = g.teams?.away
        const rawSt   = g.status?.abstractGameState ?? 'Preview'
        const detSt   = g.status?.detailedState ?? ''
        // Postponed and cancelled games report abstractGameState "Final": catch them first so
        // they aren't scored as a real (winner-less) final that dings everyone's record.
        // Warmup reports "Live" ~20 min early; keep it pickable until first pitch.
        const state   = isUnplayed(g.status) ? 'postponed'
          : rawSt === 'Final' ? 'final'
          : rawSt === 'Live' && detSt !== 'Warmup' ? 'live'
          : 'preview' as TodayGame['state']
        const homeId  = Number(ht?.team?.id ?? 0)
        const awayId  = Number(at?.team?.id ?? 0)
        // A postseason game whose series is not decided yet ("HOU/CWS" at CLE) cannot be picked:
        // see isRealClub. It comes back on its own the day the matchup is set.
        if (!isRealClub(homeId) || !isRealClub(awayId)) continue
        const homePId = ht?.probablePitcher?.id ? Number(ht.probablePitcher.id) : null
        const awayPId = at?.probablePitcher?.id ? Number(at.probablePitcher.id) : null
        if (homePId && !pitcherIds.includes(homePId)) pitcherIds.push(homePId)
        if (awayPId && !pitcherIds.includes(awayPId)) pitcherIds.push(awayPId)

        let winnerId: number | null = null
        if (state === 'final') {
          if (ht?.isWinner) winnerId = homeId
          else if (at?.isWinner) winnerId = awayId
        }

        rawGames.push({
          gamePk:   g.gamePk,
          gameTime: g.gameDate && hasStartTime(g.status)
            ? new Date(g.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : 'TBD',
          state: state as TodayGame['state'],
          note: g.gameType !== 'R' && g.seriesGameNumber
            ? `Gm ${g.seriesGameNumber}${g.ifNecessary === 'Y' ? ' if nec.' : ''}`
            : undefined,
          home: { teamId: homeId, abbr: TEAM_ABBR[homeId] ?? '???', name: ht?.team?.name ?? '???',
            pitcher: homePId ? { id: homePId, name: ht.probablePitcher.fullName ?? '—', hand: '?', era: '—', ip: '—' } : null },
          away: { teamId: awayId, abbr: TEAM_ABBR[awayId] ?? '???', name: at?.team?.name ?? '???',
            pitcher: awayPId ? { id: awayPId, name: at.probablePitcher.fullName ?? '—', hand: '?', era: '—', ip: '—' } : null },
          winnerId,
        })
      }
    }

    if (pitcherIds.length > 0) {
      try {
        const season = new Date().getFullYear()
        const pr = await fetch(
          `https://statsapi.mlb.com/api/v1/people?personIds=${pitcherIds.join(',')}` +
          `&hydrate=stats(group=pitching,type=season,season=${season})`
        )
        const pd = await pr.json()
        const pm: Record<number, Partial<TodayPitcher>> = {}
        for (const p of pd.people ?? []) {
          const grp  = (p.stats ?? []).find((s: any) => s.group?.displayName === 'pitching')
          const stat = grp?.splits?.[0]?.stat ?? {}
          pm[Number(p.id)] = { hand: p.pitchHand?.code ?? '?', era: stat.era ?? '—', ip: stat.inningsPitched ?? '—' }
        }
        for (const g of rawGames) {
          if (g.home.pitcher) Object.assign(g.home.pitcher, pm[g.home.pitcher.id] ?? {})
          if (g.away.pitcher) Object.assign(g.away.pitcher, pm[g.away.pitcher.id] ?? {})
        }
      } catch { /* non-fatal */ }
    }
    return rawGames
  } catch { return [] }
}

// ─── Vote totals ──────────────────────────────────────────────────────────────

// Returns: gamePk → teamId → count  (all users, not just current user)
export async function fetchVotesByGame(date: string): Promise<Record<number, Record<number, number>>> {
  try {
    const { data } = await supabase
      .from('game_predictions')
      .select('game_pk, predicted_team_id')
      .eq('game_date', date)
    const result: Record<number, Record<number, number>> = {}
    for (const row of data ?? []) {
      const pk  = Number(row.game_pk)
      const tid = Number(row.predicted_team_id)
      if (!result[pk]) result[pk] = {}
      result[pk][tid] = (result[pk][tid] ?? 0) + 1
    }
    return result
  } catch { return {} }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const predKey = (date: string) => `mlb_preds_${date}`

// YYYY-MM-DD shifted by n local days (handles month/year rollover via Date math).
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const longDay  = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

// How far ahead the widget looks for the next day with a game to pick. The longest gap inside a
// season is the All-Star break (four days) and inside a postseason the wait before the World Series
// (five or six); two weeks clears both with room, and past it the season is over.
const SLATE_LOOKAHEAD_DAYS = 14

/**
 * The next date from `from` with a game that can be picked: both clubs real (a postseason game
 * against "NYY/BOS" cannot be) and not postponed. One schedule read for the whole window.
 */
export async function fetchNextSlateDate(from: string, days = SLATE_LOOKAHEAD_DAYS): Promise<string | null> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${from}&endDate=${addDays(from, days)}` +
      `&gameType=${SCHEDULE_GAME_TYPES}&fields=dates,date,games,status,abstractGameState,codedGameState,detailedState,teams,away,home,team,id`
    )
    const d = await r.json()
    for (const dateObj of d.dates ?? []) {
      const pickable = (dateObj.games ?? []).some((g: any) =>
        !isUnplayed(g.status) && g.status?.abstractGameState === 'Preview' &&
        isRealClub(Number(g.teams?.home?.team?.id ?? 0)) && isRealClub(Number(g.teams?.away?.team?.id ?? 0)))
      if (pickable) return dateObj.date as string
    }
  } catch { /* no read: the widget shows its idle line */ }
  return null
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Exported for the picks-ready notification source, so the bell counts picks
// exactly the way the widget does rather than reimplementing it.
export function loadLocalPreds(date: string): Record<number, number> {
  try { const s = localStorage.getItem(predKey(date)); return s ? JSON.parse(s) : {} }
  catch { return {} }
}

function saveLocalPred(date: string, gamePk: number, teamId: number) {
  try { const p = loadLocalPreds(date); p[gamePk] = teamId; localStorage.setItem(predKey(date), JSON.stringify(p)) }
  catch { /* ignore */ }
}

export async function loadPredsFromSb(userId: string, date: string): Promise<Record<number, number>> {
  const { data } = await supabase
    .from('game_predictions')
    .select('game_pk, predicted_team_id')
    .eq('user_id', userId)
    .eq('game_date', date)
  return Object.fromEntries((data ?? []).map((r: any) => [r.game_pk, r.predicted_team_id]))
}

async function savePredToSb(userId: string, date: string, gamePk: number, teamId: number) {
  if (!(await ensureActiveUser(userId))) return
  await supabase.from('game_predictions').upsert(
    { user_id: userId, game_date: date, game_pk: gamePk, predicted_team_id: teamId },
    { onConflict: 'user_id,game_pk' }
  )
}

// A compact tappable team button used for making a pick directly on the card,
// without opening the full modal.

function QuickPickTeam({ team, side, picked, dimmed, onPick }: {
  team:   TodayGame['home']
  side:   'away' | 'home'
  picked: boolean
  dimmed: boolean
  onPick: () => void
}) {
  const isDark = useIsDark()
  const col    = ringColor(team.teamId, isDark)
  const away   = side === 'away'
  const label  = TEAM_NICKNAME[team.teamId] ?? team.name

  const logo = (
    <Box sx={{
      width: chromePx(30), height: chromePx(30), borderRadius: '50%', flexShrink: 0,
      bgcolor: teamLogoBg(team.teamId, isDark), border: `2px solid ${col}`,
      boxShadow: picked ? `0 0 0 2px ${col}40` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      transition: 'box-shadow 0.15s',
    }}>
      <Box component="img"
        src={teamLogoSrc(team.teamId, isDark)}
        alt={team.abbr}
        sx={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(team.teamId, isDark), transformOrigin: 'center' }}
      />
    </Box>
  )
  const name = (
    <Typography sx={{
      minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: picked ? 800 : 600, lineHeight: 1.1,
      color: picked ? col : 'text.primary',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      textAlign: away ? 'right' : 'left',
    }}>
      {label}
    </Typography>
  )

  return (
    // Hug content (no flex:1) so the row is a tight, centred matchup cluster
    // rather than two half-width halves with empty outer margins.
    <Box
      onClick={onPick}
      sx={{
        flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.7,
        justifyContent: away ? 'flex-end' : 'flex-start',
        px: 0.85, py: 0.55, borderRadius: 1.5, cursor: 'pointer',
        border: '1.5px solid', borderColor: picked ? `${col}70` : 'transparent',
        bgcolor: picked ? `${col}14` : 'transparent',
        opacity: dimmed ? 0.45 : 1,
        transition: 'all 0.15s',
        '&:hover': { bgcolor: `${col}0e`, borderColor: `${col}40` },
      }}
    >
      {away ? <>{name}{logo}</> : <>{logo}{name}</>}
    </Box>
  )
}

// The crowd-vote share on the outer edge of a matchup row. Reserves its column
// width even with no votes (renders blank) so the two teams stay aligned.
function PctLabel({ pct, align }: { pct: number | null; align: 'left' | 'right' }) {
  return (
    <Typography sx={{
      fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      color: 'text.secondary', textAlign: align, lineHeight: 1, whiteSpace: 'nowrap',
      visibility: pct === null ? 'hidden' : 'visible',
    }}>
      {pct ?? 0}%
    </Typography>
  )
}

function QuickPickRow({ game, prediction, gameVotes, onPick }: {
  game:       TodayGame
  prediction: number | null
  gameVotes?: Record<number, number>  // teamId → count
  onPick:     (teamId: number) => void
}) {
  const hasPick    = prediction !== null
  const awayVotes  = gameVotes?.[game.away.teamId] ?? 0
  const homeVotes  = gameVotes?.[game.home.teamId] ?? 0
  const totalVotes = awayVotes + homeVotes
  const awayPct    = totalVotes ? Math.round(awayVotes / totalVotes * 100) : null
  const homePct    = awayPct !== null ? 100 - awayPct : null
  const isDark     = useIsDark()
  // Ring color in dark mode gives the bars maximum contrast; light stays on TEAM_BG.
  const awayCol    = isDark ? ringColor(game.away.teamId, true) : TEAM_BG[game.away.teamId] ?? '#888'
  const homeCol    = isDark ? ringColor(game.home.teamId, true) : TEAM_BG[game.home.teamId] ?? '#888'
  const pickedAway = prediction === game.away.teamId
  const pickedHome = prediction === game.home.teamId

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {/* 5-column grid: vote% · away (hugs centre) · @ · home (hugs centre) · vote%. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `minmax(${chromePx(26)},auto) minmax(0,1fr) auto minmax(0,1fr) minmax(${chromePx(26)},auto)`,
        alignItems: 'center', columnGap: 0.6,
      }}>
        <PctLabel pct={awayPct} align="left" />
        <QuickPickTeam
          team={game.away}
          side="away"
          picked={pickedAway}
          dimmed={hasPick && !pickedAway}
          onPick={() => onPick(game.away.teamId)}
        />
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled', px: 0.15, lineHeight: 1 }}>@</Typography>
        <QuickPickTeam
          team={game.home}
          side="home"
          picked={pickedHome}
          dimmed={hasPick && !pickedHome}
          onPick={() => onPick(game.home.teamId)}
        />
        <PctLabel pct={homePct} align="right" />
      </Box>

      {/* Tug-of-war meter: crowd split in team colors, scaling with the vote %.
          The side you picked pulls to full strength so the bar shows the crowd
          lean and your call at once. A hairline gap marks the boundary. */}
      {awayPct !== null && (
        <Box sx={{ display: 'flex', alignItems: 'stretch', height: chromePx(6), gap: chromePx(2) }}>
          <Box sx={{
            width: `${awayPct}%`, minWidth: awayPct > 0 ? chromePx(4) : 0,
            bgcolor: awayCol, opacity: !hasPick ? 0.72 : pickedAway ? 1 : 0.32,
            borderRadius: '999px 3px 3px 999px',
            boxShadow: pickedAway ? `0 0 6px ${awayCol}88` : 'none',
            transition: 'width 0.45s ease, opacity 0.2s',
          }} />
          <Box sx={{
            flex: 1, minWidth: homePct! > 0 ? chromePx(4) : 0,
            bgcolor: homeCol, opacity: !hasPick ? 0.72 : pickedHome ? 1 : 0.32,
            borderRadius: '3px 999px 999px 3px',
            boxShadow: pickedHome ? `0 0 6px ${homeCol}88` : 'none',
            transition: 'opacity 0.2s',
          }} />
        </Box>
      )}
    </Box>
  )
}

// ─── PredictorWidget ──────────────────────────────────────────────────────────

export function PredictorWidget({ onPicksSettled }: {
  // Fires once the slate *and* the user's saved picks have both loaded, with the
  // number of games still awaiting a pick. HomeView uses it to place this card.
  onPicksSettled?: (remaining: number) => void
} = {}) {
  const { user } = useAuth()
  // Fetch the board and the stats sheet once the landing has settled, on the same 4s footing as
  // the section's view warm-up (MlbStats), so the first tap opens them in one commit instead of
  // waiting on the network. They stay out of the landing itself, which is the point of the split.
  useEffect(() => {
    const t = window.setTimeout(() => { import('./PredictorModal').catch(() => {}); import('./PredictionStats').catch(() => {}) }, 4000)
    return () => window.clearTimeout(t)
  }, [])
  const now   = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

  // The slate being shown/picked. Normally today, but once today has no games
  // left to pick (all started or final), it rolls to tomorrow so picks can be
  // made ahead instead of waiting for the date to change. Resolved by the games
  // effect below, which is why it starts at `today`.
  const [slateDate,   setSlateDate]   = useState(today)
  const isTomorrow = slateDate === addDays(today, 1)
  const isLater    = slateDate > addDays(today, 1)
  // Nothing to pick within the lookahead: a postseason waiting on its next matchups, or the winter.
  // `opening` is the next opening day when the league has published it.
  const [idle,        setIdle]        = useState<null | { kind: 'between-rounds' } | { kind: 'offseason'; opening: string | null }>(null)

  const [games,       setGames]       = useState<TodayGame[]>([])
  const [predictions, setPredictions] = useState<Record<number, number>>({})
  const [allVotes,    setAllVotes]    = useState<Record<number, Record<number, number>>>({})
  const [loading,     setLoading]     = useState(true)
  const [modalOpen,   setModalOpen]   = useState(false)
  const [statsOpen,   setStatsOpen]   = useState(false)
  const [username,    setUsername]    = useState<string | null>(null)
  const [heaterStreak, setHeaterStreak] = useState(0)

  // The user's current correct-pick streak, for the heater banner. Read from the
  // leaderboard aggregate (refreshed whenever they open My Stats), so it can lag a
  // little rather than costing a full history recompute on the home card. Re-reads
  // when the stats modal closes, which is when a fresh streak was just written.
  useEffect(() => {
    if (!user) { setHeaterStreak(0); return }
    let cancelled = false
    supabase.from('prediction_stats').select('current_streak').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setHeaterStreak(Number(data?.current_streak ?? 0)) })
    return () => { cancelled = true }
  }, [user, statsOpen])
  // Predictions arrive independently of the slate; both must land before the
  // remaining-picks count means anything.
  const [predsLoaded, setPredsLoaded] = useState(false)

  // Dev-only: when the simulator is enabled, drive the widget off a fabricated
  // slate instead of the real schedule (see devSim.ts). Inert in production:
  // `import.meta.env.DEV` is false there, so this collapses to the real fetch.
  const devSim    = useDevSim()
  const simActive = import.meta.env.DEV && devSim.enabled
  // Dev only: the gear's Winter phase shows the offseason card on any date (see devSeasonPhase.ts).
  const devPhase  = useDevSeasonPhase()
  const devWinter = import.meta.env.DEV && devPhase === 'offseason'

  useEffect(() => {
    if (simActive) { setSlateDate(today); setGames(devSim.games); setLoading(false); return }
    setLoading(true)
    let cancelled = false
    ;(async () => {
      setIdle(null)
      if (devWinter) {
        const opening = (await fetchSeasonDates(CURRENT_SEASON + 1))?.regularSeasonStart ?? null
        if (!cancelled) { setSlateDate(addDays(today, 1)); setGames([]); setIdle({ kind: 'offseason', opening }) }
        return
      }
      const todays = await fetchTodayGames(today)
      // Still something to pick today → show today. Otherwise roll to tomorrow.
      if (todays.some(g => g.state === 'preview')) {
        if (!cancelled) { setSlateDate(today); setGames(todays) }
        return
      }
      const tmr = addDays(today, 1)
      const tmrGames = await fetchTodayGames(tmr)
      if (tmrGames.length) {
        if (!cancelled) { setSlateDate(tmr); setGames(tmrGames) }
        return
      }
      // TOMORROW IS AN OFF DAY. The card used to stop here and say "No upcoming games", which in
      // October was every travel day between two postseason games and read as the season being
      // over. It rolls on to the next day with a game to pick instead, and only when there is none
      // in the lookahead says why: matchups not set yet, or the winter.
      const next = await fetchNextSlateDate(addDays(today, 2))
      if (next) {
        const nextGames = await fetchTodayGames(next)
        if (!cancelled) { setSlateDate(next); setGames(nextGames) }
        return
      }
      const phase = await fetchSeasonPhase(CURRENT_SEASON)
      // The next opening day belongs to the season after the one shown (CURRENT_SEASON stays last
      // season until the new one opens, so in January this is still +1, not the calendar year +1).
      const opening = phase === 'offseason' || phase === 'preseason'
        ? (await fetchSeasonDates(CURRENT_SEASON + (phase === 'offseason' ? 1 : 0)))?.regularSeasonStart ?? null
        : null
      if (!cancelled) {
        setSlateDate(tmr); setGames([])
        setIdle(phase === 'postseason' ? { kind: 'between-rounds' } : { kind: 'offseason', opening })
      }
    })().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today, simActive, devSim.games, devWinter])

  // Load crowd-vote splits up front so the inline quick picks can show
  // percentages (not just when the modal opens). Sim mode uses devSim.votes.
  useEffect(() => {
    if (simActive) return
    fetchVotesByGame(slateDate).then(setAllVotes)
  }, [slateDate, simActive])

  // Votes shown across the widget: the fabricated splits in sim mode, else real.
  const displayVotes = simActive ? devSim.votes : allVotes

  // Look up the user's chosen username (from the `usernames` table) so the
  // predictions leaderboard shows it instead of the email prefix.
  useEffect(() => {
    if (!user) { setUsername(null); return }
    supabase.from('usernames').select('username').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setUsername(data?.username ?? null))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) {
      loadPredsFromSb(user.id, slateDate)
        .then(serverPreds => {
          if (Object.keys(serverPreds).length > 0) {
            setPredictions(serverPreds)
          } else {
            const local = loadLocalPreds(slateDate)
            setPredictions(local)
            Object.entries(local).forEach(([pk, tid]) =>
              savePredToSb(user.id, slateDate, Number(pk), Number(tid))
            )
          }
        })
        .catch(() => setPredictions(loadLocalPreds(slateDate)))
        .finally(() => setPredsLoaded(true))
    } else {
      setPredictions(loadLocalPreds(slateDate))
      setPredsLoaded(true)
    }
  }, [user?.id, slateDate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!modalOpen) return
    if (simActive) return  // don't let the real schedule/votes clobber the sim slate
    // Fetch votes immediately when modal opens
    fetchVotesByGame(slateDate).then(setAllVotes)
  }, [modalOpen, slateDate, simActive])
  // Paused while the tab is hidden and pulled at once on return: see useForegroundInterval.
  useForegroundInterval(() => {
    fetchTodayGames(slateDate).then(updated =>
      setGames(prev => updated.map(u => ({
        ...u,
        home: { ...u.home, pitcher: u.home.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.home.pitcher ?? null },
        away: { ...u.away, pitcher: u.away.pitcher ?? prev.find(p => p.gamePk === u.gamePk)?.away.pitcher ?? null },
      })))
    )
    fetchVotesByGame(slateDate).then(setAllVotes)
  }, modalOpen && !simActive ? 3 * 60_000 : null)

  const handlePick = useCallback((gamePk: number, teamId: number) => {
    const g = games.find(g => g.gamePk === gamePk)
    if (!g || g.state !== 'preview') return
    const prevTeamId = predictions[gamePk]
    setPredictions(prev => ({ ...prev, [gamePk]: teamId }))
    // Optimistically update vote counts
    setAllVotes(prev => {
      const gameV = { ...(prev[gamePk] ?? {}) }
      if (prevTeamId && prevTeamId !== teamId) gameV[prevTeamId] = Math.max(0, (gameV[prevTeamId] ?? 1) - 1)
      if (user) gameV[teamId] = (gameV[teamId] ?? 0) + (prevTeamId ? 0 : 1)  // only add if first pick
      return { ...prev, [gamePk]: gameV }
    })
    saveLocalPred(slateDate, gamePk, teamId)
    if (user) savePredToSb(user.id, slateDate, gamePk, teamId).then(() => fetchVotesByGame(slateDate).then(setAllVotes))
    // Every pick (anon or signed-in) funnels through here, the one clean spot to
    // record engagement with the predictions game. `changed` distinguishes a fresh
    // pick from switching an existing one so both don't read as new activity.
    track(EVENTS.PREDICTION_MADE, { league: 'mlb', gamePk, teamId, changed: prevTeamId != null }, user?.id ?? null)
  }, [games, predictions, slateDate, user])

  const pickedCount       = Object.keys(predictions).length
  const finalized         = games.filter(g => g.state === 'final' && predictions[g.gamePk] !== undefined)
  const correctCount      = finalized.filter(g => predictions[g.gamePk] === g.winnerId).length
  const pct               = finalized.length ? Math.round(correctCount / finalized.length * 100) : null
  // Predicted games not yet decided: "N to go" once results start coming in.
  const pendingPicked     = games.filter(g => g.state !== 'final' && predictions[g.gamePk] !== undefined).length
  const previewGames      = games.filter(g => g.state === 'preview')
  const previewCount      = previewGames.length
  const pickedPreviewCount = previewGames.filter(g => predictions[g.gamePk] !== undefined).length
  const remainingCount    = previewCount - pickedPreviewCount
  const allDone           = games.length > 0 && games.every(g => g.state === 'final')
  const canOpen           = !loading && games.length > 0
  const quickPicks        = previewGames.slice(0, 3)   // up to 3 open matchups to pick inline

  const settled = !loading && predsLoaded
  useEffect(() => {
    if (settled) onPicksSettled?.(remainingCount)
  }, [settled, remainingCount, onPicksSettled])

  // Clicking a "your picks are ready" notification opens the full board here.
  // Queued until the slate has loaded, since opening onto an empty modal would look
  // like the notification lied.
  const [pendingOpen, setPendingOpen] = useState(false)
  useDeepLink('predictor', () => setPendingOpen(true))
  useEffect(() => {
    if (pendingOpen && canOpen) { setModalOpen(true); setPendingOpen(false) }
  }, [pendingOpen, canOpen])

  return (
    <>
      <SectionCard
        icon="🎯"
        title="Predictions"
        titleAdornment={(!loading && remainingCount > 0) || ((isTomorrow || isLater) && !idle) ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {!loading && remainingCount > 0 && (
              <Box sx={{
                width: chromePx(7), height: chromePx(7), borderRadius: '50%', bgcolor: ACCENT, flexShrink: 0,
                animation: 'predPulse 1.6s ease-in-out infinite',
                '@keyframes predPulse': {
                  '0%, 100%': { boxShadow: `0 0 0 0 ${ACCENT}59`, opacity: 1 },
                  '50%':      { boxShadow: `0 0 0 5px ${ACCENT}00`, opacity: 0.65 },
                },
              }} />
            )}
            {(isTomorrow || isLater) && !idle && (
              <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.5), color: 'text.secondary', border: '1px solid', borderColor: 'divider', borderRadius: 999, px: 0.75, py: '1px', whiteSpace: 'nowrap' }}>
                {isTomorrow ? 'Tomorrow' : shortDay(slateDate)}
              </Typography>
            )}
          </Box>
        ) : undefined}
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {user && <CardLink label="Stats" color="text.secondary" onClick={() => setStatsOpen(true)} />}
            {!idle && (
              <CardLink
                label={loading ? '…' : pickedCount === 0 ? 'Make picks' : 'View picks'}
                color={canOpen ? undefined : 'text.disabled'}
                onClick={() => { if (canOpen) setModalOpen(true) }}
              />
            )}
          </Box>
        }
      >
        {/* The body runs to the card's edges, as it did under the old header: the heater banner is
            a full-width band, and every block below carries its own padding. */}
        <Box sx={{ mx: -2, mb: -1.5 }}>
        {/* Heater banner: the user is on a hot correct-pick streak */}
        {heaterStreak >= PREDICTION_HEATER_MIN && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.9,
            bgcolor: '#f9731612', borderBottom: '1px solid', borderColor: 'divider',
          }}>
            <Typography sx={{ fontSize: ICON_SIZE.sm, lineHeight: 1 }}>🔥</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: TONE.orange, lineHeight: 1.2 }}>
              You're on a {heaterStreak}-game heater, keep it rolling
            </Typography>
          </Box>
        )}

        {/* Summary line. A click opens the modal */}
        <Box
          onClick={() => canOpen && setModalOpen(true)}
          sx={{
            px: 2, pt: heaterStreak >= PREDICTION_HEATER_MIN ? 1.25 : 0.5, pb: 1.5,
            cursor: canOpen ? 'pointer' : 'default',
            transition: 'background 0.12s',
            '&:hover': canOpen ? { bgcolor: 'action.hover' } : {},
          }}
        >
          {loading ? (
            // At the size of the summary that replaces it ("3 games left to predict"), so the
            // line under it does not move when the slate lands.
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.4, color: 'text.disabled' }}>Loading the schedule…</Typography>
          ) : idle?.kind === 'between-rounds' ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
              The next games open for picks once their matchups are set.
            </Typography>
          ) : idle?.kind === 'offseason' ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
              {idle.opening
                ? <>Predictions are back on Opening Day, <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>{longDay(idle.opening)}</Box>.</>
                : 'Predictions are back on Opening Day.'}
              {user && ' Your season record is under Stats.'}
            </Typography>
          ) : games.length === 0 ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>No upcoming games</Typography>
          ) : finalized.length > 0 && !allDone ? (
            // Results are coming in: lead with the running record + how many are left.
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: correctCount / finalized.length >= 0.5 ? TONE.green : TONE.red, fontWeight: 800 }}>
                {correctCount} / {finalized.length}
              </Box>
              {' '}correct
              {pendingPicked > 0 && (
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: TYPE_SCALE.meta }}>
                  {' '}· {pendingPicked} to go
                </Box>
              )}
            </Typography>
          ) : previewCount > 0 && remainingCount > 0 ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: ACCENT_TEXT, fontWeight: 800 }}>{remainingCount}</Box>
              {' '}{remainingCount === 1 ? 'game' : 'games'} left to predict
              {pickedPreviewCount > 0 && (
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: TYPE_SCALE.meta }}>
                  {' '}· {pickedPreviewCount}/{previewCount} done
                </Box>
              )}
            </Typography>
          ) : previewCount > 0 ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: TONE.green, fontWeight: 800 }}>✓</Box>
              {' '}All {previewCount === 1 ? 'prediction' : 'predictions'} made
            </Typography>
          ) : allDone && finalized.length > 0 ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4 }}>
              <Box component="span" sx={{ color: correctCount / finalized.length >= 0.5 ? TONE.green : TONE.red, fontWeight: 800 }}>
                {correctCount} / {finalized.length}
              </Box>
              {' '}correct
              {pct !== null && (
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: TYPE_SCALE.meta }}>
                  {' '}· {pct}%
                </Box>
              )}
            </Typography>
          ) : (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled' }}>
              {games.some(g => g.state === 'live') ? 'Games in progress' : 'All games finished'}
            </Typography>
          )}
        </Box>

        {/* While the slate loads, the room one quick-pick row takes, which is the card's shape on
            nearly every day with games. Without it the card grew by a third as the games arrived,
            and on a phone everything under it moved. */}
        {loading && (
          <Box aria-hidden sx={{ px: 2, pb: 1.75, pt: 0.25 }}>
            <Skeleton variant="rounded" sx={{ height: chromePx(51), borderRadius: 2 }} />
          </Box>
        )}

        {/* Inline quick picks: up to 3 open matchups, tap a logo to pick right here */}
        {!loading && quickPicks.length > 0 && (
          <Box sx={{ px: 2, pb: 1.75, pt: 0.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {quickPicks.map(g => (
              <QuickPickRow
                key={g.gamePk}
                game={g}
                prediction={predictions[g.gamePk] ?? null}
                gameVotes={displayVotes[g.gamePk]}
                onPick={teamId => handlePick(g.gamePk, teamId)}
              />
            ))}
            {games.length > quickPicks.length && (
              <Box
                onClick={() => canOpen && setModalOpen(true)}
                sx={{
                  alignSelf: 'center', mt: 0.4, px: 1, py: 0.3,
                  fontSize: TYPE_SCALE.meta, fontWeight: 700, color: ACCENT_TEXT,
                  cursor: 'pointer', borderRadius: 999,
                  '&:hover': { bgcolor: `${ACCENT}12` },
                }}
              >
                Make predictions →
              </Box>
            )}
          </Box>
        )}
        </Box>
      </SectionCard>

      {modalOpen && (
        <Suspense fallback={null}>
          <PredictorModal
            open
            slateDate={slateDate}
            games={games}
            predictions={predictions}
            allVotes={displayVotes}
            onPick={handlePick}
            onClose={() => setModalOpen(false)}
            isSignedIn={!!user}
          />
        </Suspense>
      )}

      {statsOpen && (
        <Suspense fallback={null}>
          <PredictionStatsModal
            open
            userId={user?.id}
            displayName={username ?? user?.email?.split('@')[0] ?? 'Anonymous'}
            onClose={() => setStatsOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}
