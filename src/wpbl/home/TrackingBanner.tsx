import { useEffect, useMemo, useRef, useState } from 'react'
import { ACCENT_EDGE } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { hoverOnly, pressable, TYPE_SCALE, ICON_SIZE } from '../ui'
import { track, EVENTS } from '../../lib/analytics'

// The league publishes TrackMan tracking in batches that land days after a game, often in
// bulk for several games at once (see wpbl-ingest's late-backfill note). When the set of
// games that carry tracking grows beyond what this browser last saw, surface a dismissible
// banner pointing to the Tracked board. First-ever visit seeds silently (no nag); the "new"
// state clears once the user views or dismisses it.

const TRACK_SEEN_KEY = 'wpbl:trackingSeenGames'

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TRACK_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}

function writeSeen(ids: Iterable<string>) {
  try { localStorage.setItem(TRACK_SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode / quota: non-fatal */ }
}

// Returns how many newly-tracked games appeared since this browser last acknowledged, and
// an ack() that marks the current tracked set as seen. Waits for tracking to load before
// judging (size 0 = not loaded yet), and seeds silently on a first visit.
export function useNewTrackingBatch(trackedGameIds: string[]): { newCount: number; ack: () => void } {
  const trackedIds = useMemo(() => new Set(trackedGameIds.filter(Boolean)), [trackedGameIds])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (trackedIds.size === 0) return // tracking not loaded yet: don't seed on an empty set
    const seen = readSeen()
    if (seen.length === 0) { writeSeen(trackedIds); setNewCount(0); return } // first visit: seed, no banner
    const seenSet = new Set(seen)
    let added = 0
    for (const id of trackedIds) if (!seenSet.has(id)) added++
    setNewCount(added)
  }, [trackedIds])

  const ack = () => { writeSeen(trackedIds); setNewCount(0) }
  return { newCount, ack }
}

export function NewTrackingBanner({ count, onView, onDismiss }: { count: number; onView: () => void; onDismiss: () => void }) {
  // One impression per mount, so the click-through is measurable. Without the SHOWN denominator
  // a quiet Tracked board reads the same whether nobody saw the banner or everybody ignored it,
  // and those call for opposite fixes.
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    track(EVENTS.NEW_BADGE_SHOWN, { badge: 'tracking', count })
  }, [count])
  const view = () => { track(EVENTS.NEW_BADGE_CLICKED, { badge: 'tracking', count }); onView() }
  return (
    <Box
      {...pressable(view)}
      sx={{
        mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: ACCENT_EDGE,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
        transition: 'background-color 0.15s',
        ...hoverOnly({ bgcolor: 'action.hover' }),
      }}
    >
      <Box sx={{ fontSize: ICON_SIZE.lg, lineHeight: 1, flexShrink: 0 }}>📡</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2 }}>
          New pitch-tracking data just landed
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.2 }}>
          Velocity, spin &amp; exit velo for {count} new game{count === 1 ? '' : 's'} — tap to explore Ballpark Tracking.
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        View →
      </Typography>
      <Box
        {...pressable(e => { e.stopPropagation(); onDismiss() })}
        aria-label="Dismiss"
        sx={{
          flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.secondary', fontSize: ICON_SIZE.sm, lineHeight: 1,
          ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        }}
      >
        ✕
      </Box>
    </Box>
  )
}
