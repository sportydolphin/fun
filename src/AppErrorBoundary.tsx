import React from 'react'
import { Box, Typography } from '@mui/material'
import { isChunkLoadError, reloadForNewBuild } from './lib/staleBuild'

// The last line under the whole app. Before this there was none, so ANY render error, most often
// a lazy chunk a new deploy had removed (see lib/staleBuild.ts), unmounted the tree and left a
// blank page with no way forward but the browser's own reload.
//
// A stale chunk gets one automatic reload, since that is all it needs. Everything else, and a
// chunk that still fails after that reload, gets a message and a button: never a blank screen.
//
// Deliberately plain: no lazy imports, no context beyond the theme, nothing that could itself be
// the thing that failed.

interface State { error: unknown; reloading: boolean }

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadForNewBuild()) this.setState({ reloading: true })
    else console.error(error)
  }

  render() {
    const { error, reloading } = this.state
    if (!error) return this.props.children
    const stale = isChunkLoadError(error)
    return (
      <Box role="alert" sx={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 1.5, px: 3, textAlign: 'center', bgcolor: 'background.default',
      }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
          {reloading ? 'Loading the latest version…' : stale ? 'The site was just updated' : 'Something went wrong'}
        </Typography>
        {!reloading && (
          <>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', maxWidth: 360 }}>
              {stale
                ? 'This page was opened before the update. Reloading brings it up to date.'
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
