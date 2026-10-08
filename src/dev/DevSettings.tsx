// ─── Local-dev-only settings gear ─────────────────────────────────────────────
// One dev menu for the whole site, rendered from App.tsx's toolbar behind
// import.meta.env.DEV so production tree-shakes it all away. The generic controls show on every
// section; the MLB simulators show on /mlb and the WPBL ones on /wpbl, so neither section is asked
// to scroll past the other's tools. All state lives in module singletons or app-wide contexts, so
// the gear controls the live views whichever section is mounted.
//
// IT SAYS WHAT IS ON. Every simulation here persists across reloads, which is the point of most of
// them and also the trap: a slate of fake games or a pinned "Winter" phase left on from last week
// looks exactly like a bug in the real thing. So the gear wears a dot whenever anything is
// overriding real data, the menu opens on a list of what, and one button puts it all back.
//
// Anything this menu reaches into must be import-light. App.tsx imports this file eagerly while
// both sections are `lazy()`, so a convenience import from deep inside MlbStats or WpblApp would
// pull that section's chunk into the main bundle for every visitor, in production, to serve a
// control that only exists in dev.

import React, { lazy, Suspense, useSyncExternalStore } from 'react'
import { Box, Typography, Popover, Tooltip, Divider, Button } from '@mui/material'
import { Settings } from '@mui/icons-material'
import { useAuth, simulateDevLogin } from '../AuthContext'
import { useTheme, SKIN_OPTIONS } from '../ThemeContext'
import { ACCENT } from '../mlb/constants'
import { SegControl } from '../mlb/components/ui'
import { useDevSim, setDevSimEnabled, regenerateDevSim, decideDevSimWinners, reopenDevSim, devSimActive } from '../mlb/dev/devSim'
import { useDevDrama, setDevDramaEnabled, regenerateDevDrama, devDramaActive } from '../mlb/dev/devDrama'
import { useDevDevice, setDeviceMode, currentPreset, isInsideDeviceFrame } from '../mlb/dev/devDevice'
import {
  useDevSeasonPhase, setDevSeasonPhase, DevSeasonPhase, useDevNoTeam, setDevNoTeam, devSeasonPhaseActive,
} from '../mlb/dev/devSeasonPhase'
import { devShowDiscordCard } from '../wpbl/discordInvite'
import { setDevChampionPhase, rerollDevChampion, devChampionState, type DevChampionPhase } from '../wpbl/dev/devChampion'
import { setDevFanPhotos, devFanPhotosOn } from '../wpbl/dev/devFanPhotos'
import { devBackdateNewSince } from '../wpbl/newSince'
import { installWpblReadOverlay } from '../wpbl/api'
import {
  DEV_LIVE_SPEEDS, devLiveCandidates, devLiveCursor, devLiveFinished, devLiveOverlay,
  devLivePlayCount, devLiveSnapshot, restartDevLive, setDevLiveEnabled, setDevLiveGame,
  setDevLivePlaying, setDevLiveSpeed, stepDevLive, subscribeDevLive,
} from '../wpbl/dev/devLiveGame'
import { resetBadgesForDev } from '../lib/seen'
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

// The two flags read once at load by code outside this menu (lib/roles.ts, AdminUsers.tsx). They
// have no store to subscribe to, so the menu writes them and reloads.
const FORCE_TESTER_KEY = 'sdForceTester'
const FAKE_USERS_KEY = 'sdDevFakeUsers'
const readFlag = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeFlag = (k: string, v: string | null) => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* dev only */ }
}

/** `reload` for a flag that is read once at load, where turning it off means nothing until then. */
interface Override { label: string; reset: () => void; reload?: boolean }

/** Everything currently standing in for real data, each with the call that turns it off. The
 *  device frame is left out: it is impossible to miss. So is the simulated login, whose avatar
 *  is in the toolbar and whose undo is a sign-out. */
