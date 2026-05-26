import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography,
} from '@mui/material'
import { supabase } from './lib/supabase'

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  session:         Session | null
  user:            User    | null
  loading:         boolean
  signIn:          (email: string, password: string) => Promise<string | null>
  signUp:          (email: string, password: string) => Promise<string | null>
  signOut:         () => Promise<void>
  /** Opens the sign-in / sign-up dialog programmatically from anywhere in the tree */
  openAuthDialog:  (mode?: 'signin' | 'signup') => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [open,     setOpen]     = useState(false)
  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  // ── Auth session ───────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      // Close dialog on successful sign-in/sign-up
      if (sess) setOpen(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const signIn = useCallback(async (em: string, pw: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    return error?.message ?? null
  }, [])

  const signUp = useCallback(async (em: string, pw: string): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({ email: em, password: pw })
    return error?.message ?? null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const openAuthDialog = useCallback((m: 'signin' | 'signup' = 'signin') => {
    setMode(m); setEmail(''); setPassword(''); setError('')
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false); setError('')
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!email.trim() || !password) return
    setBusy(true); setError('')
    const err = mode === 'signin'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password)
    setBusy(false)
    if (err) setError(err)
    // success: onAuthStateChange closes the dialog via setOpen(false)
  }, [mode, email, password, signIn, signUp])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut, openAuthDialog }}>
      {children}

      {/* Global auth dialog — rendered here so any code can open it via openAuthDialog() */}
      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {mode === 'signin' ? '🔑 Sign In' : '✨ Create Account'}
        </DialogTitle>

        <DialogContent>
          {mode === 'signup' && (
            <Box sx={{
              mb: 2, mt: 0.5, px: 1.5, py: 1.25, borderRadius: 2,
              bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
            }}>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1.5 }}>
                Save your followed team and players so they sync across all your devices.
              </Typography>
            </Box>
          )}

          <TextField
            autoFocus fullWidth label="Email" type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            sx={{ mt: mode === 'signup' ? 0 : 1, mb: 1.5 }}
          />
          <TextField
            fullWidth label="Password" type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            error={!!error}
            helperText={error || ' '}
          />

          <Box sx={{ mt: 0.5, textAlign: 'center' }}>
            <Typography
              component="span"
              onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError('') }}
              sx={{ fontSize: '0.8rem', color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
            >
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose}>
            {mode === 'signup' ? 'Maybe Later' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={busy || !email || !password}
          >
            {busy ? 'Loading…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </Button>
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
