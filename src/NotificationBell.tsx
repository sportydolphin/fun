// ─── Toolbar notification bell ────────────────────────────────────────────────
//
// Reads the store in src/lib/notifications.ts and drives the refresh loop that
// re-evaluates the registered sources. Adding a notification type never means
// touching this file — register a source and it shows up here.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Badge, Box, ClickAwayListener, IconButton, Paper, Tooltip, Typography } from '@mui/material'
// Filled variant, matching the rest of the toolbar (Brightness4/7, Search,
// Close, AccountCircle). The `…None`/`…Outlined` glyphs are a lighter stroke
// weight and read as a different icon set sitting next to them.
import { Notifications, Close } from '@mui/icons-material'
import { useAuth } from './AuthContext'
import { pressable, FOCUS_RING } from './wpbl/ui'
import {
  useNotifications, refreshNotifications, registerNotificationSource,
  markAllRead, markRead, dismissNotification, clearNotifications, addEventNotification,
  AppNotification,
} from './lib/notifications'
import { picksReadySource } from './mlb/notifications/picksReady'
import { gameStartSource } from './mlb/notifications/gameStart'
import { milestoneSource } from './mlb/notifications/milestones'
import { wpblGameStartSource } from './wpbl/notifications/gameStart'
import { parseDeepLink, requestDeepLink } from './mlb/state/deepLink'

// Registered at module load so the set of sources is declared in one place.
registerNotificationSource(picksReadySource)
registerNotificationSource(gameStartSource)
registerNotificationSource(milestoneSource)
registerNotificationSource(wpblGameStartSource)

