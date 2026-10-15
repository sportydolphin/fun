import { NameText } from '../../ui/NameText'
import { TYPE_SCALE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { WPBL_ACCENT } from '../constants'
import {
  TeamBadge, ExpandRow,
  CARD_BORDER } from '../ui'
import type { Col } from '../statColumns'
import { BOTTOM_NAV_SPACE } from '../BottomNav'
import { typePx } from '../../ui/scale'
import { HEAD_LABEL_SX, HEAD_LEAGUE_SX, HEAD_LEAGUE_TINT } from '../../ui/statsTableHead'
import type { Totals, Mode } from './axes'
import { cellText } from './columns'
import { PINNED_CHROME, BOARD_TOP, BOARD_TAIL_PX, BOARD_TAIL_BARE_PX, MIN_BOARD_PX, fullBleedStickyCardSx, SEAM_COVER, FROZEN_EDGE, RANK_W, HEAD_FOCUS } from './layout'
import type { RankMark, Row } from './shared'
import { RankText, FADED } from './shared'

/** The grid: every column of the board, the name frozen at the left and, on a phone, the sorted
 *  column frozen beside it. Players and Teams on every side are this one table. */
export function SeasonTable({ listRef, pinActive, scrollRef, boardPinned, hideSiteFooter, nameW, nameInnerMax,
  teamsNarrow, rows, noun, mode, headProps, activeCol, sortKey, sortAsc, scrollCols, leagueCell, visibleRows, ranks,
  pickedId, pickedRef, pickedTint, clickHeader, scrollX, tableCapped, listCap, capped, setExpanded, collapse,
  boardFooter }: {
  listRef: React.RefObject<HTMLDivElement | null>
  pinActive: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  boardPinned: boolean
  hideSiteFooter: boolean
  nameW: string
  nameInnerMax: string
  teamsNarrow: boolean
  rows: Row[]
  noun: string
  mode: Mode
  headProps: (c: Col<Totals>) => {
    tabIndex: number
    title: string
    'aria-sort': 'ascending' | 'descending' | undefined
    onClick: () => void
    onKeyDown: (e: React.KeyboardEvent) => void
  }
  activeCol: Col<Totals>
  sortKey: string
  sortAsc: boolean
  scrollCols: Col<Totals>[]
  leagueCell: (c: Col<Totals>) => string
  visibleRows: Row[]
  ranks: RankMark[]
  pickedId: string | null
  pickedRef: React.RefObject<HTMLElement | null>
  pickedTint: string
  clickHeader: (c: Col<Totals>) => void
  scrollX: { atStart: boolean; atEnd: boolean }
  tableCapped: boolean
  listCap: number
  capped: boolean
  setExpanded: (expanded: boolean) => void
  collapse: () => void
  boardFooter: React.ReactNode
}) {
  // NO text-transform. The column labels are already written in capitals, and the two that are
  // not (wOBA, wRC+) are spelled that way on purpose: the lowercase w is part of the name. Only
  // the Player/Team heading is set in capitals, on its own cell.
  const thBase = {
    position: 'sticky' as const, top: 0, zIndex: 3, bgcolor: 'background.paper',
    // Above a phone the box never scrolls vertically, so `top` holds nothing; see headShift.
    transform: pinActive ? undefined : 'translateY(var(--wpbl-head-shift, 0px))',
    fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.4),
    color: 'text.disabled', py: 0.75, px: 0.5, whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  }
  // The body cells, shared by every player row.
  const nameCellSx = {
    position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper',
    textAlign: 'left', fontWeight: 400, py: 0.5, px: 1,
    width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined,
    borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
    touchAction: pinActive ? 'pan-y' : undefined,
  } as const
  const pinnedCellSx = {
    position: 'sticky', left: nameW, zIndex: 3, touchAction: 'pan-y',
    textAlign: 'center', py: 0.5, px: 0.5,
    borderTop: '1px solid', borderRight: '1px solid', borderColor: 'divider',
    fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
    backgroundColor: 'background.paper',
    backgroundImage: `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)`,
    '&::before': SEAM_COVER,
    '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
    whiteSpace: 'nowrap',
  } as const
  const cellSx = (active: boolean) => ({
    textAlign: 'center', py: 0.5, px: 0.5, borderTop: '1px solid', borderColor: 'divider',
    fontSize: TYPE_SCALE.body, fontWeight: active ? 800 : 500,
    color: active ? 'var(--wpbl-accent-fg)' : 'text.primary',
    // Layered like the header, so a hovered row and the sorted column
    // compose instead of one of them winning outright.
    backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}12, ${WPBL_ACCENT}12)` : undefined,
    whiteSpace: 'nowrap',
  } as const)
  // THE LEAGUE AVERAGE IS IN THE HEADER, on every screen, as the header's second row (see
  // src/ui/statsTableHead.ts). As a body row it cost 35px of a phone's capped board; in the header
  // it pins, so the averages stay beside the column labels down the whole board.

  return (
    <Box ref={listRef} sx={{
      // ON A PHONE, PINNED UNDER THE BAR, so the page cannot carry the board's column headers up
      // behind it. The headers stick to the top of the scroll box inside, and that box is
      // an ordinary element in page flow: without this, scrolling the PAGE takes the whole
      // board up and the labels go with it, which reads as a table that has lost its
      // headings. The board has no reason to travel anyway. Everything a reader came here
      // to move is inside it, and the little the page has left to scroll is the footer.
      //
      // UNDER the bar, never over it: the bar is `zIndex: 6` and this is 1. Without saying
      // so the board would paint on top of the bar it is sliding beneath, since both are
      // positioned and this one comes later in the DOM.
      //
      // Above a phone the board is as tall as its rows (see headShift), and a sticky box taller
      // than the screen holds its top in place while the page scrolls, so its last rows could
      // never come into view. `scrollMarginTop` is where collapsing "Show all" lands it.
      position: pinActive ? 'sticky' : 'relative', top: pinActive ? BOARD_TOP : undefined, zIndex: 1,
      scrollMarginTop: BOARD_TOP,
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
      ...fullBleedStickyCardSx,
    }}>
      <Box sx={{ position: 'relative' }}>
      {/* On a phone, a capped inner scroll so the column headers stay sticky (top:0) as you
          scroll the rows, which hands its vertical scroll to the page until the board pins
          (see `boardPinned`). `dvh` tracks the mobile browser chrome so the cap doesn't
          overshoot. Above a phone there is no cap at all: the table is as tall as its rows and
          scrolls only sideways (see headShift).

          Going taller than the free gap breaks the thing the phone's box exists for: a table
          taller than the gap can never be scrolled fully into it, so its sticky header parks
          behind the nav and the reader loses the column labels for the rest of the board. */}
      <Box ref={scrollRef} sx={{
        // On a phone, vertical scroll waits for the board to pin; see `boardPinned`.
        overflowX: 'auto', overflowY: !pinActive || boardPinned ? 'auto' : 'hidden',
        // Y left to the browser everywhere. A phone hands the drag back to the page at the
        // table's top; above one this box cannot scroll vertically, and `contain` on it was
        // what kept the wheel over the table from ever reaching the page.
        overscrollBehaviorX: 'contain', overscrollBehaviorY: 'auto',
        ...(pinActive && {
          // ON A PHONE THE CAP IS THE REAL GAP: the screen, less the bars above, less the
          // footer below, less the board's own furniture. The board is sticky (see where it
          // pins), but sticky only holds while the board FITS between the bar and whatever
          // follows it.
          //
          // THE FOOTER IS MEASURED, THE REST IS NOT, and that split is the whole safety of
          // it. `--wpbl-foot-h` comes off the `<footer>` element, whose height cannot depend
          // on the board's. Deriving the cap from the DOCUMENT's height instead would loop:
          // on a phone that includes the swipe pager's full-screen floor, so the board's
          // height feeds back into its own cap, and read from a tab the pager has not yet
          // shown it measures a zero rect and renders no board at all. The floor is what
          // stops any of that reaching the screen.
          //
          // THE BOTTOM NAV IS BELOW EVERYTHING ELSE, as padding the shell reserves so the footer
          // clears it (`BOTTOM_NAV_SPACE` plus the home-indicator inset, in WpblApp). It is not
          // pinned at the TOP, so PINNED_CHROME reads 0 on a phone and says nothing about it.
          // Leaving it out made the board 76px too tall (about 110px on an iPhone), and at the
          // bottom of the page the column headers slid up behind the control bar.
          maxHeight: `max(${MIN_BOARD_PX}px, calc(100dvh - ${BOARD_TOP} - var(--wpbl-foot-h, 0px)`
            + ` - var(--wpbl-board-foot-h, 0px) - (${BOTTOM_NAV_SPACE}) - env(safe-area-inset-bottom, 0px)`
            + ` - ${hideSiteFooter ? BOARD_TAIL_BARE_PX : BOARD_TAIL_PX}px))`,
          // A very short screen: what fits in the gap the PINNED chrome leaves, 100px being this
          // page's own control bar (about 91px, the rest slack).
          '@media (max-height: 560px)': {
            maxHeight: `calc(100dvh - ${PINNED_CHROME} - 100px)`,
          },
        }),
      }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              {/* TWO ROWS, the labels and then the league (src/ui/statsTableHead.ts). On a phone
                  the count follows "League avg" to the right, since a lone left-aligned line over
                  a right-aligned one read as a mistake in a cell that narrow. */}
              <Box component="th" data-swipe-handle="" sx={{ ...thBase, ...HEAD_LABEL_SX, textTransform: 'uppercase', left: 0, zIndex: 4, textAlign: pinActive ? 'right' : 'left', width: pinActive ? nameW : undefined, minWidth: nameW, maxWidth: pinActive ? nameW : undefined, borderRight: '1px solid', borderColor: 'divider', px: 1, touchAction: pinActive ? 'pan-y' : undefined }}>
                {/* On a phone the count lives here, since the board's footer gave up its line
                    of words for the height; see boardFooter. */}
                {pinActive ? `${rows.length} ${noun}` : mode === 'teams' ? 'Team' : 'Player'}
              </Box>
              {pinActive && (
                <Box component="th" data-swipe-handle="" {...headProps(activeCol)} sx={{
                  ...HEAD_FOCUS,
                  ...thBase, ...HEAD_LABEL_SX, position: 'sticky', left: nameW, zIndex: 5, touchAction: 'pan-y',
                  textAlign: 'center', cursor: 'pointer', minWidth: '3.125rem', px: 0.5,
                  color: 'var(--wpbl-accent-fg)',
                  backgroundImage: `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)`,
                  borderRight: '1px solid', borderColor: 'divider',
                  '&::before': SEAM_COVER,
                  '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
                }}>
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                    {activeCol.label}
                    <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>{sortAsc ? '↑' : '↓'}</Box>
                  </Box>
                </Box>
              )}
              {scrollCols.map(c => {
                const active = c.key === sortKey
                return (
                  <Box component="th" key={c.key} {...headProps(c)}
                    data-active={active ? 'true' : undefined}
                    sx={{
                      ...thBase, ...HEAD_LABEL_SX, ...HEAD_FOCUS, textAlign: 'center', cursor: 'pointer', minWidth: '2.375rem',
                      color: active ? 'var(--wpbl-accent-fg)' : 'text.disabled',
                      // The sorted column's tint rides on backgroundImage over the opaque
                      // paper thBase already sets. As a bgcolor it would REPLACE that paper
                      // with a 14%-alpha accent, so this one header cell would go see-through
                      // and the rows scrolling under the sticky header would show through it.
                      // Same layering the frozen column beside it uses.
                      backgroundImage: active ? `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24)` : undefined,
                      '&:hover': { color: 'var(--wpbl-accent-fg)' },
                    }}>
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2 }}>
                      {c.label}
                      {active && <Box component="span" sx={{ fontSize: TYPE_SCALE.caption }}>{sortAsc ? '↑' : '↓'}</Box>}
                    </Box>
                  </Box>
                )
              })}
            </Box>
            {/* Row two: the league. "League avg" right-aligned in the name column, because it is
                a row label for the figures to its right: flush left it sat a column-width away
                from the number it names. A rate only, for the reason leagueCell gives. */}
            <Box component="tr">
              <Box component="th" data-swipe-handle="" sx={{
                ...thBase, ...HEAD_LEAGUE_SX, left: 0, zIndex: 4, textAlign: 'right', px: 1,
                backgroundImage: HEAD_LEAGUE_TINT,
                borderRight: '1px solid', borderColor: 'divider', touchAction: pinActive ? 'pan-y' : undefined,
              }}><span data-league-head="">League avg</span></Box>
              {pinActive && (
                <Box component="th" data-swipe-handle="" sx={{
                  ...thBase, ...HEAD_LEAGUE_SX, left: nameW, zIndex: 5, touchAction: 'pan-y', textAlign: 'center', px: 0.5,
                  backgroundImage: `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24), ${HEAD_LEAGUE_TINT}`,
                  borderRight: '1px solid', borderColor: 'divider',
                  '&::before': SEAM_COVER,
                  '&::after': scrollX.atStart ? undefined : FROZEN_EDGE,
                }}><span data-league-head="">{leagueCell(activeCol)}</span></Box>
              )}
              {scrollCols.map(c => (
                <Box component="th" key={c.key} sx={{
                  ...thBase, ...HEAD_LEAGUE_SX, textAlign: 'center',
                  backgroundImage: c.key === sortKey
                    ? `linear-gradient(${WPBL_ACCENT}24, ${WPBL_ACCENT}24), ${HEAD_LEAGUE_TINT}`
                    : HEAD_LEAGUE_TINT,
                }}><span data-league-head="">{leagueCell(c)}</span></Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {visibleRows.map((r, i) => {
              // Under the qualifying bar, on a board showing everyone. Faded rather than
              // hidden, which is the whole point of choosing Everyone, and rather than
              // marked with a symbol, which would be one more thing on a row to decode.
              // The footer says what the bar is.
              const faded = mode === 'players' && !r.qualified
              const fade = (node: React.ReactNode) => faded
                ? <Box component="span" sx={{ opacity: FADED }}>{node}</Box>
                : node
              return (
                <Box component="tr" key={r.key} onClick={r.onClick}
                  data-faded={faded ? '' : undefined}
                  ref={r.key === pickedId ? (el: HTMLElement | null) => { pickedRef.current = el } : undefined}
                  sx={{
                    // The picked-out player, tinted through backgroundImage for the same reason
                    // as hover below: the sticky cells need their opaque backgroundColor.
                    ...(r.key === pickedId ? { '& > td, & > th': { backgroundImage: pickedTint } } : {}),
                    cursor: r.onClick ? 'pointer' : 'default', userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    // Hover tints via backgroundImage for the same reason as the header:
                    // the row's frozen name cell (and, on a phone, its pinned sort cell)
                    // is sticky and relies on an opaque backgroundColor. Overwriting that
                    // would make the hovered row's name cell transparent, so the stat
                    // columns scrolling beneath it would show through.
                    '@media (hover: hover)': {
                      '&:hover > td, &:hover > th': r.onClick
                        ? { backgroundImage: `linear-gradient(${WPBL_ACCENT}0e, ${WPBL_ACCENT}0e)` }
                        : undefined,
                    },
                  }}>
                  <Box component="th" data-swipe-handle="" sx={nameCellSx}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: faded ? FADED : undefined }}>
                      {/* Four rows, already in sorted order, with the sorted column
                          arrowed in the header: the rank digit restates all of that and
                          costs 24px that a nickname needs to render whole.

                          FLEX-END, NOT text-align: right. A tied two-digit rank ("T-24") is
                          wider than the column, and right-aligned TEXT still overflows to the
                          right, into the badge. A flex-end box overflows at its start, so the
                          extra runs left into the cell's padding, where there is room. */}
                      {!teamsNarrow && (
                        <Typography sx={{ width: RANK_W, display: 'flex', justifyContent: 'flex-end', flexShrink: 0, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled', whiteSpace: 'nowrap' }}>
                          <RankText rank={ranks[i]} />
                        </Typography>
                      )}
                      {r.team && <TeamBadge team={r.team} size={20} />}
                      <Box sx={{ minWidth: 0, maxWidth: pinActive ? nameInnerMax : undefined }}>
                        {/* The NAME is the link, not the row: a <tr> cannot be an <a>, and
                            the row keeps its own onClick so the whole width stays a target.
                            This is the anchor a crawler follows and the tab stop a keyboard
                            lands on. */}
                        {/* BLOCK, which is what keeps the row at its own height. With a link the
                            name renders as an inline <a>, and an inline box inside this one sits
                            on a line box struck at the inherited 24px, not at its own 1.15, so
                            every player row came out 9px taller than its text: two rows fewer
                            on a phone's capped board. A team row has no link and renders a <p>,
                            already a block, which is why the league row never showed it. */}
                        {r.fullName
                          ? <NameText name={r.fullName} linkProps={r.link} sx={{ display: 'block', fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.15 }} />
                          : <Typography {...r.link} sx={{ display: 'block', fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {teamsNarrow && r.shortLabel ? r.shortLabel : r.label}
                            </Typography>}
                        {/* Not on a phone, where the board is capped to the screen and the line
                            costs a sixth of every row. The card behind the tap has it, and the
                            ranked list never carried it either. */}
                        {r.sublabel && !pinActive && <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1 }}>{r.sublabel}</Typography>}
                      </Box>
                    </Box>
                  </Box>
                  {pinActive && (
                    <Box component="td" data-swipe-handle="" onClick={e => { e.stopPropagation(); clickHeader(activeCol) }} sx={pinnedCellSx}>
                      {fade(cellText(activeCol, r.totals))}
                    </Box>
                  )}
                  {scrollCols.map(c => {
                    const active = c.key === sortKey
                    return (
                      <Box component="td" key={c.key} onClick={e => { e.stopPropagation(); clickHeader(c) }} sx={cellSx(active)}>
                        {fade(cellText(c, r.totals))}
                      </Box>
                    )
                  })}
                </Box>
              )
            })}
          </Box>
        </Box>
      </Box>
      {/* Right-edge fade ("more stats this way"), hidden once you've scrolled to the end. */}
      <Box aria-hidden sx={theme => ({
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none', zIndex: 6,
        background: `linear-gradient(to right, ${alpha(theme.palette.background.paper, 0)}, ${theme.palette.background.paper})`,
        opacity: scrollX.atEnd ? 0 : 1, transition: 'opacity 0.2s',
      })} />
      </Box>
      {/* Outside the scroll box, so the way to the rest is on screen without reaching its end. */}
      {tableCapped && rows.length > listCap && (
        <ExpandRow expanded={!capped} moreLabel={`Show all ${rows.length} ${noun}`}
          onToggle={capped ? () => setExpanded(true) : collapse} />
      )}
      {boardFooter}
    </Box>
  )
}
