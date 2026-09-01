import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, Switch } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined } from '@mui/icons-material'
import { useAuth } from '../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './reminders'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblAllTracking, computeStandings, countsInStandings,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblAllTracking, wpblHomeCacheAgeMs,
} from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblFullName, formatGameTime, gameStartMs, outsToIp, relativeDayLabel, relativeDayShort } from './constants'
import { useWpblPlayerLink, useWpblGameLink } from './LinkContext'
import { WPBL_LEAGUE_PAGE, WPBL_PATH_EVENT } from './routes'
import { useWpblHeadingTag } from './PageHeading'
import { SectionCard, PillGroup, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, wpblFeatureName, CARD_BORDER, FormDots, WPBL_WIN, WPBL_LOSS } from './ui'
import { LiveHero } from './Live'
import PlayoffBracket from './PlayoffBracket'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, fmtRate, fmtTwo, fmtSigned,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { useEraBasis } from './EraBasisContext'
import { track, EVENTS } from '../lib/analytics'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY, DISCORD_DEV_SHOW_EVENT } from './discordInvite'
import { LastGameCard } from './RecapCard'
import FeedDelayNote from './FeedDelayNote'
import { WpblGamePreview } from './GamePreview'
import MvpRaceCard, { mvpRaceIsWorthDrawing } from './MvpRace'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { mvpRace } from './derive/mvpRace'
import type { WpblRunValuePlay } from './types'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblTrackRow, WpblVideo, WpblArticle, WpblPhoto } from './types'

// WPBL home dashboard (Phase 2). Mirrors the MLB home: a full-width scoreboard strip
// on top, then a two-column card feed (The League / Around the League) that stacks on
// mobile. All content is built from existing WPBL data — schedule, standings, and
// season totals aggregated from box-score lines.

// Rate-leader qualifiers live in stats.ts (`wpblQualifiers`) and scale with the season, so
// the OPS and ERA boards can't fill up with one-game cameos as the schedule goes on.

// Home breaks out of the section's 720px page column on a wide screen.
//
// WITHOUT THIS THE PAGE IS 1008px WIDE ON EVERY MONITOR. WpblApp caps the whole section at 720
// LAYOUT px, and the desktop `zoom: 1.4` renders that as 1008: 216px of dead margin per side at
// 1440 and 456px at 1920, where the two card columns, the leader boards and the bracket's shape
// are all fixed at whatever fits inside it. Every spacing complaint on this page started there.
//
// Same device as StatsView's full-bleed table (see FULL_BLEED_W). Both used to divide the
// viewport term by `--app-zoom`, because `vw` is not shrunk by `zoom` while a CSS length is;
// with the zoom gone the two agree and neither divides.
//
// The viewport term is what makes this safe rather than a step change: below the cap the width
// tracks the screen less the app's own 16px gutters, which is what the page was already doing,
// so this is a no-op at 1024 and only starts widening once there is margin to spend. It also
// keeps the 24px of slack that stops `100vw` (which counts a classic scrollbar) from giving the
// whole site a horizontal scrollbar.
//
// APPLIED TO THE WHOLE PAGE, not to the grid alone. The scoreboard, the h1 and the league row
// are the same column as the cards, and a grid that is 250px wider than the strip above it
// reads as a mistake, not as emphasis. `xs` opts out: the page already fills a phone, and the
// transform would only fight the gutter SwipeableViews hands each pane.
// 1260 is the 900 layout px this asked for times the 1.4 it was rendered at, so the column is
// the same WIDTH ON SCREEN it has been; what changed is that it is now the number it says. The
// `vw` term no longer divides by anything, because `vw` and a CSS length are finally the same
// pixel here. The 24px of slack still stops `100vw` (which counts a classic scrollbar) from
// giving the whole site a horizontal scrollbar.
const HOME_WIDE_W = 'min(1260px, calc(100vw - 24px))'
const homeWideSx = {
  width: { xs: 'auto', md: HOME_WIDE_W },
  position: 'relative',
  left: { xs: 0, md: '50%' },
  transform: { xs: 'none', md: 'translateX(-50%)' },
} as const

// ─── Scoreboard ─────────────────────────────────────────────────────────────────

