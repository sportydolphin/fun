import React, { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, CircularProgress, IconButton, TextField, Switch,
  Select, MenuItem,
} from '@mui/material'
import { Close, ChevronRight, ExpandMore, WarningAmber } from '@mui/icons-material'
import { Team } from './mlb/types'
import { TEAM_BG, ACCENT } from './mlb/constants'
import { useIsDark, teamLogoBg, teamLogoSrc, teamLogoCrop } from './mlb/lib/colorUtils'
import { fetchAllTeams } from './mlb/api'
import { supabase } from './lib/supabase'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
  getLocalGameStartPref, setLocalGameStartPref,
  loadGameStartPrefFromSupabase, saveGameStartPrefToSupabase,
} from './mlb/storage/prefs'
import {
  pushSupported, pushConfigured, notificationPermission,
  isSubscribed, enablePush, disablePush,
} from './lib/push'
import { useUnits, type UnitSystem } from './UnitsContext'
import { useExperimentsSetting } from './ExperimentsContext'

interface Props {
  open:             boolean
  onClose:          () => void
  // Account fields are absent for signed-out users — the dialog then shows only the
  // universal (account-independent) settings like units.
  userId?:          string | null
  email?:           string
  currentUsername?: string | null
  onEditUsername?:  () => void   // closes Settings and opens the username dialog
}

