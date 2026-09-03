import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Typography, Box, IconButton, AppBar, Toolbar, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Paper, ClickAwayListener, CircularProgress, Snackbar, Alert, useMediaQuery, List, ListItemButton, Divider } from '@mui/material'
import { Brightness4, Brightness7, AccountCircle, Search, Close } from '@mui/icons-material'
import { useSearchBridge, setSearchQuery } from './mlb/state/SearchBridgeContext'
import type { PlayerBridgeItem, TeamBridgeItem, ToolbarSuggestion, RecentSearchItem, SearchResultRow } from './mlb/state/SearchBridgeContext'
import { HEADSHOT, TEAM_BG, TEAM_ABBR, ACCENT, DESKTOP_ZOOM } from './mlb/constants'
import { APP_VERSION } from './version'
import { useTheme } from './ThemeContext'
import { DevSettings, MobilePreviewHost } from './dev/DevSettings'
import { isInsideDeviceFrame } from './mlb/dev/devDevice'
import { AuthProvider, useAuth } from './AuthContext'
import { UnitsProvider } from './UnitsContext'
import { EraBasisProvider } from './wpbl/EraBasisContext'
import { ExperimentsProvider } from './ExperimentsContext'
import { AccessibilityProvider } from './AccessibilityContext'
import { PENDING_USERNAME_PREFIX } from './AuthContext'
import { SiteFooter } from './SiteFooter'
import { pressable, FOCUS_RING } from './wpbl/ui'
import { NotificationBell } from './NotificationBell'
import { supabase } from './lib/supabase'
import { useSeo } from './seo'
// Import-free by design, so naming it here does not drag the lazy WPBL chunk into the
// entry bundle. See the note at the top of that file.
import { wpblViewFromPath, wpblPlayerSlugFromPath, isWpblPlayersIndex, isWpblLeaguePage, wpblAppOwnsPath, WPBL_PATH_EVENT } from './wpbl/routes'
import { jerseyQuery } from './wpbl/playerSearch'
import { track, EVENTS } from './lib/analytics'
import { usernameValidationMsg, isUsernameTaken, generateUniqueUsername } from './lib/usernames'
import { setDeactivationHandler, resetActiveCache } from './lib/userActive'

// Cosmetic gate only: decides whether the ⚡ Admin button renders. It grants NO
// privilege — every admin action is enforced server-side by RLS (public.is_site_owner(),
// see scripts/harden_admin_gate.sql), which reads the confirmed email from auth.users by
// the verified auth.uid() and can't be spoofed by faking this client value. Shared with
// the WPBL feature-flagged sections via src/lib/admin.ts.
import { ADMIN_EMAIL } from './lib/admin'

// The MLB feature is by far the largest part of the app — code-split it so the
// landing page and other projects don't ship its ~entire view tree up front.
const loadMlb = () => import('./MlbStats')
const MlbStats = lazy(loadMlb)
// WPBL — a separate top-level league section (its own data + views). Lazy so it
// stays out of the MLB and landing bundles.
const loadWpbl = () => import('./wpbl/WpblApp')
const WpblApp = lazy(loadWpbl)

/** Pull the OTHER section's chunk in before it is asked for.
 *
 *  THE SWITCH USED TO GO BLANK FOR A THIRD OF A SECOND. Both sections are lazy, so flipping the
 *  league switch unmounted one section's tab bar, showed a spinner while the other's chunk came
 *  over the wire, and then mounted the new bar: measured at 330ms one way and 580ms the other,
 *  on localhost. What a reader sees is the pill bar under the toolbar vanishing and coming back
 *  somewhere slightly different, which reads as the page jumping even though nothing moved.
 *
 *  The module registry caches by specifier, so calling the same dynamic import ahead of time
 *  makes React.lazy resolve on the spot and the switch render in one commit with no fallback.
 *  Called on hover and focus, which covers a mouse and a keyboard, and once on an idle callback
 *  after the current section settles, which covers touch, where there is no hover to wait for.
 *  Failures are swallowed on purpose: this is a prefetch, and the real import will report any
 *  problem properly when the reader actually goes there. */
function preloadSection(path: string) {
  const p = isWpblSection(path) ? loadMlb() : loadWpbl()
  p.catch(() => {})
}
// The flat players list at /wpbl/players. Its own chunk and its own route: it is a plain
// page, not one of the section's tabs, so it has no business waking WpblApp's state machine.
const WpblPlayersIndex = lazy(() => import('./wpbl/PlayersIndex'))
const WpblLeaguePage = lazy(() => import('./wpbl/LeaguePage'))
const WpblApiDocs = lazy(() => import('./wpbl/ApiDocs'))
// The owner's dashboard. Its own route rather than a dialog: charts and tables need the
// room, and it pulls in the analytics RPC layer that nobody else should ever download.
const AdminPage = lazy(() => import('./AdminPage'))

