// ─── Consolidated local-dev-only settings gear ────────────────────────────────
// One dev menu for the whole site (both the MLB and WPBL sections), rendered from
// App.tsx's toolbar and gated behind import.meta.env.DEV so production tree-shakes
// it all away. It merges what used to be two separate dev controls — the MLB
// "gear" (device sim, prediction/drama simulators, notification tester, simulated
// login, season-selector A/B) and the toolbar skin picker — into a single popover.
//
// The generic controls (skin, device/mobile simulation, simulated login,
// notification tester) show on every section; the MLB-only simulators are gated
// behind `showMlbTools` and the WPBL ones behind `showWpblTools`, so neither
// section is asked to scroll past the other's tools. All state lives in module
// singletons (devSim/devDrama/devDevice/devSeasonSelector) or app-wide contexts,
// so the gear controls the live views no matter which section is mounted.
//
// Anything this menu reaches into must be import-light. App.tsx imports this file
// eagerly while both sections are `lazy()`, so a convenience import from deep
// inside MlbStats or WpblApp would pull that section's chunk into the main bundle
// for every visitor, in production, to serve a control that only exists in dev.

import React, { lazy, Suspense, useSyncExternalStore } from 'react'
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
import { devShowDiscordCard } from '../wpbl/discordInvite'
import { installWpblReadOverlay } from '../wpbl/api'
import {
  DEV_LIVE_SPEEDS, devLiveCandidates, devLiveCursor, devLiveFinished, devLiveOverlay,
  devLivePlayCount, devLiveSnapshot, restartDevLive, setDevLiveEnabled, setDevLiveGame,
  setDevLivePlaying, setDevLiveSpeed, stepDevLive, subscribeDevLive,
} from '../wpbl/dev/devLiveGame'
import { useNotifications, addEventNotification, refreshNotifications, clearNotifications } from '../lib/notifications'
import { sampleNotifications } from '../../shared/notifications'
import type { NotificationPayload } from '../../shared/notifications'

const MobilePreview = import.meta.env.DEV ? lazy(() => import('../mlb/dev/MobilePreview')) : null

// Armed at module scope rather than from a component, and that matters: App.tsx imports this
// file statically while WpblApp is lazy, so the overlay is in place before the section has made
// its first read. Installed from a mount effect it would miss the schedule fetch on any reload
// where the simulator was already switched on, and the game would flash back to final.
//
// GUARDED even though this file never renders in production, and the guard is load-bearing
// rather than belt-and-braces. Everything else here is a component, so Rollup drops the lot as
// unreachable; a bare call at module scope is a SIDE EFFECT, which makes the module
// unremovable and drags the simulator into the shipped bundle. Measured: without the `if` the
// engine's storage key is in dist/assets/index-*.js, with it the file is absent.
if (import.meta.env.DEV) installWpblReadOverlay(devLiveOverlay)

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

export function DevSettings({ showMlbTools, showWpblTools }: { showMlbTools: boolean; showWpblTools: boolean }) {
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

        {showWpblTools && (
          <>
            <Divider sx={{ my: 1.75 }} />

            <WpblControls />
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
/**
 * WPBL-only controls.
 *
 * Just the Discord invite for now. The invite is dismissed with an ✕ and remembered in
 * localStorage with no reader-facing way back, which is correct and makes the card a nuisance
 * to work on: one tap and it is gone from that browser for good.
 *
 * The note about device mode is not decoration. The card renders at `xs` only, so pressing
 * this on a desktop-width window clears the flag and appears to do nothing, which reads as a
 * broken button rather than a card that is out of scope for the width.
 */
function WpblControls() {
  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        WPBL Home
      </Typography>
      <Button
        fullWidth size="small" variant="outlined" color="warning"
        onClick={() => devShowDiscordCard()}
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        Show Discord invite
      </Button>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.5 }}>
        Undismisses it. Phone widths only. Switch Device to Mobile to see it.
      </Typography>

      <Divider sx={{ my: 1.75 }} />

      <LiveGameSimControls />
    </>
  )
}

