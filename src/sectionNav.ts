// The section tabs the shell's toolbar draws on a desktop, and the one way a section tells it
// what they are.
//
// THE SHELL DRAWS THEM, NOT THE SECTION. Each section used to draw its own pill row under the
// toolbar, which on a desktop cost a whole row of chrome, scrolled away while the toolbar stayed
// pinned (so changing tabs halfway down Stats meant scrolling back up), and was absent from every
// WPBL page the section does not render (Reading, Watch, Photos...), which got by on "Back to
// WPBL" buttons. In the toolbar the tabs are on every page of the section and at every scroll
// depth, and they paint with the toolbar on the first frame, before the section's chunk lands.
//
// WHAT ONLY THE SECTION KNOWS comes through here: which tab is lit (MLB lights Stats for three
// different views, and a player page lights the tab it was opened from), the "new" dots, and what
// a tap does (WPBL's Teams returns to the grid when tapped twice, and both report the tab change
// to analytics). With nothing published, a tap is a plain `navigate()` to the tab's href and the
// section boots from the path, which is exactly what a cold load does.
//
// A module store rather than a context because the publisher (inside a lazy section) and the
// reader (the shell) are not in a parent-child line that would make a context cheap: App would
// re-render every section on each publish.

import { useSyncExternalStore } from 'react'

export type NavSection = 'wpbl' | 'mlb'

export interface SectionNavTab { key: string; label: string; href: string; badge?: boolean }

/** A More menu row. MLB's open a board inside another view, so they carry a handler; WPBL's are
 *  pages with addresses, which the shell knows without the section (see ToolbarNav). */
export interface SectionNavMoreItem { key: string; label: string; hint?: string; onSelect: () => void }

export interface SectionNav {
  section: NavSection
  tabs: SectionNavTab[]
  active: string | null
  onSelect: (key: string) => void
  more?: SectionNavMoreItem[]
}

let current: SectionNav | null = null
const listeners = new Set<() => void>()

export function publishSectionNav(nav: SectionNav | null) {
  current = nav
  listeners.forEach(l => l())
}

/** Clear only if `section` still owns the slot, so a section unmounting after the next one has
 *  already published cannot wipe the newcomer's tabs. */
export function clearSectionNav(section: NavSection) {
  if (current?.section === section) publishSectionNav(null)
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useSectionNav = () => useSyncExternalStore(subscribe, () => current, () => null)
