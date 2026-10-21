// The More menu of both sections: the toolbar's panel above a phone's width (ToolbarNav), and the
// sheet the bottom bar raises on one. ONE COMPONENT FOR BOTH SECTIONS AND BOTH SHAPES, because each
// section drew its own sheet, and the toolbar drew a third list that showed the hints for MLB and
// not for WPBL.
//
// GROUPED, WITH THE LINE UNDER EACH NAME on a desktop too. It was a flat dropdown of names, which at
// ten rows a reader had to read top to bottom to learn what a section had; a desktop has the width
// for the groups side by side and for the hint that says what each page is.
//
// Every row is a real <a href>: a crawler follows it, and a modified click opens a new tab. A plain
// click is the app's, through the row's own handler when the section has one (MLB opens a board
// inside a tab without reloading it) and a navigate() when it does not.

import type { MouseEvent, ReactNode } from 'react'
import { Box, Popover, SwipeableDrawer, Typography } from '@mui/material'
import { navigate, isModified } from '../nav'
import { track } from '../lib/analytics'
import { SectionLabel, TYPE_SCALE } from './card'
import { hoverOnly, FOCUS_RING } from './interaction'
import { chromePx } from './scale'

export interface MoreRow {
  key: string
  href: string
  label: string
  hint: string
  /** The heading it sits under. Rows of one group are adjacent in the list. */
  group: string
  /** The page the reader is on, which the row says rather than offers. */
  current?: boolean
  /** A plain click, in place of navigating to `href`. */
  onSelect?: () => void
  event?: string
  eventProps?: Record<string, unknown>
}

/** The rows under their headings, in the order the groups first appear. */
export function groupMoreRows<T extends { group: string }>(rows: readonly T[]): { group: string; rows: T[] }[] {
  const out: { group: string; rows: T[] }[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last?.group === r.group) last.rows.push(r)
    else out.push({ group: r.group, rows: [r] })
  }
  return out
}

function RowLink({ row, close, size }: { row: MoreRow; close: () => void; size: 'panel' | 'sheet' }) {
  const sheet = size === 'sheet'
  return (
    <Box
      component="a"
      href={row.href}
      aria-current={row.current ? 'page' : undefined}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (isModified(e)) return
        e.preventDefault()
        if (row.event) track(row.event, row.eventProps ?? {})
        close()
        if (row.onSelect) row.onSelect()
        else navigate(row.href)
      }}
      sx={{
        ...FOCUS_RING,
        display: 'flex', flexDirection: 'column', gap: 0.1,
        textDecoration: 'none', color: 'text.primary',
        py: sheet ? 1 : 0.75, px: sheet ? 0 : 1, mx: sheet ? 0 : -1,
        borderRadius: sheet ? 0 : 1,
        ...(sheet
          ? { borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }
          : hoverOnly({ bgcolor: 'action.hover' })),
      }}
    >
      <Typography sx={{
        fontSize: sheet ? TYPE_SCALE.title : TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.35,
        color: row.current ? 'var(--wpbl-accent-fg)' : 'inherit',
      }}>
        {row.label}
      </Typography>
    </Box>
  )
}

function Group({ group, children }: { group: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={group} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionLabel>{group}</SectionLabel>
      {children}
    </Box>
  )
}

/** The desktop panel under the toolbar's More, the groups side by side as far as the width allows. */
export function MorePanel({ id, anchor, onClose, rows }: {
  id: string
  anchor: HTMLElement | null
  onClose: () => void
  rows: readonly MoreRow[]
}) {
  const groups = groupMoreRows(rows)
  return (
    <Popover
      id={id}
      anchorEl={anchor}
      open={!!anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: {
        mt: 0.5, p: 2, borderRadius: 2,
        border: '1px solid', borderColor: 'outline', bgcolor: 'background.raised',
        // A column per group up to the screen's width, each wide enough for a hint to wrap once.
        // rem, since the columns reserve room for text.
        width: `min(calc(100vw - 32px), ${groups.length * 14}rem)`,
      } } }}
    >
      <Box component="nav" aria-label="More pages" sx={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))',
        columnGap: 3, rowGap: 2,
      }}>
        {groups.map(g => (
          <Group key={g.group} group={g.group}>
            {g.rows.map(r => <RowLink key={r.key} row={r} close={onClose} size="panel" />)}
          </Group>
        ))}
      </Box>
    </Popover>
  )
}

/** The phone's sheet, raised by the bottom bar's More slot. */
export function MoreSheet({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: readonly MoreRow[] }) {
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // SwipeableDrawer, not Drawer, so a phone can flick the sheet down to dismiss it (the grabber
      // is the affordance). onOpen is required by the type but never fires: the sheet is only ever
      // opened by the bar's More slot, never by an edge swipe.
      onOpen={() => {}}
      disableSwipeToOpen
      // Capped and centered to the bar's own width, with rounded top corners and clearance for the
      // iOS home indicator, so it reads as a sheet the bar raised rather than a full-bleed slab.
      slotProps={{ paper: { sx: {
        maxWidth: chromePx(460), mx: 'auto', left: 0, right: 0,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        bgcolor: 'background.raised',
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      } } }}
    >
      <Box sx={{ px: 2, pt: 1 }}>
        <Box aria-hidden sx={{ width: chromePx(36), height: chromePx(4), borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1.5 }} />
        <Box component="nav" aria-label="More pages" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {groupMoreRows(rows).map(g => (
            <Group key={g.group} group={g.group}>
              {g.rows.map(r => <RowLink key={r.key} row={r} close={onClose} size="sheet" />)}
            </Group>
          ))}
        </Box>
      </Box>
    </SwipeableDrawer>
  )
}