/**
 * Replay a finished game as a live one.
 *
 * The live surfaces are the only part of the section that cannot be opened on demand: there is
 * one live game every few days, and its two most awkward states (the break between half-innings,
 * and the impossible count the feed publishes between at-bats) each last about thirty seconds.
 * This makes all of it available at any hour, off the plays the league actually logged.
 *
 * The engine and its limits are in wpbl/dev/devLiveGame.ts.
 */
function LiveGameSimControls() {
  const sim = useSyncExternalStore(subscribeDevLive, devLiveSnapshot, devLiveSnapshot)
  // The cursor is derived from the wall clock rather than ticked, so nothing in the app has to
  // re-render for it to be right. This panel is the exception: it is the one surface SHOWING
  // the cursor, so it ticks a second at a time purely to keep its own readout honest.
  const [, tick] = React.useState(0)
  React.useEffect(() => {
    if (sim.startedAt == null) return
    const id = window.setInterval(() => tick(n => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [sim.startedAt])

  const games = devLiveCandidates()
  const total = devLivePlayCount()
  const at = devLiveCursor(sim)
  const chosen = games.find(g => g.id === sim.gameId)
  const btn = { textTransform: 'none' as const, fontWeight: 600, minWidth: 0 }

  return (
    <>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
        Simulate a live game
      </Typography>

      {games.length === 0 ? (
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
          Open the WPBL section first so the schedule loads.
        </Typography>
      ) : (
        <>
          {/* A native select. The list is every played game of the season and the popover is
              260px wide, so a styled MUI menu would be a scroll inside a scroll for no gain. */}
          <Box
            component="select"
            value={sim.gameId ?? ''}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDevLiveGame(e.target.value)}
            sx={{
              width: '100%', mb: 0.75, px: 1, py: 0.6, borderRadius: 1.5,
              fontSize: '0.72rem', fontWeight: 600,
              color: 'text.primary', bgcolor: 'background.paper',
              border: '1px solid', borderColor: 'divider',
            }}
          >
            {games.map(g => (
              <option key={g.id} value={g.id}>
                {g.game_date} · {g.away_team_id} {g.away_score ?? '-'} @ {g.home_team_id} {g.home_score ?? '-'}
              </option>
            ))}
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75 }}>
            <Button
              size="small" variant={sim.enabled ? 'contained' : 'outlined'} color="warning"
              onClick={() => setDevLiveEnabled(!sim.enabled)}
              sx={{ ...btn, flex: 1 }}
            >
              {sim.enabled ? 'Stop' : 'Start'}
            </Button>
            <Button
              size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => setDevLivePlaying(sim.startedAt == null)}
              sx={{ ...btn, px: 1 }}
            >
              {sim.startedAt == null ? '▶' : '❙❙'}
            </Button>
            <Button size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => stepDevLive(-5)} sx={{ ...btn, px: 1 }}>−5</Button>
            <Button size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => stepDevLive(5)} sx={{ ...btn, px: 1 }}>+5</Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75 }}>
            {DEV_LIVE_SPEEDS.map(ms => (
              <Button
                key={ms} size="small" color="warning"
                variant={sim.msPerPlay === ms ? 'contained' : 'outlined'}
                onClick={() => setDevLiveSpeed(ms)}
                sx={{ ...btn, flex: 1, fontSize: '0.66rem' }}
              >{ms / 1000}s/play</Button>
            ))}
          </Box>

          <Button
            fullWidth size="small" variant="outlined" color="warning" disabled={!sim.enabled}
            onClick={() => restartDevLive()} sx={{ ...btn, mb: 0.75 }}
          >Back to the 1st</Button>

          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
            {!sim.enabled ? 'Off. The game reads as the final it is.'
              : total == null ? 'Open the game once so its plays load.'
              : devLiveFinished() ? `Replay over (${total} plays). It has gone final.`
              : `Play ${at} of ${total}${sim.startedAt == null ? ' · paused' : ''}`}
          </Typography>
          {sim.enabled && chosen && (
            <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.5 }}>
              {/* The two things that will look wrong if nobody says them out loud. */}
              Box-score lines stay at the final totals: there is one cumulative row per player
              and nothing to rewind. The view catches up on the 15s live poll, so a fast speed
              moves several plays at a time.
            </Typography>
          )}
        </>
      )}
    </>
  )
}

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