// ─── Units section (everyone) ───────────────────────────────────────────────
// Imperial ↔ metric, stored locally so signed-out visitors get it too. Reads/writes
// the shared UnitsContext; call sites convert their own values off `units`.
function UnitsSection() {
  const { units, setUnits } = useUnits()
  const options: { key: UnitSystem; label: string }[] = [
    { key: 'imperial', label: 'Imperial' },
    { key: 'metric',   label: 'Metric' },
  ]
  return (
    <>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
        Units
      </Typography>
      <Box sx={{ mb: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>Measurement units</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexShrink: 0, borderRadius: 999, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            {options.map(o => {
              const active = units === o.key
              return (
                <Box
                  key={o.key}
                  onClick={() => setUnits(o.key)}
                  sx={{
                    px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                    fontSize: '0.75rem', fontWeight: 700,
                    bgcolor: active ? ACCENT : 'transparent',
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
        </Box>
      </Box>
    </>
  )
}

function ExperimentsSection() {
  const { experiments, setExperiments } = useExperimentsSetting()
  return (
    <>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
        Experimental
      </Typography>
      <Box sx={{ mb: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>Experimental features</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', lineHeight: 1.35 }}>
              Try designs that are still being worked on. They may be rough, change without
              warning, or disappear. Nothing here affects your data.
            </Typography>
          </Box>
          <Switch
            checked={experiments}
            onChange={e => setExperiments(e.target.checked)}
            inputProps={{ 'aria-label': 'Enable experimental features' }}
          />
        </Box>
      </Box>
    </>
  )
}

// ─── Notifications section ──────────────────────────────────────────────────
// Opt-in toggle for daily "make your picks" push reminders. Being subscribed in
// this browser IS the opt-in — there's no separate preference to store.

function NotificationsSection({ open, userId }: { open: boolean; userId: string }) {
  const supported  = pushSupported()
  const configured = pushConfigured()
  const [enabled, setEnabled] = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [perm,    setPerm]    = useState<ReturnType<typeof notificationPermission>>('default')
  const [err,     setErr]     = useState('')

  // Game-start reminder opt-in + lead time (its own preference, independent of
  // the daily pick reminders above).
  const [gsEnabled, setGsEnabled] = useState(false)
  const [gsLead,    setGsLead]    = useState(getLocalGameStartPref().leadMin)

  // Reflect the actual subscription state each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setErr('')
    setPerm(notificationPermission())
    if (supported) isSubscribed().then(setEnabled).catch(() => setEnabled(false))
  }, [open, supported])

  // Load the game-start preference: localStorage first (instant), then let the
  // synced account value win if it differs.
  useEffect(() => {
    if (!open) return
    const local = getLocalGameStartPref()
    setGsEnabled(local.enabled)
    setGsLead(local.leadMin)
    loadGameStartPrefFromSupabase(userId).then(row => {
      if (row) { setGsEnabled(row.enabled); setGsLead(row.leadMin) }
    })
  }, [open, userId])

  const persistGameStart = (next: { enabled: boolean; leadMin: number }) => {
    setLocalGameStartPref(next)
    saveGameStartPrefToSupabase(userId, next)
  }
  const handleGsToggle = (next: boolean) => { setGsEnabled(next); persistGameStart({ enabled: next, leadMin: gsLead }) }
  const handleGsLead   = (next: number)  => { setGsLead(next);    persistGameStart({ enabled: gsEnabled, leadMin: next }) }

  const handleToggle = async (next: boolean) => {
    if (busy) return
    setBusy(true); setErr('')
    const error = next ? await enablePush(userId) : await disablePush(userId)
    if (error) {
      setErr(error)
      setEnabled(await isSubscribed().catch(() => false))
    } else {
      setEnabled(next)
    }
    setPerm(notificationPermission())
    setBusy(false)
  }

  const disabled = busy || !supported || !configured || perm === 'denied'

  let hint: string
  if (!supported)            hint = 'This browser doesn’t support push notifications.'
  else if (!configured)      hint = 'Notifications aren’t set up on this deployment yet.'
  else if (perm === 'denied') hint = 'Blocked. Turn notifications back on for this site in your browser settings.'
  else if (enabled)          hint = 'On. We’ll remind you to make your picks before first pitch.'
  else                       hint = 'Get a daily nudge to pick today’s games before they lock.'

  return (
    <>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mt: 3, mb: 0.75 }}>
        Notifications
      </Typography>
      <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>Daily pick reminders</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25, lineHeight: 1.4 }}>
              {busy ? 'Working…' : hint}
            </Typography>
          </Box>
          <Switch
            checked={enabled}
            disabled={disabled}
            onChange={e => handleToggle(e.target.checked)}
            sx={{ flexShrink: 0 }}
          />
        </Box>

        {/* Game-start reminder — its own opt-in + lead time. */}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.75, py: 1.1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>Game start reminders</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25, lineHeight: 1.4 }}>
                {gsEnabled
                  ? 'On. We’ll ping you before your team’s next game.'
                  : 'Get a heads-up before your followed team’s game starts.'}
              </Typography>
            </Box>
            <Switch
              checked={gsEnabled}
              disabled={!supported || !configured}
              onChange={e => handleGsToggle(e.target.checked)}
              sx={{ flexShrink: 0 }}
            />
          </Box>

          {gsEnabled && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25 }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>Remind me</Typography>
              <Select
                size="small"
                value={gsLead}
                onChange={e => handleGsLead(Number(e.target.value))}
                sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.4 } }}
              >
                {[5, 10, 15, 30].map(m => (
                  <MenuItem key={m} value={m} sx={{ fontSize: '0.8rem' }}>{m} min</MenuItem>
                ))}
              </Select>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>before first pitch</Typography>
            </Box>
          )}
        </Box>
      </Box>
      {err && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.75, color: 'error.main' }}>
          <Box component="span" sx={{ flexShrink: 0, mt: '1px', fontSize: '0.8rem' }}>⚠️</Box>
          <Typography sx={{ fontSize: '0.74rem' }}>{err}</Typography>
        </Box>
      )}
    </>
  )
}

