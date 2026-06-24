import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { Typography, Box, IconButton, AppBar, Toolbar, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Tooltip, Paper, ClickAwayListener, CircularProgress, Snackbar, Alert, useMediaQuery } from '@mui/material'
import { Brightness4, Brightness7, AccountCircle } from '@mui/icons-material'
import { useTheme } from './ThemeContext'
import { AuthProvider, useAuth } from './AuthContext'
import { PENDING_USERNAME_PREFIX } from './AuthContext'
import { AdminPanel } from './AdminPanel'
import { UsernameDialog } from './UsernameDialog'
import { SettingsDialog } from './SettingsDialog'
import { supabase } from './lib/supabase'
import { usernameValidationMsg, isUsernameTaken, generateUniqueUsername } from './lib/usernames'
import CupsGame from '../projects/cups-game/src/CupsGame'

const ADMIN_EMAIL = 'snichols246@gmail.com'
import TestGame from './TestGame'
import Stopwatch from './Stopwatch'
import WeightGame from './WeightGame'
import PoopGame from './PoopGame'

// The MLB feature is by far the largest part of the app — code-split it so the
// landing page and other projects don't ship its ~entire view tree up front.
const MlbStats = lazy(() => import('./MlbStats'))

type Route = '/' | '/cups' | '/stopwatch' | '/weights' | '/poop' | '/testgame' | '/mlb'

const LOCK_PASSWORD = 'sportydolphin'
const LOCKED_PATHS = new Set(['/cups', '/weights'])
const SESSION_KEY = 'sdUnlocked'

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const PROJECTS = [
  { label: 'MLB Stats',     emoji: '📊',  desc: 'Player stat card maker', path: '/mlb',      color: 'hsl(0,   68%, 42%)' },
  { label: 'Test Game',     emoji: '🐟',  desc: 'Watch the fish trade',   path: '/testgame', color: 'hsl(260, 58%, 50%)' },
  { label: 'Cups Compare',  emoji: '🥤',  desc: 'Compare liquid amounts', path: '/cups',     color: 'hsl(195, 78%, 38%)' },
  { label: 'Stopwatch',     emoji: '⏱️',  desc: 'Test your timing',       path: '/stopwatch',color: 'hsl(28,  82%, 48%)' },
  { label: 'Weights',       emoji: '🏋️', desc: 'Track your lifts',       path: '/weights',  color: 'hsl(142, 50%, 36%)' },
  { label: 'Poop Pile',     emoji: '💩',  desc: 'Stack the poops',        path: '/poop',     color: 'hsl(24,  58%, 38%)' },
]

