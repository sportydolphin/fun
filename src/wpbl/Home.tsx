import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, Switch } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined } from '@mui/icons-material'
import { useAuth } from '../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './reminders'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblAllPlays, fetchWpblAllTracking, computeStandings,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblAllPlays, getCachedWpblAllTracking, wpblHomeCacheAgeMs,
  fetchWpblVideos, getCachedWpblVideos,
} from './api'
import { wpblColor, wpblAccent, wpblFullName, formatGameTime, gameStartMs, outsToIp, relativeDayLabel, relativeDayShort } from './constants'
import { SectionCard, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, wpblFeatureName, CARD_BORDER, pressable, FOCUS_RING } from './ui'
import { LiveHero } from './Live'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, fmtRate, fmtTwo,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { aggregateTracking, type TrackingBoard } from './tracking'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, fmtDistance, speedUnit, distanceUnit } from '../lib/units'
import { track, EVENTS } from '../lib/analytics'
import { useWpblFavoriteTeam } from './favoriteTeam'
import { useWpblAccent } from './accent'
import { computeFirsts, type WpblFirst } from './firsts'
import { LastGameCard } from './RecapCard'
import { HighlightsRail } from './Highlights'
import type { WpblTeam, WpblPlayer, WpblGame, WpblFirstsPlay, WpblBattingLine, WpblPitchingLine, WpblTrackRow, WpblVideo } from './types'

// WPBL home dashboard (Phase 2). Mirrors the MLB home: a full-width scoreboard strip
// on top, then a two-column card feed (The League / Around the League) that stacks on
// mobile. All content is built from existing WPBL data — schedule, standings, and
// season totals aggregated from box-score lines.

// Rate-leader qualifiers live in stats.ts (`wpblQualifiers`) and scale with the season, so
// the OPS and ERA boards can't fill up with one-game cameos as the schedule goes on.

// ─── Scoreboard ─────────────────────────────────────────────────────────────────

function GameChip({ game, teams, onOpen }: { game: WpblGame; teams: Map<string, WpblTeam>; onOpen: () => void }) {
  const away = teams.get(game.away_team_id)
  const home = teams.get(game.home_team_id)
  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)

  // "Today" / "Yesterday", else "Aug 15" — shared with the schedule's labels so a date reads
  // the same wherever you meet it (relativeDayShort drops the weekday, and Tomorrow, neither
  // of which this chip has room for).
  const dateText = relativeDayShort(game.game_date)
  const timeText = formatGameTime(game.game_date, game.start_time)
  // A final now carries WHEN it was played. The status leads and the date follows, the reverse
  // of an upcoming game, because each puts its own headline first — and because if the line
  // ever has to ellipsise it should lose the date rather than the result. A live game is by
  // definition today, so a date there would be noise.
  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''} · ${dateText}`
    : live ? 'Live'
    : timeText ? `${dateText} · ${timeText}` : dateText

  const isDark = useWpblDark()
  const row = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {/* Winner caret — only on finals, where a fixed-width slot keeps both rows' badges aligned.
          Upcoming/live games omit the slot entirely so the badge sits flush left. */}
      {final && (
        <Box sx={{ width: 7, flexShrink: 0, mx: -0.45, textAlign: 'center', fontSize: '0.85rem', lineHeight: 1, color: wpblAccent(t?.id, isDark) }}>{won ? '▸' : ''}</Box>
      )}
      {t && <TeamBadge team={t} size={20} />}
      <Typography sx={{
        flex: 1, fontSize: '0.8rem', fontWeight: won ? 800 : 600,
        color: won ? 'text.primary' : final ? 'text.secondary' : 'text.primary',
      }}>{t?.abbr ?? '?'}</Typography>
      {(final || live) && (
        <Typography sx={{
          fontSize: '1.05rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          color: won ? 'text.primary' : final ? 'text.disabled' : 'text.primary',
        }}>
          {score ?? '—'}
        </Typography>
      )}
    </Box>
  )

  return (
    <Box onClick={onOpen} sx={{
      // 136, up 4 from the pre-date 132. The eyebrow's longest string went from
      // "Aug 15 · 7:05 PM" to "Final · Yesterday" — one character more, and uppercase letters
      // where the old one had narrow digits — so it needs a little more room than before and
      // nowhere near as much as it first looked like it did.
      flexShrink: 0, width: 136, cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', '&:hover': { borderColor: 'text.disabled' },
    }}>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
        color: live ? '#ef4444' : 'text.secondary',
        // Never wrap: a second line here would make finals taller than upcoming chips and
        // break the strip's alignment. Ellipsis is the backstop for an unforeseen long label.
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {statusText}
      </Typography>
      {row(away, game.away_score, awayWon)}
      {row(home, game.home_score, homeWon)}
    </Box>
  )
}

function Scoreboard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The whole season, played games then everything still to come. It's a scroll strip, so
  // length costs nothing and a reader who wants to look ahead to September can. Anchor on
  // the most recent final so it still OPENS at the "now" boundary — previous game at the
  // left edge, the next/live game right beside it — rather than at either end.
  const { strip, anchorIndex } = useMemo(() => {
    const head = games.filter(g => g.status === 'final')
    const rest = games.filter(g => g.status !== 'final')
    return { strip: [...head, ...rest], anchorIndex: head.length > 0 ? head.length - 1 : 0 }
  }, [games])

  // Edge-fade cues: show a soft mask on whichever side has more chips off-screen, so the
  // cut-off card reads as "swipe for more" rather than a clipped card.
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    setAtStart(c.scrollLeft <= 1)
    setAtEnd(c.scrollLeft + c.clientWidth >= c.scrollWidth - 1)
  }, [])

  // The reader taking the strip over. Set from real input only, never from onScroll — that
  // fires for our own placement too, which would cancel the anchoring on the first frame.
  const takenOverRef = useRef(false)
  const takeOver = useCallback(() => { takenOverRef.current = true }, [])

  // Desktop hover-to-scroll: parking the cursor over either edge glides the strip that way,
  // an alternative to swiping for mouse users who have no visible scrollbar. Runs a rAF loop
  // while hovered and stops itself at whichever end it reaches. Touch devices never trigger
  // this (the zones are hover/fine-pointer only) and keep their swipe.
  const rafRef = useRef<number | null>(null)
  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])
  const startAutoScroll = useCallback((dir: -1 | 1) => {
    takeOver()   // hovering an edge zone to glide the strip is the reader driving it too
    stopAutoScroll()
    const step = () => {
      const c = scrollRef.current
      if (!c) return
      const atEdge = dir < 0 ? c.scrollLeft <= 0 : c.scrollLeft + c.clientWidth >= c.scrollWidth - 1
      if (atEdge) { stopAutoScroll(); syncEdges(); return }
      c.scrollLeft += dir * 8
      syncEdges()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [stopAutoScroll, syncEdges, takeOver])
  useEffect(() => stopAutoScroll, [stopAutoScroll])

  // Put the anchor chip at the container's left edge, and keep putting it there until either
  // the layout stops moving or the reader scrolls.
  //
  // One placement is not enough, however late it is deferred: the chips keep resizing after
  // first paint as their team logos decode and the webfont swaps in, so whatever we measure
  // is a snapshot of a strip that is still growing. That is why the landing spot came out a
  // little different on every reload — it depended on which of those had finished. Instead of
  // guessing a settling time, re-run the placement on each layout change the strip reports.
  // The math is a delta from where the anchor currently sits, so re-running is idempotent:
  // once it is in place the delta is zero and every later call is a no-op.
  //
  // Layout effect, not a plain one, and that matters twice on a reload. A useEffect runs
  // AFTER the browser paints, so the reader got one frame of the strip sitting at scrollLeft
  // 0 — the oldest finals — before it jumped to the anchor, which is the flash of a
  // different running order. It also meant the first syncEdges landed after that paint, so
  // the edge fades popped in a frame late over chips that had already drawn. Running before
  // paint does the placement and the fade state in the same pass, and the reader only ever
  // sees the settled strip. ResizeObserver callbacks are delivered pre-paint too, so the
  // later corrections are invisible the same way.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (!c || strip.length === 0) return

    const place = () => {
      const el = scrollRef.current
      const anchor = el?.children[anchorIndex] as HTMLElement | undefined
      if (!el || !anchor || takenOverRef.current) return
      // Inset the previous game (anchor) from the left edge rather than flush against it, so the
      // edge-fade lands on the older game peeking behind it — the previous game stays fully in
      // view. No inset when it's already the first chip (nothing to its left to peek).
      const inset = anchorIndex > 0 ? 32 : 0
      const delta = anchor.getBoundingClientRect().left - el.getBoundingClientRect().left - inset
      if (Math.abs(delta) > 0.5) el.scrollLeft += delta
      syncEdges()
    }

    place()
    // Watching the chips as well as the container is the point: a logo decoding changes a
    // chip's width without changing the container's.
    const ro = new ResizeObserver(place)
    ro.observe(c)
    for (const chip of Array.from(c.children)) ro.observe(chip)
    return () => ro.disconnect()
  }, [strip, anchorIndex, syncEdges])

  if (strip.length === 0) return null
  return (
    <Box sx={{ mb: 1.5 }}>
      {/* Match the card-title treatment (Next game / Standings / Teams) so every section
          on the feed announces itself the same way, instead of a lone tiny eyebrow. */}
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2, mb: 1 }}>Scoreboard</Typography>
      <Box sx={{ position: 'relative' }}>
        <Box ref={scrollRef} onScroll={syncEdges}
          onPointerDown={takeOver} onWheel={takeOver} onKeyDown={takeOver} sx={{
          display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
          // No scroll-snap: the strip stays wherever it's left rather than locking to a chip when
          // scrolling settles (or when desktop hover-scroll ends). Initial placement is done by
          // scrollLeft in the anchor effect, so it doesn't need snapping.
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }} data-swipe-ignore="true">
          {strip.map(g => <GameChip key={g.id} game={g} teams={teams} onOpen={() => onOpenGame(g)} />)}
        </Box>
        {!atStart && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 6, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to right, ${t.palette.background.default}, transparent)` }} />
        )}
        {!atEnd && (
          <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 6, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to left, ${t.palette.background.default}, transparent)` }} />
        )}
        {/* Hover-to-scroll zones over each edge (desktop only; touch keeps swipe). */}
        {!atStart && (
          <Box onMouseEnter={() => startAutoScroll(-1)} onMouseLeave={stopAutoScroll}
            sx={{ position: 'absolute', left: 0, top: 0, bottom: 6, width: 40, zIndex: 2, cursor: 'w-resize',
              display: 'none', '@media (hover: hover) and (pointer: fine)': { display: 'block' } }} />
        )}
        {!atEnd && (
          <Box onMouseEnter={() => startAutoScroll(1)} onMouseLeave={stopAutoScroll}
            sx={{ position: 'absolute', right: 0, top: 0, bottom: 6, width: 40, zIndex: 2, cursor: 'e-resize',
              display: 'none', '@media (hover: hover) and (pointer: fine)': { display: 'block' } }} />
        )}
      </Box>
    </Box>
  )
}

// ─── Next game + countdown ───────────────────────────────────────────────────────

function Countdown({ target }: { target: number }) {
  const accent = useWpblAccent()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = target - now
  // Compact single-line countdown so it can sit in the card header's top-right instead
  // of a tall block of digit tiles below the matchup. Seconds only tick inside a day.
  const label = (() => {
    if (diff <= 0) return 'Starting soon'
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}h ${p(m)}m ${p(s)}s`
  })()
  return (
    <Box sx={{ flexShrink: 0, px: 1, py: 0.4, borderRadius: 999, bgcolor: 'action.hover' }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: accent, lineHeight: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{label}</Typography>
    </Box>
  )
}

