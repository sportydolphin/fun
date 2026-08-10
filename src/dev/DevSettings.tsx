// ─── Consolidated local-dev-only settings gear ────────────────────────────────
// One dev menu for the whole site (both the MLB and WPBL sections), rendered from
// App.tsx's toolbar and gated behind import.meta.env.DEV so production tree-shakes
// it all away. It merges what used to be two separate dev controls — the MLB
// "gear" (device sim, prediction/drama simulators, notification tester, simulated
// login, season-selector A/B) and the toolbar skin picker — into a single popover.
//
// The generic controls (skin, device/mobile simulation, simulated login,
// notification tester) show on every section; the MLB-only simulators are gated
// behind `showMlbTools` so they don't clutter the WPBL menu. All state lives in
// module singletons (devSim/devDrama/devDevice/devSeasonSelector) or app-wide
// contexts, so the gear controls the live views no matter which section is mounted.

import React, { lazy, Suspense } from 'react'
import { Box, Typography, Popover, Tooltip, Divider, Button } from '@mui/material'
import { Settings } from '@mui/icons-material'
import { useAuth, simulateDevLogin } from '../AuthContext'
import { useTheme, SKIN_OPTIONS } from '../ThemeContext'
import { ACCENT } from '../mlb/constants'
import { SegControl } from '../mlb/components/ui'
import { useDevSim, setDevSimEnabled, regenerateDevSim, decideDevSimWinners, reopenDevSim } from '../mlb/dev/devSim'
import { useDevDrama, setDevDramaEnabled, regenerateDevDrama } from '../mlb/dev/devDrama'
import { useDevDevice, setDeviceMode, currentPreset, isInsideDeviceFrame } from '../mlb/dev/devDevice'
import { useDevSeasonSelector, setSeasonSelectorStyle } from '../mlb/dev/devSeasonSelector'
import { useNotifications, addEventNotification, refreshNotifications, clearNotifications } from '../lib/notifications'
import { sampleNotifications } from '../../shared/notifications'
import type { NotificationPayload } from '../../shared/notifications'

const MobilePreview = import.meta.env.DEV ? lazy(() => import('../mlb/dev/MobilePreview')) : null

// Mounts the phone-frame overlay when dev device mode is set to `mobile`. Rendered
// from App.tsx so the mobile simulation works on any section, not just MLB. Kept as
// its own component so its hook never runs in production.
export function MobilePreviewHost() {
  const device = useDevDevice()
  if (!MobilePreview || device.mode !== 'mobile') return null
  return (
    <Suspense fallback={null}>
      <MobilePreview />
    </Suspense>
  )
}

export function DevSettings({ showMlbTools }: { showMlbTools: boolean }) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const { user, signOut } = useAuth()
  return (
    <>
      <Tooltip title="Dev settings (local only)">
        <Box
          onClick={e => setAnchor(e.currentTarget)}
          sx={{
            flexShrink: 0, mr: 0.25,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
            color: anchor ? 'warning.main' : 'text.disabled',
            border: '1px solid', borderColor: anchor ? 'warning.main' : 'divider',
            '&:hover': { color: 'warning.main', borderColor: 'warning.main' },
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <Settings sx={{ fontSize: '1rem' }} />
        </Box>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 260, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'warning.main', mb: 1.5 }}>
          🛠 Dev Settings · local only
        </Typography>

        <SkinControls />

        <Divider sx={{ my: 1.75 }} />

        <DeviceModeControls />

        {showMlbTools && (
          <>
            <Divider sx={{ my: 1.75 }} />

            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
              Player-card season selector
            </Typography>
            <SeasonSelectorControls />

            <Divider sx={{ my: 1.75 }} />

            <PredSimControls />

            <Divider sx={{ my: 1.75 }} />

            <DramaSimControls />
          </>
        )}

        <Divider sx={{ my: 1.75 }} />

        <NotificationTestControls />

        <Divider sx={{ my: 1.75 }} />

        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
          Simulated login
        </Typography>
        {user ? (
          <Box>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', mb: 1 }}>
              Signed in as{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {user.user_metadata?.full_name ?? user.email}
              </Box>
            </Typography>
            <Button
              fullWidth size="small" variant="outlined" color="warning"
              onClick={() => { signOut() }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Sign out
            </Button>
          </Box>
        ) : (
          <Button
            fullWidth size="small" variant="contained" color="warning"
            onClick={() => simulateDevLogin()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Simulate login as random user
          </Button>
        )}
      </Popover>
    </>
  )
}

// ─── Skin / palette picker (was a standalone toolbar chip) ─────────────────────
function SkinControls() {
  const { skin, setSkin } = useTheme()
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Skin (palette)
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {SKIN_OPTIONS.map(o => {
          const active = skin === o.key
          return (
            <Box
              key={o.key}
              onClick={() => setSkin(o.key)}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                px: 1.25, py: 0.6, borderRadius: 1.5, cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 700,
                color: active ? ACCENT : 'text.primary',
                bgcolor: active ? `${ACCENT}14` : 'transparent',
                border: '1px solid', borderColor: active ? `${ACCENT}55` : 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {o.label}
              {active && <Box component="span" sx={{ fontSize: '0.7rem' }}>✓</Box>}
            </Box>
          )
        })}
      </Box>
    </>
  )
}

// ─── Player-card season selector A/B (MLB) ─────────────────────────────────────
function SeasonSelectorControls() {
  const style = useDevSeasonSelector()
  return (
    <SegControl
      options={[{ value: 'dropdown', label: 'Dropdown' }, { value: 'buttons', label: 'Buttons' }]}
      value={style}
      onChange={v => setSeasonSelectorStyle(v as 'dropdown' | 'buttons')}
    />
  )
}

// In-site notification tester — the bell's counterpart to the push tester
// (`node scripts/send-reminders.mjs --test <user>`). Three separate paths, and
// it's worth knowing which one each button exercises:
//
//   Fire <type>   — injects a sample straight into the store. Tests rendering,
//                   badge counting, and the panel. Samples come from the shared
//                   catalog, so a new notification type gets a button for free.
//   Simulate push — replays the exact message sw.js posts to open tabs, so it
//                   covers the service-worker → bell bridge without needing a
//                   real push round-trip.
//   Re-evaluate   — runs the registered sources for real. This is the only
//                   button that tests derived notifications end to end,
//                   including retraction when a source stops producing.
function NotificationTestControls() {
  const { user } = useAuth()
  const { items, unread } = useNotifications()
  const samples = sampleNotifications()

  // What sw.js posts on `push` — replayed here so the listener path is covered.
  const simulatePush = (payload: NotificationPayload) => {
    navigator.serviceWorker?.dispatchEvent(
      new MessageEvent('message', { data: { type: 'push-received', payload } })
    )
  }

  const btnSx = { textTransform: 'none' as const, fontWeight: 600, justifyContent: 'flex-start' }

  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        In-site notifications
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mb: 1 }}>
        {items.length} in the bell · {unread} unread
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {samples.map(s => (
          <Box key={s.type} sx={{ display: 'flex', gap: 0.5 }}>
            <Button
              size="small" variant="outlined" sx={{ ...btnSx, flex: 1 }}
              onClick={() => addEventNotification(s.payload)}
            >
              {s.payload.icon} {s.label}
            </Button>
            <Tooltip title="Replay the service-worker push message">
              <Button
                size="small" variant="outlined" sx={{ ...btnSx, minWidth: 36, px: 0 }}
                onClick={() => simulatePush(s.payload)}
              >
                📡
              </Button>
            </Tooltip>
          </Box>
        ))}

        <Button
          size="small" variant="outlined" sx={btnSx}
          onClick={() => refreshNotifications({ userId: user?.id ?? null })}
        >
          ↻ Re-evaluate sources (real data)
        </Button>
        <Button
          size="small" variant="outlined" color="warning" sx={btnSx}
          onClick={() => clearNotifications()}
        >
          ✕ Clear all
        </Button>
      </Box>
    </>
  )
}