function activeOverrides(): Override[] {
  const out: Override[] = []
  if (devSimActive()) out.push({ label: 'MLB prediction slate', reset: () => setDevSimEnabled(false) })
  if (devDramaActive()) out.push({ label: 'MLB live drama', reset: () => setDevDramaEnabled(false) })
  if (devSeasonPhaseActive()) out.push({ label: 'MLB Home phase / no team', reset: () => { setDevSeasonPhase('auto'); setDevNoTeam(false) } })
  if (devChampionState().phase !== 'off') out.push({ label: 'WPBL season finale', reset: () => setDevChampionPhase('off') })
  if (devFanPhotosOn()) out.push({ label: 'WPBL mock fan photos', reset: () => setDevFanPhotos(false) })
  if (devLiveSnapshot().enabled) out.push({ label: 'WPBL live replay', reset: () => setDevLiveEnabled(false) })
  if (readFlag(FORCE_TESTER_KEY) === '1') out.push({ label: 'Tester role', reset: () => writeFlag(FORCE_TESTER_KEY, null), reload: true })
  if (Number(readFlag(FAKE_USERS_KEY) ?? 0) > 0) out.push({ label: 'Fake /admin roster', reset: () => writeFlag(FAKE_USERS_KEY, null), reload: true })
  return out
}

/** Re-reads the overrides once a second while `live`. The stores are spread over several modules
 *  with three different change signals, and polling a few in-memory reads is simpler than
 *  subscribing to all of them for a menu only a developer ever opens. */
function useActiveOverrides(live: boolean): [Override[], () => void] {
  const [list, setList] = React.useState<Override[]>(activeOverrides)
  const refresh = React.useCallback(() => setList(activeOverrides()), [])
  React.useEffect(() => {
    refresh()
    if (!live) return
    const id = window.setInterval(refresh, 1000)
    return () => window.clearInterval(id)
  }, [live, refresh])
  return [list, refresh]
}

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

const heading = { fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mb: 0.75 } as const
const note = { fontSize: '0.68rem', color: 'text.disabled', mt: 0.5 } as const
const btn = { textTransform: 'none', fontWeight: 600 } as const
/** A group label, so a long menu can be scanned for the section you want. */
const group = { fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.disabled', mb: 1 } as const

export function DevSettings({ showMlbTools, showWpblTools }: { showMlbTools: boolean; showWpblTools: boolean }) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const [active, refresh] = useActiveOverrides(Boolean(anchor))
  const on = active.length > 0
  const { user, signOut } = useAuth()
  return (
    <>
      <Tooltip title={on ? `Dev settings: ${active.length} override${active.length === 1 ? '' : 's'} on` : 'Dev settings (local only)'}>
        <Box
          onClick={e => setAnchor(e.currentTarget)}
          sx={{
            position: 'relative', flexShrink: 0, mr: 0.25,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
            color: anchor || on ? 'warning.main' : 'text.disabled',
            border: '1px solid', borderColor: anchor || on ? 'warning.main' : 'divider',
            '&:hover': { color: 'warning.main', borderColor: 'warning.main' },
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <Settings sx={{ fontSize: '1rem' }} />
          {on && (
            <Box sx={{
              position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: '50%',
              bgcolor: 'warning.main', boxShadow: theme => `0 0 0 1.5px ${theme.palette.background.paper}`,
            }} />
          )}
        </Box>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => { setAnchor(null); refresh() }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 280, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
      >
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'warning.main', mb: 1.5 }}>
          🛠 Dev settings · local only
        </Typography>

        <ActiveOverrides active={active} refresh={refresh} />

        <Typography sx={group}>Look</Typography>
        <SkinControls />
        <Divider sx={{ my: 1.75 }} />
        <DeviceModeControls />

        {showMlbTools && (
          <>
            <Divider sx={{ my: 1.75 }} />
            <Typography sx={group}>MLB</Typography>
            <Typography sx={heading}>Home season phase</Typography>
            <SeasonPhaseControls />
            <Divider sx={{ my: 1.75 }} />
            <PredSimControls />
            <Divider sx={{ my: 1.75 }} />
            <DramaSimControls />
          </>
        )}

        {showWpblTools && (
          <>
            <Divider sx={{ my: 1.75 }} />
            <Typography sx={group}>WPBL</Typography>
            <WpblControls />
          </>
        )}

        <Divider sx={{ my: 1.75 }} />
        <Typography sx={group}>Account and access</Typography>
        <Typography sx={heading}>Simulated login</Typography>
        {user ? (
          <Box>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', mb: 1 }}>
              Signed in as{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {user.user_metadata?.full_name ?? user.email}
              </Box>
            </Typography>
            <Button fullWidth size="small" variant="outlined" color="warning" onClick={() => { signOut() }} sx={btn}>
              Sign out
            </Button>
          </Box>
        ) : (
          <Button fullWidth size="small" variant="contained" color="warning" onClick={() => simulateDevLogin()} sx={btn}>
            Simulate login as random user
          </Button>
        )}
        <Divider sx={{ my: 1.75 }} />
        <AccessControls />

        <Divider sx={{ my: 1.75 }} />
        <Typography sx={group}>Checks</Typography>
        <NotificationTestControls />
        <Divider sx={{ my: 1.75 }} />
        <MarkerControls />
        <Divider sx={{ my: 1.75 }} />
        <LoadingStateControls />
      </Popover>
    </>
  )
}

/** The list the menu opens on. Nothing at all when nothing is on, so a clean slate costs no room. */
function ActiveOverrides({ active, refresh }: { active: Override[]; refresh: () => void }) {
  if (active.length === 0) return null
  const turnOff = (list: Override[]) => {
    list.forEach(o => o.reset())
    if (list.some(o => o.reload)) window.location.reload(); else refresh()
  }
  return (
    <Box sx={{ mb: 1.75, p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'warning.main' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'warning.main', mb: 0.5 }}>
        Not real data
      </Typography>
      {active.map(o => (
        <Box key={o.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ flex: 1, fontSize: '0.72rem', color: 'text.primary' }}>{o.label}</Typography>
          <Box component="button" type="button" onClick={() => turnOff([o])} sx={{
            border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer', font: 'inherit', fontSize: '0.68rem',
            '&:hover': { color: 'warning.main' },
          }}>Off</Box>
        </Box>
      ))}
      <Button fullWidth size="small" variant="contained" color="warning" onClick={() => turnOff(active)} sx={{ ...btn, mt: 0.75 }}>
        Reset all to real data
      </Button>
    </Box>
  )
}