// The mini-apps: each is a whole game or tool reachable only from its own route, and none
// of them has anything to do with the two league sections that carry the traffic. Eagerly
// imported they were ~120 KB of the entry chunk that a /wpbl reader downloaded and never
// ran. TestGame alone is 47 KB of source.
const CupsGame = lazy(() => import('../projects/cups-game/src/CupsGame'))
const TestGame = lazy(() => import('./TestGame'))
const Stopwatch = lazy(() => import('./Stopwatch'))
const WeightGame = lazy(() => import('./WeightGame'))
const PoopGame = lazy(() => import('./PoopGame'))
// Both legal pages come from one module, so these two share a chunk.
const PrivacyPolicy = lazy(() => import('./LegalPages').then(m => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./LegalPages').then(m => ({ default: m.TermsOfService })))
const DeleteAccount = lazy(() => import('./LegalPages').then(m => ({ default: m.DeleteAccount })))

// Dialogs. Each is mounted only after it has been opened once (see `useOpenedOnce`), so its
// chunk is fetched on the click that needs it. SettingsDialog is the expensive one: it pulls
// in MLB's api + constants + colour utilities, ~90 KB of source that has no business loading
// for someone reading WPBL box scores.
const SettingsDialog = lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })))
const FeedbackDialog = lazy(() => import('./FeedbackDialog').then(m => ({ default: m.FeedbackDialog })))
const UsernameDialog = lazy(() => import('./UsernameDialog').then(m => ({ default: m.UsernameDialog })))
const DeactivatedDialog = lazy(() => import('./DeactivatedDialog').then(m => ({ default: m.DeactivatedDialog })))
const ChangelogDialogs = lazy(() => import('./ChangelogDialogs'))

// Latch a dialog's "has ever been open" flag.
//
// Gating a lazy dialog on `open` alone would unmount it the instant it closes, which throws
// away MUI's close transition — the panel would vanish instead of fading. Latching means the
// chunk still isn't fetched until the first open, and after that the dialog stays mounted and
// animates normally.
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(false)
  if (open && !opened) setOpened(true)
  return opened || open
}

// Dialogs render above the page, so a spinner in their place would be a stray box floating
// over the app; the brief gap before the chunk lands reads as the click taking a moment.
const DIALOG_FALLBACK = null

// The WPBL tabs (/wpbl/schedule and friends) are routes too; they live in wpbl/routes.ts
// because seo.ts and WpblApp need the same list. Adding one there means adding a line in
// public/_redirects as well, or it 404s in production and works fine in dev.
type Route = '/' | '/cups' | '/stopwatch' | '/weights' | '/poop' | '/testgame' | '/mlb' | '/wpbl' | '/wpbl/api' | '/privacy' | '/terms' | '/delete-account' | '/admin'

/** A WPBL tab page. `/wpbl/api` is a sibling route, not a tab, so it is not one of these. */
const isWpblTab = (p: string) => wpblViewFromPath(p) !== null
/** A player page or the index that lists them. Both are rendered by WpblApp: a player is a
 *  modal the section opens over a tab, so the section still owns the route. */
const isWpblPlayerPage = (p: string) => wpblPlayerSlugFromPath(p) !== null || isWpblPlayersIndex(p)
/** Everything WpblApp renders. The players INDEX is its own page, so it is not here.
 *  Defined in routes.ts because WpblApp's popstate handler has to agree with it. */
const rendersWpblApp = wpblAppOwnsPath
/** Anything that should read as "the reader is in the WPBL section". */
const isWpblSection = (p: string) =>
  rendersWpblApp(p) || p === '/wpbl/api' || isWpblLeaguePage(p) || isWpblPlayersIndex(p)

const LOCK_PASSWORD = 'sportydolphin'
const LOCKED_PATHS = new Set(['/cups', '/weights'])
const SESSION_KEY = 'sdUnlocked'

// Brand lockup in the toolbar. The logo is sized to the wordmark's line box so the
// two read as one unit, and the wordmark is held back until the viewport can show it
// without the ellipsis biting into it. See the toolbar brand block for the math.
const BRAND_LOGO_H = 32
// TWO THRESHOLDS, BECAUSE THE TOOLBAR IS NOW TWO SIZES. The test never changed: does the
// toolbar have room to show the lockup whole. What changed is what "the toolbar" measures.
//
// On an unscaled route it gets the viewport in the same pixels the media query counts, so the
// test is met at 960. On a route running the desktop scale the same lockup is that much wider
// in those pixels, so the second threshold is simply the first times the scale: DERIVED rather
// than written down, because the two would otherwise drift the first time the scale moves, and
// the symptom would be a wordmark ellipsising into the search box at one narrow band of widths
// that nobody thinks to check. Both are raw px queries rather than theme breakpoints for the
// original reason: theme breakpoints match the real viewport, and what is being asked about
// here is the toolbar's own width.
const BRAND_WORDMARK_MIN = 960
/** How much larger /wpbl renders at md and up, now that it is scaled in CSS rather than under
 *  `zoom: 1.4`. Published as --app-scale-desktop for styles.css to spend on --app-type and
 *  --app-chrome; the breakpoint itself stays in CSS. Moving this one number moves the whole
 *  section, the threshold below included. */
