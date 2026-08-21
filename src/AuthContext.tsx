import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography, Divider, CircularProgress,
} from '@mui/material'
import { CheckCircle, Cancel } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { usernameValidationMsg, isUsernameTaken } from './lib/usernames'
import { passwordProblem } from './lib/passwordPolicy'
import { PasswordChecklist } from './PasswordChecklist'

// Key prefix for stashing a chosen-at-signup username until the account has a
// real session to write it under (email confirmation may gate that) — picked
// up by App.tsx's username-assignment effect once the user is actually signed in.
export const PENDING_USERNAME_PREFIX = 'sdPendingUsername:'

// ─── Post-auth return location ──────────────────────────────────────────────────
// Where to land the user after they sign in / create an account: the page they were
// on when they started, not a hardcoded home. Sign-in triggers a reload (to a clean
// URL), and Google OAuth navigates away and back, so we stash the intended return
// path in sessionStorage (survives both) and restore it once SIGNED_IN fires.
const AUTH_RETURN_KEY = 'sdAuthReturn'

// Current path + query with any auth-callback params stripped, so we never store or
// replace to a URL that would re-trigger Supabase's code exchange on the next load.
function cleanPathAndQuery(href: string): string {
  try {
    const url = new URL(href)
    for (const p of [
      'code', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
      'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description',
    ]) url.searchParams.delete(p)
    return `${url.pathname}${url.search}`
  } catch {
    return window.location.pathname
  }
}

function stashAuthReturn(): void {
  try { sessionStorage.setItem(AUTH_RETURN_KEY, cleanPathAndQuery(window.location.href)) } catch { /* storage off — fall back to pathname */ }
}

// Read-and-clear the stashed return path (one-shot, so a later reload doesn't reuse it).
function takeAuthReturn(): string | null {
  try {
    const v = sessionStorage.getItem(AUTH_RETURN_KEY)
    if (v) sessionStorage.removeItem(AUTH_RETURN_KEY)
    return v
  } catch { return null }
}

