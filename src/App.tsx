import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { Typography, Box, IconButton, AppBar, Toolbar, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Tooltip, Paper, ClickAwayListener, CircularProgress, Snackbar, Alert, useMediaQuery, List, ListItemButton, Divider } from '@mui/material'
import { Brightness4, Brightness7, AccountCircle, Search, Close } from '@mui/icons-material'
import { useSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import type { PlayerBridgeItem, TeamBridgeItem, ToolbarSuggestion, RecentSearchItem } from './mlb/state/SearchBridgeContext'
import { HEADSHOT, TEAM_BG, TEAM_ABBR, ACCENT, DESKTOP_ZOOM } from './mlb/constants'
import { APP_VERSION, CHANGELOG } from './version'
import { useTheme } from './ThemeContext'
import { AuthProvider, useAuth } from './AuthContext'
import { PENDING_USERNAME_PREFIX } from './AuthContext'
import { AdminPanel } from './AdminPanel'
import { UsernameDialog } from './UsernameDialog'
import { SettingsDialog } from './SettingsDialog'
import { NotificationBell } from './NotificationBell'
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

// ─── Changelog bullet — plain text, used for both the brief and full-detail lists ──

function ChangelogBullet({ text }: { text: string }) {
  return (
    <Typography component="li" sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 0.6, lineHeight: 1.45 }}>
      {text}
    </Typography>
  )
}

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
  const [changelogOpen,    setChangelogOpen]    = useState(false)
  const [viewAllVersion,   setViewAllVersion]   = useState<string | null>(null)
  const [adminOpen,        setAdminOpen]        = useState(false)
  const [usernameOpen,     setUsernameOpen]     = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [username,         setUsername]         = useState<string | null>(null)
  const [authToast,        setAuthToast]         = useState<'in' | 'out' | 'deleted' | null>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const isAdmin = user?.email === ADMIN_EMAIL
  const isDesktop = useMediaQuery('(min-width: 600px)')

  // ── Toolbar search bridge ─────────────────────────────────────────────────
  const bridge = useSearchBridge()
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false)
  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  const [toolbarInputFocused, setToolbarInputFocused] = useState(false)

  useEffect(() => {
    setToolbarDropdownOpen(
      bridge.query.length >= 2 &&
      (bridge.playerResults.length > 0 || bridge.teamResults.length > 0 || bridge.searching)
    )
  }, [bridge.query, bridge.playerResults, bridge.teamResults, bridge.searching])

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
    // Desktop-only content scale (see DESKTOP_ZOOM). Applied at the app root on the
    // /mlb route so the toolbar scales together with the MLB view; the `--app-zoom`
    // var inherits into the subtree for viewport-relative sizing that `zoom` can't
    // compensate. Portaled MUI Dialogs/Snackbar render outside this box (in body),
    // so they stay at native scale. Mobile (xs) and other routes stay at 1.
    <Box sx={{
      '--app-zoom': { xs: '1', md: path === '/mlb' ? String(DESKTOP_ZOOM) : '1' },
      zoom: 'var(--app-zoom)',
    }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48, py: 0.5 }}>
          {/* Close button — mobile search mode only */}
          {!isDesktop && mobileSearchExpanded && (
            <IconButton size="small" onClick={() => { setMobileSearchExpanded(false); setSearchQuery('') }} sx={{ mr: 0.5, flexShrink: 0 }}>
              <Close fontSize="small" />
            </IconButton>
          )}

          {/* Brand name + version badge — hidden while mobile search is expanded */}
          <Box sx={{
            flex: 1, minWidth: 0, display: mobileSearchExpanded && !isDesktop ? 'none' : 'flex',
            alignItems: 'baseline', gap: 0.75,
          }}>
            <Typography
              variant="h6" component="div"
              onClick={() => navigate('/mlb')}
              sx={{
                minWidth: 0, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              sportydolphin.fun
            </Typography>
            <Tooltip title="What's new">
              <Box
                onClick={() => setChangelogOpen(true)}
                sx={{
                  flexShrink: 0, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  fontSize: '0.6rem', fontWeight: 700, lineHeight: 1.4,
                  color: 'text.disabled', border: '1px solid', borderColor: 'divider',
                  borderRadius: 999, px: 0.65, py: '1px',
                  transition: 'color 0.15s, border-color 0.15s',
                  '&:hover': { color: ACCENT, borderColor: ACCENT },
                }}
              >
                v{APP_VERSION}
              </Box>
            </Tooltip>
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
                {toolbarDropdownOpen && bridge.query.length >= 2 && (bridge.playerResults.length > 0 || bridge.teamResults.length > 0) && (
                  <Paper elevation={8} sx={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                    zIndex: 1500, borderRadius: 2.5, overflow: 'hidden', minWidth: 240,
                  }}>
                    <List dense disablePadding>
                      {bridge.playerResults.slice(0, 6).map((p, i) => {
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
                <Search fontSize="small" />
              </IconButton>
            )}

            <NotificationBell onNavigate={navigate} />

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
          </Box>
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
          {authToast === 'in' ? 'Successfully signed in' : authToast === 'deleted' ? 'Your account has been deleted' : 'Signed out'}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
