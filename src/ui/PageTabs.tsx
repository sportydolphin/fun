import React, { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import { linkPress, pressable, FOCUS_RING } from './interaction'

// THE ROW THAT PICKS A PAGE WITHIN A TAB: WPBL Stats' boards, MLB Stats' boards, MLB Standings'
// modes. Moved out of WPBL's StatsView in Oct 2026, when MLB's equivalents were still a centred
// segmented pill, the same control MLB used for a setting, so a page and a filter on that page
// looked alike. Underline tabs because that is what they are: tapping one replaces what is under
// it. Three visual languages, one per job, in both sections: these for pages, PillGroup for a
// switch that applies to whichever page you are on, chips for filters.
//
// Left-aligned and scrolling sideways rather than wrapping, with the chosen tab kept in view.

/** Both sections' accent. The foreground-safe var would lose the underline's weight in light mode;
 *  a 2px rule is not text, so the raw accent clears the non-text contrast bar. */
const UNDERLINE = '#60a5fa'

export interface PageTab {
  value: string
  label: string
  /** A real link (linkPress): a tab that is its own address must be one a crawler can follow and a
   *  reader can open in a new tab. Leave it off for one that only switches what is drawn. */
  href?: string
  /** Drawn after the label, e.g. WPBL's NewDot. Aria-hidden by its owner, so pass `ariaLabel` too. */
  adornment?: React.ReactNode
  ariaLabel?: string
}

export function PageTabs({ options, value, onChange, mb = 1.25 }: {
  options: PageTab[]
  value: string
  onChange: (v: string) => void
  mb?: number | { xs?: number; sm?: number; md?: number }
}) {
  // THE CHOSEN TAB IS KEPT IN VIEW. The row scrolls sideways on a phone, and a link to one of the
  // later tabs opened with its own underline off the right edge, so nothing on screen said which
  // page this was. Sideways only, and only as far as it takes: `scrollIntoView` would also scroll
  // the page. Mount covers a move between parents, which remounts the row.
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = rowRef.current
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!row || !tab) return
    const r = row.getBoundingClientRect(), t = tab.getBoundingClientRect()
    const pad = 16
    if (t.right > r.right) row.scrollLeft += t.right - r.right + pad
    else if (t.left < r.left) row.scrollLeft -= r.left - t.left + pad
  }, [value])

  return (
    <Box ref={rowRef} sx={{
      display: 'flex', alignItems: 'flex-end', gap: { xs: 1.5, sm: 2 }, mb,
      borderBottom: '1px solid', borderColor: 'divider',
      overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' },
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      {options.map(o => {
        const on = o.value === value
        const press = o.href ? linkPress(o.href, () => onChange(o.value)) : pressable(() => onChange(o.value))
        return (
          // aria-current on a plain button too: it is the page indicator either way, and it is what
          // the keep-in-view effect above looks for.
          <Box key={o.value} {...press} aria-current={on ? 'page' : undefined} aria-label={o.ariaLabel} sx={{
            ...FOCUS_RING,
            pb: 1, mb: '-1px', flexShrink: 0, cursor: 'pointer', userSelect: 'none',
            whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
            textDecoration: 'none',
            borderBottom: '2px solid', borderColor: on ? UNDERLINE : 'transparent',
            color: on ? 'text.primary' : 'text.secondary',
            // Tightened on a phone so WPBL's five fit 375px without the last one hanging off the edge.
            fontSize: { xs: '0.86rem', sm: '0.9rem' },
            fontWeight: on ? 800 : 600, transition: 'color 0.15s',
            '&:hover': { color: 'text.primary' },
          }}>
            {o.label}
            {o.adornment}
          </Box>
        )
      })}
    </Box>
  )
}
