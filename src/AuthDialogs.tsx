import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography, Divider, CircularProgress,
} from '@mui/material'
import { CheckCircle, Cancel } from '@mui/icons-material'
import { usernameValidationMsg } from './lib/usernames'
import { PasswordChecklist } from './PasswordChecklist'
import type { AuthMode } from './AuthContext'

// The sign-in, email-confirmed and choose-a-new-password dialogs: markup only.
//
// SPLIT OUT OF AuthContext.tsx SO THEY LOAD WHEN FIRST NEEDED. The provider is in the entry
// chunk, which every visitor downloads before anything draws, and these three dialogs carried
// MUI's whole text-field family with them (TextField, the three input variants, Select, labels
// and helper text: about 40KB minified) for a form most visits never open. Every piece of STATE
// and every handler stayed in AuthProvider, unchanged, so the auth flow itself did not move; this
// file only draws what the provider hands it.

// ─── Google SVG icon ──────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

export interface AuthDialogsProps {
  open: boolean
  mode: AuthMode
  email: string
  password: string
  username: string
  usernameStat: 'idle' | 'checking' | 'available' | 'taken'
  error: string
  successMsg: string
  busy: boolean
  setEmail: (v: string) => void
  setPassword: (v: string) => void
  setError: (v: string) => void
  handleUsernameChange: (v: string) => void
  handleSubmit: () => void
  handleClose: () => void
  switchMode: () => void
  goToMode: (m: AuthMode) => void
  signInWithGoogle: () => void
  confirmed: boolean
  closeConfirmed: () => void
  recovery: boolean
  closeRecovery: () => void
  newPw: string
  newPw2: string
  setNewPw: (v: string) => void
  setNewPw2: (v: string) => void
  recoveryErr: string
  setRecoveryErr: (v: string) => void
  recoveryBusy: boolean
  recoveryDone: boolean
  submitNewPassword: () => void
  sessionEmail: string | null
}

