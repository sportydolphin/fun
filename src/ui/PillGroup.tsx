import { Box } from '@mui/material'
import { pressable, FOCUS_RING } from './interaction'
import { chromePx, typePx } from './scale'

// Moved out of src/wpbl/ui.tsx in Oct 2026, when MLB took the same split WPBL draws between its two
// segmented controls: a raised chip for NAVIGATION (WPBL's SegNav, MLB's SegControl) and this solid
// fill for a SETTING on the data in front of the reader (Hitting / Pitching, a category, a round).
// The two looked identical on MLB's Stats page, three rows of the same pill for two different jobs.
//
// Compact segmented pills. The in-card sibling of SegNav: SegNav is the page-level tab bar
// and centres itself across the full width, this one is inline and sized to sit inside a
// SectionCard, either in the body beside a leaderboard or in the header's `action` slot.
//
// Solid accent fill rather than SegNav's raised surface chip, because at this size the chip's
// shadow-on-paper trick disappears against the card it is sitting on: inside a card the only
// thing that reads as "selected" at 0.68rem is colour. Use `--wpbl-accent-solid`, never
// WPBL_ACCENT. White on #60a5fa measures 2.37:1, and colour contrast is absolute, so the raw
// accent fails in dark mode too.
export function PillGroup({ options, value, onChange, mb }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  mb?: number
}) {
  return (
    <Box sx={{ display: 'inline-flex', bgcolor: 'action.hover', borderRadius: 999, p: '3px', mb }}>
      {options.map(opt => {
        const on = opt.value === value
        return (
          <Box
            key={opt.value}
            {...pressable(() => onChange(opt.value))}
            aria-pressed={on}
            sx={{
              ...FOCUS_RING,
              px: 1.5, py: 0.4, borderRadius: 999, cursor: 'pointer',
              // A FLOOR UNDER THE TAP TARGET. At their natural height these are one pixel under WCAG 2.2's
              // 24px minimum, and they sit shoulder to shoulder inside one pill, so the spacing exception
              // that forgives a small target does not apply. `minHeight` rather than more padding: the
              // pill's proportions stay as drawn, and the box still grows on its own if the reader's text
              // needs more room than the floor.
              //
              // `chromePx` and not a bare number, and not rem. It is structure, so it takes the
              // desktop chrome scale; and it deliberately does NOT take the reader's text scale,
              // because a target that grows with the type is not a better target, it is a moving
              // one. That is the whole reason --app-chrome excludes --sd-text-scale.
              minHeight: chromePx(28),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: typePx(0.3),
              whiteSpace: 'nowrap', userSelect: 'none', transition: 'all 0.15s',
              bgcolor: on ? 'var(--wpbl-accent-solid)' : 'transparent',
              color: on ? '#fff' : 'text.secondary',
              '&:hover': on ? {} : { color: 'text.primary' },
            }}
          >
            {opt.label}
          </Box>
        )
      })}
    </Box>
  )
}
