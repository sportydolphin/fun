import { TeamLogo } from './mlb/components/TeamLogo'
import React, { useEffect, useState } from 'react'
import { Button, Typography, Box, CircularProgress, TextField, Switch, useMediaQuery, type SxProps, type Theme } from '@mui/material'
import {
  ChevronRight, ExpandMore, WarningAmber,
  PersonOutlined, SportsBaseballOutlined, NotificationsNoneOutlined,
  PaletteOutlined, BarChartOutlined, ScienceOutlined, DeleteOutlineOutlined,
} from '@mui/icons-material'
import { Team } from './mlb/types'
import { TEAM_BG } from './mlb/constants'
import { fetchAllTeams } from './mlb/api'
import { supabase } from './lib/supabase'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
  getLocalGameStartPref, setLocalGameStartPref,
  getLocalMilestonePref, setLocalMilestonePref,
  getLocalPickReminderPref, setLocalPickReminderPref,
  loadPickReminderPrefFromSupabase, savePickReminderPrefToSupabase,
  loadGameStartPrefFromSupabase, saveGameStartPrefToSupabase,
} from './mlb/storage/prefs'
import {
  pushSupported, pushConfigured, notificationPermission,
  isSubscribed, enablePush, disablePush,
} from './lib/push'
import {
  getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref,
  getCachedResignPref, fetchResignPref, setResignPref,
} from './wpbl/reminders'
import { ModalShell, pressable, FOCUS_RING } from './wpbl/ui'
import { useTheme, type ThemePref } from './ThemeContext'
import { getDefaultSection, setDefaultSection, type DefaultSection } from './lib/defaultSection'
import { useUnits, type UnitSystem } from './UnitsContext'
import { useEraBasis, type EraBasis } from './wpbl/EraBasisContext'
import { useExperimentsSetting } from './ExperimentsContext'
import { useAuth } from './AuthContext'
import { passwordProblem } from './lib/passwordPolicy'
import { PasswordChecklist } from './PasswordChecklist'
import { useAccessibilitySettings, type TextScale } from './AccessibilityContext'
import { track, EVENTS } from './lib/analytics'
import { typePx } from './ui/scale'
import { InfoDot } from './ui/InfoDot'
import { ICON_SIZE, TYPE_SCALE } from './ui/card'

interface Props {
  open:             boolean
  onClose:          () => void
  // Account fields are absent for signed-out users: the dialog then shows only the
  // universal (account-independent) settings.
  userId?:          string | null
  email?:           string
  currentUsername?: string | null
  onEditUsername?:  () => void   // closes Settings and opens the username dialog
  /** Which section the reader came from, so the league block opens on the one they're
   *  actually using. WPBL is the site's default landing section, so it's the default here. */
  isWpbl?:          boolean
}

// ─── Layout primitives ──────────────────────────────────────────────────────
//
// The dialog used to be stock MUI (Dialog/DialogActions/Select/Button defaults) inside an
// app that has its own design language everywhere else, which is most of why it read as a
// gray slab dropped on top of the page. These four primitives are that language: the same
// bordered card, hairline divider and pill control the rest of the site uses.

function SettingsLabel({ children, icon, danger, sx }: {
  children: React.ReactNode
  /** A small leading glyph so each section is recognizable at a glance, which earns its keep once
   *  the desktop layout puts two columns of these on screen at once. Muted to match the label. */
  icon?: React.ReactNode
  /** The danger zone's header, tinted to match its card so the warning reads before the words. */
  danger?: boolean
  sx?: SxProps<Theme>
}) {
  const color = danger ? 'error.main' : 'text.disabled'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.75 }}>
      {icon && (
        <Box aria-hidden sx={{ display: 'flex', color, '& > svg': { fontSize: ICON_SIZE.sm } }}>{icon}</Box>
      )}
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
        color, ...sx,
      }}>
        {children}
      </Typography>
    </Box>
  )
}

function SettingsCard({ children, danger, sx }: { children: React.ReactNode; danger?: boolean; sx?: SxProps<Theme> }) {
  return (
    <Box sx={{
      borderRadius: 2, border: '1px solid',
      borderColor: danger ? 'error.main' : 'outline',
      overflow: 'hidden', ...sx,
    }}>
      {children}
    </Box>
  )
}

/**
 * One setting. The title and its control share the TOP line; the explanation runs full width
 * beneath them.
 *
 * That split is the fix for the three collisions this dialog had at 375px: a two-line
 * "Measurement units" jammed against its pill, a five-line experimental blurb leaving its
 * switch floating in the vertical middle of the card, and a lead-time dropdown stranded
 * mid-sentence. All three were the same mistake: a control sharing a row with prose that
 * wants the full width. Pinning the control to the title's line means the hint can be as long
 * as it needs to be and never moves the control an inch.
 */
