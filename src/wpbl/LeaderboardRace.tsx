import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, chromePx, pressable, FOCUS_RING, CARD_BORDER, useWpblDark, hoverOnly } from './ui'
import { wpblAccent } from './constants'
import { shortName } from './Live'
import { countsInStandings } from './season'
import { prefersReducedMotion } from '../lib/motion'
import type { WpblPlayer, WpblTeam, WpblGame, WpblBattingLine, WpblRunValuePlay } from './types'

// The batting leaders, raced across the season.
//
// SeasonShapeCard plots the STANDINGS against the season's dates; this is the same idea one level
// down, on the players: a cumulative leaderboard whose bars grow and swap places from opening day
// to the last regular-season game.
//
// TWO CADENCES, ON PURPOSE. A batter's OWN counting stats (home runs, hits, RBI, extra-base hits)
// tick PLAY BY PLAY: the play log credits the batter on the play, so a hit is a hit the instant it
// happens and the bars flow rather than jumping a whole game at a time. Runs scored and stolen
// bases belong to a RUNNER, not the batter on the play (a run usually scores on a LATER plate
// appearance, a steal is the runner's), so the play log cannot attribute them without matching
// names, which is the fragile path the codebase avoids. Those two stay GAME BY GAME, off the box
// score, and the picker just switches granularity with the stat.
//
// EXACT AT THE END, whichever cadence. The play walk is reconciled to the box score at every game
// boundary (see buildPlay), so a stat the play log slightly under-credits still lands on the box
// score's season total, and the last frame of the race agrees with the leaders table below it.
// Anything else would put two totals for one player on one page.
//
// REGULAR SEASON ONLY, like everything else on this page (see countsInStandings).
//
// THE PIXEL RULES, from CLAUDE.md and invisible when broken. Row height, bar height and the play
// control are STRUCTURE and go through `chromePx`; the name and rank columns RESERVE ROOM FOR A
// STRING and are in rem so they grow with the type; the value that rides the bar tip is type too.

/** Game-cadence playback: the floor where a day stops being a movement, and the whole-run guard so
 *  a far longer season than this one cannot crawl (generous, so the slow speed is honoured). */
const MIN_STEP_MS = 150
const MAX_PLAY_MS = 30000
/** Play-cadence playback: the whole race targets this long at 1×, spread over however many plays
 *  there are, so it flows rather than stepping. Floored low because there are thousands of plays. */
const PLAY_TOTAL_MS = 20000
const PLAY_MIN_STEP = 3

/** Playback speeds the reader can pick. The number multiplies SPEED, so 0.5 halves it and 2
 *  doubles it, on top of whatever cadence the stat's mode sets. */
const SPEEDS: { mult: number; label: string }[] = [
  { mult: 0.5, label: '0.5×' },
  { mult: 1,   label: '1×' },
  { mult: 2,   label: '2×' },
]

/** Rows shown, and the height of each in chrome pixels. Ten fits this reference page without
 *  turning the card into a column; the eleventh name is a click into the leaders table below. */
const ROWS = 10
const ROW_PX = 40
const BAR_PX = 24

/** The widest a bar may grow, as a percent of the track. Short of the full width ON PURPOSE: the
 *  value rides just past the bar's tip, so a leader at the full 100% would push a two-digit total
 *  off the right edge and clip it. Capping the bar leaves exactly that headroom and no more: on a
 *  375px phone the track is ~202px, a two-digit value is ~18px and rides 6px past the tip, so 88%
 *  lands the value flush with the right edge. Measured, not guessed; do not raise without checking
 *  the widest value still fits (see the geometry probe in the leaderboard-race verification). */
const BAR_MAX_PCT = 88

const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run'])
const XBH_EVENTS = new Set(['double', 'triple', 'home_run'])

