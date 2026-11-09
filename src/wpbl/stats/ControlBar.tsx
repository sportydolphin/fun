import { ACCENT_EDGE, TYPE_SCALE } from '../../ui/card'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { WPBL_ACCENT } from '../constants'
import {
  TeamBadge, PillGroup,
  CARD_BORDER, pressable, FOCUS_RING } from '../ui'
import type { WpblTeam } from '../types'
import type { SeasonScope } from '../season'
import { SeasonMenu } from '../SeasonMenu'
import type { Col } from '../statColumns'
import { PageTabs } from '../../ui/PageTabs'
import { FilterChip, FilterSelect } from '../../ui/FilterChip'
import type { Side, Totals, Source, Mode, View } from './axes'
import { VIEW_OPTIONS, SIDES, sideOn } from './axes'
import { boardTabOptions } from './boardTabs'
import { PINNED_CHROME, fullBleedStickySx } from './layout'

/** Which board, which side, and how to cut it: the board rows and the pinned control bar under them. */
export function ControlBar({ newBoards, activeBoard, selectBoard, isAnalysis, analysisBoards, source, isNarrow,
  stuckMarkRef, barRef, barStuck, mode, side, pickSide, hasViews, view, switchView, canFilter, sheetOpen,
  setSheetOpen, activeCol, filtersSet, hasPostseason, overall, scope, setScope, teamId, teamChips, filterTeam,
  qualified, toggleQualified }: {
  newBoards?: ReadonlySet<string>
  activeBoard: string
  selectBoard: (k: string) => void
  isAnalysis: boolean
  analysisBoards: { key: Source; label: string }[]
  source: Source
  isNarrow: boolean
  stuckMarkRef: React.RefObject<HTMLDivElement | null>
  barRef: React.RefObject<HTMLDivElement | null>
  barStuck: boolean
  mode: Mode
  side: Side
  pickSide: (s: Side) => void
  hasViews: boolean
  view: View
  switchView: (v: View) => void
  canFilter: boolean
  sheetOpen: null | 'sort' | 'filter'
  setSheetOpen: (tab: null | 'sort' | 'filter') => void
  activeCol: Col<Totals>
  filtersSet: boolean
  hasPostseason: boolean
  overall: boolean
  scope: SeasonScope
  setScope: (s: SeasonScope) => void
  teamId: string | null
  teamChips: WpblTeam[]
  filterTeam: (id: string | null) => void
  qualified: boolean
  toggleQualified: () => void
}) {
  // [0] the club chips, [1] the season slice, [2] the side switch's padding: the order they give
  // way in. With all three, Players on Hitting is one line from 960px (1200px at Large text).
  const { rowRef, slotRef, fits } = useRowFit(3, !isNarrow)
  const sidePill = (dense: boolean) => (
    <PillGroup
      options={SIDES.map(o => !sideOn(o.value, source, mode)
        ? { ...o, disabled: true, hint: o.value === 'overall' ? 'Leaders, Players and Run value only' : 'Leaders, Players, Teams and Find only' }
        : o)}
      value={side}
      onChange={v => pickSide(v as Side)}
      dense={dense}
    />
  )
  const takesSlice = source === 'leaders' || source === 'season' || source === 'bests' || source === 'find'
  const scopeOff = !takesSlice || overall
  const scopeHint = !takesSlice ? 'Leaders, Players, Teams, Bests and Find only' : overall ? 'Regular season only' : undefined
  /* ROW ONE: WHICH BOARD. One row of underline tabs, because that is what they are:
      tapping one replaces the screen. Drawn differently from the team filter and the
      qualified toggle on purpose, so a different page and a filter on this one never
      look alike, and placed above the side of the ball, which applies to all of them.
      The hierarchy is board, then side, then filters.

      Players and Teams are boards here rather than a Season/Players+Teams pair: "Season"
      means nothing on a section where every number is this season, and splitting it
      into the two things it actually ranks says that outright.

      Scrolls sideways rather than wrapping when Tracked is showing. SwipeableViews hands
      the gesture back at the edges, so an extra flick still pages to the next tab. */
   //
   // NOT PINNED ON A PHONE, which is where it is rendered from rather than what it looks
   // like. See where this is placed below.
  const boardTabs = (
    <PageTabs options={boardTabOptions(newBoards)} value={activeBoard} onChange={selectBoard} />
  )
  // Analysis's own boards, under the row that opened them, and only there.
  const analysisTabs = isAnalysis ? (
    <PageTabs sub options={analysisBoards.map(b => ({ value: b.key, label: b.label }))} value={source}
      onChange={k => selectBoard(k)} />
  ) : null

  return (
    <>
      {/* The control bar, pinned, so a long table never scrolls every control off the top. It
          offsets by PINNED_CHROME, whose note explains both terms. Above the table's own
          sticky header, which pins inside the scroll box below it. */}
      {/* Where the bar sits when nothing is pinning it. Zero height, no paint; see the
          barStuck effect for what reads it. */}
      {/* ON A PHONE THE BOARD PICKER SCROLLS AWAY, and that is what pays for the table below it.
          WHICH BOARD is a decision you make once and then read; SORT and FILTERS are what you
          reach for while reading, so those are what the bar keeps. Everything the bar pins is
          height the board underneath has to clear, because the board is pinned to the bar's
          bottom edge and has to fit between there and the footer: the tabs are about half the
          bar, and pinning them would cost a row of stats on every phone at every scroll
          position. Desktop keeps them in the bar, where the whole thing is one row. */}
      {isNarrow && <Box sx={{ ...fullBleedStickySx, pt: 1 }}>{boardTabs}{analysisTabs}</Box>}
      <Box ref={stuckMarkRef} aria-hidden sx={{ height: 0 }} />
      <Box ref={barRef} sx={{
        position: 'sticky',
        top: PINNED_CHROME,
        zIndex: 6,
        bgcolor: 'background.default',
        // Tighter on a phone, where every pixel of this pinned bar comes off the capped board below.
        pt: { xs: 0.5, sm: 1 },
        transition: 'box-shadow 0.2s',
        // An EDGE once it is holding something under it, and NOTHING before that. Without any
        // edge, rows slide up and vanish into an unexplained band of page color below the
        // pills, which reads as the table being eaten rather than as a bar it is passing
        // behind. A shadow, not a hairline: a rule would sit directly under the Hitting/Pitching
        // pills and, on boards that lead with prose, across the page above the first sentence,
        // with the board tabs already drawing one rule nearby.
        //
        // BOTTOM EDGE ONLY, which is what the negative spread buys. A plain `0 4px 12px` blurs
        // 12px in every direction with no offset to pull it down, so on a full-bleed bar those
        // 12px hang off the LEFT and RIGHT of the header as two vertical shadow strips down the
        // sides of the page. Spread equal to the negative of the blur cancels the horizontal
        // reach exactly (side extent = blur + spread = 0) while the y offset still drops a soft
        // edge below, which is the only side content actually passes under.
        boxShadow: barStuck ? '0 6px 6px -6px rgba(0,0,0,0.14)' : 'none',
        // Four pixels of the same paint above the top edge, for the seam with the bar above.
        // Two sticky bars meeting at a shared offset agree only to within a rounding error,
        // and a rounding error is a device pixel of the page showing between them. Same
        // reasoning as the frozen columns' seam cover: put something there so whatever the
        // device rounds to lands on paint rather than on a stats row.
        //
        // It lands on the nav's bottom 4px, which includes the hairline the nav draws when it
        // pins, and covering that is the intent as much as the seam is: with a second bar
        // directly beneath it, a rule across the middle of the chrome and none at the bottom
        // is the wrong way round. The stack now shows one edge, and it is the one content
        // actually passes under.
        '&::before': {
          content: '""', position: 'absolute', left: 0, right: 0, top: -4, height: 4,
          bgcolor: 'background.default', pointerEvents: 'none',
        },
        ...fullBleedStickySx,
      }}>
      {!isNarrow && boardTabs}
      {!isNarrow && analysisTabs}

      {/* ROW TWO: HOW TO CUT IT. Side of the game on the left in a segmented pill, which is a
          third visual language on purpose: underline tabs are pages, this is a switch that applies
          to whichever page you are on, and chips are filters. The row keeps its height on every
          board (the right-hand controls just empty out), so the bar does not grow and shrink under
          a sticky header as you move between boards.

          THE SWITCH IS IN ONE PLACE ON EVERY BOARD: first, at the bleed's left edge, under the first
          board tab. It used to follow each board's own column, which at 1440 sent it 300px to the
          right on Bests and back again on Players, so "where is Hitting/Pitching" had a different
          answer per board; a control the reader reaches for on every board has to be where their
          hand already is. The boards keep their own columns underneath. */}
      {/* data-one-row: the layout sweep fails any width at or above the number where this row's
          children stop sharing one line. See useClubChipsFit for what gives way first. */}
      <Box ref={rowRef} data-one-row="960" sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, rowGap: 1, pb: { xs: 1, sm: 1.5 },
      }}>
        {/* Two things, both about the switch staying put as the reader moves between boards on
            a phone.

            HEIGHT. The pill on the right is 34px high against this switch's 28.7, so without a
            reserve the row stands 34 on the boards that have one and 28.7 elsewhere, and moving
            between them nudges the switch and the board under it by five pixels, under a bar that
            is otherwise pinned still. The reserve is HERE rather than on the row: the row carries
            its own bottom padding, so a min-height on it would have to know that padding.

            WIDTH. It sits next to a pill that refuses to shrink, so on a narrow phone the flex
            algorithm would take any overflow out of this one, and the switch would come out
            narrower on some boards than others. Wrapping is the better failure. */}
        <Box sx={{
          flexShrink: 0, display: 'flex', alignItems: 'center', position: 'relative',
          minHeight: isNarrow ? 34 : undefined,
        }}>
          {/* Four sides at full padding are 273px, and beside the 90px Sort pill that is more than a
              375px phone's 351px row, so from Overall's arrival the pill wrapped onto a row of its
              own on Players and Teams: a taller bar pinned over the board, and the board jumping a
              row on every move between Leaders and Players. Dense on a phone, and on a desktop as
              the last thing to give way once both selects have (useRowFit). */}
          {isNarrow ? sidePill(true) : <Box ref={slotRef(2)} sx={{ display: 'flex' }}>{sidePill(!fits[2])}</Box>}
        </Box>
        {/* Desktop only. A phone's ranked list shows one stat, so there is nothing to switch; its
            full table carries the same switch in the footer, where the bar has no room left. */}
        {source === 'season' && !isNarrow && hasViews && (
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <PillGroup options={VIEW_OPTIONS} value={view} onChange={v => switchView(v as View)} />
          </Box>
        )}

        {/* PHONES: ONE PILL, for the sort and the filters together, in one sheet with a tab for
            each. Two pills beside a three-way switch came to 382px in a 351px row, and the switch
            was the one thing that could not give. The pill says what the board is ranked by, which
            is what a reader checks most; the dot says some filter is off its default, so a filter
            can never be silently on. Desktop keeps the chips inline, where there is room for the
            whole filter set at once and the column headers already sort.

            NO SORT ON LEADERS, BESTS OR FIND. Each of their boards ranks by its own stat and says
            so in its own title, so there is no column to choose there. */}
        {isNarrow && (source === 'season' || canFilter) && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Box {...pressable(() => setSheetOpen(source === 'season' ? 'sort' : 'filter'))}
              aria-haspopup="dialog" aria-expanded={sheetOpen != null}
              aria-label={source === 'season' ? `Sort ${activeCol.label}${filtersSet ? ', filters on' : ''}` : `Filters${filtersSet ? ', on' : ''}`}
              sx={{
                ...FOCUS_RING,
                display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0,
                cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                minHeight: 34, px: 1, borderRadius: 999, fontSize: TYPE_SCALE.body, fontWeight: 700,
                border: '1px solid', transition: 'all 0.15s',
                borderColor: source === 'season' || filtersSet ? ACCENT_EDGE : CARD_BORDER,
                bgcolor: source === 'season' || filtersSet ? `${WPBL_ACCENT}12` : 'transparent',
                color: source === 'season' || filtersSet ? 'var(--wpbl-accent-fg)' : 'text.secondary',
              }}>
              {source === 'season' ? (
                <>
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 700 }}>Sort</Box>
                  {activeCol.label}
                </>
              ) : 'Filters'}
              {filtersSet && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: WPBL_ACCENT }} />}
              <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>▾</Box>
            </Box>
          </Box>
        )}

        {/* WHICH SEASON. Chips rather than a third segmented pill, because it is a filter on
            the data and not a switch between two views of it, and because it has three
            options where the side switch has two.

            ONLY WHERE IT DOES SOMETHING, and only once a postseason game has actually
            finished. The season tables, Bests and Find all filter their lines through
            `scopedLines`, so the switch moves all three; the other boards (Pitch by pitch, Run
            value, Tracked) read their own data through paths this does not touch, so offering it
            there would be a control that silently does nothing.

            IT MATTERS MOST ON BESTS, which is the one board where the two slices are separate
            books rather than one number counted over more games: a postseason record is its
            own record, and folding it into the regular season's would quietly overwrite a
            league record with a playoff one. */}
        {/* DESKTOP ONLY. On a phone these three would wrap onto a row of their own and take that
            height from the table, which is capped so its column headers cannot be carried up
            behind the bar. They are in the Filters sheet there, which is what they are. */}
        {/* THE YEAR, on every board, since every board sums one: before the season slice, because it
            is the wider cut of the two. Not drawn at all until there is a second year to pick. */}
        {!isNarrow && <SeasonMenu sx={{ flexShrink: 0, alignItems: 'center' }} />}
        {/* DRAWN ON EVERY BOARD once there is a postseason, and disabled where the board cannot
            take the slice: removed instead, the desktop bar reflowed every time the side or the board
            changed (Nov 7, 2026 audit). Overall is the regular season's, so that chip stays lit. */}
        {/* A select when the row is short of room, after the clubs have already given way. */}
        {hasPostseason && !isNarrow && (
          <Box ref={slotRef(1)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {fits[1] ? SCOPES.map(([k, label]) => (
              /* "Both" rather than "All", which is what this option is: the team filter sitting
                  immediately to its right already has an "All" chip, and two chips reading All
                  side by side in one row is a coin toss about which one a tap changes. */
              <Chip key={k} active={takesSlice && (overall ? k === 'regular' : scope === k)} onClick={() => setScope(k)}
                disabled={scopeOff} hint={scopeHint}>
                {label}
              </Chip>
            )) : (
              <FilterSelect
                value={overall || !takesSlice ? 'regular' : scope}
                options={SCOPES.map(([value, label]) => ({ value, label }))}
                onChange={v => setScope(v as SeasonScope)}
                active={!scopeOff && scope !== 'regular'}
                disabled={scopeOff}
                hint={scopeHint}
                ariaLabel="Season slice"
              />
            )}
          </Box>
        )}

        {/* Desktop: the filters themselves, no sheet in the way. */}
        {source === 'season' && mode === 'players' && !isNarrow && (
          <Box sx={{ ml: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {/* CHIPS WHEN THEY FIT, A SELECT WHEN THEY DO NOT, decided by measuring the row. This
                was a CSS breakpoint (chips from `lg`), sized to the row as it stood; then Overall
                added a fourth side and the row came to 1315px in a 1260px column, and the clubs
                wrapped onto a second line at every desktop width (Nov 9, 2026). Any fixed width is
                wrong the next time a control joins the row, so the row is measured instead, in
                layout effects, before anything paints (useRowFit). */}
            <Box ref={slotRef(0)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {fits[0] ? <>
                <Chip active={teamId === null} onClick={() => filterTeam(null)}>All</Chip>
                {teamChips.map(t => (
                  <Chip key={t.id} active={teamId === t.id} onClick={() => filterTeam(teamId === t.id ? null : t.id)}>
                    <TeamBadge team={t} size={16} />
                    <Box component="span" sx={{ ml: 0.5 }}>{t.abbr}</Box>
                  </Chip>
                ))}
              </> : (
                <FilterSelect
                  value={teamId ?? ''}
                  options={[{ value: '', label: 'All clubs' }, ...teamChips.map(t => ({ value: t.id, label: t.abbr }))]}
                  onChange={v => filterTeam(v || null)}
                  active={teamId !== null}
                  ariaLabel="Club"
                />
              )}
            </Box>
            {!overall && (
              <>
                <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
                <Chip active={qualified} onClick={() => toggleQualified()}>{qualified ? '✓ Qualified' : 'Qualified'}</Chip>
              </>
            )}
          </Box>
        )}
      </Box>
      </Box>
    </>
  )
}


// Small pill used for the team filter + qualified toggle.
const Chip = FilterChip

const SCOPES = [['regular', 'Regular season'], ['postseason', 'Playoffs'], ['all', 'Both']] as const

/**
 * Which of the row's controls are drawn full (`fits[i]` true) and which in their compact form, so
 * the row stays one line. Index order is the order they give way in, and the reverse of the order
 * they come back. One form of each is drawn at a time (two would put every chip on the page twice),
 * so each form's width is remembered from the last time it was drawn, and each pass moves one step:
 * collapse the next control while the row overflows, bring the last one back when its remembered
 * width fits. Every pass is a layout effect, so the reader only sees where it settles. Re-measured
 * on every render (a side switch adds or drops Qualified) and on any resize of the row or its
 * parts (the window, the reader's text size, a font arriving). A remembered width that has gone
 * stale costs one more pass, never a loop: drawn, it is measured again and remembered right.
 */
function useRowFit(count: number, enabled: boolean) {
  // State rather than a ref, so the observer below follows the row if it is ever remounted rather
  // than staying on a detached one that never hears the window resize again.
  const [row, rowRef] = useState<HTMLDivElement | null>(null)
  const slots = useRef<(HTMLDivElement | null)[]>(Array.from({ length: count }, () => null))
  const widths = useRef(Array.from({ length: count }, () => ({ full: NaN, compact: NaN })))
  const [fits, setFits] = useState<boolean[]>(() => Array.from({ length: count }, () => true))
  const measure = useCallback(() => {
    if (!row) return
    const width = (el: Element) => el.getBoundingClientRect().width
    setFits(prev => {
      prev.forEach((full, i) => {
        const slot = slots.current[i]
        if (slot) widths.current[i][full ? 'full' : 'compact'] = width(slot)
      })
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      const shown = ([...row.children] as HTMLElement[]).filter(k => k.offsetWidth > 0)
      const used = shown.reduce((s, k) => s + width(k), 0) + gap * Math.max(0, shown.length - 1)
      // Half a pixel of slack for sub-pixel widths that sum a hair over the row they fit in.
      const room = width(row) + 0.5
      const drawn = (i: number) => slots.current[i] != null
      if (used > room) {
        const i = prev.findIndex((full, j) => full && drawn(j))
        return i < 0 ? prev : prev.map((v, j) => (j === i ? false : v))
      }
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i] || !drawn(i)) continue
        const { full, compact } = widths.current[i]
        // A full width never seen is tried once; drawn, it is measured and remembered.
        return Number.isNaN(full) || used - compact + full <= room ? prev.map((v, j) => (j === i ? true : v)) : prev
      }
      return prev
    })
  }, [row])
  // No dependency list on purpose: every render can change what is on the row.
  useLayoutEffect(() => { if (enabled) measure() })
  useLayoutEffect(() => {
    if (!enabled || !row || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    for (const k of row.children) ro.observe(k)
    return () => ro.disconnect()
  }, [enabled, row, measure])
  const slotRef = useCallback((i: number) => (el: HTMLDivElement | null) => { slots.current[i] = el }, [])
  return { rowRef, slotRef, fits }
}
