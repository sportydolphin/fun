import React from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App'
import { AppThemeProvider } from './ThemeContext'
import './styles.css'

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
    root.render(
      <AppThemeProvider>
        <CssBaseline />
        <App />
      </AppThemeProvider>
    )
  }
}

// Register the service worker that receives Web Push notifications. Harmless if
// push is never enabled — it just sits idle until a subscription exists.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
  })
}
