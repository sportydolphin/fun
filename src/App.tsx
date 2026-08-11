import React, { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Typography, Box, IconButton, AppBar, Toolbar, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Paper, ClickAwayListener, CircularProgress, Snackbar, Alert, useMediaQuery, List, ListItemButton, Divider } from '@mui/material'
import { Brightness4, Brightness7, AccountCircle, Search, Close } from '@mui/icons-material'
import { useSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import type { PlayerBridgeItem, TeamBridgeItem, ToolbarSuggestion, RecentSearchItem, SearchResultRow } from './mlb/state/SearchBridgeContext'
import { HEADSHOT, TEAM_BG, TEAM_ABBR, ACCENT, DESKTOP_ZOOM } from './mlb/constants'
import { APP_VERSION, CHANGELOG } from './version'
import { useTheme } from './ThemeContext'
import { DevSettings, MobilePreviewHost } from './dev/DevSettings'
import { isInsideDeviceFrame } from './mlb/dev/devDevice'
import { AuthProvider, useAuth } from './AuthContext'
import { UnitsProvider } from './UnitsContext'
import { PENDING_USERNAME_PREFIX } from './AuthContext'
import { AdminPanel } from './AdminPanel'
import { UsernameDialog } from './UsernameDialog'
import { SettingsDialog } from './SettingsDialog'
import { SiteFooter } from './SiteFooter'
import { PrivacyPolicy, TermsOfService } from './LegalPages'
import { FeedbackDialog } from './FeedbackDialog'
import { NotificationBell } from './NotificationBell'
import { supabase } from './lib/supabase'
import { track, EVENTS } from './lib/analytics'
import { usernameValidationMsg, isUsernameTaken, generateUniqueUsername } from './lib/usernames'
import { setDeactivationHandler, resetActiveCache } from './lib/userActive'
import { DeactivatedDialog } from './DeactivatedDialog'
import CupsGame from '../projects/cups-game/src/CupsGame'

// Cosmetic gate only: decides whether the ⚡ Admin button renders. It grants NO
// privilege — every admin action is enforced server-side by RLS (public.is_site_owner(),
// see scripts/harden_admin_gate.sql), which reads the confirmed email from auth.users by
// the verified auth.uid() and can't be spoofed by faking this client value.
const ADMIN_EMAIL = 'snichols246@gmail.com'
import TestGame from './TestGame'
import Stopwatch from './Stopwatch'
import WeightGame from './WeightGame'
import PoopGame from './PoopGame'

// The MLB feature is by far the largest part of the app — code-split it so the
// landing page and other projects don't ship its ~entire view tree up front.
const MlbStats = lazy(() => import('./MlbStats'))
// WPBL — a separate top-level league section (its own data + views). Lazy so it
// stays out of the MLB and landing bundles.
const WpblApp = lazy(() => import('./wpbl/WpblApp'))
const WpblApiDocs = lazy(() => import('./wpbl/ApiDocs'))

type Route = '/' | '/cups' | '/stopwatch' | '/weights' | '/poop' | '/testgame' | '/mlb' | '/wpbl' | '/wpbl/api' | '/privacy' | '/terms'

const LOCK_PASSWORD = 'sportydolphin'
const LOCKED_PATHS = new Set(['/cups', '/weights'])
const SESSION_KEY = 'sdUnlocked'

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// A one-shot confetti pop, fired when you flip the league switch to WPBL — a small nod to
// the section's playful side. Purely cosmetic: self-contained CSS, no library, `pointer-
// events: none` so it never blocks a tap, and it unmounts itself once the animation ends.
// Re-triggered by remounting with a fresh `key`, which reseeds the random spread.
//
// Portaled to <body> at fixed viewport coords (x/y = the WPBL segment's centre): the AppBar
// is `position: static` on mobile, so confetti left inside it renders *under* the section's
// sticky tab nav. A body-level portal with a very high z-index floats it above everything.
const CONFETTI_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de']
function ConfettiBurst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const pieces = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    // Fan downward-and-out: the switch sits at the very top of the page, so an upward
    // burst would fly off the top edge of the viewport. Down has the whole page below.
    const angle = Math.PI * (0.15 + Math.random() * 0.7)
    const dist = 26 + Math.random() * 34
    return {
      id: i,
      tx: Math.cos(angle) * dist * (Math.random() < 0.5 ? -1 : 1),
      ty: Math.sin(angle) * dist + (4 + Math.random() * 8),
      rot: (Math.random() * 2 - 1) * 220,
      delay: Math.random() * 60,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 4 + Math.random() * 3,
      round: Math.random() < 0.4,
    }
  }), [])
  useEffect(() => {
    const t = window.setTimeout(onDone, 850)
    return () => window.clearTimeout(t)
  }, [onDone])
  return createPortal(
    <Box sx={{ position: 'fixed', left: x, top: y, width: 0, height: 0, pointerEvents: 'none', zIndex: 20000, '@keyframes confettiFly': {
      '0%':   { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      '100%': { transform: 'translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot))', opacity: 0 },
    } }}>
      {pieces.map(p => (
        <Box
          key={p.id}
          style={{
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
            '--rot': `${p.rot}deg`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.round ? '50%' : '1px',
            animationDelay: `${p.delay}ms`,
          } as React.CSSProperties}
          sx={{ position: 'absolute', left: 0, top: 0, animation: 'confettiFly 0.75s cubic-bezier(0.2, 0.6, 0.35, 1) forwards' }}
        />
      ))}
    </Box>,
    document.body,
  )
}

