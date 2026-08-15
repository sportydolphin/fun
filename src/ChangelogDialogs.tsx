import React, { useState } from 'react'
import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, useMediaQuery } from '@mui/material'
import { APP_VERSION } from './version'
import { CHANGELOG } from './changelog'
import { ACCENT } from './mlb/constants'

// The "What's New" dialog and its per-version detail view.
//
// Lives in its own lazily-loaded module because it is the only thing that reads CHANGELOG —
// ~59 KB of release prose that used to sit in the entry chunk, downloaded by every visitor
// on every cold load to render a dialog opened from a footer link. Nothing here is needed
// until that link is clicked.

function ChangelogBullet({ text }: { text: string }) {
  return (
    <Typography component="li" sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 0.6, lineHeight: 1.45 }}>
      {text}
    </Typography>
  )
}

export default function ChangelogDialogs({ open, onClose }: { open: boolean; onClose: () => void }) {
  // "View all changes" for one version. Owned here rather than by App: it is only ever
  // reachable from the dialog above it, so it has no reason to exist in the shell's state.
  const [viewAllVersion, setViewAllVersion] = useState<string | null>(null)
  const isDesktop = useMediaQuery('(min-width:900px)')

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={!isDesktop}>
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
          <Button onClick={onClose}>Close</Button>
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
    </>
  )
}