// ─── What kind of link brought us here ──────────────────────────────────────────
// Read ONCE, at module scope, and this is the only place it can be read from.
//
// The supabase client is constructed when `./lib/supabase` is imported, one line above this
// file's own body, and it immediately starts an async initialize that consumes the callback
// fragment and then wipes it off the URL. By the time React has mounted and any component
// could ask, `window.location.hash` is empty. Evaluating this during import wins that race by
// construction: the wipe cannot happen until a network round trip inside initialize resolves,
// and nothing here awaits anything.
//
// 'signup' = a confirmation link, 'recovery' = a password-reset link. Both arrive in the
// fragment because the client runs the default `implicit` flow.
function readUrlAuthType(): string | null {
  try {
    const raw = window.location.hash.replace(/^#/, '')
    if (!raw.includes('type=')) return null
    return new URLSearchParams(raw).get('type')
  } catch { return null }
}
const URL_AUTH_TYPE = readUrlAuthType()

// ─── Expired / reused link ──────────────────────────────────────────────────────
// A recovery link that has already been used, or has aged out, comes back as an error in the
// URL fragment instead of a session: `#error=access_denied&error_code=otp_expired&...`. The
// supabase client clears that fragment only on the SUCCESS path, so on failure it is still
// sitting there for us to read, and without this the page simply loads signed-out with no
// explanation and the reader has no idea the link was the problem.
//
// Guarded on the fragment carrying an error, which is what makes it safe to run alongside the
// client's own fragment handling: a successful callback carries `access_token`, never `error`,
// so this can never race away the tokens the client is about to consume.
function takeUrlAuthError(): string | null {
  try {
    const raw = window.location.hash.replace(/^#/, '')
    if (!raw.includes('error')) return null
    const p = new URLSearchParams(raw)
    const code = p.get('error_code'), desc = p.get('error_description')
    if (!p.get('error') && !code) return null
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    if (code === 'otp_expired' || (desc ?? '').toLowerCase().includes('expired'))
      return 'That link has expired or has already been used. Send yourself a fresh one.'
    return desc || 'That link could not be used. Please try again.'
  } catch { return null }
}

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
  window.location.replace(cleanPathAndQuery(window.location.href))
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
    return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
    return 'Connection error. Check your internet and try again.'
  if (m.includes('should be different from the old password') || m.includes('same as the old'))
    return 'That is already your password. Pick a different one.'
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
  /** Emails a link that lands back here and opens the set-a-new-password dialog. Resolves to
   *  an error string, or null on success, where "success" only means the request was
   *  accepted, never that the address has an account. See the call site. */
  resetPassword:    (email: string) => Promise<string | null>
  /** Change the password of the account that is already signed in. `current` is checked first
   *  and must be null only for an account that has no password yet (see `hasPassword`).
   *  Resolves to an error string, or null on success. */
  changePassword:   (current: string | null, next: string) => Promise<string | null>
  /** Whether this account can be signed into with a password at all. False for one created
   *  through Google and never given one, where there is no current password to ask for and the
   *  operation is "set" rather than "change". */
  hasPassword:      boolean
  openAuthDialog:   (mode?: AuthMode) => void
}

/** `reset` is the request half of a password reset (email in, link out). Choosing the new
 *  password happens in its own dialog, off the recovery link, not as a fourth mode here. */
type AuthMode = 'signin' | 'signup' | 'reset'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSimulatedSession())
  const [loading, setLoading] = useState(() => readSimulatedSession() === null)

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [open,       setOpen]       = useState(false)
  const [mode,       setMode]       = useState<AuthMode>('signin')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [username,     setUsernameVal]  = useState('')
  const [usernameStat, setUsernameStat] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [error,      setError]      = useState('')
  const [successMsg, setSuccessMsg] = useState('')  // shown after email sign-up
  const [busy,       setBusy]       = useState(false)
  const usernameDebounceRef = React.useRef<ReturnType<typeof setTimeout>>()

  // ── Set-a-new-password dialog ──────────────────────────────────────────────
  // Its own dialog rather than a fourth mode of the one above, because it is reached from a
  // different place entirely: not a button anyone pressed, but a link opened from an inbox,
  // possibly days later, on a device that was never signed in.
  const [recovery,     setRecovery]     = useState(false)
  const [newPw,        setNewPw]        = useState('')
  const [newPw2,       setNewPw2]       = useState('')
  const [recoveryErr,  setRecoveryErr]  = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryDone, setRecoveryDone] = useState(false)

  // Shown after a confirmation link. Needed because nothing else on the page reacts to one:
  // see the effect below for why the sign-in toast never fires for a confirmation.
  const [confirmed, setConfirmed] = useState(false)

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
          // won't cause Supabase to re-fire SIGNED_IN on the next load — landing back
          // on the page the user started from (stashed pre-auth), not a hardcoded home.
          sessionStorage.setItem('sdAuthToast', 'in')
          window.location.replace(takeAuthReturn() ?? cleanPathAndQuery(window.location.href))
        }
        // else: prevUserId was a UUID (token refresh) or undefined (too early) → skip
      } else if (event === 'PASSWORD_RECOVERY') {
        // A recovery link is a real sign-in: supabase saves the session and emits this event
        // INSTEAD OF 'SIGNED_IN', which is the only reason the reload above does not fire and
        // throw the reader back out of the flow. Record the id anyway, so a later token
        // refresh that does emit SIGNED_IN cannot be mistaken for a fresh login and reload the
        // page out from under a half-typed password.
        prevUserId = sess?.user.id ?? null
        setNewPw(''); setNewPw2(''); setRecoveryErr(''); setRecoveryDone(false)
        setRecovery(true)
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
    stashAuthReturn()  // remember where we are, so the post-sign-in reload returns here
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    return error ? friendlyError(error.message) : null
  }, [])

  const signUp = useCallback(async (em: string, pw: string): Promise<string | null> => {
    stashAuthReturn()
    const { error } = await supabase.auth.signUp({
      email: em,
      password: pw,
      // If confirmation is required, the emailed link returns to this same page.
      options: { emailRedirectTo: `${window.location.origin}${cleanPathAndQuery(window.location.href)}` },
    })
    return error ? friendlyError(error.message) : null
  }, [])

  const resetPassword = useCallback(async (em: string): Promise<string | null> => {
    // No stashAuthReturn: unlike sign-in there is no reload to come back from. The link is
    // opened later, from an inbox, as a fresh page load, so the only thing that decides where
    // it lands is this redirect, and it points at the page the reset was asked for from.
    const { error } = await supabase.auth.resetPasswordForEmail(em, {
      redirectTo: `${window.location.origin}${cleanPathAndQuery(window.location.href)}`,
    })
    return error ? friendlyError(error.message) : null
  }, [])

  const changePassword = useCallback(async (current: string | null, next: string): Promise<string | null> => {
    const em = session?.user.email
    if (!em) return 'You need to be signed in to change your password.'

    // Verify the current password by signing in with it, rather than trusting the open session.
    // supabase does not require the old password to set a new one, which means a session left
    // open on a shared machine is enough for someone else to change the password and lock the
    // owner out of their own account. This closes that, and it costs one request.
    //
    // Skipped only for an account that has no password to prove: a Google sign-up setting one
    // for the first time has nothing to check it against.
    if (current !== null) {
      const { error } = await supabase.auth.signInWithPassword({ email: em, password: current })
      // Deliberately not `friendlyError`, whose wording for this case ("Incorrect email or
      // password") names a field this form does not have.
      if (error) return 'That is not your current password.'
    }

    const { error } = await supabase.auth.updateUser({ password: next })
    return error ? friendlyError(error.message) : null
  }, [session])

  const submitNewPassword = useCallback(async () => {
    // Checked here as well as server-side so the reader is told before a round trip, and
    // because the confirm field is ours alone: supabase never sees it.
    const pwErr = passwordProblem(newPw, { email: session?.user.email ?? null })
    if (pwErr) { setRecoveryErr(pwErr); return }
    if (newPw !== newPw2) { setRecoveryErr('Those two passwords do not match.'); return }
    setRecoveryBusy(true); setRecoveryErr('')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setRecoveryBusy(false)
    if (error) { setRecoveryErr(friendlyError(error.message)); return }
    // Drop both copies out of component state the moment they are no longer needed.
    setNewPw(''); setNewPw2('')
    setRecoveryDone(true)
  }, [newPw, newPw2, session])

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
    // Return to the page the user was on, not a hardcoded /mlb. We stash it (survives
    // the round trip to Google) and also pass it as redirectTo; the SIGNED_IN handler
    // strips the ?code= Supabase appends. Stash is the source of truth on the way back.
    stashAuthReturn()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${cleanPathAndQuery(window.location.href)}` },
    })
    // Page will redirect to Google — nothing to handle here
  }, [])

  // A dead recovery link would otherwise land as an ordinary signed-out page load, with the
  // reader left to guess why nothing happened. Opened straight into `reset` mode, since asking
  // for another link is the only thing they can usefully do next.
  useEffect(() => {
    const msg = takeUrlAuthError()
    if (!msg) return
    setMode('reset'); setEmail(''); setPassword(''); setSuccessMsg('')
    setError(msg)
    setOpen(true)
  }, [])

  // ── What a confirmation or recovery link should actually show ──────────────
  //
  // Both link types are consumed by the supabase client during its own async start-up, and
  // both were originally driven off the events it emits when that finishes. Neither event is
  // reliable, for two different reasons, and the fix for both is the same: ask `getSession()`,
  // which awaits the very initialize that processes the link, so it cannot resolve too early
  // and cannot be missed.
  //
  //   PASSWORD_RECOVERY is announced from a setTimeout inside initialize, once, to whoever is
  //   subscribed at that instant, and it is never replayed. Whether this provider has mounted
  //   and subscribed by then is a race against a single network round trip. Lose it and the
  //   reset link silently does nothing at all, which is exactly what it looks like.
  //
  //   SIGNED_IN does fire for a confirmation link, but the reload-and-toast below is gated on
  //   having been *confirmed signed out* first, and it never is: INITIAL_SESSION is emitted on
  //   a microtask after initialize while SIGNED_IN waits for a macrotask, so the session is
  //   already known by the time SIGNED_IN lands. Confirming your email therefore showed
  //   nothing whatsoever, which is the bug this dialog exists to fix.
  //
  // The event handlers stay as the fast path; both are idempotent with this.
  useEffect(() => {
    if (URL_AUTH_TYPE !== 'recovery' && URL_AUTH_TYPE !== 'signup') return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (URL_AUTH_TYPE === 'signup') {
        if (data.session) setConfirmed(true)
        return
      }
      if (data.session) {
        setNewPw(''); setNewPw2(''); setRecoveryErr(''); setRecoveryDone(false)
        setRecovery(true)
      } else {
        // The fragment said recovery and no session came out of it, so the token was stale.
        // `takeUrlAuthError` cannot catch this one: that path reads an `#error=` fragment, and
        // this is the shape where the tokens were present but would not redeem.
        setMode('reset'); setEmail(''); setPassword(''); setSuccessMsg('')
        setError('That link has expired or has already been used. Send yourself a fresh one.')
        setOpen(true)
      }
    }).catch(() => { /* nothing useful to say; the page still works signed-out */ })
    return () => { alive = false }
  }, [])

  // ── Dialog controls ────────────────────────────────────────────────────────
  const openAuthDialog = useCallback((m: AuthMode = 'signin') => {
    setMode(m); setEmail(''); setPassword(''); setUsernameVal(''); setUsernameStat('idle')
    setError(''); setSuccessMsg('')
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false); setError(''); setSuccessMsg('')
  }, [])

  const switchMode = useCallback(() => {
    // From `reset` the only sensible destination is back where they came from, so the toggle
    // stops being a two-way switch there and becomes a way out.
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError(''); setSuccessMsg('')
  }, [])

  const goToMode = useCallback((m: AuthMode) => {
    setMode(m); setError(''); setSuccessMsg(''); setPassword('')
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
    if (!em) return
    if (mode !== 'reset' && !password) return

    if (mode === 'reset') {
      setBusy(true); setError(''); setSuccessMsg('')
      const err = await resetPassword(em)
      setBusy(false)
      if (err) { setError(err); return }
      // Worded as a conditional on purpose, and shown whether or not that address has an
      // account. supabase deliberately does not say which, and neither should this: a reset
      // form that answers "no account with that email" is a free membership check for anyone
      // holding a list of addresses.
      setSuccessMsg(`If an account exists for ${em}, a link to set a new password is on its way.`)
      return
    }

    if (mode === 'signup') {
      // Checked before the request so the reader is told in place, and because supabase's own
      // minimum is six characters: without this the policy would apply to changing a password
      // and not to choosing the first one, which is the wrong way round.
      const pwErr = passwordProblem(password, { email: em, username: username.trim() || null })
      if (pwErr) { setError(pwErr); return }

      const desired = username.trim()
      if (desired) {
        const fmtErr = usernameValidationMsg(desired)
        if (fmtErr) { setError(fmtErr); return }
        if (usernameStat === 'taken') { setError('That username is already taken.'); return }
        if (usernameStat === 'checking') { setError('Still checking that username, one sec.'); return }
      }
    }

    setBusy(true); setError(''); setSuccessMsg('')

    if (mode === 'signin') {
      const err = await signIn(em, password)
      setBusy(false)
      if (err) setError(err)
      // success: onAuthStateChange fires → reload + toast
    } else {
      stashAuthReturn()  // return to this page after confirmation / auto-confirm reload
      const { data, error: sbErr } = await supabase.auth.signUp({
        email: em,
        password,
        options: { emailRedirectTo: `${window.location.origin}${cleanPathAndQuery(window.location.href)}` },
      })
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
  }, [mode, email, password, username, usernameStat, signIn, resetPassword])

  // Does this account have a password at all? Supabase records one identity per sign-in method,
  // so an account created through Google carries only a `google` identity until a password is
  // set, at which point an `email` one appears. Read from both places it is published, because
  // `identities` is absent from some session shapes while `app_metadata.providers` is absent
  // from others, and getting this wrong in the FALSE direction is the harmless one: it asks for
  // a current password that does exist.
  const user = session?.user
  const hasPassword =
    (user?.identities?.some(i => i.provider === 'email') ?? false) ||
    ((user?.app_metadata?.providers as string[] | undefined)?.includes('email') ?? false)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut, signInWithGoogle, resetPassword, changePassword, hasPassword, openAuthDialog }}>
      {children}

      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
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
      <Dialog open={confirmed} onClose={() => setConfirmed(false)} maxWidth="xs" fullWidth>
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
          <Button onClick={() => setConfirmed(false)} variant="contained" fullWidth sx={{ mx: 1, mb: 1 }}>
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
      <Dialog open={recovery} onClose={() => setRecovery(false)} maxWidth="xs" fullWidth>
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
                context={{ email: session?.user.email ?? null }}
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
          <Button onClick={() => setRecovery(false)}>{recoveryDone ? 'Done' : 'Not now'}</Button>
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
    </AuthContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
