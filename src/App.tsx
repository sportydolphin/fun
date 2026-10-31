import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { ACCENT_EDGE } from './ui/card'
import { createPortal } from 'react-dom'
import { Typography, Box, IconButton, AppBar, Toolbar, Paper, ClickAwayListener, CircularProgress, Snackbar, Alert, useMediaQuery } from '@mui/material'
import {
  AccountCircle, Search, DarkModeOutlined, LightModeOutlined, SettingsOutlined, LogoutOutlined, LoginOutlined,
  PersonAddAltOutlined, InsightsOutlined,
} from '@mui/icons-material'
import { useSearchBridge, noteSearchFocus } from './mlb/state/SearchBridgeContext'
import type { PlayerBridgeItem, SearchResultRow, SearchResultAvatar } from './mlb/state/SearchBridgeContext'
import { requestSectionScroll } from './lib/sectionScroll'
import { MLB_PLAYER_PARTS, PLAYER_PART_LABEL, WPBL_PLAYER_PARTS, playerPartKey } from './lib/playerParts'
import type { PaletteAction, PaletteIdleGroup } from './CommandPalette'
import { HEADSHOT, TEAM_BG, TEAM_ABBR, ACCENT } from './mlb/constants'
import { useTheme } from './ThemeContext'
import { DevSettings, MobilePreviewHost } from './dev/DevSettings'
import { isInsideDeviceFrame } from './mlb/dev/devDevice'
import { isMlbPath, isMlbSection, isMlbGlossaryPage, isMlbComparePage, isMlbPostseasonPage, MLB_PATH_EVENT } from './mlb/routes'
import { preloadMlbViewFor } from './mlb/views/lazyViews'
import { saveDataOn } from './lib/saveData'
import { AuthProvider, useAuth } from './AuthContext'
import { UnitsProvider } from './UnitsContext'
import { EraBasisProvider } from './wpbl/EraBasisContext'
import { navigate, linkTo, NAVIGATED_EVENT, UNSTYLED_LINK, isModified } from './nav'
import { landsAtTop } from './lib/pageScroll'
import { withLoadTimeout } from './lib/staleBuild'
import { ExperimentsProvider } from './ExperimentsContext'
import { AccessibilityProvider } from './AccessibilityContext'
import { PENDING_USERNAME_PREFIX } from './AuthContext'
import { SiteFooter } from './SiteFooter'
import { pressable, FOCUS_RING } from './wpbl/ui'
import { NotificationBell } from './NotificationBell'
import { ToolbarNav } from './ToolbarNav'
import StandaloneBottomNav, { STANDALONE_NAV_QUERY } from './StandaloneBottomNav'
import { BOTTOM_NAV_SPACE } from './ui/BottomNav'
import { supabase } from './lib/supabase'
import { useSeo } from './seo'
// Import-free by design, so naming it here does not drag the lazy WPBL chunk into the
// entry bundle. See the note at the top of that file.
import { wpblPlayerSlugFromPath, wpblGameSlugFromPath, isWpblPlayersIndex, isWpblLeaguePage, isWpblGlossaryPage, isWpblSourcesPage, isWpblSeasonPage, isWpblScorigamiPage, isWpblMatchupsPage, isWpblPhotosPage, isWpblPhotoTagPage, isWpblReadingPage, isWpblWatchPage, isWpblWatchVideoPage, isWpblComparePage, isWpblSeriesPage, wpblAppOwnsPath, wpblGamePath, WPBL_PATH_EVENT } from './wpbl/routes'
import type { WpblGame, WpblTeam } from './wpbl/types'
import { jerseyQuery } from './wpbl/playerSearch'
import { defaultSectionPath } from './lib/defaultSection'
import { track, EVENTS } from './lib/analytics'
import { AppErrorBoundary } from './AppErrorBoundary'
import { usernameValidationMsg, isUsernameTaken, generateUniqueUsername } from './lib/usernames'
import { setDeactivationHandler, resetActiveCache } from './lib/userActive'

// Cosmetic gate only: decides whether the ⚡ Admin button renders. It grants NO
// privilege: every admin action is enforced server-side by RLS (public.is_site_owner(),
// see scripts/harden_admin_gate.sql), which reads the confirmed email from auth.users by
// the verified auth.uid() and can't be spoofed by faking this client value. Shared with
// the WPBL feature-flagged sections via src/lib/admin.ts.
import { ADMIN_EMAIL } from './lib/admin'
import { typePx } from './ui/scale'
import { SectionActiveContext, SectionSearchContext } from './lib/panelActive'
import { otherSectionPath } from './sectionSwitch'
import { ICON_SIZE, TYPE_SCALE } from './ui/card'

// The MLB feature is by far the largest part of the app. Code-split it so the
// landing page and other projects don't ship its ~entire view tree up front.
// The view the address opens is fetched BESIDE the section, not after it: each MLB view is its
// own chunk (mlb/views/lazyViews.ts), and waiting for MlbStats to ask for it would put a second
// round trip in front of every cold load. A warm from the WPBL side lands on /mlb, so Home.
const loadMlb = (path = window.location.pathname, search = window.location.search) => {
  preloadMlbViewFor(path, search)
  return import('./MlbStats')
}
const MlbStats = lazy(() => withLoadTimeout(() => loadMlb()))
// WPBL: a separate top-level league section (its own data + views). Lazy so it
// stays out of the MLB and landing bundles.
const loadWpbl = () => import('./wpbl/WpblApp')
const WpblApp = lazy(() => withLoadTimeout(loadWpbl))

/** Pull the OTHER section's chunk in before it is asked for.
 *
 *  THE SWITCH USED TO GO BLANK FOR A THIRD OF A SECOND. Both sections are lazy, so flipping the
 *  league switch unmounted one section's tab bar, showed a spinner while the other's chunk came
 *  over the wire, and then mounted the new bar: measured at 330ms one way and 580ms the other,
 *  on localhost. What a reader saw was the section's tab row vanishing and coming back somewhere
 *  slightly different, which reads as the page jumping even though nothing moved. (The tabs live
 *  in the toolbar now, drawn from static lists, so they no longer wait on a section's chunk.)
 *
 *  The module registry caches by specifier, so calling the same dynamic import ahead of time
 *  makes React.lazy resolve on the spot and the switch render in one commit with no fallback.
 *  Called on hover and focus, which covers a mouse and a keyboard, and once on an idle callback
 *  after the current section settles, which covers touch, where there is no hover to wait for.
 *  Failures are swallowed on purpose: this is a prefetch, and the real import will report any
 *  problem properly when the reader actually goes there. */
// How many recent searches the palette lists before anything is typed.

function preloadSection(path: string) {
  const p = isWpblSection(path) ? loadMlb('/mlb', '') : loadWpbl()
  p.catch(() => {})
}
// The flat players list at /wpbl/players. Its own chunk and its own route: it is a plain
// page, not one of the section's tabs, so it has no business waking WpblApp's state machine.
const WpblPlayersIndex = lazy(() => import('./wpbl/PlayersIndex'))
const WpblLeaguePage = lazy(() => import('./wpbl/LeaguePage'))
const WpblGlossaryPage = lazy(() => import('./wpbl/GlossaryPage'))
const MlbGlossaryPage = lazy(() => import('./mlb/GlossaryPage'))
const MlbPostseasonPage = lazy(() => import('./mlb/PostseasonPage'))
const MlbComparePage = lazy(() => import('./mlb/ComparePage'))
const WpblSourcesPage = lazy(() => import('./wpbl/SourcesPage'))
const WpblSeasonPage = lazy(() => import('./wpbl/SeasonPage'))
const WpblScorigami = lazy(() => import('./wpbl/Scorigami'))
const WpblMatchupsPage = lazy(() => import('./wpbl/MatchupsPage'))
const WpblSeriesPage = lazy(() => import('./wpbl/SeriesPage'))
const WpblPhotosGallery = lazy(() => import('./wpbl/PhotosGalleryPage'))
const WpblPhotoTagPage = lazy(() => import('./wpbl/PhotoTagPage'))
const WpblReadingPage = lazy(() => import('./wpbl/ReadingPage'))
const WpblWatchPage = lazy(() => import('./wpbl/WatchPage'))
// The game modal, hovering over a standalone page (see GameOverlayHost). Lazy so GameDetail's
// large chunk lands only on the first game opened from /wpbl/season or /wpbl/scorigami, not in
// the shell's entry chunk.
const WpblGameOverlayHost = lazy(() => import('./wpbl/GameOverlayHost'))
// The player modal, hovering over a standalone page (see PlayerOverlayHost), the twin of the game
// one above. Lazy for the same reason: PlayerDetail's chunk lands only on the first player opened
// from /wpbl/compare, /wpbl/players, /wpbl/league or /wpbl/season, not in the shell's entry chunk.
const WpblPlayerOverlayHost = lazy(() => import('./wpbl/PlayerOverlayHost'))
const WpblComparePage = lazy(() => import('./wpbl/Compare'))
const WpblApiDocs = lazy(() => import('./wpbl/ApiDocs'))
// The owner's dashboard. Its own route rather than a dialog: charts and tables need the
// room, and it pulls in the analytics RPC layer that nobody else should ever download.
const AdminPage = lazy(() => import('./AdminPage'))

