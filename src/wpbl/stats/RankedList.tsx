import { TYPE_SCALE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import {
  TeamBadge, PlayerPortrait, ExpandRow,
  CARD_BORDER, pressable, FOCUS_RING, tappableIf } from '../ui'
import type { Col } from '../statColumns'
import { typePx } from '../../ui/scale'
import type { Totals, Mode } from './axes'
import { cellText } from './columns'
import { PINNED_CHROME, fullBleedSx } from './layout'
import type { RankMark, Row } from './shared'
import { RankText, FADED } from './shared'

/** The phone's ranked list: one stat, the top LIST_CAP, and the rest behind Show all. */
export function StatList({ listRef, mode, activeCol, leagueCell, sortAsc, visibleRows, ranks, pickedId, pickedRef,
  pickedTint, contextCols, rows, listCap, capped, noun, setExpanded, collapse, boardFooter }: {
  listRef: React.RefObject<HTMLDivElement | null>
  mode: Mode
  activeCol: Col<Totals>
  leagueCell: (c: Col<Totals>) => string
  sortAsc: boolean
  visibleRows: Row[]
  ranks: RankMark[]
  pickedId: string | null
  pickedRef: React.RefObject<HTMLElement | null>
  pickedTint: string
  contextCols: Col<Totals>[]
  rows: Row[]
  listCap: number
  capped: boolean
  noun: string
  setExpanded: (expanded: boolean) => void
  collapse: () => void
  boardFooter: React.ReactNode
}) {
  return (
    <Box ref={listRef} sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
      scrollMarginTop: `calc(${PINNED_CHROME} + 104px)`,
      ...fullBleedSx,
    }}>
      {/* A one-line header, the way the grid has one. Without it the big number on the right
          would be the only unlabeled figure on the row. Labeled here rather than on each row,
          because ten greyed "AVG"s down a column is the same word ten times, and it gives the
          list the direction arrow the grid gets: on the ERA board, ranked best first, the
          numbers ascend and nothing else says so. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.4),
          textTransform: 'uppercase', color: 'text.disabled',
        }}>{mode === 'teams' ? 'Team' : 'Player'}</Typography>
        {/* The league's figure for the stat being ranked, in the header line rather than a
            row of its own: it cost 33px of the first screen as a row, and here it costs
            nothing. A rate only, for the reason the table's league headers leave their counting
            cells empty. */}
        {activeCol.rate && (
          <Typography data-league-head="" sx={{
            flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 600, color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}>League avg {leagueCell(activeCol)}</Typography>
        )}
        <Typography sx={{
          // Not uppercased: see thBase on wOBA and wRC+.
          flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.4),
          color: 'var(--wpbl-accent-fg)',
        }}>
          {activeCol.label}
          <Box component="span" sx={{ ml: 0.3, fontSize: TYPE_SCALE.caption }}>{sortAsc ? '↑' : '↓'}</Box>
        </Typography>
      </Box>
      {visibleRows.map((r, i) => (
        <StatListRow key={r.key} row={r} rank={ranks[i]} first={i === 0} isTeam={mode === 'teams'}
          picked={r.key === pickedId ? { ref: pickedRef, tint: pickedTint } : undefined}
          faded={mode === 'players' && !r.qualified}
          total={visibleRows.length}
          value={cellText(activeCol, r.totals)}
          // A dash is a half of the game the player never played, which is noise in one line;
          // on Overall it is most rows, since most players only bat or only pitch.
          context={contextCols.map(c => [cellText(c, r.totals), c.label] as const)
            .filter(([v]) => v !== '—').map(([v, l]) => `${v} ${l}`).join(' · ')} />
      ))}
      {rows.length > listCap && (
        <ExpandRow expanded={!capped} moreLabel={`Show all ${rows.length} ${noun}`}
          onToggle={capped ? () => setExpanded(true) : collapse} />
      )}
      {boardFooter}
    </Box>
  )
}