function Row({ title, hint, control, onClick, chevron, first, children }: {
  title: React.ReactNode
  hint?: React.ReactNode
  control?: React.ReactNode
  onClick?: () => void
  chevron?: boolean
  /** Rows stack inside one card; every row but the first draws its own top hairline. */
  first?: boolean
  /** Extra content below the hint (the lead-time picker, the team grid). */
  children?: React.ReactNode
}) {
  return (
    <Box
      {...(onClick ? pressable(onClick) : {})}
      sx={{
        px: 1.75, py: 1.15,
        ...(first ? {} : { borderTop: '1px solid', borderColor: 'divider' }),
        ...(onClick ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, ...FOCUS_RING } : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
        {/* A div, not Typography's default <p>: a title may carry an InfoDot, which is a div, and
            a div inside a <p> is invalid HTML that React reports on every render. */}
        <Typography component="div" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, minWidth: 0 }}>{title}</Typography>
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {control}
          {chevron && <ChevronRight sx={{ color: 'text.disabled' }} />}
        </Box>
      </Box>
      {hint && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.3, lineHeight: 1.45 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  )
}

/** The app's segmented pill, the one control this dialog already hand-rolled for units. Now
 *  shared, so the league switch and the reminder lead time are the same object rather than
 *  three different ideas about what "pick one of these" looks like. */
function PillGroup<T extends string | number>({ options, value, onChange, accent = 'var(--wpbl-accent-solid)', fullWidth }: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
  accent?: string
  fullWidth?: boolean
}) {
  return (
    <Box sx={{
      display: 'flex', borderRadius: 999, border: '1px solid', borderColor: 'outline',
      overflow: 'hidden', ...(fullWidth ? { width: '100%' } : { flexShrink: 0 }),
    }}>
      {options.map(o => {
        const active = value === o.key
        return (
          <Box
            key={o.key}
            {...pressable(() => onChange(o.key))}
            aria-pressed={active}
            sx={{
              ...FOCUS_RING,
              flex: fullWidth ? 1 : 'none',
              px: fullWidth ? 1 : 1.4, py: 0.5,
              textAlign: 'center', cursor: 'pointer', userSelect: 'none',
              fontSize: TYPE_SCALE.meta, fontWeight: 700, whiteSpace: 'nowrap',
              bgcolor: active ? accent : 'transparent',
              color: active ? '#fff' : 'text.secondary',
              transition: 'background-color 0.15s',
              '&:hover': active ? {} : { bgcolor: 'action.hover' },
            }}
          >
            {o.label}
          </Box>
        )
      })}
    </Box>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.75, color: 'error.main' }}>
      <WarningAmber sx={{ fontSize: ICON_SIZE.sm, mt: '1px', flexShrink: 0 }} />
      <Typography sx={{ fontSize: TYPE_SCALE.meta }}>{children}</Typography>
    </Box>
  )
}

// ─── Shared push state ──────────────────────────────────────────────────────
//
// Whether this browser holds a Web Push subscription is a DEVICE fact, not a league one: the
// same subscription delivers MLB pick reminders, MLB game-start reminders and WPBL game
// reminders alike. It is owned here and handed to every section that needs it, so the WPBL
// block and the MLB block can sit in different places while still agreeing about what the
// browser is currently capable of.
interface PushState {
  supported: boolean
  configured: boolean
  perm: ReturnType<typeof notificationPermission>
  setPerm: (p: ReturnType<typeof notificationPermission>) => void
  subscribed: boolean
  setSubscribed: (b: boolean) => void
  busy: boolean
  setBusy: (b: boolean) => void
}

// ─── Notifications, one card for both leagues ───────────────────────────────
//
// Until Nov 12, 2026 each league's reminders sat behind a WPBL / MLB pill, so a reader looking
// at WPBL could not see that MLB prediction reminders were still on, and the one control that
// spanned both ("Stop all push") sat in a third place. Now every notification is in one card:
// this device's push switch first, then each league's rows under its own subhead, the league the
// reader came from first.
//
// The reason a switch is disabled (unsupported browser, blocked permission) is said once, on the
// device row, rather than repeated on whichever reminder row happened to carry it.

/** A league's name between its rows inside the Notifications card. */
function CardSubhead({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 1.75, pt: 1.25, pb: 0.25, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: typePx(0.6), color: 'text.secondary',
      }}>
        {children}
      </Typography>
    </Box>
  )
}

