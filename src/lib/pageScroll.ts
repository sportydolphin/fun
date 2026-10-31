// Whether following a link lands at the top of the page.
//
// The window keeps its scroll across a pushState, and the shell's pages all share that one window, so
// a page opened from 2,000px down Home opened 2,000px down itself. Every standalone page did this
// until Oct 30, 2026; Watch is where it got noticed.
//
// A SECTION'S APP IS ONE PAGE HERE, because it already places its own scroll within itself: WPBL's
// pager remembers each tab's depth (SwipeableViews) and both apps seat their own full pages. A reset
// ahead of the pager would be recorded as the depth of the tab being left. Same path with another
// hash is one page too: Watch's shelves are hashes, and backToBar places those.

import { wpblAppOwnsPath } from '../wpbl/routes'
import { isMlbPath } from '../mlb/routes'

const pageOf = (path: string) => (wpblAppOwnsPath(path) ? 'wpbl' : isMlbPath(path) ? 'mlb' : path)

export const landsAtTop = (from: string, to: string) => pageOf(from) !== pageOf(to)
