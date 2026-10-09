// The section tabs inside the shell's toolbar, above a phone's width. See src/sectionNav.ts for why
// the shell draws them rather than the section.
//
// EVERYTHING HERE HAS A STATIC FALLBACK, so the tabs paint with the toolbar on the first frame and
// stay on the WPBL pages the section does not render (Reading, Watch, the compare tool...). What a
// mounted section publishes only refines it: which tab is lit, the "new" dot, what a tap does.
// Without it a tap is a plain navigate() and the section boots from the path, as a cold load does.
//
// Every tab and every More row that is a page is a real <a href>, for the same reason the pills were: a
// crawler does not fire click handlers, and these are how it finds the other four tabs.

import { startTransition, useEffect, useState, type MouseEvent } from 'react'
import { Box, Menu, MenuItem, Typography } from '@mui/material'
import { useSectionNav, type NavSection, type SectionNavTab } from './sectionNav'
import { navigate, linkTo } from './nav'
import { WPBL_NAV, wpblPathFor, wpblViewFromPath } from './wpbl/routes'
import { WPBL_MORE_PAGES } from './wpbl/morePages'
import { MLB_NAV, MLB_VIEW_PATHS, MLB_MORE_PAGES, mlbNavKeyFromPath } from './mlb/routes'
import { track } from './lib/analytics'
import { hoverOnly, FOCUS_RING } from './ui/interaction'

const STATIC_TABS: Record<NavSection, SectionNavTab[]> = {
  wpbl: WPBL_NAV.map(n => ({ key: n.key, label: n.label, href: wpblPathFor(n.key) })),
  mlb: MLB_NAV.map(n => ({
    key: n.key, label: n.label,
    href: n.key === 'stats' ? MLB_VIEW_PATHS.leaderboard : n.key === 'home' ? MLB_VIEW_PATHS.home : MLB_VIEW_PATHS[n.key],
  })),
}

const staticActive = (section: NavSection, path: string): string | null =>
  section === 'wpbl' ? wpblViewFromPath(path) : mlbNavKeyFromPath(path)

const modifiedClick = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

// The lit tab's stripe. The accent, not the brand rainbow: a rainbow line under one tab read as a
// decoration competing with the league switch beside it rather than as "you are here".
const UNDERLINE = 'var(--wpbl-accent-solid)'

interface MoreRow {
  key: string
  label: string
  hint?: string
  href?: string
  current?: boolean
  onClick: (e: MouseEvent<HTMLElement>) => void
}

