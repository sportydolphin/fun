// The phone's bottom bar on the pages a section does not draw itself: WPBL's gallery, Reading,
// Watch, the league page and the rest, MLB's compare tool and glossary. Until Oct 21, 2026 those
// pages had no bar at all, so a reader who opened one from More lost the section's tabs and had
// only a Back pill to find their way home. The bar is the section's spine; it stays on every page
// of it and is hidden only by a sheet sliding up over it.
//
// The shell draws this, not the section, because the section is not mounted on these pages (or is
// mounted hidden behind them). So a tap is a plain navigation and the section boots from the path,
// the same arrangement as ToolbarNav's static fallback above a phone.

import { useState } from 'react'
import { useMediaQuery } from '@mui/material'
import BottomNav, { MORE_KEY } from './ui/BottomNav'
import { MoreSheet } from './ui/MoreMenu'
import { navigate } from './nav'
import { WPBL_NAV, wpblPathFor } from './wpbl/routes'
import { WPBL_MORE_PAGES } from './wpbl/morePages'
import { MLB_NAV, MLB_VIEW_PATHS, MLB_MORE, type MlbNavKey } from './mlb/routes'
import { ACCENT_TEXT } from './mlb/constants'
import { parseDeepLink, requestDeepLink } from './mlb/state/deepLink'

const mlbTabHref = (key: MlbNavKey): string => key === 'stats' ? MLB_VIEW_PATHS.leaderboard : MLB_VIEW_PATHS[key]

/** When the bar shows, for the shell's room under the page: the bar's own query, so the two agree
 *  at exactly 600px, where MUI's `sm` has already begun. */
export const STANDALONE_NAV_QUERY = '@media (max-width:600px)'

export default function StandaloneBottomNav({ section }: { section: 'wpbl' | 'mlb' }) {
  // `noSsr` for the reason WpblApp gives: the bar must be in the first paint, not inserted a frame
  // later into a page already laid out.
  const phone = useMediaQuery(STANDALONE_NAV_QUERY.replace('@media ', ''), { noSsr: true })
  const [moreOpen, setMoreOpen] = useState(false)
  if (!phone) return null

  const tabs = section === 'wpbl'
    ? WPBL_NAV.map(n => ({ key: n.key, label: n.label, href: wpblPathFor(n.key) }))
    : MLB_NAV.map(n => ({ key: n.key, label: n.label, href: mlbTabHref(n.key) }))
  const rows = section === 'wpbl'
    ? WPBL_MORE_PAGES.map(p => ({ ...p, key: p.href }))
    // A row that opens a board (`?open=`) publishes its intent ahead of the navigation, so the
    // board's owner takes it when the section mounts. See mlbFallback in ToolbarNav.
    : MLB_MORE.map(r => ({ ...r, onSelect: () => {
        setMoreOpen(false)
        const link = parseDeepLink(r.href)
        if (link) requestDeepLink(link)
        navigate(r.href)
      } }))

  return (
    <>
      <BottomNav
        items={[...tabs, { key: MORE_KEY, label: 'More' }]}
        // No tab is the page on screen; More is where these pages live, so it reads as current.
        value=""
        moreCurrent
        onChange={k => navigate(tabs.find(t => t.key === k)!.href)}
        onMore={() => setMoreOpen(true)}
        moreOpen={moreOpen}
        accent={section === 'wpbl' ? 'var(--wpbl-accent-fg)' : ACCENT_TEXT}
        badgeColor="var(--wpbl-accent-solid)"
        label={section === 'wpbl' ? 'WPBL sections' : 'MLB sections'}
        moreLabel={section === 'wpbl' ? 'More WPBL pages' : 'More MLB pages'}
      />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} rows={rows} />
    </>
  )
}