/** An error under the rows that caused it, inside the card. */
function RowError({ children }: { children: React.ReactNode }) {
  return <Box sx={{ px: 1.75, pb: 1.15 }}><ErrorNote>{children}</ErrorNote></Box>
}

/** Every push reminder needs a working subscription path; a bell-only alert does not. */
function pushBlocked(push: PushState): boolean {
  return !push.supported || !push.configured || push.perm === 'denied'
}

/**
 * The WPBL reminders. "Game reminders" is the standing before-every-game preference
 * (user_preferences.notify_wpbl_all_games), which also lives on the Home next-game card where the
 * intent happens; both switches read and write the same preference. "Re-signings" is
 * user_preferences.notify_wpbl_resigns, pushed by the Instagram watcher.
 */
function WpblNotificationRows({ userId, push }: { userId: string; push: PushState }) {
  const [games, setGames] = useState(getCachedAllGamesPref())
  const [resigns, setResigns] = useState(getCachedResignPref())
  const [err, setErr] = useState('')

  useEffect(() => {
    setGames(getCachedAllGamesPref())
    setResigns(getCachedResignPref())
    fetchAllGamesPref(userId).then(pref => { if (pref !== null) setGames(pref) })
    fetchResignPref(userId).then(pref => { if (pref !== null) setResigns(pref) })
  }, [userId])

  // One shape for both: write the preference (which subscribes the device when turning on), keep
  // the switch where it was on failure, since claiming On while nothing can deliver is worse
  // than showing that it failed.
  const toggle = async (
    next: boolean,
    write: (userId: string, on: boolean) => Promise<string | null>,
    apply: (on: boolean) => void,
    events: [string, string],
    props: Record<string, unknown>,
  ) => {
    if (push.busy) return
    push.setBusy(true); setErr('')
    const error = await write(userId, next)
    if (error) {
      setErr(error)
    } else {
      apply(next)
      if (next) push.setSubscribed(true)
      track(next ? events[0] : events[1], props, userId)
    }
    push.setPerm(notificationPermission())
    push.setBusy(false)
  }

  const disabled = push.busy || pushBlocked(push)
  return (
    <>
      <CardSubhead>WPBL</CardSubhead>
      <Row
        first
        title="Game reminders"
        control={
          <Switch
            checked={games}
            disabled={disabled}
            onChange={e => toggle(e.target.checked, setAllGamesPref, setGames,
              [EVENTS.WPBL_GAME_REMINDER_ON, EVENTS.WPBL_GAME_REMINDER_OFF], { scope: 'all', source: 'settings' })}
            slotProps={{ input: { 'aria-label': 'WPBL game reminders' } }}
          />
        }
      />
      <Row
        title="Re-signings"
        control={
          <Switch
            checked={resigns}
            disabled={disabled}
            onChange={e => toggle(e.target.checked, setResignPref, setResigns,
              [EVENTS.WPBL_RESIGN_ALERTS_ON, EVENTS.WPBL_RESIGN_ALERTS_OFF], { source: 'settings' })}
            slotProps={{ input: { 'aria-label': 'WPBL re-signing alerts' } }}
          />
        }
      />
      {err && <RowError>{err}</RowError>}
    </>
  )
}

/**
 * The MLB reminders. Prediction reminders (the daily "make your picks") and game-start reminders
 * are two independent preferences; they used to share one flag with the push subscription itself,
 * which is what let switching one off delete the subscription the others depend on. Milestone
 * alerts are bell-only and device-local, so they never need push and stay usable without it.
 */
