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
import './styles.css'

// Before anything can lazy-load: a page left open across a deploy asks for chunks that no longer
// exist, and this reloads it onto the current build instead of blanking. See lib/staleBuild.ts.
installStaleBuildRecovery()
// Real readers' page-load timings, reported to /admin. See lib/webVitals.ts.
startWebVitals()

// DEV-ONLY poster preview: `?awardsPreview` renders the fan-awards export harness in isolation, so
// the html2canvas capture can be eyeballed without a closed ballot or vote data. Dead in prod.
const awardsPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).has('awardsPreview')

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
    const boot = () => root.render(
      <AppThemeProvider>
        <CssBaseline />
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </AppThemeProvider>
    )
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