// Every route path is lowercase and matched exactly, but inbound links (and the
// analytics beacon) sometimes see mis-cased URLs like /WPBL. Lowercasing the
// pathname on read means those still render the right view and stop splitting a
// single page across two entries in Web Analytics. Search/hash are preserved.
function readPath(): string {
  const p = window.location.pathname.toLowerCase()
  if (p !== window.location.pathname) {
    window.history.replaceState({}, '', p + window.location.search + window.location.hash)
  }
  return p
}

// Retired players: show the years they played (e.g. "2001–2019") instead of just "Retired".
function retiredSpan(p: PlayerBridgeItem): string {
  const debutYear = p.mlbDebutDate?.slice(0, 4)
  const lastYear = p.lastPlayedDate?.slice(0, 4)
  if (debutYear && lastYear) return `${debutYear}–${lastYear}`
  if (debutYear) return `${debutYear}–`
  return 'Retired'
}

const PROJECTS = [
  { label: 'MLB Stats',     emoji: '📊',  desc: 'Player stat card maker', path: '/mlb',      color: 'hsl(0,   68%, 42%)' },
  { label: 'Test Game',     emoji: '🐟',  desc: 'Watch the fish trade',   path: '/testgame', color: 'hsl(260, 58%, 50%)' },
  { label: 'Cups Compare',  emoji: '🥤',  desc: 'Compare liquid amounts', path: '/cups',     color: 'hsl(195, 78%, 38%)' },
  { label: 'Stopwatch',     emoji: '⏱️',  desc: 'Test your timing',       path: '/stopwatch',color: 'hsl(28,  82%, 48%)' },
  { label: 'Weights',       emoji: '🏋️', desc: 'Track your lifts',       path: '/weights',  color: 'hsl(142, 50%, 36%)' },
  { label: 'Poop Pile',     emoji: '💩',  desc: 'Stack the poops',        path: '/poop',     color: 'hsl(24,  58%, 38%)' },
]

