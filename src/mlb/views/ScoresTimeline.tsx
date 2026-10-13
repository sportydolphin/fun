import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TYPE_SCALE, ICON_SIZE, TextGhost } from '../../ui/card'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import { pressable } from '../../ui/interaction'
import { chromePx, typePx } from '../../ui/scale'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { TEAM_BG, CURRENT_SEASON, TONE } from '../constants'
import { bracketLikely } from '../postseason'
import { mlbClubById } from '../routes'
import { gameLink, LINK_SX } from '../lib/links'
import { TeamLogo } from '../components/TeamLogo'
import { anchorIndex, indexOnOrAfter, nextChunk, prevChunk, activeDay, CHUNK } from '../scoresTimeline'
import { fetchTeamSchedule, type ScheduleGame } from './scheduleData'
import { ScoreCard, ScoreCardSkeleton } from './ScoreCard'
import {
  fetchSeasonGameDates, fetchGameDays, fetchFinalGames, fetchGameSummary,
  type FinalGameSummary,
} from './scoresData'

// THE SCORES PAGE AS ONE LIST OF DAYS, oldest at the top. It opens on the most recent day with a
// game under way or done, with the days after it below, so the first screen is the latest result
// and what comes next. Scrolling down loads later days to the end of the schedule; the past is
// above, behind an "Earlier games" row, and loads as the reader scrolls up once they have asked
// for it. Nothing is ever added above the reader without being asked: that is the one move that
// can push what they are reading off the screen, and it only happens behind a tap, with the
// scroll corrected before the frame is painted (see the layout effect on `lo`).
//
// Also Home's fullscreen board, inside a sheet, where the scroller is the sheet rather than the
// window: everything that measures or scrolls goes through `scroller()`.

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

function relative(iso: string): string | null {
  const t = new Date()
  const y = new Date(t); y.setDate(t.getDate() - 1)
  const n = new Date(t); n.setDate(t.getDate() + 1)
  return iso === toISO(t) ? 'Today' : iso === toISO(y) ? 'Yesterday' : iso === toISO(n) ? 'Tomorrow' : null
}

const STATE_ORDER: Record<FinalGameSummary['state'], number> = { live: 0, final: 1, preview: 2, postponed: 3 }

/** The nearest ancestor that scrolls, or null for the window. */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

