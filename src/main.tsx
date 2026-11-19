// First, before anything that might capture `fetch` at import time. See the file.
import { devMountDelay } from './dev/slowLoad'
import React from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App'
import { AppThemeProvider } from './ThemeContext'
import { AppErrorBoundary } from './AppErrorBoundary'
import { installStaleBuildRecovery } from './lib/staleBuild'
import { startWebVitals } from './lib/webVitals'
import { trackLanding } from './lib/landing'
import { publishScrollbarWidth } from './lib/scrollbarWidth'
import { loadWpbl } from './sectionLoad'
import { wpblAppOwnsPath } from './wpbl/routes'
import { defaultSectionPath } from './lib/defaultSection'
import './styles.css'

// Before anything can lazy-load: a page left open across a deploy asks for chunks that no longer
// exist, and this reloads it onto the current build instead of blanking. See lib/staleBuild.ts.
installStaleBuildRecovery()
// Real readers' page-load timings, reported to /admin. See lib/webVitals.ts.
startWebVitals()
// Where this load came from, for /admin's Sources card. See lib/landing.ts.
trackLanding()
// Before the first paint, so the page widths that subtract it are right from the start.
publishScrollbarWidth()

// DEV-ONLY poster preview: `?awardsPreview` renders the fan-awards export harness in isolation, so
// the html2canvas capture can be eyeballed without a closed ballot or vote data. Dead in prod.
const awardsPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).has('awardsPreview')

// How long the first render waits for the WPBL chunk; see `sectionReady` below.
const SECTION_WAIT_MS = 3000

const rootEl = document.getElementById('app')
if (rootEl) {
  const root = createRoot(rootEl)
  if (awardsPreview) {
    import('./wpbl/AwardsPosterPreview').then(({ default: AwardsPosterPreview }) => {
      root.render(
        <AppThemeProvider>
          <CssBaseline />
          <AwardsPosterPreview />
        </AppThemeProvider>
      )
    })
  } else {
    // Dev only: the dev menu installs the WPBL read overlay when its module runs, and that has to
    // happen before the section's first read. App.tsx imports it lazily (see the note there), so it
    // is loaded here and the first render waits for it. The build drops the branch.
    const devReady: Promise<unknown> = import.meta.env.DEV ? import('./dev/DevSettings') : Promise.resolve()
    // THE SECTION'S CHUNK BEFORE THE FIRST RENDER, on the section's own paths. Rendered without it,
    // React cleared index.html's static page and painted the section's empty Suspense fallback
    // until the chunk arrived: a toolbar over a blank screen on every cold load. Waiting keeps the
    // static page up instead, and sectionLoad.ts lets the section render its skeleton at once. The
    // static bar is not interactive, so the wait is capped: past it, the fallback is the lesser harm.
    const opens = window.location.pathname === '/' ? defaultSectionPath() : window.location.pathname
    const sectionReady: Promise<unknown> = wpblAppOwnsPath(opens)
      ? Promise.race([loadWpbl().catch(() => { /* lazy() asks again and reports it */ }), new Promise(r => setTimeout(r, SECTION_WAIT_MS))])
      : Promise.resolve()
    const render = () => root.render(
      <AppThemeProvider>
        <CssBaseline />
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </AppThemeProvider>
    )
    const boot = () => { void Promise.allSettled([devReady, sectionReady]).then(render) }
    // ONE FRAME FIRST, so index.html's toolbar shell is on screen before React's first render
    // takes the main thread. That render is a long uninterrupted task on a phone, and started at
    // once it ran through the frame the shell was due in: production's first paint landed at 2.4s,
    // the moment the app itself drew, with the shell already in the DOM the whole time.
    // `setTimeout` inside the rAF runs after that frame is painted. The 200ms fallback is for a tab
    // opened in the background, where frames do not run at all and rAF alone would never boot it.
    if (devMountDelay > 0) {
      setTimeout(boot, devMountDelay)
    } else if (document.visibilityState === 'visible' && typeof requestAnimationFrame === 'function') {
      let booted = false
      const go = () => { if (!booted) { booted = true; boot() } }
      requestAnimationFrame(() => setTimeout(go, 0))
      setTimeout(go, 200)
    } else {
      boot()
    }
  }
}

// Register the service worker that receives Web Push notifications. Harmless if
// push is never enabled: it just sits idle until a subscription exists.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  })
}
