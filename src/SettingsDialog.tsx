import React, { useEffect, useState } from 'react'
import { Button, Typography, Box, CircularProgress, TextField, Switch, type SxProps, type Theme } from '@mui/material'
import { ChevronRight, ExpandMore, WarningAmber } from '@mui/icons-material'
import { Team } from './mlb/types'
import { TEAM_BG } from './mlb/constants'
import { useIsDark, teamLogoBg, teamLogoSrc, teamLogoCrop } from './mlb/lib/colorUtils'
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
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './wpbl/reminders'
import { ModalShell, pressable, FOCUS_RING } from './wpbl/ui'
import { useUnits, type UnitSystem } from './UnitsContext'
import { useExperimentsSetting } from './ExperimentsContext'
import { useAccessibilitySettings, type TextScale } from './AccessibilityContext'
import { track, EVENTS } from './lib/analytics'

interface Props {
  open:             boolean
  onClose:          () => void
  // Account fields are absent for signed-out users — the dialog then shows only the
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
// grey slab dropped on top of the page. These four primitives are that language: the same
// bordered card, hairline divider and pill control the rest of the site uses.

function SettingsLabel({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Typography sx={{
      fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
      color: 'text.disabled', mb: 0.75, ...sx,
    }}>
      {children}
    </Typography>
  )
}

function SettingsCard({ children, danger, sx }: { children: React.ReactNode; danger?: boolean; sx?: SxProps<Theme> }) {
  return (
    <Box sx={{
      borderRadius: 2, border: '1px solid',
      borderColor: danger ? 'error.main' : 'divider',
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
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, minWidth: 0 }}>{title}</Typography>
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {control}
          {chevron && <ChevronRight sx={{ color: 'text.disabled' }} />}
        </Box>
      </Box>
      {hint && (
        <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mt: 0.3, lineHeight: 1.45 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  )
}

/** One line under the league switch saying what that league's settings actually cover.
 *
 *  Without it, "Pick reminders" is a dead end for the majority of readers, who arrive from
 *  the WPBL section and have never seen the MLB predictions game. The row named a feature
 *  they had no way to recognise, in a block whose only clue was a three-letter pill. */
const LEAGUE_BLURB: Record<'wpbl' | 'mlb', string> = {
  wpbl: 'Reminders for Women’s Pro Baseball League games.',
  mlb:  'Your club, plus reminders for MLB Predictions, the daily pick-the-winners game.',
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
      display: 'flex', borderRadius: 999, border: '1px solid', borderColor: 'divider',
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
              fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap',
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
      <WarningAmber sx={{ fontSize: '0.95rem', mt: '1px', flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.74rem' }}>{children}</Typography>
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

// ─── WPBL ───────────────────────────────────────────────────────────────────

/**
 * The standing "remind me before every WPBL game" preference
 * (user_preferences.notify_wpbl_all_games), which until now lived ONLY on the next-game card
 * on the WPBL home tab. That is where the intent happens, so the switch stays there too. But
 * it is also the one notification a WPBL-only reader has, and Settings is where anyone goes
 * looking to turn a notification off. Both switches read and write the same preference.
 */
function WpblSection({ userId, push }: { userId: string; push: PushState }) {
  const [on, setOn] = useState(getCachedAllGamesPref())
  const [err, setErr] = useState('')

  useEffect(() => {
    setOn(getCachedAllGamesPref())
    fetchAllGamesPref(userId).then(pref => { if (pref !== null) setOn(pref) })
  }, [userId])

  const toggle = async (next: boolean) => {
    if (push.busy) return
    push.setBusy(true); setErr('')
    const error = await setAllGamesPref(userId, next)
    if (error) {
      // Leave the switch where it was: claiming "on" while nothing can deliver is worse than
      // showing that it failed.
      setErr(error)
    } else {
      setOn(next)
      if (next) push.setSubscribed(true)
      track(next ? EVENTS.WPBL_GAME_REMINDER_ON : EVENTS.WPBL_GAME_REMINDER_OFF,
        { scope: 'all', source: 'settings' }, userId)
    }
    push.setPerm(notificationPermission())
    push.setBusy(false)
  }

  const blocked = !push.supported || !push.configured || push.perm === 'denied'
  let hint: string
  if (!push.supported)          hint = 'This browser doesn’t support push notifications.'
  else if (!push.configured)    hint = 'Notifications aren’t set up on this deployment yet.'
  else if (push.perm === 'denied') hint = 'Blocked. Turn notifications back on for this site in your browser settings.'
  else if (push.busy)           hint = 'Working…'
  else if (on)                  hint = 'On. We’ll ping you before first pitch of every WPBL game.'
  else                          hint = 'Get a heads-up before first pitch of every WPBL game.'

  return (
    <>
      <SettingsCard>
        <Row
          first
          title="Game reminders"
          hint={hint}
          control={
            <Switch
              checked={on}
              disabled={push.busy || blocked}
              onChange={e => toggle(e.target.checked)}
              slotProps={{ input: { 'aria-label': 'WPBL game reminders' } }}
            />
          }
        />
      </SettingsCard>
      {err && <ErrorNote>{err}</ErrorNote>}
    </>
  )
}

// ─── MLB ────────────────────────────────────────────────────────────────────

function MlbSection({ userId, push }: { userId: string; push: PushState }) {
  const isDark = useIsDark()
  const [teams, setTeams] = useState<Team[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamId, setTeamId] = useState<number | null>(null)
  const [playerIds, setPlayerIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Pick reminders (daily "make your picks") and game-start reminders are two independent
  // preferences. They used to share one flag with the push subscription itself, which is what
  // let switching one off delete the subscription the others depend on.
  const [picks, setPicks] = useState(getLocalPickReminderPref())
  const [gsEnabled, setGsEnabled] = useState(false)
  const [gsLead, setGsLead] = useState(getLocalGameStartPref().leadMin)
  const [milestones, setMilestones] = useState(getLocalMilestonePref())
  const [err, setErr] = useState('')

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

    // localStorage paints the right state on the first frame, then the account value confirms
    // or corrects it. The correction is written back to localStorage rather than kept in
    // React state alone, because the bell's picks-ready source reads the local value to
    // decide whether to nudge: leaving it stale means switching the reminder off on one
    // device leaves this one still nudging.
    setPicks(getLocalPickReminderPref())
    loadPickReminderPrefFromSupabase(userId).then(row => {
      if (row !== null) { setPicks(row); setLocalPickReminderPref(row) }
    })

    // Bell-only and device-local, so there is no account value to reconcile against.
    setMilestones(getLocalMilestonePref())

    const local = getLocalGameStartPref()
    setGsEnabled(local.enabled)
    setGsLead(local.leadMin)
    loadGameStartPrefFromSupabase(userId).then(row => {
      if (row) { setGsEnabled(row.enabled); setGsLead(row.leadMin) }
    })
  }, [userId])

  const selectTeam = async (id: number | null) => {
    setTeamId(id)
    setLocalFollowedTeamId(id)
    setSaving(true)
    await savePrefsToSupabase(userId, id, playerIds)
    setSaving(false)
  }

  const persistGameStart = (next: { enabled: boolean; leadMin: number }) => {
    setLocalGameStartPref(next)
    saveGameStartPrefToSupabase(userId, next)
  }

  const togglePicks = async (next: boolean) => {
    if (push.busy) return
    push.setBusy(true); setErr('')
    if (next) {
      // Turning it on still needs a delivery channel, so make sure this device is subscribed.
      // Only record the preference if that succeeded, otherwise the switch would claim to be
      // on while nothing could reach the reader.
      const error = await enablePush(userId)
      if (error) {
        setErr(error)
        push.setSubscribed(await isSubscribed().catch(() => false))
      } else {
        push.setSubscribed(true)
        setPicks(true)
        setLocalPickReminderPref(true)
        await savePickReminderPrefToSupabase(userId, true)
      }
    } else {
      // Turning it off clears the preference and NOTHING else. It deliberately does not
      // unsubscribe: the same subscription carries game-start and WPBL reminders.
      setPicks(false)
      setLocalPickReminderPref(false)
      await savePickReminderPrefToSupabase(userId, false)
    }
    push.setPerm(notificationPermission())
    push.setBusy(false)
  }

  const blocked = !push.supported || !push.configured || push.perm === 'denied'
  let pickHint: string
  if (!push.supported)          pickHint = 'This browser doesn’t support push notifications.'
  else if (!push.configured)    pickHint = 'Notifications aren’t set up on this deployment yet.'
  else if (push.perm === 'denied') pickHint = 'Blocked. Turn notifications back on for this site in your browser settings.'
  else if (push.busy)           pickHint = 'Working…'
  else if (picks)               pickHint = 'On. We’ll remind you to make your predictions before first pitch.'
  else                          pickHint = 'A daily nudge to make your predictions before today’s games lock.'

  const selectedTeam = teams.find(t => t.id === teamId)
  const selectedBg = teamId != null ? (TEAM_BG[teamId] ?? '#444') : undefined
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <SettingsCard>
        {/* Preferred team. It used to carry its own PREFERRED TEAM section header for a
            single row; inside the MLB block the heading is redundant. */}
        <Row
          first
          title="Preferred team"
          hint={saving ? 'Saving…' : 'Synced to your account, so it follows you across devices.'}
          onClick={() => setPickerOpen(o => !o)}
          control={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {selectedTeam && (
                <Box sx={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  bgcolor: teamLogoBg(selectedTeam.id, isDark), border: `2px solid ${selectedBg}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  <Box
                    component="img"
                    src={teamLogoSrc(selectedTeam.id, isDark)}
                    alt=""
                    sx={{ width: 15, height: 15, objectFit: 'contain', transform: teamLogoCrop(selectedTeam.id, isDark), transformOrigin: 'center' }}
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                  />
                </Box>
              )}
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: selectedTeam ? 'text.primary' : 'text.disabled', whiteSpace: 'nowrap' }}>
                {selectedTeam ? selectedTeam.abbreviation : loadingTeams ? 'Loading…' : 'Not set'}
              </Typography>
              <ExpandMore sx={{ color: 'text.disabled', transition: 'transform 0.15s', transform: pickerOpen ? 'rotate(180deg)' : 'none' }} />
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
                          <Box sx={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            bgcolor: teamLogoBg(t.id, isDark), border: `2px solid ${bg}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                          }}>
                            <Box
                              component="img"
                              src={teamLogoSrc(t.id, isDark)}
                              alt=""
                              sx={{ width: 20, height: 20, objectFit: 'contain', transform: teamLogoCrop(t.id, isDark), transformOrigin: 'center' }}
                              onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                            />
                          </Box>
                          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, lineHeight: 1.1, textAlign: 'center' }}>
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
                        fontSize: '0.72rem', fontWeight: 700, color: 'error.main', cursor: 'pointer',
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

        <Row
          title="Prediction reminders"
          hint={pickHint}
          control={
            <Switch
              checked={picks}
              disabled={push.busy || blocked}
              onChange={e => togglePicks(e.target.checked)}
              slotProps={{ input: { 'aria-label': 'MLB prediction reminders' } }}
            />
          }
        />

        <Row
          title="Game start reminders"
          hint={gsEnabled
            ? 'On. We’ll ping you before your preferred team’s next game.'
            : 'A heads-up before your preferred team’s game starts.'}
          control={
            <Switch
              checked={gsEnabled}
              disabled={!push.supported || !push.configured}
              onChange={e => {
                setGsEnabled(e.target.checked)
                persistGameStart({ enabled: e.target.checked, leadMin: gsLead })
              }}
              slotProps={{ input: { 'aria-label': 'MLB game start reminders' } }}
            />
          }
        >
          {gsEnabled && (
            // Was "Remind me [10 min ▾] before first pitch": a sentence with a dropdown
            // wedged into the middle of it, which wrapped onto two lines at 375px and left
            // the control stranded. Four fixed choices are a pill row, not a select.
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 1 }}>
              <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>Lead time</Typography>
              <PillGroup
                options={[5, 10, 15, 30].map(m => ({ key: m, label: `${m}m` }))}
                value={gsLead}
                onChange={m => { setGsLead(m); persistGameStart({ enabled: gsEnabled, leadMin: m }) }}
              />
            </Box>
          )}
        </Row>

        <Row
          title="Milestone alerts"
          hint={milestones
            ? 'On. We’ll flag it in the bell when a player you follow is closing on a milestone.'
            : 'A heads-up when a player you follow nears a milestone.'}
          control={
            <Switch
              checked={milestones}
              // No push permission involved: this one only ever lands in the bell, so it
              // stays usable on a device that has denied or never granted notifications.
              onChange={e => {
                setMilestones(e.target.checked)
                setLocalMilestonePref(e.target.checked)
              }}
              // slotProps.input, not inputProps: MUI v7 dropped the latter on Switch, so the
              // neighbouring rows here render with no accessible name at all. See the note in
              // the settings-toggle test.
              slotProps={{ input: { 'aria-label': 'MLB milestone alerts' } }}
            />
          }
        />
      </SettingsCard>
      {err && <ErrorNote>{err}</ErrorNote>}
    </>
  )
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

type League = 'wpbl' | 'mlb'

export function SettingsDialog({ open, onClose, userId, email, currentUsername, onEditUsername, isWpbl = true }: Props) {
  const signedIn = !!userId

  // Which league's settings are showing. Seeded from the section the reader came from, since
  // whole point of the split is that someone who only follows the WPBL never has to scroll
  // past thirty MLB crests to reach the two switches that apply to them.
  const [league, setLeague] = useState<League>(isWpbl ? 'wpbl' : 'mlb')
  useEffect(() => { if (open) setLeague(isWpbl ? 'wpbl' : 'mlb') }, [open, isWpbl])

  const { units, setUnits } = useUnits()
  const { experiments, setExperiments } = useExperimentsSetting()
  const { swipeNav, setSwipeNav, textScale, setTextScale } = useAccessibilitySettings()

  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

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
    if (pushSupported()) isSubscribed().then(setSubscribed).catch(() => setSubscribed(false))
  }, [open])

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

  return (
    // ModalShell, not MUI's Dialog: it is what every other modal on the site uses, so Settings
    // now shares their card, hairline, backdrop and Esc/click-away behaviour instead of
    // landing as a flat grey slab. It also drops the DialogActions bar and its "DONE" button
    // button, because every control here writes the moment you touch it and a commit-shaped button was
    // promising a step that does not exist. The ✕ in the header is the way out.
    <ModalShell eyebrow="Settings" onClose={onClose} maxWidth={460}>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {signedIn && (
          <Box>
            <SettingsLabel>Account</SettingsLabel>
            <SettingsCard>
              <Row
                first
                title={currentUsername ? `@${currentUsername}` : (email || 'Set a username')}
                hint="Your display name on leaderboards and predictions."
                onClick={onEditUsername}
                chevron
              />
            </SettingsCard>
          </Box>
        )}

        {/* League block. Only signed-in readers have league preferences: a preferred team and
            push reminders both need an account, so signed-out visitors skip straight to the
            app-wide settings and never see a switcher with nothing behind it. */}
        {signedIn && (
          <Box>
            <SettingsLabel>League</SettingsLabel>
            <Box sx={{ mb: 1.25 }}>
              <PillGroup
                fullWidth
                accent="var(--wpbl-accent-solid)"
                options={[{ key: 'wpbl' as League, label: 'WPBL' }, { key: 'mlb' as League, label: 'MLB' }]}
                value={league}
                onChange={l => setLeague(l)}
              />
            </Box>
            <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mb: 1.25, lineHeight: 1.45 }}>
              {LEAGUE_BLURB[league]}
            </Typography>
            {league === 'wpbl'
              ? <WpblSection userId={userId!} push={push} />
              : <MlbSection userId={userId!} push={push} />}
          </Box>
        )}