// Both legal pages come from one module, so these two share a chunk.
const PrivacyPolicy = lazy(() => import('./LegalPages').then(m => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./LegalPages').then(m => ({ default: m.TermsOfService })))
const DeleteAccount = lazy(() => import('./LegalPages').then(m => ({ default: m.DeleteAccount })))

// Dialogs. Each is mounted only after it has been opened once (see `useOpenedOnce`), so its
// chunk is fetched on the click that needs it. SettingsDialog is the expensive one: it pulls
// in MLB's api + constants + color utilities, ~90 KB of source that has no business loading
// for someone reading WPBL box scores.
const SettingsDialog = lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })))
const FeedbackDialog = lazy(() => import('./FeedbackDialog').then(m => ({ default: m.FeedbackDialog })))
const UsernameDialog = lazy(() => import('./UsernameDialog').then(m => ({ default: m.UsernameDialog })))
const DeactivatedDialog = lazy(() => import('./DeactivatedDialog').then(m => ({ default: m.DeactivatedDialog })))
const ChangelogDialogs = lazy(() => import('./ChangelogDialogs'))
const CommandPalette = lazy(() => import('./CommandPalette'))

// Latch a dialog's "has ever been open" flag.
//
// Gating a lazy dialog on `open` alone would unmount it the instant it closes, which throws
// away MUI's close transition: the panel would vanish instead of fading. Latching means the
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
// public/_redirects as well, or it 404s in production and works fine in dev. The same goes for
// MLB's tabs, clubs and players under /mlb, which live in mlb/routes.ts (`isMlbPath`).
type Route = '/' | '/mlb' | '/wpbl' | '/wpbl/api' | '/privacy' | '/terms' | '/delete-account' | '/admin'

/** A section kept mounted across a switch to the other one (see keptMlb in App). Hidden with
 *  `display: none`, which also hides its fixed bottom bar; `contents` while shown, so the wrapper
 *  adds no box and the section lays out exactly as it did as a direct child. */
function KeptSection({ active, search, children }: { active: boolean; search: boolean; children: React.ReactNode }) {
  return (
    <SectionActiveContext.Provider value={active}>
      <SectionSearchContext.Provider value={search}>
        <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>
      </SectionSearchContext.Provider>
    </SectionActiveContext.Provider>
  )
}

/** Everything WpblApp renders. The players INDEX is its own page, so it is not here.
 *  Defined in routes.ts because WpblApp's popstate handler has to agree with it. */
const rendersWpblApp = wpblAppOwnsPath
/** Anything that should read as "the reader is in the WPBL section". */
const isWpblSection = (p: string) =>
  rendersWpblApp(p) || p === '/wpbl/api' || isWpblLeaguePage(p) || isWpblGlossaryPage(p)
  || isWpblSourcesPage(p) || isWpblSeasonPage(p) || isWpblScorigamiPage(p) || isWpblMatchupsPage(p) || isWpblPhotosPage(p) || isWpblPhotoTagPage(p) || isWpblReadingPage(p) || isWpblWatchPage(p) || isWpblWatchVideoPage(p) || isWpblPlayersIndex(p) || isWpblComparePage(p) || isWpblSeriesPage(p)
/** Whether some page draws this path; anything else gets the in-app 404. */
const isKnownPath = (p: string) =>
  isWpblSection(p) || isMlbSection(p) || p === '/' || p === '/admin' || p === '/privacy' || p === '/terms' || p === '/delete-account'

// Brand lockup in the toolbar. The logo is sized to the wordmark's line box so the
// two read as one unit, and the wordmark is held back until the viewport can show it
// without the ellipsis biting into it. See the toolbar brand block for the math.
const BRAND_LOGO_H = 32
// The section switch's WPBL fill. Its label is dark (#111), and each stop clears 4.5:1 against it:
// Apple's indigo #5856d6 was the one that did not (3.3:1), so it is lifted to #8a88ff. index.html's
// static copy of the bar repeats this gradient; change both.
const RAINBOW = 'linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #007aff, #8a88ff, #af52de, #ff3b30)'
// Where the toolbar holds the section tabs, the widths at which the search field and the handle
// beside the account icon come back inline. Measured, at the 1.25 desktop scale, with WPBL's
// tabs (the longer set, with the Stats dot) and the wordmark showing: brand, tabs, field and
// icons come to about 1420px with the field at its narrower width below, so 1480 leaves a gap
// that reads as one rather than a field parked against More.
const TOOLBAR_SEARCH_INLINE_MIN = 1480
// Below this the tabs take a second row of the same bar: logo, switch, five tabs, More and four
// icons come to about 920px at the scale, and the theme's `md` (900) would butt More against the
// search icon. A raw query, not a theme breakpoint, for the reason given at BRAND_WORDMARK_MIN.
const TOOLBAR_NAV_INLINE_MIN = 1024
const NAV_INLINE = `@media (min-width:${TOOLBAR_NAV_INLINE_MIN}px)`
const TOOLBAR_USERNAME_MIN = 1680
// TWO THRESHOLDS, BECAUSE THE TOOLBAR IS NOW TWO SIZES. The test never changed: does the
// toolbar have room to show the lockup whole. What changed is what "the toolbar" measures.
//
// On an unscaled route it gets the viewport in the same pixels the media query counts, so the
// test is met at 960. On a route running the desktop scale the same lockup is that much wider
// in those pixels, so the second threshold is simply the first times the scale: DERIVED rather
// than written down, because the two would otherwise drift the first time the scale moves, and
// the symptom would be a wordmark ellipsizing into the search box at one narrow band of widths
// that nobody thinks to check. Both are raw px queries rather than theme breakpoints for the
// original reason: theme breakpoints match the real viewport, and what is being asked about
// here is the toolbar's own width.
const BRAND_WORDMARK_MIN = 960
/** How much larger both sections render at md and up, now that they are scaled in CSS rather
 *  than under `zoom: 1.4` (/wpbl since Aug 31, 2026, /mlb since Oct 2026). Published as
 *  --app-scale-desktop for styles.css to spend on --app-type and --app-chrome; the breakpoint
 *  itself stays in CSS. ONE number for both on purpose: the toolbar rides the root scale, so two
 *  values would make it change size on a section switch. Moving it moves the whole site, the
 *  threshold below included. */
export const DESKTOP_SCALE = 1.25
const BRAND_WORDMARK_MIN_SCALED = Math.ceil(BRAND_WORDMARK_MIN * DESKTOP_SCALE)


// A one-shot confetti pop, fired when you flip the league switch to WPBL, a small nod to
// the section's playful side. Purely cosmetic: self-contained CSS, no library, `pointer-
// events: none` so it never blocks a tap, and it unmounts itself once the animation ends.
// Re-triggered by remounting with a fresh `key`, which reseeds the random spread.
//
// Portaled to <body> at fixed viewport coords (x/y = the WPBL segment's center): the AppBar
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
// Paths that are another spelling of a real page. Production answers these with a 301 from
// public/_redirects; this is the same fold for dev and for a link followed inside the app, which
// never reach that file and would otherwise draw an empty page.
const PATH_ALIASES: Record<string, string> = {
  '/wpbl/scores': '/wpbl/schedule',
}

function readPath(): string {
  // A YouTube id is case-sensitive, so a video's path is the one path that folding would break. It
  // also leaves the history entry alone, which is where the video's queue rides.
  if (isWpblWatchVideoPage(window.location.pathname)) return window.location.pathname
  const lower = window.location.pathname.toLowerCase()
  const p = PATH_ALIASES[lower] ?? lower
  if (p !== window.location.pathname) {
    window.history.replaceState({}, '', p + window.location.search + window.location.hash)
  }
  return p
}