// Desktop ⇆ mobile simulation. Flipping to Mobile reloads the app inside a
// phone-sized iframe (see devDevice.ts / MobilePreview.tsx) so breakpoints and
// media queries really do resolve at phone width. Works on any section now that
// the gear + MobilePreviewHost render app-wide from App.tsx.
function DeviceModeControls() {
  const device = useDevDevice()
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Device simulation
      </Typography>
      {isInsideDeviceFrame ? (
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
          You're inside the simulated phone. Use the toolbar above the device to
          switch presets or exit.
        </Typography>
      ) : (
        <>
          <SegControl
            options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]}
            value={device.mode}
            onChange={v => setDeviceMode(v as 'desktop' | 'mobile')}
          />
          {device.mode === 'mobile' && (
            <Typography sx={{ mt: 1.25, fontSize: '0.7rem', color: 'text.disabled' }}>
              Simulating {currentPreset(device).label}. Esc exits.
            </Typography>
          )}
        </>
      )}
    </>
  )
}

// ─── Prediction-slate simulator (dev only, MLB) ────────────────────────────────
// Fabricate a random day of games, then decide their winners, to exercise the
// Predictor's picks + correct/wrong feedback without waiting on the real schedule.
// State lives in the devSim module singleton, which PredictorWidget reads.
// Dev-only live drama simulator — feeds fake events to the Home "Happening Now"
// card. State lives in the devDrama module singleton, which LiveDramaCard reads.
function DramaSimControls() {
  const drama = useDevDrama()
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Live drama simulator
      </Typography>
      <SegControl
        options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
        value={drama.enabled ? 'on' : 'off'}
        onChange={v => setDevDramaEnabled(v === 'on')}
      />
      {drama.enabled && (
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
            {drama.events.length} fake event{drama.events.length === 1 ? '' : 's'} on the home card
          </Typography>
          <Button
            fullWidth size="small" variant="outlined"
            onClick={() => regenerateDevDrama()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            🎲 New random drama
          </Button>
        </Box>
      )}
    </>
  )
}

function PredSimControls() {
  const sim = useDevSim()
  const decided = sim.games.length > 0 && sim.games.every(g => g.state === 'final')
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Prediction simulator
      </Typography>
      <SegControl
        options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
        value={sim.enabled ? 'on' : 'off'}
        onChange={v => setDevSimEnabled(v === 'on')}
      />
      {sim.enabled && (
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
            {sim.games.length} fake game{sim.games.length === 1 ? '' : 's'}
            {' · '}{decided ? 'winners decided' : 'awaiting picks'}
          </Typography>
          <Button
            fullWidth size="small" variant="outlined"
            onClick={() => regenerateDevSim()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            🎲 New random slate
          </Button>
          {decided ? (
            <Button
              fullWidth size="small" variant="outlined"
              onClick={() => reopenDevSim()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              ↩ Reopen for picks
            </Button>
          ) : (
            <Button
              fullWidth size="small" variant="contained"
              onClick={() => decideDevSimWinners()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              🏆 Decide winners
            </Button>
          )}
        </Box>
      )}
    </>
  )
}