        {/* Device-level, and deliberately outside both league blocks: one subscription
            delivers every reminder on the site, so switching a single one off must not tear it
            down. This is the only control that does. */}
        {signedIn && subscribed && (
          <Box>
            <SettingsLabel>This device</SettingsLabel>
            <SettingsCard>
              <Row
                first
                title="Stop all push"
                hint="Stops every reminder reaching this browser. Your preferences are kept, so turning any reminder back on re-subscribes it."
                control={
                  <Typography
                    {...pressable(busy ? undefined : async () => {
                      setBusy(true)
                      await disablePush(userId!)
                      setSubscribed(false)
                      setBusy(false)
                    })}
                    sx={{
                      fontSize: '0.78rem', fontWeight: 700, color: 'error.main',
                      cursor: busy ? 'default' : 'pointer', borderRadius: 1, px: 0.5,
                      '&:hover': { textDecoration: busy ? 'none' : 'underline' }, ...FOCUS_RING,
                    }}
                  >
                    {busy ? 'Working…' : 'Stop'}
                  </Typography>
                }
              />
            </SettingsCard>
          </Box>
        )}

        {/* Accessibility. Both of these exist because the browser has no way to ask the
            question for us. What is NOT here, deliberately, is a reduced-motion switch: the
            OS already asks that, and the site honours the answer (see src/styles.css), so
            adding a second one would only mean not believing the first. */}
        <Box>
          <SettingsLabel>Accessibility</SettingsLabel>
          <SettingsCard>
            <Row
              first
              title="Text size"
              hint="Makes type larger without reflowing the layout the way browser zoom does."
              control={
                <PillGroup
                  options={[{ key: 'default' as TextScale, label: 'Default' }, { key: 'large' as TextScale, label: 'Large' }]}
                  value={textScale}
                  onChange={setTextScale}
                />
              }
            />
            <Row
              title="Swipe between tabs"
              hint="Off means tabs change only when you tap them. Useful if a stray drag keeps moving you off the page you were reading."
              control={
                <Switch
                  checked={swipeNav}
                  onChange={e => setSwipeNav(e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Swipe between tabs' } }}
                />
              }
            />
          </SettingsCard>
        </Box>

        <Box>
          <SettingsLabel>App</SettingsLabel>
          <SettingsCard>
            <Row
              first
              title="Measurement units"
              hint="Pitch speeds and distances."
              control={
                <PillGroup
                  options={[{ key: 'imperial' as UnitSystem, label: 'Imperial' }, { key: 'metric' as UnitSystem, label: 'Metric' }]}
                  value={units}
                  onChange={setUnits}
                />
              }
            />
            <Row
              title="Experimental features"
              hint="Try designs that are still being worked on. They may be rough, change without warning, or disappear. Nothing here affects your data."
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
            <SettingsLabel>Danger zone</SettingsLabel>
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
                    <WarningAmber sx={{ color: 'error.main', fontSize: '1.1rem', mt: '1px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.5 }}>
                      This permanently deletes your account, username, followed team/players, and prediction history. This can't be undone.
                    </Typography>
                  </Box>
                  <TextField
                    fullWidth size="small"
                    label='Type "DELETE" to confirm'
                    value={deleteConfirm}
                    onChange={e => { setDeleteConfirm(e.target.value); setDeleteErr('') }}
                    error={!!deleteErr}
                    helperText={deleteErr || ' '}
                    inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
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
    </ModalShell>
  )
}