const GRID_SX = {
  display: 'grid', gap: 1.25,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${chromePx(330)}), 1fr))`,
} as const

// Fixed heights, so each loading state takes exactly the room of what replaces it.
const BAR_H   = `max(${chromePx(52)}, 2.9rem)`
const EDGE_H  = '2.4rem'
const DAY_HEAD_H = '1.6rem'
const MINE_H  = { xs: `max(${chromePx(64)}, 3.6rem)`, sm: `max(${chromePx(44)}, 2.5rem)` }

export function ScoresTimeline({ followedTeamId, date, onDateChange, onGameClick, inSheet = false, showMine = false }: {
  followedTeamId?: number | null
  /** The day to open on (YYYY-MM-DD), null for the default. */
  date?: string | null
  /** Where the day being read goes, for the address. Null when it is the day the page opens on. */
  onDateChange?: (date: string | null) => void
  onGameClick: (game: FinalGameSummary, slate: FinalGameSummary[]) => void
  inSheet?: boolean
  /** The followed club's last and next game, pinned above the list. */
  showMine?: boolean
}) {
  const [days, setDays] = useState<string[] | null>(null)
  const [home, setHome] = useState(-1)             // the default opening day's index
  const [lo, setLo] = useState(0)
  const [hi, setHi] = useState(-1)
  const [data, setData] = useState<Map<string, FinalGameSummary[]>>(() => new Map())
  const [ready, setReady] = useState(false)
  const [upArmed, setUpArmed] = useState(false)
  const [loadingUp, setLoadingUp] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const busyDown = useRef(false)
  const busyUp = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // The date this list last wrote to the address, so the address coming back round as a prop is
  // not taken for Back and a jump.
  const wroteRef = useRef<string | null | undefined>(undefined)
  const scroller = useCallback(() => scrollParentOf(rootRef.current), [])

  const load = useCallback(async (from: number, to: number, list: string[]) => {
    const got = await fetchGameDays(list.slice(from, to + 1))
    setData(prev => { const next = new Map(prev); got.forEach((v, k) => next.set(k, v)); return next })
  }, [])

  // Start (or restart, on a jump) the list at `idx`.
  const startAt = useCallback(async (idx: number, list: string[]) => {
    const to = Math.min(list.length - 1, idx + CHUNK - 1)
    await load(idx, to, list)
    setLo(idx); setHi(to); setUpArmed(false); setReady(true)
    setCurrent(list[idx] ?? null)
  }, [load])

  // First load: the season's game days, today's slate (to tell whether anything has started), then
  // the opening run.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await fetchSeasonGameDates(CURRENT_SEASON)
      if (cancelled) return
      const today = toISO(new Date())
      const todays = list.includes(today) ? await fetchFinalGames(today) : []
      if (cancelled) return
      const started = todays.some(g => g.state === 'live' || g.state === 'final')
      const h = anchorIndex(list, today, started)
      setDays(list); setHome(h)
      if (h < 0) { setReady(true); return }
      await startAt(date ? indexOnOrAfter(list, date) : h, list)
    })()
    return () => { cancelled = true }
    // Once: a later `date` is Back or Forward, handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toTop = useCallback(() => {
    const sc = scroller()
    const top = (rootRef.current?.getBoundingClientRect().top ?? 0) + (sc ? sc.scrollTop - sc.getBoundingClientRect().top : window.scrollY)
    if (sc) sc.scrollTo({ top: Math.max(0, top) })
    else window.scrollTo({ top: Math.max(0, top) })
  }, [scroller])

  const jump = useCallback((iso: string | null) => {
    if (!days) return
    const idx = iso ? indexOnOrAfter(days, iso) : home
    if (idx < 0) return
    const day = days[idx]
    wroteRef.current = idx === home ? null : day
    onDateChange?.(wroteRef.current)
    startAt(idx, days).then(toTop)
  }, [days, home, onDateChange, startAt, toTop])

  // Back and Forward move the address under the page.
  useEffect(() => {
    if (!days || date === undefined || date === wroteRef.current) return
    wroteRef.current = date
    const idx = date ? indexOnOrAfter(days, date) : home
    if (idx >= 0) startAt(idx, days).then(toTop)
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Later days, as the bottom comes into view ───────────────────────────────
  const loadDown = useCallback(async () => {
    if (!days || busyDown.current) return
    const c = nextChunk(days, hi)
    if (!c) return
    busyDown.current = true
    try { await load(c[0], c[1], days); setHi(c[1]) } finally { busyDown.current = false }
  }, [days, hi, load])

  // ─── Earlier days, above, holding the reader's place ─────────────────────────
  const pending = useRef<{ day: string; top: number } | null>(null)
  const loadUp = useCallback(async () => {
    if (!days || busyUp.current) return
    const c = prevChunk(lo)
    if (!c) return
    busyUp.current = true
    setLoadingUp(true)
    try {
      await load(c[0], c[1], days)
      const first = rootRef.current?.querySelector<HTMLElement>(`[data-day="${days[lo]}"]`)
      if (first) pending.current = { day: days[lo], top: first.getBoundingClientRect().top }
      setLo(c[0])
      setUpArmed(true)
    } finally { busyUp.current = false; setLoadingUp(false) }
  }, [days, lo, load])

  useLayoutEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-day="${p.day}"]`)
    if (!el) return
    const delta = el.getBoundingClientRect().top - p.top
    if (!delta) return
    const sc = scroller()
    if (sc) sc.scrollTop += delta
    else window.scrollBy(0, delta)
  }, [lo, scroller])

  // Both edges load on approach rather than on contact, a screen or so ahead. The top one only
  // once the reader has asked for earlier games: at first paint it is in view, and loading then
  // would put a day above the one the page opened on.
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return
    const root = scroller()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        if (e.target === bottomRef.current) loadDown()
        if (e.target === topRef.current && upArmed) loadUp()
      }
    }, { root, rootMargin: '900px 0px 900px 0px' })
    if (bottomRef.current) io.observe(bottomRef.current)
    if (topRef.current) io.observe(topRef.current)
    return () => io.disconnect()
  }, [ready, upArmed, loadDown, loadUp, scroller, hi, lo])

  // ─── The day being read ──────────────────────────────────────────────────────
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ready || !days) return
    const sc = scroller()
    const target: HTMLElement | Window = sc ?? window
    const onScroll = () => {
      const line = (barRef.current?.getBoundingClientRect().bottom ?? 0) + 8
      const tops = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-day]') ?? [])
        .map(el => ({ day: el.dataset.day!, top: el.getBoundingClientRect().top }))
      const day = activeDay(tops, line)
      if (!day) return
      setCurrent(prev => {
        if (prev === day) return prev
        const value = day === days[home] ? null : day
        if (value !== wroteRef.current) { wroteRef.current = value; onDateChange?.(value) }
        return day
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [ready, days, home, onDateChange, scroller])

  // ─── Live scores: today's slate only ─────────────────────────────────────────
  const today = toISO(new Date())
  const todayLoaded = !!days && lo <= days.indexOf(today) && days.indexOf(today) <= hi
  const pollToday = todayLoaded && (data.get(today) ?? []).some(g => g.state === 'live' || g.state === 'preview' || g.delayed)
  useForegroundInterval(() => {
    fetchFinalGames(today).then(g => { if (g.length) setData(prev => new Map(prev).set(today, g)) }).catch(() => {})
  }, pollToday ? 30_000 : null)

  const isMine = useCallback((g: FinalGameSummary) =>
    followedTeamId != null && (g.home.teamId === followedTeamId || g.away.teamId === followedTeamId), [followedTeamId])
  const accent = followedTeamId != null ? TEAM_BG[followedTeamId] ?? undefined : undefined

  const shown = useMemo(() => {
    if (!days || hi < lo) return []
    return days.slice(lo, hi + 1).map(day => ({
      day,
      games: [...(data.get(day) ?? [])].sort((a, b) =>
        Number(isMine(b)) - Number(isMine(a)) || STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.startMs - b.startMs),
    }))
  }, [days, lo, hi, data, isMine])
  const slate = useMemo(() => shown.flatMap(d => d.games), [shown])

  const post = bracketLikely()
  const atEnd = !!days && hi >= days.length - 1

  return (
    <Box ref={rootRef}>
      <DateBar innerRef={barRef} days={days} current={current} homeDay={days && home >= 0 ? days[home] : null}
        onPick={jump} inSheet={inSheet} />

      {showMine && followedTeamId != null && (
        <MineRow teamId={followedTeamId} onOpen={pk => fetchGameSummary(pk).then(g => { if (g) onGameClick(g, slate) })} />
      )}

      {/* The top edge: a tap to start on the past, then a marker the scroll loads through. */}
      <Box ref={topRef} sx={{ height: EDGE_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!ready ? (
          <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}><TextGhost hidden>Earlier games</TextGhost></Typography>
        ) : lo <= 0 ? (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>Start of the season</Typography>
        ) : (
          <Box {...pressable(loadUp)} sx={{
            fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', cursor: 'pointer',
            px: 1.5, py: 0.5, borderRadius: 999, border: '1px solid', borderColor: 'outline',
            '&:hover': { color: 'text.primary' },
          }}>
            {loadingUp ? 'Loading earlier games' : `↑ Earlier games${days ? ` · ${fromISO(days[lo - 1]).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}`}
          </Box>
        )}
      </Box>

      {!ready ? (
        <Box aria-hidden>
          <DayHead day={null} />
          <Box sx={GRID_SX}>
            {Array.from({ length: post ? 4 : 15 }, (_, i) => <ScoreCardSkeleton key={i} postseason={post} />)}
          </Box>
        </Box>
      ) : !days || days.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>No games scheduled this season</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {shown.map(({ day, games }) => (
            <Box key={day} component="section" data-day={day} aria-label={fromISO(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
              <DayHead day={day} />
              <Box sx={GRID_SX}>
                {games.map(g => (
                  <ScoreCard key={g.gamePk} game={g} accent={isMine(g) ? accent : undefined} onClick={() => onGameClick(g, slate)} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* The bottom edge: the next days loading, drawn as a day so their arrival moves nothing. */}
      <Box ref={bottomRef} sx={{ mt: 3 }}>
        {ready && !atEnd && days && days.length > 0 && (
          <Box aria-hidden>
            <DayHead day={null} />
            <Box sx={GRID_SX}>
              {Array.from({ length: post ? 2 : 6 }, (_, i) => <ScoreCardSkeleton key={i} postseason={post} />)}
            </Box>
          </Box>
        )}
        {ready && atEnd && days && days.length > 0 && (
          <Typography sx={{ height: EDGE_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
            End of the schedule
          </Typography>
        )}
      </Box>
    </Box>
  )
}

function DayHead({ day }: { day: string | null }) {
  const rel = day ? relative(day) : null
  return (
    <Typography component="h2" sx={{
      height: DAY_HEAD_H, display: 'flex', alignItems: 'center', gap: 0.75, mb: 1,
      fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1,
    }}>
      {day ? fromISO(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : <TextGhost hidden>Sunday, October 12</TextGhost>}
      {rel && (
        <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: typePx(0.8) }}>
          {rel}
        </Box>
      )}
    </Typography>
  )
}

// ─── The pinned date bar ───────────────────────────────────────────────────────

function DateBar({ innerRef, days, current, homeDay, onPick, inSheet }: {
  innerRef: React.Ref<HTMLDivElement>
  days: string[] | null
  current: string | null
  homeDay: string | null
  onPick: (iso: string | null) => void
  inSheet: boolean
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Keep the day being read in view in the strip. By scrollLeft, never scrollIntoView, which would
  // scroll the page too.
  useEffect(() => {
    const strip = stripRef.current
    const chip = current ? strip?.querySelector<HTMLElement>(`[data-chip="${current}"]`) : null
    if (!strip || !chip) return
    strip.scrollLeft = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2
  }, [current, days])

  return (
    <Box ref={innerRef} sx={{
      position: 'sticky', top: inSheet ? 0 : 'var(--app-header-h, 0px)', zIndex: 4,
      height: BAR_H, display: 'flex', alignItems: 'center', gap: 1, mb: 1,
      bgcolor: inSheet ? 'background.paper' : 'background.default',
      borderBottom: '1px solid', borderColor: 'divider',
    }}>
      <Box ref={stripRef} data-swipe-ignore="true" sx={{
        flex: 1, minWidth: 0, display: 'flex', gap: 0.5, overflowX: 'auto', alignItems: 'center',
        '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none', height: '100%',
      }}>
        {(days ?? []).map(d => {
          const on = d === current
          const dt = fromISO(d)
          return (
            <Box key={d} data-chip={d} {...pressable(() => onPick(d))} aria-current={on ? 'date' : undefined}
              aria-label={dt.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              sx={{
                flexShrink: 0, minWidth: '2.9rem', px: 0.75, py: 0.4, borderRadius: 1.5, cursor: 'pointer', textAlign: 'center',
                bgcolor: on ? 'action.selected' : 'transparent',
                border: '1px solid', borderColor: on ? 'outline' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}>
              <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', lineHeight: 1.1, textTransform: 'uppercase' }}>
                {dt.toLocaleDateString([], { weekday: 'short' })}
              </Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: on ? 800 : 600, color: 'text.primary', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                {dt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* Any date in the season, through the platform's own picker. */}
      <Box sx={{ position: 'relative', flexShrink: 0, width: chromePx(32), height: chromePx(32), display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }}>
        <CalendarMonthOutlined aria-hidden sx={{ fontSize: ICON_SIZE.sm }} />
        <Box component="input" type="date" aria-label="Jump to a date"
          value={current ?? ''} min={days?.[0]} max={days?.[days.length - 1]}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onPick(e.target.value) }}
          sx={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none', p: 0 }} />
      </Box>

      <Box {...pressable(() => onPick(null))} sx={{
        flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', cursor: 'pointer',
        px: 0.9, py: 0.3, borderRadius: 999, border: '1px solid', borderColor: 'outline', whiteSpace: 'nowrap',
        // Held in place when it is not needed, so the strip beside it never changes width.
        visibility: current && homeDay && current !== homeDay ? 'visible' : 'hidden',
        '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
      }}>
        Latest
      </Box>
    </Box>
  )
}

// ─── The followed club ─────────────────────────────────────────────────────────

function MineRow({ teamId, onOpen }: { teamId: number; onOpen: (gamePk: number) => void }) {
  const [games, setGames] = useState<ScheduleGame[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchTeamSchedule(teamId).then(g => { if (!cancelled) setGames(g) }).catch(() => { if (!cancelled) setGames([]) })
    return () => { cancelled = true }
  }, [teamId])
  const last = games ? [...games].reverse().find(g => g.state === 'final') ?? null : null
  const next = games ? games.find(g => g.state === 'live' || g.state === 'preview') ?? null : null
  const name = mlbClubById(teamId)?.name ?? ''
  const vs = (g: ScheduleGame) => `${g.isHome ? 'vs' : 'at'} ${g.opponentAbbr}`
  const when = (g: ScheduleGame) => g.state === 'live' ? 'Live now'
    : `${fromISO(g.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${g.gameTime ? `, ${g.gameTime}` : ''}`

  const half = (label: string, g: ScheduleGame | null, body: React.ReactNode) => (
    <Box {...(g ? gameLink(g.gamePk, () => onOpen(g.gamePk)) : {})} sx={{ ...LINK_SX, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.6, cursor: g ? 'pointer' : 'default' }}>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: typePx(0.6), flexShrink: 0 }}>{label}</Typography>
      <Typography component="span" noWrap sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, minWidth: 0 }}>{body}</Typography>
    </Box>
  )

  return (
    <Box sx={{
      height: MINE_H, display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, mb: 1,
      borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', minWidth: 0,
    }}>
      <TeamLogo teamId={teamId} abbr={name} size={26} decorative />
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 0.5, sm: 2.5 }, alignItems: { xs: 'flex-start', sm: 'center' } }}>
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, display: { xs: 'none', md: 'block' }, flexShrink: 0 }}>{name}</Typography>
        {games == null ? (
          <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.meta }}><TextGhost hidden>Last W 7–4 vs LAD</TextGhost></Typography>
        ) : (
          <>
            {last && half('Last', last, <Box component="span" sx={{ color: last.isWin ? TONE.green : TONE.red }}>
              {last.isWin ? 'W' : 'L'} {last.teamScore}–{last.opponentScore} <Box component="span" sx={{ color: 'text.primary' }}>{vs(last)}</Box>
            </Box>)}
            {next ? half('Next', next, `${when(next)} ${vs(next)}`)
              : half('Next', null, <Box component="span" sx={{ color: 'text.secondary' }}>{bracketLikely() ? 'Season over' : 'Nothing in the next three weeks'}</Box>)}
          </>
        )}
      </Box>
    </Box>
  )
}