/** The batter's RBI on a play, from the feed's own narrative ("... 4 RBI ...", or a bare "RBI" for
 *  one). It is the batter's stat and carries on the play she drove them in, unlike the runs, which
 *  are the runners'. Reconciled to the box score per game regardless, so a missed one is topped up. */
const RBI_RE = /(\d+)\s+RBI\b|\bRBI\b/
const parseRbi = (narrative: string | null): number => {
  const m = (narrative ?? '').match(RBI_RE)
  return m ? (m[1] ? +m[1] : 1) : 0
}

type Metric = {
  key: string
  label: string
  mode: 'play' | 'game'
  /** Game-cadence ms per day. Used in game mode, and as the fallback before the play log loads. */
  base: number
  /** The box-score truth for this stat, per line. Reconciled to in play mode, summed in game mode. */
  box: (l: WpblBattingLine) => number
  /** The batter's credit on one play, for play mode. Absent for the runner-owned stats. */
  play?: (p: WpblRunValuePlay) => number
}

const METRICS: Metric[] = [
  { key: 'hr',  label: 'Home runs',       mode: 'play', base: 300, box: l => l.hr,                       play: p => (p.event_type === 'home_run' ? 1 : 0) },
  { key: 'h',   label: 'Hits',            mode: 'play', base: 470, box: l => l.h,                        play: p => (HIT_EVENTS.has(p.event_type ?? '') ? 1 : 0) },
  { key: 'rbi', label: 'RBI',             mode: 'play', base: 450, box: l => l.rbi,                      play: p => parseRbi(p.narrative) },
  { key: 'xbh', label: 'Extra-base hits', mode: 'play', base: 380, box: l => l.doubles + l.triples + l.hr, play: p => (XBH_EVENTS.has(p.event_type ?? '') ? 1 : 0) },
  { key: 'r',   label: 'Runs',            mode: 'game', base: 430, box: l => l.r },
  { key: 'sb',  label: 'Stolen bases',    mode: 'game', base: 340, box: l => l.sb },
]

/** What the render loop reads, whichever cadence built it: how many frames, who is worth a row, the
 *  value for a player at a frame, and the date a frame sits on. */
interface Prepared {
  mode: 'play' | 'game'
  frameCount: number
  ids: string[]
  valueAt: (pid: string, col: number) => number
  dateIso: (col: number) => string
}

const isoOf = (g: { game_date: string }): string => String(g.game_date).slice(0, 10)

/** GAME CADENCE: one frame per playing date, the cumulative box-score total on each. Used for the
 *  runner-owned stats and as the pre-load fallback for the batter stats. */
function buildGame(box: (l: WpblBattingLine) => number, batting: WpblBattingLine[], colOf: Map<string, number>, dates: string[]): Prepared {
  const cum = new Map<string, number[]>()
  for (const l of batting) {
    const c = colOf.get(l.game_id)
    if (c == null) continue
    const v = box(l)
    if (!v) continue
    let a = cum.get(l.player_id)
    if (!a) { a = new Array(dates.length).fill(0); cum.set(l.player_id, a) }
    a[c] += v
  }
  for (const a of cum.values()) for (let i = 1; i < dates.length; i++) a[i] += a[i - 1]
  // The union of everyone who cracks the top ROWS on any one day, so the card renders only the rows
  // that can ever show and a fader keeps its place when it drops off, rather than every player.
  const union = new Set<string>()
  for (let c = 0; c < dates.length; c++) {
    const at: [string, number][] = []
    for (const [id, a] of cum) if (a[c] > 0) at.push([id, a[c]])
    at.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    for (let i = 0; i < Math.min(ROWS, at.length); i++) union.add(at[i][0])
  }
  return {
    mode: 'game', frameCount: dates.length, ids: [...union],
    valueAt: (pid, col) => cum.get(pid)?.[col] ?? 0,
    dateIso: col => dates[col] ?? '',
  }
}