function GameChip({ game, teams, onOpen }: { game: WpblGame; teams: Map<string, WpblTeam>; onOpen: () => void }) {
  const gameLink = useWpblGameLink()
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
        <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.45, textAlign: 'center', fontSize: '0.85rem', lineHeight: 1, color: wpblAccent(t?.id, isDark) }}>{won ? '▸' : ''}</Box>
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
    <Box {...gameLink(game, onOpen)} sx={{
      // 8.5rem, which is the 136px this has always been at the default root size. It went up
      // 4 from the pre-date 132 when the eyebrow's longest string became "Final · Yesterday"
      // rather than "Aug 15 · 7:05 PM": one character more, in uppercase letters where the old
      // one had narrow digits.
      //
      // IN rem BECAUSE THE WIDTH IS DECIDED BY A STRING. Every chip has to be the same width
      // or the strip loses its rhythm, so this cannot be `max-content`; but a fixed pixel box
      // holding text that the reader can enlarge is a clipped eyebrow waiting to happen, and
      // it is exactly what caps the Large text setting at 1.125 (see AccessibilityContext).
      // rem keeps the box and its contents on one scale. Art and tap targets on this card stay
      // in px: they are not holding type and must not grow with it.
      flexShrink: 0, width: '8.5rem', cursor: 'pointer',
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
  // BOTH FADES ARE THE SAME PLAIN 24px VIGNETTE, and the left one is not allowed to grow to
  // cover the chip behind it.
  //
  // It was, for one version: the mask measured the clipped leading chip and held SOLID across
  // the whole of it, on the theory that half a game card reads as a rendering fault. What that
  // actually buys is worse than the thing it was hiding, in two ways a static mock never shows.
  // At rest the strip is pinned at max scroll (once the rest of the season fits on screen there
  // is nowhere further to go), the leading chip is cut wherever that arithmetic leaves it, and
  // the band covering it is then ~90px of flat background between the page's left margin and
  // the first legible chip: the scoreboard reads as inset from a column every other block on
  // Home fills. And in motion the width tracks the clip, so a chip is fully hidden the instant
  // its left edge crosses the edge and reappears whole on the way back. Chips do not scroll off
  // this strip, they blink out of it.
  //
  // A partly scrolled card under a soft edge is what every scroll strip on the web looks like,
  // it is what the right-hand side of THIS one has always looked like, and it is the half
  // nobody has ever complained about. The two sides are now the same 24px in both directions.
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
      //
      // SIXTEEN, NOT THIRTY-TWO, AND THE SLIVER IS THE POINT. A chip is 190px wide with its
      // score column hard against its right edge, so ANY wide peek shows that column and nothing
      // else: the strip opened on two bare numerals, "6" over "10", with no badge and no club
      // beside them, which reads as a rendering fault rather than as "there is more this way".
      // 16 is the 8px gap plus the older chip's own 8px of padding, so what peeks is a blank
      // card edge under the fade. The affordance survives; the clipped digits do not.
      const inset = anchorIndex > 0 ? 16 : 0
      // A rect and `scrollLeft` are the same pixel again, so this is plain subtraction. It was
      // not: the section used to sit in a `zoom: 1.4` wrapper, which getBoundingClientRect
      // reports AFTER and scrollLeft counts BEFORE, so the raw difference undershot the scroll
      // by a factor of the zoom and the strip opened 51px off. The zoom is gone (ROADMAP-WPBL
      // item 0), and with it the whole class of bug. Do not reintroduce a scale here that only
      // one of these two terms can see.
      const delta = anchor.getBoundingClientRect().left - el.getBoundingClientRect().left - inset
      if (Math.abs(delta) > 0.5) el.scrollLeft += delta

      // AT MAX SCROLL THE CUT CHIP MOVES TO THE RIGHT-HAND EDGE, because a chip cut on its left
      // is the one thing on this strip that reads as broken.
      //
      // Once the rest of the season fits on screen the anchor cannot reach its inset: the strip
      // runs out of scroll first and stops wherever the arithmetic left it, which put a game
      // cut through the middle at the leading edge. A chip cut on the LEFT loses its date, its
      // badges and its clubs and keeps only the score column, so the page opened with two bare
      // numerals stacked in the corner. Cut the same chip on the RIGHT and it keeps the eyebrow,
      // both badges and both abbreviations and loses only the scores, which reads as a card
      // continuing past the edge, which is what it is. So give back the part-chip: one whole
      // game more on the left, the last scheduled game part-shown under the trailing fade.
      //
      // Only at max scroll. Everywhere else the placement above is deliberately leaving an 8px
      // sliver of the older game peeking under the fade, and "uncut the leading chip" would
      // undo it. Re-running is still idempotent: the next pass pushes back to max and lands
      // here again, in the same frame, so nothing is ever painted mid-way.
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll > 0 && el.scrollLeft >= maxScroll - 0.5) {
        const edge = el.getBoundingClientRect().left
        for (const chip of Array.from(el.children)) {
          const r = chip.getBoundingClientRect()
          if (r.right <= edge + 0.5) continue    // already scrolled past; not the leading chip
          const cut = edge - r.left
          if (cut > 0.5) el.scrollLeft -= cut
          break
        }
      }
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
        {/* FULL HEIGHT, both of them. They used to stop 6px short of the bottom; the scroller's
            own `pb` is 4px of padding with nothing drawn in it and the scrollbar is hidden, so
            there is nothing down there for a mask to spare, and the gap left the bottom corner
            of a chip lit under the fade. */}
        {!atStart && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to right, ${t.palette.background.default}, transparent)` }} />
        )}
        {!atEnd && (
          <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, pointerEvents: 'none', background: t => `linear-gradient(to left, ${t.palette.background.default}, transparent)` }} />
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
  // IN THE HEADER LINE, BESIDE THE START TIME, rather than as a headline row of its own.
  //
  // It used to be a full row under the team rows, at Last Game's headline size, and the note
  // here argued for that on the grounds that the clock is the only thing Next game knows that
  // nothing else on the page does. That is still true and it is not what the row cost: a whole
  // line, plus its margin, is 26px of a 239px card and a phone was already scrolling three
  // screens of Home. The earlier objection was to the header's top-right CHIP slot, which is
  // where a card puts an afterthought. This is the subtitle, directly under the title, which is
  // the line that says what this game is; "Today · 4:30 PM · 15h 35m" is one fact in three
  // parts and reads better together than split across the card. The accent colour stays, so the
  // live figure is still the thing the eye lands on.
  //
  // `tabular-nums` on the digits alone. The whole line would set the date and time on a
  // monospace grid too, and the seconds place re-renders every tick, so without it the line
  // would twitch sideways once a second.
  return (
    <Box component="span" sx={{ color: 'var(--wpbl-accent-fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {diff <= 0 ? 'starting soon' : label}
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

  // ONE LINE, AND THE SECOND ONE HAS TO EARN ITSELF.
  //
  // This row was a title over a hint in every state, 56px of a 239px card, and in the ordinary
  // states the hint was saying what the switch beside it already said: "On · 30 min before each
  // game" next to a switch that is visibly on. A switch is the control AND the status, so
  // spending a second line restating it is spending a line on nothing, on the surface where a
  // phone already scrolls three screens.
  //
  // So the second line appears only when there is something the switch cannot say: an error, a
  // browser that has blocked us, a deployment with no push configured, or a signed-out reader
  // who needs to know a tap does something other than toggle. Those are exactly the states
  // where the extra height is the point, and they are the minority of visits.
  //
  // The TITLE carries the cadence instead, since it had room: "Remind me 30 min before every
  // game" is the whole offer in one line, and the switch answers it.
  let note = ''
  if (err)                    note = err
  else if (!supported)        note = 'This browser can’t do notifications.'
  else if (!configured)       note = 'Notifications aren’t set up on this deployment yet.'
  else if (perm === 'denied') note = 'Blocked. Turn notifications on for this site in your browser settings.'
  else if (!user)             note = 'Sign in to get a heads-up.'

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
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.25 }}>
          {busy ? 'Working…' : 'Remind me 30 min before every game'}
        </Typography>
        {note && (
          <Typography sx={{ fontSize: '0.7rem', color: err ? 'error.main' : 'text.secondary', mt: 0.15, lineHeight: 1.35 }}>
            {note}
          </Typography>
        )}
      </Box>
      {user && (
        <Switch
          size="small"
          checked={on}
          disabled={busy || blocked || !ready}
          onChange={e => handleToggle(e.target.checked)}
          sx={{ flexShrink: 0, my: -0.5 }}
        />
      )}
    </Box>
  )
}

// Head-to-head record between two clubs this season. Deliberately filtered the same way
// `computeStandings` filters, decisive regular-season finals only, so the series line and the
// standings table sitting beside it can never tell a reader two different stories about the
// same games. That includes the postseason: two clubs meeting five times in a championship
// series have not played a fifteen-game season series, and a line saying so next to a 3-4
// record would be nonsense. Null before the two have met, which is a real state early in a
// season and reads better as nothing than as "0–0".
function seasonSeries(games: WpblGame[], homeId: string, awayId: string): { homeWins: number; awayWins: number } | null {
  let homeWins = 0, awayWins = 0
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    if (!countsInStandings(g)) continue
    const involvesBoth = (g.home_team_id === homeId && g.away_team_id === awayId)
      || (g.home_team_id === awayId && g.away_team_id === homeId)
    if (!involvesBoth) continue
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    if (winner === homeId) homeWins++; else awayWins++
  }
  return homeWins + awayWins === 0 ? null : { homeWins, awayWins }
}

// HOW MANY RESULTS THE FORM STRIP DRAWS, AND WHY IT IS FIFTEEN.
//
// It is the whole season, and it is also the most that provably fits. A WPBL regular season is
// 15 games a club, so today this shows every one of them and the strip is a season at a glance
// rather than a peephole onto the last five, which is what it was and which left two thirds of
// the row empty on a desktop.
//
// The number is a WIDTH, though, not a fact about the schedule, so it is derived from the
// narrowest screen the site supports rather than from the fixture list. At 320px: 32px of page
// gutter and 32px of card padding leave 256, the club abbreviation and the record take 78
// between them with their gaps, and 178 remain. At a 9px dot on a 3px pitch that is
// `12n - 3 <= 178`, so 15. A longer season would show its most recent 15, which is still a form
// guide; a wider dot or a fatter gap would silently push the record off the row, so change
// either of those and redo this arithmetic.
const FORM_DOTS = 15

/** A club's last `n` decided results before `beforeMs`, oldest first, as won/lost.
 *
 *  Filtered exactly as `seasonSeries` and `computeStandings` are, decisive regular-season
 *  finals only, for the same reason: this sits two rows above a record that comes out of
 *  `computeStandings`, and a form strip counting games that record does not is a card
 *  disagreeing with itself.
 *
 *  Ordered by start time rather than by date alone, because the feed publishes a timezone twin
 *  of every game (see the ingest note) and two rows sharing a date have to break their tie on
 *  something stable or the strip reshuffles between paints.
 */
function recentForm(games: WpblGame[], teamId: string, beforeMs: number, n = FORM_DOTS): boolean[] {
  return games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null
      && g.home_score !== g.away_score && countsInStandings(g)
      && (g.home_team_id === teamId || g.away_team_id === teamId))
    .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) ?? 0 }))
    .filter(x => x.ms < beforeMs)
    .sort((a, b) => a.ms - b.ms || a.g.id.localeCompare(b.g.id))
    .slice(-n)
    .map(({ g }) => (g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id) === teamId)
}

function NextGameCard({ games, teams, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const gameLink = useWpblGameLink()
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


  // FORM, AND IT IS HERE TO BE READ, NOT TO FILL THE CARD, though it does both.
  //
  // Next game is the shortest card in the grid and now shares a stretched row with the MVP
  // race, so whatever it does not say it says as blank space: at three lines it was holding a
  // 76px band of nothing between the season-series line and the reminder rule. The record on
  // each team row answers "how good are they"; nothing on the card answered "how are they
  // going", which is the other half of what anyone asks before a game and the half a 4-8 club
  // on a four-game run is most misrepresented by.
  //
  // A block of its own rather than pips tucked into the team rows above. Those rows are
  // deliberately identical to LastGameCard's, tier for tier, and a strip of dots is the width
  // that tips "San Francisco Firebells" onto a second line at 320px: the row would silently
  // double in height on exactly one matchup, which is the failure that row's own note already
  // refuses. Down here both clubs line up under one label and the phone gets it too.
  //
  // THE SECTION'S FORM STRIP, NOT A SECOND ONE. It drew its own dots for a while, in the club's
  // accent at two opacities, and that was wrong twice over: a green tick on the Teams page and
  // a red pip here meant the same result, and within this card the away club's win and the home
  // club's loss could be the same hue at different alphas, which is the one distinction the
  // strip exists to make. `FormDots` is green-solid for a win and a red RING for a loss, so the
  // two survive greyscale and the eight percent of men who cannot separate red from green; see
  // its note in ui.tsx. Tighter gap than the Teams page spends, because that strip draws five
  // results in a table row and this one draws a season.
  const formRow = (t: WpblTeam | undefined) => {
    if (!t) return null
    const results = recentForm(games, t.id, next.ms)
    if (results.length === 0) return null
    // The run the club is on right now: the trailing results that all agree.
    let streak = 0
    for (let i = results.length - 1; i >= 0 && results[i] === results[results.length - 1]; i--) streak++
    const streakWon = results[results.length - 1]
    return (
      <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.9 }}>
        <Typography sx={{ width: '1.875rem', flexShrink: 0, fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.3, color: 'text.secondary' }}>{t.abbr}</Typography>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <FormDots recent={results.map(won => (won ? 'W' : 'L'))} gap={3} />
        </Box>
        {/* THE STREAK, NOT THE RECORD. This row ended with the club's W–L over the games drawn,
            which was fine while it drew five and became a straight duplicate the moment it drew
            the season: "8–4" sat here in the same right-hand column as the "8–4" on the team row
            three lines above, saying one number twice in one card. The streak is the fact a strip
            of dots is slowest to yield and the one this card did not already have.

            Three and up, which is the Teams page's rule for the same strip and the same reason:
            below three it is something the last two dots already say, and at three it is the
            headline about the club. A row with no run simply ends at its dots, there too. */}
        {streak >= 3 && (
          <Typography sx={{
            flexShrink: 0, fontSize: '0.68rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: streakWon ? WPBL_WIN : WPBL_LOSS,
          }}>
            {streakWon ? 'W' : 'L'}{streak}
          </Typography>
        )}
      </Box>
    )
  }
  const formRows = [formRow(away), formRow(home)].filter(Boolean)

  return (
    <SectionCard
      title="Next game"
      /* Date, start time and countdown on one line. The countdown was a row of its own under
         the team rows; see the note on Countdown for why it moved up rather than away. */
      subtitle={<>
        {dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}{' · '}<Countdown target={next.ms} />
      </>}
      fill
    >
      {/* Laid out as LastGameCard is, tier for tier: the two team rows, then one line at
          headline weight saying what the game is right now, then a quieter line of context,
          then a rule and the row you can act on. Everything inside the clickable block is a
          fact about THIS game, so it all opens the game, the way the team rows already did.

          `flex: 1` + centred absorbs whatever height Standings forces on this card, splitting
          it above and below rather than dropping it in one hole. With the card nearly full it
          is a few pixels either side, but it keeps the card even if the series line drops out,
          which it does the first time two clubs meet. */}
      <Box {...gameLink(g, onOpenGame)} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 1, p: 0.5, mx: -0.5, '&:hover': { bgcolor: 'action.hover' } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
          {teamRow(away, 'AWAY')}
          {teamRow(home, 'HOME')}
        </Box>
        {seriesLabel && (
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.35 }}>
            {seriesLabel}
          </Typography>
        )}
        {/* Inside the clickable block with the rest: form is a fact about the two clubs in
            THIS game, so it opens the same game the rows above it do. */}
        {formRows.length > 0 && (
          <Box sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.secondary', mb: 0.5 }}>
              Form
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>{formRows}</Box>
          </Box>
        )}
        {/* The tale of the tape: three diverging bars, the same component Game Center draws for
            an unplayed game, cut down to a block (see its `compact` note). Form says how the
            two clubs are GOING and this says how good they have been, which are the two halves
            of the only question anyone asks before a first pitch, and neither was on the card.

            NO EXTRA FETCH. It reads the season lines out of the same session cache Home has
            already filled for the leaders, so on this page it is arithmetic on data in hand.
            It renders nothing at all until there is something to compare, so the season's
            opening days get the card as it was rather than an empty frame. */}
        {away && home && (
          <Box sx={{ mt: 1.25 }}>
            <WpblGamePreview away={away} home={home} teams={[...teams.values()]} games={games} compact />
          </Box>
        )}
      </Box>
      {/* Once the countdown in the header has run out and nothing has happened, this is the
          card that owes the reader an explanation: it is the one that promised a first pitch.
          Compact, because the full second sentence belongs on Game Center where there is room
          and where somebody has gone looking for detail. Outside the clickable block above,
          which is all facts about the game itself. */}
      <Box sx={{ mt: 1 }}>
        <FeedDelayNote game={g} compact />
      </Box>

      <GameReminderRow game={g} away={away} home={home} startMs={next.ms} />
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
  // Every leader name is a real <a href> to her page. These five rows are the section's most
  // valuable link into a player page and were a div with an onClick, which no crawler follows
  // and no keyboard reaches. See LinkContext.tsx.
  const playerLink = useWpblPlayerLink()
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
          <Box key={r.player.id} {...playerLink(r.player, onOpenPlayer)} sx={{
            // Rows past third exist in the DOM at every width and are dropped below md. `none`
            // rather than a media query in JS: the count is then a fact about the stylesheet,
            // so first paint cannot disagree with the second, and the ranks above are numbered
            // off the full list either way. It also keeps all five in the page for a crawler,
            // which is five player links out of Home instead of three.
            display: { xs: i < LEADER_ROWS ? 'flex' : 'none', md: 'flex' },
            alignItems: 'center', gap: isTop ? 1 : 0.75,
            py: isTop ? 0.55 : 0.4, cursor: 'pointer',
            borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Typography sx={{ width: '0.875rem', flexShrink: 0, textAlign: 'center', fontSize: isTop ? '0.8rem' : '0.7rem', fontWeight: 800, color: RANK_MEDAL[rank - 1] ?? 'text.disabled' }}>{rank}</Typography>
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
            <Typography sx={{ fontSize: isTop ? '1.05rem' : '0.82rem', fontWeight: isTop ? 900 : 800, fontVariantNumeric: 'tabular-nums', minWidth: '2.5rem', textAlign: 'right', flexShrink: 0 }}>{r.display}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// How many names a Home leader board lists: three on a phone, five from md up.
//
// THE NUMBER FOLLOWS THE LAYOUT, and it has now gone 5 -> 3 -> both. Five was right when
// Leaders shared a stretched row with Last Game and three left it 90px short. Three was right
// when the columns were re-paired by height and Leaders sat beside Next game, the shortest card
// in the grid, where the two extra rows stopped filling a hole and started digging one. It is
// beside Last Game again (see the note in the right-hand column), so the 90px is back, and two
// more leaders are still a better way to spend it than 90px of margin.
//
// SPLIT BY BREAKPOINT THIS TIME, because the two arguments were never actually in conflict:
// the hole is a desktop problem and the height is a phone one. Home is 2.9 screens on a phone
// and 670 of 2,037 browsers fire exactly one event on it, so the two rows that fix a desktop
// row boundary are the last thing that page needs. Three is also what the card wants on its
// own where space is scarce: a podium reads at a glance where a five-row board asks to be
// scanned, and everything below third is one tap away on the Stats tab "View all" opens.
//
// ONE BOARD, HIDDEN BY CSS, rather than two counts computed from a media query. The boards are
// built at the wide count and StatBlock drops rows 4 and 5 below md, so there is no breakpoint
// state to get wrong on first paint and the ranks are numbered off the full list either way.
const LEADER_ROWS = 3
const LEADER_ROWS_WIDE = 5

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = LEADER_ROWS_WIDE, meta?: (t: WpblBattingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties break toward the bigger sample (more at-bats).
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.ab - a.totals.ab)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = LEADER_ROWS_WIDE, meta?: (t: WpblPitchingTotals) => string): LeaderRow[] {
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
  //
  // Per breakpoint, because the board itself is: StatBlock draws five rows from md up and three
  // below it, and a single reserve would either leave 52px of dead card under a phone's third
  // name or let the desktop board outgrow its own floor. `rows.length` is the built count, so
  // it is capped to what is actually visible at each width.
  const maxRows = shown.length ? Math.max(...shown.map(b => b.rows.length)) : LEADER_ROWS
  const rowsPx = (n: number) => 48 + Math.max(0, n - 1) * 26
  const reservePx = { xs: `${rowsPx(Math.min(maxRows, LEADER_ROWS))}px`, md: `${rowsPx(maxRows)}px` }

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
            sx={{ minHeight: reservePx, flex: 1 }}
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

// Community invite — links out to the WPBL fan Discord. Styled in Discord's blurple
// so it reads as "join the chat" at a glance, but kept to one slim row so it sits
// under the scoreboard without crowding the actual content.
//
// MOBILE-ONLY for now: the caller renders it inside a `display: { xs: 'block', md: 'none' }`
// wrapper. The desktop feed is a two-column subgrid that shares row boundaries, and a fifth
// card of a different shape breaks that alignment; a proper desktop home for it is a later job.
const DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'
const DISCORD_BLURPLE = '#5865F2'

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
        // `px: 2` and `borderRadius: 3` are NOT free choices: they are what every SectionCard
        // on this page uses, and this card sits in the middle of a stack of them. At `p: 1.25`
        // and radius 2 its avatar started 11px in where the Scoreboard above it and Next Game
        // below it both start their content at 17px, and its corners were 4px tighter than
        // theirs. Six pixels and four pixels are each too small to look like a bug and plenty
        // to look wrong: the eye reads the left edges of a vertical stack as one line, and this
        // was the only card that broke it.
        //
        // The vertical padding stays tighter than the horizontal on purpose. This is a promo
        // strip rather than a section, and the row's height is set by the 34px avatar anyway,
        // so `py: 2` would only add 12px of nothing to a card that is one line tall.
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
        textDecoration: 'none', cursor: 'pointer',
        borderRadius: 3, border: '1.5px solid', borderColor: `${DISCORD_BLURPLE}66`,
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
          // Pulled back out of the padding by half its own slack. The ✕ is an 8px glyph
          // centred in a 22px thumb target, so left at the padding line the MARK sits 24px
          // from the card edge against the avatar's 17px, and the row looks heavier on the
          // left than the right. The target keeps its full size; only the box moves.
          flexShrink: 0, width: 22, height: 22, ml: 0.25, mr: -0.75,
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


// ─── Home ───────────────────────────────────────────────────────────────────────

// ─── Ingest health (admin-only) ──────────────────────────────────────────────────
// The feed-mirror ingest freshness indicator lives in the site Admin panel now
// (consolidated with the payroll/contract freshness) — see AdminPanel's "WPBL Ingest".

/**
 * One line on Home pointing at /wpbl/league, where Reading, Highlights and the archive went.
 *
 * IT MEASURES ITSELF, and that is not boilerplate. The Discord card taught this the hard way:
 * it was retired on Aug 19 and took its own impression event with it, so the 554 browsers whose
 * only event was that card became unmeasurable the same day. Anything that lands on Home now
 * carries its own impression, and this one has a specific question to answer. The shelf was
 * seen by 575 browsers and clicked by 39. If this card is shown as often and opened less, the
 * move was wrong and the shelf should come back rather than the link being made louder.
 */
function LeagueCard() {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    track(EVENTS.WPBL_LEAGUE_CARD_SHOWN)
  }, [])

  // Modified clicks fall through untouched, so open-in-new-tab still works; the rest is the
  // section's own navigation, copied from WpblApp's `push`. /wpbl/league is an App-level route
  // rather than a tab, so there is no view to switch to: push the entry and tell the shell the
  // path moved, which is what makes it re-read and swap in the page.
  const go = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    track(EVENTS.WPBL_LEAGUE_CARD_OPEN, { from: 'home' })
    window.history.pushState({ ...window.history.state, wpbl: undefined }, '', WPBL_LEAGUE_PAGE)
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }

  return (
    <Box
      component="a"
      href={WPBL_LEAGUE_PAGE}
      onClick={go}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none',
        border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3,
        bgcolor: 'background.paper', px: 2, py: 1.75,
        '&:hover': { borderColor: 'var(--wpbl-accent-solid)' },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: 'text.primary' }}>
          The league
        </Typography>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.25 }}>
          Where all 118 players are from, plus the reading, the highlight reels and the archive.
        </Typography>
      </Box>
      <Box aria-hidden sx={{ color: 'text.disabled', fontSize: '1.2rem', flexShrink: 0 }}>›</Box>
    </Box>
  )
}

export default function WpblHome({ teams, games, liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewStats, onViewTracking }: {
  teams: WpblTeam[]
  games: WpblGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  // 'runs' is here for the MVP card's "Full board" link: the number it draws comes off the
  // Run value board, so that is the only honest place to send someone who wants the rest of
  // the field. `openStats` in WpblApp already takes the wider group type.
  onViewStats: (group: 'hitting' | 'pitching' | 'runs', sortKey?: string) => void
  onViewTracking: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const headingTag = useWpblHeadingTag()

  // Leaders + tracking data, fetched here so only the home view pays for it. Seeded from the
  // shared session cache so swiping back to Home (the default tab, so the most re-entered)
  // repaints instantly instead of flashing every card's skeleton and re-pulling all three
  // datasets.
  const { fmtEra } = useEraBasis()
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [tracking, setTracking] = useState<WpblTrackRow[]>(() => getCachedWpblAllTracking() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)
  // The play log, for the MVP race alone, and DELIBERATELY NOT in the fetch below.
  //
  // Home stopped pulling play-by-play when the Hall of Firsts came off, and that was the most
  // expensive read on the section: this brings it back, so it has to be brought back on terms
  // that cannot cost the page its first paint. 2,265 rows is about 80KB gzipped and a second
  // or so on a phone, against a page where 670 of 2,037 browsers fired exactly one event and
  // left. So it is a SEPARATE effect that starts after the ones above and blocks nothing:
  // every card on Home renders on its own schedule, and the MVP card simply is not there
  // until its data is, which is the one card on the page nobody is waiting for.
  //
  // The fetcher is the same session-cached one the Run value board uses, so a reader who
  // opens both pays once, in whichever order they happen to visit.
  const [plays, setPlays] = useState<WpblRunValuePlay[]>(() => getCachedWpblAllRunValuePlays() ?? [])
  // Discord invite dismissal, read once. Owned here (not inside DiscordCard) so a dismissed
  // invite unmounts the card entirely and leaves no empty wrapper taking up row-gap.
  const [discordDismissed, setDiscordDismissed] = useState(() => {
    try { return localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { return false }
  })
  // Dev only: the settings gear can put the invite back. `import.meta.env.DEV` is a build-time
  // constant, so the whole body of this effect is eliminated from the production bundle and
  // the listener is never registered there.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onShow = () => setDiscordDismissed(false)
    window.addEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
    return () => window.removeEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
  }, [])

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

  // The MVP race's data, on its own. Failure is silent and the card just never appears, which
  // is the right outcome for a card that is a bonus rather than the page: nothing above it
  // depends on this resolving.
  useEffect(() => {
    let cancelled = false
    fetchWpblAllRunValuePlays()
      .then(p => { if (!cancelled) setPlays(p) })
      .catch(() => { /* no card, no error state: see above */ })
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


  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting, games), [players, lines.batting, games])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching, games), [players, lines.pitching, games])

  // Only enforce the PA / IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  const battingBlocks = useMemo(() => [
    { label: 'OPS',       short: 'OPS', sortKey: 'ops', rows: topBat(batSeasons, t => t.ops, t => fmtRate(t.ops), t => !qual.active || plateAppearances(t) >= qual.minPa, LEADER_ROWS_WIDE, t => `${plateAppearances(t)} PA`) },
    { label: 'Home runs', short: 'HR',  sortKey: 'hr',  rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',       short: 'RBI', sortKey: 'rbi', rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons, qual])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        short: 'ERA', sortKey: 'era', rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtEra(t.era), t => !qual.active || t.outs >= qual.minOuts, LEADER_ROWS_WIDE, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Strikeouts', short: 'K',   sortKey: 'so',  rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0, LEADER_ROWS_WIDE, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Innings',    short: 'IP',  sortKey: 'ip',  rows: topPit(pitSeasons, t => t.outs, t => outsToIp(t.outs), t => t.outs > 0) },
  ], [pitSeasons, qual, fmtEra])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

  // Standings order for the bracket below. Its own memo rather than a prop threaded down from
  // StandingsCard: both call `computeStandings` on the same two arrays, so they cannot
  // disagree, and hoisting it would put the table's data in the page's scope for one consumer.
  const standingsRows = useMemo(() => computeStandings(teams, games), [teams, games])

  // The MVP race. Two passes over the play log (the run-expectancy table, then every play
  // priced against it), memoised on the three arrays they read, because this is the most
  // arithmetic any card on Home does and none of it is cheap enough to redo on a repaint.
  //
  // The postseason is already out: both functions run their input through `regularSeasonLines`
  // themselves, which is also why this cannot disagree with the Run value board about which
  // games counted.
  const race = useMemo(() => {
    if (plays.length === 0 || players.length === 0) return null
    const table = buildRunExpectancy(plays, games)
    return mvpRace(playRunValues(plays, games, table), players, games)
  }, [plays, players, games])

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(tracking)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  // Built here rather than inline because the right column renders its two cards in one of two
  // ORDERS (see the note there), and the same element has to be the same element in both so its
  // key can carry it across the swap without a remount.
  const leadersCard = (
    <LeadersCard
      key="leaders"
      title="Leaders"
      groups={[
        { key: 'hitting', label: 'Batting', blocks: battingBlocks, onViewAll: sortKey => onViewStats('hitting', sortKey) },
        { key: 'pitching', label: 'Pitching', blocks: pitchingBlocks, onViewAll: sortKey => onViewStats('pitching', sortKey) },
      ]}
      loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer}
    />
  )

  return (
    <Box sx={homeWideSx}>
      {/* Slim league header. On mobile it's just the title; on wider screens the club chips
          sit inline to the right. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 }, mb: 1.5,
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* The page's one <h1>. It carries the full league name (an exact match for that
              search) while the <title> in seo.ts leads with "WPBL Stats"; between them the
              home page covers both the brand term and the acronym people actually type. Every
              other WPBL tab is a separate route with its own h1. */}
          <Typography component={headingTag} sx={{ fontSize: '1.05rem', fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1.15 }}>
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

      {/* Discord invite, mobile only for now. Sits between the scoreboard and the feed, where
          it used to lead the single-column stack. Hidden at md+ because the desktop feed is a
          two-column subgrid with shared row boundaries that a loose card would break; a desktop
          home for it is a later job. */}
      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <DiscordCard onDismiss={() => setDiscordDismissed(true)} />
        </Box>
      )}

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
        // Its OWN top margin, rather than living off the scoreboard's bottom one.
        //
        // This stack is a plain block with no gap: every child brings its own margin, and the
        // blocks below this grid all carry `mt`. This one carried nothing and was spaced only
        // by the scoreboard's `mb`, which worked exactly until something was inserted between
        // them. The Discord invite was, and it collected that margin on the way past: 12px
        // above the invite, and the grid then sat flush against it with no gap at all. A block
        // that depends on its neighbour for its own spacing breaks the next time it gets a new
        // neighbour, so this one now says what it wants. Margins collapse, so the invite being
        // dismissed still leaves 12px here rather than 24.
        mt: 1.5,
        // One gap in both directions, and it is Home's gap: 1.5 is the step between the
        // scoreboard and this grid, between this grid and the shelf, and between the two cards
        // stacked in each column. The 20px column gap was the odd one out, and with the cards
        // now sharing row boundaries the mismatch showed: a 20px vertical channel crossing
        // 12px horizontal ones reads as two grids rather than one.
        gap: 1.5,
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

        {/* The season's numbers.

            THE STANDINGS TABLE USED TO LEAD THIS COLUMN AND HAS BEEN REMOVED, not moved: it is
            a whole tab of its own, two taps from here in the nav that is on screen the entire
            time, and Home was redrawing it in miniature underneath. That is 224px on a phone
            spent on the one card every reader already knows where to find, on a page measured
            at three full screens. The MVP race takes the quadrant, which is a better trade than
            it looks: it is the only card here that cannot be got anywhere else, and in the
            column headed "the season's numbers" it sits with Leaders, which is the same kind of
            claim about the same season.

            Home still computes `computeStandings` for the bracket below, so nothing about the
            postseason card changed. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          {/* THE MVP RACE LEADS THIS COLUMN, SO IT IS THE ONE SEASON CARD ABOVE THE FOLD.
              It used to be second, and the ordering was picked purely on height: Next game
              (214) with Leaders (~200), then Last Game (256) with the MVP race (279), which
              paired the cards by how tall they happened to be rather than by what they are.
              That was the right call when the alternative was a 65px hole in Next game, and it
              cost the page the thing it is least able to spare. At 1440x900 the second row
              starts at y=734, so the MVP race was rendering entirely below the fold: the ONE
              card on Home that cannot be got from another tab, drawn where a reader who does
              not scroll never meets it. Leaders is a summary of the Stats tab two taps away.

              The pairing still works, because the two cards that were short have both been
              given something to do: Next game now carries each club's recent form, and Leaders
              draws every category at once from md up instead of one behind a chip. Row 1 is
              Next game against the MVP race and row 2 is Last Game against Leaders, and the
              stretch in each is single figures again. If either of those is reverted, put this
              back to Leaders-first or the hole comes with it.

              KEYED, because the MVP race appears about a second after first paint (its play log
              is deliberately fetched last) and these two swap SLOTS when it does. Without keys
              React reconciles by position, sees a different component type in slot 1, and
              remounts Leaders: the reader's pill selection resets under them one second in. */}
          {(mvpRaceIsWorthDrawing(race)
            ? [
              /* It spends whatever slack the row gives it on the chart, which is the one child
                 that gets better with height; see the note on RaceChart's `fill`. */
              <MvpRaceCard key="mvp" race={race} games={games} onOpenPlayer={onOpenPlayer}
                onViewBoard={() => onViewStats('runs')} fill />,
              leadersCard,
            ]
            // Nothing to draw yet (a season too young, or the play log still in flight).
            // Leaders takes row 1 and an empty grid cell takes row 2, which is the layout this
            // column had before the race existed: the row collapses to whatever Next game
            // needs rather than reserving a slot for a card that may never arrive.
            : [leadersCard, <Box key="mvp-empty" />])}
        </Box>
      </Box>

      {/* The postseason bracket. Full width and outside the grid above on purpose: three
          series boxes side by side need the room, and the two columns up there share row
          boundaries through subgrid, which a third card of a different shape would break.

          Below the season's numbers rather than above them, so it does not displace Next game
          and its countdown, and above the media shelf, which is the surface the traffic says
          is seen and not used. */}
      {standingsRows.length > 0 && games.some(g => g.status === 'final') && (
        <Box sx={{ mt: 1.5 }}>
          <PlayoffBracket rows={standingsRows} games={games} onOpenTeam={onOpenTeam} from="home" />
        </Box>
      )}

      {/* Reading, Highlights and the Archive, in one full-width card under the feed.

          Outside the columns on purpose, and full width on purpose. These are horizontal strips,
          THE SHELF ITSELF MOVED. Reading, Highlights and Archive now live on /wpbl/league, and
          what is left here is one line pointing at them. Two reasons, both measured: 575
          browsers saw the shelf and 39 clicked it, so it was not earning three screens of the
          page it sat on; and 670 of 2,037 browsers fired exactly one event on Home, which is a
          page that needs to get SHORTER before it gets anything else. The card carries its own
          impression event so the trade can be read later rather than assumed.

          Last on the page at both breakpoints, which is also the right editorial answer during
          a season: everything above is about games that just happened or are about to. */}
      <Box sx={{ mt: 1.5 }}>
        <LeagueCard />
      </Box>

    </Box>
  )
}