export const WPBL_DESKTOP_SCALE = 1.25
const BRAND_WORDMARK_MIN_SCALED = Math.ceil(BRAND_WORDMARK_MIN * WPBL_DESKTOP_SCALE)

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Props that turn any Box/Typography into a real in-app link.
//
// Every internal navigation MUST render an <a href>. Googlebot does not fire onClick
// handlers, so a Box with only an onClick is invisible to a crawler: that is why /mlb
// went undiscovered for months while /privacy and /terms, which the footer links with
// real anchors, were found. The href is what a crawler follows; preventDefault is what
// keeps the SPA from doing a full page load.
//
// Modified clicks (cmd/ctrl/shift/alt, middle button) fall through to the browser
// untouched, so open-in-new-tab works the way it does on every other site.
function linkTo(to: string) {
  return {
    component: 'a' as const,
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
    },
  }
}

// Anchors carry a browser default underline and link colour; the site's controls set
// their own. Spread alongside linkTo() on anything that should not look like body text.
const UNSTYLED_LINK = { textDecoration: 'none', color: 'inherit' } as const

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
      // Divided by the toolbar's own scale: this panel hangs inside it, and `zoom` does not
      // shrink viewport units, so a raw 70vh would resolve to 87% of the screen at 1.25.
      maxHeight: 'calc(70vh / var(--app-shell, 1))', overflowY: 'auto',
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

// Empty-query dropdown for the section that drives the generic result rows (currently WPBL):
// the players and teams last opened from search, each a self-describing SearchResultRow. The
// MLB section keeps its own richer ToolbarSuggestionsDropdown (Recent + Your Team + Trending).
function ToolbarRecentRowsDropdown({ rows, onSelect, onClear }: {
  rows: SearchResultRow[]
  onSelect: (r: SearchResultRow) => void
  onClear: () => void
}) {
  return (
    <Paper elevation={8} sx={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
      zIndex: 1500, borderRadius: 2.5, overflow: 'hidden', minWidth: 260,
      // Divided by the toolbar's own scale: this panel hangs inside it, and `zoom` does not
      // shrink viewport units, so a raw 70vh would resolve to 87% of the screen at 1.25.
      maxHeight: 'calc(70vh / var(--app-shell, 1))', overflowY: 'auto',
    }}>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.disabled' }}>
          Recent
        </Typography>
        <Box
          onClick={onClear}
          sx={{ cursor: 'pointer', fontSize: '0.62rem', fontWeight: 600, color: 'text.disabled', userSelect: 'none', '&:hover': { color: 'error.main' } }}
        >
          Clear
        </Box>
      </Box>
      <List dense disablePadding>
        {rows.map((row, i) => (
          <React.Fragment key={row.key}>
            {i > 0 && <Divider />}
            <ToolbarResultRow row={row} onSelect={onSelect} />
          </React.Fragment>
        ))}
      </List>
      <Box sx={{ height: 6 }} />
    </Paper>
  )
}