function MlbNotificationRows({ userId, push }: { userId: string; push: PushState }) {
  const [picks, setPicks] = useState(getLocalPickReminderPref())
  const [gsEnabled, setGsEnabled] = useState(false)
  const [gsLead, setGsLead] = useState(getLocalGameStartPref().leadMin)
  const [milestones, setMilestones] = useState(getLocalMilestonePref())
  const [err, setErr] = useState('')

  useEffect(() => {
    // localStorage paints the right state on the first frame, then the account value confirms
    // or corrects it. The correction is written back to localStorage rather than kept in React
    // state alone, because the bell's picks-ready source reads the local value to decide whether
    // to nudge: leaving it stale means switching the reminder off on one device leaves this one
    // still nudging.
    setPicks(getLocalPickReminderPref())
    loadPickReminderPrefFromSupabase(userId).then(row => {
      if (row !== null) { setPicks(row); setLocalPickReminderPref(row) }
    })
    setMilestones(getLocalMilestonePref())
    const local = getLocalGameStartPref()
    setGsEnabled(local.enabled)
    setGsLead(local.leadMin)
    loadGameStartPrefFromSupabase(userId).then(row => {
      if (row) { setGsEnabled(row.enabled); setGsLead(row.leadMin) }
    })
  }, [userId])

  /** Subscribes this device if it is not already; returns false (and says why) if that failed. */
  const ensureSubscribed = async (): Promise<boolean> => {
    if (await isSubscribed().catch(() => false)) return true
    const error = await enablePush(userId)
    if (error) {
      setErr(error)
      push.setSubscribed(await isSubscribed().catch(() => false))
      return false
    }
    push.setSubscribed(true)
    return true
  }

  const togglePicks = async (next: boolean) => {
    if (push.busy) return
    push.setBusy(true); setErr('')
    // Turning it off clears the preference and NOTHING else: the same subscription carries every
    // other reminder on the site.
    if (!next || await ensureSubscribed()) {
      setPicks(next)
      setLocalPickReminderPref(next)
      await savePickReminderPrefToSupabase(userId, next)
    }
    push.setPerm(notificationPermission())
    push.setBusy(false)
  }

  const persistGameStart = (next: { enabled: boolean; leadMin: number }) => {
    setLocalGameStartPref(next)
    saveGameStartPrefToSupabase(userId, next)
  }

  // Until Nov 12, 2026 this switch recorded the wish without subscribing the device, so it could
  // read On on a device that would never receive one.
  const toggleGameStart = async (next: boolean) => {
    if (push.busy) return
    push.setBusy(true); setErr('')
    if (!next || await ensureSubscribed()) {
      setGsEnabled(next)
      persistGameStart({ enabled: next, leadMin: gsLead })
    }
    push.setPerm(notificationPermission())
    push.setBusy(false)
  }

  const disabled = push.busy || pushBlocked(push)
  return (
    <>
      <CardSubhead>MLB</CardSubhead>
      <Row
        first
        title="Prediction reminders"
        control={
          <Switch
            checked={picks}
            disabled={disabled}
            onChange={e => togglePicks(e.target.checked)}
            slotProps={{ input: { 'aria-label': 'MLB prediction reminders' } }}
          />
        }
      />
      <Row
        title="Game start reminders"
        control={
          <Switch
            checked={gsEnabled}
            disabled={disabled}
            onChange={e => toggleGameStart(e.target.checked)}
            slotProps={{ input: { 'aria-label': 'MLB game start reminders' } }}
          />
        }
      >
        {gsEnabled && (
          // Four fixed choices are a pill row, not a select: a dropdown wedged into a sentence
          // wrapped onto two lines at 375px and stranded the control.
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>Lead time</Typography>
            <PillGroup
              options={[5, 10, 15, 30].map(m => ({ key: m, label: `${m}m` }))}
              value={gsLead}
              onChange={m => { setGsLead(m); persistGameStart({ enabled: gsEnabled, leadMin: m }) }}
            />
          </Box>
        )}
      </Row>
      <Row
        title={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            Milestone alerts
            {/* The one row here that is not a push, said where the difference matters: on a
                device with notifications blocked, this is the switch that still works. */}
            <InfoDot label="Where milestone alerts appear" text="In the bell on this site only. Never sent as a push." />
          </Box>
        }
        control={
          <Switch
            checked={milestones}
            onChange={e => { setMilestones(e.target.checked); setLocalMilestonePref(e.target.checked) }}
            slotProps={{ input: { 'aria-label': 'MLB milestone alerts' } }}
          />
        }
      />
      {err && <RowError>{err}</RowError>}
    </>
  )
}

// ─── MLB club ───────────────────────────────────────────────────────────────