// Build a downloadable .ics so anyone can get a calendar reminder even where Web Push
// isn't available (most mobile browsers) — no account needed. Mirrors the push timing
// with a 30-min-before alarm. Timed event when we know first pitch, else an all-day event.
function makeGameIcs(game: WpblGame, title: string, startMs: number | null): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utc = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sportydolphin//WPBL//EN', 'BEGIN:VEVENT',
    `UID:wpbl-${game.id}@sportydolphin`, `DTSTAMP:${utc(new Date())}`,
  ]
  if (startMs != null) {
    lines.push(`DTSTART:${utc(new Date(startMs))}`, `DTEND:${utc(new Date(startMs + 3 * 3600000))}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${game.game_date.replace(/-/g, '')}`)
  }
  lines.push(`SUMMARY:${title}`)
  if (startMs != null) lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// Opt-in row under the matchup: a Web Push reminder before every WPBL game's first pitch.
//
// It used to opt into THIS game only, one wpbl_game_reminders row at a time, which meant
// coming back to tap it again after every game and no way to say "all of them". It is now a
// standing preference (user_preferences.notify_wpbl_all_games) that the server cron
// (scripts/send-wpbl-game-start.mjs) expands into a reminder for each scheduled game. Old
// per-game rows are still honoured by that sender, so nobody lost one.
//
// Signed out, the whole row prompts sign-in — Web Push is user-scoped, so there's no
// anonymous reminder to store.
function GameReminderRow({ game, away, home, startMs }: {
  game: WpblGame; away?: WpblTeam; home?: WpblTeam; startMs: number | null
}) {
  const accent = useWpblAccent()
  const { user, openAuthDialog } = useAuth()
  const supported  = pushSupported()
  const configured = pushConfigured()

  // Seed from the session cache so a remount (swiping tabs unmounts Home) shows the
  // right switch state on the first frame — no off→on flicker, no per-swipe refetch.
  const [on,   setOn]   = useState(() => (user ? getCachedAllGamesPref() : false))
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(() => !user)
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>('default')
  const [err,  setErr]  = useState('')

  // localStorage paints the right state on the first frame (Home unmounts on every tab
  // swipe), then the account value confirms or corrects it.
  useEffect(() => {
    setErr(''); setPerm(notificationPermission())
    if (!user) { setOn(false); setReady(true); return }
    setOn(getCachedAllGamesPref())
    let cancelled = false
    fetchAllGamesPref(user.id)
      .then(pref => { if (!cancelled && pref !== null) setOn(pref) })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [user?.id])

  const handleToggle = async (next: boolean) => {
    if (!user) { openAuthDialog('signin'); return }
    if (busy) return
    setBusy(true); setErr('')
    const error = await setAllGamesPref(user.id, next)
    if (error) {
      setErr(error)
      // Leave the switch where it was: claiming "on" while nothing can deliver is worse
      // than showing it failed.
      setOn(!next)
    } else {
      setOn(next)
      track(next ? EVENTS.WPBL_GAME_REMINDER_ON : EVENTS.WPBL_GAME_REMINDER_OFF,
        { scope: 'all' }, user.id)
    }
    setPerm(notificationPermission())
    setBusy(false)
  }

  // Where Web Push can't work at all (most mobile browsers, or an unconfigured deploy),
  // don't dead-end on "this browser can't do notifications" — offer a calendar download
  // instead. It needs no account and works everywhere, with the same 30-min heads-up.
  if (!supported || !configured) {
    const title = `${away ? wpblFullName(away) : 'Away'} @ ${home ? wpblFullName(home) : 'Home'} · WPBL`
    return (
      <Box
        onClick={() => downloadIcs(`wpbl-${game.id}.ics`, makeGameIcs(game, title, startMs))}
        sx={{
          mt: 0.75, pt: 1, borderTop: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <EventAvailableOutlined sx={{ fontSize: '1.15rem', flexShrink: 0, color: accent }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>Add to calendar</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.15, lineHeight: 1.35 }}>
            Saves the game with a 30-min heads-up before first pitch.
          </Typography>
        </Box>
      </Box>
    )
  }

  // When signed in, the switch is the control; when signed out, the whole row taps
  // through to sign-in (a switch has nothing to toggle yet).
  const blocked = !!user && (!supported || !configured || perm === 'denied')

  let hint: string
  if (!supported)            hint = 'This browser can’t do notifications.'
  else if (!configured)      hint = 'Notifications aren’t set up on this deployment yet.'
  else if (perm === 'denied') hint = 'Blocked. Turn notifications on for this site in your browser settings.'
  // Kept short on purpose: at 320px the switch leaves about 182px for this line, and a
  // two-line hint under a two-line title makes the row lurch every time it changes.
  else if (!user)            hint = 'Sign in to get a heads-up.'
  else if (busy)             hint = 'Working…'
  else if (on)               hint = 'On · 30 min before each game.'
  else                       hint = 'A push before every WPBL game.'

  const Icon = on ? NotificationsActiveOutlined : NotificationsNoneOutlined

  return (
    <Box
      onClick={!user ? () => openAuthDialog('signin') : undefined}
      sx={{
        mt: 0.75, pt: 1, borderTop: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1,
        ...(!user ? { cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } } : {}),
      }}
    >
      <Icon sx={{ fontSize: '1.15rem', flexShrink: 0, color: on ? accent : 'text.disabled' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>Reminders for every game</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: err ? 'error.main' : 'text.secondary', mt: 0.15, lineHeight: 1.35 }}>
          {err || hint}
        </Typography>
      </Box>
      {user && (
        <Switch
          size="small"
          checked={on}
          disabled={busy || blocked || !ready}
          onChange={e => handleToggle(e.target.checked)}
          sx={{ flexShrink: 0 }}
        />
      )}
    </Box>
  )
}

function NextGameCard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const next = useMemo(() => {
    const now = Date.now()
    const upcoming = games
      .filter(g => g.status !== 'final' && g.status !== 'live')
      .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) }))
      .filter((x): x is { g: WpblGame; ms: number } => x.ms != null)
      .sort((a, b) => a.ms - b.ms)
    // The soonest game still ahead (small grace window), else the earliest upcoming.
    return upcoming.find(x => x.ms >= now - 3 * 3600000) ?? upcoming[0] ?? null
  }, [games])

  if (!next) return null
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = relativeDayLabel(g.game_date)
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  const teamRow = (t: WpblTeam | undefined, side: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {t && <TeamBadge team={t} size={26} />}
      <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: 600 }}>{t ? wpblFullName(t) : '?'}</Typography>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary' }}>{side}</Typography>
    </Box>
  )

  return (
    <SectionCard title="Next game" subtitle={`${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}`} action={<Countdown target={next.ms} />}>
      <Box onClick={() => onOpenGame(g)} sx={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0.75, borderRadius: 1, p: 0.5, mx: -0.5, '&:hover': { bgcolor: 'action.hover' } }}>
        {teamRow(away, 'AWAY')}
        {teamRow(home, 'HOME')}
      </Box>
      <GameReminderRow game={g} away={away} home={home} startMs={next.ms} />
    </SectionCard>
  )
}