export default function AuthDialogs({
  open, mode, email, password, username, usernameStat, error, successMsg, busy, setEmail, setPassword, setError, handleUsernameChange, handleSubmit, handleClose, switchMode, goToMode, signInWithGoogle, confirmed, closeConfirmed, recovery, closeRecovery, newPw, newPw2, setNewPw, setNewPw2, recoveryErr, setRecoveryErr, recoveryBusy, recoveryDone, submitNewPassword, sessionEmail,
}: AuthDialogsProps) {
  return (
    <>
        {/*
          ABOVE EVERY MODAL THAT CAN SUMMON IT, which MUI's default does not manage.
          A Dialog sits at 1300; `ModalShell` (src/wpbl/ui.tsx) is a plain fixed layer at 1500, and
          its heaviest callers ask for 1600. So sign-in, reached from inside one of those, rendered
          UNDERNEATH the thing that asked for it: the postseason pick'em's "Sign in to make your
          picks" opened a dialog the reader could not see and could not reach, behind a sheet that
          looked unresponsive. 1700 clears the highest shell by the same step those use between
          each other. Any new layer above this has to leave room for the one dialog every surface
          in the app is entitled to open on top of itself.
        */}
        <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth sx={{ zIndex: 1700 }}>
          <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
            {mode === 'reset' ? 'Reset password' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </DialogTitle>

          <DialogContent sx={{ pt: '8px !important' }}>

            {mode === 'reset' && !successMsg && (
              <Box sx={{ mb: 2, px: 1.5, py: 1.25, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1.5 }}>
                  Enter the email you sign in with and we'll send a link that lets you choose a new password.
                </Typography>
              </Box>
            )}

            {/* Context blurb for sign-up prompt */}
            {mode === 'signup' && !successMsg && (
              <Box sx={{ mb: 2, px: 1.5, py: 1.25, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1.5 }}>
                  Save your followed team and players so they sync across all your devices.
                </Typography>
              </Box>
            )}

            {/* ── Success state (email confirmation sent) ── */}
            {successMsg ? (
              <Box sx={{ py: 2, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '2rem', mb: 1.5, lineHeight: 1 }}>{mode === 'reset' ? '🔑' : '📬'}</Typography>
                <Typography sx={{ fontWeight: 700, mb: 0.75 }}>
                  {mode === 'reset' ? 'Check your inbox' : 'Almost there!'}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.6 }}>
                  {successMsg}
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', mt: 1.5, lineHeight: 1.5 }}>
                  {mode === 'reset'
                    ? 'Open it on this device and you can set the new password right here. The link works once, and not for long.'
                    : 'Click the link in that email to activate your account. It signs you in on whichever device you open it.'}
                </Typography>
              </Box>
            ) : (
              <>
                {/* ── Google button ── */}
                {/* Hidden in `reset` mode. Offering "Continue with Google" on a form whose whole
                    purpose is to email a link would read as an alternative way to finish the
                    reset, and it is not: it signs you straight in and leaves the password
                    untouched. */}
                {mode !== 'reset' && (
                  <>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={signInWithGoogle}
                      startIcon={<GoogleIcon />}
                      sx={{
                        mb: 2, py: 1, borderColor: 'divider', color: 'text.primary',
                        textTransform: 'none', fontWeight: 600, fontSize: '0.9rem',
                        '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' },
                      }}
                    >
                      Continue with Google
                    </Button>

                    <Divider sx={{ mb: 2 }}>
                      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 1 }}>or</Typography>
                    </Divider>
                  </>
                )}

                {/* ── Email / password ── */}
                <TextField
                  autoFocus fullWidth label="Email" type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  sx={{ mb: 1.5 }}
                />
                {mode !== 'reset' && (
                  <TextField
                    fullWidth label="Password" type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    sx={{ mb: mode === 'signup' ? 1 : 0 }}
                  />
                )}

                {/* Only where a password is being CHOSEN. On the sign-in form the rules are none
                    of the reader's business: their existing password is whatever it is, and
                    listing today's requirements next to it would read as an accusation. */}
                {mode === 'signup' && (
                  <PasswordChecklist
                    password={password}
                    context={{ email: email.trim() || null, username: username.trim() || null }}
                    sx={{ mb: 1.5 }}
                  />
                )}

                {/* Under the password field, right where the failure happens, and carrying the
                    email already typed so the next screen is one tap rather than a retype. */}
                {mode === 'signin' && (
                  <Box sx={{ mt: 0.75, textAlign: 'right' }}>
                    <Typography
                      component="span"
                      onClick={() => goToMode('reset')}
                      sx={{ fontSize: '0.78rem', color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
                    >
                      Forgot password?
                    </Typography>
                  </Box>
                )}

                {mode === 'signup' && (
                  <TextField
                    fullWidth label="Username (optional)"
                    value={username}
                    onChange={e => { handleUsernameChange(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
                    InputProps={{
                      startAdornment: (
                        <Typography sx={{ color: 'text.disabled', mr: 0.25, fontSize: '1rem', lineHeight: 1, userSelect: 'none' }}>@</Typography>
                      ),
                    }}
                    error={usernameStat === 'taken' || !!usernameValidationMsg(username)}
                    helperText={
                      usernameValidationMsg(username) ? usernameValidationMsg(username)
                      : usernameStat === 'checking' ? (
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                          <CircularProgress size={10} /> Checking…
                        </Box>
                      ) : usernameStat === 'available' ? (
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
                          <CheckCircle sx={{ fontSize: '0.85rem' }} /> Available
                        </Box>
                      ) : usernameStat === 'taken' ? (
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'error.main' }}>
                          <Cancel sx={{ fontSize: '0.85rem' }} /> Already taken
                        </Box>
                      ) : "Leave blank and we'll pick one for you"
                    }
                    FormHelperTextProps={{ component: 'div' } as object}
                  />
                )}

                {error && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, color: 'error.main' }}>
                    <Box component="span" sx={{ flexShrink: 0, mt: '1px' }}>⚠️</Box>
                    <Typography sx={{ fontSize: '0.78rem' }}>{error}</Typography>
                  </Box>
                )}

                <Box sx={{ mt: 1.5, textAlign: 'center' }}>
                  <Typography
                    component="span"
                    onClick={mode === 'reset' ? () => goToMode('signin') : switchMode}
                    sx={{ fontSize: '0.8rem', color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
                  >
                    {mode === 'reset' ? 'Back to sign in'
                      : mode === 'signin' ? "Don't have an account? Sign up"
                      : 'Already have an account? Sign in'}
                  </Typography>
                </Box>
              </>
            )}
          </DialogContent>

          <DialogActions>
            <Button onClick={handleClose}>
              {mode === 'signup' && !successMsg ? 'Maybe Later' : 'Close'}
            </Button>
            {!successMsg && (
              <Button
                onClick={handleSubmit}
                variant="contained"
                disabled={busy || !email || (mode !== 'reset' && !password) || (
                  mode === 'signup' && !!username.trim() &&
                  (usernameStat === 'taken' || usernameStat === 'checking' || !!usernameValidationMsg(username))
                )}
              >
                {busy ? 'Loading…'
                  : mode === 'reset' ? 'Send reset link'
                  : mode === 'signin' ? 'Sign In' : 'Create Account'}
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* ── Email confirmed ────────────────────────────────────────────────────
            The whole point of a confirmation link is that it reports back, and until this it
            reported nothing: the link worked, the account was activated, the session was saved,
            and the page looked identical to any other visit. Small and dismissible, because
            there is nothing to decide here, only something to be told. */}
        <Dialog open={confirmed} onClose={closeConfirmed} maxWidth="xs" fullWidth>
          <DialogContent sx={{ pt: '24px !important' }}>
            <Box sx={{ py: 1, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '2.5rem', mb: 1, lineHeight: 1 }}>✅</Typography>
              <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', mb: 0.75 }}>Email confirmed</Typography>
              <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.6 }}>
                Your account is active and you're signed in on this device.
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeConfirmed} variant="contained" fullWidth sx={{ mx: 1, mb: 1 }}>
              Get started
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Choose a new password ──────────────────────────────────────────────
            Opened by the PASSWORD_RECOVERY event, which means the link in the email has already
            been redeemed and the reader is signed in on this device. Dismissible on purpose: at
            this point the account still has its OLD password and nothing is half-written, so
            closing is a real answer rather than an abandoned transaction. It costs another email
            to come back, which is why the copy says so rather than letting them find out. */}
        <Dialog open={recovery} onClose={closeRecovery} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
            {recoveryDone ? 'Password updated' : 'Choose a new password'}
          </DialogTitle>

          <DialogContent sx={{ pt: '8px !important' }}>
            {recoveryDone ? (
              <Box sx={{ py: 2, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '2rem', mb: 1.5, lineHeight: 1 }}>✅</Typography>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.6 }}>
                  You're signed in on this device, and that's the password to use from now on.
                </Typography>
              </Box>
            ) : (
              <>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 2, lineHeight: 1.5 }}>
                  That link signed you in. Set a password now and it's the one you'll use from here
                  on. Close this and your old password still works, but you'll need a fresh link to
                  try again.
                </Typography>
                <TextField
                  autoFocus fullWidth label="New password" type="password"
                  value={newPw}
                  onChange={e => { setNewPw(e.target.value); setRecoveryErr('') }}
                  onKeyDown={e => e.key === 'Enter' && submitNewPassword()}
                  autoComplete="new-password"
                  sx={{ mb: 1 }}
                />
                <PasswordChecklist
                  password={newPw}
                  context={{ email: sessionEmail }}
                  sx={{ mb: 1.5 }}
                />
                <TextField
                  fullWidth label="Confirm new password" type="password"
                  value={newPw2}
                  onChange={e => { setNewPw2(e.target.value); setRecoveryErr('') }}
                  onKeyDown={e => e.key === 'Enter' && submitNewPassword()}
                  autoComplete="new-password"
                  error={newPw2.length > 0 && newPw2 !== newPw}
                />
                {recoveryErr && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 1, color: 'error.main' }}>
                    <Box component="span" sx={{ flexShrink: 0, mt: '1px' }}>⚠️</Box>
                    <Typography sx={{ fontSize: '0.78rem' }}>{recoveryErr}</Typography>
                  </Box>
                )}
              </>
            )}
          </DialogContent>

          <DialogActions>
            <Button onClick={closeRecovery}>{recoveryDone ? 'Done' : 'Not now'}</Button>
            {!recoveryDone && (
              <Button
                onClick={submitNewPassword}
                variant="contained"
                disabled={recoveryBusy || !newPw || !newPw2}
              >
                {recoveryBusy ? 'Saving…' : 'Save password'}
              </Button>
            )}
          </DialogActions>
        </Dialog>
    </>
  )
}
