import { useDark } from '../../ui/useDark'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { wpblAccent, wpblAccentFg, formatGameTime, relativeDayShort } from '../constants'
import { useWpblGameLink } from '../LinkContext'
import { HIDE_ON_PHONE, VISUALLY_HIDDEN } from '../PageHeading'
import { TeamBadge, CARD_BORDER, CARD_FILL, TAPPABLE, hoverOnly, FOCUS_RING, pressable, TYPE_SCALE, ICON_SIZE } from '../ui'
import { postseasonSlots, type PostseasonScheduleRow, type PostseasonSlot } from '../derive/bracket'
import type { WpblTeam, WpblGame } from '../types'
import { typePx } from '../../ui/scale'
import { SECTION_GAP } from './shared'

function GameChip({ game, teams, onOpen }: { game: WpblGame; teams: Map<string, WpblTeam>; onOpen: () => void }) {
  const gameLink = useWpblGameLink()
  const away = teams.get(game.away_team_id)
  const home = teams.get(game.home_team_id)
  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)

  // "Today" / "Yesterday", else "Aug 15": shared with the schedule's labels so a date reads the
  // same wherever you meet it (relativeDayShort drops the weekday, and Tomorrow, neither of which
  // this chip has room for).
  const dateText = relativeDayShort(game.game_date)
  const timeText = formatGameTime(game.game_date, game.start_time)
  // A final carries WHEN it was played. The status leads and the date follows, the reverse of an
  // upcoming game, because each puts its own headline first, and because if the line ever has to
  // ellipsise it should lose the date rather than the result. A live game is by definition today,
  // so a date there would be noise.
  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''} · ${dateText}`
    : live ? 'Live'
    : timeText ? `${dateText} · ${timeText}` : dateText

  const isDark = useDark()
  const row = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {/* Winner caret, only on finals, where a fixed-width slot keeps both rows' badges aligned.
          Upcoming and live games omit the slot entirely so the badge sits flush left. */}
      {final && (
        <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.45, textAlign: 'center', fontSize: ICON_SIZE.sm, lineHeight: 1, color: wpblAccent(t?.id, isDark) }}>{won ? '▸' : ''}</Box>
      )}
      {t && <TeamBadge team={t} size={20} />}
      <Typography sx={{
        flex: 1, fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600,
        color: won ? 'text.primary' : final ? 'text.secondary' : 'text.primary',
      }}>{t?.abbr ?? '?'}</Typography>
      {(final || live) && (
        <Typography sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          color: won ? 'text.primary' : final ? 'text.disabled' : 'text.primary',
        }}>
          {score ?? '—'}
        </Typography>
      )}
    </Box>
  )

  return (
    <Box {...gameLink(game, onOpen)} sx={{
      // IN rem BECAUSE THE WIDTH IS DECIDED BY A STRING. Every chip has to be the same width or the
      // strip loses its rhythm, so this cannot be `max-content`, and a fixed pixel box holding text the
      // reader can enlarge clips its eyebrow under the Large text setting (see AccessibilityContext).
      // Sized for the longest eyebrow, "Final · Yesterday". Art and tap targets on this card stay in
      // px: they are not holding type and must not grow with it.
      flexShrink: 0, width: '8.5rem', cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }),
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
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

/**
 * A postseason game the league has dated but not yet played, on the same strip as the feed's own.
 *
 * WHY THE STRIP CARRIES THESE. The feed has no postseason game until the league seeds the
 * bracket, so between the regular season and the bracket the strip would be all finals with
 * nothing ahead, in the week a reader is most likely to open Home to see what is next. These are
 * the rows the Schedule tab prints (postseasonScheduleRows), in the shape the strip uses.
 *
 * DELIBERATELY NOT A GameChip, AND NOT A LINK. There is no game to open, no score column and no
 * away-at-home, so it is dashed rather than solid and it does not respond to a click. What it
 * does keep is the outer box: same width, same one-line eyebrow, same two rows, because the
 * strip's whole rhythm is that every chip's badges sit level with its neighbours'.
 */
/** What a seeded postseason chip hands up to open its matchup preview. */
export type MatchupPreviewArg = { away: WpblTeam; home: WpblTeam; eyebrow: string }

function PostseasonChip({ row, onOpenMatchup }: {
  row: PostseasonScheduleRow
  onOpenMatchup?: (m: MatchupPreviewArg) => void
}) {
  const isDark = useDark()
  // "Semi G1 · Sep 9". The round is abbreviated because the eyebrow may not wrap and the chip is
  // 8.5rem: the longest string this builds is "Champ G1 · Sep 16", one character shorter than
  // the "Final · Yesterday" the box was sized for. NOT "Final" for the championship, which is
  // the word this exact slot carries on every completed game.
  const round = row.round === 'championship' ? 'Champ' : 'Semi'
  // THE ASTERISK IS THE ONE MARK THAT FITS, and it is already this module's convention:
  // `seriesDateLine` prints "Sep 9, 11, 13*" from the same flag. The eyebrow may not wrap and
  // the chip is 8.5rem, so "if needed" spelled out costs either the round or the date, and both
  // are load-bearing: a reader needs to know which game and which day. Every surface with room
  // does spell it out (the schedule rows, SeriesPreview), and the words are here too, for a
  // screen reader and as a tooltip, since an asterisk with no key beside it explains nothing.
  const eyebrow = `${round} G${row.gameNumber}${row.ifNecessary ? '*' : ''} · ${relativeDayShort(row.date)}`
  // Away over home once the league has designated one, and the ROW ORDER carries that on its own:
  // no "@" marker, the same call the neighbouring GameChip makes, where the home club is simply the
  // bottom row.
  const { slots } = postseasonSlots(row)
  // Both clubs seeded: there is a matchup to preview even without a feed game, so the chip goes
  // solid and clickable. A seat still holding a seed number keeps the dashed, inert chip.
  const preview: MatchupPreviewArg | null = row.first.team && row.second.team && onOpenMatchup
    ? { away: slots[0].team!, home: slots[1].team!,
        eyebrow: `${row.label} · Game ${row.gameNumber} · ${relativeDayShort(row.date)}` }
    : null

  const slot = (p: PostseasonSlot, i: number) => (
    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {p.team ? <TeamBadge team={p.team} size={20} /> : (
        // The empty seat, sized exactly like a badge so a slot filling in mid-week does not
        // shift the row under it.
        <Box aria-hidden sx={{
          width: 20, height: 20, flexShrink: 0, borderRadius: '50%',
          border: '1px dashed', borderColor: CARD_BORDER,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
        }}>{p.seed ?? ''}</Box>
      )}
      <Typography noWrap sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body,
        fontWeight: p.team ? 600 : 500,
        color: p.team ? 'text.primary' : 'text.secondary',
      }}>
        {p.team?.abbr ?? p.shortLabel}
      </Typography>
    </Box>
  )

  return (
    <Box
      title={row.ifNecessary ? 'If needed' : undefined}
      {...(preview ? pressable(() => onOpenMatchup!(preview)) : {})}
      aria-label={preview ? `Preview ${preview.away.abbr} at ${preview.home.abbr}` : undefined}
      sx={{
        flexShrink: 0, width: '8.5rem',
        // Solid and clickable once both clubs are seeded; dashed and inert while a seat is a seed.
        borderRadius: 2, border: preview ? '1px solid' : '1px dashed', borderColor: CARD_BORDER,
        bgcolor: CARD_FILL,
        p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
        ...(preview ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING, transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }) } : {}),
      }}
    >
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
        // The accent rather than text.secondary: it is the one mark separating a fixture that
        // exists from a date the league has only published, on a strip where the dashed border
        // is a hairline.
        //
        // NOT DIMMED FOR AN IF-NECESSARY GAME, though SeriesPreview does dim its row. There the
        // conditional games sit among certain ones in a list and the contrast IS the signal;
        // here every chip on the strip is already the same dashed, unclickable kind of thing,
        // so dimming one would read as disabled rather than as conditional, and would spend
        // contrast on the smallest type on the page to say what the asterisk says.
        color: wpblAccentFg(isDark),
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {eyebrow}
        {/* What the asterisk means, for anyone who cannot see it. Inside the eyebrow rather
            than as an `aria-label` on it: a label on a element with no role is ignored by some
            screen readers, and hidden text is read by all of them. */}
        {row.ifNecessary && <Box component="span" sx={VISUALLY_HIDDEN}>, if necessary</Box>}
      </Typography>
      {slots.map(slot)}
    </Box>
  )
}

/** One tile on the strip: a game the feed has, or a postseason date it does not have yet. */
type StripItem =
  | { kind: 'game'; id: string; game: WpblGame }
  | { kind: 'post'; id: string; row: PostseasonScheduleRow }

/** Exported for `scoreboardStrip.test.tsx`, which pins which fixtures reach the strip. Same
 *  reason `NextPostseasonCard` is: what these two choose to show is a judgment about what is
 *  true, and neither failure is visible from a render that happens to look fine. */
export function Scoreboard({ games, teams, postseason, onOpenGame, onOpenMatchup }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** The published postseason, for the days past the end of the feed's schedule. Date-sorted,
   *  and already retiring itself a row at a time as the feed publishes the real games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
  /** Preview a seeded-but-unplayed postseason chip. Optional so the strip still renders where
   *  there is nowhere to open one. */
  onOpenMatchup?: (m: MatchupPreviewArg) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * A WINDOW ROUND NOW, not the season: three finished games, then what is still to come.
   *
   * A whole season of chips is thousands of pixels in a window of about 1,260, reachable only
   * through an invisible hover zone that glides slowly, and not by keyboard at all. Seven chips
   * (1,238px with the gaps) fit a desktop without scrolling, so there is nothing hidden to
   * discover; a phone still scrolls it, where one swipe crosses the whole strip. The season it does
   * not carry is the Schedule tab, one tap away.
   *
   * The caps are per SIDE on purpose. Capping the total would make the window lopsided at both
   * ends of a season: in April every game is upcoming and no result would show, and in the last
   * week there is one game left and the strip would be weeks of old scores.
   *
   * The finals cap is a FLOOR that grows: any of the four upcoming slots with no fixture to fill it
   * is handed to another recent final, so the row stays seven chips wide and does not trail off into
   * empty space on the desktop once the season runs low on games ahead. `UPCOMING` is what still
   * caps the total, so the sum is never more than the seven that fit.
   */
  const RECENT_FINALS = 3
  const UPCOMING = 4
  /**
   * The anchor is the NEXT game, not the last final, and that only matters where the strip
   * scrolls, which is a phone.
   *
   * Last game and Next game are the next two cards down the page and render the two fixtures
   * either side of "now" in full. A phone shows under three chips, so anchoring on the last final
   * spends both legible slots echoing those cards and pushes the games nothing else on Home
   * mentions off-screen. Anchored ahead, the strip reads today and then the rest of the week, and
   * the finals sit one swipe to the left, where a result already shown in a card belongs.
   *
   * Falls back to the last final when nothing is upcoming, which is the last day of a season and
   * the one time a strip of results is the whole story.
   */
  const { strip, anchorIndex } = useMemo(() => {
    const finals = games.filter(g => g.status === 'final')
    const rest: StripItem[] = games.filter(g => g.status !== 'final').slice(0, UPCOMING)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    // The postseason fills whatever is left of the four upcoming slots: none of them during the
    // regular season, all of them once it ends.
    //
    // IF-NECESSARY GAMES ARE ON THE STRIP. `postseason` is DATE-SORTED, so the slots go to the
    // nearest fixtures, and a conditional game is usually one of them: skipping it runs tonight's
    // game straight into the next round, with the possible decider that tonight's result settles
    // nowhere on the page. "Is there baseball on Monday" is the question a reader opens Home with,
    // and "maybe, depending on tonight" is a better answer than silence. The chip says so; see
    // `PostseasonChip`.
    //
    // Nothing is needed to keep a certain game ahead of a conditional one on the same day, because
    // no two postseason games share a date. And `postseasonScheduleRows` drops a conditional game
    // outright once its series is decided, so this can never show a game that will not be played.
    for (const r of postseason) {
      if (rest.length >= UPCOMING) break
      rest.push({ kind: 'post', id: r.id, row: r })
    }
    // Every upcoming slot with no fixture to fill it is handed back to the finals side, so the strip
    // stays a full seven-chip row instead of trailing off into empty desktop space in the last week
    // of a season, when there is little or nothing still ahead. The extra results sit to the LEFT of
    // the anchored next game: a phone keeps them one swipe away and unchanged, and the desktop, which
    // shows the whole row, simply fills to its edge. The sum is still capped at the seven that fit.
    const headCount = RECENT_FINALS + (UPCOMING - rest.length)
    const head: StripItem[] = finals.slice(-headCount)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    return {
      strip: [...head, ...rest],
      anchorIndex: rest.length > 0 ? head.length : Math.max(0, head.length - 1),
    }
  }, [games, postseason])

  // Where the strip is scrolled to. Nothing is drawn from this: it gates the two desktop
  // hover-scroll zones, neither of which should be offered at the end it would scroll towards.
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  // Reads the scroll position into `atStart` / `atEnd`. A pure read, so it is safe to call from
  // anywhere, including outside the placement guard below.
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    setAtStart(c.scrollLeft <= 1)
    setAtEnd(c.scrollLeft + c.clientWidth >= c.scrollWidth - 1)
  }, [])

  // The reader taking the strip over. Set from real input only, never from onScroll: that fires
  // for our own placement too, which would cancel the anchoring on the first frame.
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

  // Put the anchor chip at the container's left edge, and keep putting it there until either the
  // layout stops moving or the reader scrolls.
  //
  // One placement is not enough, however late it is deferred: the chips keep resizing after first
  // paint as their team logos decode and the webfont swaps in, so any single measurement is of a
  // strip still growing and the landing spot would differ by reload. Instead of guessing a
  // settling time, re-run the placement on each layout change the strip reports. The math is a
  // delta from where the anchor currently sits, so re-running is idempotent: once it is in place
  // the delta is zero and every later call is a no-op.
  //
  // A layout effect, not a plain one. A useEffect runs AFTER the browser paints, so the reader
  // would get one frame of the strip at scrollLeft 0 (the oldest finals) before it jumps to the
  // anchor. ResizeObserver callbacks are delivered before paint too, so the later corrections are
  // invisible the same way.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (!c || strip.length === 0) return

    const place = () => {
      const el = scrollRef.current
      const anchor = el?.children[anchorIndex] as HTMLElement | undefined
      if (!el || !anchor || takenOverRef.current) return
      // No inset: the anchor chip sits flush with the container's left edge, which is the page's own
      // text column, so it starts exactly where every card below it starts.
      const inset = 0
      // A rect and `scrollLeft` are the same pixel here, so this is plain subtraction. Do not put a
      // scale (a CSS `zoom` on an ancestor, say) where only one of the two terms can see it:
      // getBoundingClientRect reports after it and scrollLeft before, and the strip opens off by the
      // scale factor.
      const delta = anchor.getBoundingClientRect().left - el.getBoundingClientRect().left - inset
      if (Math.abs(delta) > 0.5) el.scrollLeft += delta

      // AT MAX SCROLL THE CUT CHIP MOVES TO THE RIGHT-HAND EDGE, because a chip cut on its left is the
      // one thing on this strip that reads as broken.
      //
      // Once the rest of the season fits on screen the anchor cannot reach the left edge: the strip
      // runs out of scroll first and can leave a chip cut through the middle at the leading edge. A
      // chip cut on the LEFT loses its date, its badges and its clubs and keeps only the score column.
      // Cut on the RIGHT it keeps the eyebrow, both badges and both abbreviations and loses only the
      // scores, which reads as a card continuing past the edge. So give back the part-chip: one whole
      // game more on the left, and the last one part-shown on the right.
      //
      // Only at max scroll, where the anchor cannot reach the left edge however hard this pushes.
      // Everywhere else the placement above has already put a whole chip there, and re-running is
      // idempotent: the next pass pushes back to max and lands here again in the same frame, so
      // nothing is ever painted mid-way.
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
    // Watching the chips as well as the container is the point: a logo decoding changes a chip's
    // width without changing the container's.
    //
    // `syncEdges` RUNS OUTSIDE `place`, which returns early once the reader has taken the strip
    // over. That guard is right for the placement (their scroll position is theirs to keep) and
    // wrong for the edge state, which is only ever a reading of where the strip already is: behind
    // the guard, a strip that stops overflowing (a widened window, a shorter fixture list) would keep
    // offering a hover-scroll zone toward an end it cannot reach.
    const ro = new ResizeObserver(() => { place(); syncEdges() })
    ro.observe(c)
    for (const chip of Array.from(c.children)) ro.observe(chip)
    return () => ro.disconnect()
  }, [strip, anchorIndex, syncEdges])

  if (strip.length === 0) return null
  return (
    // 12px UNDER IT ON A PHONE, NOT SECTION_GAP. Every card on the mobile feed is 12px from the next
    // (the grid's own gap), and the scoreboard is the same kind of block as the cards under it, so
    // it flows into them at the same 12px. The desktop keeps SECTION_GAP, where this row separates a
    // full-width strip from a two-column grid and the extra room is doing that work.
    <Box sx={{ mb: { xs: 1.5, sm: SECTION_GAP } }}>
      {/* The card-title treatment (Next game / Teams / Compare), so every section on the feed
          announces itself the same way, and a real `h2`: the scoreboard is the only section on
          Home that is not a SectionCard, so without it a screen reader could not jump here.

          READ BUT NOT DRAWN ON A PHONE, for the reason the page's `h1` is (see the note there): a
          row of tiles, each with a date, two clubs and their scores, is already recognizably a
          scoreboard, and the word costs room above the first card. It stays in the DOM and the
          accessibility tree, which is what the heading is for. Drawn from `sm` up, where the page
          is a grid rather than a scroll and section headings tell the two columns apart. */}
      <Typography component="h2" sx={{
        fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2, mb: 1,
        ...HIDE_ON_PHONE,
      }}>Scoreboard</Typography>
      <Box sx={{ position: 'relative' }}>
        {/* Not a control: the key, wheel and pointer listeners only notice the reader taking over the
            scroll, so the strip stops scrolling itself. The chips inside are the links. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <Box ref={scrollRef} onScroll={syncEdges}
          onPointerDown={takeOver} onWheel={takeOver} onKeyDown={takeOver} sx={{
          display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
          // THE SCROLLER MUST BE A CONTAINING BLOCK, and the bottom nav is what breaks without it.
          // `overflow` only clips an absolutely positioned descendant whose containing block is inside the
          // scroller. PostseasonChip's VISUALLY_HIDDEN ", if necessary" is absolute, so without this it
          // resolves against the wrapper above, keeps its static position at the far end of the scrolled
          // row and widens the DOCUMENT. A phone then grows its layout viewport to fit, and every
          // `position: fixed` element is placed against that: the bottom bar lands at the foot of the page
          // and off to the right. Anything absolutely positioned inside a scroller needs the same.
          position: 'relative',
          // No scroll-snap: the strip stays wherever it's left rather than locking to a chip when
          // scrolling settles (or when desktop hover-scroll ends). Initial placement is done by
          // scrollLeft in the anchor effect, so it doesn't need snapping.
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }} data-swipe-ignore="true">
          {strip.map(item => item.kind === 'game'
            ? <GameChip key={item.id} game={item.game} teams={teams} onOpen={() => onOpenGame(item.game)} />
            : <PostseasonChip key={item.id} row={item.row} onOpenMatchup={onOpenMatchup} />)}
        </Box>
        {/* NO EDGE FADES. A leading fade paints over the anchor chip's date, since the chip sits
            flush with the page's column; a trailing fade alone leaves one edge fading and the
            other cutting hard, which reads as a bug rather than a style. A chip running off the
            right keeps its eyebrow, both badges and both clubs and loses only the score column,
            which reads as a card continuing past the edge. */}
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