// ─── Standings card ─────────────────────────────────────────────────────────────

function StandingsCard({ teams, games, onOpenTeam, favoriteTeamId }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam: (t: WpblTeam) => void
  favoriteTeamId?: string | null
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  return (
    <SectionCard title="Standings">
      <Box sx={{ display: 'flex', px: 0.5, pb: 0.5, fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
        <Box sx={{ flex: 1 }}>Team</Box>
        <Box sx={{ width: 32, textAlign: 'right' }}>W</Box>
        <Box sx={{ width: 32, textAlign: 'right' }}>L</Box>
        <Box sx={{ width: 48, textAlign: 'right' }}>Diff</Box>
      </Box>
      {rows.map(r => {
        const diff = r.runsFor - r.runsAgainst
        return (
          <Box key={r.team.id} onClick={() => onOpenTeam(r.team)} sx={{
            display: 'flex', alignItems: 'center', px: 0.5, py: 0.85, cursor: 'pointer',
            borderTop: '1px solid', borderColor: 'divider', fontVariantNumeric: 'tabular-nums',
            borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <TeamBadge team={r.team} size={24} />
              {/* Nickname only ("Queens", "Firebells") — the badge already carries the
                  city, and the full "Los Angeles Queens" overflows the narrow column on
                  mobile, truncating to the least-useful half ("Los Ang…"). */}
              <Typography sx={{ fontSize: '0.85rem', fontWeight: r.team.id === favoriteTeamId ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.team.name}</Typography>
              {/* The one thing the pick currently DOES, so choosing a team visibly lands
                  somewhere instead of vanishing into a preference nobody can see. The row
                  keeps its place — the table is a standings table, and reordering it around
                  the reader would make it lie about who is in first. */}
              {r.team.id === favoriteTeamId && (
                <Box component="span" aria-label="Your team" title="Your team"
                  sx={{ fontSize: '0.7rem', lineHeight: 1, color: 'text.secondary', flexShrink: 0 }}>★</Box>
              )}
            </Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.wins}</Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.losses}</Box>
            <Box sx={{ width: 48, textAlign: 'right', fontSize: '0.85rem', color: diff > 0 ? 'success.main' : diff < 0 ? 'error.main' : 'text.secondary' }}>
              {diff > 0 ? `+${diff}` : diff}
            </Box>
          </Box>
        )
      })}
    </SectionCard>
  )
}

// ─── Teams card ─────────────────────────────────────────────────────────────────

function TeamsCard({ teams, onOpenTeam }: { teams: WpblTeam[]; onOpenTeam: (t: WpblTeam) => void }) {
  return (
    <SectionCard title="Teams" subtitle="The four founding clubs">
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {teams.map(t => (
          <Box key={t.id} onClick={() => onOpenTeam(t)} sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, cursor: 'pointer',
            borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
            transition: 'border-color 0.15s', '&:hover': { borderColor: wpblColor(t.id) },
          }}>
            <TeamBadge team={t} size={30} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</Typography>
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.city}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}

// ─── Leaders ────────────────────────────────────────────────────────────────────

interface LeaderRow {
  player: WpblPlayer
  display: string
  /** Sample size behind a rate stat ("24 AB", "12.1 IP") — shown so a leaderboard
      topped by a small sample is self-evident rather than misleading. */
  meta?: string
}

// Medal tints for the rank number — gold / silver / bronze, chosen to stay legible in
// both light and dark mode. Ranks past 3rd fall back to the disabled grey.
const RANK_MEDAL = ['#e0a100', '#9aa0a8', '#c17d3f']

// Character budget for the featured rows — every stat-leader rank and every Hall of Firsts
// row. These get a name to themselves, with the team conveyed by the badge/portrait rather
// than by text, so they show names in FULL; the shared useWpblName() cap (12 on a phone) is
// tuned for dense tables and would abbreviate here for no reason.
//
// Sized from the measured boxes, taking the tightest: the leader hero is 220px on mobile and
// 210px on desktop at 14.4px type; ranks 2–3 are 219px at 13.12px. The longest name on any
// roster ("Flor Elena Valerio Montoya", 26 chars) needs 187px / 199px / 170px respectively —
// so 26 clears every current name in every slot, with the desktop hero the binding case.
// Past that, wpblFeatureName() degrades to "F. Rest" and then "F. Surname" instead of
// letting a name be ellipsed mid-word.
const FEATURE_NAME_MAX = 26

function StatBlock({ label, rows, teamById, onOpenPlayer, hideLabel }: {
  label: string; rows: LeaderRow[]; teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void
  hideLabel?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
      {!hideLabel && <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.secondary', mb: 0.4 }}>{label}</Typography>}
      {rows.map((r, i) => {
        const team = teamById.get(r.player.team_id)
        // Rank by the number the reader can actually SEE. Ties on a counting board (two players
        // at 7 RBI, three pitchers at 0.00) used to be ordered by an invisible tiebreak — for
        // hitters, whoever had MORE at-bats, so the player who needed more tries for the same
        // total ranked higher, which reads backwards. Rather than invert that (which would make
        // a counting board assert an efficiency judgement it isn't measuring), tied rows are
        // simply shown as tied: same rank number, same medal. Comparing the formatted display
        // string — not the raw value — is deliberate, so two rows both reading "1.056" are never
        // presented in an order the reader has no way to account for. Sort order within a tie
        // still comes from topBat/topPit and only decides which one is listed first.
        const rank = rows.findIndex(x => x.display === r.display) + 1
        // The #1 leader is the hero: a real headshot, larger name with the full team on a
        // second line, and a bigger value. #2/#3 stay compact — small badge, one line, with
        // the team abbreviation tucked into what was dead space beside the value.
        const isTop = i === 0
        return (
          <Box key={r.player.id} onClick={() => onOpenPlayer(r.player)} sx={{
            display: 'flex', alignItems: 'center', gap: isTop ? 1 : 0.75,
            py: isTop ? 0.55 : 0.4, cursor: 'pointer',
            borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Typography sx={{ width: 14, flexShrink: 0, textAlign: 'center', fontSize: isTop ? '0.8rem' : '0.7rem', fontWeight: 800, color: RANK_MEDAL[rank - 1] ?? 'text.disabled' }}>{rank}</Typography>
            {isTop
              ? <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={38} />
              : (team && <TeamBadge team={team} size={18} />)}
            {/* Name and sample share one baseline-aligned row so the sample sits directly
                after the name, near where the hero's own "· 6.0 IP" falls on its second line.
                Parked at the far right (beside the value) it read as a stray column: three
                samples of different widths, right-aligned, with a ragged gap between each name
                and its own number. The name is the only part allowed to shrink. */}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
              <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: isTop ? '0.95rem' : '0.82rem', fontWeight: isTop ? 800 : 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {wpblFeatureName(r.player.name, FEATURE_NAME_MAX)}
              </Typography>
              {isTop && team && (
                <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {/* "San Francisco Firebells · 6.0 IP" overruns this line on desktop, so when
                      a sample is present the club drops its city — the portrait's team ring and
                      the roster context already carry that, and the sample is the new information. */}
                  {r.meta ? `${team.name} · ${r.meta}` : wpblFullName(team)}
                </Typography>
              )}
              </Box>
              {/* Ranks 2–3 only. No team abbreviation here — the badge to the left already says
                  which club — so this carries just the rate-stat sample (AB / IP), and is absent
                  entirely for counting stats like HR, giving those blocks the widest names.
                  Styled to MATCH the hero's sub-line above: same size, weight, and colour, since
                  it's the same information doing the same job a few pixels away. The bumped
                  weight and letter-spacing this slot used to carry were for the team abbreviation
                  it once held ("LA", "BOS") — devices for uppercase labels, wrong for numerals. */}
              {!isTop && r.meta && (
                <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'text.secondary', flexShrink: 0 }}>
                  {r.meta}
                </Typography>
              )}
            </Box>
            <Typography sx={{ fontSize: isTop ? '1.05rem' : '0.82rem', fontWeight: isTop ? 900 : 800, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right', flexShrink: 0 }}>{r.display}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = 3, meta?: (t: WpblBattingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties break toward the bigger sample (more at-bats).
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.ab - a.totals.ab)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = 3, meta?: (t: WpblPitchingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties (e.g. equal ERA) break toward more innings pitched.
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.outs - a.totals.outs)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}

// ─── Loading placeholders ─────────────────────────────────────────────────────────
// Skeletons shaped like the real rows, so a card reserves its final height while its
// data loads and doesn't grow/jump when the data lands. Replaces the old centered
// spinner (which was much shorter than the loaded card, causing the page to shift).

// Shaped like the loaded LeadersCard — a chip row, then a tall #1 hero (portrait + two
// text lines) over two compact rows — so the card reserves its final height and doesn't
// jump when data lands.
function LeaderStatSkeleton() {
  return (
    <Box>
      {/* Chip row */}
      <Box sx={{ display: 'flex', gap: 0.75, mb: 1.25 }}>
        {[36, 30, 34].map((w, i) => <Skeleton key={i} variant="rounded" width={w} height={22} sx={{ borderRadius: 999 }} />)}
      </Box>
      {/* #1 hero */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.55 }}>
        <Skeleton variant="text" width={10} sx={{ fontSize: '0.8rem' }} />
        <Skeleton variant="circular" width={38} height={38} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="55%" sx={{ fontSize: '0.95rem' }} />
          <Skeleton variant="text" width="40%" sx={{ fontSize: '0.66rem' }} />
        </Box>
        <Skeleton variant="text" width={40} sx={{ fontSize: '1.05rem' }} />
      </Box>
      {/* #2 / #3 compact rows */}
      {[1, 2].map(i => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4 }}>
          <Skeleton variant="text" width={10} sx={{ fontSize: '0.7rem' }} />
          <Skeleton variant="circular" width={18} height={18} />
          <Skeleton variant="text" sx={{ flex: 1, fontSize: '0.82rem' }} />
          <Skeleton variant="text" width={24} sx={{ fontSize: '0.68rem' }} />
          <Skeleton variant="text" width={32} sx={{ fontSize: '0.82rem' }} />
        </Box>
      ))}
    </Box>
  )
}

// A left-icon / two-line / right-value row, used for both the tracking teaser (icon
// tile) and Hall of Firsts (portrait). `size` is the leading circle's diameter.
function TeaserRowSkeleton({ size, py }: { size: number; py: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py, borderTop: '1px solid', borderColor: 'divider' }}>
      <Skeleton variant="circular" width={size} height={size} sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width={84} sx={{ fontSize: '0.6rem' }} />
        <Skeleton variant="text" width="55%" sx={{ fontSize: '0.9rem' }} />
      </Box>
      <Skeleton variant="text" width={36} sx={{ fontSize: '1rem' }} />
    </Box>
  )
}

// One leaderboard at a time (OPS, then HR, RBI…) instead of all three stacked — cuts the
// card's height ~3× on mobile. A chip row selects the category; a horizontal swipe on the
// rows steps between neighbours. Only categories that have data get a chip (an empty HR
// board early in the season simply doesn't appear), mirroring the old stacked behaviour.
function LeadersCard({ title, blocks, loading, hasData, teamById, onOpenPlayer, onViewAll }: {
  title: string; blocks: { label: string; short: string; sortKey: string; rows: LeaderRow[] }[]
  loading: boolean; hasData: boolean; teamById: Map<string, WpblTeam>
  onOpenPlayer: (p: WpblPlayer) => void; onViewAll: (sortKey?: string) => void
}) {
  const accent = useWpblAccent()
  const shown = blocks.filter(b => b.rows.length > 0)
  const [active, setActive] = useState(0)
  const idx = Math.min(active, Math.max(0, shown.length - 1)) // clamp as data loads/changes
  const swipe = useRef({ x: 0, y: 0 })

  const step = (d: number) => setActive(() => Math.max(0, Math.min(shown.length - 1, idx + d)))

  // Reserve the tallest board's height so stepping between a 3-row and a 2-row category
  // doesn't jolt the card. The #1 row is a taller hero (~48px); each of the rest ~26px.
  const maxRows = shown.length ? Math.max(...shown.map(b => b.rows.length)) : 3
  const reservePx = 48 + Math.max(0, maxRows - 1) * 26

  return (
    <SectionCard
      title={title}
      // Carry the board you're actually looking at into the full table — tapping "View all"
      // under the HR board should land on the table sorted by HR, not its default column.
      action={shown.length ? (
        <Typography onClick={() => onViewAll(shown[idx]?.sortKey)} sx={{ fontSize: '0.72rem', fontWeight: 700, color: accent, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <LeaderStatSkeleton />
      ) : !hasData || shown.length === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Leaders appear once games are played.
        </Typography>
      ) : (
        <>
          {/* Category chips — the selector doubles as the block's label. */}
          <Box sx={{ display: 'inline-flex', bgcolor: 'action.hover', borderRadius: 999, p: '3px', mb: 1.25 }}>
            {shown.map((b, i) => (
              <Box
                key={b.label}
                onClick={() => setActive(i)}
                sx={{
                  px: 1.5, py: 0.4, borderRadius: 999, cursor: 'pointer',
                  fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.3,
                  whiteSpace: 'nowrap', userSelect: 'none', transition: 'all 0.15s',
                  bgcolor: i === idx ? accent : 'transparent',
                  color: i === idx ? '#fff' : 'text.secondary',
                  '&:hover': i !== idx ? { color: 'text.primary' } : {},
                }}
              >
                {b.short}
              </Box>
            ))}
          </Box>

          {/* Swipe the rows left/right to change category (commit on release, so vertical
              page scroll is never captured). */}
          <Box
            onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
            onTouchEnd={e => {
              const dx = e.changedTouches[0].clientX - swipe.current.x
              const dy = e.changedTouches[0].clientY - swipe.current.y
              if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
            }}
            sx={{ minHeight: `${reservePx}px` }}
          >
            <StatBlock key={shown[idx].label} label={shown[idx].label} rows={shown[idx].rows} teamById={teamById} onOpenPlayer={onOpenPlayer} hideLabel />
          </Box>
        </>
      )}
    </SectionCard>
  )
}

// ─── Tracking teaser ──────────────────────────────────────────────────────────────
// A three-stat teaser for the Tracking tab: the season's fastest pitch, hardest-hit
// ball, and longest tracked hit. Radar coverage is partial, so these are "bests we
// measured," not absolutes (the full tab carries that caveat). A stat gets a "New" pill
// when its record was set on the most recent game day.

interface TeaserTile {
  icon: string; label: string; value: string; unit: string
  name: string; player: WpblPlayer | null; teamId: string | null; isNew: boolean
}

function TrackingTeaserCard({ board, latestGameIds, loading, teamById, onOpenPlayer, onViewAll }: {
  board: TrackingBoard; latestGameIds: Set<string>; loading: boolean
  teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void; onViewAll: () => void
}) {
  const accent = useWpblAccent()
  const isDark = useWpblDark()
  const { units } = useUnits()
  const shortName = useWpblName()
  const fp = board.fastestPitches[0]
  const hh = board.hardestHits[0]
  const lh = board.longestHits[0]
  const tiles: TeaserTile[] = []
  if (fp) tiles.push({ icon: '🔥', label: 'Fastest pitch', value: fmtSpeed(fp.velo, units), unit: speedUnit(units), name: fp.name, player: fp.player, teamId: fp.teamId, isNew: latestGameIds.has(fp.gameId) })
  if (hh && hh.exit != null) tiles.push({ icon: '💥', label: 'Hardest hit', value: fmtSpeed(hh.exit, units), unit: speedUnit(units), name: hh.name, player: hh.player, teamId: hh.teamId, isNew: latestGameIds.has(hh.gameId) })
  if (lh && lh.distance != null) tiles.push({ icon: '🚀', label: 'Longest hit', value: fmtDistance(lh.distance, units), unit: distanceUnit(units), name: lh.name, player: lh.player, teamId: lh.teamId, isNew: latestGameIds.has(lh.gameId) })

  return (
    <SectionCard
      title="Ballpark tracking"
      subtitle="Season bests, measured by in-park radar"
      action={tiles.length > 0 ? (
        <Typography onClick={onViewAll} sx={{ fontSize: '0.72rem', fontWeight: 700, color: accent, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <>{[0, 1, 2].map(i => <TeaserRowSkeleton key={i} size={22} py={0.7} />)}</>
      ) : tiles.length === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Tracking data appears once games are played.
        </Typography>
      ) : (
        tiles.map(t => {
          const team = t.teamId ? teamById.get(t.teamId) : undefined
          const clickable = !!t.player
          return (
            <Box
              key={t.label}
              onClick={clickable ? () => onOpenPlayer(t.player!) : undefined}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, py: 0.7,
                borderTop: '1px solid', borderColor: 'divider',
                borderRadius: 1, ...(clickable ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
              }}
            >
              <Box sx={{ fontSize: '1.05rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{t.icon}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>{t.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                  {team && <TeamBadge team={team} size={18} />}
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(t.name)}</Typography>
                  {t.isNew && (
                    <Box sx={{ flexShrink: 0, px: 0.6, py: 0.1, borderRadius: 1, bgcolor: wpblAccent(t.teamId ?? '', isDark), color: '#fff', fontSize: '0.55rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>New</Box>
                  )}
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography component="span" sx={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                <Typography component="span" sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', ml: 0.4 }}>{t.unit}</Typography>
              </Box>
            </Box>
          )
        })
      )}
    </SectionCard>
  )
}

// ─── Hall of Firsts ───────────────────────────────────────────────────────────────

function FirstRow({ f, teamById, onOpenPlayer, showDetail }: {
  f: WpblFirst; teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void; showDetail?: boolean
}) {
  const team = f.teamId ? teamById.get(f.teamId) : undefined
  const dateLabel = new Date(`${f.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const clickable = !!f.player
  return (
    <Box
      onClick={clickable ? () => onOpenPlayer(f.player!) : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, py: 0.85,
        borderTop: '1px solid', borderColor: 'divider',
        borderRadius: 1, ...(clickable ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
      }}
    >
      <PlayerPortrait name={f.name} teamId={f.teamId ?? ''} size={42} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
          {f.icon} {f.label}
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wpblFeatureName(f.name, FEATURE_NAME_MAX)}</Typography>
        {showDetail && f.detail && (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.detail}</Typography>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        {team && <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary' }}>{team.abbr}</Typography>}
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{dateLabel}</Typography>
      </Box>
    </Box>
  )
}

// The home card rotates through EVERY first (not just the featured handful): every ~30s the
// top row slides up and out, the rest shift up, and the next first enters at the bottom, so the
// card always feels fresh. It shows a 4-row window; the full static list lives behind "View all".
const FIRSTS_WINDOW = 4
const FIRSTS_INTERVAL = 30000

function HallOfFirstsCard({ firsts, teamById, loading, onOpenPlayer, onViewAll }: {
  firsts: WpblFirst[]; teamById: Map<string, WpblTeam>; loading: boolean
  onOpenPlayer: (p: WpblPlayer) => void; onViewAll: () => void
}) {
  const accent = useWpblAccent()
  // Lead with the featured firsts, then the rest, so the card opens on the marquee milestones
  // and rotates through everything else from there.
  const pool = useMemo(
    () => [...firsts].sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order),
    [firsts],
  )
  const n = pool.length
  const rotates = n > FIRSTS_WINDOW

  const [start, setStart] = useState(0)
  const [sliding, setSliding] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(0)

  // Measure a row so the window can be height-clamped and the slide distance is exact.
  useLayoutEffect(() => {
    const first = listRef.current?.children[0] as HTMLElement | undefined
    if (first) setRowH(first.offsetHeight)
  }, [pool])

  // Seed a random starting first once the pool loads, so the card opens on a different one
  // each visit instead of always the featured lead.
  const seeded = useRef(false)
  useEffect(() => {
    if (start >= n && n > 0) setStart(0)
    if (!seeded.current && n > 0) { seeded.current = true; setStart(Math.floor(Math.random() * n)) }
  }, [n, start])

  // Every interval, slide the window up one row, then commit the advance a beat after the
  // animation ends. The commit is timer-driven (not animationend-driven) on purpose: it stays
  // reliable when the tab is backgrounded or the user prefers reduced motion, cases where the
  // animation may not run or fire its end event. The reset is seamless — a window slid up by
  // one row looks identical to the next window at rest.
  const SLIDE_MS = 550
  useEffect(() => {
    if (!rotates || rowH === 0) return
    let commitTimer: ReturnType<typeof setTimeout>
    const id = setInterval(() => {
      setSliding(true)
      commitTimer = setTimeout(() => {
        setSliding(false)
        setStart(s => (s + 1) % n)
      }, SLIDE_MS + 20)
    }, FIRSTS_INTERVAL)
    return () => { clearInterval(id); clearTimeout(commitTimer) }
  }, [rotates, rowH, n])

  // When rotating, render one extra row below the fold — it's what slides into view.
  const rows = rotates
    ? Array.from({ length: FIRSTS_WINDOW + 1 }, (_, i) => pool[(start + i) % n])
    : pool.slice(0, FIRSTS_WINDOW)

  return (
    <SectionCard
      title="Hall of Firsts"
      action={n > 0 ? (
        <Typography onClick={onViewAll} sx={{ fontSize: '0.72rem', fontWeight: 700, color: accent, cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <>{[0, 1, 2, 3].map(i => <TeaserRowSkeleton key={i} size={42} py={0.85} />)}</>
      ) : n === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', py: 1 }}>
          Milestones appear as the season's firsts happen.
        </Typography>
      ) : (
        <Box sx={{ overflow: 'hidden', height: rotates && rowH ? FIRSTS_WINDOW * rowH : 'auto' }}>
          <Box
            ref={listRef}
            sx={{
              '--hof-row': rowH ? `-${rowH}px` : '0px',
              '@keyframes hofSlideUp': { to: { transform: 'translateY(var(--hof-row))' } },
              animation: sliding && rowH ? `hofSlideUp ${SLIDE_MS}ms ease forwards` : 'none',
            }}
          >
            {/* Keyed by slot index so DOM nodes are reused across the seamless reset. */}
            {rows.map((f, i) => <FirstRow key={i} f={f} teamById={teamById} onOpenPlayer={onOpenPlayer} />)}
          </Box>
        </Box>
      )}
    </SectionCard>
  )
}

function FirstsModal({ firsts, teamById, onClose, onOpenPlayer }: {
  firsts: WpblFirst[]; teamById: Map<string, WpblTeam>; onClose: () => void; onOpenPlayer: (p: WpblPlayer) => void
}) {
  return (
    <ModalShell eyebrow="Hall of Firsts" onClose={onClose} maxWidth={520}>
      <Box sx={{ px: 2, py: 1 }}>
        {firsts.length === 0 ? (
          <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', py: 3, textAlign: 'center' }}>
            No milestones yet. They appear as the season's firsts happen.
          </Typography>
        ) : (
          firsts.map(f => <FirstRow key={f.key} f={f} teamById={teamById} onOpenPlayer={onOpenPlayer} showDetail />)
        )}
      </Box>
    </ModalShell>
  )
}

// ─── New-tracking banner ──────────────────────────────────────────────────────────
// The league publishes TrackMan tracking in batches that land days after a game, often in
// bulk for several games at once (see wpbl-ingest's late-backfill note). When the set of
// games that carry tracking grows beyond what this browser last saw, surface a dismissible
// banner pointing to the Ballpark Tracking section. First-ever visit seeds silently (no
// nag); the "new" state clears once the user views or dismisses it.

const TRACK_SEEN_KEY = 'wpbl:trackingSeenGames'

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TRACK_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writeSeen(ids: Iterable<string>) {
  try { localStorage.setItem(TRACK_SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode / quota — non-fatal */ }
}

// Returns how many newly-tracked games appeared since this browser last acknowledged, and
// an ack() that marks the current tracked set as seen. Waits for tracking to load before
// judging (size 0 = not loaded yet), and seeds silently on a first visit.
function useNewTrackingBatch(tracking: WpblTrackRow[]): { newCount: number; ack: () => void } {
  const trackedIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tracking) if (t.game_id) set.add(t.game_id)
    return set
  }, [tracking])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (trackedIds.size === 0) return // tracking not loaded yet — don't seed on an empty set
    const seen = readSeen()
    if (seen.length === 0) { writeSeen(trackedIds); setNewCount(0); return } // first visit: seed, no banner
    const seenSet = new Set(seen)
    let added = 0
    for (const id of trackedIds) if (!seenSet.has(id)) added++
    setNewCount(added)
  }, [trackedIds])

  const ack = () => { writeSeen(trackedIds); setNewCount(0) }
  return { newCount, ack }
}

function NewTrackingBanner({ count, onView, onDismiss }: { count: number; onView: () => void; onDismiss: () => void }) {
  const accent = useWpblAccent()
  return (
    <Box
      onClick={onView}
      role="button"
      sx={{
        mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: accent,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
        transition: 'background-color 0.15s',
        '&:hover': { bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' },
      }}
    >
      <Box sx={{ fontSize: '1.35rem', lineHeight: 1, flexShrink: 0 }}>📡</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2 }}>
          New pitch-tracking data just landed
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
          Velocity, spin &amp; exit velo for {count} new game{count === 1 ? '' : 's'} — tap to explore Ballpark Tracking.
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: accent, flexShrink: 0, whiteSpace: 'nowrap' }}>
        View →
      </Typography>
      <Box
        onClick={e => { e.stopPropagation(); onDismiss() }}
        role="button"
        aria-label="Dismiss"
        sx={{
          flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.secondary', fontSize: '0.85rem', lineHeight: 1,
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        }}
      >
        ✕
      </Box>
    </Box>
  )
}

// Community invite — links out to the WPBL fan Discord. Styled in Discord's blurple
// so it reads as "join the chat" at a glance, but kept to one slim row so it sits
// under the scoreboard without crowding the actual content.
const DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'
const DISCORD_BLURPLE = '#5865F2'
const DISCORD_DISMISS_KEY = 'wpbl_discord_dismissed'

function DiscordCard({ onDismiss }: { onDismiss: () => void }) {
  // Dismissal is remembered (localStorage) and owned by the parent, which only mounts this card
  // when it hasn't been dismissed — so once closed it stays gone and leaves no empty slot behind.
  // Count one impression per mount, i.e. only for users who actually see the card.
  useEffect(() => { track(EVENTS.DISCORD_SHOWN) }, [])
  const dismiss = () => {
    track(EVENTS.DISCORD_DISMISSED)
    try { localStorage.setItem(DISCORD_DISMISS_KEY, '1') } catch { /* private mode / quota — non-fatal */ }
    onDismiss()
  }
  return (
    <Box
      component="a"
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track(EVENTS.DISCORD_JOINED)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25,
        textDecoration: 'none', cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: `${DISCORD_BLURPLE}66`,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(88,101,242,0.09)' : 'rgba(88,101,242,0.06)',
        transition: 'background-color 0.15s, border-color 0.15s',
        '&:hover': {
          bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(88,101,242,0.18)' : 'rgba(88,101,242,0.12)',
          borderColor: DISCORD_BLURPLE,
        },
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: DISCORD_BLURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: 19, height: 19 }}>
          <path fill="#fff" d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2, color: 'text.primary' }}>
          Join the WPBL fan Discord
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
          Live game chats and more.
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0, px: 1.5, py: 0.6, borderRadius: 999, bgcolor: DISCORD_BLURPLE, color: '#fff', fontSize: '0.75rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
        Join
      </Box>
      <Box
        onClick={e => { e.preventDefault(); e.stopPropagation(); dismiss() }}
        role="button"
        aria-label="Dismiss Discord invite"
        sx={{
          flexShrink: 0, width: 22, height: 22, ml: 0.25,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.disabled', fontSize: '0.8rem', lineHeight: 1,
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        }}
      >
        ✕
      </Box>
    </Box>
  )
}

// Pick-your-team prompt — one slim row, four taps' worth of choice, and a ✕ that means
// "no favourite" for good.
//
// Restraint is the whole design here. It renders only on Home, only until it is answered
// either way, and never while the Discord card is up: two dismissible asks stacked on the
// same screen is the nagging this is meant to avoid. Choosing nothing is a real answer that
// leaves every view exactly as it is today, so it is offered as plainly as the teams are —
// no dark-pattern asymmetry where the decline is a grey whisper next to a bright CTA.
function FavoriteTeamCard({ teams, onPick, onDecline }: {
  teams: WpblTeam[]
  onPick: (teamId: string) => void
  onDecline: () => void
}) {
  // One impression per mount, matching how the Discord card counts, so the two are
  // comparable in the admin dashboard.
  useEffect(() => { track(EVENTS.WPBL_FAVORITE_PROMPTED) }, [])
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1.25 }, p: 1.25,
      borderRadius: 2, border: '1.5px solid', borderColor: 'divider',
      bgcolor: 'background.paper',
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.2 }}>
          Pick your team
        </Typography>
        {/* Says only what the pick actually does today. Worth keeping honest as this grows:
            if the favourite starts driving the scoreboard or reminders, update this line —
            promising more than it delivers is how a small opt-in loses trust. */}
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
          We&rsquo;ll highlight them. Skip and nothing changes.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        {teams.map(t => (
          <Box
            key={t.id}
            {...pressable(() => onPick(t.id))}
            aria-label={`Set ${wpblFullName(t)} as your team`}
            sx={{ ...FOCUS_RING, borderRadius: '50%', lineHeight: 0, cursor: 'pointer' }}
          >
            <TeamBadge team={t} size={28} />
          </Box>
        ))}
      </Box>
      <Box
        {...pressable(onDecline)}
        aria-label="No favourite team"
        sx={{
          ...FOCUS_RING,
          flexShrink: 0, width: 22, height: 22, ml: 0.25,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.disabled', fontSize: '0.8rem', lineHeight: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        }}
      >
        ✕
      </Box>
    </Box>
  )
}

// ─── Home ───────────────────────────────────────────────────────────────────────

// ─── Ingest health (admin-only) ──────────────────────────────────────────────────
// The feed-mirror ingest freshness indicator lives in the site Admin panel now
// (consolidated with the payroll/contract freshness) — see AdminPanel's "WPBL Ingest".

export default function WpblHome({ teams, games, liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewStats, onViewTracking }: {
  teams: WpblTeam[]
  games: WpblGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  onViewStats: (group: 'hitting' | 'pitching', sortKey?: string) => void
  onViewTracking: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Leaders + Hall-of-Firsts + tracking data — fetched here so only the home view pays for
  // it. Seeded from the shared session cache so swiping back to Home (the default tab, so
  // the most re-entered) repaints instantly instead of flashing every card's skeleton and
  // re-pulling all four datasets — including the heavy play-by-play read.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblFirstsPlay[]>(() => getCachedWpblAllPlays() ?? [])
  const [tracking, setTracking] = useState<WpblTrackRow[]>(() => getCachedWpblAllTracking() ?? [])
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)
  const [firstsOpen, setFirstsOpen] = useState(false)
  // Discord dismissal is tracked here (not inside DiscordCard) so a dismissed invite leaves no
  // empty wrapper in the left column — otherwise the column's row-gap would keep pushing the
  // Next game card down, out of line with the top of the right column (Batting Leaders).
  const [discordDismissed, setDiscordDismissed] = useState(() => {
    try { return localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { return false }
  })

  // The reader's team. `answered` (not the id) gates the prompt, so "no favourite" sticks.
  const teamIds = useMemo(() => new Set(teams.map(t => t.id)), [teams])
  const { favoriteTeamId, answered, setFavorite } = useWpblFavoriteTeam(teamIds)
  const accent = useWpblAccent()
  // Never two asks at once — the Discord invite gets the slot first, and this one waits for
  // the screen to be free. Also waits on `teams` so the badges don't pop in one by one.
  const showFavoritePrompt = !answered && teams.length > 0 && discordDismissed

  // Full load once, then revalidate on later mounts only when the cache is cold or stale —
  // a quick swipe back to a warm Home is instant and silent. Players are static for the
  // session; lines/plays/tracking seed the leaders, Hall of Firsts, and tracking teaser.
  useEffect(() => {
    if (wpblHomeCacheAgeMs() < 30_000) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblAllPlays(), fetchWpblAllTracking()])
      .then(([p, l, pl, tr]) => {
        if (cancelled) return
        setPlayers(p); setLines(l); setPlays(pl); setTracking(tr); setLoadingLeaders(false)
      })
      .catch(() => { if (!cancelled) setLoadingLeaders(false) })
    return () => { cancelled = true }
  }, [])

  // Highlights are their own small read (the wpbl_videos mirror), deduped + cached by the
  // api layer, so a swipe-back repaints from cache and this just revalidates in the
  // background. Kept separate from the leaders load so it can't gate or flash those cards.
  useEffect(() => {
    let cancelled = false
    fetchWpblVideos().then(v => { if (!cancelled) setVideos(v) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [])

  // While a game is live, refresh only the box-score lines + play-by-play (what the leaders
  // and Hall of Firsts read), and on a gentle cadence. Deliberately NOT re-pulled on the
  // tick: the full player roster (static) and the whole pitch_tracking table (large) — that
  // repeated full-table scan every 25s was the main load pegging the WPBL database. The
  // tracking teaser shows season bests, which barely move within a single game; it refreshes
  // on the next visit.
  useEffect(() => {
    if (!liveGame) return
    let cancelled = false
    const id = setInterval(() => {
      Promise.all([fetchWpblAllLines(), fetchWpblAllPlays()])
        .then(([l, pl]) => { if (!cancelled) { setLines(l); setPlays(pl) } })
        .catch(() => { /* keep last-good */ })
    }, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [liveGame?.id])

  const firsts = useMemo(() => computeFirsts(plays, games, players, lines.pitching), [plays, games, players, lines.pitching])

  const trackingBoard = useMemo(() => aggregateTracking(tracking, players, lines.pitching), [tracking, players, lines.pitching])
  // Game ids from the most recent day that has a final — used to flag a record as "New".
  const latestGameIds = useMemo(() => {
    const finals = games.filter(g => g.status === 'final' && g.game_date)
    if (finals.length === 0) return new Set<string>()
    const maxDate = finals.reduce((m, g) => (g.game_date > m ? g.game_date : m), finals[0].game_date)
    return new Set(finals.filter(g => g.game_date === maxDate).map(g => g.id))
  }, [games])

  // Hide the tracking teaser once the league's radar publish falls materially behind the
  // schedule. Tracking is a manual league batch that has stalled for stretches (see
  // wpbl-ingest's late-backfill note), and showing 8-day-old "season bests" as if current
  // is worse than showing nothing. The card returns on its own when a fresh batch lands —
  // ingest backfills automatically. Grace of 3 days absorbs the normal next-day publish lag.
  // Pre-season (no finals yet) is NOT stale: the card keeps its friendly "coming soon" state.
  const trackingStale = useMemo(() => {
    const finals = games.filter(g => g.status === 'final' && g.game_date)
    if (finals.length === 0) return false
    const latestFinal = finals.reduce((m, g) => (g.game_date > m ? g.game_date : m), finals[0].game_date)
    const trackedIds = new Set(tracking.map(t => t.game_id))
    const trackedDates = games.filter(g => trackedIds.has(g.id) && g.game_date).map(g => g.game_date)
    if (trackedDates.length === 0) return true // finals exist but nothing is tracked yet
    const latestTracked = trackedDates.reduce((m, d) => (d > m ? d : m), trackedDates[0])
    const lagDays = (Date.parse(`${latestFinal}T00:00:00Z`) - Date.parse(`${latestTracked}T00:00:00Z`)) / 86_400_000
    return lagDays > 3
  }, [games, tracking])

  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting), [players, lines.batting])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching), [players, lines.pitching])

  // Only enforce the 5 AB / 3 IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  const battingBlocks = useMemo(() => [
    { label: 'OPS',       short: 'OPS', sortKey: 'ops', rows: topBat(batSeasons, t => t.ops, t => fmtRate(t.ops), t => !qual.active || t.ab >= qual.minAb, 3, t => `${t.ab} AB`) },
    { label: 'Home runs', short: 'HR',  sortKey: 'hr',  rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',       short: 'RBI', sortKey: 'rbi', rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons, qual])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        short: 'ERA', sortKey: 'era', rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtTwo(t.era), t => !qual.active || t.outs >= qual.minOuts, 3, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Strikeouts', short: 'K',   sortKey: 'so',  rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0, 3, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Innings',    short: 'IP',  sortKey: 'ip',  rows: topPit(pitSeasons, t => t.outs, t => outsToIp(t.outs), t => t.outs > 0) },
  ], [pitSeasons, qual])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(tracking)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Team masthead — a gradient wash behind the header and scoreboard, fading out into
          the normal page. Absolutely positioned and pointer-events:none so it colours the
          top of the section without getting between the reader and anything up there.
          Full-bleed via the negative inline inset: the section is a 720px column, and a
          band that stopped at the column edge would read as a stray coloured rectangle
          rather than as the page's own header.
          Built from the accent, not the team's primary — all four primaries are near-black
          (Queens is literally #000000), so a primary-based band would be a black smear for
          one club and near-invisible in dark mode for the rest. */}
      {favoriteTeamId && (
        <Box aria-hidden sx={{
          position: 'absolute', top: 0, left: { xs: -16, sm: -24 }, right: { xs: -16, sm: -24 },
          height: 260, pointerEvents: 'none', zIndex: 0,
          // A radial dome rather than a linear band: a linear gradient stops at the
          // element's edges, and since this is only bled a little past the 720px column
          // that left a visible vertical seam down each side. The radial falls off
          // horizontally as well as vertically, so it has no edge to see.
          background: theme => `radial-gradient(125% 100% at 50% 0%, ${accent}${theme.palette.mode === 'dark' ? '33' : '26'} 0%, transparent 72%)`,
        }} />
      )}
      {/* Everything below sits above the wash. */}
      <Box sx={{ position: 'relative', zIndex: 1 }}>
      {/* Slim league header. On mobile it's just the title; on wider screens the club chips
          sit inline to the right. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 }, mb: 1.5,
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1.15 }}>
            Women's Pro Baseball League
          </Typography>
        </Box>
        {/* Team chips: badge + abbreviation in a tappable pill so they read as controls (not
            decoration) on touch, where there's no hover. Ring adopts the club colour on hover,
            and a press-scale gives tactile feedback. Each jumps to that team's page. Hidden on
            mobile — the chips are redundant there with the full Teams tab a swipe away. */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {teams.map(t => (
            <Box
              key={t.id}
              onClick={() => onOpenTeam(t)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.6,
                pl: '3px', pr: 0.9, py: '3px', borderRadius: 999,
                cursor: 'pointer', userSelect: 'none',
                border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
                transition: 'border-color 0.15s, transform 0.1s',
                '&:hover': { borderColor: wpblColor(t.id) },
                '&:active': { transform: 'scale(0.94)' },
              }}
            >
              <TeamBadge team={t} size={24} />
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: 0.3 }}>{t.abbr}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* New pitch-tracking batch just published — point folks to the Tracking section */}
      {newTrackingCount > 0 && (
        <NewTrackingBanner count={newTrackingCount} onView={viewTracking} onDismiss={ackTracking} />
      )}

      {/* Live game hero — the one in-progress game, front and center */}
      {liveGame && <LiveHero game={liveGame} teams={teams} onOpen={() => onOpenGame(liveGame)} />}

      {/* Scoreboard */}
      <Scoreboard games={games} teams={teamMap} onOpenGame={onOpenGame} />
      </Box>

      {/* Two-column feed. On desktop the two columns render as written (The League |
          Around the League). On mobile there's one column, so the two wrappers collapse to
          `display: contents` and every card becomes a direct grid item — then CSS `order`
          sets the single-column sequence independently of which desktop column a card lives
          in. That lets Hall of Firsts drop below the season leaders and Teams sit dead last
          on mobile, while desktop keeps Hall of Firsts and Teams below the leaders in the
          right column. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
        columnGap: 2.5, rowGap: 1.5, alignItems: 'start',
      }}>
        {/* The League */}
        <Box sx={{ minWidth: 0, display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 1.5 }}>
          {!discordDismissed && (
            <Box sx={{ minWidth: 0, order: { xs: 1, md: 0 } }}><DiscordCard onDismiss={() => setDiscordDismissed(true)} /></Box>
          )}
          {showFavoritePrompt && (
            <Box sx={{ minWidth: 0, order: { xs: 1, md: 0 } }}>
              <FavoriteTeamCard
                teams={teams}
                onPick={id => { setFavorite(id); track(EVENTS.WPBL_FAVORITE_SET, { teamId: id, from: 'home_prompt' }) }}
                onDecline={() => { setFavorite(null); track(EVENTS.WPBL_FAVORITE_CLEARED, { from: 'home_prompt' }) }}
              />
            </Box>
          )}
          <Box sx={{ minWidth: 0, order: { xs: 2, md: 0 } }}><NextGameCard games={games} teams={teamMap} onOpenGame={onOpenGame} /></Box>
          <Box sx={{ minWidth: 0, order: { xs: 3, md: 0 } }}><LastGameCard games={games} teams={teamMap} players={players} onOpenGame={onOpenGame} /></Box>
          {/* Highlights rail — sits under the Next game card in the left column on desktop,
              and directly below it in the mobile stack. Self-hides when the feed is empty
              (pre-migration / no uploads), so it never leaves an empty slot or gap. */}
          {videos.length > 0 && (
            <Box sx={{ minWidth: 0, order: { xs: 3, md: 0 } }}><HighlightsRail videos={videos} teams={teams} /></Box>
          )}
          <Box sx={{ minWidth: 0, order: { xs: 4, md: 0 } }}><StandingsCard teams={teams} games={games} onOpenTeam={onOpenTeam} favoriteTeamId={favoriteTeamId} /></Box>
        </Box>

        {/* Around the League */}
        <Box sx={{ minWidth: 0, display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 1.5 }}>
          {/* Mobile: below the season leaders (orders 5–6), above only Teams.
              Desktop: md order 1 drops it below the leaders (md 0) in this column. */}
          <Box sx={{ minWidth: 0, order: { xs: 8, md: 1 } }}><HallOfFirstsCard firsts={firsts} teamById={teamMap} loading={loadingLeaders} onOpenPlayer={onOpenPlayer} onViewAll={() => setFirstsOpen(true)} /></Box>
          {/* Only reserve the tracking slot (skeleton included) when tracking will actually
              show. Gating on the loading flag too would flash a skeleton on cold load and then
              yank the card once it resolves stale — which it now essentially always is, since
              tracking data exists for only the first couple games. Its loading placeholder
              stays accurate by not appearing at all when there's nothing to place. */}
          {!trackingStale && (
            <Box sx={{ minWidth: 0, order: { xs: 5, md: 0 } }}><TrackingTeaserCard board={trackingBoard} latestGameIds={latestGameIds} loading={loadingLeaders} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={viewTracking} /></Box>
          )}
          <Box sx={{ minWidth: 0, order: { xs: 6, md: 0 } }}><LeadersCard title="Batting Leaders" blocks={battingBlocks} loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={sortKey => onViewStats('hitting', sortKey)} /></Box>
          <Box sx={{ minWidth: 0, order: { xs: 7, md: 0 } }}><LeadersCard title="Pitching Leaders" blocks={pitchingBlocks} loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer} onViewAll={sortKey => onViewStats('pitching', sortKey)} /></Box>
          {/* Teams sits at the bottom of the right column on desktop (md order 2, under the
              leaders and Hall of Firsts) — it doesn't need the wide left column. Mobile keeps
              it as the last card in the whole feed. */}
          <Box sx={{ minWidth: 0, order: { xs: 9, md: 2 } }}><TeamsCard teams={teams} onOpenTeam={onOpenTeam} /></Box>
        </Box>
      </Box>

      {firstsOpen && (
        <FirstsModal firsts={firsts} teamById={teamMap} onClose={() => setFirstsOpen(false)} onOpenPlayer={onOpenPlayer} />
      )}
    </Box>
  )
}