// ─── WPBL ──────────────────────────────────────────────────────────────────────

function WpblControls() {
  return (
    <>
      <DiscordInviteControl />
      <Divider sx={{ my: 1.75 }} />
      <ChampionBannerControls />
      <Divider sx={{ my: 1.75 }} />
      <FanPhotosDevControl />
      <Divider sx={{ my: 1.75 }} />
      <LiveGameSimControls />
    </>
  )
}

/**
 * The Discord invite on Home is dismissed with an ✕ and remembered in localStorage with no
 * reader-facing way back, which is correct and makes the card a nuisance to work on: one tap and
 * it is gone from that browser for good.
 *
 * The note about device mode is not decoration. The card renders at `xs` only, so pressing this
 * on a desktop-width window clears the flag and appears to do nothing, which reads as a broken
 * button rather than a card that is out of scope for the width.
 */
function DiscordInviteControl() {
  return (
    <>
      <Typography sx={heading}>Discord invite on Home</Typography>
      <Button fullWidth size="small" variant="outlined" color="warning" onClick={() => devShowDiscordCard()} sx={btn}>
        Show it again
      </Button>
      <Typography sx={note}>Undismisses it. Phone widths only: switch Device to Mobile to see it.</Typography>
    </>
  )
}

/**
 * Simulate the end of the season, in the two steps it actually happens in.
 *
 * The champion surfaces (the top banner, Home's season-recap card, the season page's champion
 * block) only appear once the real final is played, which is one moment a season and gone by the
 * time anyone is working on them. This shows them on demand. STARTED is the moment the final goes
 * live: the recap card takes the Next-game slot, with no champion yet. FINISHED is the moment it
 * ends: a random club that could win becomes the champion on every one of those surfaces at once,
 * off a shared seed so they agree. Re-roll asks for a fresh club. Off is the real behaviour, and
 * a genuine champion always wins over this.
 */