function ToolbarSuggestionsDropdown({ suggestions, onSelect, recents, onSelectRecent, onClearRecents }: {
  suggestions: ToolbarSuggestion[]
  onSelect: (s: ToolbarSuggestion) => void
  recents: RecentSearchItem[]
  onSelectRecent: (item: RecentSearchItem) => void
  onClearRecents: () => void
}) {
  // Never show the same player in both "Recent" and a suggestions section below it.
  const displayedRecents = recents.slice(0, 5)
  const recentPlayerIds  = new Set(displayedRecents.filter(r => r.type === 'player').map(r => r.id))
  const nonRecent        = suggestions.filter(s => !recentPlayerIds.has(s.id))
  const teamPlayers = nonRecent.filter(s => s.isTeamPlayer)
  const trending    = nonRecent.filter(s => !s.isTeamPlayer)

  const renderRecents = () => (
    <>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled' }}>
          Recent
        </Typography>
        <Box
          onClick={onClearRecents}
          sx={{ cursor: 'pointer', fontSize: '0.62rem', fontWeight: 600, color: 'text.disabled', userSelect: 'none', '&:hover': { color: 'error.main' } }}
        >
          Clear
        </Box>
      </Box>
      <List dense disablePadding>
        {displayedRecents.map((r, i) => (
          <React.Fragment key={`rec-${r.type}-${r.id}`}>
            {i > 0 && <Divider />}
            <ListItemButton onClick={() => onSelectRecent(r)} sx={{ gap: 1.25, py: 0.6 }}>
              {r.type === 'player' ? (
                <Box sx={{ width: 40, height: 54, borderRadius: 1.5, flexShrink: 0, backgroundImage: `url(${HEADSHOT(r.id)})`, backgroundSize: 'cover', backgroundPosition: 'center 5%', bgcolor: 'action.hover' }} />
              ) : (
                <Box sx={{ width: 40, height: 40, borderRadius: 1.5, flexShrink: 0, bgcolor: TEAM_BG[r.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <Box component="img" src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${r.id}.svg`} alt={r.name} sx={{ width: 28, height: 28, objectFit: 'contain' }} />
                </Box>
              )}
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{r.name}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                  {r.type === 'player'
                    ? [r.position, r.teamId ? TEAM_ABBR[r.teamId] : null].filter(Boolean).join(' · ')
                    : 'Team'}
                </Typography>
              </Box>
            </ListItemButton>
          </React.Fragment>
        ))}
      </List>
    </>
  )

  const renderSection = (label: string, players: ToolbarSuggestion[]) => (
    <>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.25 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled' }}>
          {label}
        </Typography>
      </Box>
      <List dense disablePadding>
        {players.map((s, i) => (
          <React.Fragment key={`sug-${s.id}`}>
            {i > 0 && <Divider />}
            <ListItemButton onClick={() => onSelect(s)} sx={{ gap: 1.25, py: 0.6 }}>
              <Box sx={{ width: 40, height: 54, borderRadius: 1.5, flexShrink: 0, backgroundImage: `url(${HEADSHOT(s.id)})`, backgroundSize: 'cover', backgroundPosition: 'center 5%', bgcolor: 'action.hover' }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{s.fullName}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{s.position} · {s.teamAbbr}</Typography>
              </Box>
            </ListItemButton>
          </React.Fragment>
        ))}
      </List>
    </>
  )

  return (
    <Paper elevation={8} sx={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
      zIndex: 1500, borderRadius: 2.5, overflow: 'hidden', minWidth: 260,
      // Divide by --app-zoom so this stays within the viewport under the desktop
      // `zoom` (which doesn't shrink viewport units). Defaults to 1 → unchanged.
      maxHeight: 'calc(70vh / var(--app-zoom, 1))', overflowY: 'auto',
    }}>
      {recents.length > 0 && renderRecents()}
      {recents.length > 0 && (teamPlayers.length > 0 || trending.length > 0) && <Divider sx={{ mt: 0.5 }} />}
      {teamPlayers.length > 0 && renderSection('Your Team', teamPlayers)}
      {teamPlayers.length > 0 && trending.length > 0 && <Divider sx={{ mt: 0.5 }} />}
      {trending.length > 0 && renderSection('Trending', trending)}
      <Box sx={{ height: 6 }} />
    </Paper>
  )
}

// Generic toolbar search result — one row of a section-agnostic dropdown (currently the
// WPBL section). Renders purely from primitive data on the row (image URL + colors), so
// the always-loaded toolbar never has to import a section's lazy chunk to draw its avatar.
function ToolbarResultRow({ row, onSelect }: { row: SearchResultRow; onSelect: (r: SearchResultRow) => void }) {
  const a = row.avatar
  const contain = a.fit === 'contain'
  return (
    <ListItemButton onClick={() => onSelect(row)} sx={{ gap: 1.25, py: 0.75 }}>
      <Box sx={{
        width: 36, height: 36, flexShrink: 0,
        borderRadius: a.circle ? '50%' : 1.5,
        bgcolor: a.bg ?? 'grey.700',
        border: a.ring ? `2px solid ${a.ring}` : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {a.imageUrl
          ? <Box component="img" src={a.imageUrl} alt="" loading="lazy" sx={{ width: contain ? '74%' : '100%', height: contain ? '74%' : '100%', objectFit: a.fit ?? 'cover' }} />
          : <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#fff' }}>{a.fallbackText}</Typography>}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{row.title}</Typography>
        {row.subtitle && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{row.subtitle}</Typography>}
      </Box>
    </ListItemButton>
  )
}

// ─── Changelog bullet — plain text, used for both the brief and full-detail lists ──

function ChangelogBullet({ text }: { text: string }) {
  return (
    <Typography component="li" sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 0.6, lineHeight: 1.45 }}>
      {text}
    </Typography>
  )
}

function AppInner() {
  const { mode, toggleTheme, skinConfig } = useTheme()
  const integratedHeader = skinConfig.integratedHeader
  const { user, signOut, openAuthDialog } = useAuth()
  // Root redirects straight to WPBL — it's the default section now. MLB and the
  // other mini apps are still reachable (the MLB | WPBL toggle, admin menu).
  const [path, setPath] = useState<Route | string>(() => {
    const p = readPath()
    if (p === '/') { window.history.replaceState({}, '', '/wpbl'); return '/wpbl' }
    return p as Route
  })
  const [accountOpen,      setAccountOpen]      = useState(false)
  const [changelogOpen,    setChangelogOpen]    = useState(false)
  const [feedbackOpen,     setFeedbackOpen]     = useState(false)
  const [viewAllVersion,   setViewAllVersion]   = useState<string | null>(null)
  const [adminOpen,        setAdminOpen]        = useState(false)
  const [usernameOpen,     setUsernameOpen]     = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [username,         setUsername]         = useState<string | null>(null)
  const [deactivated,      setDeactivated]      = useState(false)
  const [authToast,        setAuthToast]         = useState<'in' | 'out' | 'deleted' | null>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const leagueSwitchRef = useRef<HTMLDivElement>(null)
  const confettiTimer = useRef<number | undefined>(undefined)
  // Set (with a fresh key + the WPBL segment's screen coords) each time the switch flips to
  // WPBL, to fire the confetti pop from there; null once it finishes.
  const [confetti, setConfetti] = useState<{ key: number; x: number; y: number } | null>(null)
  const isAdmin = user?.email === ADMIN_EMAIL
  const isDesktop = useMediaQuery('(min-width: 600px)')

  // ── Toolbar search bridge ─────────────────────────────────────────────────
  const bridge = useSearchBridge()
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false)
  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  const [toolbarInputFocused, setToolbarInputFocused] = useState(false)

  // Results present from either the MLB player/team fields or the generic WPBL rows.
  const hasSearchResults =
    bridge.playerResults.length > 0 || bridge.teamResults.length > 0 || bridge.resultRows.length > 0

  useEffect(() => {
    setToolbarDropdownOpen(
      bridge.query.length >= 2 && (hasSearchResults || bridge.searching)
    )
  }, [bridge.query, hasSearchResults, bridge.searching])

  const handleToolbarSelectPlayer = (p: PlayerBridgeItem) => {
    bridge.handleSelectPlayer?.(p)
    setMobileSearchExpanded(false)
    setToolbarInputFocused(false)
  }

  const handleToolbarSelectTeam = (t: TeamBridgeItem) => {
    bridge.handleSelectTeam?.(t)
    setMobileSearchExpanded(false)
    setToolbarInputFocused(false)
  }

  // Generic WPBL result row — the row carries its own onSelect (routes through WpblApp's
  // navigation so the back-stack stays correct); the toolbar only tidies its own UI state.
  const handleToolbarSelectRow = (row: SearchResultRow) => {
    row.onSelect()
    setMobileSearchExpanded(false)
    setToolbarInputFocused(false)
  }

  const handleToolbarSelectSuggestion = (s: ToolbarSuggestion) => {
    bridge.handleSelectPlayer?.({
      id: s.id,
      fullName: s.fullName,
      primaryPosition: { abbreviation: s.position },
      currentTeam: { id: s.teamId },
    })
    setMobileSearchExpanded(false)
    setToolbarInputFocused(false)
  }

  // Show the post sign-in/out toast stashed by AuthContext (or the delete-account
  // flow) just before it reloaded the page
  useEffect(() => {
    const v = sessionStorage.getItem('sdAuthToast')
    if (v === 'in' || v === 'out' || v === 'deleted') {
      setAuthToast(v)
      sessionStorage.removeItem('sdAuthToast')
      // 'in' is stashed only on a genuine signed-out → signed-in transition, and we
      // record it here (post-reload) so the fire-and-forget insert isn't cut off by
      // the reload AuthContext does right after sign-in. A brand-new account's
      // created_at is seconds old on its first sign-in, which separates signup from a
      // returning login for both email and Google without any extra bookkeeping.
      if (v === 'in') {
        supabase.auth.getSession().then(({ data }) => {
          const u = data.session?.user
          const isNew = u?.created_at != null && (Date.now() - new Date(u.created_at).getTime()) < 60_000
          track(isNew ? EVENTS.SIGNUP : EVENTS.LOGIN, {}, u?.id ?? null)
        }).catch(() => {})
      }
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

    // select('*') (not just 'username') so this survives pre-migration too: if the
    // is_deleted column doesn't exist yet it's simply absent/undefined here.
    supabase.from('usernames').select('*').eq('user_id', user.id).maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return

        // Owner-deactivated account: sign out and show the blocking notice. Checked
        // before anything else so a deactivated user never gets a working session.
        if (data?.is_deleted) {
          setUsername(null)
          setDeactivated(true)
          await signOut()
          return
        }

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

  // Register the shared write-gate's reaction: if any DB write catches this account
  // as deactivated mid-session, show the notice and sign out (same as the sign-in
  // block above). Clear the active-user cache on sign-out so the next account starts
  // clean. See src/lib/userActive.ts.
  useEffect(() => {
    setDeactivationHandler(() => { setDeactivated(true); void signOut() })
    return () => setDeactivationHandler(null)
  }, [signOut])
  useEffect(() => { if (!user) resetActiveCache() }, [user?.id])

  // Dev mobile sim: inside the phone frame, translate mouse click-drag into touch
  // events so finger-driven swipes (tab pager, leaders category swipe) are testable.
  useEffect(() => {
    if (!import.meta.env.DEV || !isInsideDeviceFrame) return
    let cleanup: (() => void) | undefined
    void import('./mlb/dev/mouseTouchBridge').then(m => { cleanup = m.installMouseTouchBridge() })
    return () => cleanup?.()
  }, [])

  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [lockDialogOpen, setLockDialogOpen] = useState(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  useEffect(() => {
    const onPop = () => {
      const p = readPath()
      if (p === '/') { window.history.replaceState({}, '', '/wpbl'); setPath('/wpbl'); return }
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
    // Desktop-only content scale (see DESKTOP_ZOOM). Applied at the app root on the
    // /mlb and /wpbl routes so the toolbar scales together with the view; the `--app-zoom`
    // var inherits into the subtree for viewport-relative sizing that `zoom` can't
    // compensate. Portaled MUI Dialogs/Snackbar render outside this box (in body),
    // so they stay at native scale. Mobile (xs) and other routes stay at 1.
    <Box sx={{
      '--app-zoom': { xs: '1', md: (path === '/mlb' || path === '/wpbl' || path === '/wpbl/api') ? String(DESKTOP_ZOOM) : '1' },
      zoom: 'var(--app-zoom)',
    }}>
      <AppBar
        // On mobile the top bar scrolls away (static) rather than sticking — the MLB/WPBL
        // toggle + search are rarely needed mid-scroll, and a single sticky bar (the WPBL
        // tab menu, pinned below) avoids the two-bar gap collapsing as you scroll.
        position={!isDesktop ? 'static' : integratedHeader ? 'sticky' : 'static'}
        color="default"
        elevation={integratedHeader ? 0 : 1}
        sx={integratedHeader ? {
          // Integrated header: same tint as the page, separated by a hairline + blur
          // instead of sitting as a lighter-gray slab on near-black.
          top: 0,
          bgcolor: skinConfig.headerBg,
          backgroundImage: 'none',
          // Blur only on desktop, where the header is sticky and content actually passes
          // under it. On mobile the bar scrolls away with the page, so the blur is purely
          // decorative — and backdrop-filter makes the AppBar a stacking context that traps
          // the account dropdown (z-index 1400) below page content like the sticky tab bar
          // (z-index 3). Dropping it on mobile lets the dropdown render in front of the page.
          ...(isDesktop && { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }),
          borderBottom: '1px solid',
          borderColor: 'divider',
        } : undefined}
      >
        <Toolbar variant="dense" sx={{ minHeight: 48, py: 0.5 }}>
          {/* Close button — mobile search mode only */}
          {!isDesktop && mobileSearchExpanded && (
            <IconButton size="small" onClick={() => { setMobileSearchExpanded(false); setSearchQuery('') }} sx={{ mr: 0.5, flexShrink: 0 }}>
              <Close fontSize="small" />
            </IconButton>
          )}

          {/* Brand name — hidden while mobile search is expanded. Version + What's
              new now live in the site footer. */}
          <Box sx={{
            flex: 1, minWidth: 0, display: mobileSearchExpanded && !isDesktop ? 'none' : 'flex',
            alignItems: 'center', gap: 0.75,
          }}>
            <Typography
              variant="h6" component="div"
              onClick={() => navigate('/mlb')}
              sx={{
                minWidth: 0, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: { xs: 'none', sm: 'block' },
              }}
            >
              sportydolphin
            </Typography>

            {/* League switcher — slides between the two top-level sections (MLB | WPBL).
                A single absolutely-positioned thumb translates between the two equal-
                width segments so the fill glides instead of jumping; it goes rainbow
                on the WPBL side, plain accent on MLB. Acts as one switch: a click
                anywhere on it flips to the other league. */}
            <Box
              ref={leagueSwitchRef}
              onClick={() => {
                // /wpbl/api counts as the WPBL side, so flipping from the API docs goes to MLB.
                const target = (path === '/wpbl' || path === '/wpbl/api') ? '/mlb' : '/wpbl'
                if (target === '/wpbl') {
                  // Pop confetti from the bottom edge of the WPBL segment (right half of the
                  // control), held until the thumb finishes sliding across (matches the 0.28s slide).
                  const r = leagueSwitchRef.current?.getBoundingClientRect()
                  if (r) {
                    window.clearTimeout(confettiTimer.current)
                    confettiTimer.current = window.setTimeout(() => {
                      setConfetti(c => ({ key: (c?.key ?? 0) + 1, x: r.left + r.width * 0.75, y: r.bottom }))
                    }, 280)
                  }
                }
                navigate(target)
              }}
              sx={{
              // Equal-width columns (grid, not flex) so both segments are the same
              // width regardless of label length — otherwise MLB would be narrower
              // than WPBL and the 50% thumb wouldn't line up with either segment.
              position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', flexShrink: 0,
              p: '2px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid', borderColor: `${ACCENT}55`, bgcolor: `${ACCENT}14`,
            }}>
              {(path === '/mlb' || path === '/wpbl' || path === '/wpbl/api') && (() => {
                const wpblActive = path === '/wpbl' || path === '/wpbl/api'
                return (
                  <Box sx={{
                    position: 'absolute', top: '2px', bottom: '2px', left: '2px',
                    width: 'calc(50% - 2px)', borderRadius: 999,
                    transform: wpblActive ? 'translateX(100%)' : 'translateX(0)',
                    transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
                    // WPBL side: the rainbow gently pans (repeat the first stop at the end so
                    // the 200%-wide fill loops seamlessly). MLB stays a plain accent fill.
                    ...(wpblActive
                      ? {
                          background: 'linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #007aff, #5856d6, #af52de, #ff3b30)',
                          backgroundSize: '200% 100%',
                          animation: 'wpblShimmer 4s linear infinite',
                          '@keyframes wpblShimmer': {
                            '0%':   { backgroundPosition: '0% 50%' },
                            '100%': { backgroundPosition: '200% 50%' },
                          },
                        }
                      : { background: ACCENT }),
                  }} />
                )
              })()}
              {[{ label: 'MLB', to: '/mlb' }, { label: 'WPBL', to: '/wpbl' }].map(seg => {
                // /wpbl/api lights the WPBL segment too, so the switch stays "on WPBL" in the docs.
                const active = path === seg.to || (seg.to === '/wpbl' && path === '/wpbl/api')
                const rainbow = active && seg.to === '/wpbl'
                return (
                  <Box
                    key={seg.to}
                    sx={{
                      position: 'relative', zIndex: 1, textAlign: 'center',
                      px: 1, py: '3px', borderRadius: 999, userSelect: 'none',
                      fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.3, lineHeight: 1,
                      color: active ? '#fff' : 'text.secondary',
                      textShadow: rainbow ? '0 1px 1px rgba(0,0,0,0.35)' : 'none',
                      transition: 'color 0.2s',
                      '&:hover': { color: active ? '#fff' : 'text.primary' },
                    }}
                  >
                    {seg.label}
                  </Box>
                )
              })}
              {confetti && <ConfettiBurst key={confetti.key} x={confetti.x} y={confetti.y} onDone={() => setConfetti(null)} />}
            </Box>
          </Box>

          {/* Toolbar search — desktop: always visible when MLB loaded; mobile: expands on tap */}
          {bridge.isRegistered && (isDesktop || mobileSearchExpanded) && (
            <ClickAwayListener onClickAway={() => {
              setToolbarDropdownOpen(false)
              setToolbarInputFocused(false)
              if (!isDesktop) { setMobileSearchExpanded(false); setSearchQuery('') }
            }}>
              <Box sx={{
                position: 'relative',
                width: isDesktop ? 260 : undefined,
                flex: !isDesktop ? 1 : undefined,
                mx: isDesktop ? 1.5 : 0,
              }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.5, py: 0.55,
                  borderRadius: 999,
                  border: '1.5px solid',
                  borderColor: toolbarDropdownOpen ? ACCENT : 'divider',
                  bgcolor: 'background.paper',
                  transition: 'border-color 0.2s',
                }}>
                  {bridge.searching && bridge.query.length >= 2
                    ? <CircularProgress size={13} sx={{ color: 'text.disabled', flexShrink: 0 }} />
                    : <Search sx={{ fontSize: '0.9rem', color: 'text.disabled', flexShrink: 0 }} />
                  }
                  <Box
                    component="input"
                    autoFocus={mobileSearchExpanded && !isDesktop}
                    value={bridge.query}
                    onChange={(e: any) => setSearchQuery(e.target.value)}
                    onFocus={() => {
                      setToolbarInputFocused(true)
                      if (bridge.query.length >= 2) setToolbarDropdownOpen(true)
                    }}
                    onKeyDown={(e: any) => {
                      if (e.key === 'Escape') {
                        setSearchQuery('')
                        setToolbarDropdownOpen(false)
                        setToolbarInputFocused(false)
                        if (!isDesktop) setMobileSearchExpanded(false)
                      }
                    }}
                    placeholder="Search player or team…"
                    sx={{
                      flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                      fontSize: '0.82rem', color: 'text.primary', p: 0, fontFamily: 'inherit',
                      '&::placeholder': { color: 'text.disabled' },
                      minWidth: 0,
                    }}
                  />
                  {bridge.query && (
                    <Box
                      onClick={() => setSearchQuery('')}
                      sx={{ cursor: 'pointer', color: 'text.disabled', display: 'flex', flexShrink: 0, '&:hover': { color: 'text.primary' } }}
                    >
                      <Close sx={{ fontSize: '0.85rem' }} />
                    </Box>
                  )}
                </Box>

                {/* Recent + suggestions dropdown — shown when input is focused and query is empty */}
                {toolbarInputFocused && bridge.query.length < 2 && (bridge.recentSearches.length > 0 || bridge.toolbarSuggestions.length > 0) && (
                  <ToolbarSuggestionsDropdown
                    suggestions={bridge.toolbarSuggestions}
                    onSelect={handleToolbarSelectSuggestion}
                    recents={bridge.recentSearches}
                    onSelectRecent={(item) => {
                      bridge.handleSelectRecent?.(item)
                      setMobileSearchExpanded(false)
                      setToolbarInputFocused(false)
                    }}
                    onClearRecents={() => bridge.clearRecentSearches?.()}
                  />
                )}

                {/* Search results dropdown */}
                {toolbarDropdownOpen && bridge.query.length >= 2 && hasSearchResults && (
                  <Paper elevation={8} sx={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                    zIndex: 1500, borderRadius: 2.5, overflow: 'hidden', minWidth: 240,
                  }}>
                    <List dense disablePadding>
                      {/* WPBL owns search → render its self-describing generic rows. */}
                      {bridge.source === 'wpbl' && bridge.resultRows.map((row, i) => (
                        <React.Fragment key={row.key}>
                          {i > 0 && <Divider />}
                          <ToolbarResultRow row={row} onSelect={handleToolbarSelectRow} />
                        </React.Fragment>
                      ))}
                      {bridge.source !== 'wpbl' && bridge.playerResults.slice(0, 6).map((p, i) => {
                        const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
                        const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id as number] : undefined
                        const sub = p.active === false
                          ? [pos, retiredSpan(p)].filter(Boolean).join(' | ')
                          : [pos, teamAbbr].filter(Boolean).join(' | ')
                        return (
                          <React.Fragment key={`tbp-${p.id}`}>
                            {i > 0 && <Divider />}
                            <ListItemButton onClick={() => handleToolbarSelectPlayer(p)} sx={{ gap: 1.25, py: 0.75 }}>
                              <Box sx={{ width: 36, height: 36, borderRadius: 1.5, flexShrink: 0, backgroundImage: `url(${HEADSHOT(p.id)})`, backgroundSize: 'cover', backgroundPosition: 'center 20%', bgcolor: 'grey.200' }} />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{p.fullName}</Typography>
                                {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{sub}</Typography>}
                              </Box>
                            </ListItemButton>
                          </React.Fragment>
                        )
                      })}
                      {bridge.playerResults.length > 0 && bridge.teamResults.length > 0 && (
                        <Divider sx={{ borderStyle: 'dashed' }} />
                      )}
                      {bridge.teamResults.slice(0, 3).map((t, i) => {
                        const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
                        const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
                        const sub = [leagueShort, divShort].filter(Boolean).join(' · ')
                        return (
                          <React.Fragment key={`tbt-${t.id}`}>
                            {i > 0 && <Divider />}
                            <ListItemButton onClick={() => handleToolbarSelectTeam(t)} sx={{ gap: 1.25, py: 0.75 }}>
                              <Box sx={{ width: 36, height: 36, borderRadius: 1.5, flexShrink: 0, bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                <Box component="img" src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg`} alt={t.abbreviation} sx={{ width: 26, height: 26, objectFit: 'contain' }} />
                              </Box>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>{t.name}</Typography>
                                {sub && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{sub}</Typography>}
                              </Box>
                            </ListItemButton>
                          </React.Fragment>
                        )
                      })}
                    </List>
                  </Paper>
                )}
              </Box>
            </ClickAwayListener>
          )}

          {/* Right-side icons — flex:1 on desktop so they balance the brand and keep search centered */}
          <Box sx={{ flex: isDesktop ? 1 : undefined, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            {/* Mobile: search icon when not expanded */}
            {bridge.isRegistered && !isDesktop && !mobileSearchExpanded && (
              <IconButton size="small" onClick={() => setMobileSearchExpanded(true)} sx={{ color: 'text.secondary', mr: 0.25 }}>
                <Search />
              </IconButton>
            )}

            <NotificationBell onNavigate={navigate} />

            {/* Consolidated dev gear (local only) — skin picker, device/mobile
                simulation, notification tester, simulated login, and (on /mlb) the
                MLB simulators. Renders on every section, so the mobile toggle works
                in WPBL too. See src/dev/DevSettings.tsx. Never in a production build. */}
            {import.meta.env.DEV && <DevSettings showMlbTools={path === '/mlb'} />}

            <IconButton onClick={toggleTheme} size="small" sx={{ color: mode === 'dark' ? '#fbbf24' : 'text.secondary' }}>
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
                      {username ? (
                        // The Roboto/Arial "@" dips toward the baseline and reads as sitting
                        // low next to the lowercase handle — nudge it up a hair to optically center.
                        <>
                          <Box component="span" sx={{ position: 'relative', top: '-0.01em' }}>@</Box>{username}
                        </>
                      ) : user.user_metadata.full_name}
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
            <ClickAwayListener onClickAway={() => setAccountOpen(false)}>
              <Box sx={{ position: 'relative' }}>
                <IconButton
                  onClick={() => setAccountOpen(o => !o)}
                  size="small"
                  sx={{ color: 'text.secondary' }}
                >
                  <AccountCircle />
                </IconButton>

                {accountOpen && (
                  <Paper elevation={8} sx={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1400,
                    borderRadius: 2.5, minWidth: 220, overflow: 'hidden',
                    border: '1px solid', borderColor: 'divider',
                  }}>
                    {/* Sign in */}
                    <Box
                      onClick={() => { setAccountOpen(false); openAuthDialog('signin') }}
                      sx={{
                        px: 2, py: 1.25, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1,
                        borderBottom: '1px solid', borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>Sign in</Typography>
                    </Box>

                    {/* Create an account */}
                    <Box
                      onClick={() => { setAccountOpen(false); openAuthDialog('signup') }}
                      sx={{
                        px: 2, py: 1.25, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1,
                        borderBottom: '1px solid', borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>Create an account</Typography>
                    </Box>

                    {/* Settings — available without an account */}
                    <Box
                      onClick={() => { setAccountOpen(false); setSettingsOpen(true) }}
                      sx={{
                        px: 2, py: 1.1, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>⚙️ Settings</Typography>
                    </Box>
                  </Paper>
                )}
              </Box>
            </ClickAwayListener>
          )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Dev-only: re-render the whole app inside a simulated phone viewport. At the
          app root (not inside a section) so the device toggle covers MLB and WPBL. */}
      {import.meta.env.DEV && !isInsideDeviceFrame && <MobilePreviewHost />}

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
        {path === '/wpbl' && (
          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
            {/* On mobile the WPBL tabs swipe, so the footer rides inside each tab pane (see
                WpblApp) instead of sitting shared below them — the shared one is suppressed
                just below. Desktop keeps the app-level footer. */}
            <WpblApp renderFooter={() => (
              <SiteFooter
                onOpenChangelog={() => setChangelogOpen(true)}
                onOpenFeedback={() => setFeedbackOpen(true)}
                onNavigate={navigate}
                isWpbl
              />
            )} />
          </Suspense>
        )}
        {path === '/wpbl/api' && (
          <Box>
            {/* Align the back control to the docs column (same maxWidth/px as WpblApiDocs)
                so on desktop it sits by the content, not stranded at the far-left page edge. */}
            <Box sx={{ maxWidth: 760, mx: 'auto', px: { xs: 2, sm: 3 }, mb: 2 }}>
              <Box onClick={() => navigate('/wpbl')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700, userSelect: 'none', px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', transition: 'color 0.15s, border-color 0.15s, background-color 0.15s', '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' } }}>← Back to WPBL</Box>
            </Box>
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblApiDocs />
            </Suspense>
          </Box>
        )}
        {path === '/privacy' && (
          <Box>
            {backBtn}
            <PrivacyPolicy />
          </Box>
        )}
        {path === '/terms' && (
          <Box>
            {backBtn}
            <TermsOfService />
          </Box>
        )}
      </Box>

      {/* On mobile WPBL the footer rides inside each swipeable tab pane (WpblApp's
          renderFooter) so it doesn't reflow when tabs of different heights swap — so skip
          the shared one there. Everywhere else (incl. desktop WPBL) it renders here. */}
      {!(path === '/wpbl' && !isDesktop) && (
        <SiteFooter
          onOpenChangelog={() => setChangelogOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
          onNavigate={navigate}
          isWpbl={path.startsWith('/wpbl')}
        />
      )}

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        userId={user?.id ?? null}
        userEmail={user?.email ?? null}
      />

      <AdminPanel
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        apps={otherApps}
        isAppLocked={isAppLocked}
        onOpenApp={openApp}
      />

      <DeactivatedDialog open={deactivated} onClose={() => setDeactivated(false)} />

      <Dialog open={changelogOpen} onClose={() => setChangelogOpen(false)} maxWidth="sm" fullWidth fullScreen={!isDesktop}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          What's New
          <Typography component="span" sx={{ fontSize: '0.8rem', color: 'text.disabled', fontWeight: 600 }}>
            · currently v{APP_VERSION}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {CHANGELOG.map((entry, idx) => (
            <Box key={entry.version} sx={{ mb: idx === CHANGELOG.length - 1 ? 0 : 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1 }}>v{entry.version}</Typography>
                {entry.title && (
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1 }}>
                    {entry.title}
                  </Typography>
                )}
                <Typography sx={{ ml: 'auto', fontSize: '0.72rem', color: 'text.disabled', lineHeight: 1 }}>
                  {new Date(`${entry.date}T00:00:00`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}
                </Typography>
              </Box>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {entry.changes.slice(0, 4).map((c, i) => (
                  <ChangelogBullet key={i} text={c.short} />
                ))}
              </Box>
              <Box
                onClick={() => setViewAllVersion(entry.version)}
                sx={{
                  display: 'inline-block', mt: 0.75, cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 700, color: ACCENT,
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                View all changes
              </Box>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangelogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={viewAllVersion !== null} onClose={() => setViewAllVersion(null)} maxWidth="sm" fullWidth fullScreen={!isDesktop}>
        {(() => {
          const entry = CHANGELOG.find(e => e.version === viewAllVersion)
          if (!entry) return null
          return (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                v{entry.version}
                {entry.title && (
                  <Typography component="span" sx={{ fontSize: '0.8rem', color: 'text.disabled', fontWeight: 600 }}>
                    {entry.title}
                  </Typography>
                )}
              </DialogTitle>
              <DialogContent dividers>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {entry.changes.map((c, i) => (
                    <ChangelogBullet key={i} text={c.full} />
                  ))}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setViewAllVersion(null)}>Close</Button>
              </DialogActions>
            </>
          )
        })()}
      </Dialog>

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
        <UsernameDialog
          open={usernameOpen}
          onClose={() => setUsernameOpen(false)}
          userId={user.id}
          currentUsername={username}
          onSaved={setUsername}
        />
      )}

      {/* Settings is available to everyone; account-specific sections inside only
          render when signed in. */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        userId={user?.id ?? null}
        email={user?.email ?? ''}
        currentUsername={username}
        onEditUsername={() => { setSettingsOpen(false); setUsernameOpen(true) }}
      />

      <Snackbar
        open={!!authToast}
        autoHideDuration={3500}
        onClose={() => setAuthToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setAuthToast(null)}>
          {authToast === 'in' ? 'Successfully signed in' : authToast === 'deleted' ? 'Your account has been deleted' : 'Signed out'}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <UnitsProvider>
        <AppInner />
      </UnitsProvider>
    </AuthProvider>
  )
}