export function ToolbarNav({ section, path, sx }: { section: NavSection; path: string; sx?: object }) {
  const published = useSectionNav()
  const live = published?.section === section ? published : null
  const tabs = live?.tabs ?? STATIC_TABS[section]
  const active = live ? live.active : staticActive(section, path)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // THE TAB LIGHTS ON THE CLICK, not when the tab it opens has finished rendering. The lit tab
  // comes from the section, which publishes it after it commits the switch, and that commit (the
  // outgoing tab hiding, the incoming one rendering) is 40 to 55ms in a production build, so a
  // click showed nothing at all until the whole page was ready. Now the bar lights the tab at once
  // and the switch runs as a transition behind it, so the bar paints first. `pending` gives way
  // the moment the section publishes anything new.
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => { setPending(null) }, [active])
  const lit = pending ?? active

  const pageRow = (p: { href: string; label: string; hint?: string; event?: string; eventProps?: Record<string, unknown> }): MoreRow => {
    const link = linkTo(p.href)
    return {
      key: p.href, label: p.label, hint: section === 'mlb' ? p.hint : undefined, href: p.href,
      current: path === p.href || path.startsWith(`${p.href}/`),
      onClick: e => {
        if (p.event && !modifiedClick(e)) track(p.event, p.eventProps ?? {})
        link.onClick(e)
        if (e.defaultPrevented) setAnchor(null)
      },
    }
  }
  const more: MoreRow[] = section === 'wpbl'
    ? WPBL_MORE_PAGES.map(pageRow)
    // The section's own rows (boards inside its views) once it has published them, then its pages,
    // which need nothing from it: on /mlb/glossary the section is not mounted at all, and More
    // would otherwise be an empty, disabled button on the one page that belongs in it.
    : [
        ...(live?.more ?? []).map(m => ({
          key: m.key, label: m.label, hint: m.hint,
          onClick: () => { setAnchor(null); m.onSelect() },
        })),
        ...MLB_MORE_PAGES.map(pageRow),
      ]
  // On one of the More pages no tab is lit, so More is: the reader is somewhere, and the bar
  // should say where.
  const moreCurrent = more.some(m => m.current)

  const tabSx = (on: boolean) => ({
    ...FOCUS_RING,
    position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 0.5,
    px: 1.25, height: '100%',
    border: 'none', bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
    textDecoration: 'none', whiteSpace: 'nowrap', userSelect: 'none',
    // ONE WEIGHT, lit or not. A bolder lit label is a wider one, so every tab switch nudged the
    // tabs after it sideways by a couple of pixels; the colour and the stripe say which is lit.
    fontSize: '0.85rem', fontWeight: 600,
    color: on ? 'text.primary' : 'text.secondary',
    transition: 'color 0.15s',
    ...hoverOnly({ color: 'text.primary' }),
    // The indicator sits on the toolbar's bottom hairline, the way a tab strip's does, and grows
    // from the centre rather than snapping in. Inset by the tab's own padding, so it is exactly as
    // wide as the label at every scale; a fixed 8px overhung it by 4.5px on a desktop. Its 3px
    // thickness is ornament and stays raw.
    '&::after': {
      content: '""', position: 'absolute', left: 'calc(10px * var(--app-chrome, 1))', right: 'calc(10px * var(--app-chrome, 1))', bottom: 0, height: 3,
      borderRadius: '3px 3px 0 0', background: UNDERLINE,
      transform: on ? 'scaleX(1)' : 'scaleX(0)', transition: 'transform 0.2s ease',
    },
  } as const)

  return (
    <Box
      component="nav"
      aria-label={section === 'wpbl' ? 'WPBL sections' : 'MLB sections'}
      sx={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch', minWidth: 0, ...sx }}
    >
      {tabs.map(t => {
        const on = t.key === lit
        return (
          <Box
            key={t.key}
            component="a"
            href={t.href}
            aria-current={on ? 'page' : undefined}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              if (modifiedClick(e)) return
              e.preventDefault()
              if (live) {
                setPending(t.key)
                startTransition(() => live.onSelect(t.key))
              } else navigate(t.href)
            }}
            sx={tabSx(on)}
          >
            {t.label}
            {/* In the tab's padding, not beside the label: a dot that took width would move every
                tab after it when it appeared, and index.html's static bar cannot know whether it
                will, since that rides on what this reader has already opened. */}
            {t.badge && (
              <Box component="span" aria-label="new" sx={{
                position: 'absolute', top: 'calc(50% - 0.55em)', right: 3,
                width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-accent-solid)',
              }} />
            )}
          </Box>
        )
      })}
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={section === 'wpbl' ? 'More WPBL pages' : 'More MLB pages'}
        // MLB's rows come from the section, so for the moment before its chunk lands there is
        // nothing to open.
        disabled={more.length === 0}
        onClick={(e: MouseEvent<HTMLButtonElement>) => setAnchor(e.currentTarget)}
        sx={{ ...tabSx(moreCurrent || !!anchor), '&:disabled': { cursor: 'default' } }}
      >
        More
        <Box component="span" aria-hidden sx={{ fontSize: '0.6rem' }}>▾</Box>
      </Box>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        MenuListProps={{ dense: true }}
      >
        {more.map(m => (
          <MenuItem
            key={m.key}
            {...(m.href ? { component: 'a', href: m.href } : {})}
            selected={m.current}
            onClick={m.onClick}
            sx={{
              textDecoration: 'none', color: 'text.primary',
              ...(m.hint ? { flexDirection: 'column', alignItems: 'flex-start' } : { fontSize: '0.82rem', fontWeight: 600 }),
            }}
          >
            {m.hint ? (
              <>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.35 }}>{m.label}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.35 }}>{m.hint}</Typography>
              </>
            ) : m.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