/** PLAY CADENCE: one frame per play, in chronological order, crediting the batter as each hit /
 *  homer / RBI happens, then reconciled to the box score at every game boundary so the season total
 *  is exactly the box score's. A player's value is a step function stored as sparse breakpoints. */
function buildPlay(metric: Metric, plays: WpblRunValuePlay[], batting: WpblBattingLine[], orderedGames: WpblGame[], gameIso: Map<string, string>): Prepared {
  const regGids = new Set(orderedGames.map(g => g.id))

  // The box-score truth per (player, game): the cap a play walk may credit up to, and the target it
  // is reconciled to at the game's end. A player missing here for a game has a zero total there, so
  // a stray play credit is capped to nothing rather than out-counting the box score.
  const boxTot = new Map<string, number>()
  const boxByGame = new Map<string, Set<string>>()
  for (const l of batting) {
    if (!regGids.has(l.game_id)) continue
    const v = metric.box(l)
    if (!v) continue
    boxTot.set(`${l.player_id}|${l.game_id}`, (boxTot.get(`${l.player_id}|${l.game_id}`) ?? 0) + v)
    let s = boxByGame.get(l.game_id)
    if (!s) { s = new Set(); boxByGame.set(l.game_id, s) }
    s.add(l.player_id)
  }

  const byGame = new Map<string, WpblRunValuePlay[]>()
  for (const p of plays) {
    if (!regGids.has(p.game_id)) continue
    let a = byGame.get(p.game_id)
    if (!a) { a = []; byGame.set(p.game_id, a) }
    a.push(p)
  }
  for (const a of byGame.values()) a.sort((x, y) => x.sequence - y.sequence)

  const steps = new Map<string, { f: number; v: number }[]>()
  const push = (pid: string, f: number, v: number) => {
    let a = steps.get(pid)
    if (!a) { a = []; steps.set(pid, a) }
    const tail = a[a.length - 1]
    if (tail && tail.f === f) tail.v = v; else a.push({ f, v })
  }
  // The union, built incrementally: a player can only ENTER the top ROWS on a frame where her OWN
  // value rose (everyone else only rises too, so a still value can only fall in rank), so it is
  // enough to test the one player who just moved.
  const cur = new Map<string, number>()
  const union = new Set<string>()
  const consider = (pid: string, v: number) => {
    cur.set(pid, v)
    if (union.has(pid)) return
    let above = 0
    for (const cv of cur.values()) if (cv > v) { above++; if (above >= ROWS) return }
    union.add(pid)
  }

  const run = new Map<string, number>()
  const frameIso: string[] = []
  let f = 0
  for (const g of orderedGames) {
    const iso = gameIso.get(g.id) ?? ''
    const pids = boxByGame.get(g.id)
    const gplays = byGame.get(g.id) ?? []
    // A game the feed has no plays for still has to fold its box totals into the running total, or
    // every later game's reconciliation starts from the wrong baseline. It just is not a frame.
    if (gplays.length === 0) {
      if (pids) for (const pid of pids) {
        const t = (run.get(pid) ?? 0) + (boxTot.get(`${pid}|${g.id}`) ?? 0)
        run.set(pid, t); consider(pid, t)
      }
      continue
    }
    const gcred = new Map<string, number>()
    for (const p of gplays) {
      frameIso[f] = iso
      const pid = p.batter_id
      if (pid && metric.play) {
        const cap = boxTot.get(`${pid}|${g.id}`) ?? 0
        const next = Math.min((gcred.get(pid) ?? 0) + metric.play(p), cap)
        if (next > (gcred.get(pid) ?? 0)) {
          gcred.set(pid, next)
          const v = (run.get(pid) ?? 0) + next
          push(pid, f, v); consider(pid, v)
        }
      }
      f++
    }
    // Reconcile every player who batted this game to run + her box total, on the game's last frame,
    // and carry that forward. This is what makes the season total exactly the box score's.
    const lastF = f - 1
    if (pids) for (const pid of pids) {
      const target = (run.get(pid) ?? 0) + (boxTot.get(`${pid}|${g.id}`) ?? 0)
      if (target !== (run.get(pid) ?? 0) + (gcred.get(pid) ?? 0)) { push(pid, lastF, target); consider(pid, target) }
      run.set(pid, target)
    }
  }

  const valueAt = (pid: string, col: number): number => {
    const a = steps.get(pid)
    if (!a || a.length === 0) return 0
    let lo = 0, hi = a.length - 1, ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (a[mid].f <= col) { ans = a[mid].v; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }
  return { mode: 'play', frameCount: f, ids: [...union], valueAt, dateIso: col => frameIso[col] ?? '' }
}

export default function LeaderboardRace({ players, games, batting, plays }: {
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  batting: WpblBattingLine[]
  /** The league's plays, in order, for the play-by-play cadence. Optional and allowed to arrive
   *  late: until it does, the batter stats fall back to the game cadence off the box score. */
  plays?: WpblRunValuePlay[]
}) {
  const dark = useWpblDark()
  const reduce = prefersReducedMotion()
  const [metricKey, setMetricKey] = useState('hr')
  const [speed, setSpeed] = useState(1)
  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0]

  // Regular-season finals, and the two views of them the two cadences need: the ordered list of
  // playing dates (game mode) and the ordered list of games (play mode).
  const regGames = useMemo(
    () => games.filter(g => g.status === 'final' && countsInStandings(g)),
    [games],
  )
  const dates = useMemo(() => [...new Set(regGames.map(isoOf))].sort(), [regGames])
  const colOf = useMemo(() => {
    const di = new Map(dates.map((d, i) => [d, i]))
    const m = new Map<string, number>()
    for (const g of regGames) { const c = di.get(isoOf(g)); if (c != null) m.set(g.id, c) }
    return m
  }, [regGames, dates])
  const gameIso = useMemo(() => new Map(regGames.map(g => [g.id, isoOf(g)])), [regGames])
  const orderedGames = useMemo(
    () => regGames.slice().sort((a, b) => { const da = isoOf(a), db = isoOf(b); return da < db ? -1 : da > db ? 1 : (a.id < b.id ? -1 : 1) }),
    [regGames],
  )

  // Colour by the club a player LAST appeared for in a regular final, not the roster's current flag:
  // a traded player wears the club she played the season's end with, matching the standings race.
  const teamOf = useMemo(() => {
    const bestCol = new Map<string, number>()
    const team = new Map<string, string>()
    for (const l of batting) {
      const c = colOf.get(l.game_id)
      if (c == null) continue
      if (!bestCol.has(l.player_id) || c > (bestCol.get(l.player_id) ?? -1)) {
        bestCol.set(l.player_id, c)
        team.set(l.player_id, l.team_id ?? '')
      }
    }
    return team
  }, [batting, colOf])

  const nameOf = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players])

  // The prepared race for the chosen stat. Play cadence when the stat supports it and the plays are
  // here; game cadence otherwise. Rebuilt on a stat switch, which is a click, so the cost is paid
  // when it is asked for rather than up front for all six.
  const prepared = useMemo<Prepared>(() => (
    metric.mode === 'play' && metric.play && plays && plays.length
      ? buildPlay(metric, plays, batting, orderedGames, gameIso)
      : buildGame(metric.box, batting, colOf, dates)
  ), [metric, plays, batting, orderedGames, gameIso, colOf, dates])

  const isPlay = prepared.mode === 'play'
  const last = Math.max(prepared.frameCount - 1, 0)

  // ── Playback, on a rAF clock (frame-boundary steps, and a hidden tab pauses instead of arriving
  // all at once). The cadence is the one thing the two modes differ on: a play race spreads a fixed
  // duration across thousands of plays so it flows; a game race spends the stat's own ms per day.
  const [playCol, setPlayCol] = useState(last)
  const [playing, setPlaying] = useState(false)
  const col = Math.min(Math.max(playCol, 0), last)
  const stepMs = isPlay
    ? Math.max(PLAY_MIN_STEP, PLAY_TOTAL_MS / (Math.max(last, 1) * speed))
    : Math.max(MIN_STEP_MS, Math.min(metric.base / speed, MAX_PLAY_MS / Math.max(last, 1)))

  // Re-seed to the end when the frame count changes under an open tab (a stat switch changes the
  // timeline length, and a game going final grows it), but only for a reader sitting at the present.
  const prevLast = useRef(last)
  useEffect(() => { if (playCol === prevLast.current) setPlayCol(last); prevLast.current = last }, [last, playCol])

  const playColRef = useRef(playCol); playColRef.current = playCol
  const playingRef = useRef(playing); playingRef.current = playing
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const from = playColRef.current
    const t0 = performance.now()
    const tick = (now: number) => {
      const next = from + Math.floor((now - t0) / stepMs)
      if (next >= last) { setPlayCol(last); setPlaying(false); return }
      setPlayCol(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, last, stepMs])

  // Two plain sets, not one nested in the other's updater: a set queued from inside an updater runs
  // in the render phase and React may drop it, which on a fresh load leaves playback stopped before
  // it starts. See SeasonShapeCard's note.
  const play = useCallback(() => {
    if (playingRef.current) { setPlaying(false); return }
    setPlayCol(c => (c >= last ? 0 : c))
    setPlaying(true)
  }, [last])

  if (prepared.frameCount === 0 || prepared.ids.length === 0) return null

  // The frame: rank the rows by their totals now, take the leader as the scale so the bars fill the
  // track and an overtake reads as a real move (the axis rescaling is the point of the form).
  const vals = prepared.ids
    .map(id => [id, prepared.valueAt(id, col)] as [string, number])
    .filter(v => v[1] > 0)
  vals.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const max = vals[0]?.[1] || 1
  const rank = new Map<string, number>()
  vals.forEach(([id], i) => rank.set(id, i))

  const iso = prepared.dateIso(col)
  const dateLabel = iso ? new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''
  const glide = reduce ? 'none' : 'transform .5s cubic-bezier(.34,.02,.2,1), opacity .35s ease'
  // A play race takes tiny steps many times a second, so a long width ease would smear; a short
  // linear one keeps it crisp. A game race takes one big step a beat, so it wants the full glide.
  const barGlide = reduce ? 'none' : isPlay ? 'width .12s linear' : 'width .5s cubic-bezier(.34,.02,.2,1)'
  const valGlide = reduce ? 'none' : isPlay ? 'left .12s linear' : 'left .5s cubic-bezier(.34,.02,.2,1)'

  // Speed is one chip that cycles rather than three that crowd a phone: tap to step 0.5× → 1× → 2×
  // and wrap. The current label rides the chip so the state is still legible at a glance.
  const speedIdx = Math.max(0, SPEEDS.findIndex(s => s.mult === speed))
  const cycleSpeed = () => setSpeed(SPEEDS[(speedIdx + 1) % SPEEDS.length].mult)

  // The three touch controls live together in one toolbar under the title: the stat picker on the
  // left, the speed and play transport on the right. One cluster on both phone and desktop, so there
  // is a single place to reach and nothing renders twice. The date is not here; it rides the scrub at
  // the bottom, since it reads the timeline the scrub drives.
  // Native <select> on purpose: it gets the OS picker on mobile and is keyboard- and
  // screen-reader-first for free, so the six stats cost one control, not a wrapping row of pills.
  const statSelect = (
    <Box sx={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
      <Box
        component="select"
        aria-label="Choose a stat"
        value={metricKey}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMetricKey(e.target.value)}
        sx={{
          ...FOCUS_RING, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          // Room on the right for our own chevron, since the native arrow is suppressed. Height is a
          // full 44px touch target on a phone and compact on desktop; chromePx alone would do the
          // reverse (it scales DOWN on mobile), which is backwards for a tap target. All three
          // controls share these two numbers so the cluster is one size at each breakpoint.
          pl: 1.4, pr: chromePx(26), py: 0, minHeight: { xs: 44, sm: chromePx(30) }, borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'transparent',
          fontSize: '0.82rem', fontWeight: 700, letterSpacing: 0.2, color: 'text.primary',
          // Themes the OS-rendered option list so it is not dark text on a dark sheet.
          colorScheme: dark ? 'dark' : 'light',
          ...hoverOnly({ borderColor: 'text.secondary' }),
        }}
      >
        {METRICS.map(m => (
          <option key={m.key} value={m.key}>{m.label}</option>
        ))}
      </Box>
      <Box aria-hidden sx={{
        position: 'absolute', right: chromePx(12), top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1,
      }}>▾</Box>
    </Box>
  )

  // The day the bars are showing, riding at the right end of the scrub since that is the timeline it
  // reads. The loudest thing on the row: it is what the whole race is a function of, so it carries
  // the accent and the largest type here.
  const dateChip = (
    <Typography aria-hidden sx={{
      fontSize: '1.2rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      fontVariantNumeric: 'tabular-nums', lineHeight: 1, flexShrink: 0,
    }}>{dateLabel}</Typography>
  )

  const speedChip = (
    <Box
      component="button"
      type="button"
      onClick={cycleSpeed}
      aria-label={`Playback speed ${SPEEDS[speedIdx].label}. Tap to change.`}
      sx={{
        ...FOCUS_RING, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        // A comfortable, square-ish tap target: it was the smallest control and the hardest to hit.
        // The fixed min-width also stops it shrinking (and shoving Play) as the label cycles 0.5×/1×.
        minWidth: { xs: 48, sm: chromePx(44) }, minHeight: { xs: 44, sm: chromePx(30) }, px: 1, borderRadius: 999,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'transparent',
        fontSize: '0.72rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'text.secondary',
        ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }),
      }}
    >{SPEEDS[speedIdx].label}</Box>
  )

  const playBtn = (
    <Box {...pressable(play)} aria-label={playing ? 'Pause' : 'Play the race from opening day'} sx={{
      ...FOCUS_RING, cursor: 'pointer', userSelect: 'none', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      minHeight: { xs: 44, sm: chromePx(30) }, px: 1.5, borderRadius: 999,
      border: '1px solid', borderColor: CARD_BORDER,
      fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
    }}>
      <Box component="span" aria-hidden>{playing ? '❚❚' : '▶'}</Box>
      {playing ? 'Pause' : 'Play'}
    </Box>
  )

  return (
    <SectionCard
      bare
      frameless
      title="Batting leaders"
    >
      {/* The control toolbar: every touch control in one place, the same on phone and desktop. Stat
          picker packed left, the speed and play transport packed right, one wide gap between the two
          groups. justify space-between so the two clusters hold the edges and nothing wraps. The
          scrub and its date readout are the separate row at the bottom, near the thumb. */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, minWidth: 0 }}>
        {statSelect}
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
          {speedChip}
          {playBtn}
        </Box>
      </Box>

      {/* The bars. Absolutely-positioned rows keyed by player, each moved by transform and grown by
          width, so React reuses the node and CSS carries the motion. */}
      <Box sx={{ position: 'relative', height: chromePx(ROWS * ROW_PX) }}>
        {prepared.ids.map(id => {
          const r = rank.get(id)
          const on = r != null && r < ROWS
          const v = prepared.valueAt(id, col)
          const color = wpblAccent(teamOf.get(id), dark)
          // Scaled to BAR_MAX_PCT, not 100, so the leader's bar stops short of the edge and the
          // value riding its tip has room. See BAR_MAX_PCT.
          const pct = Math.max(0.5, (v / max) * BAR_MAX_PCT)
          return (
            <Box key={id} sx={{
              position: 'absolute', left: 0, right: 0, height: chromePx(ROW_PX),
              display: 'flex', alignItems: 'center', gap: 1,
              transform: `translateY(${chromePx((on ? r! : ROWS) * ROW_PX)})`,
              opacity: on ? 1 : 0,
              // An off-board row is parked at the container's bottom edge, transparent but still in
              // the DOM. Without this it blankets the scrub and speed controls directly below and
              // eats their clicks: an invisible row is still a clickable one until told otherwise.
              pointerEvents: on ? 'auto' : 'none',
              transition: glide, willChange: 'transform',
            }}>
              {/* Just the name. The placement number and the club dot are both gone: the row's
                  POSITION already ranks it and the bar already carries the club colour, so both were
                  redundant, and dropping them keeps the row clean and hands their width to the bar.
                  RESERVES ROOM FOR A STRING, so it is sized in rem and packed LEFT. The width blends
                  vw (so it tracks screen width) with a rem term and rem bounds, so it GROWS with the
                  reader's text size: a pure-vw column punished a Large-text reader, whose name grew
                  while the box did not, and clipped the longest names. `22vw + 1rem` clears the
                  longest name in the league at phone width; from `sm` up the column caps at 9.5rem. */}
              <Box sx={{
                flex: '0 0 clamp(6rem, calc(22vw + 1rem), 9.5rem)', width: 'clamp(6rem, calc(22vw + 1rem), 9.5rem)',
                display: 'flex', alignItems: 'center', minWidth: 0,
              }}>
                <Typography sx={{
                  fontSize: '0.84rem', fontWeight: 600, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{shortName(nameOf.get(id) ?? '')}</Typography>
              </Box>
              {/* The bar and the value riding its tip. */}
              <Box sx={{ position: 'relative', flex: 1, height: chromePx(BAR_PX), minWidth: 0 }}>
                <Box sx={{
                  position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`,
                  bgcolor: color, borderRadius: chromePx(5), transition: barGlide,
                  boxShadow: '0 1px 0 rgba(255,255,255,0.14) inset',
                }} />
                <Typography aria-hidden sx={{
                  position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(6px,-50%)',
                  fontSize: '0.86rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums',
                  transition: valGlide, whiteSpace: 'nowrap',
                }}>{v}</Typography>
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* The scrub: drag the season, the date reading out at its right end where the leader's value
          also lands. The stat, speed and play controls are all up in the toolbar above the bars; this
          row is the timeline and its readout, nothing to tap but the thumb. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 1.5 }}>
        {/* Scrub. A native range so it is keyboard-first and reads a season by arrow key; touching it
            stops playback, because two things driving one cursor fight the reader. */}
        <Box
          component="input"
          type="range"
          min={0}
          max={last}
          step={1}
          value={col}
          aria-label="Scrub through the season"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPlaying(false); setPlayCol(+e.target.value) }}
          sx={{
            flex: 1, minWidth: chromePx(140), height: chromePx(6), borderRadius: 999, cursor: 'pointer',
            appearance: 'none', WebkitAppearance: 'none', bgcolor: 'action.selected', accentColor: 'var(--wpbl-accent-fg)',
            ...FOCUS_RING,
            '&::-webkit-slider-thumb': {
              WebkitAppearance: 'none', appearance: 'none',
              width: chromePx(16), height: chromePx(16), borderRadius: '50%',
              bgcolor: 'var(--wpbl-accent-fg)', border: '2px solid', borderColor: 'background.paper', cursor: 'pointer',
            },
            '&::-moz-range-thumb': {
              width: chromePx(14), height: chromePx(14), borderRadius: '50%',
              bgcolor: 'var(--wpbl-accent-fg)', border: '2px solid', borderColor: 'background.paper', cursor: 'pointer',
            },
          }}
        />
        {dateChip}
      </Box>
    </SectionCard>
  )
}
