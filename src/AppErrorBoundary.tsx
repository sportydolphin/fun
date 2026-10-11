import React from 'react'
import { Box, Typography } from '@mui/material'
import { isChunkLoadError, reloadForNewBuild, runningBuild } from './lib/staleBuild'
import { track, EVENTS } from './lib/analytics'

// The last line under the whole app. Before this there was none, so ANY render error, most often
// a lazy chunk a new deploy had removed (see lib/staleBuild.ts), unmounted the tree and left a
// blank page with no way forward but the browser's own reload.
//
// A stale chunk gets one automatic reload, since that is all it needs. Everything else, and a
// chunk that still fails after that reload, gets a message and a button: never a blank screen.
//
// Deliberately plain: no lazy imports, no context beyond the theme, nothing that could itself be
// the thing that failed.
//
// TWO LAYERS. The one in main.tsx holds the whole app. `inline` ones sit around the page area
// (App.tsx) and each WPBL tab (WpblApp.tsx), so a bug in one board costs that board and nothing
// else: the toolbar, the nav and every other tab keep working, and the reader can simply go
// somewhere else. `resetKey` clears the error when it changes (App.tsx passes the path), so
// navigating away from a broken page is a way out, not a dead end.

interface Props {
  children: React.ReactNode
  /** Draw the message in place, at content size, rather than filling the screen. */
  inline?: boolean
  /** A change here clears a caught error and tries the children again. */
  resetKey?: unknown
  /** Which layer this is, for the report: the whole app, the page area, or one WPBL tab. */
  where?: 'app' | 'page' | 'tab'
}
interface State { error: unknown; reloading: boolean }

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !this.state.reloading && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: unknown) {
    const stale = isChunkLoadError(error)
    if (stale && reloadForNewBuild()) { this.setState({ reloading: true }); return }
    console.error(error)
    // REPORTED, because otherwise nobody would know: the screen is drawn on a reader's device and
    // nowhere else. It lands on /admin under "Site health". The message is the error's own text,
    // query strings cut and capped, so a URL carrying a parameter cannot ride along.
    try {
      const raw = error instanceof Error ? error.message : String(error)
      track(EVENTS.APP_ERROR, {
        kind: stale ? 'stale' : 'crash',
        where: this.props.where ?? 'app',
        message: raw.replace(/\?[^\s)"']*/g, '').slice(0, 120),
        build: runningBuild(),
      })
    } catch { /* never let the report be the second failure */ }
  }

  render() {
    const { error, reloading } = this.state
    if (!error) return this.props.children
    const stale = isChunkLoadError(error)
    const inline = !!this.props.inline
    return (
      <Box role="alert" sx={{
        minHeight: inline ? undefined : '100vh', py: inline ? 8 : 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 1.5, px: 3, textAlign: 'center',
        bgcolor: inline ? undefined : 'background.default',
      }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
          {reloading ? 'Loading the latest version…' : stale ? 'The site was just updated' : 'Something went wrong'}
        </Typography>
        {!reloading && (
          <>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', maxWidth: 360 }}>
              {stale
                ? 'This page was opened before the update. Reloading brings it up to date.'
                : inline
                  ? 'This part of the page could not be shown. Reloading usually fixes it, or pick somewhere else to go.'
                  : 'Reloading the page usually fixes it.'}
            </Typography>
            <Box component="button" type="button" onClick={() => window.location.reload()} sx={{
              mt: 0.5, px: 2.5, py: 1, border: 0, borderRadius: 999, cursor: 'pointer',
              font: 'inherit', fontSize: '0.9rem', fontWeight: 800,
              bgcolor: 'primary.main', color: 'primary.contrastText',
            }}>Reload</Box>
          </>
        )}
      </Box>
    )
  }
}