// One row of the phone board. Deliberately the same shape as LeaderRow, which every other
// board on this tab already uses (Pitch by pitch, Run value, Tracked): rank, face, name, one
// big number. Not literally LeaderRow, because that one takes a WpblPlayer and puts a portrait
// on it, and half the rows here can be clubs, which want their badge and have no face.
//
// The name is the league's spelling, in full: a list row has 200px and no reason to shorten
// anybody.
//
// The player's position, which the table shows under the name, gives its line to the three
// context stats. A leaderboard answers "how good", and the card behind one tap answers
// everything else, position included.
function StatListRow({ row, rank, value, context, isTeam, first, total, faded, picked }: {
  row: Row
  /** The player a rank on their card came here for. */
  picked?: { ref: React.MutableRefObject<HTMLElement | null>; tint: string }
  rank: RankMark
  /** Under the qualifying bar, on a board showing everyone. See the table's rows. */
  faded?: boolean
  value: string
  context: string
  isTeam: boolean
  first: boolean
  /** How many rows are on screen. Only used to decide whether marking a top three says
   *  anything: see the rank digit below. */
  total: number
}) {
  // A top-three mark is a claim that three rows stand out from the rest, so it needs a rest to
  // stand out FROM. On the teams board (four clubs), lighting 1, 2 and 3 and leaving 4 grey does
  // not read as "these three lead": it reads as the fourth club's number having failed to render.
  // Nothing is marked when the marked group would not be a clear minority, so the four clubs get
  // one color and the ranking is carried by the order and the number on the right, which is all
  // it was ever carried by on a board this short.
  const marked = rank.n <= 3 && total > 6
  return (
    // A player row is an <a href> to her page; a team row has no URL, so it stays a
    // `pressable` div (role=button, tab stop, Enter/Space). Both are keyboard reachable.
    <Box {...(row.link?.href ? row.link : pressable(row.onClick))}
      ref={picked ? (el: HTMLElement | null) => { picked.ref.current = el } : undefined} sx={{
      ...FOCUS_RING,
      ...(picked ? { backgroundImage: picked.tint } : {}),
      display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.85,
      borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
      cursor: row.onClick ? 'pointer' : 'default',
      WebkitTapHighlightColor: 'transparent',
      // Hover only where there is one. On a touch browser it sticks to whichever row the
      // scroll started on, which reads as a selection nobody made. Same guard as LeaderRow.
      ...tappableIf(row.onClick),
      // The children, not the row: faded on the row itself, the focus ring would fade with it.
      ...(faded ? { '& > *': { opacity: FADED } } : {}),
    }}>
      <Box sx={{
        // 1.5rem (24px at the default root size), in rem because it reserves room for a NUMBER the
        // reader can enlarge: at a 1.375 text scale a two-digit rank wants 20px, and this column is the
        // first thing in the section to overflow at large text scales. See AccessibilityContext's note
        // on how far that setting is allowed to go. 1.875 rather than 1.125 since ranks can be tied, and
        // "T-10" is the widest thing it has to hold.
        // A flex box rather than text-align, so anything wider spills evenly both ways instead of
        // only to the right, into the portrait. See the table's rank for the same trap.
        width: '1.875rem', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', justifyContent: 'center', fontSize: TYPE_SCALE.body, fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        color: marked ? 'var(--wpbl-accent-fg)' : 'text.disabled',
      }}><RankText rank={rank} /></Box>

      {isTeam
        ? (row.team ? <TeamBadge team={row.team} size={32} /> : null)
        : <PlayerPortrait name={row.fullName ?? row.label} teamId={row.team?.id ?? null} size={32} />}

      {/* Line heights set, not inherited: MUI's body 1.5 put 6px of air in each of the two lines,
          and a row is ten of these on a screen. */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.25,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{isTeam ? (row.shortLabel ?? row.label) : (row.fullName ?? row.label)}</Typography>
          {!isTeam && row.team && <TeamBadge team={row.team} size={15} />}
        </Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, lineHeight: 1.35, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{context}</Typography>
      </Box>

      <Box sx={{
        flexShrink: 0, fontSize: TYPE_SCALE.heading, fontWeight: 800,
        color: 'var(--wpbl-accent-fg)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</Box>
    </Box>
  )
}