function AppInner() {
  const { mode, toggleTheme, skinConfig } = useTheme()
  const integratedHeader = skinConfig.integratedHeader
  const { user, loading: authLoading, signOut, openAuthDialog } = useAuth()
  // Root redirects straight to WPBL — it's the default section now. MLB and the
  // other mini apps are still reachable (the MLB | WPBL toggle, admin menu).
  const [path, setPath] = useState<Route | string>(() => {
    const p = readPath()
    if (p === '/') { window.history.replaceState({}, '', '/wpbl'); return '/wpbl' }
    return p as Route
  })
  // Keep <title>, meta description, canonical, and OG tags in sync with the route.
  useSeo(path)
  const [accountOpen,      setAccountOpen]      = useState(false)
  const [changelogOpen,    setChangelogOpen]    = useState(false)
  const [feedbackOpen,     setFeedbackOpen]     = useState(false)
  const [usernameOpen,     setUsernameOpen]     = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [username,         setUsername]         = useState<string | null>(null)
  const [deactivated,      setDeactivated]      = useState(false)

  // Lazy dialogs mount on first open and stay mounted (see useOpenedOnce), so their chunks
  // are fetched by the click that needs them rather than on every page load.
  const feedbackMounted    = useOpenedOnce(feedbackOpen)
  const deactivatedMounted = useOpenedOnce(deactivated)
  const usernameMounted    = useOpenedOnce(usernameOpen)
  const settingsMounted    = useOpenedOnce(settingsOpen)
  const changelogMounted   = useOpenedOnce(changelogOpen)
  const [authToast,        setAuthToast]         = useState<'in' | 'out' | 'deleted' | null>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const leagueSwitchRef = useRef<HTMLDivElement>(null)
  const confettiTimer = useRef<number | undefined>(undefined)
  // Set (with a fresh key + the WPBL segment's screen coords) each time the switch flips to
  // WPBL, to fire the confetti pop from there; null once it finishes.
  const [confetti, setConfetti] = useState<{ key: number; x: number; y: number } | null>(null)
  const isAdmin = user?.email === ADMIN_EMAIL
  const isDesktop = useMediaQuery('(min-width: 600px)')

  // Publish the toolbar's pinned height as --app-header-h, so anything further down the page
  // that wants to stick can sit below it without hard-coding a number that would drift.
  // Reads the computed position rather than the breakpoint: the bar is only sticky on
  // desktop, and a static bar scrolls away, contributing nothing to pin beneath.
  // WPBL renders at the desktop scale in styles.css rather than under a `zoom`, and that scale
  // keys on this attribute. An attribute rather than a class so it cannot collide with one, and
  // on the ROOT because --app-type is spent on the root font size, which is the only place a
  // `rem` will look. MLB is deliberately absent: it still runs the zoom, and a root font size
  // ramp on top of a 1.4 zoom would compound. Exactly one section is mounted at a time, so the
  // two never overlap.
  //
  // A LAYOUT EFFECT, AND THAT IS THE WHOLE FIX FOR THE JUMP ON A SECTION SWITCH. A plain
  // `useEffect` is passive: React runs it AFTER the browser has painted. The render that
  // changes `path` also changes the content box's `--app-zoom` in the same commit, so with the
  // attributes arriving a beat later there was one painted frame holding the NEW section's
  // zoom against the OLD section's root scale. Going to /mlb that frame is a 1.4 zoom on top
  // of a 1.25 root, and the tab bar under the toolbar drew half again too big before snapping
  // back; going the other way it drew unscaled and grew. Running before paint closes the
  // window completely, because the attributes then land in the same frame as the zoom they
  // belong with. Same reasoning as the scoreboard's placement in Home.tsx.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-scale-desktop', String(WPBL_DESKTOP_SCALE))
    if (isWpblSection(path)) root.setAttribute('data-app-scale', 'wpbl')
    else root.removeAttribute('data-app-scale')
    // The toolbar scales on BOTH sections, so switching between them moves nothing above the
    // content. Separate from the attribute above because the two sections are scaled by
    // different means and only the shell is shared; see the note in styles.css.
    if (path === '/mlb' || isWpblSection(path)) root.setAttribute('data-shell-scale', '1')
    else root.removeAttribute('data-shell-scale')
  }, [path])

  // Touch has no hover to prefetch on, so warm the other section once the current one has
  // settled. `requestIdleCallback` where it exists (not in Safari), a timeout otherwise, and
  // only for the two routes that have another section to go to.
  useEffect(() => {
    if (path !== '/mlb' && !isWpblSection(path)) return
    const run = () => preloadSection(path)
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (ric) { const id = ric(run, { timeout: 3000 }); return () => (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id) }
    const t = window.setTimeout(run, 1500)
    return () => window.clearTimeout(t)
  }, [path])

  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    const publish = () => {
      const pinned = el && getComputedStyle(el).position === 'sticky'
      // PUBLISHED IN REAL SCREEN PIXELS, AND A CONSUMER INSIDE A ZOOMED SECTION HAS TO
      // DIVIDE. The toolbar is no longer inside the `zoom` wrapper (it moved down to the
      // content box), so a rect and a CSS length are the same pixel here and there is
      // nothing left to divide out at this end. That is not true at the other end: a section
      // still running a `zoom` resolves its sticky `top` BEFORE the zoom, so it has to spend
      // this over its own `--app-zoom`. StatsView does exactly that, and the day the last
      // section drops its zoom the division there becomes a no-op and goes.
      //
      // The rect rather than `offsetHeight`, which rounds to a whole pixel: a bar 43.67px
      // tall published itself as 44 and left a sub-pixel crack under it for whatever sticks
      // below (see --wpbl-nav-h in WpblApp). Fractional CSS pixels are what the browser is
      // laying out in, so hand it those.
      document.documentElement.style.setProperty(
        '--app-header-h', pinned ? `${el!.getBoundingClientRect().height}px` : '0px')
    }
    publish()
    const ro = new ResizeObserver(publish)
    if (el) ro.observe(el)
    window.addEventListener('resize', publish)
    return () => { ro.disconnect(); window.removeEventListener('resize', publish) }
  }, [isDesktop, integratedHeader])

  // ── Toolbar search bridge ─────────────────────────────────────────────────
  const bridge = useSearchBridge()
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false)
  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  const [toolbarInputFocused, setToolbarInputFocused] = useState(false)

  // Results present from either the MLB player/team fields or the generic WPBL rows.
  const hasSearchResults =
    bridge.playerResults.length > 0 || bridge.teamResults.length > 0 || bridge.resultRows.length > 0

  /**
   * Whether the typed query is enough to search on.
   *
   * Two characters everywhere, with one exception: on the WPBL section a single digit is a
   * complete search, because it is a jersey number and no player's name contains one. Without
   * this the section's number search worked for "#3" and silently did nothing for "7", which is
   * the more natural way to type it. MLB keeps the two-character floor: its query is a network
   * call, and one character there is a request for the whole league.
   *
   * Four places below asked `bridge.query.length >= 2` independently, and a fifth asked for the
   * inverse to show the recents dropdown. They have to agree, or the results panel and the
   * recents panel are open at the same time.
   */
  const querySearchable = useMemo(() => {
    const q = bridge.query.trim()
    return q.length >= 2 || (bridge.source === 'wpbl' && jerseyQuery(q) != null)
  }, [bridge.query, bridge.source])

  useEffect(() => {
    setToolbarDropdownOpen(querySearchable && (hasSearchResults || bridge.searching))
  }, [querySearchable, hasSearchResults, bridge.searching])

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
    // WPBL pushes its own history entries (see WPBL_PATH_EVENT), so a tab switch there moves
    // the address bar without a popstate. Without this the shell's `path` would lag and
    // useSeo would keep serving the landing tab's title on every other tab.
    window.addEventListener(WPBL_PATH_EVENT, onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener(WPBL_PATH_EVENT, onPop)
    }
  }, [])

  // Bounce everyone but the owner off /admin. Gated on auth having RESOLVED, not merely on
  // `user` being absent: a hard refresh restores the session asynchronously, so redirecting
  // on the first render would eject the owner from their own dashboard before they arrived.
  // Cosmetic, like every other isAdmin check — the analytics RPCs behind the page reject a
  // non-owner on the server whether or not this runs.
  useEffect(() => {
    if (path === '/admin' && !authLoading && !isAdmin) navigate('/wpbl')
  }, [path, authLoading, isAdmin])

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
    <Box {...linkTo('/mlb')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
  )

  // Other mini apps (everything but MLB Stats) — opened from the admin menu now
  // that the site lands on /mlb directly.
  const otherApps = PROJECTS.filter(p => p.path !== '/mlb')
  const isAppLocked = useCallback((path: string) => LOCKED_PATHS.has(path) && !unlocked, [unlocked])
  const openApp = useCallback((path: string) => handleTileClick({ path }), [handleTileClick])

  return (
    // Plain root. The desktop scale moved down to the content box below the toolbar; the
    // note there says why.
    <Box>
      <AppBar
        ref={headerRef}
        // Scaled as one piece; see --app-shell in styles.css for why this is a `zoom` when the
        // rest of the rebuild was about removing one. --app-header-h needs no adjustment for
        // it: the publisher hands over a rect, which is already the on-screen height, and that
        // is exactly what a consumer outside this bar spends.
        style={{ zoom: 'var(--app-shell, 1)' }}
        // On mobile the top bar scrolls away (static) rather than sticking — the MLB/WPBL
        // toggle + search are rarely needed mid-scroll, and a single sticky bar (the WPBL
        // tab menu, pinned below) avoids the two-bar gap collapsing as you scroll.
        position={!isDesktop ? 'static' : integratedHeader ? 'sticky' : 'static'}
        color="default"
        elevation={integratedHeader ? 0 : 1}
        sx={{
          ...(integratedHeader ? {
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
          } : {}),
          // A SHORT viewport scrolls the bar away too, whatever its width. The rule above is
          // width-only, so a phone turned sideways lands in the desktop branch and pins 44px
          // of a 375px screen for a toggle and a search box, on top of whatever the page
          // pins under it: the stats board was left holding 135px of chrome and 240px of
          // screen. Portrait already answers this by scrolling the bar off, and the reason is
          // height, not width, so this says height.
          //
          // In CSS rather than beside `isDesktop`, because the two must agree and only one of
          // them can: `useMediaQuery` is JS state that has to be told to update, and an
          // orientation change is exactly when it is least trustworthy. The effect that
          // publishes --app-header-h reads the COMPUTED position and re-runs on resize, so it
          // follows this on its own and reports 0 the moment the bar stops holding anything.
          //
          // 560px is the stats table's threshold too (see StatsView), and deliberately the
          // same number: they are answering one question about one screen.
          '@media (max-height: 560px)': {
            position: 'static',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
          },
        }}
      >
        {/* The bar's own height is STRUCTURE, so it takes --app-chrome like the logo does. Left
            raw it was the one thing in here that did not scale on the section whose root
            carries the scale, and the bar came out 10px shorter there than on the other one:
            the two sections are supposed to be indistinguishable above the content. */}
        <Toolbar variant="dense" sx={{ minHeight: 'calc(48px * var(--app-chrome, 1))', py: 0.5 }}>
          {/* Close button — mobile search mode only */}
          {!isDesktop && mobileSearchExpanded && (
            <IconButton size="small" aria-label="Close search" onClick={() => { setMobileSearchExpanded(false); setSearchQuery('') }} sx={{ mr: 0.5, flexShrink: 0 }}>
              <Close fontSize="small" />
            </IconButton>
          )}

          {/* Brand name — hidden while mobile search is expanded. Version + What's
              new now live in the site footer. */}
          <Box sx={{
            flex: 1, minWidth: 0, display: mobileSearchExpanded && !isDesktop ? 'none' : 'flex',
            alignItems: 'center', gap: 0.75,
          }}>
            {/* Logo mark. The art is a black plate with the dolphin knocked out of it,
                so it vanishes against a near-black header; inverting it in dark mode
                gives a white plate with a dark dolphin instead. `display: block` keeps
                it off the text baseline, so the flex row centers the mark against the
                wordmark's line box rather than hanging it from the baseline. Always
                shown: it is the brand at every width the wordmark drops out of. */}
            {/* Wrapped in an anchor rather than given an onClick: an <img> cannot carry an
                href, and this is one of only two doors to /mlb. */}
            <Box
              {...linkTo('/mlb')}
              sx={{ ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', flexShrink: 0 }}
            >
              <Box
                component="img"
                src="/logo-mark.png"
                alt="sportydolphin"
                sx={{
                  // Art, so it rides --app-chrome like every other badge. That covers the
                  // section whose root is scaled; on the other one the bar's own `zoom` covers
                  // it instead, and --app-chrome is 1 there. Exactly one of the two applies, so
                  // the mark lands at the same size on both and never scales twice.
                  display: 'block', height: `calc(${BRAND_LOGO_H}px * var(--app-chrome, 1))`, width: 'auto',
                  cursor: 'pointer', userSelect: 'none',
                  ...(mode === 'dark' && { filter: 'invert(1)' }),
                }}
              />
            </Box>

            {/* Wordmark. It only earns its place once the toolbar can show it whole,
                so it appears at BRAND_WORDMARK_MIN and the logo carries the brand alone
                below that. The threshold is a raw px media query, not a theme
                breakpoint, because those match the real viewport while the layout here
                is divided by DESKTOP_ZOOM: the lockup wants ~308px of the ~964px the
                toolbar has to split at 1350, leaving a few px of slack even while the
                webfont is still loading and a wider fallback is being measured. */}
            <Typography
              variant="h6"
              {...linkTo('/mlb')}
              sx={{
                ...UNSTYLED_LINK,
                minWidth: 0, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'none',
                [`@media (min-width:${BRAND_WORDMARK_MIN}px)`]: { display: 'block' },
                // Take it back off between the two thresholds wherever the bar is scaled:
                // there the lockup is that much wider in the pixels the query counts, and it
                // would ellipsise into the search box instead.
                [`@media (max-width:${BRAND_WORDMARK_MIN_SCALED - 0.05}px)`]: {
                  'html[data-shell-scale] &': { display: 'none' },
                },
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
              // Warm the other section before the click; see preloadSection.
              onMouseEnter={() => preloadSection(path)}
              onFocus={() => preloadSection(path)}
              onPointerDown={() => preloadSection(path)}
              onClick={() => {
                // Every WPBL tab and /wpbl/api count as the WPBL side, so flipping from any
                // of them goes to MLB.
                const target = isWpblSection(path) ? '/mlb' : '/wpbl'
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
              {(path === '/mlb' || isWpblSection(path)) && (() => {
                const wpblActive = isWpblSection(path)
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
                // The SAME test the thumb above uses, which is the whole point: an exact path
                // match here meant that the day the WPBL tabs became real paths, /wpbl/stats
                // slid the rainbow across and left the label in unselected grey on top of it.
                // Every WPBL tab counts, and /wpbl/api too, so the switch stays "on WPBL" in
                // the docs.
                const active = seg.to === '/wpbl' ? isWpblSection(path) : path === seg.to
                const rainbow = active && seg.to === '/wpbl'
                return (
                  // An anchor, not a plain Box, purely so a crawler can see the two
                  // sections exist: the switch is what makes /mlb reachable at all.
                  // It only cancels the browser's navigation and lets the click bubble
                  // to the parent, which owns the toggle (and the confetti); handling
                  // it here as well would navigate twice on one click.
                  <Box
                    key={seg.to}
                    component="a"
                    href={seg.to}
                    onClick={e => e.preventDefault()}
                    sx={{
                      ...UNSTYLED_LINK,
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
                // Structure, same as the bar's height: this is a fixed box holding a field.
                width: isDesktop ? 'calc(260px * var(--app-chrome, 1))' : undefined,
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
                  {bridge.searching && querySearchable
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
                      if (querySearchable) setToolbarDropdownOpen(true)
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

                {/* Recent + suggestions dropdown — shown when input is focused and query is empty.
                    WPBL drives its own generic recent rows; MLB keeps its richer suggestions view. */}
                {toolbarInputFocused && !querySearchable && bridge.source === 'wpbl' && bridge.recentRows.length > 0 && (
                  <ToolbarRecentRowsDropdown
                    rows={bridge.recentRows}
                    onSelect={handleToolbarSelectRow}
                    onClear={() => bridge.clearRecentSearches?.()}
                  />
                )}
                {toolbarInputFocused && !querySearchable && bridge.source !== 'wpbl' && (bridge.recentSearches.length > 0 || bridge.toolbarSuggestions.length > 0) && (
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
                {toolbarDropdownOpen && querySearchable && hasSearchResults && (
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
              <IconButton size="small" aria-label="Search" onClick={() => setMobileSearchExpanded(true)} sx={{ color: 'text.secondary', mr: 0.25 }}>
                <Search />
              </IconButton>
            )}

            <NotificationBell onNavigate={navigate} />

            {/* Consolidated dev gear (local only) — skin picker, device/mobile
                simulation, notification tester, simulated login, and (on /mlb) the
                MLB simulators. Renders on every section, so the mobile toggle works
                in WPBL too. See src/dev/DevSettings.tsx. Never in a production build. */}
            {import.meta.env.DEV && <DevSettings showMlbTools={path === '/mlb'} showWpblTools={isWpblSection(path)} />}

            <IconButton
              onClick={toggleTheme}
              size="small"
              // Names the action rather than the state: a control called "Dark theme" is
              // ambiguous about whether it reports the current theme or the one it switches to.
              aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              sx={{ color: mode === 'dark' ? '#fbbf24' : 'text.secondary' }}
            >
              {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          {user ? (
            <ClickAwayListener onClickAway={() => setAccountOpen(false)}>
              <Box sx={{ position: 'relative' }}>
                {/* pressable(), not a bare onClick: this Box is the whole account control, and
                    the IconButton inside it is a `span`, so without a role and a tab stop the
                    signed-in menu (settings, sign out, the lot) could not be reached by
                    keyboard at all. The signed-out branch below is a real IconButton and was
                    never affected, which is why this stayed invisible. */}
                <Box
                  {...pressable(() => setAccountOpen(o => !o))}
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                    pl: isDesktop ? 1 : 0, pr: isDesktop ? 0.5 : 0, py: 0.25, borderRadius: 999,
                    '&:hover': { bgcolor: 'action.hover' },
                    ...FOCUS_RING,
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
                  {/* Presentational: the Box above is the control now. MUI's ButtonBase gives
                      a `component="span"` IconButton role="button" AND tabindex="0" of its own,
                      which put a second, nameless button inside this one and left a tab stop
                      that swallowed focus without doing anything, because the click handler was on the
                      parent, so Enter on it did nothing. Styling only, no semantics. */}
                  <IconButton
                    ref={accountBtnRef}
                    component="span"
                    size="small"
                    role="presentation"
                    tabIndex={-1}
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
                        onClick={() => { setAccountOpen(false); navigate('/admin') }}
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
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
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

      {/* THE DESKTOP SCALE LIVES BELOW THE TOOLBAR NOW, NOT AT THE APP ROOT.
        It used to wrap the whole app so the toolbar scaled with the view, which is a real
        thing to want and is why it sat up there. What it cost is that the shell and both
        sections shared one `zoom`, so nothing could be un-zoomed without un-zooming
        everything: see item 0 in ROADMAP-WPBL.md. Dropping it one level leaves the toolbar
        at real scale, where a rect and a CSS length are the same pixel again, and leaves
        every section exactly as it was.

        `--app-zoom` still inherits into the subtree for viewport-relative sizing that `zoom`
        cannot compensate. It is now UNSET above this box, which is the point: code in the
        shell reads 1 and means it. Portaled Dialogs, Menus and the Snackbar render in `body`
        and were never inside this, zoom or no zoom. */}
      <Box sx={{
        '--app-zoom': { xs: '1', md: path === '/mlb' ? String(DESKTOP_ZOOM) : '1' },
        zoom: 'var(--app-zoom)',
      }}>
        {/* The top padding is pinned in SCREEN pixels, which the sides are not.
            This box is shared by both sections and they are scaled by different means, so a
            single `p: 2` resolved to two different heights: 16px times --app-chrome on /wpbl,
            and 16px times MLB's 1.4 zoom on /mlb. 20 against 22.4, which put the tab bar under
            the toolbar 2.4px lower on one section than the other and made switching look like
            the bar hopped. Dividing by whatever zoom this box is under lands it at 20 screen
            pixels either way, and 20 is where both sections land anyway once /mlb takes its own
            turn at the 1.25 scale: this only gets it there early. Desktop only, so a phone keeps
            the ordinary 16px, and the sides keep ordinary spacing too, since nothing lines up
            across the switch horizontally and so nothing there can jump. */}
        <Box sx={{ px: 2, py: { xs: 2, md: 'calc(20px / var(--app-zoom, 1))' } }}>
          {path === '/cups' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <CupsGame />
              </Suspense>
            </Box>
          )}
          {path === '/stopwatch' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <Stopwatch />
              </Suspense>
            </Box>
          )}
          {path === '/weights' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <WeightGame />
              </Suspense>
            </Box>
          )}
          {path === '/poop' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <PoopGame />
              </Suspense>
            </Box>
          )}
          {path === '/testgame' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <TestGame />
              </Suspense>
            </Box>
          )}
          {path === '/mlb' && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <MlbStats />
            </Suspense>
          )}
          {isWpblPlayersIndex(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblPlayersIndex onNavigate={navigate} />
            </Suspense>
          )}
          {isWpblLeaguePage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblLeaguePage onNavigate={navigate} />
            </Suspense>
          )}
          {rendersWpblApp(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              {/* On mobile the WPBL tabs swipe, so the footer rides inside each tab pane (see
                  WpblApp) instead of sitting shared below them. The shared one is suppressed
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
                <Box {...linkTo('/wpbl')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700, userSelect: 'none', px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', transition: 'color 0.15s, border-color 0.15s, background-color 0.15s', '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' } }}>← Back to WPBL</Box>
              </Box>
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <WpblApiDocs />
              </Suspense>
            </Box>
          )}
          {path === '/admin' && authLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
          )}
          {path === '/admin' && !authLoading && isAdmin && (
            <Box>
              <Box sx={{ maxWidth: 860, mx: 'auto', px: { xs: 1.5, sm: 3 }, mb: 2 }}>
                <Box {...linkTo('/wpbl')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700, userSelect: 'none', px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', transition: 'color 0.15s, border-color 0.15s, background-color 0.15s', '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' } }}>← Back to WPBL</Box>
              </Box>
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <AdminPage apps={otherApps} isAppLocked={isAppLocked} onOpenApp={openApp} />
              </Suspense>
            </Box>
          )}
          {path === '/privacy' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <PrivacyPolicy />
              </Suspense>
            </Box>
          )}
          {path === '/terms' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <TermsOfService />
              </Suspense>
            </Box>
          )}
          {/* No auth gate, deliberately, and not a tempting one to add: the reader this page is
              for is the one who can no longer sign in. See DeleteAccount in LegalPages. */}
          {path === '/delete-account' && (
            <Box>
              {backBtn}
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <DeleteAccount />
              </Suspense>
            </Box>
          )}
        </Box>

        {/* On mobile WPBL the footer rides inside each swipeable tab pane (WpblApp's
            renderFooter) so it doesn't reflow when tabs of different heights swap, so skip
            the shared one there. Everywhere else (incl. desktop WPBL) it renders here. */}
        {!(rendersWpblApp(path) && !isDesktop) && (
          <SiteFooter
            onOpenChangelog={() => setChangelogOpen(true)}
            onOpenFeedback={() => setFeedbackOpen(true)}
            onNavigate={navigate}
            isWpbl={path.startsWith('/wpbl')}
          />
        )}
      </Box>

      {feedbackMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <FeedbackDialog
            open={feedbackOpen}
            onClose={() => setFeedbackOpen(false)}
            userId={user?.id ?? null}
            userEmail={user?.email ?? null}
          />
        </Suspense>
      )}

      {deactivatedMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <DeactivatedDialog open={deactivated} onClose={() => setDeactivated(false)} />
        </Suspense>
      )}

      {changelogMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <ChangelogDialogs open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        </Suspense>
      )}

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

      {user && usernameMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <UsernameDialog
            open={usernameOpen}
            onClose={() => setUsernameOpen(false)}
            userId={user.id}
            currentUsername={username}
            onSaved={setUsername}
          />
        </Suspense>
      )}

      {/* Settings is available to everyone; account-specific sections inside only
          render when signed in. */}
      {settingsMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            userId={user?.id ?? null}
            email={user?.email ?? ''}
            currentUsername={username}
            onEditUsername={() => { setSettingsOpen(false); setUsernameOpen(true) }}
            // Which section they came from, so the league block opens on the one in use.
            isWpbl={path.startsWith('/wpbl')}
          />
        </Suspense>
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
      <UnitsProvider>
        <EraBasisProvider>
          <ExperimentsProvider>
            <AccessibilityProvider>
              <AppInner />
            </AccessibilityProvider>
          </ExperimentsProvider>
        </EraBasisProvider>
      </UnitsProvider>
    </AuthProvider>
  )
}
