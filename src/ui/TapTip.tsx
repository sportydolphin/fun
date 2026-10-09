import React, { useEffect, useRef, useState } from 'react'
import { Box, Tooltip, useMediaQuery } from '@mui/material'
import type { Theme, SxProps } from '@mui/material'
import { useShellZ } from './ModalShell'

// Shared by both sections since Oct 2026, when the MLB player page took WPBL's stat tables, whose
// every column header is one of these. src/wpbl/ui.tsx re-exports it, so WPBL's imports did not move.

/**
 * A definition tooltip that behaves like the device it is on: hover on a mouse, TAP on a
 * touchscreen.
 *
 * WHY IT EXISTS. A plain MUI Tooltip with `enterTouchDelay={0}` fires the moment a finger lands
 * on the element, and on a player page that is a column of stat abbreviations you scroll
 * straight through, so scrolling pops definitions open under your thumb, one after another, for
 * something nobody asked to read. Raising the delay is not the fix either: MUI's touch timer is
 * not cancelled by the finger moving, so a slow scroll still opens it, just later.
 *
 * SO TOUCH GETS AN EXPLICIT GESTURE. On a device with no hover, the tooltip is controlled and
 * opens on tap alone. It closes on a second tap, on a tap anywhere else, on the next scroll,
 * and on a timer, because a tooltip nobody can dismiss is worse than one that never opened.
 * Closing on scroll matters most: scrolling is the gesture that would otherwise open these.
 *
 * Hover devices keep ordinary hover behaviour, with the touch listener off so a hybrid laptop
 * cannot get both.
 *
 * Renders its own element rather than wrapping a child, because the touch path needs a ref to
 * know what "outside" means, and because every call site was passing a styled Box anyway.
 */
export function TapTip({ title, children, sx, component, popperZIndex }: {
  title: React.ReactNode
  children: React.ReactNode
  sx?: SxProps<Theme>
  /** For a tooltip on a table header, which has to stay a `th`. */
  component?: React.ElementType
  /** The player modal sits at zIndex 1600 and MUI's popper defaults to 1500, so a tooltip
   *  inside it renders behind it unless lifted. */
  popperZIndex?: number
}) {
  const canHover = useMediaQuery('(hover: hover)')
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement>(null)
  // What `open` was when the finger landed, read by the click that follows. React state is
  // not safe to toggle against here: MUI can call its own close in the same batch, and
  // `setOpen(o => !o)` would then flip that close straight back into an open, so a second tap
  // could never dismiss the tooltip. The press is the last moment nothing else has written.
  const openAtPress = useRef(false)
  // And never below the shell it is in, whatever the caller asked for: the side panel rises over
  // whatever dialog it was opened from, so its height is only known at run time (see ModalShell).
  const shellZ = useShellZ()
  const tipZ = Math.max(popperZIndex ?? 0, shellZ != null ? shellZ + 1 : 0)
  const slotProps = tipZ ? { popper: { sx: { zIndex: tipZ } } } : undefined

  // Everything that should dismiss a tapped tooltip, registered only while one is open.
  useEffect(() => {
    if (canHover || !open) return
    const close = () => setOpen(false)
    const onPointerDown = (e: PointerEvent) => {
      // A second tap on the same stat toggles it shut; that is the click handler's job, so
      // ignore the press here rather than closing and letting the toggle reopen it.
      if (anchorRef.current?.contains(e.target as Node)) return
      // Nor a press on the tooltip itself, which can hold a link (MLB's lead to the glossary):
      // closed on the press, it was gone before the link's click could land.
      if ((e.target as Element | null)?.closest?.('[role="tooltip"]')) return
      close()
    }
    // Capture phase, and the event stops here: an open tooltip inside the player modal has to
    // be what Escape dismisses. Left to bubble it reached the modal's own handler and shut the
    // whole player page instead, which is a long way from "hide this definition".
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    // Capture, so a scroll inside any container counts and not just the page.
    window.addEventListener('scroll', close, { capture: true, passive: true })
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey, { capture: true })
    const timer = window.setTimeout(close, 4000)
    return () => {
      window.removeEventListener('scroll', close, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey, { capture: true })
      window.clearTimeout(timer)
    }
  }, [canHover, open])

  return (
    <Tooltip
      title={title} arrow slotProps={slotProps}
      // ALWAYS CONTROLLED, both input types. `useMediaQuery` returns false on its first render and
      // only then measures, so branching on it into a controlled tooltip and an uncontrolled one
      // would mount every instance one way and switch it a tick later. MUI's useControlled decides
      // which a component is on the FIRST render and keeps it, so hover would silently stop working
      // on every desktop, with only a console warning to say so.
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      // The touch-hold listener is off on every device: it fires on the finger landing, which
      // on a page you scroll through means definitions popping open under your thumb, one
      // after another, for something nobody asked to read. Touch opens on a real tap instead
      // (the handler below); hover and focus stay for a device that has a pointer.
      disableTouchListener
      disableHoverListener={!canHover}
      disableFocusListener={!canHover}
    >
      <Box
        ref={anchorRef}
        component={component}
        onPointerDown={canHover ? undefined : () => { openAtPress.current = open }}
        onClick={canHover ? undefined : () => setOpen(!openAtPress.current)}
        sx={{ cursor: 'help', ...sx }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}