const REFRESH_MS = 5 * 60_000

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationBell({ onNavigate }: { onNavigate: (url: string) => void }) {
  const { user } = useAuth()
  const { items, unread } = useNotifications()
  const [open, setOpen] = useState(false)

  // Where the panel hangs from on a phone. The dropdown is anchored to the bell, which sits
  // in the middle of the toolbar — fine on desktop, but a fixed 300px panel whose right edge
  // is the bell's right edge starts 39px off the left of a 375px screen, which is why the
  // header used to read "FICATIONS". On a phone it becomes a viewport-width sheet instead,
  // and a fixed sheet needs a real y in viewport coordinates. Measured rather than hardcoded
  // so it keeps working if the toolbar's height ever changes.
  const anchorRef = useRef<HTMLDivElement>(null)
  const [anchorBottom, setAnchorBottom] = useState(0)
  useLayoutEffect(() => {
    if (open && anchorRef.current) setAnchorBottom(anchorRef.current.getBoundingClientRect().bottom)
  }, [open])

  // Escape closes it. ClickAwayListener covers the pointer, but on a phone the panel is a
  // near-full-width sheet with very little page left to tap beside it, and a keyboard user
  // had no way out at all except tabbing through every row.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Re-evaluate sources on mount, when the signed-in user changes, on a timer,
  // and whenever the tab regains focus (the slate may have moved on since).
  useEffect(() => {
    const ctx = { userId: user?.id ?? null }
    const run = () => { refreshNotifications(ctx) }
    run()
    const timer = setInterval(run, REFRESH_MS)
    const onFocus = () => run()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [user?.id])

  // A push that arrives while the tab is open is shown by the OS *and* recorded
  // here, so the bell reflects it too. sw.js forwards the payload.
  //
  // It also forwards clicks on an OS notification when this tab is the one it
  // focuses: focusing can't carry a url, so the action arrives as a message
  // instead and takes the same path as an in-app bell click.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push-received' && e.data.payload?.id) {
        addEventNotification(e.data.payload)
      }
      if (e.data?.type === 'notification-click' && typeof e.data.url === 'string') {
        const link = parseDeepLink(e.data.url)
        if (link) requestDeepLink(link)
        onNavigate(e.data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [onNavigate])

  const handleClick = (n: AppNotification) => {
    markRead(n.id)
    setOpen(false)
    // The url's `open=` action is what makes the click useful — without it we'd
    // just drop the user on Home. Publish it before navigating so a component
    // that's already mounted (the common case: the bell is clicked from Home)
    // reacts; a cold start instead picks it up from the url at module load.
    const link = parseDeepLink(n.url)
    if (link) requestDeepLink(link)
    onNavigate(n.url)
  }

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchorRef} sx={{ position: 'relative' }}>
        {/* Suppressed while the panel is open. The tooltip is interactive, so it sits on top
            of the panel's own header and eats the click meant for Clear all, which lands
            directly under it. A label for a control the reader has already operated is noise
            anyway. */}
        <Tooltip title={open ? '' : 'Notifications'}>
          <IconButton
            size="small"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={open}
            onClick={() => {
              setOpen(o => !o)
              // Opening the panel is the "I've seen these" signal.
              if (!open && unread > 0) markAllRead()
            }}
            sx={{ color: 'text.secondary' }}
          >
            <Badge
              badgeContent={unread}
              max={9}
              sx={{ '& .MuiBadge-badge': { bgcolor: '#ef4444', color: '#fff', fontSize: '0.6rem', minWidth: 15, height: 15 } }}
            >
              <Notifications />
            </Badge>
          </IconButton>
        </Tooltip>

        {open && (
          <Paper elevation={8} role="dialog" aria-labelledby="notification-panel-title" sx={{
            zIndex: 1500, borderRadius: 2.5, overflow: 'hidden',
            // Phone: a sheet pinned to the viewport with an even margin each side, so it
            // can't run off an edge whatever the bell's position in the toolbar.
            // Tablet up: the original dropdown, anchored under the bell.
            position: { xs: 'fixed', sm: 'absolute' },
            top: { xs: anchorBottom + 8, sm: 'calc(100% + 6px)' },
            left: { xs: 8, sm: 'auto' },
            right: { xs: 8, sm: 0 },
            width: { xs: 'auto', sm: 300 },
            // Plain 70vh: this panel hangs off the toolbar, which is no longer inside the
            // desktop `zoom`, so a viewport unit and a CSS length agree here again.
            maxHeight: '70vh', overflowY: 'auto',
          }}>
            <Box sx={{
              px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1,
              borderBottom: '1px solid', borderColor: 'divider',
              position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
            }}>
              <Typography id="notification-panel-title" sx={{
                flex: 1, fontSize: '0.62rem', fontWeight: 800, color: 'text.secondary',
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                Notifications
              </Typography>
              {/* Only when there is something to clear: a permanently visible control that
                  does nothing most of the time reads as broken. Closing the panel too, since
                  what is left behind is the empty state and the reader is plainly done. */}
              {items.length > 0 && (
                <Box
                  {...pressable(() => { clearNotifications(); setOpen(false) })}
                  aria-label="Clear all notifications"
                  sx={{
                    // 32px tall for the same reason the row's dismiss control is: text this
                    // small makes a ~19px target, which a thumb misses. The negative margin
                    // keeps the header its original height while the target grows.
                    flexShrink: 0, px: 1, minHeight: 32, my: -0.5, borderRadius: 1,
                    display: 'flex', alignItems: 'center',
                    fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
                    textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer',
                    '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                    ...FOCUS_RING,
                  }}
                >
                  Clear all
                </Box>
              )}
            </Box>

            {items.length === 0 ? (
              <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                  You're all caught up
                </Typography>
                {/* Deliberately section-neutral. The default section is WPBL, so the old
                    "pick reminders" wording described a feature the reader may not have,
                    in a section they may never open. */}
                <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.5 }}>
                  Game reminders and updates will show up here.
                </Typography>
              </Box>
            ) : (
              items.map(n => (
                <Box
                  key={n.id}
                  {...pressable(() => handleClick(n))}
                  sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 1.25,
                    px: 1.5, py: 1.4, cursor: 'pointer',
                    borderBottom: '1px solid', borderColor: 'divider',
                    bgcolor: n.read ? 'transparent' : 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' },
                    '&:last-of-type': { borderBottom: 'none' },
                    ...FOCUS_RING,
                  }}
                >
                  <Typography sx={{ fontSize: '1rem', lineHeight: 1.2, flexShrink: 0 }}>{n.icon}</Typography>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: n.read ? 600 : 800, lineHeight: 1.3 }}>
                      {n.title}
                    </Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', lineHeight: 1.35, mt: 0.15 }}>
                      {n.body}
                    </Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mt: 0.35 }}>
                      {timeAgo(n.createdAt)}
                    </Typography>
                  </Box>
                  {/* A 0.8rem glyph with 2px of padding was a ~16px target — half the 32px
                      a thumb needs, sitting right beside the row's own tap area, so dismissing
                      one reliably opened it instead. Now 32px square, with the icon still
                      small so the row doesn't look heavier. */}
                  {/* Hand-rolled rather than pressable(): this control is nested inside a
                      clickable row, so both the click and the Enter/Space keydown have to stop
                      propagating or dismissing would also open the notification. pressable()
                      does not hand back the event, and stopping it in a capture handler would
                      fire before this element's own onClick and swallow the dismiss entirely. */}
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); dismissNotification(n.id) }}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault(); e.stopPropagation()
                      dismissNotification(n.id)
                    }}
                    aria-label="Dismiss notification"
                    sx={{
                      flexShrink: 0, width: 32, height: 32, mt: -0.25, mr: -0.75,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'text.disabled', borderRadius: '50%',
                      '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                      ...FOCUS_RING,
                    }}
                  >
                    <Close sx={{ fontSize: '0.9rem' }} />
                  </Box>
                </Box>
              ))
            )}
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  )
}