export function SettingsDialog({ open, onClose, userId, email, currentUsername, onEditUsername }: Props) {
  const signedIn = !!userId
  const [teams, setTeams]     = useState<Team[]>([])
  const [deleteOpen,   setDeleteOpen]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting,     setDeleting]     = useState(false)
  const [deleteErr,    setDeleteErr]    = useState('')
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamId, setTeamId]   = useState<number | null>(null)
  const [playerIds, setPlayerIds] = useState<number[]>([])
  const [saving, setSaving]   = useState(false)
  const [teamPickerOpen, setTeamPickerOpen] = useState(false)
  const isDark = useIsDark()

  // Load team list + current preference whenever the dialog opens. Account-scoped, so
  // it's skipped entirely for signed-out visitors (who only see the universal settings).
  useEffect(() => {
    if (!open || !userId) return
    setTeamPickerOpen(false)
    setDeleteOpen(false); setDeleteConfirm(''); setDeleteErr(''); setDeleting(false)
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
  }, [open, userId])

  const selectTeam = async (id: number | null) => {
    setTeamId(id)
    setLocalFollowedTeamId(id)
    setSaving(true)
    await savePrefsToSupabase(userId!, id, playerIds)
    setSaving(false)
  }

  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  const handleDeleteAccount = async () => {
    setDeleting(true)
    setDeleteErr('')
    const { error } = await supabase.functions.invoke('delete-account')
    if (error) {
      setDeleting(false)
      setDeleteErr('Something went wrong deleting your account. Please try again.')
      return
    }
    // The account is gone server-side — sign out locally to match. AuthContext's
    // listener picks up SIGNED_OUT and reloads; we stash the more specific
    // "deleted" toast first so it isn't overwritten by the generic sign-out one.
    sessionStorage.setItem('sdAuthToast', 'deleted')
    await supabase.auth.signOut()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Settings
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '8px !important' }}>
        {/* Units — shown to everyone, signed in or not */}
        <UnitsSection />

        <ExperimentsSection />

        {signedIn && (
        <>
        {/* Account */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
          Account
        </Typography>
        <Box sx={{ mb: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box
            onClick={onEditUsername}
            sx={{
              px: 1.75, py: 1.1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>Username</Typography>
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUsername ? `@${currentUsername}` : email}
              </Typography>
            </Box>
            <ChevronRight sx={{ color: 'text.disabled', flexShrink: 0 }} />
          </Box>
        </Box>

        {/* Preferred team */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
          Preferred Team
        </Typography>
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {(() => {
            const selectedTeam = teams.find(t => t.id === teamId)
            const bg = teamId != null ? (TEAM_BG[teamId] ?? '#444') : undefined
            return (
              <Box
                onClick={() => setTeamPickerOpen(o => !o)}
                sx={{
                  px: 1.75, py: 1.1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {selectedTeam ? (
                    <Box sx={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      bgcolor: teamLogoBg(selectedTeam.id, isDark), border: `2px solid ${bg}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      <Box
                        component="img"
                        src={teamLogoSrc(selectedTeam.id, isDark)}
                        alt={selectedTeam.abbreviation}
                        sx={{ width: 17, height: 17, objectFit: 'contain', transform: teamLogoCrop(selectedTeam.id, isDark), transformOrigin: 'center' }}
                        onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                      />
                    </Box>
                  ) : null}
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedTeam ? selectedTeam.name : loadingTeams ? 'Loading…' : 'Not set'}
                  </Typography>
                </Box>
                <ExpandMore sx={{ color: 'text.disabled', flexShrink: 0, transition: 'transform 0.15s', transform: teamPickerOpen ? 'rotate(180deg)' : 'none' }} />
              </Box>
            )
          })()}

          {teamPickerOpen && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
              {loadingTeams ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <>
                  <Box sx={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: 0.5,
                    maxHeight: 168, overflowY: 'auto', pr: 0.5,
                  }}>
                    {sortedTeams.map(t => {
                      const bg = TEAM_BG[t.id] ?? '#444'
                      const selected = teamId === t.id
                      return (
                        <Box
                          key={t.id}
                          onClick={() => selectTeam(t.id)}
                          sx={{
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
                              alt={t.abbreviation}
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
                      onClick={() => selectTeam(null)}
                      sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'error.main', cursor: 'pointer', mt: 1, '&:hover': { textDecoration: 'underline' } }}
                    >
                      Clear preferred team
                    </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 1 }}>
          {saving ? 'Saving…' : 'Synced to your account, so it follows you across devices.'}
        </Typography>

        {/* Notifications */}
        <NotificationsSection open={open} userId={userId} />

        {/* Danger zone */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mt: 3, mb: 0.75 }}>
          Danger Zone
        </Typography>
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'error.main', overflow: 'hidden' }}>
          {!deleteOpen ? (
            <Box
              onClick={() => setDeleteOpen(true)}
              sx={{
                px: 1.75, py: 1.1, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: 'error.main' }}>
                Delete account
              </Typography>
              <ChevronRight sx={{ color: 'error.main', flexShrink: 0 }} />
            </Box>
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
        </Box>
        </>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{ bgcolor: ACCENT, color: '#fff', '&:hover': { bgcolor: ACCENT, filter: 'brightness(0.92)' } }}
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
