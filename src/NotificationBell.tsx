// ─── Toolbar notification bell ────────────────────────────────────────────────
//
// Reads the store in src/lib/notifications.ts and drives the refresh loop that
// re-evaluates the registered sources. Adding a notification type never means
// touching this file — register a source and it shows up here.

import React, { useEffect, useState } from 'react'
import { Badge, Box, ClickAwayListener, IconButton, Paper, Tooltip, Typography } from '@mui/material'
// Filled variant, matching the rest of the toolbar (Brightness4/7, Search,
// Close, AccountCircle). The `…None`/`…Outlined` glyphs are a lighter stroke
// weight and read as a different icon set sitting next to them.
import { Notifications, Close } from '@mui/icons-material'
import { useAuth } from './AuthContext'
import {
  useNotifications, refreshNotifications, registerNotificationSource,
  markAllRead, markRead, dismissNotification, addEventNotification,
  AppNotification,
} from './lib/notifications'
import { picksReadySource } from './mlb/notifications/picksReady'
import { gameStartSource } from './mlb/notifications/gameStart'
import { milestoneSource } from './mlb/notifications/milestones'
import { parseDeepLink, requestDeepLink } from './mlb/state/deepLink'

// Registered at module load so the set of sources is declared in one place.
registerNotificationSource(picksReadySource)
registerNotificationSource(gameStartSource)
registerNotificationSource(milestoneSource)

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
      <Box sx={{ position: 'relative' }}>
        <Tooltip title="Notifications">
          <IconButton
            size="small"
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
          <Paper elevation={8} sx={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            zIndex: 1500, borderRadius: 2.5, overflow: 'hidden',
            width: 300,
            // Divide by --app-zoom so the panel stays on-screen under the
            // desktop `zoom` wrapper, which doesn't shrink viewport units.
            maxHeight: 'calc(70vh / var(--app-zoom, 1))', overflowY: 'auto',
          }}>
            <Box sx={{
              px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1,
              borderBottom: '1px solid', borderColor: 'divider',
              position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
            }}>
              <Typography sx={{
                flex: 1, fontSize: '0.62rem', fontWeight: 800, color: 'text.secondary',
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                Notifications
              </Typography>
            </Box>

            {items.length === 0 ? (
              <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                  You're all caught up
                </Typography>
                <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.5 }}>
                  Pick reminders and updates will show up here.
                </Typography>
              </Box>
            ) : (
              items.map(n => (
                <Box
                  key={n.id}
                  onClick={() => handleClick(n)}
                  sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 1.25,
                    px: 1.5, py: 1.25, cursor: 'pointer',
                    borderBottom: '1px solid', borderColor: 'divider',
                    bgcolor: n.read ? 'transparent' : 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' },
                    '&:last-of-type': { borderBottom: 'none' },
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
                  <Box
                    onClick={e => { e.stopPropagation(); dismissNotification(n.id) }}
                    sx={{
                      flexShrink: 0, display: 'flex', color: 'text.disabled', p: 0.25,
                      borderRadius: 1, '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                    }}
                  >
                    <Close sx={{ fontSize: '0.8rem' }} />
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
