import React from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App'
import { AppThemeProvider } from './ThemeContext'
import './styles.css'

const rootEl = document.getElementById('app')
if (rootEl) {
  const root = createRoot(rootEl)
  root.render(
    <AppThemeProvider>
      <CssBaseline />
      <App />
    </AppThemeProvider>
  )
}