/** The followed MLB club: not a notification, so it has its own card. */
function MlbTeamCard({ userId }: { userId: string }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamId, setTeamId] = useState<number | null>(null)
  const [playerIds, setPlayerIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setPickerOpen(false)
    setLoadingTeams(true)
    fetchAllTeams().then(setTeams).catch(() => setTeams([])).finally(() => setLoadingTeams(false))
    setPlayerIds(getLocalFollowedPlayerIds())
    setTeamId(getLocalFollowedTeamId())
    loadPrefsFromSupabase(userId).then(row => {
      if (row) {
        setTeamId(row.followed_team_id ?? null)
        setPlayerIds(row.followed_player_ids ?? [])
      }
    })
  }, [userId])

  const selectTeam = async (id: number | null) => {
    setTeamId(id)
    setLocalFollowedTeamId(id)
    setSaving(true)
    await savePrefsToSupabase(userId, id, playerIds)
    setSaving(false)
  }

  const selectedTeam = teams.find(t => t.id === teamId)
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <SettingsCard>
      <Row
        first
        title="Preferred team"
        hint={saving ? 'Saving…' : undefined}
        onClick={() => setPickerOpen(o => !o)}
        control={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {selectedTeam && (
              <TeamLogo teamId={selectedTeam.id} abbr={selectedTeam.abbreviation} size={22} decorative />
            )}
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: selectedTeam ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}>
              {selectedTeam ? selectedTeam.abbreviation : loadingTeams ? 'Loading…' : 'Not set'}
            </Typography>
            <ExpandMore sx={{ color: 'text.secondary', transition: 'transform 0.15s', transform: pickerOpen ? 'rotate(180deg)' : 'none' }} />
          </Box>
        }
      >
        {pickerOpen && (
          <Box sx={{ mt: 1.25 }}>
            {loadingTeams ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : (
              <>
                <Box sx={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 0.5,
                  maxHeight: 168, overflowY: 'auto', pr: 0.5,
                }}>
                  {sortedTeams.map(t => {
                    const bg = TEAM_BG[t.id] ?? '#444'
                    const selected = teamId === t.id
                    return (
                      <Box
                        key={t.id}
                        {...pressable(() => selectTeam(t.id))}
                        aria-pressed={selected}
                        aria-label={t.name}
                        sx={{
                          ...FOCUS_RING,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4,
                          p: 0.75, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
                          border: '1.5px solid', borderColor: selected ? bg : 'transparent',
                          bgcolor: selected ? `${bg}1a` : 'transparent',
                          transition: 'all 0.15s',
                          '&:hover': { borderColor: bg, bgcolor: `${bg}14` },
                        }}
                      >
                        <TeamLogo teamId={t.id} abbr={t.abbreviation} size={28} decorative />
                        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, lineHeight: 1.1, textAlign: 'center' }}>
                          {t.abbreviation}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
                {teamId != null && (
                  <Typography
                    {...pressable(() => selectTeam(null))}
                    sx={{
                      fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'error.main', cursor: 'pointer',
                      mt: 1, display: 'inline-block', borderRadius: 1,
                      '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING,
                    }}
                  >
                    Clear preferred team
                  </Typography>
                )}
              </>
            )}
          </Box>
        )}
      </Row>
    </SettingsCard>
  )
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

