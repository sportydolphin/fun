import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, Switch } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined } from '@mui/icons-material'
import { useAuth } from '../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './reminders'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblAllTracking, computeStandings,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblAllTracking, wpblHomeCacheAgeMs,
  fetchWpblVideos, getCachedWpblVideos,
  fetchWpblArticles, getCachedWpblArticles,
  fetchWpblPhotos, getCachedWpblPhotos,
} from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblFullName, formatGameTime, gameStartMs, outsToIp, relativeDayLabel, relativeDayShort } from './constants'
import { SectionCard, PillGroup, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, wpblFeatureName, CARD_BORDER } from './ui'
import { LiveHero } from './Live'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, fmtRate, fmtTwo, fmtSigned,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { track, EVENTS } from '../lib/analytics'
import { LastGameCard } from './RecapCard'
import MediaShelf from './MediaShelf'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblTrackRow, WpblVideo, WpblArticle, WpblPhoto } from './types'

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
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = target - now
  // Seconds only tick inside a day; past a day they would be noise under a number that
  // barely moves.
  const label = (() => {
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}h ${p(m)}m ${p(s)}s`
  })()
  // Sized and weighted as Last Game's headline, because it occupies the same slot in the
  // same shape of card: the one sentence that says what this game IS right now. It was a
  // chip in the header's top-right, which is where a card puts an afterthought, and the
  // clock is the only thing Next game knows that nothing else on the page does.
  //
  // `tabular-nums` on the digits alone. The whole line would set "First pitch in" on a
  // monospace grid too, and the seconds place re-renders every tick, so without it the
  // sentence would twitch sideways once a second.
  return (
    <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>
      {diff <= 0 ? 'Starting soon' : <>
        First pitch in{' '}
        <Box component="span" sx={{ color: 'var(--wpbl-accent-fg)', fontVariantNumeric: 'tabular-nums' }}>{label}</Box>
      </>}
    </Typography>
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
        <EventAvailableOutlined sx={{ fontSize: '1.15rem', flexShrink: 0, color: 'var(--wpbl-accent-fg)' }} />
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
      <Icon sx={{ fontSize: '1.15rem', flexShrink: 0, color: on ? WPBL_ACCENT : 'text.disabled' }} />
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

// Head-to-head record between two clubs this season. Deliberately filtered the same way
// `computeStandings` filters, decisive finals only, so the series line and the standings
// table sitting beside it can never tell a reader two different stories about the same games.
// Null before the two have met, which is a real state early in a season and reads better as
// nothing than as "0–0".
function seasonSeries(games: WpblGame[], homeId: string, awayId: string): { homeWins: number; awayWins: number } | null {
  let homeWins = 0, awayWins = 0
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    const involvesBoth = (g.home_team_id === homeId && g.away_team_id === awayId)
      || (g.home_team_id === awayId && g.away_team_id === homeId)
    if (!involvesBoth) continue
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    if (winner === homeId) homeWins++; else awayWins++
  }
  return homeWins + awayWins === 0 ? null : { homeWins, awayWins }
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

  // Records through `computeStandings` rather than a local count, so the two numbers on these
  // rows are the same two numbers the Standings card renders beside them. A card that
  // disagrees with the table next to it is worse than a card with no records at all.
  const recordOf = useMemo(() => {
    const rows = computeStandings([...teams.values()], games)
    const by = new Map(rows.map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, games])

  if (!next) return null
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = relativeDayLabel(g.game_date)
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  // Not memoised: one pass over a 30-game season, and Countdown holds its own tick state, so
  // this card only re-renders when its data actually changes.
  const series = seasonSeries(games, g.home_team_id, g.away_team_id)
  let seriesLabel: string | null = null
  if (series && home && away) {
    const { homeWins, awayWins } = series
    // Nicknames, matching the standings table next to it rather than the full club names on
    // the rows above: "Boston Hunters lead the season series" says the city twice in one card.
    if (homeWins === awayWins) seriesLabel = `Season series tied ${homeWins}–${awayWins}`
    else seriesLabel = `${homeWins > awayWins ? home.name : away.name} lead the season series `
      + `${Math.max(homeWins, awayWins)}–${Math.min(homeWins, awayWins)}`
  }

  // Deliberately the same row as LastGameCard's `scoreRow`: same badge size, same name size
  // and weight, same trailing number in the same slot at the same size. The two cards sit one
  // above the other in the same column, and the only honest difference between them is that
  // one row's number is a final score and the other's is a record.
  const teamRow = (t: WpblTeam | undefined, side: string) => {
    const record = t ? recordOf(t.id) : null
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {t && <TeamBadge team={t} size={26} />}
        {/* Ellipsis as the final net, which LastGameCard's otherwise-identical row does not
            need: its trailing number is one or two digits, this one is a four-glyph record, and
            those extra pixels are what tips "San Francisco Firebells" onto a second line at
            320px. A row that silently doubles in height on one matchup is worse than a name
            that runs out of room on the narrowest phone we support. */}
        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t ? wpblFullName(t) : '?'}</Typography>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>{side}</Typography>
        {record && (
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'text.secondary', flexShrink: 0 }}>
            {record}
          </Typography>
        )}
      </Box>
    )
  }

  return (
    <SectionCard title="Next game" subtitle={`${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}`} fill>
      {/* Laid out as LastGameCard is, tier for tier: the two team rows, then one line at
          headline weight saying what the game is right now, then a quieter line of context,
          then a rule and the row you can act on. Everything inside the clickable block is a
          fact about THIS game, so it all opens the game, the way the team rows already did.

          `flex: 1` + centred absorbs whatever height Standings forces on this card, splitting
          it above and below rather than dropping it in one hole. With the card nearly full it
          is a few pixels either side, but it keeps the card even if the series line drops out,
          which it does the first time two clubs meet. */}
      <Box onClick={() => onOpenGame(g)} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 1, p: 0.5, mx: -0.5, '&:hover': { bgcolor: 'action.hover' } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
          {teamRow(away, 'AWAY')}
          {teamRow(home, 'HOME')}
        </Box>
        <Countdown target={next.ms} />
        {seriesLabel && (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.35 }}>
            {seriesLabel}
          </Typography>
        )}
      </Box>
      <GameReminderRow game={g} away={away} home={home} startMs={next.ms} />
    </SectionCard>
  )
}

// ─── Standings card ─────────────────────────────────────────────────────────────

function StandingsCard({ teams, games, onOpenTeam }: {
  teams: WpblTeam[]; games: WpblGame[]; onOpenTeam: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  return (
    <SectionCard title="Standings" fill>
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
            // Share out whatever height the row's other card forces on this one. A table
            // absorbs that as taller rows, not as a slab under the last club: the rules stay
            // attached to the rows they belong to and the whole thing just breathes. `py` is
            // still the floor, so nothing collapses when there is no slack to share.
            flex: 1,
          }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <TeamBadge team={r.team} size={24} />
              {/* Nickname only ("Queens", "Firebells") — the badge already carries the
                  city, and the full "Los Angeles Queens" overflows the narrow column on
                  mobile, truncating to the least-useful half ("Los Ang…"). */}
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.team.name}</Typography>
            </Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.wins}</Box>
            <Box sx={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{r.losses}</Box>
            <Box sx={{ width: 48, textAlign: 'right', fontSize: '0.85rem', color: diff > 0 ? 'var(--wpbl-pos)' : diff < 0 ? 'var(--wpbl-neg)' : 'text.secondary' }}>
              {fmtSigned(diff)}
            </Box>
          </Box>
        )
      })}
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
// Themed, because the originals measure 2.27 / 2.64 / 3.35 against a light background. The
// comment above claimed both modes and only dark was ever true. See styles.css.
const RANK_MEDAL = ['var(--wpbl-medal-1)', 'var(--wpbl-medal-2)', 'var(--wpbl-medal-3)']

// Character budget for the featured rows: every stat-leader rank. These get a name to
// themselves, with the team conveyed by the badge/portrait rather than by text, so they show
// names in FULL; the shared useWpblName() cap (12 on a phone) is tuned for dense tables and
// would abbreviate here for no reason.
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
  // A column rather than a plain block, so when Home stretches the Leaders card to match the one
  // beside it the leftover height is shared out between the rows instead of pooling as a slab
  // under the last one. A handful of pixels per gap reads as comfortable row spacing; the same
  // pixels in one lump read as the card having run out of things to say.
  //
  // Only for a FULL board. The board reserves the tallest category's height so stepping between
  // categories doesn't jolt the card, which means a short category (three players with a home
  // run in the season's first week) is already sitting in a box built for five. Spreading two
  // rows across that would put eighty pixels between them and look broken; leaving them packed
  // at the top is merely quiet, which is the right failure.
  const spread = rows.length >= LEADER_ROWS
  return (
    <Box sx={{
      mb: 1.25, '&:last-of-type': { mb: 0 },
      ...(spread ? { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } : {}),
    }}>
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

// How many names a Home leader board lists. Five rather than three because Home pairs this
// card with Last Game in a shared-height row, and three names left the card about 90px short
// of the one beside it. That gap had to be filled with something, and two more leaders is the
// only filling that is worth a reader's time: the alternative was 90px of margin. Five also
// happens to be the shape of a leaderboard people expect. Raising it further starts to make
// Leaders the taller card in the row, which just moves the gap into Last Game.
const LEADER_ROWS = 5

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = LEADER_ROWS, meta?: (t: WpblBattingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties break toward the bigger sample (more at-bats).
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.ab - a.totals.ab)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = LEADER_ROWS, meta?: (t: WpblPitchingTotals) => string): LeaderRow[] {
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

// One leaderboard at a time (OPS, then HR, RBI…) instead of all three stacked — cuts the
// card's height ~3× on mobile. A chip row selects the category; a horizontal swipe on the
// rows steps between neighbours. Only categories that have data get a chip (an empty HR
// board early in the season simply doesn't appear), mirroring the old stacked behaviour.
/**
 * The leaders card. One card for batting AND pitching, switched by the group control.
 *
 * They were two cards until the Discord promo left the left column at two cards against the
 * right's three, and no column ratio closes a 211px gap between cards whose heights are set by
 * their content. Merging them is the version that both closes it and leaves Home with one
 * fewer thing on it: the two were the same card twice, three rows each, differing only in
 * which six categories they offered.
 */
function LeadersCard({ title, groups, loading, hasData, teamById, onOpenPlayer }: {
  title: string
  groups: {
    key: string
    label: string
    blocks: { label: string; short: string; sortKey: string; rows: LeaderRow[] }[]
    onViewAll: (sortKey?: string) => void
  }[]
  loading: boolean; hasData: boolean; teamById: Map<string, WpblTeam>
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  // Only groups with something in them. Early in a season pitching can have boards before
  // batting does, and a control offering an empty half is worse than no control.
  const liveGroups = groups.filter(g => g.blocks.some(b => b.rows.length > 0))
  const [group, setGroup] = useState(0)
  const gIdx = Math.min(group, Math.max(0, liveGroups.length - 1))
  const current = liveGroups[gIdx]
  const onViewAll = current?.onViewAll ?? (() => {})

  const shown = (current?.blocks ?? []).filter(b => b.rows.length > 0)
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
      fill
      // Carry the board you're actually looking at into the full table — tapping "View all"
      // under the HR board should land on the table sorted by HR, not its default column.
      action={shown.length ? (
        <Typography onClick={() => onViewAll(shown[idx]?.sortKey)} sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--wpbl-accent-fg)', cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
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
          {/* Both selectors on one row: the half of the game on the left, the statistic within
              it on the right. They were stacked, which read as a hierarchy that isn't there and
              cost the card a second band of chrome above a three-row board. Opposite ends of
              one row says the same thing about them being different questions, in one band.
              They fit: two groups of short labels come to roughly 260px of the ~490px column,
              and `flexWrap` stacks them again on a phone rather than crushing either.

              Switching halves resets the statistic, since "HR" has no counterpart on the
              pitching side and carrying the index across would land on whatever sat third. */}
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 1, rowGap: 1, flexWrap: 'wrap', mb: 1.25,
          }}>
            {liveGroups.length > 1 && (
              <PillGroup
                options={liveGroups.map(g => ({ value: g.key, label: g.label }))}
                value={current.key}
                onChange={v => { setGroup(liveGroups.findIndex(g => g.key === v)); setActive(0) }}
              />
            )}
            {/* Category chips. The selector doubles as the block's label. */}
            <PillGroup
              options={shown.map(b => ({ value: b.label, label: b.short }))}
              value={shown[idx].label}
              onChange={v => setActive(shown.findIndex(b => b.label === v))}
            />
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
            // `reservePx` is the floor, `flex: 1` the ceiling. Leaders is the shorter of the
            // two cards in its row and the row now stretches both to a shared height, so the
            // difference has to land somewhere: below the last leader, inside the board, is
            // the only place it reads as margin rather than as a gap in the card.
            sx={{ minHeight: `${reservePx}px`, flex: 1 }}
          >
            <StatBlock key={shown[idx].label} label={shown[idx].label} rows={shown[idx].rows} teamById={teamById} onOpenPlayer={onOpenPlayer} hideLabel />
          </Box>
        </>
      )}
    </SectionCard>
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
  return (
    <Box
      onClick={onView}
      role="button"
      sx={{
        mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: WPBL_ACCENT,
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
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)', flexShrink: 0, whiteSpace: 'nowrap' }}>
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

  // Leaders + tracking data, fetched here so only the home view pays for it. Seeded from the
  // shared session cache so swiping back to Home (the default tab, so the most re-entered)
  // repaints instantly instead of flashing every card's skeleton and re-pulling all three
  // datasets.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [tracking, setTracking] = useState<WpblTrackRow[]>(() => getCachedWpblAllTracking() ?? [])
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])
  const [photos, setPhotos] = useState<WpblPhoto[]>(() => getCachedWpblPhotos() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)

  // Full load once, then revalidate on later mounts only when the cache is cold or stale:
  // a quick swipe back to a warm Home is instant and silent. Players are static for the
  // session; lines seed the leaders, and tracking drives the new-batch banner.
  useEffect(() => {
    if (wpblHomeCacheAgeMs() < 30_000) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblAllTracking()])
      .then(([p, l, tr]) => {
        if (cancelled) return
        setPlayers(p); setLines(l); setTracking(tr); setLoadingLeaders(false)
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

  // The reading feed, on the same terms as the highlights above: its own small cached read,
  // kept out of the leaders load so a slow Substack sync can never gate or flash those cards.
  useEffect(() => {
    let cancelled = false
    fetchWpblArticles().then(a => { if (!cancelled) setArticles(a) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [])

  // The archive gallery, on the same terms again. This one is the least urgent read on the
  // page by a distance: the table is a curated set that changes when someone approves a
  // photograph, which is weeks apart, so it must never be able to gate anything else.
  useEffect(() => {
    let cancelled = false
    fetchWpblPhotos().then(p => { if (!cancelled) setPhotos(p) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [])

  // While a game is live, refresh only the box-score lines (what the leaders read), and on a
  // gentle cadence. Deliberately NOT re-pulled on the tick: the full player roster (static)
  // and the whole pitch_tracking table (large). That repeated full-table scan every 25s was
  // the main load pegging the WPBL database. Tracking now only feeds the new-batch banner,
  // and the league publishes it in batches days after a game, so a live tick could not
  // surface anything new anyway; it refreshes on the next visit.
  //
  // The whole-season play-by-play used to be pulled here too, for the Hall of Firsts. That
  // card is gone, and with it the most expensive read on the section: nothing on Home needs
  // play-by-play now.
  useEffect(() => {
    if (!liveGame) return
    let cancelled = false
    const id = setInterval(() => {
      fetchWpblAllLines()
        .then(l => { if (!cancelled) setLines(l) })
        .catch(() => { /* keep last-good */ })
    }, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [liveGame?.id])


  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting), [players, lines.batting])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching), [players, lines.pitching])

  // Only enforce the 5 AB / 3 IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  const battingBlocks = useMemo(() => [
    { label: 'OPS',       short: 'OPS', sortKey: 'ops', rows: topBat(batSeasons, t => t.ops, t => fmtRate(t.ops), t => !qual.active || t.ab >= qual.minAb, LEADER_ROWS, t => `${t.ab} AB`) },
    { label: 'Home runs', short: 'HR',  sortKey: 'hr',  rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',       short: 'RBI', sortKey: 'rbi', rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons, qual])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        short: 'ERA', sortKey: 'era', rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtTwo(t.era), t => !qual.active || t.outs >= qual.minOuts, LEADER_ROWS, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Strikeouts', short: 'K',   sortKey: 'so',  rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0, LEADER_ROWS, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Innings',    short: 'IP',  sortKey: 'ip',  rows: topPit(pitSeasons, t => t.outs, t => outsToIp(t.outs), t => t.outs > 0) },
  ], [pitSeasons, qual])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(tracking)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  return (
    <Box>
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

      {/* Two columns: today's games on the left, the season's numbers on the right.

          EVEN TRACKS, and three up was tried and rejected. Laying the season cards out as a
          row of three gives each 317px at this page's width, and at 317px the standings table
          clips every club name and both leader boards clip every player name. Two columns at
          490px clip nothing. A tidier bottom edge is not worth reading "Meggie Meidling…".

          SUBGRID, so the two columns share their ROW boundaries. As two independent flex
          columns they only agreed at the top: Next game ended above Standings, Last game and
          Leaders ended wherever their content ran out, and the ragged bottom edge left a notch
          under the shorter column that the full-width shelf below made impossible to miss.
          The parent declares two rows; each column spans both and re-uses them, so row 1 is
          max(Next game, Standings) in BOTH columns and row 2 is max(Last game, Leaders). The
          bottom edge is then flush by construction rather than by luck of the content.

          Every card in here is `fill`, and the shorter one in each row places the difference
          deliberately (see the `mt: 'auto'` in NextGameCard and LastGameCard, and the board's
          `flex: 1` in LeadersCard). Without that, stretching a card would just move the ragged
          edge inside it.

          NO `order` VALUES, AND STILL NONE NEEDED, which is the reason for subgrid rather
          than four bare grid items. Four items in one grid would align rows for free, but the
          single mobile column would then read Next game, Standings, Last game, Leaders, and
          fixing that needs `order` at one breakpoint: a second numbering scheme to keep in
          step with DOM order by hand, which is exactly what a previous layout here did and
          what removing it was worth. Keeping the columns as real elements means mobile is
          plain DOM order, and the columns just drop back to flex below md.

          Subgrid is Chrome 117 / Safari 16 / Firefox 71. Where it is missing the declaration
          is dropped and each column falls back to its own two auto rows, which is the ragged
          edge this replaced: degraded, not broken. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gridTemplateRows: { md: 'auto auto' },
        columnGap: 2.5, rowGap: 1.5,
      }}>
        {/* Today's games. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <NextGameCard games={games} teams={teamMap} onOpenGame={onOpenGame} />
          <LastGameCard games={games} teams={teamMap} players={players} onOpenGame={onOpenGame} />
        </Box>

        {/* The season's numbers. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <StandingsCard teams={teams} games={games} onOpenTeam={onOpenTeam} />
          <LeadersCard
            title="Leaders"
            groups={[
              { key: 'hitting', label: 'Batting', blocks: battingBlocks, onViewAll: sortKey => onViewStats('hitting', sortKey) },
              { key: 'pitching', label: 'Pitching', blocks: pitchingBlocks, onViewAll: sortKey => onViewStats('pitching', sortKey) },
            ]}
            loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer}
          />
        </Box>
      </Box>

      {/* Reading, Highlights and the Archive, in one full-width card under the feed.

          Outside the columns on purpose, and full width on purpose. These are horizontal strips,
          the one thing on this page that turns width into content: the same card height shows
          five or six cards across the page instead of three in a column. Stacked as three
          separate cards they were 1415px of a 2125px left column, against 838px on the right.

          Last on the page at both breakpoints, which is also the right editorial answer during
          a season: everything above is about games that just happened or are about to. */}
      <Box sx={{ mt: 1.5 }}>
        <MediaShelf articles={articles} videos={videos} photos={photos} teams={teams} />
      </Box>

    </Box>
  )
}