function ChampionBannerControls() {
  // Seeded from the module, not a default: the popover unmounts on close, so this reads the last
  // phase back on reopen rather than snapping to Off while the simulation is still on.
  const [phase, setPhase] = React.useState<DevChampionPhase>(() => devChampionState().phase)
  const set = (next: DevChampionPhase) => { setPhase(next); setDevChampionPhase(next) }
  return (
    <>
      <Typography sx={heading}>Season finale (simulate)</Typography>
      <SegControl
        options={[{ value: 'off', label: 'Off' }, { value: 'started', label: 'Started' }, { value: 'finished', label: 'Finished' }]}
        value={phase}
        onChange={v => set(v as DevChampionPhase)}
      />
      {phase === 'finished' && (
        <Box sx={{ mt: 1.25 }}>
          <Button fullWidth size="small" variant="outlined" color="warning" onClick={() => rerollDevChampion()} sx={btn}>
            🎲 New random champion
          </Button>
        </Box>
      )}
      {phase !== 'off' && (
        <Typography sx={{ ...note, mt: 0.75 }}>
          {phase === 'started'
            ? 'The final has started: the recap card takes the Next-game slot, no champion yet.'
            : 'The final is decided: a random champion on Home and the season page.'}
        </Typography>
      )}
    </>
  )
}

/**
 * Force the Home fan-photos card on, padded with mock rows. The card is gated on there being
 * twelve real published photos, which there will not be for a while, so this is the only way to
 * see the offseason Home the plan is about. Pair it with the season finale set to Finished.
 */
