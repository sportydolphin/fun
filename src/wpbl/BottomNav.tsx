import type { ComponentProps } from 'react'
import BottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from '../ui/BottomNav'
import type { BottomNavItem } from '../ui/BottomNav'

// The bar itself is shared with /mlb and lives in src/ui. This keeps WPBL's own spelling of it,
// with the section's accent and labels, so nothing in the section had to change when it moved.
export { BOTTOM_NAV_SPACE, MORE_KEY }
export type { BottomNavItem }

export default function WpblBottomNav(props: Omit<ComponentProps<typeof BottomNav>, 'accent' | 'badgeColor' | 'label' | 'moreLabel'>) {
  return (
    // The active tab is a LABEL, so it takes the text-safe accent: the raw #60a5fa measured 2.5:1
    // on the light bar. The "new" dot is a fill and keeps the solid one.
    <BottomNav {...props} accent="var(--wpbl-accent-fg)" badgeColor="var(--wpbl-accent-solid)"
      label="WPBL sections" moreLabel="More WPBL pages" />
  )
}