// What card a URL names, for the standalone-page overlay: a player or a game, or null for anything
// else. The overlay is rebuilt from this on every history move, so a stack of them Backs card by card.
function overlayTargetFromUrl(url: string): { kind: 'game' | 'player'; slug: string } | null {
  const p = url.split(/[?#]/)[0]
  const player = wpblPlayerSlugFromPath(p)
  if (player) return { kind: 'player', slug: player }
  const game = wpblGameSlugFromPath(p)
  if (game) return { kind: 'game', slug: game }
  return null
}

// Retired players: show the years they played (e.g. "2001–2019") instead of just "Retired".
function retiredSpan(p: PlayerBridgeItem): string {
  const debutYear = p.mlbDebutDate?.slice(0, 4)
  const lastYear = p.lastPlayedDate?.slice(0, 4)
  if (debutYear && lastYear) return `${debutYear}–${lastYear}`
  if (debutYear) return `${debutYear}–`
  return 'Retired'
}

// A StatsAPI club's logo, as a palette row's avatar.
function mlbTeamAvatar(id: number): SearchResultAvatar {
  return { imageUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${id}.svg`, bg: TEAM_BG[id], fit: 'contain' }
}

function AppInner() {
  const { mode, toggleTheme, surfaces } = useTheme()
  const { user, loading: authLoading, signOut, openAuthDialog } = useAuth()
  // Root redirects straight to the reader's default section (WPBL unless they chose MLB in
  // Settings). MLB is the only other place to go, and the MLB | WPBL toggle is how you get there.
  const [path, setPath] = useState<Route | string>(() => {
    const p = readPath()
    if (p === '/') { const dest = defaultSectionPath(); window.history.replaceState({}, '', dest); return dest }
    return p as Route
  })
  const pathRef = useRef(path)
  pathRef.current = path
  // Keep <title>, meta description, canonical, and OG tags in sync with the route.
  useSeo(path)
  // A game or player opened from a STANDALONE page (/wpbl/season, /wpbl/compare, /wpbl/players, …),
  // drawn as a modal OVER that page rather than by routing to it. See GameOverlayHost for why:
  // routing would replace the page the reader is on with WpblApp's Home.
  //
  // URL-DRIVEN, and that is what lets a stack of them survive Back and Forward. The overlay is fully
  // described by the address bar (which card) plus `base`, the standalone page it hovers over, stored
  // on the history entry. So a reader can open a player from the compare tool, a game from that
  // player's log, another player from that game's box score, and Back walks the whole stack card by
  // card before returning to the page, because each entry rebuilds its own overlay from the URL. The
  // hosts resolve the slug and self-fetch (cached), so nothing but the slug has to be remembered.
  // `under` is the game a player panel was opened from, kept drawn beneath it. A player is a side
  // panel on a desktop and rises over the dialog it came from rather than replacing it, so the game
  // stays on screen under it, exactly as it does inside WpblApp. Stored on the history entry beside
  // the base, so Back and Forward rebuild both.
  const [overlay, setOverlay] = useState<{ base: string; kind: 'game' | 'player'; slug: string; under?: string } | null>(null)
  // The current overlay's base, read synchronously by an opener while stacking (so the new entry
  // hovers over the SAME page as the one below it). A ref because the opener needs it before the
  // state commit and it drives no render of its own.
  const overlayBaseRef = useRef<string | null>(null)
  // What is open right now, for the opener below, which is a stable callback and cannot read state.
  const overlayNowRef = useRef(overlay)
  overlayNowRef.current = overlay
  // Open a card as an overlay from its URL, stacking a new history entry on whatever is below. The
  // base is the page the FIRST overlay opened over, carried down the stack so every card hovers over
  // it; the entry stores it so Back and Forward can rebuild the overlay without WpblApp mounting
  // under it. Not a plain navigate: no popstate fires, so the shell's `path` stays the base page.
  //
  // EXCEPT, on a desktop, a card opened from the PAGE while a card is already open, which REPLACES
  // it. Both are the side panel, which leaves the page clickable so a reader can work down a list;
  // stacking an entry per row would make Back walk all of them before closing the panel. A link
  // followed INSIDE a card (`fromCard`: a player in the game's box score, a game in a player's log)
  // is a trip from that card and stacks, so Back returns to it. Same rule as WpblApp's openers.
  const openOverlayUrl = useCallback((url: string, fromCard = false) => {
    const target = overlayTargetFromUrl(url)
    if (!target) { navigate(url); return }
    const base = overlayBaseRef.current ?? readPath()
    overlayBaseRef.current = base
    const now = overlayNowRef.current
    // Desktop only, where both cards are the panel: on a phone they are sheets, which stack as they
    // always have. MUI's `md`, the same test ModalShell opens the panel on.
    const desktop = window.matchMedia('(min-width:900px)').matches
    const swap = desktop && !fromCard && !!now
    // A player opened from the game panel keeps that game drawn under it, behind "‹ Game".
    const under = desktop && fromCard && target.kind === 'player' && now?.kind === 'game' ? now.slug : undefined
    window.history[swap ? 'replaceState' : 'pushState'](
      { ...window.history.state, wpblOverlayBase: base, wpblOverlayUnder: under }, '', url)
    setOverlay({ base, ...target, under })
  }, [])
  // Kept for the pages that open a game with the datasets in hand (season, scorigami): they build
  // the URL through it, and the host self-resolves the rest.
  const openOverlayGame = useCallback((game: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => {
    openOverlayUrl(wpblGamePath(game, ctx.teams, ctx.games))
  }, [openOverlayUrl])
  // The same, for a game picked from INSIDE the player card's log: a trip from the card, which stacks.
  const openOverlayGameFromCard = useCallback((game: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => {
    openOverlayUrl(wpblGamePath(game, ctx.teams, ctx.games), true)
  }, [openOverlayUrl])
  // The onNavigate handed to the standalone WPBL pages (and the game overlay's own player links): a
  // link to a player or game page opens it as an overlay OVER the current page instead of routing to
  // WpblApp and seating Home beneath it. Every other destination navigates normally. This is the one
  // choke point, so a page added later gets the behavior by taking this as its `onNavigate` rather
  // than by re-wiring anything here.
  const navigateFromStandalone = useCallback((to: string) => {
    if (overlayTargetFromUrl(to)) openOverlayUrl(to)
    else navigate(to)
  }, [openOverlayUrl])
  // The game card's own player links, which stack (see openOverlayUrl's `fromCard`).
  const navigateFromGameCard = useCallback((to: string) => {
    if (overlayTargetFromUrl(to)) openOverlayUrl(to, true)
    else navigate(to)
  }, [openOverlayUrl])
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
  // EACH SECTION STAYS MOUNTED ONCE VISITED, hidden while the reader is in the other one, so
  // switching between the two Homes swaps two drawn pages instead of tearing one down and building
  // the other from skeletons and fresh fetches. The hidden one is told so (KeptSection) and stands
  // down: no polling, no address writes, no claim on the toolbar. Set during render, from the path
  // being drawn, so the first visit mounts in the same commit it always did.
  const keptMlb = useRef(false)
  const keptWpbl = useRef(false)
  if (isMlbPath(path)) keptMlb.current = true
  if (rendersWpblApp(path)) keptWpbl.current = true
  // The same, for a search opened on a standalone page of a section that was never visited (a
  // cold load of /wpbl/league): the palette's players and clubs come from the section, so it is
  // mounted then, hidden. Bumped rather than read from the ref alone, so it renders.
  const [, setKeptBump] = useState(0)
  const keepMlb = keptMlb.current
  const keepWpbl = keptWpbl.current
  // THE SECTION TABS LIVE IN THIS BAR above a phone's width (ToolbarNav, src/sectionNav.ts), and
  // they share it with the search field. Both fit inline only on a wide screen; below that the
  // field folds to an icon that opens it across the bar, the way a phone's does. In SCREEN pixels,
  // so the 1.25 desktop scale is already inside the number.
  const navSection = isWpblSection(path) ? 'wpbl' as const : isMlbSection(path) ? 'mlb' as const : null
  const hasToolbarNav = isDesktop && navSection !== null
  // A section's page that the section does not draw (the gallery, Reading, MLB's glossary): the shell
  // gives it the section's bottom bar on a phone, so no page of a section is without its tabs.
  const standaloneNav = navSection && !rendersWpblApp(path) && !isMlbPath(path) ? navSection : null
  const roomForSearch = useMediaQuery(`(min-width: ${TOOLBAR_SEARCH_INLINE_MIN}px)`)
  const roomForUsername = useMediaQuery(`(min-width: ${TOOLBAR_USERNAME_MIN}px)`)
  const searchCollapsed = !isDesktop || (hasToolbarNav && !roomForSearch)
  const showHandle = isDesktop && (!hasToolbarNav || roomForUsername) && !!(username || user?.user_metadata?.full_name)
  // TOOLBAR SPACING, one scale, measured on the visible edges rather than the boxes: 7.5px inside
  // the brand lockup (logo to name), 15 from the name to the MLB/WPBL switch, and 30 between
  // groups (switch to the first tab, the search field to the first icon) and at both screen
  // edges, which is the bar's own gutter. Tab labels sit 25 apart, from their padding, and the
  // icons 10. All at the 1.25 desktop scale; index.html's static bar carries the same numbers.

  // Publish the toolbar's pinned height as --app-header-h, so anything further down the page
  // that wants to stick can sit below it without hard-coding a number that would drift.
  // Reads the computed position rather than the breakpoint: the bar is only sticky on
  // desktop, and a static bar scrolls away, contributing nothing to pin beneath.
  // Both sections render at the desktop scale in styles.css, and that scale keys on this
  // attribute. An attribute rather than a class so it cannot collide with one, and on the ROOT
  // because --app-type is spent on the root font size, which is the only place a `rem` will look.
  // Off both sections (/admin, /privacy) the page and the toolbar stay at 1.
  //
  // A LAYOUT EFFECT, so the attribute lands in the same frame as the section it belongs to. A
  // plain `useEffect` runs after paint, which on a switch between a scaled route and an unscaled
  // one drew one frame of the new page at the old scale before snapping. It was worse while /mlb
  // ran a `zoom` (until Oct 2026), when that frame was a 1.4 zoom on top of a 1.25 root.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-scale-desktop', String(DESKTOP_SCALE))
    if (isWpblSection(path)) root.setAttribute('data-app-scale', 'wpbl')
    else if (isMlbSection(path)) root.setAttribute('data-app-scale', 'mlb')
    else root.removeAttribute('data-app-scale')
  }, [path])

  // Touch has no hover to prefetch on, so warm the other section once the current one has
  // settled. `requestIdleCallback` where it exists (not in Safari), a timeout otherwise, and
  // only for the two routes that have another section to go to.
  useEffect(() => {
    if (!isMlbSection(path) && !isWpblSection(path)) return
    // Not for a reader who has asked the browser to save data: about 300 KB of a section most
    // visitors never open, on a timer. The hover and focus prefetch still covers a reader who
    // reaches for the switch.
    if (saveDataOn()) return
    // NOT ON THE FIRST IDLE MOMENT. The page goes idle while it waits on the network, so an idle
    // callback alone fired at ~0.7s on production, and ~100 KB of the other section went out
    // right beside the first data reads, on the connection and the phone CPU the page still
    // needed. A few seconds' wait gets the page drawn first; a reader who flips the switch sooner
    // than that is covered by the hover and focus prefetch.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    let idle: number | null = null
    const t = window.setTimeout(() => {
      if (ric) idle = ric(() => preloadSection(path), { timeout: 3000 })
      else preloadSection(path)
    }, 4000)
    return () => {
      window.clearTimeout(t)
      if (idle != null) (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(idle)
    }
  }, [path])

  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    const publish = () => {
      const pinned = el && getComputedStyle(el).position === 'sticky'
      // Published in screen pixels, which is what every consumer spends now that no section runs
      // a `zoom` (until Oct 2026 /mlb did, and anything inside it had to divide this back out).
      //
      // The rect rather than `offsetHeight`, which rounds to a whole pixel: a bar 43.67px
      // tall published itself as 44 and left a sub-pixel crack under it for whatever sticks
      // below. Fractional CSS pixels are what the browser is
      // laying out in, so hand it those.
      document.documentElement.style.setProperty(
        '--app-header-h', pinned ? `${el!.getBoundingClientRect().height}px` : '0px')
    }
    publish()
    const ro = new ResizeObserver(publish)
    if (el) ro.observe(el)
    window.addEventListener('resize', publish)
    return () => { ro.disconnect(); window.removeEventListener('resize', publish) }
  }, [isDesktop])

  // ── Toolbar search bridge ─────────────────────────────────────────────────
  const bridge = useSearchBridge()
  // The search box (and on a phone, the icon that opens it) is drawn from the ROUTE, not from the
  // section registering with the bridge. Registration happens when the section's lazy chunk mounts,
  // about half a second into a cold load, and gating on it made the box appear late and shove every
  // icon beside it sideways on each refresh: the one layout shift left in the toolbar. The route is
  // known on the first frame, and the two sections that answer a search are exactly the ones that
  // mount below. A query typed in that half second waits in the bridge and is answered on arrival.
  //
  // EVERY PAGE OF EITHER SECTION, not only the ones its app draws. Until Oct 2026 this was
  // rendersWpblApp || isMlbPath, so the standalone pages (About the league, a season series,
  // Batter vs pitcher, Compare, the glossaries) lost the box and Ctrl+K: exactly the pages a
  // reader is most likely to want to leave by searching. The section answers from behind them
  // (SectionSearchContext, keptWpbl above).
  const searchShown = bridge.isRegistered || navSection !== null
  // STABLE, because MlbStats is memoized on it. This shell re-renders on every toolbar change (it
  // reads the search bridge), and with an inline footer here the whole MLB section re-rendered
  // with it: opening a team page from Home went round MlbStats and this shell three times, about
  // 5,000 component renders a pass, which was most of MLB's 232ms p75 interaction latency on phones.
  const renderMlbFooter = useCallback(() => (
    <SiteFooter
      onOpenChangelog={() => setChangelogOpen(true)}
      onOpenFeedback={() => setFeedbackOpen(true)}
      onNavigate={navigate}
      isMlb
    />
  ), [])
  // The same for WPBL, and for the same reason: WpblApp is memoized, and an inline footer here was
  // a new prop on every shell render, so the path change at the end of each tab click re-rendered
  // the whole section (and the tab just shown) a second time.
  const renderWpblFooter = useCallback(() => (
    <SiteFooter
      onOpenChangelog={() => setChangelogOpen(true)}
      onOpenFeedback={() => setFeedbackOpen(true)}
      onNavigate={navigate}
      isWpbl
    />
  ), [])
  // THE SEARCH IS THE PALETTE (CommandPalette.tsx). The field in this bar and the icon it folds
  // to are buttons that open it, and so are "/" and Ctrl+K (Cmd+K). Until Oct 2026 the field was
  // a real input with dropdowns of its own (results, recents, MLB's suggestions), beside a palette
  // that drove the same search bridge: two lists over one query, one of which had to be held shut
  // while the other typed. One box now does all of it, on every width.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteMounted = useOpenedOnce(paletteOpen)
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  // Which section's search this is. The bridge says once a section has registered; the route says
  // before that.
  const searchSection: 'wpbl' | 'mlb' = bridge.source ?? (isMlbSection(path) ? 'mlb' : 'wpbl')
  // `via` is how it was opened, which the palette cannot know for itself and is the first question
  // about it: does anyone find the shortcut, or is it all the field.
  const openPalette = useCallback((via: 'field' | 'icon' | 'slash' | 'shortcut') => {
    if (paletteOpen) return
    // The sections load their search data on the first focus of the search (onFirstSearchFocus),
    // which used to be the field's; opening the palette is that moment now.
    noteSearchFocus()
    // On a standalone page whose section is not mounted yet, mount it behind the page so it can
    // answer. Its search data loads now, the moment the field's first focus always loaded it.
    if (navSection === 'wpbl' && !keptWpbl.current) { keptWpbl.current = true; setKeptBump(n => n + 1) }
    if (navSection === 'mlb' && !keptMlb.current) { keptMlb.current = true; setKeptBump(n => n + 1) }
    track(EVENTS.COMMAND_PALETTE_OPENED, { section: searchSection, via })
    setPaletteOpen(true)
  }, [paletteOpen, searchSection, navSection])
  // "/" as on GitHub and YouTube, never while typing somewhere and never under a modal. Ctrl+K
  // fires from inside a field too, since a modifier chord cannot be typing, and closes the palette
  // again; it is the browser's own "search the web" key, so it is taken only where a section
  // answers a search.
  useEffect(() => {
    if (!searchShown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        if (paletteOpen) setPaletteOpen(false)
        else openPalette('shortcut')
        return
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.documentElement.hasAttribute('data-modal-open') || paletteOpen) return
      e.preventDefault()
      openPalette('slash')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchShown, paletteOpen, openPalette])
  // "Ctrl K" or "⌘K" on the field, for a reader with a keyboard and a mouse; a touch screen has
  // no shortcut to advertise. Read once: the platform does not change under a page.
  const shortcutLabel = useMemo(
    () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    [])
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)')

  /**
   * Whether the typed query is enough to search on.
   *
   * Two characters everywhere, with one exception: on the WPBL section a single digit is a
   * complete search, because it is a jersey number and no player's name contains one. MLB keeps
   * the two-character floor: its query is a network call, and one character there is a request
   * for the whole league.
   */
  const querySearchable = useMemo(() => {
    const q = bridge.query.trim()
    return q.length >= 2 || (bridge.source === 'wpbl' && jerseyQuery(q) != null)
  }, [bridge.query, bridge.source])

  // The section's own rows for the palette, in the one self-describing shape. WPBL publishes that
  // shape already; MLB's StatsAPI rows are drawn here.
  const paletteResults = useMemo<SearchResultRow[]>(() => {
    if (!paletteOpen || !querySearchable) return []
    // "Ohtani splits": a player row says where it will open, and asks for the scroll as it opens.
    // Here rather than in each section because both build their rows from the same query, and the
    // part is the palette's reading of it. Only a part the section's card draws.
    const parts = bridge.source === 'wpbl' ? WPBL_PLAYER_PARTS : MLB_PLAYER_PARTS
    const part = bridge.queryPart && parts.has(bridge.queryPart) ? bridge.queryPart : null
    const atPart = (row: SearchResultRow): SearchResultRow => !part ? row : {
      ...row,
      subtitle: [row.subtitle, `opens at ${PLAYER_PART_LABEL[part]}`].filter(Boolean).join(' · '),
      onSelect: () => { requestSectionScroll(playerPartKey(part)); row.onSelect() },
    }
    // Which rows the forgiving pass found, so the pick can say so (/admin's Search box card).
    const forgiven = (row: SearchResultRow, isPlayer: boolean): SearchResultRow =>
      (isPlayer ? bridge.resultsForgiving.players : bridge.resultsForgiving.teams) ? { ...row, forgiving: true } : row
    if (bridge.source === 'wpbl') {
      return bridge.resultRows.map(r => (r.key.startsWith('player-') ? forgiven(atPart(r), true) : forgiven(r, false)))
    }
    return [
      ...bridge.playerResults.slice(0, 6).map(p => {
        const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
        const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id as number] : undefined
        return forgiven(atPart({
          key: `player-${p.id}`, title: p.fullName,
          subtitle: (p.active === false ? [pos, retiredSpan(p)] : [pos, teamAbbr]).filter(Boolean).join(' | '),
          avatar: { imageUrl: HEADSHOT(p.id), bg: 'grey.200', fit: 'cover' as const },
          onSelect: () => bridge.handleSelectPlayer?.(p, bridge.querySeason),
        }), true)
      }),
      ...bridge.teamResults.slice(0, 3).map(t => {
        const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
        const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
        return forgiven({
          key: `team-${t.id}`, title: t.name, subtitle: [leagueShort, divShort].filter(Boolean).join(' · ') || 'Team',
          avatar: mlbTeamAvatar(t.id),
          onSelect: () => bridge.handleSelectTeam?.(t),
        }, false)
      }),
    ]
  }, [paletteOpen, querySearchable, bridge])

  // What the palette shows before anything is typed: the section's recents, whole. The palette
  // merges in the questions this device asked and shows only the first few of the lot, so the
  // stat-search examples below them stay in view (PALETTE_RECENTS in CommandPalette.tsx). MLB's
  // "Your team" / "Trending" groups were dropped for the same reason.
  const paletteIdle = useMemo<PaletteIdleGroup[]>(() => {
    if (!paletteOpen) return []
    if (bridge.source === 'wpbl') {
      return bridge.recentRows.length
        ? [{ label: 'Recent', kind: 'recent', rows: bridge.recentRows, onClear: bridge.clearRecentSearches ?? undefined }]
        : []
    }
    const recents = bridge.recentSearches
    if (!recents.length) return []
    return [{
      label: 'Recent', kind: 'recent', onClear: bridge.clearRecentSearches ?? undefined,
      rows: recents.map(r => ({
        // The same key as the result row it was picked from, so the palette's pick times line up.
        key: `${r.type}-${r.id}`, title: r.name,
        subtitle: r.type === 'player' ? [r.position, r.teamId ? TEAM_ABBR[r.teamId] : null].filter(Boolean).join(' · ') : 'Team',
        avatar: r.type === 'player' ? { imageUrl: HEADSHOT(r.id), bg: 'grey.200', fit: 'cover' as const } : mlbTeamAvatar(r.id),
        onSelect: () => bridge.handleSelectRecent?.(r),
      })),
    }]
  }, [paletteOpen, bridge])

  // What the site does, as rows the search can offer ("dark mode", "send feedback"). Each is a control
  // already in the toolbar, the account menu or the footer; the search is one more way to reach it,
  // and the only one that does not need the reader to know where it lives.
  const paletteActions = useMemo<PaletteAction[]>(() => [
    { key: 'theme', title: mode === 'dark' ? 'Light mode' : 'Dark mode', hint: 'Switch the theme',
      words: ['dark mode', 'light mode', 'theme', 'night mode', 'dark', 'light'], run: toggleTheme },
    { key: 'settings', title: 'Settings', hint: 'Units, text size, swiping and more',
      words: ['preferences', 'options', 'text size', 'units', 'accessibility'], run: () => setSettingsOpen(true) },
    { key: 'changelog', title: 'What’s new', hint: 'Every change to the site',
      words: ['whats new', 'what is new', 'changelog', 'updates', 'release notes', 'version'], run: () => setChangelogOpen(true) },
    { key: 'feedback', title: 'Send feedback', hint: 'A bug, an idea, or a missing stat',
      words: ['feedback', 'report a bug', 'bug', 'contact', 'suggestion', 'idea'], run: () => setFeedbackOpen(true) },
    ...(user ? [] : [{ key: 'signin', title: 'Sign in', hint: 'Keep your recents and picks on every device',
      words: ['log in', 'login', 'sign up', 'account', 'register'], run: () => openAuthDialog('signin') }]),
  ], [mode, toggleTheme, user, openAuthDialog])

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

  // Fetch username whenever the logged-in user changes. If the account doesn't
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
          // Race. Someone grabbed it between our check and the insert. Fall back to a fresh random one.
          final = await generateUniqueUsername()
          ;({ error } = await supabase.from('usernames').upsert({ user_id: user.id, username: final }, { onConflict: 'user_id' }))
        }
        if (cancelled) return
        if (pendingKey) localStorage.removeItem(pendingKey)
        if (!error) setUsername(final)
      })

    return () => { cancelled = true }
    // KEYED ON THE ID, NOT THE OBJECT. Supabase hands over a new `user` on every token refresh,
    // and this read can assign a username, so following the object would re-run it hourly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Register the shared write-gate's reaction: if any DB write catches this account
  // as deactivated mid-session, show the notice and sign out (same as the sign-in
  // block above). Clear the active-user cache on sign-out so the next account starts
  // clean. See src/lib/userActive.ts.
  useEffect(() => {
    setDeactivationHandler(() => { setDeactivated(true); void signOut() })
    return () => setDeactivationHandler(null)
  }, [signOut])
  const userId = user?.id
  useEffect(() => { if (!userId) resetActiveCache() }, [userId])

  // Dev mobile sim: inside the phone frame, translate mouse click-drag into touch
  // events so finger-driven swipes (tab pager, leaders category swipe) are testable.
  useEffect(() => {
    if (!import.meta.env.DEV || !isInsideDeviceFrame) return
    let cleanup: (() => void) | undefined
    void import('./mlb/dev/mouseTouchBridge').then(m => { cleanup = m.installMouseTouchBridge() })
    return () => cleanup?.()
  }, [])


  useEffect(() => {
    const onPop = () => {
      // A standalone-page overlay is rebuilt from the entry we landed on, so Back and Forward walk a
      // stack of cards over the page one at a time. An entry carries `wpblOverlayBase` (the page the
      // stack hovers over) only while it was seated by an overlay open, which was a silent
      // push/replaceState (no popstate), so this only runs on the way back through: Back, the X
      // (history.back), Forward, or a normal navigation off the stack.
      const p = readPath()
      const base = (window.history.state?.wpblOverlayBase as string | undefined) ?? null
      const target = base ? overlayTargetFromUrl(p) : null
      if (base && target) {
        overlayBaseRef.current = base
        const under = target.kind === 'player'
          ? (window.history.state?.wpblOverlayUnder as string | undefined) : undefined
        setOverlay({ base, ...target, under })
        setPath(base as Route)   // keep the page beneath mounted; the overlay draws on top of it
        return
      }
      // Not an overlay entry: clear any open overlay and route to the URL as usual.
      overlayBaseRef.current = null
      setOverlay(null)
      if (p === '/') { const dest = defaultSectionPath(); window.history.replaceState({}, '', dest); setPath(dest); return }
      setPath(p as Route)
    }
    // Ahead of the render, so the new page never paints at the old one's depth.
    const onNavigated = () => { if (landsAtTop(pathRef.current, readPath())) window.scrollTo(0, 0) }
    window.addEventListener(NAVIGATED_EVENT, onNavigated)
    window.addEventListener('popstate', onPop)
    // WPBL pushes its own history entries (see WPBL_PATH_EVENT), so a tab switch there moves
    // the address bar without a popstate. Without this the shell's `path` would lag and
    // useSeo would keep serving the landing tab's title on every other tab.
    window.addEventListener(WPBL_PATH_EVENT, onPop)
    // MLB the same, since its tabs and pages became paths (Oct 2026).
    window.addEventListener(MLB_PATH_EVENT, onPop)
    return () => {
      window.removeEventListener(NAVIGATED_EVENT, onNavigated)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener(WPBL_PATH_EVENT, onPop)
      window.removeEventListener(MLB_PATH_EVENT, onPop)
    }
  }, [])

  // Bounce everyone but the owner off /admin. Gated on auth having RESOLVED, not merely on
  // `user` being absent: a hard refresh restores the session asynchronously, so redirecting
  // on the first render would eject the owner from their own dashboard before they arrived.
  // Cosmetic, like every other isAdmin check: the analytics RPCs behind the page reject a
  // non-owner on the server whether or not this runs.
  useEffect(() => {
    if (path === '/admin' && !authLoading && !isAdmin) navigate('/wpbl')
  }, [path, authLoading, isAdmin])

  const backBtn = (
    <Box {...linkTo('/mlb')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>‹ Back</Box>
  )

  // The section the brand lockup returns to. A reader in WPBL who clicks the logo means "home",
  // and home is /wpbl for them; everywhere else it stays /mlb, which is where the brand link has
  // always pointed and the one place non-section pages have a real link back into an app.
  const brandHome = isWpblSection(path) ? '/wpbl' : '/mlb'

  // The theme switch, as a row of the account menu rather than a toolbar icon. In the bar it was
  // a yellow sun, the most saturated thing on every page, for a setting most readers make once;
  // the bar is also tightest on a phone. Settings and the command palette still offer it too. The
  // menu stays open, so the reader sees the page change under it and can flip it straight back.
  const themeRow = (
    <AccountMenuRow
      onPress={toggleTheme}
      icon={mode === 'dark' ? LightModeOutlined : DarkModeOutlined}
      label={mode === 'dark' ? 'Light theme' : 'Dark theme'}
      // Names the action rather than the state: a control called "Dark theme" is ambiguous about
      // whether it reports the current theme or the one it switches to.
      ariaLabel={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    />
  )

  return (
    // Plain root. The desktop scale moved down to the content box below the toolbar; the
    // note there says why.
    <Box>
      <AppBar
        ref={headerRef}
        // On mobile the top bar scrolls away (static) rather than sticking. The MLB/WPBL
        // toggle + search are rarely needed mid-scroll, and a single sticky bar (the WPBL
        // tab menu, pinned below) avoids the two-bar gap collapsing as you scroll.
        position={!isDesktop ? 'static' : 'sticky'}
        color="default"
        elevation={0}
        sx={{
          // Same tint as the page, separated by a hairline and a blur rather than sitting as a
          // lighter slab over it: the header is chrome, not something floating.
          top: 0,
          bgcolor: surfaces.headerBg,
          backgroundImage: 'none',
          // Blur only on desktop, where the header is sticky and content actually passes
          // under it. On mobile the bar scrolls away with the page, so the blur is purely
          // decorative, and backdrop-filter makes the AppBar a stacking context that traps
          // the account dropdown (z-index 1400) below page content like the sticky tab bar
          // (z-index 3). Dropping it on mobile lets the dropdown render in front of the page.
          ...(isDesktop && { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }),
          // AND NOT WHILE A MODAL IS OPEN. A full-viewport backdrop filter is expensive to
          // invalidate, and under a modal's 60% dim this one cannot be seen at all: it is pure
          // cost, paid on every repaint anywhere in the dialog above it. ModalShell publishes
          // the attribute (see its effect, which counts nesting). CSS rather than JS state so
          // the bar never re-renders for it.
          'html[data-modal-open] &': { backdropFilter: 'none', WebkitBackdropFilter: 'none' },
          borderBottom: '1px solid',
          borderColor: 'divider',
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
        <Toolbar variant="dense" sx={{
          minHeight: 'calc(48px * var(--app-chrome, 1))', py: 0.5,
        }}>
          {/* Brand name — hidden while mobile search is expanded. Version + What's
              new now live in the site footer. */}
          <Box sx={{
            flex: 1, minWidth: 0, ...(hasToolbarNav && { [NAV_INLINE]: { flex: '0 0 auto' } }),
            display: 'flex',
            alignItems: 'center', gap: 0.75,
          }}>
            {/* Logo mark. The art is a black plate with the dolphin knocked out of it,
                so it vanishes against a near-black header; inverting it in dark mode
                gives a white plate with a dark dolphin instead. `display: block` keeps
                it off the text baseline, so the flex row centers the mark against the
                wordmark's line box rather than hanging it from the baseline. Always
                shown: it is the brand at every width the wordmark drops out of. */}
            {/* THE BRAND GOES TO THE CURRENT SECTION'S HOME, not always to /mlb. Clicking the
                lockup from a WPBL page dropped the reader into MLB, which is a section switch
                dressed as a home button. /mlb stays crawlable without this link: the league
                switch segments below and the footer both carry a real <a href="/mlb">.
                Wrapped in an anchor rather than given an onClick because an <img> cannot carry
                an href. */}
            <Box
              {...linkTo(brandHome)}
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
                breakpoint, and is scaled with DESKTOP_SCALE on the two sections: see the
                note at BRAND_WORDMARK_MIN. */}
            <Typography
              variant="h6"
              {...linkTo(brandHome)}
              sx={{
                ...UNSTYLED_LINK,
                minWidth: 0, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'none',
                [`@media (min-width:${BRAND_WORDMARK_MIN}px)`]: { display: 'block' },
                // Take it back off between the two thresholds wherever the bar is scaled:
                // there the lockup is that much wider in the pixels the query counts, and it
                // would ellipsize into the search box instead.
                [`@media (max-width:${BRAND_WORDMARK_MIN_SCALED - 0.05}px)`]: {
                  'html[data-app-scale] &': { display: 'none' },
                },
              }}
            >
              sportydolphin
            </Typography>

            {/* League switcher: MLB | WPBL, a thumb that glides between two equal halves, rainbow on
                the WPBL side and the solid accent on MLB.
                EACH HALF IS A LINK TO ITS OWN LEAGUE. Until Oct 15, 2026 the whole control was one
                toggle, so pressing "WPBL" while on WPBL took the reader to MLB: the label promised
                the opposite of what it did. The lit half is the page you are on (aria-current) and
                does nothing. A plain group, not a button holding two links, which nested one
                control in another for a screen reader. */}
            <Box
              ref={leagueSwitchRef}
              role="group"
              aria-label="League"
              sx={{
              // Equal-width columns (grid, not flex) so both segments are the same
              // width regardless of label length, otherwise MLB would be narrower
              // than WPBL and the 50% thumb wouldn't line up with either segment.
              position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', flexShrink: 0,
              // Twice the lockup's own gap: the switch is a control of its own, and at the lockup's
              // spacing it read as part of the name. See TOOLBAR SPACING below.
              ml: 0.75,
              p: '2px', borderRadius: 999,
              border: '1px solid', borderColor: ACCENT_EDGE, bgcolor: `${ACCENT}14`,
            }}>
              {(isMlbSection(path) || isWpblSection(path)) && (() => {
                const wpblActive = isWpblSection(path)
                return (
                  <Box sx={{
                    position: 'absolute', top: '2px', bottom: '2px', left: '2px',
                    width: 'calc(50% - 2px)', borderRadius: 999,
                    transform: wpblActive ? 'translateX(100%)' : 'translateX(0)',
                    transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
                    // WPBL side: the rainbow gently pans (repeat the first stop at the end so
                    // the 200%-wide fill loops seamlessly). MLB stays a plain accent fill. The pan
                    // stops for a reader who asked for less motion: styles.css collapses every
                    // animation under prefers-reduced-motion and the Settings override.
                    ...(wpblActive
                      ? {
                          background: RAINBOW,
                          backgroundSize: '200% 100%',
                          animation: 'wpblShimmer 4s linear infinite',
                          '@keyframes wpblShimmer': {
                            '0%':   { backgroundPosition: '0% 50%' },
                            '100%': { backgroundPosition: '200% 50%' },
                          },
                        }
                      // The solid accent, not the raw #60a5fa: the white "MLB" on it measured 2.5:1.
                      : { background: 'var(--wpbl-accent-solid)' }),
                  }} />
                )
              })()}
              {[{ label: 'MLB', to: '/mlb' }, { label: 'WPBL', to: '/wpbl' }].map(seg => {
                // The SAME test the thumb above uses, which is the whole point: an exact path
                // match here meant that the day the WPBL tabs became real paths, /wpbl/stats
                // slid the rainbow across and left the label in unselected gray on top of it.
                // Every WPBL tab counts, and /wpbl/api too, so the switch stays "on WPBL" in
                // the docs.
                const toWpbl = seg.to === '/wpbl'
                const active = toWpbl ? isWpblSection(path) : isMlbSection(path)
                const rainbow = active && toWpbl
                return (
                  // A real anchor, so a crawler can see both sections exist: the switch is what
                  // makes /mlb reachable at all. The href is the league's root; the click goes to
                  // the same page in the other league where it has one (sectionSwitch.ts).
                  <Box
                    key={seg.to}
                    component="a"
                    href={seg.to}
                    aria-current={active ? 'page' : undefined}
                    // Warm the other section before the click; see preloadSection.
                    onMouseEnter={active ? undefined : () => preloadSection(path)}
                    onFocus={active ? undefined : () => preloadSection(path)}
                    onPointerDown={active ? undefined : () => preloadSection(path)}
                    onClick={(e: React.MouseEvent) => {
                      // Modified clicks open a new tab the browser's way.
                      if (isModified(e)) return
                      e.preventDefault()
                      if (active) return
                      const target = otherSectionPath(path, isWpblSection(path), window.location.search)
                      if (toWpbl) {
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
                      ...UNSTYLED_LINK, ...FOCUS_RING,
                      position: 'relative', zIndex: 1, textAlign: 'center',
                      // Bigger than it was (0.66rem over 3px, about 20px tall in all): the switch is
                      // the only way to /mlb from the bar, and it was the smallest target on it.
                      px: 1.1, py: '5px', borderRadius: 999, userSelect: 'none',
                      cursor: active ? 'default' : 'pointer',
                      fontSize: TYPE_SCALE.meta, fontWeight: 800, letterSpacing: typePx(0.3), lineHeight: 1,
                      // Dark on the rainbow: white measured 1.5:1 on its yellow. With RAINBOW's
                      // lightened indigo every stop clears 4.5:1 against this ink.
                      color: rainbow ? '#111' : active ? '#fff' : 'text.secondary',
                      transition: 'color 0.2s',
                      '&:hover': { color: rainbow ? '#111' : active ? '#fff' : 'text.primary' },
                      // A finger-sized target on a touch screen without a taller pill: the hit area
                      // reaches past the visible edge, above and below, into the bar's own padding.
                      '@media (pointer: coarse)': {
                        '&::after': { content: '""', position: 'absolute', left: 0, right: 0, top: '-8px', bottom: '-8px' },
                      },
                    }}
                  >
                    {seg.label}
                  </Box>
                )
              })}
              {confetti && <ConfettiBurst key={confetti.key} x={confetti.x} y={confetti.y} onDone={() => setConfetti(null)} />}
            </Box>
          </Box>

          {/* The section tabs, beside the brand on a wide screen. Narrower than that the bar cannot
              hold brand, tabs and icons on one line, and the tabs take a row of their own under
              this one (below the Toolbar). */}
          {hasToolbarNav && (
            <ToolbarNav
              section={navSection!}
              path={path}
              sx={{
                display: 'none',
                // Reach through the bar's own vertical padding so the lit tab's stripe sits on
                // the bar's bottom hairline.
                // 1.75 plus a tab's own 1.25 of padding puts "Home" one GROUP gap (30px at the
                // desktop scale) from the switch. See TOOLBAR SPACING.
                [NAV_INLINE]: { display: 'flex', ml: 1.75, my: -0.5 },
              }}
            />
          )}
          {hasToolbarNav && <Box sx={{ flex: 1, display: 'none', [NAV_INLINE]: { display: 'block' } }} />}

          {/* The search field: a button that opens the palette, drawn as the field it was so the bar
              keeps its shape. Folded to an icon (below) wherever there is no room for it. */}
          {searchShown && !searchCollapsed && (
            <Box
              component="button"
              type="button"
              onClick={() => openPalette('field')}
              aria-label="Search players, clubs, pages or a stat question"
              aria-keyshortcuts="Control+K Meta+K /"
              aria-haspopup="dialog"
              sx={{
                // Structure: a fixed box holding a field. Narrower beside the tabs, where the bar has
                // a fourth thing to hold.
                width: `calc(${hasToolbarNav ? 220 : 260}px * var(--app-chrome, 1))`,
                mx: 1.5,
                // Beside the tabs, one group gap to the first icon: 2.5 plus that button's 5px of
                // padding. Elsewhere the field is centered and keeps 1.5 both sides.
                ...(hasToolbarNav && { mr: 2.5 }),
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.5, py: 0.55,
                borderRadius: 999,
                border: '1.5px solid',
                borderColor: paletteOpen ? ACCENT_EDGE : 'outline',
                bgcolor: 'background.paper',
                transition: 'border-color 0.2s',
                cursor: 'text', font: 'inherit', textAlign: 'left', color: 'inherit',
                '&:hover': { borderColor: ACCENT_EDGE },
                '&:focus-visible': FOCUS_RING,
              }}
            >
              <Search sx={{ fontSize: ICON_SIZE.sm, color: 'text.secondary', flexShrink: 0 }} />
              <Box component="span" sx={{
                flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, color: 'text.secondary',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {/* Not "player or team" any more: it finds pages and stat questions too, and beside the
                    shortcut badge the longer words were cut to "Search player or te…". */}
                Search…
              </Box>
              {finePointer && (
                <Box component="kbd" aria-hidden sx={{
                  flexShrink: 0, fontFamily: 'inherit', fontSize: TYPE_SCALE.micro, fontWeight: 700, lineHeight: 1.4,
                  color: 'text.secondary', px: 0.6, borderRadius: 1, border: '1px solid', borderColor: 'outline',
                }}>
                  {shortcutLabel}
                </Box>
              )}
            </Box>
          )}

          {/* Right-side icons — flex:1 on desktop so they balance the brand and keep search centered */}
          {/* Pulled out by the last button's own padding (and the handle pill's, when it shows),
              so the avatar's edge sits the bar's gutter from the screen edge, as the logo does on
              the left. It sat 5px further in. See TOOLBAR SPACING. */}
          <Box sx={{
            flex: isDesktop && !hasToolbarNav ? 1 : undefined, display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            mr: user && showHandle ? '-10px' : '-5px',
          }}>
            {/* Search icon wherever the field is folded away (a phone, or beside the tabs on a
                narrower desktop). Opens the same palette. */}
            {searchShown && searchCollapsed && (
              <IconButton size="small" aria-label="Search" aria-haspopup="dialog" onClick={() => openPalette('icon')} sx={{ color: 'text.secondary' }}>
                <Search />
              </IconButton>
            )}

            <NotificationBell onNavigate={navigate} />

            {/* Consolidated dev gear (local only) — skin picker, device/mobile
                simulation, notification tester, simulated login, and (on /mlb) the
                MLB simulators. Renders on every section, so the mobile toggle works
                in WPBL too. See src/dev/DevSettings.tsx. Never in a production build. */}
            {import.meta.env.DEV && <DevSettings showMlbTools={isMlbPath(path)} showWpblTools={isWpblSection(path)} />}

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
                    // Room for the handle only when the handle is drawn. Beside the tabs below
                    // TOOLBAR_USERNAME_MIN it is not, and the padding left a lopsided hover pill.
                    pl: showHandle ? 1 : 0, pr: showHandle ? 0.5 : 0, py: 0.25, borderRadius: 999,
                    '&:hover': { bgcolor: 'action.hover' },
                    ...FOCUS_RING,
                  }}
                >
                  {showHandle && (
                    <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {username ? (
                        // The Roboto/Arial "@" dips toward the baseline and reads as sitting
                        // low next to the lowercase handle. Nudge it up a hair to optically center.
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
                  <Paper elevation={8} role="menu" aria-label="Account" sx={ACCOUNT_MENU_SX}>
                    {/* User info */}
                    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      {/* Username (primary) or full name if no username */}
                      {username ? (
                        <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.title, lineHeight: 1.3, mb: 0.2 }}>
                          @{username}
                        </Typography>
                      ) : user.user_metadata?.full_name ? (
                        <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.title, lineHeight: 1.3, mb: 0.2 }}>
                          {user.user_metadata.full_name}
                        </Typography>
                      ) : null}
                      <Typography sx={{
                        fontSize: (username || user.user_metadata?.full_name) ? TYPE_SCALE.meta : TYPE_SCALE.title,
                        fontWeight: (username || user.user_metadata?.full_name) ? 400 : 600,
                        color: (username || user.user_metadata?.full_name) ? 'text.secondary' : 'text.primary',
                        lineHeight: 1.3, wordBreak: 'break-all',
                      }}>
                        {user.email}
                      </Typography>
                    </Box>

                    <Box sx={ACCOUNT_MENU_GROUP_SX}>
                      {themeRow}
                      <AccountMenuRow icon={SettingsOutlined} label="Settings" onPress={() => { setAccountOpen(false); setSettingsOpen(true) }} />
                      {/* Admin: only shown to the site owner */}
                      {isAdmin && (
                        <AccountMenuRow icon={InsightsOutlined} label="Admin" onPress={() => { setAccountOpen(false); navigate('/admin') }} />
                      )}
                    </Box>
                    <Box sx={{ ...ACCOUNT_MENU_GROUP_SX, borderTop: '1px solid', borderColor: 'divider' }}>
                      <AccountMenuRow icon={LogoutOutlined} label="Sign out" danger onPress={async () => { setAccountOpen(false); await signOut() }} />
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
                  <Paper elevation={8} role="menu" aria-label="Account" sx={ACCOUNT_MENU_SX}>
                    <Box sx={ACCOUNT_MENU_GROUP_SX}>
                      <AccountMenuRow icon={LoginOutlined} label="Sign in" onPress={() => { setAccountOpen(false); openAuthDialog('signin') }} />
                      <AccountMenuRow icon={PersonAddAltOutlined} label="Create an account" onPress={() => { setAccountOpen(false); openAuthDialog('signup') }} />
                    </Box>
                    {/* Settings: available without an account */}
                    <Box sx={{ ...ACCOUNT_MENU_GROUP_SX, borderTop: '1px solid', borderColor: 'divider' }}>
                      {themeRow}
                      <AccountMenuRow icon={SettingsOutlined} label="Settings" onPress={() => { setAccountOpen(false); setSettingsOpen(true) }} />
                    </Box>
                  </Paper>
                )}
              </Box>
            </ClickAwayListener>
          )}
          </Box>
        </Toolbar>
        {/* THE TABS' OWN ROW below TOOLBAR_NAV_INLINE_MIN: a separate, fixed-height row rather than
            the toolbar wrapping. A wrapped row is as tall as the tallest thing on its first line,
            which is an icon button whose size MUI decides, so the bar came out 78px at one width and
            95px at another, and index.html's static copy of it (which has no icons to measure)
            could not know which. Fixed rows are two numbers that copy can hold: 48 and 40, times
            the scale. See "Loading states" in CLAUDE.md. */}
        {hasToolbarNav && (
          <ToolbarNav
            section={navSection!}
            path={path}
            sx={{
              justifyContent: 'center', height: 'calc(40px * var(--app-chrome, 1))',
              [NAV_INLINE]: { display: 'none' },
            }}
          />
        )}
      </AppBar>

      {/* Dev-only: re-render the whole app inside a simulated phone viewport. At the
          app root (not inside a section) so the device toggle covers MLB and WPBL. */}
      {import.meta.env.DEV && !isInsideDeviceFrame && <MobilePreviewHost />}

      {/* This box held MLB's `zoom: 1.4` until Oct 2026, the last `zoom` on the site. Both
          sections now scale from the root (styles.css), toolbar and portaled sheets included,
          which the zoom never reached. */}
      {/* On a phone, room under the page and the footer for the bottom bar a standalone page wears
          (StandaloneBottomNav). The sections reserve their own. */}
      <Box sx={standaloneNav ? { [STANDALONE_NAV_QUERY]: { pb: `calc(${BOTTOM_NAV_SPACE} + env(safe-area-inset-bottom, 0px))` } } : undefined}>
        {/* p: 2 is 20px at the desktop scale on both sections, so the tab bar under the toolbar
            sits at the same height on each and a section switch moves nothing.
            A SCREEN TALL, so the shared footer below starts under the fold on every route. The
            standalone pages' Suspense fallbacks are spinners, and while a page's chunk was still
            on its way the footer painted a third of the way down and was then shoved off: CI's
            slower runner caught it on Compare and the Glossary, a fast desktop never did. Both
            sections already hold themselves this tall. */}
        <Box sx={{ p: 2, minHeight: '100dvh' }}>
          {/* The page area's own boundary, under the toolbar: a crash here keeps the toolbar and
              its section switch working, and moving to another path clears it. */}
          <AppErrorBoundary inline where="page" resetKey={path}>
          {keepMlb && (
            <KeptSection active={isMlbPath(path)} search={navSection === 'mlb'}>
              {/* A screen tall, for the reason the /wpbl fallback below gives: at spinner height the
                  footer painted halfway up the screen and was then shoved off it, 0.13 of layout
                  shift on a desktop load (Oct 1, 2026). The section keeps itself a screen tall once
                  it is in. */}
              <Suspense fallback={<Box sx={{ minHeight: '100dvh', display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>}>
                {/* On a phone MLB has the floating bottom bar, so the footer rides inside the section
                    above the room reserved for the bar, the same arrangement as WPBL. */}
                <MlbStats renderFooter={renderMlbFooter} />
              </Suspense>
            </KeptSection>
          )}
          {isWpblPlayersIndex(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblPlayersIndex onNavigate={navigateFromStandalone} />
            </Suspense>
          )}
          {isWpblLeaguePage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblLeaguePage onNavigate={navigateFromStandalone} />
            </Suspense>
          )}
          {isMlbComparePage(path) && (
            // A player opened from here is the player's page, through the section: MLB's side panel
            // lives in MlbStats, which is not mounted under a standalone page.
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <MlbComparePage path={path} onNavigate={navigate} />
            </Suspense>
          )}
          {isMlbPostseasonPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <MlbPostseasonPage path={path} />
            </Suspense>
          )}
          {isMlbGlossaryPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <MlbGlossaryPage />
            </Suspense>
          )}
          {isWpblGlossaryPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblGlossaryPage />
            </Suspense>
          )}
          {isWpblSourcesPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblSourcesPage onNavigate={navigate} />
            </Suspense>
          )}
          {isWpblSeasonPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblSeasonPage path={path} onNavigate={navigateFromStandalone} onOpenGame={openOverlayGame} />
            </Suspense>
          )}
          {isWpblScorigamiPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblScorigami onOpenGame={openOverlayGame} />
            </Suspense>
          )}
          {isWpblMatchupsPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblMatchupsPage onNavigate={navigateFromStandalone} />
            </Suspense>
          )}
          {isWpblSeriesPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblSeriesPage path={path} onNavigate={navigateFromStandalone} onOpenGame={openOverlayGame} />
            </Suspense>
          )}
          {isWpblPhotosPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblPhotosGallery />
            </Suspense>
          )}
          {isWpblPhotoTagPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblPhotoTagPage />
            </Suspense>
          )}
          {isWpblReadingPage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblReadingPage />
            </Suspense>
          )}
          {(isWpblWatchPage(path) || isWpblWatchVideoPage(path)) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblWatchPage path={path} onNavigate={navigateFromStandalone} onOpenGame={openOverlayGame} />
            </Suspense>
          )}
          {isWpblComparePage(path) && (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
              <WpblComparePage path={path} onNavigate={navigateFromStandalone} />
            </Suspense>
          )}
          {keepWpbl && (
            <KeptSection active={rendersWpblApp(path)} search={navSection === 'wpbl'}>
              {/* A SCREEN TALL, NOT A SPINNER TALL. React.lazy suspends for at least a tick even
                  with the chunk preloaded, so this is always the first thing painted on /wpbl, and at
                  spinner height it put the footer halfway up the screen for that frame. The
                  section's skeleton then shoved it off, which was nearly all of the page's 0.18
                  layout shift on load. */}
              <Suspense fallback={<Box sx={{ minHeight: '100vh' }} />}>
                {/* On mobile the WPBL tabs swipe, so the footer rides inside each tab pane (see
                    WpblApp) instead of sitting shared below them. The shared one is suppressed
                    just below. Desktop keeps the app-level footer. */}
                <WpblApp renderFooter={renderWpblFooter} />
              </Suspense>
            </KeptSection>
          )}
          {path === '/wpbl/api' && (
            <Box>
              {/* Aligned to the docs column (same maxWidth/px as WpblApiDocs). Phones only, as on
                  the other standalone WPBL pages (see WpblPage): above 600px the toolbar's tabs
                  are the way back. */}
              <Box sx={{ maxWidth: 760, mx: 'auto', px: { xs: 2, sm: 3 }, mb: 2, display: { xs: 'block', sm: 'none' } }}>
                <Box {...linkTo('/wpbl')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 700, userSelect: 'none', px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', transition: 'color 0.15s, border-color 0.15s, background-color 0.15s', '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' } }}>‹ Back to WPBL</Box>
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
                <Box {...linkTo('/wpbl')} sx={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: TYPE_SCALE.body, fontWeight: 700, userSelect: 'none', px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', transition: 'color 0.15s, border-color 0.15s, background-color 0.15s', '&:hover': { color: 'text.primary', borderColor: 'text.secondary', bgcolor: 'action.hover' } }}>‹ Back to WPBL</Box>
              </Box>
              <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
                <AdminPage />
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
          {/* A path no page claims. Production never gets here (public/_redirects is an allow-list
              and answers a real 404), but dev and an in-app link to a dead path drew nothing at
              all: a toolbar over an empty screen, with no tabs to leave by. Same words and the
              same two ways out as public/404.html. */}
          {!isKnownPath(path) && (
            <Box sx={{ maxWidth: 480, mx: 'auto', pt: 8, textAlign: 'center' }}>
              <Typography component="h1" sx={{ fontSize: TYPE_SCALE.page, fontWeight: 800, lineHeight: 1 }}>404</Typography>
              <Typography component="h2" sx={{ fontSize: TYPE_SCALE.display, fontWeight: 700, mt: 1.5 }}>That page doesn't exist</Typography>
              <Typography sx={{ color: 'text.secondary', mt: 1 }}>
                The link may be broken, or the page may have moved. Both league sections are below.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center', mt: 3 }}>
                {(['/wpbl', '/mlb'] as const).map((to, i) => (
                  <Box key={to} {...linkTo(to)} sx={{
                    ...UNSTYLED_LINK, px: 2, py: 1, borderRadius: 999, fontWeight: 700, border: '1px solid',
                    borderColor: i === 0 ? 'primary.main' : 'outline',
                    bgcolor: i === 0 ? 'primary.main' : 'transparent',
                    color: i === 0 ? 'primary.contrastText' : 'text.primary',
                  }}>
                    {to === '/wpbl' ? 'WPBL stats' : 'MLB stats'}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          </AppErrorBoundary>
        </Box>

        {/* On mobile WPBL the footer rides inside each swipeable tab pane (WpblApp's
            renderFooter) so it doesn't reflow when tabs of different heights swap, and on mobile
            MLB it sits inside the section above the bottom bar's reserved room, so skip the
            shared one on both. Everywhere else (incl. desktop) it renders here. */}
        {!((rendersWpblApp(path) || isMlbPath(path)) && !isDesktop) && (
          <SiteFooter
            onOpenChangelog={() => setChangelogOpen(true)}
            onOpenFeedback={() => setFeedbackOpen(true)}
            onNavigate={navigate}
            isWpbl={path.startsWith('/wpbl')}
            isMlb={isMlbSection(path)}
          />
        )}
      </Box>

      {standaloneNav && <StandaloneBottomNav section={standaloneNav} />}

      {/* A game opened from a standalone page, hovering over it. Kept here at the shell level so
          the page below (season, scorigami) stays mounted and visible behind it, rather than
          being replaced by WpblApp's Home. The X and Back both go through history.back, which
          `onPop` above turns into clearing this overlay. */}
      {(overlay?.kind === 'game' || overlay?.under) && (
        <Suspense fallback={<Box sx={{ position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>}>
          <WpblGameOverlayHost
            slug={overlay.kind === 'game' ? overlay.slug : overlay.under!}
            onClose={() => window.history.back()}
            onOpenPlayerNav={navigateFromGameCard}
          />
        </Suspense>
      )}

      {/* A player opened from a standalone page (or stacked on the game overlay above), hovering over
          it. Same reasoning as the game overlay: keep the page below mounted rather than routing to
          WpblApp's Home. onOpenGame lets its game log stack a game overlay on top. */}
      {overlay?.kind === 'player' && (
        <Suspense fallback={<Box sx={{ position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>}>
          <WpblPlayerOverlayHost
            slug={overlay.slug}
            onClose={() => window.history.back()}
            onOpenGame={openOverlayGameFromCard}
            onBack={overlay.under ? () => window.history.back() : undefined}
          />
        </Suspense>
      )}

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

      {paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={closePalette} section={searchSection}
            results={paletteResults} idle={paletteIdle} searching={bridge.searching}
            resolveCompare={bridge.resolveCompare} resolveGames={bridge.resolveGames}
            resolveLeader={bridge.resolveLeader} resolvePlayerStat={bridge.resolvePlayerStat} seasonCount={bridge.seasonCount}
            actions={paletteActions} />
        </Suspense>
      )}

      {changelogMounted && (
        <Suspense fallback={DIALOG_FALLBACK}>
          <ChangelogDialogs open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        </Suspense>
      )}

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

// ─── The account menu ─────────────────────────────────────────────────────────
// One row shape for every entry, signed in or out. The rows used to be drawn one by one: the theme
// row had an icon, Settings and Admin had an emoji inside their label, Sign in and Sign out had
// nothing, so the labels started at three different places, the padding differed by row, and a rule
// under every row made five items read as five separate boxes. Now every label starts on the same
// line behind a same-size icon, and rules fall only between groups.

const ACCOUNT_MENU_SX = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1400,
  borderRadius: 2.5, minWidth: 232, overflow: 'hidden',
  border: '1px solid', borderColor: 'outline',
} as const
const ACCOUNT_MENU_GROUP_SX = { py: 0.5 } as const

function AccountMenuRow({ icon: Icon, label, onPress, danger, ariaLabel }: {
  icon: typeof SettingsOutlined; label: string; onPress: () => void; danger?: boolean; ariaLabel?: string
}) {
  const ink = danger ? 'error.main' : 'text.secondary'
  return (
    <Box
      {...pressable(onPress)}
      role="menuitem"
      aria-label={ariaLabel}
      sx={{
        px: 2, py: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 1.5,
        '&:hover': { bgcolor: 'action.hover' },
        ...FOCUS_RING,
      }}
    >
      <Icon aria-hidden sx={{ fontSize: ICON_SIZE.md, color: ink, flexShrink: 0 }} />
      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.4, color: danger ? 'error.main' : 'text.primary' }}>
        {label}
      </Typography>
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
