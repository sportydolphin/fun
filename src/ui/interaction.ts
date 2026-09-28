import type React from 'react'

// Tap and hover helpers shared by every section. Moved out of src/wpbl/ui.tsx on Sep 28, 2026, when
// MLB took the same modal shell; WPBL re-exports them from there, so its imports did not change.

/**
 * What a tappable box should feel like, on both kinds of pointer.
 *
 * A BARE `&:hover` IS A BUG ON A TOUCHSCREEN. A phone has no hover, so it applies the state on
 * TAP and leaves it there: expand a card and its header stays tinted until you happen to touch
 * something else, which reads as "still selected" or as a stuck control rather than as the
 * momentary feedback it was written to be.
 *
 * So hover is gated to devices that actually hover, and touch gets `:active` instead: the same
 * tint, but only while the finger is down, which is the honest version of the same idea. The
 * browser's own tap highlight is off (see styles.css), so without an `:active` this would be a
 * control that gives no feedback at all, which is the other way to get this wrong.
 *
 * Spread it in place of a hover block: `sx={{ ...TAPPABLE, ...rest }}`.
 */
export function hoverOnly<T extends object>(styles: T) {
  return {
    '@media (hover: hover) and (pointer: fine)': { '&:hover': styles },
    // The same styles while the finger is down. A touch device gets no hover and, since the
    // browser's tap highlight is off (styles.css), would otherwise get no feedback at all.
    '&:active': styles,
  }
}

/** The common case: the standard row tint. */
export const TAPPABLE = hoverOnly({ bgcolor: 'action.hover' })

/** For rows that are only tappable sometimes ("open her page, if we resolved a player"). */
export const tappableIf = (on: unknown) => (on ? TAPPABLE : {})

/**
 * Makes a non-semantic element (a clickable `Box`, a `Typography` acting as a link) behave
 * like a button for anyone not using a mouse: focusable in tab order, activated by Enter or
 * Space, and announced as a control rather than as text.
 *
 * Most of this section's rows are clickable `Box`es rather than real `<button>`s: a button
 * would fight the layout (default padding, font inheritance, no nested interactive content).
 * This is the compensation for that choice, and it belongs in one place so a new clickable
 * row can't quietly ship without it.
 *
 * Pass an undefined handler and you get nothing back: a row that isn't clickable shouldn't
 * land in the tab order announcing itself as a button.
 */
export function pressable(onClick: (() => void) | undefined) {
  if (!onClick) return {}
  return {
    onClick,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      // Space scrolls the page by default, so it has to be swallowed; Enter does not, but is
      // handled here too so both keys behave the same as a real button.
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
    },
  } as const
}

/**
 * A control that is also a real link, which is the shape Googlebot can follow.
 *
 * `pressable` above makes a div behave like a button, and for anything that opens a modal with
 * no address of its own that is the whole story. The moment the thing it opens HAS a URL, an
 * onClick-only control is invisible to a crawler and un-copyable by a reader: no right-click
 * "copy link", no middle-click, no open-in-new-tab. CLAUDE.md records `/mlb` sitting undiscovered
 * by Google for months for exactly this reason.
 *
 * So spread this onto a `component="a"` instead: the href is real, an unmodified click is
 * cancelled and handed to the SPA, and a ctrl/cmd/shift/middle click is left entirely alone so
 * the browser opens it in a tab the way the reader asked. Returns nothing when there is no
 * handler, so a caller can pass `undefined` and get a plain link.
 */
export function linkPress(href: string, onClick: (() => void) | undefined) {
  return {
    component: 'a' as const,
    href,
    onClick: (e: React.MouseEvent) => {
      // A modified click is the reader asking the BROWSER for this URL, not the app.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e as { button?: number }).button === 1) return
      e.preventDefault()
      onClick?.()
    },
  }
}

/** Focus ring for `pressable` targets: merge into the element's own sx. `:focus-visible`
 *  rather than `:focus` so a mouse click doesn't leave a ring behind. */
export const FOCUS_RING = {
  '&:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: '2px',
  },
} as const
