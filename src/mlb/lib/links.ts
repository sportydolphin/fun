import type React from 'react'
import { linkPress, pressable } from '../../ui/interaction'
import { mlbPlayerPath, mlbTeamPath, mlbGamePath, mlbClubById } from '../routes'

// Spread props that make a player, a club or a game a real <a href> to its page, for the
// section's many rows that used to be a Box with only an onClick. Googlebot follows no click
// handler, so until Oct 2026 the MLB player and club pages were reachable only through the
// sitemap; and a reader could not ctrl-click a row into a new tab. The plain click still goes
// to the handler the row always called, so the history entry, the event and the sheet are
// unchanged (see linkPress).
//
// Each returns {} without a handler: a row drawn somewhere that cannot open the page (a share
// card, a preview) stays plain text rather than a link that would leave the app.
//
// NEVER ON AN ELEMENT HOLDING ANOTHER CONTROL. The click on a nested button bubbles to the
// anchor, and stopPropagation does not cancel the anchor's default, so a "follow" star inside a
// linked row would navigate the page. Put the link on the name instead.

/** Spread over a linked element's sx: anchors arrive underlined and in link blue. */
export const LINK_SX = { textDecoration: 'none', color: 'inherit' } as const

export function playerLink(id: number, name: string | null | undefined, onOpen: ((id: number) => void) | undefined) {
  return onOpen ? linkPress(mlbPlayerPath({ id, fullName: name }), () => onOpen(id)) : {}
}

/** An id that is not one of the thirty clubs (an All-Star side) has no page, so it keeps the
 *  click without claiming an address: mlbTeamPath would point it at the Teams tab. */
export function teamLink(id: number, onOpen: ((id: number) => void) | undefined) {
  if (!onOpen) return {}
  return mlbClubById(id) ? linkPress(mlbTeamPath(id), () => onOpen(id)) : pressable(() => onOpen(id))
}

export function gameLink(gamePk: number, onOpen: (() => void) | undefined) {
  return onOpen ? linkPress(mlbGamePath(gamePk), onOpen) : {}
}

/** For a table row, which cannot itself be an anchor: the link goes on the name inside it, and
 *  the row keeps its whole-width click through this, which stands aside for a click that came
 *  from the link (or from teamLink's button, for a side with no page). Without that guard a plain click opens the page twice, and a ctrl-click opens
 *  the new tab AND the page here. */
export function rowClick(onClick: (() => void) | undefined) {
  if (!onClick) return {}
  return {
    onClick: (e: React.MouseEvent) => {
      // Only a control INSIDE the row counts; the row itself may sit within one.
      const inner = (e.target as HTMLElement).closest?.('a, [role="button"]')
      if (inner && inner !== e.currentTarget && (e.currentTarget as HTMLElement).contains(inner)) return
      onClick()
    },
  }
}