export function SettingsDialog({ open, onClose, userId, email, currentUsername, onEditUsername, isWpbl = true }: Props) {
  const signedIn = !!userId

  const { changePassword, hasPassword, openAuthDialog } = useAuth()
  const { themePref, setThemePref } = useTheme()
  const { units, setUnits } = useUnits()
  const { basis: eraBasis, setBasis: setEraBasis } = useEraBasis()
  const { experiments, setExperiments } = useExperimentsSetting()
  const { swipeNav, setSwipeNav, textScale, setTextScale, reduceMotion, setReduceMotion } = useAccessibilitySettings()

  // Two columns once there is room for them (signed-in only: a signed-out reader has a sign-in row
  // and the app cards, and does not need the width). Keyed off MUI's md (900px), the same width the modal
  // widens at below, so the direction switch and the wider dialog land together.
  const twoCol = useMediaQuery('(min-width:900px)')
  const columns = signedIn && twoCol
  // Each side of the desktop layout: a flex column that splits the width when there are two, and
  // simply stacks full-width when there is one (mobile, or a signed-out reader).
  const columnSx = {
    flex: columns ? 1 : 'none', width: columns ? 'auto' : '100%', minWidth: 0,
    display: 'flex', flexDirection: 'column', gap: 2.5,
  } as const
  // "Swipe between tabs" is a touch gesture, so it is meaningless on a mouse-only desktop and just
  // one more switch to scan past. Shown only where the primary pointer is coarse (a touchscreen).
  const touch = useMediaQuery('(pointer: coarse)')

  // Which section a bare visit to "/" opens on. Device-local, so it works signed out too.
  const [defaultSection, setDefaultSectionState] = useState<DefaultSection>(getDefaultSection)

  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deviceErr, setDeviceErr] = useState('')

  // Change-password form, expanded inline in the Account card rather than opening a second
  // modal on top of this one.
  const [pwOpen, setPwOpen] = useState(false)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwDone, setPwDone] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const push: PushState = {
    supported: pushSupported(), configured: pushConfigured(),
    perm, setPerm, subscribed, setSubscribed, busy, setBusy,
  }

  // Reflect the actual subscription state each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setPerm(notificationPermission())
    setDeleteOpen(false); setDeleteConfirm(''); setDeleteErr(''); setDeleting(false)
    setDeviceErr('')
    closePasswordForm()
    if (pushSupported()) isSubscribed().then(setSubscribed).catch(() => setSubscribed(false))
  }, [open])

  const closePasswordForm = () => {
    setPwOpen(false); setPwDone(false); setPwErr('')
    // Clear both copies out of component state the moment the form is not on screen.
    setPwCurrent(''); setPwNext(''); setPwConfirm('')
  }

  const handleChangePassword = async () => {
    // Checked here as well as server-side so nothing is sent that is going to bounce, and
    // because the confirm field is ours alone: supabase never sees it.
    const policyErr = passwordProblem(pwNext, { email, username: currentUsername })
    if (policyErr) { setPwErr(policyErr); return }
    if (pwNext !== pwConfirm) { setPwErr('Those two passwords do not match.'); return }
    setPwBusy(true); setPwErr('')
    const err = await changePassword(hasPassword ? pwCurrent : null, pwNext)
    setPwBusy(false)
    if (err) { setPwErr(err); return }
    setPwCurrent(''); setPwNext(''); setPwConfirm('')
    setPwDone(true)
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    setDeleteErr('')
    const { error } = await supabase.functions.invoke('delete-account')
    if (error) {
      setDeleting(false)
      setDeleteErr('Something went wrong deleting your account. Please try again.')
      return
    }
    // The account is gone server-side, so sign out locally to match. AuthContext's listener
    // picks up SIGNED_OUT and reloads; we stash the more specific "deleted" toast first so it
    // isn't overwritten by the generic sign-out one.
    sessionStorage.setItem('sdAuthToast', 'deleted')
    await supabase.auth.signOut()
  }

  if (!open) return null

  // The league the reader came from leads inside Notifications; the other follows.
  const leagueRows = signedIn ? [
    <WpblNotificationRows key="wpbl" userId={userId!} push={push} />,
    <MlbNotificationRows key="mlb" userId={userId!} push={push} />,
  ] : []
  if (!isWpbl) leagueRows.reverse()

  // The device's push switch. The reminder switches below it are the account's and follow the
  // reader to every device; this is whether THIS device receives them. Until Nov 12, 2026 it was a
  // "Stop" link shown only while subscribed, which left every reminder reading On after it was
  // pressed and then vanished. The reason push cannot work here is said once, on this row.
  let deviceHint: string | undefined
  if (!push.supported)             deviceHint = 'This browser doesn’t support push notifications.'
  else if (!push.configured)       deviceHint = 'Notifications aren’t set up on this deployment yet.'
  else if (perm === 'denied')      deviceHint = 'Blocked. Turn notifications back on for this site in your browser settings.'

  const toggleDevice = async (next: boolean) => {
    setBusy(true); setDeviceErr('')
    if (next) {
      const error = await enablePush(userId!)
      if (error) setDeviceErr(error)
    } else {
      await disablePush(userId!)
    }
    setSubscribed(await isSubscribed().catch(() => false))
    setPerm(notificationPermission())
    setBusy(false)
  }

  return (
    // ModalShell, not MUI's Dialog: it is what every other modal on the site uses. No DONE button:
    // every control here writes the moment it is touched, and the ✕ in the header is the way out.
    <ModalShell eyebrow="Settings" onClose={onClose} maxWidth={signedIn ? { xs: 460, md: 780 } : 460}>
      {/* One column on a phone and for a signed-out reader; two on a desktop once signed in. The
          left column holds what belongs to the account (who you are, what reaches you, your club);
          the right holds how the site looks and counts, which works signed out too. */}
      <Box sx={{ p: 2, display: 'flex', flexDirection: columns ? 'row' : 'column', gap: 2.5, alignItems: columns ? 'flex-start' : 'stretch' }}>
        <Box sx={columnSx}>
        {signedIn && (
          <Box>
            <SettingsLabel icon={<PersonOutlined />}>Account</SettingsLabel>
            <SettingsCard>
              <Row
                first
                title={currentUsername ? `@${currentUsername}` : (email || 'Set a username')}
                hint={currentUsername && email ? email : undefined}
                onClick={onEditUsername}
                chevron
              />
              {/* An account made through Google has no password until someone sets one, so the
                  row is "Set a password" there and never asks for a current one it could not
                  check. Setting one does not remove the Google button; it adds a second way in,
                  which is the point for anyone who loses access to that Google account. */}
              {!pwOpen ? (
                <Row
                  title={hasPassword ? 'Change password' : 'Set a password'}
                  onClick={() => { setPwOpen(true); setPwDone(false); setPwErr('') }}
                  chevron
                />
              ) : (
                <Box sx={{ p: 1.75, borderTop: '1px solid', borderColor: 'divider' }}>
                  {pwDone ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
                      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'success.main', fontWeight: 700 }}>
                        Password {hasPassword ? 'changed' : 'set'}.
                      </Typography>
                      <Button size="small" onClick={closePasswordForm}>Done</Button>
                    </Box>
                  ) : (
                    <>
                      {hasPassword && (
                        <TextField
                          autoFocus fullWidth size="small" label="Current password" type="password"
                          value={pwCurrent}
                          onChange={e => { setPwCurrent(e.target.value); setPwErr('') }}
                          autoComplete="current-password"
                          sx={{ mb: 1.25 }}
                        />
                      )}
                      <TextField
                        autoFocus={!hasPassword}
                        fullWidth size="small" label="New password" type="password"
                        value={pwNext}
                        onChange={e => { setPwNext(e.target.value); setPwErr('') }}
                        onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                        autoComplete="new-password"
                        sx={{ mb: 0.75 }}
                      />
                      <PasswordChecklist
                        password={pwNext}
                        context={{ email, username: currentUsername }}
                        sx={{ mb: 1.25 }}
                      />
                      <TextField
                        fullWidth size="small" label="Confirm new password" type="password"
                        value={pwConfirm}
                        onChange={e => { setPwConfirm(e.target.value); setPwErr('') }}
                        onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                        autoComplete="new-password"
                        error={pwConfirm.length > 0 && pwConfirm !== pwNext}
                      />
                      {pwErr && (
                        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'error.main', mt: 1, lineHeight: 1.45 }}>
                          {pwErr}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1.25 }}>
                        <Button size="small" onClick={closePasswordForm} disabled={pwBusy}>Cancel</Button>
                        <Button
                          size="small" variant="contained"
                          onClick={handleChangePassword}
                          disabled={pwBusy || !pwNext || !pwConfirm || (hasPassword && !pwCurrent)}
                        >
                          {pwBusy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
                        </Button>
                      </Box>
                    </>
                  )}
                </Box>
              )}
            </SettingsCard>
          </Box>
        )}

        <Box>
          <SettingsLabel icon={<NotificationsNoneOutlined />}>Notifications</SettingsLabel>
          <SettingsCard>
            {signedIn ? (
              <>
                <Row
                  first
                  title="Push on this device"
                  hint={deviceHint}
                  control={
                    <Switch
                      checked={subscribed}
                      disabled={busy || !!deviceHint}
                      onChange={e => toggleDevice(e.target.checked)}
                      slotProps={{ input: { 'aria-label': 'Push notifications on this device' } }}
                    />
                  }
                />
                {deviceErr && <RowError>{deviceErr}</RowError>}
                {leagueRows}
              </>
            ) : (
              // Every reminder is tied to an account (a push subscription is stored against one),
              // which a signed-out reader had no way to learn here: the section simply was not drawn.
              <Row
                first
                title="Sign in for reminders"
                onClick={() => { onClose(); openAuthDialog('signin') }}
                chevron
              />
            )}
          </SettingsCard>
        </Box>

        {signedIn && (
          <Box>
            <SettingsLabel icon={<SportsBaseballOutlined />}>MLB</SettingsLabel>
            <MlbTeamCard userId={userId!} />
          </Box>
        )}
        </Box>

        <Box sx={columnSx}>
        {/* How the site looks and moves. Reduce motion is an explicit override of the OS
            `prefers-reduced-motion` query, which the site still honors as the baseline. */}
        <Box>
          <SettingsLabel icon={<PaletteOutlined />}>Display</SettingsLabel>
          <SettingsCard>
            <Row
              first
              title="Theme"
              control={
                <PillGroup
                  options={[
                    { key: 'light' as ThemePref, label: 'Light' },
                    { key: 'dark' as ThemePref, label: 'Dark' },
                    { key: 'system' as ThemePref, label: 'System' },
                  ]}
                  value={themePref}
                  onChange={setThemePref}
                />
              }
            />
            <Row
              title="Text size"
              control={
                <PillGroup
                  options={[{ key: 'default' as TextScale, label: 'Default' }, { key: 'large' as TextScale, label: 'Large' }]}
                  value={textScale}
                  onChange={setTextScale}
                />
              }
            />
            <Row
              title="Reduce motion"
              control={
                <Switch
                  checked={reduceMotion}
                  onChange={e => setReduceMotion(e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Reduce motion' } }}
                />
              }
            />
            {/* Touch only: there is no swipe to disable on a mouse-only desktop. */}
            {touch && (
              <Row
                title="Swipe between tabs"
                control={
                  <Switch
                    checked={swipeNav}
                    onChange={e => setSwipeNav(e.target.checked)}
                    slotProps={{ input: { 'aria-label': 'Swipe between tabs' } }}
                  />
                }
              />
            )}
            {/* Which section a bare visit to "/" opens on. Titled for what it does: it sat beside a
                WPBL / MLB pill that switched which league's settings showed, and the two read as
                the same control. */}
            <Row
              title="Start page"
              control={
                <PillGroup
                  options={[
                    { key: 'wpbl' as DefaultSection, label: 'WPBL' },
                    { key: 'mlb' as DefaultSection, label: 'MLB' },
                  ]}
                  value={defaultSection}
                  onChange={sec => { setDefaultSection(sec); setDefaultSectionState(sec) }}
                />
              }
            />
          </SettingsCard>
        </Box>

        <Box>
          <SettingsLabel icon={<BarChartOutlined />}>Stats</SettingsLabel>
          <SettingsCard>
            <Row
              first
              title="Measurement units"
              control={
                <PillGroup
                  options={[{ key: 'imperial' as UnitSystem, label: 'Imperial' }, { key: 'metric' as UnitSystem, label: 'Metric' }]}
                  value={units}
                  onChange={setUnits}
                />
              }
            />
            {/* WPBL only in what it changes (MLB's rates arrive from StatsAPI already divided), but
                shown from both sections: it used to appear only when Settings was opened from WPBL,
                so from MLB there was no way to reach it. No hint: since Sep 3, 2026 the default is
                the league's own, and the pills say Per 7 and Per 9, which is the whole of it. */}
            <Row
              title="WPBL ERA basis"
              control={
                <PillGroup
                  options={[{ key: 7 as EraBasis, label: 'Per 7' }, { key: 9 as EraBasis, label: 'Per 9' }]}
                  value={eraBasis}
                  onChange={setEraBasis}
                />
              }
            />
          </SettingsCard>
        </Box>

        <Box>
          <SettingsLabel icon={<ScienceOutlined />}>Labs</SettingsLabel>
          <SettingsCard>
            <Row
              first
              title={
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  Experimental features
                  <InfoDot
                    label="What experimental features are"
                    text="Designs still being worked on. They can change or disappear without notice, and never touch your data."
                  />
                </Box>
              }
              control={
                <Switch
                  checked={experiments}
                  onChange={e => setExperiments(e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Enable experimental features' } }}
                />
              }
            />
          </SettingsCard>
        </Box>

        {signedIn && (
          <Box>
            <SettingsLabel danger icon={<DeleteOutlineOutlined />}>Danger zone</SettingsLabel>
            <SettingsCard danger>
              {!deleteOpen ? (
                <Row
                  first
                  title={<Box component="span" sx={{ color: 'error.main' }}>Delete account</Box>}
                  onClick={() => setDeleteOpen(true)}
                  control={<ChevronRight sx={{ color: 'error.main' }} />}
                />
              ) : (
                <Box sx={{ p: 1.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
                    <WarningAmber sx={{ color: 'error.main', fontSize: ICON_SIZE.md, mt: '1px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.5 }}>
                      This permanently deletes your account, username, followed team/players, predictions, picks and Streak Survivor record. This can't be undone.
                    </Typography>
                  </Box>
                  <TextField
                    fullWidth size="small"
                    label='Type "DELETE" to confirm'
                    value={deleteConfirm}
                    onChange={e => { setDeleteConfirm(e.target.value); setDeleteErr('') }}
                    error={!!deleteErr}
                    helperText={deleteErr || ' '}
                    slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' } }}
                    sx={{ mb: 1 }}
                  />
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => { setDeleteOpen(false); setDeleteConfirm(''); setDeleteErr('') }} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button
                      size="small" variant="contained" color="error"
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirm !== 'DELETE' || deleting}
                    >
                      {deleting ? 'Deleting…' : 'Delete my account'}
                    </Button>
                  </Box>
                </Box>
              )}
            </SettingsCard>
          </Box>
        )}
        </Box>
      </Box>
    </ModalShell>
  )
}
