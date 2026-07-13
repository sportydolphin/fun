import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography, Divider, CircularProgress,
} from '@mui/material'
import { CheckCircle, Cancel } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { usernameValidationMsg, isUsernameTaken } from './lib/usernames'

// Key prefix for stashing a chosen-at-signup username until the account has a
// real session to write it under (email confirmation may gate that) — picked
// up by App.tsx's username-assignment effect once the user is actually signed in.
export const PENDING_USERNAME_PREFIX = 'sdPendingUsername:'

// ─── Dev-only "simulate login" ──────────────────────────────────────────────────
// Lets local development pretend a random user is signed in, so logged-in UI and
// flows can be exercised without real Supabase credentials. Persisted in
// localStorage and surfaced through the same `session`/`user` context values as a
// real login. Everything here is inert in a production build (import.meta.env.DEV).
export const SIMULATED_USER_KEY = 'sdDevSimulatedUser'

const SIM_ADJ  = ['Slugger', 'Curveball', 'Southpaw', 'Bullpen', 'Walkoff', 'Grandslam', 'Rookie', 'Closer', 'Ace', 'Cleanup']
const SIM_NOUN = ['Bomber', 'Rocket', 'Legend', 'Cannon', 'Captain', 'Wizard', 'Hawk', 'Shark', 'Storm', 'Tiger']

interface SimUser { id: string; email: string; fullName: string }

