import { TYPE_SCALE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { PillGroup,
  CARD_BORDER, pressable, FOCUS_RING } from '../ui'
import type { WpblTeam } from '../types'
import type { WpblPlayerLinkProps } from '../LinkContext'
import type { Totals, Source, View } from './axes'
import { VIEW_OPTIONS } from './axes'

/** A row's place on the board: its number, and whether it shares it. */
export interface RankMark { n: number; tied: boolean }

/** "T-3" for a shared place, the leaderboard convention; "T3" run together read as a code rather
 *  than a tie. The prefix is set a touch smaller so a tied two-digit rank still fits: in the table
 *  it runs left into the name cell's padding rather than widening the rank column, which would take
 *  the room from the names on a phone. */
export function RankText({ rank }: { rank: RankMark }) {
  // Centered on the number rather than sitting on its baseline: the smaller "T-" set on the same
  // line hangs at the top of it in a flex parent and reads as a superscript.
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {rank.tied && <Box component="span" sx={{ fontSize: '0.8em', lineHeight: 1 }}>T-</Box>}
      <Box component="span" sx={{ lineHeight: 1 }}>{rank.n}</Box>
    </Box>
  )
}

/** Fades what it wraps, for a row under the qualifying bar. On the CONTENT, never on a cell:
 *  the name cell and the phone's sort cell are sticky and paint an opaque background so the
 *  columns scrolling underneath stay hidden, and opacity on the cell would fade that too. */
export const FADED = 0.5

// One table row, normalized so the same table renders a player or a whole team.
export interface Row {
  key: string
  team: WpblTeam | undefined       // for the badge (a player's club, or the team itself)
  label: string                    // player short name, or full team name
  /** The player's name as the league spells it. `label` is already abbreviated to fit the
   *  table's 84px name column, and the portrait lookup is keyed on the real one. */
  fullName?: string
  shortLabel?: string              // teams mode on a phone: the nickname alone ('Firebells')
  sublabel?: string                // player position (players only)
  totals: Totals
  qualified: boolean
  onClick?: () => void
  /** Players only: the props that make this row's name a real <a href> to her page.
   *  A team row has no URL to point at, so it stays a plain onClick. */
  link?: WpblPlayerLinkProps
}

/** The board's foot: the population in words and, on a phone, the way into the grid and back. Shared
 *  by the ranked list and the table so the count and the view switch cannot drift apart. */
export function BoardFooter({ footText, phoneTable, hasViews, view, switchView, isNarrow, source, toggleFullTable, fullTable }: {
  footText: string
  phoneTable: boolean
  hasViews: boolean
  view: View
  switchView: (v: View) => void
  isNarrow: boolean
  source: Source
  toggleFullTable: () => void
  fullTable: boolean
}) {
  return (
    <Box data-board-foot="" sx={{
      px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'center', gap: 1, flexWrap: phoneTable ? 'wrap' : undefined,
    }}>
      {footText && (
        // On the phone's table the words take a line of their own: beside two controls they
        // were a column of single words.
        <Typography sx={{
          fontSize: TYPE_SCALE.micro, color: 'text.disabled', fontWeight: 600, minWidth: 0,
          flexBasis: phoneTable ? '100%' : undefined,
        }}>{footText}</Typography>
      )}
      {/* The way into the grid and back out. At the foot rather than in the control bar: it is
          a preference someone sets once, not a control they work with, and every pixel of the
          bar is taken from the board. It reads as a foot because the list is capped.

          The row above it adds PLAYERS and this one adds COLUMNS. The label names what it
          switches to, a table, rather than what it gets you, so a reader does not have to
          press it to find out what it does. */}
      {phoneTable && hasViews && (
        <Box sx={{ flexShrink: 0 }}>
          <PillGroup options={VIEW_OPTIONS} value={view} onChange={v => switchView(v as View)} />
        </Box>
      )}
      {isNarrow && source === 'season' && (
        <Box {...pressable(toggleFullTable)} sx={{
          ...FOCUS_RING, ml: 'auto', flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 0.4,
          minHeight: 34, px: 1.25, borderRadius: 999,
          border: '1px solid', borderColor: CARD_BORDER,
          fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        }}>{fullTable ? 'Ranked list' : 'Full table'}</Box>
      )}
    </Box>
  )
}