function FanPhotosDevControl() {
  const [on, setOn] = React.useState<boolean>(() => devFanPhotosOn())
  const toggle = () => { const next = !on; setOn(next); setDevFanPhotos(next) }
  return (
    <>
      <Typography sx={heading}>Fan photos on Home (mock)</Typography>
      <Button fullWidth size="small" variant="outlined" color={on ? 'success' : 'warning'} onClick={toggle} sx={btn}>
        {on ? 'On: showing mock photos' : 'Off'}
      </Button>
      <Typography sx={note}>
        Pads the Home card to twelve so it renders before there are that many real photos. Reuses
        real photos where they exist.
      </Typography>
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
  const small = { ...btn, minWidth: 0 }

  return (
    <>
      <Typography sx={heading}>Simulate a live game</Typography>

      {games.length === 0 ? (
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
          Open the WPBL section first so the schedule loads.
        </Typography>
      ) : (
        <>
          {/* A native select. The list is every played game of the season and the popover is
              narrow, so a styled MUI menu would be a scroll inside a scroll for no gain. */}
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
              sx={{ ...small, flex: 1 }}
            >
              {sim.enabled ? 'Stop' : 'Start'}
            </Button>
            <Button
              size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => setDevLivePlaying(sim.startedAt == null)}
              sx={{ ...small, px: 1 }}
            >
              {sim.startedAt == null ? '▶' : '❙❙'}
            </Button>
            <Button size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => stepDevLive(-5)} sx={{ ...small, px: 1 }}>−5</Button>
            <Button size="small" variant="outlined" color="warning" disabled={!sim.enabled}
              onClick={() => stepDevLive(5)} sx={{ ...small, px: 1 }}>+5</Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75 }}>
            {DEV_LIVE_SPEEDS.map(ms => (
              <Button
                key={ms} size="small" color="warning"
                variant={sim.msPerPlay === ms ? 'contained' : 'outlined'}
                onClick={() => setDevLiveSpeed(ms)}
                sx={{ ...small, flex: 1, fontSize: '0.66rem' }}
              >{ms / 1000}s/play</Button>
            ))}
          </Box>

          <Button
            fullWidth size="small" variant="outlined" color="warning" disabled={!sim.enabled}
            onClick={() => restartDevLive()} sx={{ ...small, mb: 0.75 }}
          >Back to the 1st</Button>

          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
            {!sim.enabled ? 'Off. The game reads as the final it is.'
              : total == null ? 'Open the game once so its plays load.'
              : devLiveFinished() ? `Replay over (${total} plays). It has gone final.`
              : `Play ${at} of ${total}${sim.startedAt == null ? ' · paused' : ''}`}
          </Typography>
          {sim.enabled && chosen && (
            <Typography sx={note}>
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

// ─── Look ──────────────────────────────────────────────────────────────────────

function SkinControls() {
  const { skin, setSkin } = useTheme()
  return (
    <>
      <Typography sx={heading}>Skin (palette)</Typography>
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

// Desktop ⇆ mobile simulation. Flipping to Mobile reloads the app inside a phone-sized iframe
// (see devDevice.ts / MobilePreview.tsx) so breakpoints and media queries really do resolve at
// phone width.
function DeviceModeControls() {
  const device = useDevDevice()
  return (
    <>
      <Typography sx={heading}>Device simulation</Typography>
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

// ─── MLB ───────────────────────────────────────────────────────────────────────

// Auto reads the league calendar. Season / October / Winter pin it, so every Home can be reviewed
// on any date: see seasonPhase.ts.
function SeasonPhaseControls() {
  const phase = useDevSeasonPhase()
  const noTeam = useDevNoTeam()
  return (
    <>
      <SegControl
        options={[{ value: 'auto', label: 'Auto' }, { value: 'regular', label: 'Season' }, { value: 'over', label: 'October' }, { value: 'offseason', label: 'Winter' }]}
        value={phase}
        onChange={v => setDevSeasonPhase(v as DevSeasonPhase)}
      />
      {/* Home as a reader who follows no team sees it, without touching the synced pref. */}
      <Box sx={{ mt: 1 }}>
        <SegControl
          options={[{ value: 'mine', label: 'My team' }, { value: 'none', label: 'No team' }]}
          value={noTeam ? 'none' : 'mine'}
          onChange={v => setDevNoTeam(v === 'none')}
        />
      </Box>
    </>
  )
}

// Fake events for the Home "Happening Now" card. State lives in the devDrama module singleton,
// which LiveDramaCard reads.
function DramaSimControls() {
  const drama = useDevDrama()
  return (
    <>
      <Typography sx={heading}>Live drama simulator</Typography>
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
          <Button fullWidth size="small" variant="outlined" onClick={() => regenerateDevDrama()} sx={btn}>
            🎲 New random drama
          </Button>
        </Box>
      )}
    </>
  )
}

// Fabricate a random day of games, then decide their winners, to exercise the Predictor's picks
// and its correct/wrong feedback without waiting on the real schedule. State lives in the devSim
// module singleton, which PredictorWidget reads.
function PredSimControls() {
  const sim = useDevSim()
  const decided = sim.games.length > 0 && sim.games.every(g => g.state === 'final')
  return (
    <>
      <Typography sx={heading}>Prediction simulator</Typography>
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
          <Button fullWidth size="small" variant="outlined" onClick={() => regenerateDevSim()} sx={btn}>
            🎲 New random slate
          </Button>
          {decided ? (
            <Button fullWidth size="small" variant="outlined" onClick={() => reopenDevSim()} sx={btn}>
              ↩ Reopen for picks
            </Button>
          ) : (
            <Button fullWidth size="small" variant="contained" onClick={() => decideDevSimWinners()} sx={btn}>
              🏆 Decide winners
            </Button>
          )}
        </Box>
      )}
    </>
  )
}

// ─── Account and access ────────────────────────────────────────────────────────

/**
 * The two localStorage switches that used to need the console to set. Both are read once at load
 * by code that never imports this menu (the tester gate in lib/roles.ts, the roster in
 * AdminUsers.tsx), and both are dead in production however they are set.
 */
function AccessControls() {
  const tester = readFlag(FORCE_TESTER_KEY) === '1'
  const fake = Number(readFlag(FAKE_USERS_KEY) ?? 0) > 0
  return (
    <>
      <Typography sx={heading}>Tester role</Typography>
      <SegControl
        options={[{ value: 'real', label: 'From account' }, { value: 'on', label: 'Force on' }]}
        value={tester ? 'on' : 'real'}
        onChange={v => { writeFlag(FORCE_TESTER_KEY, v === 'on' ? '1' : null); window.location.reload() }}
      />
      <Typography sx={note}>Shows tester-gated work in progress without a role row. Reloads.</Typography>

      <Typography sx={{ ...heading, mt: 1.5 }}>/admin users roster</Typography>
      <SegControl
        options={[{ value: 'real', label: 'Real' }, { value: 'fake', label: '150 fake' }]}
        value={fake ? 'fake' : 'real'}
        onChange={v => { writeFlag(FAKE_USERS_KEY, v === 'fake' ? '150' : null); window.location.reload() }}
      />
      <Typography sx={note}>Seeded people, so the panel's layout can be worked on without real names on screen. Reloads.</Typography>
    </>
  )
}

// ─── Checks ────────────────────────────────────────────────────────────────────

// In-site notification tester, the bell's counterpart to the push tester
// (`node scripts/send-reminders.mjs --test <user>`). Three separate paths, and
// it's worth knowing which one each button exercises:
//
//   Fire <type>    injects a sample straight into the store. Tests rendering,
//                  badge counting, and the panel. Samples come from the shared
//                  catalog, so a new notification type gets a button for free.
//   Simulate push  replays the exact message sw.js posts to open tabs, so it
//                  covers the service-worker to bell bridge without needing a
//                  real push round-trip.
//   Re-evaluate    runs the registered sources for real. This is the only
//                  button that tests derived notifications end to end,
//                  including retraction when a source stops producing.
function NotificationTestControls() {
  const { user } = useAuth()
  const { items, unread } = useNotifications()
  const samples = sampleNotifications()

  // What sw.js posts on `push`, replayed here so the listener path is covered.
  const simulatePush = (payload: NotificationPayload) => {
    navigator.serviceWorker?.dispatchEvent(
      new MessageEvent('message', { data: { type: 'push-received', payload } })
    )
  }

  const left = { ...btn, justifyContent: 'flex-start' }

  return (
    <>
      <Typography sx={heading}>In-site notifications</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', mb: 1 }}>
        {items.length} in the bell · {unread} unread
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {samples.map(s => (
          <Box key={s.type} sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" variant="outlined" sx={{ ...left, flex: 1 }} onClick={() => addEventNotification(s.payload)}>
              {s.payload.icon} {s.label}
            </Button>
            <Tooltip title="Replay the service-worker push message">
              <Button size="small" variant="outlined" sx={{ ...left, minWidth: 36, px: 0 }} onClick={() => simulatePush(s.payload)}>
                📡
              </Button>
            </Tooltip>
          </Box>
        ))}

        <Button size="small" variant="outlined" sx={left} onClick={() => refreshNotifications({ userId: user?.id ?? null })}>
          ↻ Re-evaluate sources (real data)
        </Button>
        <Button size="small" variant="outlined" color="warning" sx={left} onClick={() => clearNotifications()}>
          ✕ Clear all
        </Button>
      </Box>
    </>
  )
}

/**
 * Bring back the markers a reader clears by looking: the "new feature" dots (lib/seen.ts) and the
 * "New" tags on Reading and Watch (wpbl/newSince.ts). Each is one look and gone, which makes them
 * the hardest things on the site to check twice.
 */
function MarkerControls() {
  const [done, setDone] = React.useState<string | null>(null)
  return (
    <>
      <Typography sx={heading}>Markers</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Button size="small" variant="outlined" sx={btn} onClick={() => { resetBadgesForDev(); setDone('Feature dots back. Reload to see them.') }}>
          Show "new feature" dots again
        </Button>
        <Button size="small" variant="outlined" sx={btn} onClick={() => { devBackdateNewSince(14); setDone('Last visit set to 14 days ago. Reload Reading or Watch.') }}>
          Mark the last 14 days of Reading and Watch new
        </Button>
      </Box>
      {done && <Typography sx={note}>{done}</Typography>}
    </>
  )
}

/**
 * The loading-state checks from CLAUDE.md, one tap instead of a hand-typed query string. Each
 * reloads the current page with the param (see dev/slowLoad.ts); the sections rewrite the query
 * once mounted, so it does not stick.
 */
function LoadingStateControls() {
  const reloadWith = (param: string, value: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(param, value)
    window.location.assign(url.toString())
  }
  return (
    <>
      <Typography sx={heading}>Loading states</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Button size="small" variant="outlined" sx={btn} onClick={() => reloadWith('devSlow', '2500')}>
          Reload with slow data (skeletons, 2.5s)
        </Button>
        <Button size="small" variant="outlined" sx={btn} onClick={() => reloadWith('devSlowMount', '3000')}>
          Reload with slow mount (static bar, 3s)
        </Button>
        <Button size="small" variant="outlined" sx={btn} onClick={() => reloadWith('awardsPreview', '1')}>
          Awards poster preview
        </Button>
      </Box>
      <Typography sx={note}>Compare element rects against the loaded page; a hidden pane records no layout shift.</Typography>
    </>
  )
}