function AppInner() {
  const { mode, toggleTheme } = useTheme()
  const { user, signOut, openAuthDialog } = useAuth()
  // Root redirects straight to MLB Stats — it's the main site now. Other mini
  // apps are still reachable, just tucked behind the admin menu.
  const [path, setPath] = useState<Route | string>(() => {
    const p = window.location.pathname
    if (p === '/') { window.history.replaceState({}, '', '/mlb'); return '/mlb' }
    return p as Route
  })
  const [accountOpen,      setAccountOpen]      = useState(false)
  const [adminOpen,        setAdminOpen]        = useState(false)
  const [usernameOpen,     setUsernameOpen]     = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [username,         setUsername]         = useState<string | null>(null)
  const [authToast,        setAuthToast]         = useState<'in' | 'out' | null>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const isAdmin = user?.email === ADMIN_EMAIL
  const isDesktop = useMediaQuery('(min-width: 600px)')

  // Show the post sign-in/out toast stashed by AuthContext just before it reloaded the page
  useEffect(() => {
    const v = sessionStorage.getItem('sdAuthToast')
    if (v === 'in' || v === 'out') {
      setAuthToast(v)
      sessionStorage.removeItem('sdAuthToast')
    }
  }, [])

  // Fetch username whenever the logged-in user changes — if the account doesn't
  // have one yet, assign one now: whatever they chose at signup (stashed in
  // localStorage since email confirmation may have gated having a session then),
  // or otherwise a random baseball-themed name. Covers Google sign-ins too,
  // since those never go through the signup dialog at all.
  useEffect(() => {
    if (!user) { setUsername(null); return }
    let cancelled = false

    supabase.from('usernames').select('username').eq('user_id', user.id).maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return
        if (data?.username) { setUsername(data.username); return }

        const pendingKey = user.email ? `${PENDING_USERNAME_PREFIX}${user.email.toLowerCase()}` : null
        const pending = pendingKey ? localStorage.getItem(pendingKey) : null
        let final = (pending && !usernameValidationMsg(pending) && !(await isUsernameTaken(pending)))
          ? pending
          : await generateUniqueUsername()

        let { error } = await supabase.from('usernames').upsert({ user_id: user.id, username: final }, { onConflict: 'user_id' })
        if (error?.code === '23505') {
          // Race — someone grabbed it between our check and the insert. Fall back to a fresh random one.
          final = await generateUniqueUsername()
          ;({ error } = await supabase.from('usernames').upsert({ user_id: user.id, username: final }, { onConflict: 'user_id' }))
        }
        if (cancelled) return
        if (pendingKey) localStorage.removeItem(pendingKey)
        if (!error) setUsername(final)
      })

    return () => { cancelled = true }
  }, [user?.id])
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [lockDialogOpen, setLockDialogOpen] = useState(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname
      if (p === '/') { window.history.replaceState({}, '', '/mlb'); setPath('/mlb'); return }
      setPath(p as Route)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const handleTileClick = useCallback((p: { path: string }) => {
    if (LOCKED_PATHS.has(p.path) && !unlocked) {
      setPendingPath(p.path)
      setPwInput('')
      setPwError(false)
      setLockDialogOpen(true)
    } else {
      navigate(p.path)
    }
  }, [unlocked])

  const handlePwSubmit = useCallback(() => {
    if (pwInput === LOCK_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setUnlocked(true)
      setLockDialogOpen(false)
      if (pendingPath) navigate(pendingPath)
    } else {
      setPwError(true)
    }
  }, [pwInput, pendingPath])

  const backBtn = (
    <Box onClick={() => navigate('/mlb')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
  )

  // Other mini apps (everything but MLB Stats) — opened from the admin menu now
  // that the site lands on /mlb directly.
  const otherApps = PROJECTS.filter(p => p.path !== '/mlb')
  const isAppLocked = useCallback((path: string) => LOCKED_PATHS.has(path) && !unlocked, [unlocked])
  const openApp = useCallback((path: string) => { setAdminOpen(false); handleTileClick({ path }) }, [handleTileClick])

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography
            variant="h6" component="div"
            onClick={() => navigate('/mlb')}
            sx={{ flexGrow: 1, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}
          >
            sportydolphin.fun
          </Typography>
          <IconButton onClick={toggleTheme} size="small" sx={{ color: mode === 'dark' ? '#fbbf24' : 'text.primary' }}>
            {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
          </IconButton>
          {user ? (
            <ClickAwayListener onClickAway={() => setAccountOpen(false)}>
              <Box sx={{ position: 'relative' }}>
                <Box
                  onClick={() => setAccountOpen(o => !o)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                    pl: isDesktop ? 1 : 0, pr: isDesktop ? 0.5 : 0, py: 0.25, borderRadius: 999,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {isDesktop && (username || user.user_metadata?.full_name) && (
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {username ? `@${username}` : user.user_metadata.full_name}
                    </Typography>
                  )}
                  <IconButton
                    ref={accountBtnRef}
                    component="span"
                    size="small"
                    sx={{ color: 'success.main' }}
                  >
                    <AccountCircle />
                  </IconButton>
                </Box>

                {accountOpen && (
                  <Paper elevation={8} sx={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1400,
                    borderRadius: 2.5, minWidth: 220, overflow: 'hidden',
                    border: '1px solid', borderColor: 'divider',
                  }}>
                    {/* User info */}
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      {/* Username (primary) or full name if no username */}
                      {username ? (
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3, mb: 0.2 }}>
                          @{username}
                        </Typography>
                      ) : user.user_metadata?.full_name ? (
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3, mb: 0.2 }}>
                          {user.user_metadata.full_name}
                        </Typography>
                      ) : null}
                      <Typography sx={{
                        fontSize: (username || user.user_metadata?.full_name) ? '0.72rem' : '0.9rem',
                        fontWeight: (username || user.user_metadata?.full_name) ? 400 : 600,
                        color: (username || user.user_metadata?.full_name) ? 'text.secondary' : 'text.primary',
                        lineHeight: 1.3, wordBreak: 'break-all',
                      }}>
                        {user.email}
                      </Typography>
                    </Box>

                    {/* Settings */}
                    <Box
                      onClick={() => { setAccountOpen(false); setSettingsOpen(true) }}
                      sx={{
                        px: 2, py: 1.1, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1,
                        borderBottom: '1px solid', borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>⚙️ Settings</Typography>
                    </Box>

                    {/* Admin — only shown to the site owner */}
                    {isAdmin && (
                      <Box
                        onClick={() => { setAccountOpen(false); setAdminOpen(true) }}
                        sx={{
                          px: 2, py: 1.1, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 1,
                          borderBottom: '1px solid', borderColor: 'divider',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>⚡ Admin</Typography>
                      </Box>
                    )}

                    {/* Sign out */}
                    <Box
                      onClick={async () => { setAccountOpen(false); await signOut() }}
                      sx={{
                        px: 2, py: 1.25, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.85rem', color: 'error.main', fontWeight: 600 }}>
                        Sign out
                      </Typography>
                    </Box>
                  </Paper>
                )}
              </Box>
            </ClickAwayListener>
          ) : (
            <Tooltip title="Sign in to sync your followed team & players">
              <IconButton onClick={() => openAuthDialog('signin')} size="small" sx={{ color: 'text.secondary' }}>
                <AccountCircle />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 2 }}>
        {path === '/cups' && (
          <Box>
            {backBtn}
            <CupsGame />
          </Box>
        )}
        {path === '/stopwatch' && (
          <Box>
            {backBtn}
            <Stopwatch />
          </Box>
        )}
        {path === '/weights' && (
          <Box>
            {backBtn}
            <WeightGame />
          </Box>
        )}
        {path === '/poop' && (
          <Box>
            {backBtn}
            <PoopGame />
          </Box>
        )}
        {path === '/testgame' && (
          <Box>
            {backBtn}
            <TestGame />
          </Box>
        )}
        {path === '/mlb' && (
          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
            <MlbStats />
          </Suspense>
        )}
      </Box>

      <AdminPanel
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        apps={otherApps}
        isAppLocked={isAppLocked}
        onOpenApp={openApp}
      />

      <Dialog open={lockDialogOpen} onClose={() => setLockDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>🔒 Password required</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="Password"
            value={pwInput}
            error={pwError}
            helperText={pwError ? 'Incorrect password' : ''}
            onChange={e => { setPwInput(e.target.value); setPwError(false) }}
            onKeyDown={e => { if (e.key === 'Enter') handlePwSubmit() }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLockDialogOpen(false)}>Cancel</Button>
          <Button onClick={handlePwSubmit} variant="contained">Unlock</Button>
        </DialogActions>
      </Dialog>

      {user && (
        <>
          <UsernameDialog
            open={usernameOpen}
            onClose={() => setUsernameOpen(false)}
            userId={user.id}
            currentUsername={username}
            onSaved={setUsername}
          />
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            userId={user.id}
            email={user.email ?? ''}
            currentUsername={username}
            onEditUsername={() => { setSettingsOpen(false); setUsernameOpen(true) }}
          />
        </>
      )}

      <Snackbar
        open={!!authToast}
        autoHideDuration={3500}
        onClose={() => setAuthToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setAuthToast(null)}>
          {authToast === 'in' ? 'Successfully signed in' : 'Signed out'}
        </Alert>
      </Snackbar>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