function randomSimUser(): SimUser {
  const a   = SIM_ADJ[Math.floor(Math.random() * SIM_ADJ.length)]
  const n   = SIM_NOUN[Math.floor(Math.random() * SIM_NOUN.length)]
  const num = Math.floor(Math.random() * 900) + 10
  const id  = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sim-${Date.now()}-${num}`
  return { id, email: `${a.toLowerCase()}.${n.toLowerCase()}${num}@example.dev`, fullName: `${a} ${n}` }
}

function buildSimulatedSession(u: SimUser): Session {
  const nowSec = Math.floor(Date.now() / 1000)
  const user = {
    id:            u.id,
    aud:           'authenticated',
    role:          'authenticated',
    email:         u.email,
    app_metadata:  { provider: 'dev-sim', providers: ['dev-sim'] },
    user_metadata: { full_name: u.fullName },
    created_at:    new Date().toISOString(),
  } as unknown as User
  return {
    access_token:  'dev-simulated-token',
    refresh_token: 'dev-simulated-refresh',
    expires_in:    3600,
    expires_at:    nowSec + 3600,
    token_type:    'bearer',
    user,
  } as Session
}

function readSimulatedSession(): Session | null {
  if (!import.meta.env.DEV) return null
  try {
    const raw = localStorage.getItem(SIMULATED_USER_KEY)
    return raw ? buildSimulatedSession(JSON.parse(raw) as SimUser) : null
  } catch { return null }
}

// Invoked from the dev settings menu: mint a random user, persist it, and reload
// so the whole app re-reads auth state as "signed in".
export function simulateDevLogin(): void {
  if (!import.meta.env.DEV) return
  localStorage.setItem(SIMULATED_USER_KEY, JSON.stringify(randomSimUser()))
  sessionStorage.setItem('sdAuthToast', 'in')
  window.location.replace(window.location.pathname)
}

// ─── Error messages ───────────────────────────────────────────────────────────

function friendlyError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid credentials') || m.includes('invalid email or password'))
    return 'Incorrect email or password. Double-check and try again.'
  if (m.includes('email not confirmed'))
    return 'You need to confirm your email first. Check your inbox for the link we sent.'
  if (m.includes('user already registered') || m.includes('already registered') || m.includes('already exists'))
    return 'An account with this email already exists. Try signing in instead.'
  if (m.includes('password') && (m.includes('6 characters') || m.includes('too short') || m.includes('weak')))
    return 'Password must be at least 6 characters.'
  if (m.includes('unable to validate email') || m.includes('invalid format') || m.includes('valid email'))
    return 'Please enter a valid email address.'
  if (m.includes('rate limit') || m.includes('too many request') || m.includes('email rate'))
    return 'Too many attempts — please wait a minute and try again.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
    return 'Connection error. Check your internet and try again.'
  if (m.includes('email link') || m.includes('otp'))
    return 'That link has expired or already been used. Please try signing in again.'
  // Fall back to the raw message if we don't recognise it, but capitalise it properly
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

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

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  session:          Session | null
  user:             User    | null
  loading:          boolean
  signIn:           (email: string, password: string) => Promise<string | null>
  signUp:           (email: string, password: string) => Promise<string | null>
  signOut:          () => Promise<void>
  signInWithGoogle: () => Promise<void>
  openAuthDialog:   (mode?: 'signin' | 'signup') => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSimulatedSession())
  const [loading, setLoading] = useState(() => readSimulatedSession() === null)

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [open,       setOpen]       = useState(false)
  const [mode,       setMode]       = useState<'signin' | 'signup'>('signin')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [username,     setUsernameVal]  = useState('')
  const [usernameStat, setUsernameStat] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [error,      setError]      = useState('')
  const [successMsg, setSuccessMsg] = useState('')  // shown after email sign-up
  const [busy,       setBusy]       = useState(false)
  const usernameDebounceRef = React.useRef<ReturnType<typeof setTimeout>>()

  // ── Auth session ───────────────────────────────────────────────────────────
  useEffect(() => {
    // Dev-only simulated login is active — keep the fake session and never wire up
    // the real Supabase listener (which would immediately overwrite it with null).
    if (readSimulatedSession()) { setLoading(false); return }

    // Tracks the user ID we knew about before the current auth event fires.
    // undefined = not yet initialised (getSession / INITIAL_SESSION hasn't run)
    // null      = confirmed signed-out state
    // string    = confirmed signed-in user id
    // We use this to gate the reload: only reload on SIGNED_IN when we were
    // previously signed OUT. This stops spurious reloads from SIGNED_IN events
    // that Supabase v2 emits during token refresh or alongside INITIAL_SESSION.
    let prevUserId: string | null | undefined = undefined

    supabase.auth.getSession().then(({ data }) => {
      if (prevUserId === undefined) prevUserId = data.session?.user.id ?? null
      setSession(data.session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess)
      if (sess) setOpen(false)

      if (event === 'INITIAL_SESSION') {
        // Seed our knowledge of the pre-sign-in state from the page-load snapshot.
        prevUserId = sess?.user.id ?? null
      } else if (event === 'SIGNED_IN') {
        const wasSignedOut = prevUserId === null  // null = confirmed signed-out
        prevUserId = sess?.user.id ?? null
        if (wasSignedOut) {
          // Genuine transition from signed-out → signed-in. Reload to a clean URL
          // so any OAuth callback params (?code= / #access_token=) are stripped and
          // won't cause Supabase to re-fire SIGNED_IN on the next load.
          sessionStorage.setItem('sdAuthToast', 'in')
          window.location.replace(window.location.pathname)
        }
        // else: prevUserId was a UUID (token refresh) or undefined (too early) → skip
      } else if (event === 'SIGNED_OUT') {
        prevUserId = null
        // Don't clobber a more specific toast (e.g. 'deleted') already staged.
        if (!sessionStorage.getItem('sdAuthToast')) sessionStorage.setItem('sdAuthToast', 'out')
        window.location.replace(window.location.pathname)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Auth callbacks ─────────────────────────────────────────────────────────
  const signIn = useCallback(async (em: string, pw: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    return error ? friendlyError(error.message) : null
  }, [])

  const signUp = useCallback(async (em: string, pw: string): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({ email: em, password: pw })
    return error ? friendlyError(error.message) : null
  }, [])

  const signOut = useCallback(async () => {
    // Clear a simulated dev login without touching real Supabase auth.
    if (import.meta.env.DEV && localStorage.getItem(SIMULATED_USER_KEY)) {
      localStorage.removeItem(SIMULATED_USER_KEY)
      sessionStorage.setItem('sdAuthToast', 'out')
      window.location.replace(window.location.pathname)
      return
    }
    await supabase.auth.signOut()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Use origin + /mlb so it always lands on the right page regardless
      // of what path the user was on when they clicked the button
      options: { redirectTo: `${window.location.origin}/mlb` },
    })
    // Page will redirect to Google — nothing to handle here
  }, [])

  // ── Dialog controls ────────────────────────────────────────────────────────
  const openAuthDialog = useCallback((m: 'signin' | 'signup' = 'signin') => {
    setMode(m); setEmail(''); setPassword(''); setUsernameVal(''); setUsernameStat('idle')
    setError(''); setSuccessMsg('')
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false); setError(''); setSuccessMsg('')
  }, [])

  const switchMode = useCallback(() => {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError(''); setSuccessMsg('')
  }, [])

  const handleUsernameChange = useCallback((val: string) => {
    setUsernameVal(val)
    clearTimeout(usernameDebounceRef.current)
    if (val.length === 0 || usernameValidationMsg(val)) { setUsernameStat('idle'); return }
    setUsernameStat('checking')
    usernameDebounceRef.current = setTimeout(async () => {
      setUsernameStat((await isUsernameTaken(val)) ? 'taken' : 'available')
    }, 450)
  }, [])

  const handleSubmit = useCallback(async () => {
    const em = email.trim()
    if (!em || !password) return

    if (mode === 'signup') {
      const desired = username.trim()
      if (desired) {
        const fmtErr = usernameValidationMsg(desired)
        if (fmtErr) { setError(fmtErr); return }
        if (usernameStat === 'taken') { setError('That username is already taken.'); return }
        if (usernameStat === 'checking') { setError('Still checking that username — one sec.'); return }
      }
    }

    setBusy(true); setError(''); setSuccessMsg('')

    if (mode === 'signin') {
      const err = await signIn(em, password)
      setBusy(false)
      if (err) setError(err)
      // success: onAuthStateChange fires → reload + toast
    } else {
      const { data, error: sbErr } = await supabase.auth.signUp({ email: em, password })
      setBusy(false)
      if (sbErr) {
        setError(friendlyError(sbErr.message))
        return
      }
      // Stash the chosen username (if any) so it can be applied once the
      // account has a real session — App.tsx's assignment effect picks this
      // up immediately (auto-confirm) or after the user confirms their email.
      const desired = username.trim()
      if (desired) localStorage.setItem(`${PENDING_USERNAME_PREFIX}${em.toLowerCase()}`, desired)
      if (!data.session) {
        // Email confirmation required — session is null until they click the link
        setSuccessMsg(`Check your inbox! We sent a confirmation link to ${em}.`)
      }
      // If session exists (auto-confirm enabled), onAuthStateChange reloads the page
    }
  }, [mode, email, password, username, usernameStat, signIn])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut, signInWithGoogle, openAuthDialog }}>
      {children}

      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </DialogTitle>

        <DialogContent sx={{ pt: '8px !important' }}>

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
              <Typography sx={{ fontSize: '2rem', mb: 1.5, lineHeight: 1 }}>📬</Typography>
              <Typography sx={{ fontWeight: 700, mb: 0.75 }}>Almost there!</Typography>
              <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.6 }}>
                {successMsg}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', mt: 1.5, lineHeight: 1.5 }}>
                Click the link in that email, then come back and sign in.
              </Typography>
            </Box>
          ) : (
            <>
              {/* ── Google button ── */}
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

              {/* ── Email / password ── */}
              <TextField
                autoFocus fullWidth label="Email" type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                sx={{ mb: 1.5 }}
              />
              <TextField
                fullWidth label="Password" type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                sx={{ mb: mode === 'signup' ? 1.5 : 0 }}
              />

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
                  onClick={switchMode}
                  sx={{ fontSize: '0.8rem', color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
                >
                  {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
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
              disabled={busy || !email || !password || (
                mode === 'signup' && !!username.trim() &&
                (usernameStat === 'taken' || usernameStat === 'checking' || !!usernameValidationMsg(username))
              )}
            >
              {busy ? 'Loading…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </AuthContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
